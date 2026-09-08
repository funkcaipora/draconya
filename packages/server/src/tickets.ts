// Ticket de sessão: uso único, vida curta, e resolução de nó (FUN-12).
//
// O problema que isto resolve: o socket de jogo precisa saber QUEM está do outro lado, e a
// sessão de login não pode ser a resposta. Um cookie de sessão trafegando no socket vale por
// tempo indeterminado e dá acesso à conta inteira; um ticket vale trinta segundos, uma vez
// só, e não diz nada além de qual personagem vai entrar em qual nó.
//
//   ticket:{token}     claim do ticket        TTL curto, consumido com GETDEL
//   tickets:pending    reservas em aberto     ZSET por prazo, varrido pelo `jobs`
//
// A regra que rege o slot de personagem ativo é uma só, e vale para todos os desfechos:
// **passado o prazo, se o personagem não tem sessão no diretório, o slot volta.** Ticket
// nunca usado, ticket consumido numa conexão que morreu no handshake e ticket emitido em
// duplicata caem todos nela, sem precisar de um caminho de limpeza para cada um.

import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { SessionDirectory } from './directory.js';

export interface TicketClaim {
  readonly accountId: string;
  readonly characterId: string;
  readonly nodeId: string;
}

export interface IssuedTicket {
  readonly ticket: string;
  readonly wsUrl: string;
  readonly nodeId: string;
  readonly expiresAtMs: number;
}

export type IssueFailure =
  /** A conta já tem o teto de personagens ativos (§7.1, FUN-15). */
  | 'active-limit'
  /** Nenhum nó de jogo batendo. Sem nó não há para onde mandar o jogador. */
  | 'no-node-available'
  /** O personagem tem sessão, mas o nó dela não responde. Ver o comentário em `issue`. */
  | 'session-node-unavailable';

export type IssueResult =
  | { readonly ok: true; readonly value: IssuedTicket }
  | { readonly ok: false; readonly reason: IssueFailure };

export interface TicketServiceOptions {
  /** Vida do ticket. Curta de propósito: é uma credencial em query string. */
  readonly ttlMs?: number;
  /**
   * Folga entre o fim do ticket e a varredura. É o que dá tempo de o nó registrar a sessão
   * depois de consumir o ticket; sem ela a varredura devolveria o slot de uma sessão que
   * acabou de nascer.
   */
  readonly graceMs?: number;
  /**
   * Relógio de parede, não monotônico, e de propósito: o prazo é gravado por um processo
   * (`api`) e lido por outro (`jobs`). `performance.now()` de dois processos não é
   * comparável.
   */
  readonly now?: () => number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_GRACE_MS = 30_000;

const PENDING_KEY = 'tickets:pending';
const ticketKey = (token: string): string => `ticket:${token}`;

/** Um membro por personagem: reemitir ticket atualiza o prazo em vez de acumular lixo. */
const pendingMember = (accountId: string, characterId: string): string =>
  JSON.stringify([accountId, characterId]);

export class TicketService {
  readonly #redis: Redis;
  readonly #directory: SessionDirectory;
  readonly #ttlMs: number;
  readonly #graceMs: number;
  readonly #now: () => number;

  constructor(redis: Redis, directory: SessionDirectory, options: TicketServiceOptions = {}) {
    this.#redis = redis;
    this.#directory = directory;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.#now = options.now ?? Date.now;
  }

