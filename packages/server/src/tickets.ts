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
import { OutfitColors } from '@draconya/protocol';
import type { BestiaryState } from '@draconya/sim';
import type { NodeStatus, SessionDirectory } from './directory.js';

export interface TicketClaim {
  readonly accountId: string;
  readonly characterId: string;
  readonly nodeId: string;
  readonly initialCharacter?: InitialCharacter;
  /**
   * A party (#195, ADR 0027): o MESMO bloco em cada ticket dos N membros, com o estado inicial
   * de todos — o primeiro a chegar ao `game` cria a sessão com os N, os seguintes se anexam
   * a ela. Vem do `api`, assinado como o resto (invariante 4): nada disto passa pelo cliente.
   */
  readonly party?: PartyTicket;
}

export interface PartyTicket {
  readonly sessionId: string;
  readonly leaderId: string;
  /**
   * Os dois eixos do líder (ADR 0033 D1), no lugar de `mode`. O `mode` continua aceito na
   * LEITURA por um deploy em rolagem (`parsePartyTicket`) — um `api` antigo ainda o emite, e a
   * migração é a mesma do snapshot: `'shared'` liga os dois, `'split'` desliga os dois.
   */
  readonly shareCosts: boolean;
  readonly splitLoot: boolean;
  readonly huntId: string;
  readonly difficulty: string;
  /**
   * `true`: ticket de ENTRADA numa hunt já em curso (#402, ADR 0033 D7) — `members` tem
   * exatamente UM, e o `game` chama `session.enter` na sessão hospedada em vez de criá-la.
   */
  readonly join?: true;
  /** Na ordem de entrada: é a ordem em que a sessão os recebe. */
  readonly members: ReadonlyArray<{
    readonly characterId: string;
    readonly accountId: string;
    readonly initialCharacter: InitialCharacter;
  }>;
}

