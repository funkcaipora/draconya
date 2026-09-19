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

  it('kick: only leader can kick others, cannot kick self or non-members, and kick resets approvals', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead');
    if (party === null) throw new Error('sem party');
    await store.invite(party.id, 'b');
    await store.join(party.id, 'b', 'acc-b', 4);
    await store.invite(party.id, 'c');
    await store.join(party.id, 'c', 'acc-c', 4);
    await store.propose(party.id, { huntId: 'arena', difficulty: 'bold', mode: 'shared' }, 'lead');
    await store.approve(party.id, 'b');

    // Rejeições
    expect(await store.kick('non-existent', 'lead', 'b')).toBe('not-found');
    expect(await store.kick(party.id, 'b', 'c')).toBe('not-leader');
    expect(await store.kick(party.id, 'lead', 'lead')).toBe('cannot-kick-self');
    expect(await store.kick(party.id, 'lead', 'stranger')).toBe('target-not-a-member');

    // Expulsão válida
    const afterKick = await store.kick(party.id, 'lead', 'b');
    expect(typeof afterKick).toBe('object');
    if (typeof afterKick === 'string') throw new Error('kick falhou');
    expect(afterKick.members).toEqual(['lead', 'c']);
    expect(afterKick.approved).toEqual([]);
    expect(await store.of('b')).toBeNull();

    // Expulsar 'b' novamente agora dá 'target-not-a-member'
    expect(await store.kick(party.id, 'lead', 'b')).toBe('target-not-a-member');
  });

  it('started keeps one ticket per member to be taken once, and the party itself SURVIVES as hunting', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead');
    if (party === null) throw new Error('sem party');
    await store.invite(party.id, 'b');
    await store.join(party.id, 'b', 'acc-b', 4);
    const ticket = (characterId: string) => ({ ticket: `t-${characterId}`, wsUrl: 'ws://x', expiresAtMs: 9, sessionId: 's1' });
    await store.started(party.id, 's1', 'v1', { lead: ticket('lead'), b: ticket('b') }, 30_000);
    // RF-01: a party não some — vira `hunting` com o `sessionId` e a versão de conteúdo.
    expect(await store.get(party.id)).toMatchObject({
      id: party.id, leaderId: 'lead', state: 'hunting', sessionId: 's1', contentVersion: 'v1',
    });
    expect(await store.takeTicket('b')).toEqual(ticket('b'));
    expect(await store.takeTicket('b')).toBeNull();
    // O ponteiro `by-char` FICA: é ele que faz `/mine` continuar respondendo `hunting`.
    expect((await store.of('b'))?.state).toBe('hunting');
    expect(await store.takeTicket('lead')).toEqual(ticket('lead'));
    // E os dois continuam ocupados por ESTA party (não podem formar outra enquanto `hunting`).
    expect(await store.create('b', 'acc-b')).toBeNull();
  });

  it('publish/unpublish drive the rooms index; stale rooms are pruned on read', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead');
    if (party === null) throw new Error('sem party');
    await store.publish(party.id, 5, 20);
    expect((await store.get(party.id))?.published).toBe(true);
    expect((await store.get(party.id))).toMatchObject({ minLevel: 5, maxLevel: 20 });
    expect((await store.rooms()).map((p) => p.id)).toContain(party.id);
    await store.unpublish(party.id);
    expect(await store.rooms()).toEqual([]);
    // Sala cujo registro sumiu (TTL) sai do SET na leitura, e não fica para sempre.
    await store.publish(party.id, 1, 99);
    await redis.del(`party:${party.id}`);
    expect(await store.rooms()).toEqual([]);
    expect(await redis.smembers('party:rooms')).toEqual([]);
  });

  it('invite writes the reverse index, decline clears both, and invitesOf prunes expired invites', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead');
    if (party === null) throw new Error('sem party');
    await store.invite(party.id, 'b');
    expect(await store.isInvited(party.id, 'b')).toBe(true);
    expect(await store.invitesOf('b')).toEqual([party.id]);
    await store.decline(party.id, 'b');
    expect(await store.isInvited(party.id, 'b')).toBe(false);
    expect(await store.invitesOf('b')).toEqual([]);
    // Convite que expirou (chave apagada) some do índice reverso na leitura, sem erro.
    await store.invite(party.id, 'c');
    await redis.del(`party:${party.id}:invites`);
    expect(await store.invitesOf('c')).toEqual([]);
    expect(await redis.smembers('party:invited:c')).toEqual([]);
  });

  it('prune removes only the departed member from the ZSET', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead');
    if (party === null) throw new Error('sem party');
    await store.invite(party.id, 'b');
    await store.join(party.id, 'b', 'acc-b', 4);
    await store.started(party.id, 's1', 'v1', {}, 30_000);
    await store.prune(party.id, 'b');
    expect((await store.get(party.id))?.members).toEqual(['lead']);
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
