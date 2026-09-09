// Ticket de sessão: uso único, vida curta, e resolução de nó (FUN-12).
//
// O problema que isto resolve: o socket de jogo precisa saber QUEM está do outro lado, e a
// sessão de login não pode ser a resposta. Um cookie de sessão trafegando no socket vale por
// tempo indeterminado e dá acesso à conta inteira; um ticket vale trinta segundos, uma vez
// só, e não diz nada além de qual personagem vai entrar em qual nó.
//
//   ticket:{token}     claim do ticket        TTL curto, consumo atômico
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
  readonly initialCharacter?: InitialCharacter;
}

/** Estado persistido necessário para criar a primeira sessão sem confiar no cliente. */
export interface InitialCharacter {
  readonly level: number;
  readonly xp: number;
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

const ISSUE_TICKET = `
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) ~= 1 then
  if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
  redis.call('SADD', KEYS[1], ARGV[1])
end
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
redis.call('SET', KEYS[2], ARGV[4], 'PX', tonumber(ARGV[5]))
redis.call('ZADD', KEYS[3], ARGV[6], ARGV[7])
return 1
`;

const CONSUME_TICKET = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local decoded, claim = pcall(cjson.decode, raw)
if not decoded or type(claim) ~= 'table'
  or type(claim.accountId) ~= 'string'
  or type(claim.characterId) ~= 'string'
  or claim.nodeId ~= ARGV[1] then
  return nil
end
local active = 'account:' .. claim.accountId .. ':active'
if redis.call('SISMEMBER', active, claim.characterId) ~= 1 then
  redis.call('DEL', KEYS[1])
  return nil
end
redis.call('PEXPIRE', active, tonumber(ARGV[2]))
redis.call('DEL', KEYS[1])
return raw
`;

const SWEEP_RESERVATION = `
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score or tonumber(score) > tonumber(ARGV[2]) then return 0 end
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('ZREM', KEYS[1], ARGV[1])
  return 0
end
local removed = redis.call('SREM', KEYS[3], ARGV[3])
redis.call('ZREM', KEYS[1], ARGV[1])
return removed
`;

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
    this.#redis.defineCommand('issueSessionTicket', { numberOfKeys: 3, lua: ISSUE_TICKET });
    this.#redis.defineCommand('consumeSessionTicket', { numberOfKeys: 1, lua: CONSUME_TICKET });
    this.#redis.defineCommand('sweepTicketReservation', {
      numberOfKeys: 3,
      lua: SWEEP_RESERVATION,
    });
  }

  async issue(
    accountId: string,
    characterId: string,
    initialCharacter?: InitialCharacter,
  ): Promise<IssueResult> {
    const existing = await this.#directory.lookup(characterId);

    let node;
    if (existing !== null) {
      node = await this.#directory.node(existing.nodeId);
      // Nó que não bate há mais de um lease: o registro é um ponteiro para lugar nenhum.
      // Rotear para um nó vivo é a RETOMADA (FUN-28) — o nó novo reconstrói a sessão a
      // partir do snapshot, e a tomada do registro é atômica e condicionada à ausência do
      // batimento do antigo, então duas cópias continuam impossíveis.
      //
      // Recusar aqui, como era antes, deixava o personagem inalcançável até o lease expirar
      // sozinho: depois de um `kill -9` o jogador via `session-node-unavailable` por até
      // trinta segundos, sem nada explicando.
      if (node === null) node = await this.#leastLoadedNode();
      if (node === null) return { ok: false, reason: 'session-node-unavailable' };
    } else {
      node = await this.#leastLoadedNode();
      if (node === null) return { ok: false, reason: 'no-node-available' };
    }

    const token = randomBytes(32).toString('base64url');
    const claim: TicketClaim = {
      accountId,
      characterId,
      nodeId: node.nodeId,
      ...(initialCharacter === undefined ? {} : { initialCharacter }),
    };
    const issuedAtMs = this.#now();
    const reservationTtlMs = this.#ttlMs + this.#graceMs;
    const member = pendingMember(accountId, characterId);
    const redis = this.#redis as Redis & {
      issueSessionTicket(
        active: string,
        ticket: string,
        pending: string,
        characterId: string,
        limit: string,
        reservationTtl: string,
        claim: string,
        ticketTtl: string,
        deadline: string,
        member: string,
      ): Promise<number>;
    };
    const reserved = await redis.issueSessionTicket(
      activeCharactersKey(accountId),
      ticketKey(token),
      PENDING_KEY,
      characterId,
      String(this.#directory.activeLimit),
      String(reservationTtlMs),
      JSON.stringify(claim),
      String(this.#ttlMs),
      String(issuedAtMs + reservationTtlMs),
      member,
    );
    if (reserved !== 1) return { ok: false, reason: 'active-limit' };

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
   * Troca o ticket pelo claim numa operação que também valida e renova a reserva ativa.
   * Separar qualquer uma dessas etapas abre uma janela para dois sockets consumirem o mesmo
   * ticket ou para aceitar uma conexão cuja autorização no Redis já expirou.
   *
   * O `nodeId` do chamador é conferido contra o do claim. Um ticket emitido para o nó A
   * apresentado ao nó B é recusado — senão bastaria trocar o host da URL para abrir a
   * segunda sessão do mesmo personagem.
   */
  async consume(token: string, nodeId: string): Promise<TicketClaim | null> {
    if (token === '') return null;
    const redis = this.#redis as Redis & {
      consumeSessionTicket(key: string, expectedNode: string, activeTtl: string): Promise<string | null>;
    };
    const raw = await redis.consumeSessionTicket(
      ticketKey(token), nodeId, String(this.#directory.leaseMs),
    );
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
      if (parsed === null) {
        await this.#redis.zrem(PENDING_KEY, member);
        continue;
      }
      const redis = this.#redis as Redis & {
        sweepTicketReservation(
          pending: string,
          session: string,
          active: string,
          member: string,
          now: string,
          characterId: string,
        ): Promise<number>;
      };
      released += await redis.sweepTicketReservation(
        PENDING_KEY,
        sessionKey(parsed.characterId),
        activeCharactersKey(parsed.accountId),
        member,
        String(this.#now()),
        parsed.characterId,
      );
    }
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
  const rawInitial = value['initialCharacter'];
  const initialCharacter = parseInitialCharacter(rawInitial);
  if (rawInitial !== undefined && initialCharacter === undefined) return null;
  return {
    accountId: value['accountId'],
    characterId: value['characterId'],
    nodeId: value['nodeId'],
    ...(initialCharacter === undefined ? {} : { initialCharacter }),
  };
}

function parseInitialCharacter(value: unknown): InitialCharacter | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const initial = value as Record<string, unknown>;
  const level = initial['level'];
  const xp = initial['xp'];
  if (
    typeof level !== 'number'
    || !Number.isInteger(level)
    || level < 1
    || typeof xp !== 'number'
    || !Number.isSafeInteger(xp)
    || xp < 0
  ) return undefined;
  return { level, xp };
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

const sessionKey = (characterId: string): string => `char:${characterId}:session`;
const activeCharactersKey = (accountId: string): string => `account:${accountId}:active`;
