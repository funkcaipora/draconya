// A party ANTES da hunt (#195, ADR 0027 decisão 8): transitória, em Redis, no `api`.
//
// Uma party existe entre "criar" e "iniciar" ou "desfazer". Não é linha de Postgres — é
// formulário, não progresso — e não é estado quente: os personagens estão na Cidade, que é
// inerte, e nada aqui toca `CharacterRuntime` nenhum (invariante 9).
//
// Desde o #402 (ADR 0035 D7) ela SOBREVIVE ao `start`: vira `state: 'hunting'` com o
// `sessionId`, e o TTL longo é renovado a cada ação. O `DISBANDED` passa a ser LAZY — quando o
// diretório não conhece mais a sessão, `/mine` e `rooms` apagam o registro. A lotação viva é
// lida do diretório pelo `api`, nunca escrita aqui (invariante 9).
//
// Desde a #501 a sala tem COMPOSIÇÃO POR VOCAÇÃO (`vocationTargets`, vocação → TOTAL desejado,
// incluindo quem já está) e a vaga é conferida DENTRO do Lua (DT-01): as vocações dos membros
// moram no HASH `party:{id}:vocations`, e o script conta `HVALS` no mesmo passo em que insere —
// dois joins na última vaga da mesma vocação não passam os dois. A aprovação pré-start saiu
// (RF-07): não existe mais a chave de aprovados nem método que a alimente.
//
//   party:{id}            HASH   leaderId, mode, shareCosts, splitLoot, huntId, difficulty, createdAtMs,
//                                state ('forming'|'hunting'), sessionId, contentVersion, published,
//                                minLevel, maxLevel (legado, nunca escrito), vocationTargets (JSON,
//                                '{}' default)   TTL 30min forming / 24h hunting
//   party:{id}:members    ZSET   score = instante de entrada  → a liderança sucessória
//   party:{id}:accounts   HASH   characterId → accountId    (quem é de quem, para o ticket)
//   party:{id}:vocations  HASH   characterId → vocationId ('none' se sem vocação)   TTL da party
//   party:{id}:invites    SET    characterIds convidados      TTL curto
//   party:{id}:tickets    HASH   characterId → ticket JSON   (depois do start; cada um pega o seu)
//   party:by-char:{characterId}  STRING partyId  (um personagem está em NO MÁXIMO uma party)
//   party:rooms           SET    partyIds publicados (Encontrar Party)
//   party:invited:{characterId}  SET  partyIds que convidaram este personagem   TTL do convite
//   party:social-invite:{inviteId}  HASH  inviterCharacterId, inviterAccountId, inviterVocation,
//                                         inviteeCharacterId, createdAtMs   TTL 15 min (DT-06)
//   party:social-pending:{characterId}  SET inviteIds · TTL 15 min
//   matchmaking:queue     ZSET   score = instante de entrada; member = characterId   (#199)
//   matchmaking:{characterId}  HASH level, vocationId, accountId   TTL

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export type PartyMode = 'split' | 'shared';

/** `forming`: ainda aceitando gente. `hunting`: a sessão já nasceu e a party sobrevive (#402). */
export type PartyLifecycle = 'forming' | 'hunting';

/**
 * A chave canônica da vocação AUSENTE: personagem sem vocação (level < 8) entra e conta como
 * `none`, tanto no HASH `:vocations` quanto como chave de `vocationTargets`.
 */
export const NO_VOCATION = 'none';

/** Quanto tempo um convite social vive (DT-06). O tradicional vale 2 min; o social, 15. */
export const SOCIAL_INVITE_TTL_MS = 15 * 60_000;

/** A composição-alvo: vocação → TOTAL desejado de membros (inclui quem já está). */
export type VocationTargets = Readonly<Record<string, number>>;

export interface PartyRecord {
  readonly id: string;
  readonly leaderId: string;
  /** Espelho derivado dos dois eixos (D1), para o cliente antigo. */
  readonly mode: PartyMode;
  /** Os dois eixos do líder (ADR 0035 D1), mutáveis na hunt por `party-settings`. */
  readonly shareCosts: boolean;
  readonly splitLoot: boolean;
  readonly huntId: string | null;
  readonly difficulty: string | null;
  readonly createdAtMs: number;
  /** Na ordem de entrada. */
  readonly members: readonly string[];
  readonly accounts: Readonly<Record<string, string>>;
  /** `forming` antes do `start`; `hunting` depois — a party não some mais (#402). */
  readonly state: PartyLifecycle;
  /** A sessão hospedada, quando `hunting`. */
  readonly sessionId: string | null;
  /**
   * Quando o `start` aconteceu (#527). É contra ELE, não contra `createdAtMs` (que é de quando
   * a party começou a FORMAR), que a limpeza de uma `hunting` presa mede a carência — sem essa
   * distinção, uma party que passou minutos formando pareceria presa no instante em que acaba
   * de nascer.
   */
  readonly startedAtMs: number | null;
  /** A versão de conteúdo fixada no `start`, conferida no `/join` (invariante 7). */
  readonly contentVersion: string | null;
  /** Sala pública de "Encontrar Party" (§17–§20). */
  readonly published: boolean;
  readonly minLevel: number | null;
  /** Legado (DT-03): lido, nunca escrito — o contrato de sala não tem mais faixa máxima. */
  readonly maxLevel: number | null;
  /** A composição desejada por vocação (#501). Corrompido/ausente é `{}` — nunca recusa a leitura. */
  readonly vocationTargets: Readonly<Record<string, number>>;
}

export interface IssuedTicket {
  readonly ticket: string;
  readonly wsUrl: string;
  readonly expiresAtMs: number;
  readonly sessionId: string;
}

/** Um convite social pendente (RF-09): não depende de party pré-existente. */
export interface SocialInviteRecord {
  readonly inviteId: string;
  readonly inviterCharacterId: string;
  readonly inviterAccountId: string;
  /** A vocação canônica do convidador no instante do envio (`none` se sem vocação). */
  readonly inviterVocation: string;
  readonly inviteeCharacterId: string;
  readonly createdAtMs: number;
}

