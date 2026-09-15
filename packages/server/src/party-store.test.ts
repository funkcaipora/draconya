import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PartyStore } from './party-store.js';
import { connectTestRedis } from './testing/redis.js';

const { redis, available } = await connectTestRedis(12);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

// A party antes da hunt (#195): formulário em Redis. O que se prende é o que o script de
// `join` garante — vaga, convite, uma party por personagem — e o que sair e iniciar fazem.

describe.runIf(available)('PartyStore', () => {
  it('creates with the leader inside, invites, joins in order, and refuses the uninvited, the full and the taken', async () => {
    let now = 1_000;
    const store = new PartyStore(redis, { now: () => now });
    const party = await store.create('lead', 'acc-lead');
    if (party === null) throw new Error('sem party');
    expect(party).toMatchObject({ leaderId: 'lead', mode: 'split', members: ['lead'], accounts: { lead: 'acc-lead' } });
    // O líder não cria outra enquanto está numa.
    expect(await store.create('lead', 'acc-lead')).toBeNull();

    expect(await store.join(party.id, 'b', 'acc-b', 4)).toBe('not-invited');
    await store.invite(party.id, 'b');
    await store.invite(party.id, 'c');
    await store.invite(party.id, 'd');
    await store.invite(party.id, 'e');
    now = 2_000;
    expect(await store.join(party.id, 'b', 'acc-b', 4)).toBe('joined');
    // Entrar de novo é inofensivo.
    expect(await store.join(party.id, 'b', 'acc-b', 4)).toBe('joined');
    now = 3_000;
    expect(await store.join(party.id, 'c', 'acc-c', 4)).toBe('joined');
    expect(await store.join(party.id, 'd', 'acc-d', 4)).toBe('joined');
    expect(await store.join(party.id, 'e', 'acc-e', 4)).toBe('full');
    expect((await store.get(party.id))?.members).toEqual(['lead', 'b', 'c', 'd']);
    // `b` está nesta; outra party não o convida para dentro.
    const other = await store.create('x', 'acc-x');
    await store.invite(other?.id ?? '', 'b');
    expect(await store.join(other?.id ?? '', 'b', 'acc-b', 4)).toBe('in-another-party');
    expect(await store.join('nope', 'z', 'acc-z', 4)).toBe('not-found');
    expect((await store.of('b'))?.id).toBe(party.id);
  });

  it('propose approves the leader and resets the others; leaving disapproves; the leader leaving passes the lead', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead');
    if (party === null) throw new Error('sem party');
    await store.invite(party.id, 'b');
    await store.join(party.id, 'b', 'acc-b', 4);
    await store.propose(party.id, { huntId: 'arena', difficulty: 'bold', mode: 'shared' }, 'lead');
    expect(await store.get(party.id)).toMatchObject({ huntId: 'arena', difficulty: 'bold', mode: 'shared', approved: ['lead'] });
    await store.approve(party.id, 'b');
    expect([...((await store.get(party.id))?.approved ?? [])].sort()).toEqual(['b', 'lead']);
    // Nova proposta zera.
    await store.propose(party.id, { huntId: 'arena', difficulty: 'cautious', mode: 'split' }, 'lead');
    expect((await store.get(party.id))?.approved).toEqual(['lead']);

    const after = await store.leave(party.id, 'lead');
    expect(after).toMatchObject({ leaderId: 'b', members: ['b'], approved: [] });
    expect(await store.of('lead')).toBeNull();
    expect(await store.leave(party.id, 'b')).toBeNull();
    expect(await store.get(party.id)).toBeNull();
  });

  it('started keeps one ticket per member to be taken once, and the party itself is gone', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead');
    if (party === null) throw new Error('sem party');
    await store.invite(party.id, 'b');
    await store.join(party.id, 'b', 'acc-b', 4);
    const ticket = (characterId: string) => ({ ticket: `t-${characterId}`, wsUrl: 'ws://x', expiresAtMs: 9, sessionId: 's1' });
    await store.started(party.id, { lead: ticket('lead'), b: ticket('b') }, 30_000);
    expect(await store.get(party.id)).toBeNull();
    expect(await store.takeTicket('b')).toEqual(ticket('b'));
    expect(await store.takeTicket('b')).toBeNull();
    expect(await store.of('b')).toBeNull();
    expect(await store.takeTicket('lead')).toEqual(ticket('lead'));
    // E os dois estão livres para uma party nova.
    expect(await store.create('b', 'acc-b')).not.toBeNull();
  });

  it('remove frees every member', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead');
    if (party === null) throw new Error('sem party');
    await store.invite(party.id, 'b');
    await store.join(party.id, 'b', 'acc-b', 4);
    await store.remove(party.id);
    expect(await store.of('lead')).toBeNull();
    expect(await store.of('b')).toBeNull();
    expect(await store.create('b', 'acc-b')).not.toBeNull();
  });
});