/** Estado persistido necessário para criar a primeira sessão sem confiar no cliente. */
export interface InitialCharacter {
  readonly level: number;
  readonly xp: number;
  /**
   * Stamina materializada e o instante de RELÓGIO em que ela valia (§10, FUN-39).
   *
   * Vem do banco pelo mesmo caminho que level e XP, e pela mesma razão: nada que o cliente
   * manda participa da criação da sessão (invariante 4). Ausente é o personagem gravado
   * antes da coluna existir — a sessão roda sem teto, e é melhor que cobrar uma stamina que
   * nunca foi medida.
   */
  readonly staminaMs?: number;
  readonly staminaUpdatedAtMs?: number;
  /**
   * Gold da tabela, para a sessão saber o saldo antes de gastar (FUN-77).
   *
   * Vem do banco pelo mesmo caminho que level e XP, e pela mesma razão: nada que o cliente
   * manda participa da criação da sessão (invariante 4). Um saldo vindo do socket seria poção
   * de graça, e não haveria como distinguir isso de um jogador rico.
   *
   * Ausente é ticket emitido por um `api` antigo, durante deploy em rolagem: a sessão entra
   * com zero e recusa gasto. Degrada para o lado seguro — não gastar o que não se sabe ter.
   */
  readonly gold?: number;
  /**
   * A configuração do bot, crua e ainda NÃO validada (FUN-81).
   *
   * Vem do banco pelo mesmo caminho que level, XP e gold — o `api` lê a linha, e nada que o
   * cliente manda entra aqui (invariante 4). Chega como `unknown` de propósito: quem valida
   * contra o vocabulário é o `game`, com `botConfigSchema`, no instante de compilar.
   *
   * O ticket é o caminho de LEITURA da configuração; a escrita vai pelo socket, e as duas não
   * se cruzam. Ausente é personagem sem bot, que é o normal até ele configurar um.
   */
  readonly botConfig?: unknown;
  /**
   * As skills do personagem (§9.4, FUN-75), cruas.
   *
   * Precisam entrar na sessão, e não só sair dela: a skill escala o dano DURANTE a hunt, e um
   * personagem que entrasse sempre no nível inicial bateria errado a hunt inteira.
   *
   * `unknown` porque a forma é do `sim`; o serviço de ticket não é lugar de conhecer domínio.
   */
  readonly skills?: unknown;
  /**
   * O que o personagem tem (§21.4, FUN-82), cru.
   *
   * Precisa entrar na sessão porque a arma equipada decide o dano e a mochila decide o que
   * cabe. Um personagem que entrasse de mãos vazias bateria com o desarmado a hunt inteira,
   * carregando uma espada que o banco diz que ele tem.
   */
  readonly inventory?: unknown;
  /**
   * Nome de exibição, para o chat assinar a mensagem (FUN-58). Vem do banco pelo mesmo
   * caminho que level e XP: o cliente não escolhe como aparece para os outros. Ausente é
   * ticket emitido por um `api` antigo, durante deploy em rolagem — o host assina com o id.
   */
  readonly name?: string;
  /**
   * As cores do outfit (FUN-104), como quem está por perto precisa vê-lo pintado.
   *
   * Vêm pelo ticket, como o `name`, e pela mesma razão: é dado do personagem que só a
   * apresentação lê — o `sim` não conhece cor, e o snapshot não a carrega. Ao contrário de
   * `botConfig`, chegam JÁ VALIDADAS contra o schema do protocolo: a forma é do protocolo, não
   * de domínio nenhum, e o `game` as repete no `creature-appear` sem olhar. Ausente é
   * personagem que nunca escolheu (ou ticket de um `api` antigo): o cliente pinta com as
   * cores de personagem novo.
   */
  readonly outfitColors?: OutfitColors;
  /**
   * Abates por monstro (§18, FUN-113), JÁ VALIDADOS: `monsterId → abates`.
   *
   * Entram na sessão, e não só saem dela, porque o bônus dos marcos escala a XP DURANTE a
   * hunt (DT-01): um personagem que entrasse sempre em `{}` ganharia XP sem bônus a hunt
   * inteira, e o marco que ele cruzou ontem não valeria nada hoje. Vêm do banco pelo mesmo
   * caminho que level, XP e skills, e pela mesma razão (invariante 4).
   *
   * Tipados, ao contrário de `skills`: a forma é um mapa de inteiros, e conferir isso não é
   * conhecer domínio nenhum — é o que faz o `game` espalhar sem cast. Ausente é personagem que
   * nunca abateu nada (ou ticket de um `api` antigo): a sessão parte de `{}`.
   */
  readonly bestiary?: BestiaryState;
  /** A munição escolhida por família (#152), validada como o Bestiário. */
  readonly ammo?: Readonly<Record<string, string>>;
  /**
   * A vocação (#154), lida de `characters.vocation`. Ausente é quem ainda não escolheu — ou
   * ticket de um `api` anterior: a sessão entra sem vocação e o diálogo aparece de novo, o que
   * `already-chosen` no `sim` não impede, mas o `coalesce` do `jobs` impede de gravar duas.
   */
  readonly vocation?: string;
  /**
   * Premium do personagem (ADR 0033 D3), já resolvido contra o relógio pelo `api` — a sessão
   * nunca compara datas, só lê um boolean. É o que decide o limite de venda automática do
   * LÍDER e a penalidade de morte de cada membro.
   *
   * O PRD fala da "conta do líder"; o contrato persistido é por personagem
   * (`characters.premium_until`, ADR 0014 — não se renomeia). Ausente é Free, ou ticket de um
   * `api` antigo — nunca ticket recusado (regra do Bestiário).
   */
  readonly premium?: boolean;
}

export interface IssuedTicket {
  readonly ticket: string;
  readonly wsUrl: string;
  readonly nodeId: string;
  readonly expiresAtMs: number;
}