export interface PartyStoreOptions {
  /** Quanto tempo uma party espera o `start` sem ninguém mexer. Padrão: 30 min. */
  readonly ttlMs?: number;
  /** Quanto tempo um convite vale. Padrão: 2 min. */
  readonly inviteTtlMs?: number;
  readonly now?: () => number;
}

const DEFAULT_TTL_MS = 30 * 60_000;
const DEFAULT_INVITE_TTL_MS = 2 * 60_000;
/**
 * A party que virou hunt vive muito mais que o formulário: o TTL longo é o que a faz sobreviver
 * a uma hunt longa sem virar lixo permanente no Redis se a sessão nunca for reaproveitada.
 * Renovado em toda ação da party enquanto `state === 'hunting'` (ADR 0035 D7).
 */
const HUNTING_TTL_MS = 24 * 60 * 60_000;

const partyKey = (id: string): string => `party:${id}`;
const membersKey = (id: string): string => `party:${id}:members`;
const accountsKey = (id: string): string => `party:${id}:accounts`;
const invitesKey = (id: string): string => `party:${id}:invites`;
const vocationsKey = (id: string): string => `party:${id}:vocations`;
const ticketsKey = (id: string): string => `party:${id}:tickets`;
const byCharacterKey = (characterId: string): string => `party:by-char:${characterId}`;
const ROOMS_KEY = 'party:rooms';
const invitedKey = (characterId: string): string => `party:invited:${characterId}`;
const socialInviteKey = (inviteId: string): string => `party:social-invite:${inviteId}`;
const socialPendingKey = (characterId: string): string => `party:social-pending:${characterId}`;

/**
 * Entrar é um script: elegibilidade, vaga por vocação, teto e as quatro escritas acontecem no
 * MESMO passo — dois `join` na última vaga da mesma vocação não passam os dois, porque o
 * segundo conta, em `HVALS`, o `HSET` que o primeiro acabou de fazer (DT-01). Devolve 1 ao
 * entrar, 0 sem convite e sem elegibilidade pública, -1 sem vaga total, -2 já em outra party,
 * -3 party inexistente, -4 sem vaga para a vocação do candidato.
 */
const JOIN = `
if redis.call('EXISTS', KEYS[1]) ~= 1 then return -3 end
local mine = redis.call('GET', KEYS[6])
if mine and mine ~= ARGV[1] then return -2 end
if redis.call('ZSCORE', KEYS[2], ARGV[2]) then return 1 end
local invited = redis.call('SISMEMBER', KEYS[3], ARGV[2]) == 1
if not invited and ARGV[7] ~= '1' then return 0 end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then return -1 end
local voc = ARGV[8]
if not invited then
  local count = 0
  for _, v in ipairs(redis.call('HVALS', KEYS[5])) do
    if v == voc then count = count + 1 end
  end
  local target = cjson.decode(ARGV[9])[voc]
  if target == nil or count >= target then return -4 end
end
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[2])
redis.call('HSET', KEYS[4], ARGV[2], ARGV[5])
redis.call('HSET', KEYS[5], ARGV[2], voc)
redis.call('SREM', KEYS[3], ARGV[2])
redis.call('SET', KEYS[6], ARGV[1], 'PX', tonumber(ARGV[6]))
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[6]))
redis.call('PEXPIRE', KEYS[4], tonumber(ARGV[6]))
redis.call('PEXPIRE', KEYS[5], tonumber(ARGV[6]))
return 1
`;

/**
 * Reserva a vaga SEM entrar (DT-04): o `/join` em curso reserva antes de emitir o ticket, e
 * quem vier depois conta a reserva em `HVALS`. O `HSET` preserva o TTL que a chave já tem, e
 * o `PEXPIRE` cobre o caso de o hash ainda não existir. Devolve 1, -1 sem vaga total,
 * -3 party inexistente, -4 sem vaga para a vocação, -5 já é membro.
 */
const RESERVE = `
if redis.call('EXISTS', KEYS[1]) ~= 1 then return -3 end
if redis.call('ZSCORE', KEYS[2], ARGV[1]) then return -5 end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[2]) then return -1 end
if ARGV[5] ~= '1' then
  local count = 0
  for _, v in ipairs(redis.call('HVALS', KEYS[3])) do
    if v == ARGV[3] then count = count + 1 end
  end
  local target = cjson.decode(ARGV[4])[ARGV[3]]
  if target == nil or count >= target then return -4 end
end
redis.call('HSET', KEYS[3], ARGV[1], ARGV[3])
redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[6]))
return 1
`;

/**
 * O aceite do convite social é UM script (RF-09): lê o convite, resolve o que fazer com o
 * convidador — usar a party dele se ainda é o líder formando com vaga, ou CRIAR uma com ele
 * de líder —, entra o convidado e consome o convite, tudo sem que outro script intercale.
 * O `SET NX` em `party:by-char:{convidador}` é a trava: dois aceites de convites DIFERENTES do
 * mesmo convidador não criam duas parties — o que perde a corrida re-resolve e entra na party
 * que ganhou, ou recusa. O convite só é consumido no sucesso: convidado ocupado devolve -3 com
 * o convite de pé. Devolve {1, partyId} ao entrar, {2, partyId} ao criar, {-1} convite
 * inexistente/expirado/para outro, {-2} convidador indisponível, {-3} convidado em outra party.
 */
