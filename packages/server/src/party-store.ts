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
//   party:{id}            HASH   leaderId, mode, shareCosts, splitLoot, huntId, difficulty, createdAtMs,
//                                state ('forming'|'hunting'), sessionId, contentVersion, published,
//                                minLevel, maxLevel   TTL
//   party:{id}:members    ZSET   score = instante de entrada  → a liderança sucessória
//   party:{id}:accounts   HASH   characterId → accountId    (quem é de quem, para o ticket)
//   party:{id}:invites    SET    characterIds convidados      TTL curto
//   party:{id}:approved   SET    quem aprovou a proposta atual
//   party:{id}:tickets    HASH   characterId → ticket JSON   (depois do start; cada um pega o seu)
//   party:by-char:{characterId}  STRING partyId  (um personagem está em NO MÁXIMO uma party)
//   party:rooms           SET    partyIds publicados (Encontrar Party)
//   party:invited:{characterId}  SET  partyIds que convidaram este personagem   TTL do convite
//   matchmaking:queue     ZSET   score = instante de entrada; member = characterId   (#199)
//   matchmaking:{characterId}  HASH level, vocationId, accountId   TTL

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export type PartyMode = 'split' | 'shared';

/** `forming`: ainda aceitando gente. `hunting`: a sessão já nasceu e a party sobrevive (#402). */
export type PartyLifecycle = 'forming' | 'hunting';

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
  readonly approved: readonly string[];
  readonly accounts: Readonly<Record<string, string>>;
  /** `forming` antes do `start`; `hunting` depois — a party não some mais (#402). */
  readonly state: PartyLifecycle;
  /** A sessão hospedada, quando `hunting`. */
  readonly sessionId: string | null;
  /** A versão de conteúdo fixada no `start`, conferida no `/join` (invariante 7). */
  readonly contentVersion: string | null;
  /** Sala pública de "Encontrar Party" (§17–§20). */
  readonly published: boolean;
  readonly minLevel: number | null;
  readonly maxLevel: number | null;
}

