import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PartyStore } from '../party-store.js';
import { connectTestRedis } from '../testing/redis.js';

const { redis, available } = await connectTestRedis(15);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

// O matchmaking (#199, §15.2): a fila FORMA a party, e é um script — quem entra ou casa na
// hora com quem já esperava, ou fica esperando. O que se prende: a faixa de level, a
// preferência por vocações distintas, o teto, e que ninguém entra em duas parties.

describe.runIf(available)('matchmaking', () => {
  it('forms the party within the level range, the oldest in the queue leading', async () => {
    let now = 1_000;
    const store = new PartyStore(redis, { now: () => now });
    expect(await store.enqueue('a', 'acc-a', 20, 'knight', 10, 4)).toBeNull();
    expect(await store.queued('a')).toBe(true);
    now = 2_000;
    // Fora da faixa: fica esperando.
    expect(await store.enqueue('far', 'acc-far', 60, 'druid', 10, 4)).toBeNull();
    now = 3_000;
    const party = await store.enqueue('b', 'acc-b', 25, 'druid', 10, 4);
    if (party === null || party === 'in-party') throw new Error('sem party');
    expect(party.leaderId).toBe('a');
    expect(party.members).toEqual(['a', 'b']);
    expect(await store.queued('a')).toBe(false);
    expect(await store.queued('b')).toBe(false);
    expect(await store.queued('far')).toBe(true);
    // Quem já está numa party não entra na fila.
    expect(await store.enqueue('a', 'acc-a', 20, 'knight', 10, 4)).toBe('in-party');
  });

  it('prefers distinct vocations when there are more candidates than room, and caps at maxMembers', async () => {
    // Mutação que mata: escolher por ordem de chegada — formaria 4 knights com um druid esperando.
    // Cinco esperando ao mesmo tempo: semeados direto na fila, porque `enqueue` casa na hora
    // com o primeiro compatível — e é a chegada do sexto, com todos na fila, que prova a escolha.
    const store = new PartyStore(redis);
    let score = 0;
    for (const [id, vocation] of [['k1', 'knight'], ['k2', 'knight'], ['k3', 'knight'], ['d', 'druid'], ['s', 'sorcerer']] as const) {
      score += 1;
      await redis.zadd('matchmaking:queue', String(score), id);
      await redis.hset(`matchmaking:${id}`, { level: '10', vocationId: vocation, accountId: `acc-${id}` });
    }
    const party = await store.enqueue('p', 'acc-p', 10, 'paladin', 0, 4);
    if (party === null || party === 'in-party') throw new Error('sem party');
    // Quatro únicas primeiro (k1, d, s + p); os knights restantes ficam esperando.
    expect([...party.members].sort()).toEqual(['d', 'k1', 'p', 's']);
    expect(party.leaderId).toBe('k1');
    expect(await store.queued('k2')).toBe(true);
    expect(await store.queued('k3')).toBe(true);
    // Sem vocação (level < 8) conta como uma vocação — e casa com quem sobrou.
    expect(await store.enqueue('n', 'acc-n', 5, null, 0, 4)).not.toBeNull();
  });

  it('leave takes the character out of the queue, and range 0 matches any level', async () => {
    const store = new PartyStore(redis);
    await store.enqueue('a', 'acc-a', 1, null, 0, 4);
    await store.dequeue('a');
    expect(await store.queued('a')).toBe(false);
    expect(await store.enqueue('b', 'acc-b', 200, 'knight', 0, 4)).toBeNull();
    const party = await store.enqueue('c', 'acc-c', 1, 'druid', 0, 4);
    expect(party === null || party === 'in-party' ? null : party.members).toEqual(['b', 'c']);
  });
});
