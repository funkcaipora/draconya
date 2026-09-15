// A party ANTES da hunt (#195, ADR 0027 decisão 8): transitória, em Redis, no `api`.
//
// Uma party existe entre "criar" e "iniciar" ou "desfazer". Não é linha de Postgres — é
// formulário, não progresso — e não é estado quente: os personagens estão na Cidade, que é
// inerte, e nada aqui toca `CharacterRuntime` nenhum (invariante 9). No `start` ela vira uma
// sessão de hunt com N donos e some daqui.
//
//   party:{id}            HASH   leaderId, mode, huntId, difficulty, createdAtMs   TTL
//   party:{id}:members    ZSET   score = instante de entrada  → a liderança sucessória
//   party:{id}:accounts   HASH   characterId → accountId    (quem é de quem, para o ticket)
//   party:{id}:invites    SET    characterIds convidados      TTL curto
//   party:{id}:approved   SET    quem aprovou a proposta atual
//   party:{id}:tickets    HASH   characterId → ticket JSON   (depois do start; cada um pega o seu)
//   party:by-char:{characterId}  STRING partyId  (um personagem está em NO MÁXIMO uma party)

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export type PartyMode = 'split' | 'shared';

export interface PartyRecord {
  readonly id: string;
  readonly leaderId: string;
  readonly mode: PartyMode;
  readonly huntId: string | null;
  readonly difficulty: string | null;
  readonly createdAtMs: number;
  /** Na ordem de entrada. */
  readonly members: readonly string[];
  readonly approved: readonly string[];
  readonly accounts: Readonly<Record<string, string>>;
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

const partyKey = (id: string): string => `party:${id}`;
const membersKey = (id: string): string => `party:${id}:members`;
const accountsKey = (id: string): string => `party:${id}:accounts`;
const invitesKey = (id: string): string => `party:${id}:invites`;
const approvedKey = (id: string): string => `party:${id}:approved`;
const ticketsKey = (id: string): string => `party:${id}:tickets`;
const byCharacterKey = (characterId: string): string => `party:by-char:${characterId}`;

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
  }

  /** Cria a party com o líder dentro. `null` se ele já está numa. */
  async create(leaderId: string, accountId: string): Promise<PartyRecord | null> {
    const id = randomUUID();
    const now = this.#now();
    // `SET NX`: o personagem só entra numa party se não está em nenhuma.
    const claimed = await this.#redis.set(byCharacterKey(leaderId), id, 'PX', String(this.#ttlMs), 'NX');
    if (claimed !== 'OK') return null;
    await this.#redis.multi()
      .hset(partyKey(id), { leaderId, mode: 'split', createdAtMs: String(now) })
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
    return {
      id,
      leaderId: hash['leaderId'],
      mode: hash['mode'] === 'shared' ? 'shared' : 'split',
      huntId: hash['huntId'] ?? null,
      difficulty: hash['difficulty'] ?? null,
      createdAtMs: Number(hash['createdAtMs'] ?? 0),
      members,
      approved,
      accounts,
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
      .exec();
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
      await multi.del(partyKey(id), membersKey(id), accountsKey(id), invitesKey(id), ticketsKey(id)).exec();
      return null;
    }
    if (party.leaderId === characterId) multi.hset(partyKey(id), 'leaderId', remaining[0] as string);
    await multi.exec();
    return this.get(id);
  }

  /** O líder propõe; a proposta zera as aprovações e aprova o próprio líder. */
  async propose(
    id: string, proposal: { huntId: string; difficulty: string; mode: PartyMode }, leaderId: string,
  ): Promise<void> {
    await this.#redis.multi()
      .hset(partyKey(id), { huntId: proposal.huntId, difficulty: proposal.difficulty, mode: proposal.mode })
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
   * O `start` aconteceu: guarda o ticket de cada membro para ele pegar o SEU (`takeTicket`) e
   * apaga a party — daqui em diante a sessão é a party. Os ponteiros `by-char` ficam até o
   * ticket ser pego, para `of` continuar respondendo "sua party começou".
   */
  async started(id: string, tickets: Readonly<Record<string, IssuedTicket>>, ticketTtlMs: number): Promise<void> {
    const multi = this.#redis.multi();
    for (const [characterId, ticket] of Object.entries(tickets)) {
      multi.hset(ticketsKey(id), characterId, JSON.stringify(ticket));
      multi.set(byCharacterKey(characterId), id, 'PX', String(ticketTtlMs));
    }
    multi.pexpire(ticketsKey(id), ticketTtlMs);
    multi.del(partyKey(id), membersKey(id), accountsKey(id), invitesKey(id), approvedKey(id));
    await multi.exec();
  }

  /** O ticket deste personagem, UMA vez: pegar apaga. `null` se não há (ainda) um. */
  async takeTicket(characterId: string): Promise<IssuedTicket | null> {
    const id = await this.#redis.get(byCharacterKey(characterId));
    if (id === null) return null;
    const raw = await this.#redis.hget(ticketsKey(id), characterId);
    if (raw === null) return null;
    await this.#redis.multi().hdel(ticketsKey(id), characterId).del(byCharacterKey(characterId)).exec();
    try {
      return JSON.parse(raw) as IssuedTicket;
    } catch {
      return null;
    }
  }

  /** Desfaz a party inteira (o `start` falhou no meio, ou o líder desistiu). */
  async remove(id: string): Promise<void> {
    const members = await this.#redis.zrange(membersKey(id), '0', '-1');
    const multi = this.#redis.multi();
    for (const member of members) multi.del(byCharacterKey(member));
    multi.del(partyKey(id), membersKey(id), accountsKey(id), invitesKey(id), approvedKey(id), ticketsKey(id));
    await multi.exec();
  }
}