/** O nó resolvido, ou por que não deu. Ver `resolveNode`. */
export type NodeResolution =
  | { readonly ok: true; readonly node: NodeStatus }
  | { readonly ok: false; readonly reason: IssueFailure };

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

  /**
   * Para qual nó este personagem vai — resolvido ANTES da trava de linha (FUN-53).
   *
   * Qual nó de jogo está vivo não tem relação nenhuma com a linha do personagem, e descobrir
   * isso custa `SCAN` mais `MGET` no Redis. Segurando a trava enquanto isso acontece, uma
   * lentidão do Redis vira linha travada por segundos, pool do Postgres esgotado e TODA rota
   * que toca o banco parando de responder — por um problema que não tem nada a ver com a
   * linha travada.
   *
   * A janela que separar as duas abre — o nó escolhido morrer entre a resolução e a emissão —
   * já é tratada: o `consume` recusa o ticket se o nó não bater, e o jogador reconecta.
   */
  async resolveNode(characterId: string): Promise<NodeResolution> {
    const existing = await this.#directory.lookup(characterId);

    if (existing === null) {
      const node = await this.#leastLoadedNode();
      return node === null ? { ok: false, reason: 'no-node-available' } : { ok: true, node };
    }

    let node = await this.#directory.node(existing.nodeId);
    // Nó que não bate há mais de um lease: o registro é um ponteiro para lugar nenhum.
    // Rotear para um nó vivo é a RETOMADA (FUN-28) — o nó novo reconstrói a sessão a
    // partir do snapshot, e a tomada do registro é atômica e condicionada à ausência do
    // batimento do antigo, então duas cópias continuam impossíveis.
    //
    // Recusar aqui, como era antes, deixava o personagem inalcançável até o lease expirar
    // sozinho: depois de um `kill -9` o jogador via `session-node-unavailable` por até
    // trinta segundos, sem nada explicando.
    if (node === null) node = await this.#leastLoadedNode();
    return node === null ? { ok: false, reason: 'session-node-unavailable' } : { ok: true, node };
  }

  /**
   * Emite o ticket. Recebe o nó já resolvido quando quem chama o resolveu fora da trava
   * (FUN-53); sem ele, resolve aqui — é o caminho de quem não tem transação aberta.
   */
  async issue(
    accountId: string,
    characterId: string,
    initialCharacter?: InitialCharacter,
    resolved?: NodeStatus,
    party?: PartyTicket,
  ): Promise<IssueResult> {
    let node: NodeStatus | undefined = resolved;
    if (node === undefined) {
      const resolution = await this.resolveNode(characterId);
      if (!resolution.ok) return resolution;
      node = resolution.node;
    }

    const token = randomBytes(32).toString('base64url');
    const claim: TicketClaim = {
      accountId,
      characterId,
      nodeId: node.nodeId,
      ...(initialCharacter === undefined ? {} : { initialCharacter }),
      ...(party === undefined ? {} : { party }),
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
   * Desfaz uma emissão (#195): o `start` de uma party emite N tickets, e se o quarto falha os
   * três primeiros não podem ficar reservando slot e apontando para uma sessão que não vai
   * existir. Apaga o ticket, a reserva pendente e o slot ativo — como a varredura faria no
   * prazo, só que agora.
   */
  async revoke(token: string, accountId: string, characterId: string): Promise<void> {
    await this.#redis.multi()
      .del(ticketKey(token))
      .zrem(PENDING_KEY, pendingMember(accountId, characterId))
      .srem(activeCharactersKey(accountId), characterId)
      .exec();
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
  const rawParty = value['party'];
  const party = parsePartyTicket(rawParty);
  if (rawParty !== undefined && party === undefined) return null;
  return {
    accountId: value['accountId'],
    characterId: value['characterId'],
    nodeId: value['nodeId'],
    ...(initialCharacter === undefined ? {} : { initialCharacter }),
    ...(party === undefined ? {} : { party }),
  };
}

/** A party do ticket (#195), pela mesma régua do `initialCharacter`: torta é ticket recusado. */
function parsePartyTicket(value: unknown): PartyTicket | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  // Compat de um deploy (D1): um `api` ainda não atualizado manda `mode`; a leitura migra com
  // a MESMA tabela do snapshot antigo — 'shared' liga os dois eixos, 'split' desliga os dois.
  const hasAxes = typeof raw['shareCosts'] === 'boolean' || typeof raw['splitLoot'] === 'boolean';
  const hasMode = raw['mode'] === 'split' || raw['mode'] === 'shared';
  // O ticket de ENTRADA (#402) é o único caso de um membro só: o recém-chegado entra numa hunt
  // que já existe, e o bloco da party não carrega os N de novo.
  const join = raw['join'] === true;
  if (
    typeof raw['sessionId'] !== 'string' || typeof raw['leaderId'] !== 'string'
    || (!hasAxes && !hasMode)
    || typeof raw['huntId'] !== 'string' || typeof raw['difficulty'] !== 'string'
    || !Array.isArray(raw['members']) || raw['members'].length < (join ? 1 : 2)
  ) {
    return undefined;
  }
  const shareCosts = typeof raw['shareCosts'] === 'boolean' ? raw['shareCosts'] : raw['mode'] === 'shared';
  const splitLoot = typeof raw['splitLoot'] === 'boolean' ? raw['splitLoot'] : raw['mode'] === 'shared';
  const members: PartyTicket['members'][number][] = [];
  for (const entry of raw['members'] as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const member = entry as Record<string, unknown>;
    const initialCharacter = parseInitialCharacter(member['initialCharacter']);
    if (typeof member['characterId'] !== 'string' || typeof member['accountId'] !== 'string' || initialCharacter === undefined) {
      return undefined;
    }
    members.push({ characterId: member['characterId'], accountId: member['accountId'], initialCharacter });
  }
  return {
    sessionId: raw['sessionId'], leaderId: raw['leaderId'], shareCosts, splitLoot,
    huntId: raw['huntId'], difficulty: raw['difficulty'], members,
    ...(join ? { join: true as const } : {}),
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

  const staminaMs = initial['staminaMs'];
  const staminaUpdatedAtMs = initial['staminaUpdatedAtMs'];
  // Os dois andam juntos: um valor sem instante não diz nada, e um instante sem valor também
  // não. Meio par é dado corrompido, e a resposta é ignorar o par inteiro.
  const stamina = typeof staminaMs === 'number' && Number.isFinite(staminaMs) && staminaMs >= 0
    && typeof staminaUpdatedAtMs === 'number' && Number.isFinite(staminaUpdatedAtMs)
    ? { staminaMs, staminaUpdatedAtMs }
    : {};
  const name = initial['name'];
  const gold = initial['gold'];
  // Cores fora da paleta ou com peça faltando viram AUSENTES, nunca ticket recusado: a linha
  // do banco é `jsonb` sem CHECK, e um valor corrompido ali não pode trancar o personagem
  // fora do jogo por causa de cor. Sem cores o cliente pinta o padrão — degradação, não perda.
  const colors = OutfitColors.safeParse(initial['outfitColors']);
  return {
    level,
    xp,
    ...stamina,
    ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
    ...(colors.success ? { outfitColors: colors.data } : {}),
    // Gold inválido vira AUSENTE, não zero implícito com cara de valor: o resultado é o mesmo
    // saldo zero, mas quem lê o ticket consegue distinguir "não veio" de "veio como 0".
    ...(typeof gold === 'number' && Number.isSafeInteger(gold) && gold >= 0 ? { gold } : {}),
    // A configuração do bot passa OPACA. Validar aqui exigiria o vocabulário dentro do
    // serviço de ticket, e o dono da validação é quem vai compilar — o `game`. O que este
    // parse garante é só que existe algo, não o quê.
    ...(initial['botConfig'] === undefined || initial['botConfig'] === null
      ? {}
      : { botConfig: initial['botConfig'] }),
    ...(typeof initial['skills'] === 'object' && initial['skills'] !== null
      ? { skills: initial['skills'] }
      : {}),
    ...(typeof initial['inventory'] === 'object' && initial['inventory'] !== null
      ? { inventory: initial['inventory'] }
      : {}),
    // O Bestiário passa VALIDADO, como as cores e ao contrário das skills: a forma é um mapa
    // de inteiros, e um valor torto vira AUSENTE — a sessão parte de `{}` — em vez de virar
    // `NaN` dentro do motor ou de recusar o ticket por causa de uma contagem.
    ...(isBestiaryState(initial['bestiary']) ? { bestiary: initial['bestiary'] } : {}),
    ...(isAmmoSelection(initial['ammo']) ? { ammo: initial['ammo'] } : {}),
    // A vocação (#154): string não vazia; qualquer outra coisa vira AUSENTE, nunca ticket
    // recusado — como o Bestiário.
    ...(typeof initial['vocation'] === 'string' && initial['vocation'].length > 0
      ? { vocation: initial['vocation'] }
      : {}),
    // O Premium (ADR 0033 D3): booleano ou AUSENTE, nunca ticket recusado. Um valor torto vira
    // Free — a mesma régua das cores e do Bestiário —, porque a linha do banco não tem CHECK.
    ...(typeof initial['premium'] === 'boolean' ? { premium: initial['premium'] } : {}),
  };
}

/**
 * A forma da munição escolhida (#152): objeto `família → id`, strings não vazias. Um valor que
 * não bate vira AUSENTE — a sessão atira a grátis —, nunca ticket recusado, pela razão do
 * Bestiário. Exportada para o `api` conferir a linha com a MESMA régua do `consume`.
 */
export function isAmmoSelection(value: unknown): value is Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([family, ammoId]) =>
    family.length > 0 && typeof ammoId === 'string' && ammoId.length > 0);
}

/**
 * A forma de `BestiaryState` (§18, FUN-113): objeto cujos valores são inteiros seguros, não
 * negativos, sob chaves não vazias.
 *
 * Um valor que não bate vira AUSENTE, nunca ticket recusado: a linha do banco é `jsonb` sem
 * CHECK, e uma contagem corrompida não pode trancar o personagem fora do jogo. Array fica de
 * fora de propósito — `Object.values` de um array daria contagens sem monstro. A chave vazia
 * também: o schema do protocolo a recusa, e a mensagem `bestiary` inteira sumiria em silêncio.
 *
 * Exportada para o `api` conferir a linha com a MESMA régua que o `consume` usa — duas réguas
 * divergiriam na primeira mudança em uma delas.
 */
export function isBestiaryState(value: unknown): value is BestiaryState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([monsterId, kills]) =>
    monsterId.length > 0
    && typeof kills === 'number'
    && Number.isSafeInteger(kills)
    && kills >= 0);
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