export interface IssuedTicket {
  readonly ticket: string;
  readonly wsUrl: string;
  readonly expiresAtMs: number;
  readonly sessionId: string;
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
const approvedKey = (id: string): string => `party:${id}:approved`;
const ticketsKey = (id: string): string => `party:${id}:tickets`;
const byCharacterKey = (characterId: string): string => `party:by-char:${characterId}`;
const ROOMS_KEY = 'party:rooms';
const invitedKey = (characterId: string): string => `party:invited:${characterId}`;

/**
 * Entrar é um script: "está convidado, não está em outra party, há vaga" e o SADD acontecem
 * no mesmo passo — dois `join` no último lugar não podem passar os dois. Devolve 1 ao entrar,
 * 0 sem convite, -1 sem vaga, -2 já em outra party, -3 party inexistente.
 */
const JOIN = `
if redis.call('EXISTS', KEYS[1]) ~= 1 then return -3 end
local mine = redis.call('GET', KEYS[6])
if mine and mine ~= ARGV[1] then return -2 end
if redis.call('ZSCORE', KEYS[2], ARGV[2]) then return 1 end
if redis.call('SISMEMBER', KEYS[3], ARGV[2]) ~= 1 then return 0 end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then return -1 end
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[2])
redis.call('HSET', KEYS[4], ARGV[2], ARGV[5])
redis.call('SREM', KEYS[3], ARGV[2])
redis.call('SET', KEYS[6], ARGV[1], 'PX', tonumber(ARGV[6]))
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[6]))
redis.call('PEXPIRE', KEYS[4], tonumber(ARGV[6]))
return 1
`;

const queueKey = 'matchmaking:queue';
const queuedKey = (characterId: string): string => `matchmaking:${characterId}`;
const QUEUE_TTL_MS = 10 * 60_000;

/**
 * O casamento (#199, §15.2) é UM script: lê a fila, filtra pela faixa de level e por quem
 * ainda está livre, escolhe até `max − 1` companheiros preferindo VOCAÇÕES DISTINTAS — é o
 * que o bônus de XP premia — e os TIRA da fila no mesmo passo. Dois `join` no mesmo instante
 * não formam duas parties com o mesmo personagem porque só um deles encontra o outro na fila.
 * Devolve a lista `[characterId, accountId, ...]` do grupo (quem chamou incluído), ou vazio.
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
end
return out
`;

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
    const others: Array<{ characterId: string; accountId: string }> = [];
    for (let i = 0; i + 1 < matched.length; i += 2) {
      others.push({ characterId: matched[i] as string, accountId: matched[i + 1] as string });
    }
    const leader = others[0] ?? { characterId, accountId };
    const party = leader.characterId === characterId
      ? await this.create(characterId, accountId)
      : await this.create(leader.characterId, leader.accountId);
    if (party === null) return null;
    const members = leader.characterId === characterId ? others : [{ characterId, accountId }, ...others.slice(1)];
    for (const member of members) {
      await this.invite(party.id, member.characterId);
      await this.join(party.id, member.characterId, member.accountId, maxMembers);
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
  async create(leaderId: string, accountId: string): Promise<PartyRecord | null> {
    const id = randomUUID();
    const now = this.#now();
    // `SET NX`: o personagem só entra numa party se não está em nenhuma.
    const claimed = await this.#redis.set(byCharacterKey(leaderId), id, 'PX', String(this.#ttlMs), 'NX');
    if (claimed !== 'OK') return null;
    await this.#redis.multi()
      .hset(partyKey(id), {
        leaderId, mode: 'split', shareCosts: '0', splitLoot: '0', createdAtMs: String(now),
        state: 'forming', published: '0',
      })
      .pexpire(partyKey(id), this.#ttlMs)
      .zadd(membersKey(id), String(now), leaderId)
      .pexpire(membersKey(id), this.#ttlMs)
      .hset(accountsKey(id), leaderId, accountId)
      .pexpire(accountsKey(id), this.#ttlMs)
      .exec();
    return this.get(id);
  }

  async get(id: string): Promise<PartyRecord | null> {
    const [hash, members, approved, accounts] = await Promise.all([
      this.#redis.hgetall(partyKey(id)),
      this.#redis.zrange(membersKey(id), '0', '-1'),
      this.#redis.smembers(approvedKey(id)),
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
      approved,
      accounts,
      // Um `api` anterior ao #402 não grava `state`: a party é `forming` por definição.
      state: hash['state'] === 'hunting' ? 'hunting' : 'forming',
      sessionId: hash['sessionId'] ?? null,
      contentVersion: hash['contentVersion'] ?? null,
      published: hash['published'] === '1',
      minLevel: hash['minLevel'] === undefined ? null : Number(hash['minLevel']),
      maxLevel: hash['maxLevel'] === undefined ? null : Number(hash['maxLevel']),
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
   * Membro que não está mais na sessão viva sai do ZSET — a poda da lotação viva (#402). Só
   * dele: o ZSET é a lista de membros FORMADA; quem saiu da hunt perdeu o lease e não conta.
   */
  async prune(id: string, characterId: string): Promise<void> {
    await this.#redis.zrem(membersKey(id), characterId);
  }