const ACCEPT_SOCIAL = `
local invite = redis.call('HMGET', KEYS[1],
  'inviterCharacterId', 'inviterAccountId', 'inviterVocation', 'inviteeCharacterId')
local inviter = invite[1]
local invitee = invite[4]
if not inviter or not invite[2] or not invite[3] or invitee ~= ARGV[8] then return {-1} end
local mine = redis.call('GET', KEYS[4])
if mine then
  if redis.call('EXISTS', 'party:' .. mine) ~= 1 then
    redis.call('DEL', KEYS[4])
  else
    return {-3}
  end
end
local partyId = false
local created = 1
local pointer = redis.call('GET', KEYS[3])
if pointer and redis.call('EXISTS', 'party:' .. pointer) ~= 1 then
  redis.call('DEL', KEYS[3])
  pointer = false
end
if pointer then
  if redis.call('HGET', 'party:' .. pointer, 'leaderId') ~= inviter
    or redis.call('HGET', 'party:' .. pointer, 'state') ~= 'forming'
    or redis.call('ZCARD', 'party:' .. pointer .. ':members') >= tonumber(ARGV[4]) then
    return {-2}
  end
  partyId = pointer
elseif redis.call('SET', KEYS[3], ARGV[2], 'PX', tonumber(ARGV[3]), 'NX') then
  partyId = ARGV[2]
  created = 2
  redis.call('HSET', 'party:' .. partyId, 'leaderId', inviter, 'mode', 'split', 'shareCosts', '0',
    'splitLoot', '0', 'createdAtMs', ARGV[7], 'state', 'forming', 'published', '0', 'vocationTargets', '{}')
  -- O convidador entra um instante ANTES do convidado: a sucessória (o mais antigo lidera)
  -- não pode depender da ordem lexicográfica dos ids quando os dois entram no mesmo passo.
  redis.call('ZADD', 'party:' .. partyId .. ':members', ARGV[7] - 1, inviter)
  redis.call('HSET', 'party:' .. partyId .. ':accounts', inviter, invite[2])
  redis.call('HSET', 'party:' .. partyId .. ':vocations', inviter, invite[3])
  redis.call('PEXPIRE', 'party:' .. partyId, tonumber(ARGV[3]))
  redis.call('PEXPIRE', 'party:' .. partyId .. ':members', tonumber(ARGV[3]))
  redis.call('PEXPIRE', 'party:' .. partyId .. ':accounts', tonumber(ARGV[3]))
  redis.call('PEXPIRE', 'party:' .. partyId .. ':vocations', tonumber(ARGV[3]))
else
  pointer = redis.call('GET', KEYS[3])
  if not pointer
    or redis.call('EXISTS', 'party:' .. pointer) ~= 1
    or redis.call('HGET', 'party:' .. pointer, 'leaderId') ~= inviter
    or redis.call('HGET', 'party:' .. pointer, 'state') ~= 'forming'
    or redis.call('ZCARD', 'party:' .. pointer .. ':members') >= tonumber(ARGV[4]) then
    return {-2}
  end
  partyId = pointer
end
redis.call('ZADD', 'party:' .. partyId .. ':members', ARGV[7], invitee)
redis.call('HSET', 'party:' .. partyId .. ':accounts', invitee, ARGV[5])
redis.call('HSET', 'party:' .. partyId .. ':vocations', invitee, ARGV[6])
redis.call('SET', KEYS[4], partyId, 'PX', tonumber(ARGV[3]))
redis.call('PEXPIRE', 'party:' .. partyId, tonumber(ARGV[3]))
redis.call('PEXPIRE', 'party:' .. partyId .. ':members', tonumber(ARGV[3]))
redis.call('PEXPIRE', 'party:' .. partyId .. ':accounts', tonumber(ARGV[3]))
redis.call('PEXPIRE', 'party:' .. partyId .. ':vocations', tonumber(ARGV[3]))
redis.call('SREM', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[1])
return {created, partyId}
`;

const queueKey = 'matchmaking:queue';
const queuedKey = (characterId: string): string => `matchmaking:${characterId}`;
const QUEUE_TTL_MS = 10 * 60_000;

/**
 * O casamento (#199, §15.2) é UM script: lê a fila, filtra pela faixa de level e por quem
 * ainda está livre, escolhe até `max − 1` companheiros preferindo VOCAÇÕES DISTINTAS — é o
 * que o bônus de XP premia — e os TIRA da fila no mesmo passo. Dois `join` no mesmo instante
 * não formam duas parties com o mesmo personagem porque só um deles encontra o outro na fila.
 * Devolve a lista `[characterId, accountId, vocationId, ...]` do grupo (quem chamou incluído) —
 * a vocação é o que `enqueue` precisa para criar a party com o líder já no HASH `:vocations` —
 * ou vazio.
 */
const MATCH = `
local me = ARGV[1]
local level = tonumber(ARGV[2])
local vocation = ARGV[3]
local range = tonumber(ARGV[4])
local max = tonumber(ARGV[5])
local queued = redis.call('ZRANGE', KEYS[1], 0, -1)
local seen = {}
seen[vocation] = true
local candidates = {}
for _, other in ipairs(queued) do
  if other ~= me then
    local info = redis.call('HMGET', 'matchmaking:' .. other, 'level', 'vocationId', 'accountId')
    local free = redis.call('EXISTS', 'party:by-char:' .. other) == 0
    if info[1] and free and (range == 0 or math.abs(tonumber(info[1]) - level) <= range) then
      table.insert(candidates, { id = other, vocation = info[2] or '', account = info[3] or '' })
    end
  end
end
if #candidates == 0 then return {} end
local chosen = {}
for _, c in ipairs(candidates) do
  if #chosen >= max - 1 then break end
  if not seen[c.vocation] then seen[c.vocation] = true; table.insert(chosen, c) end
end
for _, c in ipairs(candidates) do
  if #chosen >= max - 1 then break end
  local already = false
  for _, d in ipairs(chosen) do if d.id == c.id then already = true end end
  if not already then table.insert(chosen, c) end
end
local out = {}
redis.call('ZREM', KEYS[1], me)
redis.call('DEL', 'matchmaking:' .. me)
for _, c in ipairs(chosen) do
  redis.call('ZREM', KEYS[1], c.id)
  redis.call('DEL', 'matchmaking:' .. c.id)
  table.insert(out, c.id)
  table.insert(out, c.account)
  table.insert(out, c.vocation)
end
return out
`;

/**
 * `vocationTargets` corrompido/ausente é `{}` — AUSENTE, nunca leitura recusada: a mesma
 * régua de outfit/bestiary/bot-config. Números que não são números finitos saem fora.
 */