  async issue(accountId: string, characterId: string): Promise<IssueResult> {
    const existing = await this.#directory.lookup(characterId);

    let node;
    if (existing !== null) {
      node = await this.#directory.node(existing.nodeId);
      // Sessão viva num nó que não bate: RECUSAR, nunca escolher outro nó. Se o nó estiver
      // só particionado, mandar o jogador para um segundo nó cria a segunda sessão do mesmo
      // personagem — exatamente o que o invariante 8 existe para impedir, e o defeito
      // aparece depois como loot e XP contados duas vezes. Quem tem o direito de decidir
      // que aquela sessão morreu é a retomada (FUN-28), com lock e fencing token.
      if (node === null) return { ok: false, reason: 'session-node-unavailable' };
    } else {
      node = await this.#leastLoadedNode();
      if (node === null) return { ok: false, reason: 'no-node-available' };
    }

    // O slot é reservado AQUI, na emissão, e não quando a conexão chega: entre uma coisa e
    // outra cabe o teto sendo furado por duas requisições simultâneas.
    if (!(await this.#directory.reserveSlot(accountId, characterId))) {
      return { ok: false, reason: 'active-limit' };
    }

    const token = randomBytes(32).toString('base64url');
    const claim: TicketClaim = { accountId, characterId, nodeId: node.nodeId };
    const issuedAtMs = this.#now();

    await this.#redis
      .pipeline()
      .set(ticketKey(token), JSON.stringify(claim), 'PX', this.#ttlMs)
      .zadd(
        PENDING_KEY,
        issuedAtMs + this.#ttlMs + this.#graceMs,
        pendingMember(accountId, characterId),
      )
      .exec();

    return {
      ok: true,
      value: {
        ticket: token,
        wsUrl: withTicket(node.url, token),
        nodeId: node.nodeId,
        expiresAtMs: issuedAtMs + this.#ttlMs,
      },
    };
  }

  /**
   * Troca o ticket pelo claim. `GETDEL` porque ler e apagar precisam ser uma operação só:
   * com `GET` seguido de `DEL`, duas conexões chegando juntas leem as duas antes de qualquer
   * uma apagar, e o "uso único" some sem deixar rastro.
   *
   * O `nodeId` do chamador é conferido contra o do claim. Um ticket emitido para o nó A
   * apresentado ao nó B é recusado — senão bastaria trocar o host da URL para abrir a
   * segunda sessão do mesmo personagem.
   */
  async consume(token: string, nodeId: string): Promise<TicketClaim | null> {
    if (token === '') return null;
    const raw = await this.#redis.getdel(ticketKey(token));
    if (raw === null) return null;
    const claim = parseClaim(raw);
    if (claim === null || claim.nodeId !== nodeId) return null;
    return claim;
  }

  /**
   * Devolve o slot de quem passou do prazo e não tem sessão. Roda no `jobs`.
   *
   * Sem isto, um ticket abandonado — o jogador fechou a aba entre pedir e conectar — segura
   * um dos dois slots da conta, e o jogador fica sem entender por que não consegue logar o
   * outro personagem.
   */
  async sweepAbandoned(): Promise<number> {
    const due = await this.#redis.zrangebyscore(PENDING_KEY, '-inf', this.#now());
    if (due.length === 0) return 0;

    let released = 0;
    for (const member of due) {
      const parsed = parseMember(member);
      if (parsed === null) continue;
      if ((await this.#directory.lookup(parsed.characterId)) !== null) continue;
      await this.#directory.releaseSlot(parsed.accountId, parsed.characterId);
      released += 1;
    }

    // Todos saem do ZSET, inclusive os que não liberaram nada: quem tem sessão viva já é
    // problema do lease, não desta varredura.
    await this.#redis.zrem(PENDING_KEY, ...due);
    return released;
  }

  async #leastLoadedNode() {
    const nodes = await this.#directory.aliveNodes();
    if (nodes.length === 0) return null;
    return nodes.reduce((chosen, node) => (node.sessions < chosen.sessions ? node : chosen));
  }
}

/**
 * O token vai na query string porque a API de WebSocket do navegador não deixa mandar
 * cabeçalho no handshake. O custo é conhecido: query string entra em log de proxy. É por
 * isso que o ticket vale trinta segundos e uma vez só, e por isso que nada aqui registra a
 * URL montada em log.
 */
function withTicket(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('ticket', token);
  return url.toString();
}

function parseClaim(raw: string): TicketClaim | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (
    typeof value['accountId'] !== 'string'
    || typeof value['characterId'] !== 'string'
    || typeof value['nodeId'] !== 'string'
  ) {
    return null;
  }
  return {
    accountId: value['accountId'],
    characterId: value['characterId'],
    nodeId: value['nodeId'],
  };
}

function parseMember(member: string): { accountId: string; characterId: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(member);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [accountId, characterId] = parsed as unknown[];
  if (typeof accountId !== 'string' || typeof characterId !== 'string') return null;
  return { accountId, characterId };
}