  /**
   * Inscreve um membro JÁ admitido numa party em curso (#402). É o simétrico de `prune`: o
   * `/join` em curso confere a lotação, emite o ticket e só então adiciona o recém-chegado ao
   * roster, para `liveMembers` e `rooms` contarem de verdade quem entrou depois do `start`.
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

  /** Publica a sala com faixa de level (Encontrar Party, §17–§20). O líder já foi conferido. */
  async publish(id: string, minLevel: number, maxLevel: number): Promise<void> {
    await this.#redis.multi()
      .hset(partyKey(id), {
        published: '1', minLevel: String(minLevel), maxLevel: String(maxLevel),
      })
      .sadd(ROOMS_KEY, id)
      .exec();
    await this.#renewIfHunting(id);
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

  async join(
    id: string, characterId: string, accountId: string, maxMembers: number,
  ): Promise<'joined' | 'not-invited' | 'full' | 'in-another-party' | 'not-found'> {
    const redis = this.#redis as Redis & {
      joinParty(
        party: string, members: string, invites: string, accounts: string, approved: string, byChar: string,
        partyId: string, characterId: string, max: string, score: string, accountId: string, ttl: string,
      ): Promise<number>;
    };
    const result = await redis.joinParty(
      partyKey(id), membersKey(id), invitesKey(id), accountsKey(id), approvedKey(id), byCharacterKey(characterId),
      id, characterId, String(maxMembers), String(this.#now()), accountId, String(this.#ttlMs),
    );
    switch (result) {
      case 1: return 'joined';
      case 0: return 'not-invited';
      case -1: return 'full';
      case -2: return 'in-another-party';
      default: return 'not-found';
    }
  }

  /**
   * Sai. O líder que sai passa a liderança ao mais antigo; a party vazia some. Sair
   * desaprova a proposta corrente para todo mundo: a composição mudou, e o que foi aprovado
   * era outra party.
   */
  async leave(id: string, characterId: string): Promise<PartyRecord | null> {
    const party = await this.get(id);
    if (party === null) return null;
    if (!party.members.includes(characterId)) return party;
    const remaining = party.members.filter((member) => member !== characterId);
    const multi = this.#redis.multi()
      .zrem(membersKey(id), characterId)
      .hdel(accountsKey(id), characterId)
      .del(byCharacterKey(characterId))
      .del(approvedKey(id));
    if (remaining.length === 0) {
      await multi
        .del(partyKey(id), membersKey(id), accountsKey(id), invitesKey(id), ticketsKey(id))
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
   * efeito na composição é o MESMO de uma saída voluntária (desaprova a proposta corrente, porque
   * a party mudou): `kick` só acrescenta QUEM pode pedir isso e NUNCA contra o próprio líder — para
   * isso já existe `leave`. A validação mora aqui, e não na rota, porque as três checagens (líder,
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

  /** O líder propõe; a proposta zera as aprovações e aprova o próprio líder. */
  async propose(
    id: string,
    proposal: {
      huntId: string; difficulty: string; mode: PartyMode;
      /** Ausentes derivam de `mode` — um cliente anterior ao #400 só manda `mode`. */
      shareCosts?: boolean; splitLoot?: boolean;
    },
    leaderId: string,
  ): Promise<void> {
    const shareCosts = proposal.shareCosts ?? proposal.mode === 'shared';
    const splitLoot = proposal.splitLoot ?? proposal.mode === 'shared';
    await this.#redis.multi()
      .hset(partyKey(id), {
        huntId: proposal.huntId, difficulty: proposal.difficulty, mode: proposal.mode,
        shareCosts: shareCosts ? '1' : '0', splitLoot: splitLoot ? '1' : '0',
      })
      .del(approvedKey(id))
      .sadd(approvedKey(id), leaderId)
      .pexpire(approvedKey(id), this.#ttlMs)
      .pexpire(partyKey(id), this.#ttlMs)
      .pexpire(membersKey(id), this.#ttlMs)
      .pexpire(accountsKey(id), this.#ttlMs)
      .exec();
  }

  async approve(id: string, characterId: string): Promise<void> {
    await this.#redis.multi()
      .sadd(approvedKey(id), characterId)
      .pexpire(approvedKey(id), this.#ttlMs)
      .exec();
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
    multi.hset(partyKey(id), { state: 'hunting', sessionId, contentVersion });
    multi.pexpire(partyKey(id), HUNTING_TTL_MS);
    multi.pexpire(membersKey(id), HUNTING_TTL_MS);
    multi.pexpire(accountsKey(id), HUNTING_TTL_MS);
    multi.del(invitesKey(id), approvedKey(id));
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
      .pexpire(accountsKey(id), HUNTING_TTL_MS);
    for (const member of members) multi.pexpire(byCharacterKey(member), HUNTING_TTL_MS);
    await multi.exec();
  }

  /** Desfaz a party inteira (o `start` falhou no meio, ou o líder desistiu). */
  async remove(id: string): Promise<void> {
    const members = await this.#redis.zrange(membersKey(id), '0', '-1');
    const multi = this.#redis.multi();
    for (const member of members) multi.del(byCharacterKey(member));
    multi.del(partyKey(id), membersKey(id), accountsKey(id), invitesKey(id), approvedKey(id), ticketsKey(id));
    multi.srem(ROOMS_KEY, id);
    await multi.exec();
  }
}