function parseTargets(raw: string | undefined): Readonly<Record<string, number>> {
  if (raw === undefined || raw === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** O que a rota passa ao `join`: teto do conteúdo, vocação canônica e composição da party. */
export interface PartyJoinOptions {
  readonly maxMembers: number;
  /** Vocação canônica do candidato (`none` quando não tem — level < 8). */
  readonly vocation: string;
  /** A composição-alvo da party, como está no hash dela. */
  readonly targets: Readonly<Record<string, number>>;
  /** Elegível pela sala publicada (publicada e level ≥ minLevel): prescinde de convite. */
  readonly publicEligible: boolean;
}

export type PartyJoinOutcome =
  | 'joined'
  /** Não convidado e não elegível — a corrida entre a checagem da rota e o script. */
  | 'room-not-eligible'
  | 'full'
  | 'in-another-party'
  | 'not-found'
  | 'no-vocation-slot';

/** O resultado da reserva de vaga do `/join` em curso (DT-04). */
export type SlotReservation =
  | 'reserved'
  | 'full'
  | 'not-found'
  | 'no-vocation-slot'
  | 'already-member';

/** O resultado do aceite do convite social (RF-09). */
export type SocialAcceptance =
  | { readonly kind: 'entered'; readonly party: PartyRecord }
  | { readonly kind: 'created'; readonly party: PartyRecord }
  | 'not-found'
  | 'inviter-unavailable'
  | 'in-another-party';

/** O patch de configuração do líder (RF-02): cada eixo muda sozinho, o ausente fica. */
export interface PartyConfiguration {
  readonly huntId?: string | undefined;
  readonly difficulty?: string | undefined;
  readonly minLevel?: number | undefined;
  readonly vocationTargets?: Readonly<Record<string, number>> | undefined;
  readonly shareCosts?: boolean | undefined;
  readonly splitLoot?: boolean | undefined;
}

export class PartyStore {
  readonly #redis: Redis;
  readonly #ttlMs: number;
  readonly #inviteTtlMs: number;
  readonly #now: () => number;

  constructor(redis: Redis, options: PartyStoreOptions = {}) {
    this.#redis = redis;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#inviteTtlMs = options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#redis.defineCommand('joinParty', { numberOfKeys: 6, lua: JOIN });
    this.#redis.defineCommand('reserveSlot', { numberOfKeys: 3, lua: RESERVE });
    this.#redis.defineCommand('acceptSocialInvite', { numberOfKeys: 4, lua: ACCEPT_SOCIAL });
    this.#redis.defineCommand('matchParty', { numberOfKeys: 1, lua: MATCH });
  }

  /**
   * Entra na fila de matchmaking (#199) e tenta casar AGORA. Devolve a party formada, ou
   * `null` se ficou esperando. Quem já está numa party não entra na fila.
   */
  async enqueue(
    characterId: string, accountId: string, level: number, vocationId: string | null,
    range: number, maxMembers: number,
  ): Promise<PartyRecord | null | 'in-party'> {
    if (await this.#redis.exists(byCharacterKey(characterId)) === 1) return 'in-party';
    await this.#redis.multi()
      .zadd(queueKey, String(this.#now()), characterId)
      .hset(queuedKey(characterId), { level: String(level), vocationId: vocationId ?? '', accountId })
      .pexpire(queuedKey(characterId), QUEUE_TTL_MS)
      .exec();
    const redis = this.#redis as Redis & {
      matchParty(queue: string, me: string, level: string, vocation: string, range: string, max: string): Promise<string[]>;
    };
    const matched = await redis.matchParty(queueKey, characterId, String(level), vocationId ?? '', String(range), String(maxMembers));
    if (matched.length === 0) return null;
    // O grupo saiu da fila junto; agora vira party — o mais antigo lidera, e é quem chamou
    // por último quem a monta, com os que o script escolheu (todos livres, conferido ali).
    // O script devolve TRÊS por companheiro desde a #501: o `create` precisa da vocação do
    // líder para inscri-lo no HASH `:vocations` — senão a composição não o conta.
    const others: Array<{ characterId: string; accountId: string; vocation: string | null }> = [];
    for (let i = 0; i + 2 < matched.length; i += 3) {
      const vocation = matched[i + 2];
      others.push({
        characterId: matched[i] as string,
        accountId: matched[i + 1] as string,
        vocation: vocation === '' || vocation === undefined ? null : vocation,
      });
    }
    const leader = others[0] ?? { characterId, accountId, vocation: vocationId };
    const party = leader.characterId === characterId
      ? await this.create(characterId, accountId, vocationId)
      : await this.create(leader.characterId, leader.accountId, leader.vocation);
    if (party === null) return null;
    const members = leader.characterId === characterId
      ? others
      : [{ characterId, accountId, vocation: vocationId }, ...others.slice(1)];
    for (const member of members) {
      await this.invite(party.id, member.characterId);
      await this.join(party.id, member.characterId, member.accountId, {
        maxMembers, vocation: member.vocation ?? NO_VOCATION,
        targets: party.vocationTargets, publicEligible: false,
      });
    }
    return this.get(party.id);
  }

  async dequeue(characterId: string): Promise<void> {
    await this.#redis.multi().zrem(queueKey, characterId).del(queuedKey(characterId)).exec();
  }

  async queued(characterId: string): Promise<boolean> {
    return (await this.#redis.zscore(queueKey, characterId)) !== null;
  }

  /** Cria a party com o líder dentro. `null` se ele já está numa. */
  async create(leaderId: string, accountId: string, leaderVocation: string | null): Promise<PartyRecord | null> {
    const id = randomUUID();
    const now = this.#now();
    // `SET NX`: o personagem só entra numa party se não está em nenhuma.
    const claimed = await this.#redis.set(byCharacterKey(leaderId), id, 'PX', String(this.#ttlMs), 'NX');
    if (claimed !== 'OK') return null;
    await this.#redis.multi()
      .hset(partyKey(id), {
        leaderId, mode: 'split', shareCosts: '0', splitLoot: '0', createdAtMs: String(now),
        state: 'forming', published: '0', vocationTargets: '{}',
      })
      .pexpire(partyKey(id), this.#ttlMs)
      .zadd(membersKey(id), String(now), leaderId)
      .pexpire(membersKey(id), this.#ttlMs)
      .hset(accountsKey(id), leaderId, accountId)
      .pexpire(accountsKey(id), this.#ttlMs)
      .hset(vocationsKey(id), leaderId, leaderVocation ?? NO_VOCATION)
      .pexpire(vocationsKey(id), this.#ttlMs)
      .exec();
    return this.get(id);
  }

  async get(id: string): Promise<PartyRecord | null> {
    const [hash, members, accounts] = await Promise.all([
      this.#redis.hgetall(partyKey(id)),
      this.#redis.zrange(membersKey(id), '0', '-1'),
      this.#redis.hgetall(accountsKey(id)),
    ]);
    if (hash['leaderId'] === undefined) return null;
    const mode = hash['mode'] === 'shared' ? 'shared' : 'split';
    return {
      id,
      leaderId: hash['leaderId'],
      mode,
      // Ausente é party criada por um `api` anterior ao #400: migra de `mode` (D1), a mesma
      // tabela do snapshot antigo.
      shareCosts: hash['shareCosts'] === undefined ? mode === 'shared' : hash['shareCosts'] === '1',
      splitLoot: hash['splitLoot'] === undefined ? mode === 'shared' : hash['splitLoot'] === '1',
      huntId: hash['huntId'] ?? null,
      difficulty: hash['difficulty'] ?? null,
      createdAtMs: Number(hash['createdAtMs'] ?? 0),
      members,
      accounts,
      // Um `api` anterior ao #402 não grava `state`: a party é `forming` por definição.
      state: hash['state'] === 'hunting' ? 'hunting' : 'forming',
      sessionId: hash['sessionId'] ?? null,
      startedAtMs: hash['startedAtMs'] === undefined ? null : Number(hash['startedAtMs']),
      contentVersion: hash['contentVersion'] ?? null,
      published: hash['published'] === '1',
      minLevel: hash['minLevel'] === undefined ? null : Number(hash['minLevel']),
      maxLevel: hash['maxLevel'] === undefined ? null : Number(hash['maxLevel']),
      vocationTargets: parseTargets(hash['vocationTargets']),
    };
  }

  /** A party deste personagem, se está em alguma. */
  async of(characterId: string): Promise<PartyRecord | null> {
    const id = await this.#redis.get(byCharacterKey(characterId));
    if (id === null) return null;
    const party = await this.get(id);
    // Ponteiro para party que expirou: limpa na leitura, como o índice de extratos.
    if (party === null) await this.#redis.del(byCharacterKey(characterId));
    return party;
  }

  async invite(id: string, characterId: string): Promise<void> {
    await this.#redis.multi()
      .sadd(invitesKey(id), characterId)
      .pexpire(invitesKey(id), this.#inviteTtlMs)
      // O índice REVERSO (#402, D8): é ele que faz o convidado ver o convite em `/mine` sem
      // saber o `partyId` de antemão. Mesma transação, mesmo TTL do convite.
      .sadd(invitedKey(characterId), id)
      .pexpire(invitedKey(characterId), this.#inviteTtlMs)
      .exec();
    await this.#renewIfHunting(id);
  }

  /** O convite está pendente? A pergunta que `/join` faz antes de qualquer coisa (#402). */
  async isInvited(id: string, characterId: string): Promise<boolean> {
    return (await this.#redis.sismember(invitesKey(id), characterId)) === 1;
  }

  /** Recusa o convite (#402, D8): some dos DOIS índices — o da party e o reverso. */
  async decline(id: string, characterId: string): Promise<void> {
    await this.#redis.multi()
      .srem(invitesKey(id), characterId)
      .srem(invitedKey(characterId), id)
      .exec();
    await this.#renewIfHunting(id);
  }

  /**
   * Os convites pendentes deste personagem (#402, D8), podando o índice reverso de quem já não
   * convida mais: convite que EXPIROU some em silêncio, como o `party:{id}:invites` de hoje.
   */
  async invitesOf(characterId: string): Promise<readonly string[]> {
    const ids = await this.#redis.smembers(invitedKey(characterId));
    const alive: string[] = [];
    for (const id of ids) if (await this.isInvited(id, characterId)) alive.push(id);
    const gone = ids.filter((id) => !alive.includes(id));
    if (gone.length > 0) await this.#redis.srem(invitedKey(characterId), ...gone);
    return alive;
  }

  /**
   * Grava o convite social (RF-09): o HASH `party:social-invite:{id}` e o índice pendente do
   * convidado, ambos com o TTL de 15 min (DT-06). A resolução acontece só no aceite, em Lua —
   * aqui não existe party nenhuma para apontar.
   */
  async createSocialInvite(invite: {
    inviteId: string;
    inviterCharacterId: string;
    inviterAccountId: string;
    inviterVocation: string | null;
    inviteeCharacterId: string;
  }): Promise<void> {
    const now = this.#now();
    await this.#redis.multi()
      .hset(socialInviteKey(invite.inviteId), {
        inviterCharacterId: invite.inviterCharacterId,
        inviterAccountId: invite.inviterAccountId,
        inviterVocation: invite.inviterVocation ?? NO_VOCATION,
        inviteeCharacterId: invite.inviteeCharacterId,
        createdAtMs: String(now),
      })
      .pexpire(socialInviteKey(invite.inviteId), SOCIAL_INVITE_TTL_MS)
      .sadd(socialPendingKey(invite.inviteeCharacterId), invite.inviteId)
      .pexpire(socialPendingKey(invite.inviteeCharacterId), SOCIAL_INVITE_TTL_MS)
      .exec();
  }

  /**
   * Os convites sociais pendentes do convidado (RF-09, DT-06), podando os expirados como
   * `invitesOf` poda os tradicionais: convite que o TTL apagou some do índice na leitura.
   */
  async socialInvitesOf(characterId: string): Promise<readonly SocialInviteRecord[]> {
    const ids = await this.#redis.smembers(socialPendingKey(characterId));
    const alive: SocialInviteRecord[] = [];
    for (const inviteId of ids) {
      const raw = await this.#redis.hgetall(socialInviteKey(inviteId));
      if (raw['inviterCharacterId'] === undefined) continue;
      alive.push({
        inviteId,
        inviterCharacterId: raw['inviterCharacterId'],
        inviterAccountId: raw['inviterAccountId'] ?? '',
        inviterVocation: raw['inviterVocation'] ?? NO_VOCATION,
        inviteeCharacterId: raw['inviteeCharacterId'] ?? characterId,
        createdAtMs: Number(raw['createdAtMs'] ?? 0),
      });
    }
    const gone = ids.filter((id) => !alive.some((invite) => invite.inviteId === id));
    if (gone.length > 0) await this.#redis.srem(socialPendingKey(characterId), ...gone);
    return alive;
  }

  /**
   * O aceite (RF-09) é UM script: usa a party do convidador se ele ainda a lidera formando
   * com vaga, cria uma com ele de líder se não tem, recusa com erro tipado nos outros casos —
   * e consome o convite só no sucesso. A party nova nasce com o convidador de líder, os dois
   * no roster e a vocação de cada um no HASH `:vocations`.
   */
  async acceptSocialInvite(params: {
    inviteId: string;
    inviteeCharacterId: string;
    inviteeAccountId: string;
    inviteeVocation: string | null;
    maxMembers: number;
  }): Promise<SocialAcceptance> {
    // O id do convidador só existe dentro do convite, e as KEYS precisam dele; é imutável
    // (escrito uma vez no envio), então ler antes não abre corrida — o script reconferiria
    // tudo do mesmo jeito.
    const inviterCharacterId = await this.#redis.hget(socialInviteKey(params.inviteId), 'inviterCharacterId');
    if (inviterCharacterId === null) return 'not-found';
    const redis = this.#redis as Redis & {
      acceptSocialInvite(
        inviteKey: string, pendingIdx: string, byCharInviter: string, byCharInvitee: string,
        inviteId: string, newPartyId: string, ttl: string, max: string,
        inviteeAccountId: string, inviteeVocation: string, now: string, inviteeCharacterId: string,
      ): Promise<[number, string]>;
    };
    const result = await redis.acceptSocialInvite(
      socialInviteKey(params.inviteId), socialPendingKey(params.inviteeCharacterId),
      byCharacterKey(inviterCharacterId), byCharacterKey(params.inviteeCharacterId),
      params.inviteId, randomUUID(), String(this.#ttlMs), String(params.maxMembers),
      params.inviteeAccountId, params.inviteeVocation ?? NO_VOCATION, String(this.#now()),
      params.inviteeCharacterId,
    );
    const [code, partyId] = result;
    if (code === -1 || code === -2 || code === -3 || partyId === undefined) {
      if (code === -2) return 'inviter-unavailable';
      if (code === -3) return 'in-another-party';
      return 'not-found';
    }
    const party = await this.get(partyId);
    if (party === null) return 'not-found';
    return { kind: code === 2 ? 'created' : 'entered', party };
  }

  /**
   * Membro que não está mais na sessão viva sai do ZSET — a poda da lotação viva (#402). Só
   * dele: o ZSET é a lista de membros FORMADA; a saída também solta a vaga por vocação
   * (#501) — sair REABRE a vaga enquanto a sala continuar publicada.
   */
  async prune(id: string, characterId: string): Promise<void> {
    await this.#redis.multi()
      .zrem(membersKey(id), characterId)
      .hdel(vocationsKey(id), characterId)
      .exec();
  }

  /**
   * Inscreve um membro JÁ admitido numa party em curso (#402). A reserva da vaga (DT-04) já
   * escreveu a vocação dele no HASH `:vocations`; aqui entra no roster — o ZSET, as contas e
   * o ponteiro — para `liveMembers` e `rooms` contarem de verdade quem entreu depois do start.
   */
  async enroll(id: string, characterId: string, accountId: string): Promise<void> {
    await this.#redis.multi()
      .zadd(membersKey(id), String(this.#now()), characterId)
      .hset(accountsKey(id), characterId, accountId)
      .set(byCharacterKey(characterId), id, 'PX', String(HUNTING_TTL_MS))
      .pexpire(membersKey(id), HUNTING_TTL_MS)
      .pexpire(accountsKey(id), HUNTING_TTL_MS)
      .exec();
  }

  /**
   * O líder configura a sala (RF-02). Patch PARCIAL: cada eixo muda sozinho, e só o que veio
   * no corpo é escrito. `mode` continua sendo o espelho derivado (D1) para o cliente antigo.
   */
  async configure(id: string, patch: PartyConfiguration): Promise<void> {
    const fields: Record<string, string> = {};
    if (patch.huntId !== undefined) fields['huntId'] = patch.huntId;
    if (patch.difficulty !== undefined) fields['difficulty'] = patch.difficulty;
    if (patch.minLevel !== undefined) fields['minLevel'] = String(patch.minLevel);
    if (patch.vocationTargets !== undefined) fields['vocationTargets'] = JSON.stringify(patch.vocationTargets);
    if (patch.shareCosts !== undefined) fields['shareCosts'] = patch.shareCosts ? '1' : '0';
    if (patch.splitLoot !== undefined) fields['splitLoot'] = patch.splitLoot ? '1' : '0';
    if (patch.shareCosts !== undefined || patch.splitLoot !== undefined) {
      const current = await this.get(id);
      const shareCosts = patch.shareCosts ?? current?.shareCosts ?? false;
      const splitLoot = patch.splitLoot ?? current?.splitLoot ?? false;
      fields['mode'] = shareCosts && splitLoot ? 'shared' : 'split';
    }
    await this.#redis.multi().hset(partyKey(id), fields).exec();
    // Em formação, mexer na configuração é sinal de vida (como o `propose` antigo); em hunt,
    // o TTL longo é RENOVADO, nunca rebaixado para o prazo do formulário.
    if (await this.#redis.hget(partyKey(id), 'state') === 'hunting') await this.#renewIfHunting(id);
    else await this.#redis.multi()
      .pexpire(partyKey(id), this.#ttlMs)
      .pexpire(membersKey(id), this.#ttlMs)
      .pexpire(accountsKey(id), this.#ttlMs)
      .pexpire(vocationsKey(id), this.#ttlMs)
      .exec();
  }

  /**
   * Publica a sala (RF-03): exige hunt+difficulty, `minLevel` e PELO MENOS UMA vaga pública
   * pela composição configurada. O `minLevel` vem do `configure` — publicar não recebe corpo.
   */
  async publish(
    id: string,
  ): Promise<'published' | 'not-found' | 'nothing-proposed' | 'not-configured' | 'no-vocation-slot'> {
    const party = await this.get(id);
    if (party === null) return 'not-found';
    if (party.huntId === null || party.difficulty === null) return 'nothing-proposed';
    if (party.minLevel === null || party.minLevel < 1) return 'not-configured';
    const open = await this.openSlots(id, party.vocationTargets);
    if (!Object.values(open).some((slots) => slots > 0)) return 'no-vocation-slot';
    await this.#redis.multi()
      .hset(partyKey(id), { published: '1' })
      .sadd(ROOMS_KEY, id)
      .exec();
    await this.#renewIfHunting(id);
    return 'published';
  }

  async unpublish(id: string): Promise<void> {
    await this.#redis.multi().hset(partyKey(id), { published: '0' }).srem(ROOMS_KEY, id).exec();
  }

  /**
   * As salas publicadas, com poda de quem já não é `published` — o Redis não garante consistência
   * do SET, e uma party que `unpublish`ou ou expirou não pode aparecer.
   */
  async rooms(): Promise<PartyRecord[]> {
    const ids = await this.#redis.smembers(ROOMS_KEY);
    const parties = await Promise.all(ids.map((id) => this.get(id)));
    const stale = ids.filter((id, index) => parties[index] === null || parties[index]?.published === false);
    if (stale.length > 0) await this.#redis.srem(ROOMS_KEY, ...stale);
    return parties.filter((party): party is PartyRecord => party !== null && party.published);
  }

  /**
   * As vagas abertas por vocação, contadas do HASH `:vocations` — a MESMA fonte que os dois
   * Lua de join contam. Nunca negativo: composição abaixo da ocupação FECHA a vaga, não
   * expulsa ninguém.
   */
  async openSlots(id: string, targets: Readonly<Record<string, number>>): Promise<Record<string, number>> {
    const roster = await this.#redis.hgetall(vocationsKey(id));
    const counts: Record<string, number> = {};
    for (const vocation of Object.values(roster)) counts[vocation] = (counts[vocation] ?? 0) + 1;
    const open: Record<string, number> = {};
    for (const [vocation, target] of Object.entries(targets)) {
      open[vocation] = Math.max(0, target - (counts[vocation] ?? 0));
    }
    return open;
  }

  /**
   * Entra na party FORMANDO. Convidado passa livre da composição (convite é decisão
   * explícita, #499 §3); quem vem pela sala publicada tem de caber na vocação dele — e o Lua
   * conta as vocações dos membros DENTRO do script (DT-01), então dois joins concorrentes na
   * última vaga se resolvem na serialização do Redis.
   */
  async join(id: string, characterId: string, accountId: string, options: PartyJoinOptions): Promise<PartyJoinOutcome> {
    const redis = this.#redis as Redis & {
      joinParty(
        party: string, members: string, invites: string, accounts: string, vocations: string, byChar: string,
        partyId: string, characterId: string, max: string, score: string, accountId: string, ttl: string,
        publicEligible: string, candidateVocation: string, targetsJson: string,
      ): Promise<number>;
    };
    const result = await redis.joinParty(
      partyKey(id), membersKey(id), invitesKey(id), accountsKey(id), vocationsKey(id),
      byCharacterKey(characterId),
      id, characterId, String(options.maxMembers), String(this.#now()), accountId, String(this.#ttlMs),
      options.publicEligible ? '1' : '0', options.vocation, JSON.stringify(options.targets),
    );
    switch (result) {
      case 1: return 'joined';
      case 0: return 'room-not-eligible';
      case -1: return 'full';
      case -2: return 'in-another-party';
      case -4: return 'no-vocation-slot';
      default: return 'not-found';
    }
  }

  /**
   * Reserva a vaga SEM entrar (DT-04): o `/join` em curso chama isto antes de emitir o
   * ticket, e quem vier depois conta a reserva em `HVALS` — a vaga não pode ser vendida duas
   * vezes na janela entre a reserva e a inscrição.
   */
  async reserveSlot(
    id: string, characterId: string,
    options: { maxMembers: number; vocation: string | null; targets: Readonly<Record<string, number>>; invited: boolean },
  ): Promise<SlotReservation> {
    const redis = this.#redis as Redis & {
      reserveSlot(
        party: string, members: string, vocations: string,
        characterId: string, max: string, vocation: string, targetsJson: string, invited: string, ttl: string,
      ): Promise<number>;
    };
    const result = await redis.reserveSlot(
      partyKey(id), membersKey(id), vocationsKey(id),
      characterId, String(options.maxMembers), options.vocation ?? NO_VOCATION,
      JSON.stringify(options.targets), options.invited ? '1' : '0', String(HUNTING_TTL_MS),
    );
    switch (result) {
      case 1: return 'reserved';
      case -1: return 'full';
      case -4: return 'no-vocation-slot';
      case -5: return 'already-member';
      default: return 'not-found';
    }
  }

  /** Solta a vaga reservada (DT-04): o rollback do `/join` em curso que falhou após reservar. */
  async releaseSlot(id: string, characterId: string): Promise<void> {
    await this.#redis.hdel(vocationsKey(id), characterId);
  }

  /**
   * Sai. O líder que sai passa a liderança ao mais antigo; a party vazia some. A vaga por
   * vocação de quem sai REABRE (`HDEL :vocations`) enquanto a sala continuar publicada.
   */
  async leave(id: string, characterId: string): Promise<PartyRecord | null> {
    const party = await this.get(id);
    if (party === null) return null;
    if (!party.members.includes(characterId)) return party;
    const remaining = party.members.filter((member) => member !== characterId);
    const multi = this.#redis.multi()
      .zrem(membersKey(id), characterId)
      .hdel(accountsKey(id), characterId)
      .hdel(vocationsKey(id), characterId)
      .del(byCharacterKey(characterId));
    if (remaining.length === 0) {
      await multi
        .del(partyKey(id), membersKey(id), accountsKey(id), invitesKey(id), ticketsKey(id), vocationsKey(id))
        .srem(ROOMS_KEY, id)
        .exec();
      return null;
    }
    if (party.leaderId === characterId) multi.hset(partyKey(id), 'leaderId', remaining[0] as string);
    await multi.exec();
    return this.get(id);
  }

  /**
   * O líder remove outro membro (#358, R3-08) — não é o próprio saindo, é decisão do líder. O
   * efeito na composição é o MESMO de uma saída voluntária (reabre a vaga da vocação): `kick`
   * só acrescenta QUEM pode pedir isso e NUNCA contra o próprio líder — para isso já existe
   * `leave`. A validação mora aqui, e não na rota, porque as três checagens (líder,
   * não-si-mesmo, é membro) precisam do MESMO `get()` que `leave` já faria por dentro; fazer a
   * checagem na rota duplicaria a leitura do Redis para nada.
   */
  async kick(
    id: string, leaderId: string, targetId: string,
  ): Promise<PartyRecord | 'not-found' | 'not-leader' | 'cannot-kick-self' | 'target-not-a-member'> {
    const party = await this.get(id);
    if (party === null) return 'not-found';
    if (party.leaderId !== leaderId) return 'not-leader';
    if (targetId === leaderId) return 'cannot-kick-self';
    if (!party.members.includes(targetId)) return 'target-not-a-member';
    return (await this.leave(id, targetId)) ?? party;
  }

  /**
   * O `start` aconteceu: a party vira `hunting` e SOBREVIVE (#402) — antes ela era apagada aqui.
   * O ticket de cada membro continua de uso único (`takeTicket`); o ponteiro `by-char` agora
   * fica, com o TTL longo, e é ele que faz `/mine` continuar respondendo.
   */
  async started(
    id: string, sessionId: string, contentVersion: string,
    tickets: Readonly<Record<string, IssuedTicket>>, ticketTtlMs: number,
  ): Promise<void> {
    const multi = this.#redis.multi();
    for (const [characterId, ticket] of Object.entries(tickets)) {
      multi.hset(ticketsKey(id), characterId, JSON.stringify(ticket));
      multi.pexpire(byCharacterKey(characterId), HUNTING_TTL_MS);
    }
    multi.pexpire(ticketsKey(id), ticketTtlMs);
    multi.hset(partyKey(id), {
      state: 'hunting', sessionId, contentVersion, startedAtMs: String(this.#now()),
    });
    multi.pexpire(partyKey(id), HUNTING_TTL_MS);
    multi.pexpire(membersKey(id), HUNTING_TTL_MS);
    multi.pexpire(accountsKey(id), HUNTING_TTL_MS);
    multi.pexpire(vocationsKey(id), HUNTING_TTL_MS);
    multi.del(invitesKey(id));
    await multi.exec();
  }

  /** O ticket some ao ser pego (uso único); o PONTEIRO para a party continua (#402). */
  async takeTicket(characterId: string): Promise<IssuedTicket | null> {
    const id = await this.#redis.get(byCharacterKey(characterId));
    if (id === null) return null;
    const raw = await this.#redis.hget(ticketsKey(id), characterId);
    if (raw === null) return null;
    await this.#redis.hdel(ticketsKey(id), characterId);
    try {
      return JSON.parse(raw) as IssuedTicket;
    } catch {
      return null;
    }
  }

  /**
   * Renova o TTL longo de uma party que virou hunt (#402, D7). Chamado por `invite`, `decline`
   * e `publish`; `join`/`prune` não mexem nas chaves do formulário. Um `HGET` por ação — barato,
   * e é o que mantém a party viva enquanto alguém interage com ela.
   */
  async #renewIfHunting(id: string): Promise<void> {
    if (await this.#redis.hget(partyKey(id), 'state') !== 'hunting') return;
    const members = await this.#redis.zrange(membersKey(id), '0', '-1');
    const multi = this.#redis.multi()
      .pexpire(partyKey(id), HUNTING_TTL_MS)
      .pexpire(membersKey(id), HUNTING_TTL_MS)
      .pexpire(accountsKey(id), HUNTING_TTL_MS)
      .pexpire(vocationsKey(id), HUNTING_TTL_MS);
    for (const member of members) multi.pexpire(byCharacterKey(member), HUNTING_TTL_MS);
    await multi.exec();
  }

  /**
   * Desfaz a party inteira (o `start` falhou no meio, ou o líder desistiu).
   *
   * `members`, quando vem, é a lista a limpar — e não a do ZSET agora. Existe para o disband de
   * uma `hunting` presa (#527): `liveMembers` já PODA do ZSET quem não está mais vivo antes de
   * `disbandIfDead` decidir remover a party inteira, e por padrão esta função lê o ZSET DEPOIS
   * dessa poda — com todo mundo podado, ele está vazio, e `party:by-char` de cada um sobreviveria
   * pelo TTL de 24h mesmo com a party já apagada. Ausente: o comportamento de sempre, lido do
   * ZSET como está (o `start` que falhou não podou ninguém).
   */
  async remove(id: string, members?: readonly string[]): Promise<void> {
    const roster = members ?? await this.#redis.zrange(membersKey(id), '0', '-1');
    const multi = this.#redis.multi();
    for (const member of roster) multi.del(byCharacterKey(member));
    multi.del(
      partyKey(id), membersKey(id), accountsKey(id), invitesKey(id), vocationsKey(id), ticketsKey(id),
    );
    multi.srem(ROOMS_KEY, id);
    await multi.exec();
  }
}