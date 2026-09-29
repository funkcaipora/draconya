import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NO_VOCATION, PartyStore } from './party-store.js';
import { connectTestRedis } from './testing/redis.js';

const { redis, available } = await connectTestRedis(12);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

// A party antes da hunt (#195): formulário em Redis. O que se prende é o que os scripts de
// `join` e de reserva garantem — vaga por vocação contada DENTRO do Lua (DT-01), convite,
// uma party por personagem —, o que a configuração e a publicação fazem, e o aceite do
// convite social resolver EXATAMENTE uma party (RF-09).

describe.runIf(available)('PartyStore', () => {
  it('creates with the leader inside, invites, joins in order, and refuses the uninvited, the full and the taken', async () => {
    let now = 1_000;
    const store = new PartyStore(redis, { now: () => now });
    const party = await store.create('lead', 'acc-lead', null);
    if (party === null) throw new Error('sem party');
    expect(party).toMatchObject({
      leaderId: 'lead', mode: 'split', members: ['lead'], accounts: { lead: 'acc-lead' },
      vocationTargets: {},
    });
    // O líder sem vocação entra no HASH `:vocations` como `none` — é o que a composição conta.
    expect(await redis.hget(`party:${party.id}:vocations`, 'lead')).toBe(NO_VOCATION);
    // O líder não cria outra enquanto está numa.
    expect(await store.create('lead', 'acc-lead', null)).toBeNull();

    expect(await store.join(party.id, 'b', 'acc-b', {
      maxMembers: 4, vocation: 'knight', targets: {}, publicEligible: false,
    })).toBe('room-not-eligible');
    await store.invite(party.id, 'b');
    await store.invite(party.id, 'c');
    await store.invite(party.id, 'd');
    await store.invite(party.id, 'e');
    now = 2_000;
    expect(await store.join(party.id, 'b', 'acc-b', {
      maxMembers: 4, vocation: 'knight', targets: {}, publicEligible: false,
    })).toBe('joined');
    // Entrar de novo é inofensivo.
    expect(await store.join(party.id, 'b', 'acc-b', {
      maxMembers: 4, vocation: 'knight', targets: {}, publicEligible: false,
    })).toBe('joined');
    now = 3_000;
    expect(await store.join(party.id, 'c', 'acc-c', {
      maxMembers: 4, vocation: 'druid', targets: {}, publicEligible: false,
    })).toBe('joined');
    expect(await store.join(party.id, 'd', 'acc-d', {
      maxMembers: 4, vocation: 'sorcerer', targets: {}, publicEligible: false,
    })).toBe('joined');
    expect(await store.join(party.id, 'e', 'acc-e', {
      maxMembers: 4, vocation: 'paladin', targets: {}, publicEligible: false,
    })).toBe('full');
    expect((await store.get(party.id))?.members).toEqual(['lead', 'b', 'c', 'd']);
    // O HASH `:vocations` acompanhou o roster.
    expect(await redis.hgetall(`party:${party.id}:vocations`)).toEqual({
      lead: NO_VOCATION, b: 'knight', c: 'druid', d: 'sorcerer',
    });
    // `b` está nesta; outra party não o convida para dentro.
    const other = await store.create('x', 'acc-x', 'druid');
    await store.invite(other?.id ?? '', 'b');
    expect(await store.join(other?.id ?? '', 'b', 'acc-b', {
      maxMembers: 4, vocation: 'knight', targets: {}, publicEligible: false,
    })).toBe('in-another-party');
    expect(await store.join('nope', 'z', 'acc-z', {
      maxMembers: 4, vocation: NO_VOCATION, targets: {}, publicEligible: false,
    })).toBe('not-found');
    expect((await store.of('b'))?.id).toBe(party.id);
  });

  it('configure patches each axis alone (RF-02), and the two axes stay independent', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead', 'knight');
    if (party === null) throw new Error('sem party');
    // Um eixo por vez: shareCosts ligado NÃO liga splitLoot, e a soma das quatro
    // combinações é o que a #499 pede (D1).
    await store.configure(party.id, { shareCosts: true });
    expect(await store.get(party.id)).toMatchObject({ shareCosts: true, splitLoot: false, mode: 'split' });
    await store.configure(party.id, { splitLoot: true });
    expect(await store.get(party.id)).toMatchObject({ shareCosts: true, splitLoot: true, mode: 'shared' });
    await store.configure(party.id, { shareCosts: false });
    expect(await store.get(party.id)).toMatchObject({ shareCosts: false, splitLoot: true, mode: 'split' });
    await store.configure(party.id, { splitLoot: false });
    expect(await store.get(party.id)).toMatchObject({ shareCosts: false, splitLoot: false, mode: 'split' });
    // A composição e o level mínimo vão no MESMO patch, como JSON no hash.
    await store.configure(party.id, {
      huntId: 'arena', difficulty: 'bold', minLevel: 10,
      vocationTargets: { knight: 2, druid: 2 },
    });
    expect(await store.get(party.id)).toMatchObject({
      huntId: 'arena', difficulty: 'bold', minLevel: 10,
      vocationTargets: { knight: 2, druid: 2 },
    });
    // Corrompido/ausente é `{}` — leitura nunca recusada.
    await redis.hset(`party:${party.id}`, 'vocationTargets', 'não é json');
    expect((await store.get(party.id))?.vocationTargets).toEqual({});
    await redis.hdel(`party:${party.id}`, 'vocationTargets');
    expect((await store.get(party.id))?.vocationTargets).toEqual({});
  });

  it('publish requires hunt, minLevel and one open vocation slot; unpublish closes without undoing', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead', 'knight');
    if (party === null) throw new Error('sem party');
    // Sem proposta: recusa.
    expect(await store.publish(party.id)).toBe('nothing-proposed');
    await store.configure(party.id, { huntId: 'arena', difficulty: 'bold' });
    // Sem level mínimo: recusa.
    expect(await store.publish(party.id)).toBe('not-configured');
    await store.configure(party.id, { minLevel: 5 });
    // Sem composição não há vaga pública nenhuma: recusa (RF-03).
    expect(await store.publish(party.id)).toBe('no-vocation-slot');
    // O líder knight conta para a composição: alvo 2, ele é 1 — há vaga.
    await store.configure(party.id, { vocationTargets: { knight: 2 } });
    expect(await store.publish(party.id)).toBe('published');
    const published = await store.get(party.id);
    expect(published).toMatchObject({ published: true, minLevel: 5, huntId: 'arena', difficulty: 'bold' });
    expect(published?.maxLevel).toBeNull();
    expect((await store.rooms()).map((room) => room.id)).toContain(party.id);
    // Composição Lotada: ninguém mais publica com a vaga fechada — e unpublish fecha sem desfazer.
    await store.unpublish(party.id);
    expect(await store.rooms()).toEqual([]);
    expect((await store.get(party.id))?.published).toBe(false);
    expect((await store.get(party.id))?.minLevel).toBe(5);
    // Sala cujo registro sumiu (TTL) sai do SET na leitura, e não fica para sempre.
    await store.publish(party.id);
    await redis.del(`party:${party.id}`);
    expect(await store.rooms()).toEqual([]);
    expect(await redis.smembers('party:rooms')).toEqual([]);
  });

  it('the Lua join counts vocations inside the script: the second join on the last slot loses (DT-01)', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead', 'knight');
    if (party === null) throw new Error('sem party');
    await store.configure(party.id, {
      huntId: 'arena', difficulty: 'bold', minLevel: 1, vocationTargets: { knight: 2 },
    });
    await store.publish(party.id);
    const join = (characterId: string) => store.join(party.id, characterId, `acc-${characterId}`, {
      maxMembers: 8, vocation: 'knight', targets: { knight: 2 }, publicEligible: true,
    });
    // A "corrida" é a serialização do Redis: o segundo join vê, em HVALS, o HSET do primeiro.
    expect(await join('b')).toBe('joined');
    expect(await join('c')).toBe('no-vocation-slot');
    // Outra vocação sem linha na composição também não passa.
    expect(await store.join(party.id, 'd', 'acc-d', {
      maxMembers: 8, vocation: 'druid', targets: { knight: 2 }, publicEligible: true,
    })).toBe('no-vocation-slot');
    // Saída reabre a vaga: leave HDEL :vocations, e o próximo knight entra.
    await store.leave(party.id, 'b');
    expect(await join('c')).toBe('joined');
    // E a poda reabre do mesmo jeito (membro que sumiu da sessão viva).
    await store.prune(party.id, 'c');
    expect(await join('e')).toBe('joined');
  });

  it('reserveSlot takes the slot before the ticket and releaseSlot gives it back (DT-04)', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead', 'knight');
    if (party === null) throw new Error('sem party');
    await store.configure(party.id, { huntId: 'arena', difficulty: 'bold', minLevel: 1, vocationTargets: { knight: 2 } });
    const reserve = (characterId: string) => store.reserveSlot(party.id, characterId, {
      maxMembers: 8, vocation: 'knight', targets: { knight: 2 }, invited: false,
    });
    // O líder já ocupa a vaga 1 de 2; b reserva a última; c não tem mais vaga.
    expect(await reserve('b')).toBe('reserved');
    expect(await reserve('c')).toBe('no-vocation-slot');
    // Quem reservou já é contado como membro da vocação — mas o join o vê como já dentro
    // só depois do enroll; a reserva não é entrada.
    expect((await store.get(party.id))?.members).toEqual(['lead']);
    // Membro de verdade que tenta reservar de novo: -5.
    expect(await store.reserveSlot(party.id, 'lead', {
      maxMembers: 8, vocation: 'knight', targets: { knight: 2 }, invited: false,
    })).toBe('already-member');
    // Rollback: releaseSlot devolve a vaga, e o próximo entra.
    await store.releaseSlot(party.id, 'b');
    expect(await reserve('c')).toBe('reserved');
    // Convidado reserva fora da composição — convite é decisão explícita (#499 §3).
    expect(await store.reserveSlot(party.id, 'd', {
      maxMembers: 8, vocation: 'druid', targets: { knight: 2 }, invited: true,
    })).toBe('reserved');
    expect(await store.reserveSlot('nope', 'b', {
      maxMembers: 8, vocation: 'knight', targets: { knight: 2 }, invited: false,
    })).toBe('not-found');
  });

  it('the social accept creates EXACTLY one party: two invites from the same inviter never make two (RF-09)', async () => {
    const store = new PartyStore(redis);
    await store.createSocialInvite({
      inviteId: 'i1', inviterCharacterId: 'lead', inviterAccountId: 'acc-lead',
      inviterVocation: 'knight', inviteeCharacterId: 'b',
    });
    await store.createSocialInvite({
      inviteId: 'i2', inviterCharacterId: 'lead', inviterAccountId: 'acc-lead',
      inviterVocation: 'knight', inviteeCharacterId: 'c',
    });
    const first = await store.acceptSocialInvite({
      inviteId: 'i1', inviteeCharacterId: 'b', inviteeAccountId: 'acc-b',
      inviteeVocation: 'druid', maxMembers: 8,
    });
    expect(first).toMatchObject({ kind: 'created' });
    if (typeof first === 'string') throw new Error('recusou');
    // Caso A: o segundo aceite cai na party que o primeiro criou — o convidador é o líder dela.
    const second = await store.acceptSocialInvite({
      inviteId: 'i2', inviteeCharacterId: 'c', inviteeAccountId: 'acc-c',
      inviteeVocation: 'druid', maxMembers: 8,
    });
    expect(second).toMatchObject({ kind: 'entered' });
    if (typeof second === 'string') throw new Error('recusou');
    expect(second.party.id).toBe(first.party.id);
    expect(second.party.leaderId).toBe('lead');
    expect(second.party.members).toEqual(['lead', 'b', 'c']);
    // Uma party só, e cada vocação no HASH: o druid do primeiro aceite, o do segundo.
    expect(await redis.hgetall(`party:${second.party.id}:vocations`)).toEqual({
      lead: 'knight', b: 'druid', c: 'druid',
    });
    expect((await store.of('b'))?.id).toBe(second.party.id);
    // Os dois convites foram consumidos.
    expect(await store.socialInvitesOf('b')).toEqual([]);
    expect(await store.socialInvitesOf('c')).toEqual([]);
  });

  it('the social accept uses the party the leader created between the send and the accept', async () => {
    const store = new PartyStore(redis);
    await store.createSocialInvite({
      inviteId: 'i1', inviterCharacterId: 'lead', inviterAccountId: 'acc-lead',
      inviterVocation: 'knight', inviteeCharacterId: 'b',
    });
    // O convidador criou a própria party entre o envio e o aceite: o aceite ENTRA nela.
    const party = await store.create('lead', 'acc-lead', 'knight');
    if (party === null) throw new Error('sem party');
    const accepted = await store.acceptSocialInvite({
      inviteId: 'i1', inviteeCharacterId: 'b', inviteeAccountId: 'acc-b',
      inviteeVocation: 'druid', maxMembers: 8,
    });
    expect(accepted).toMatchObject({ kind: 'entered', party: { id: party.id, leaderId: 'lead' } });
    expect((await store.get(party.id))?.members).toEqual(['lead', 'b']);
  });

  it('the social accept is typed when the invite is gone, the invitee is busy, or the inviter is not', async () => {
    const store = new PartyStore(redis);
    // Sem convite nenhum: -1.
    expect(await store.acceptSocialInvite({
      inviteId: 'nope', inviteeCharacterId: 'b', inviteeAccountId: 'acc-b',
      inviteeVocation: null, maxMembers: 8,
    })).toBe('not-found');
    await store.createSocialInvite({
      inviteId: 'i1', inviterCharacterId: 'lead', inviterAccountId: 'acc-lead',
      inviterVocation: 'knight', inviteeCharacterId: 'b',
    });
    // Convite para OUTRO personagem: -1 — não é o dele.
    expect(await store.acceptSocialInvite({
      inviteId: 'i1', inviteeCharacterId: 'c', inviteeAccountId: 'acc-c',
      inviteeVocation: null, maxMembers: 8,
    })).toBe('not-found');
    // O convidado JÁ está numa party: recusa SEM consumir o convite.
    const busy = await store.create('b', 'acc-b', 'druid');
    if (busy === null) throw new Error('sem party');
    expect(await store.acceptSocialInvite({
      inviteId: 'i1', inviteeCharacterId: 'b', inviteeAccountId: 'acc-b',
      inviteeVocation: null, maxMembers: 8,
    })).toBe('in-another-party');
    expect((await store.socialInvitesOf('b')).map((invite) => invite.inviteId)).toEqual(['i1']);
    // O convidador virou MEMBRO de outra party: indisponível (-2), convite de pé.
    await store.leave(busy.id, 'b');
    const host = await store.create('x', 'acc-x', 'sorcerer');
    if (host === null) throw new Error('sem party');
    await store.invite(host.id, 'lead');
    await store.join(host.id, 'lead', 'acc-lead', {
      maxMembers: 8, vocation: 'knight', targets: {}, publicEligible: false,
    });
    expect(await store.acceptSocialInvite({
      inviteId: 'i1', inviteeCharacterId: 'b', inviteeAccountId: 'acc-b',
      inviteeVocation: null, maxMembers: 8,
    })).toBe('inviter-unavailable');
    expect((await store.socialInvitesOf('b')).map((invite) => invite.inviteId)).toEqual(['i1']);
    // Convidador numa party em hunt (state mudou entre o envio e o aceite): -2.
    await store.leave(host.id, 'lead');
    const hunting = await store.create('lead', 'acc-lead', 'knight');
    if (hunting === null) throw new Error('sem party');
    await store.started(hunting.id, 's1', 'v1', {}, 30_000);
    expect(await store.acceptSocialInvite({
      inviteId: 'i1', inviteeCharacterId: 'b', inviteeAccountId: 'acc-b',
      inviteeVocation: null, maxMembers: 8,
    })).toBe('inviter-unavailable');
    // Convite expirado (a chave sumiu pelo TTL): -1, e o índice é podado na leitura.
    await redis.del('party:social-invite:i1');
    expect(await store.socialInvitesOf('b')).toEqual([]);
    expect(await store.acceptSocialInvite({
      inviteId: 'i1', inviteeCharacterId: 'b', inviteeAccountId: 'acc-b',
      inviteeVocation: null, maxMembers: 8,
    })).toBe('not-found');
    // O convidador sai da hunt para poder receber convite resolvido de novo.
    await store.leave(hunting.id, 'lead');
    // E a party do convidador no teto: -2 também, com o convite de pé.
    const full = await store.create('lead', 'acc-lead', 'knight');
    if (full === null) throw new Error('sem party');
    await store.createSocialInvite({
      inviteId: 'i2', inviterCharacterId: 'lead', inviterAccountId: 'acc-lead',
      inviterVocation: 'knight', inviteeCharacterId: 'b',
    });
    // O join falha (a party de 1 já está no teto de 1), então o aceite encontra o teto cheio.
    await store.invite(full.id, 'b');
    expect(await store.join(full.id, 'b', 'acc-b', {
      maxMembers: 1, vocation: 'druid', targets: {}, publicEligible: false,
    })).toBe('full');
    expect(await store.acceptSocialInvite({
      inviteId: 'i2', inviteeCharacterId: 'b', inviteeAccountId: 'acc-b',
      inviteeVocation: null, maxMembers: 1,
    })).toBe('inviter-unavailable');
    expect((await store.socialInvitesOf('b')).map((invite) => invite.inviteId)).toEqual(['i2']);
  });

  it('started keeps one ticket per member to be taken once, and the party itself SURVIVES as hunting', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead', 'knight');
    if (party === null) throw new Error('sem party');
    await store.invite(party.id, 'b');
    await store.join(party.id, 'b', 'acc-b', {
      maxMembers: 4, vocation: 'druid', targets: {}, publicEligible: false,
    });
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
    expect(await store.create('b', 'acc-b', 'druid')).toBeNull();

  });

  it('invite writes the reverse index, decline clears both, and invitesOf prunes expired invites', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead', 'knight');
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

  it('prune removes only the departed member from the ZSET — and reopens his vocation slot', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead', 'knight');
    if (party === null) throw new Error('sem party');
    await store.invite(party.id, 'b');
    await store.join(party.id, 'b', 'acc-b', {
      maxMembers: 4, vocation: 'knight', targets: {}, publicEligible: false,
    });
    await store.started(party.id, 's1', 'v1', {}, 30_000);
    await store.prune(party.id, 'b');
    expect((await store.get(party.id))?.members).toEqual(['lead']);
    // A vaga dele no HASH `:vocations` saiu junto: sair reabre a vaga (#501).
    expect(await redis.hexists(`party:${party.id}:vocations`, 'b')).toBe(0);
  });

  it('remove frees every member', async () => {
    const store = new PartyStore(redis);
    const party = await store.create('lead', 'acc-lead', 'knight');
    if (party === null) throw new Error('sem party');
    await store.invite(party.id, 'b');
    await store.join(party.id, 'b', 'acc-b', {
      maxMembers: 4, vocation: 'druid', targets: {}, publicEligible: false,
    });
    await store.remove(party.id);
    expect(await store.of('lead')).toBeNull();
    expect(await store.of('b')).toBeNull();
    expect(await store.create('b', 'acc-b', 'druid')).not.toBeNull();
  });
});
