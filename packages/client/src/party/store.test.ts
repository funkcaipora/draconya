import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INITIAL_PARTY, fetchRooms, party, partyActions, partyEntered, setEnterHunt, setPartyCharacter, setPartyClient,
} from './store.js';
import type { PartyClient, PartyInviteView, PartyView, RoomView, SocialInviteView } from './api.js';

// A store da party (#197): cópia do formulário do servidor, e o momento de ENTRAR — quando
// chega um ticket (do `start` ou do polling), a hunt é o ticket oferecido à conexão, uma vez.
//
// #503: `configure` substitui `propose` (patch parcial, cada eixo sozinho), `approve` não existe
// mais (fim da aprovação), `publish` não recebe faixa — o que se publica é o estado configurado —
// e `fetchRooms` leva o CANDIDATO (`characterId` + `huntId?`), porque quem filtra a elegibilidade
// é o servidor.

const view = (over: Partial<PartyView> = {}): PartyView => ({
  id: 'party-1', leaderId: 'me', mode: 'split', huntId: null, difficulty: null,
  minLevel: null, vocationTargets: {}, shareCosts: false, splitLoot: false,
  openSlots: {}, members: [{ characterId: 'me', name: 'Eu' }],
  published: false, state: 'forming', sessionId: null, ...over,
});

const room = (over: Partial<RoomView> = {}): RoomView => ({
  partyId: 'party-9', huntId: 'arena', difficulty: 'bold',
  leader: { characterId: 'lead', name: 'Alice', level: 40 },
  vocations: [], vocationTargets: { knight: 2 }, openSlots: { knight: 1 },
  members: 2, maxMembers: 8, minLevel: 10, state: 'forming', ...over,
});

const invite = (over: Partial<PartyInviteView> = {}): PartyInviteView => ({
  partyId: 'party-9', leaderId: 'lead', leaderName: 'Alice', huntId: 'arena', state: 'forming', ...over,
});

function fakeClient(over: Partial<PartyClient> = {}): PartyClient {
  return {
    create: async () => view(),
    mine: async () => ({ party: view(), ticket: null, invites: [] }),
    invite: async () => {},
    socialInvite: async () => {},
    acceptSocialInvite: async () => ({ kind: 'formed', party: view({ leaderId: 'lead' }) }),
    join: async () => ({ kind: 'formed', party: view({ leaderId: 'other' }) }),
    leave: async () => {},
    kick: async () => view(),
    configure: async () => view({ huntId: 'arena', difficulty: 'bold' }),
    publish: async () => view({ published: true }),
    unpublish: async () => {},
    start: async () => ({ sessionId: 's1', ticket: { ticket: 't', wsUrl: 'ws://n1/?ticket=t', expiresAtMs: 1, sessionId: 's1' } }),
    seek: async () => ({ party: null }),
    stopSeeking: async () => {},
    rooms: async () => [],
    decline: async () => {},
    ...over,
  };
}

beforeEach(() => {
  party.set(() => ({ ...INITIAL_PARTY }));
  setPartyClient(null);
  setEnterHunt(null);
});

describe('party store', () => {
  it('does nothing without a character or a client, and keeps the server copy after each action', async () => {
    await partyActions.create();
    expect(party.get().party).toBeNull();
    setPartyCharacter('me');
    setPartyClient(fakeClient());
    await partyActions.create();
    expect(party.get().party?.id).toBe('party-1');
    expect(party.get().busy).toBe(false);
    await partyActions.configure({ huntId: 'arena', difficulty: 'bold' });
    expect(party.get().party?.huntId).toBe('arena');
    await partyActions.leave();
    expect(party.get().party).toBeNull();
    expect(party.get().activePartyId).toBeNull();
  });

  it('configure is a partial PATCH: one axis changes alone, the other stays (RF-05, RF-09)', async () => {
    // O servidor funde o patch com o estado e devolve o `PartyView` inteiro — o mock espelha.
    const configure = vi.fn<PartyClient['configure']>().mockImplementation(
      (_partyId, _me, patch) => Promise.resolve(view({ ...party.get().party, ...patch })),
    );
    setPartyCharacter('me');
    setPartyClient(fakeClient({ configure, create: async () => view({ huntId: 'arena', difficulty: 'bold' }) }));
    await partyActions.create();
    // O toggle de custos manda SÓ o seu eixo — nunca os dois juntos, nem a caçada de novo.
    await partyActions.configure({ shareCosts: true });
    expect(configure).toHaveBeenLastCalledWith('party-1', 'me', { shareCosts: true });
    await partyActions.configure({ splitLoot: true });
    expect(configure).toHaveBeenLastCalledWith('party-1', 'me', { splitLoot: true });
    expect(party.get().party).toMatchObject({ shareCosts: true, splitLoot: true });
  });

  it('invites through the retained active party while the formation copy is gone', async () => {
    const invite = vi.fn<PartyClient['invite']>().mockResolvedValue();
    setPartyCharacter('me');
    setPartyClient(fakeClient({ invite }));
    party.set((state) => ({ ...state, party: null, activePartyId: 'party-1' }));

    await partyActions.invite('friend');

    expect(invite).toHaveBeenCalledWith('party-1', 'me', 'friend');
  });

  it('start with a ticket enters the hunt ONCE: offers the wsUrl and clears the form', async () => {
    // Mutação que mata: não chamar `enterHunt` — o líder ficaria na Cidade com a party sumida.
    const entered: string[] = [];
    setPartyCharacter('me');
    setPartyClient(fakeClient());
    setEnterHunt((wsUrl) => { entered.push(wsUrl); });
    await partyActions.create();
    await partyActions.start();
    expect(entered).toEqual(['ws://n1/?ticket=t']);
    expect(party.get()).toMatchObject({ party: null, entering: true, busy: false });
    expect(party.get().activePartyId).toBe('party-1');
    // O `session-state` da hunt chegou: a tela fecha.
    partyEntered();
    expect(party.get().entering).toBe(false);
    expect(party.get().activePartyId).toBe('party-1');
  });

  it('join of a FORMING party keeps the old flow: replaces the store copy ("entrar por id")', async () => {
    setPartyCharacter('me');
    setPartyClient(fakeClient({ join: async () => ({ kind: 'formed', party: view({ leaderId: 'other' }) }) }));
    await partyActions.join('party-1');
    expect(party.get().party?.leaderId).toBe('other');
    expect(party.get().entering).toBe(false);
  });

  it('acceptInvite of a RUNNING party offers the ticket and removes the invite (D7)', async () => {
    // Mutação que mata: não chamar `enter()` no ramo `entered` — o convite sumiria sem entrar.
    const entered: string[] = [];
    setPartyCharacter('me');
    setEnterHunt((wsUrl) => { entered.push(wsUrl); });
    setPartyClient(fakeClient({
      join: async () => ({ kind: 'entered', ticket: { ticket: 't', wsUrl: 'ws://n1/?ticket=t', expiresAtMs: 1, sessionId: 's1' } }),
    }));
    party.set((state) => ({ ...state, invites: [invite()] }));
    await partyActions.acceptInvite('party-9');
    expect(entered).toEqual(['ws://n1/?ticket=t']);
    expect(party.get()).toMatchObject({ entering: true, party: null, invites: [] });
  });

  it('declineInvite calls the API and drops only the TRADITIONAL invite of that id (D8)', async () => {
    const decline = vi.fn<PartyClient['decline']>().mockResolvedValue();
    const social: SocialInviteView = { inviteId: 'i1', leaderId: 'lead', leaderName: 'Bia', createdAtMs: 1 };
    setPartyCharacter('me');
    setPartyClient(fakeClient({ decline }));
    party.set((state) => ({ ...state, invites: [invite(), invite({ partyId: 'party-10' }), social] }));
    await partyActions.declineInvite('party-9');
    expect(decline).toHaveBeenCalledWith('party-9', 'me');
    // O convite SOCIAL (#502) não tem `partyId` — o filtro não o toca.
    expect(party.get().invites).toHaveLength(2);
    expect(party.get().invites.some((entry) => 'inviteId' in entry)).toBe(true);
  });

  it('publish takes no range anymore, and unpublish closes the room WITHOUT erasing minLevel (RF-03)', async () => {
    const publish = vi.fn<PartyClient['publish']>().mockResolvedValue(
      view({ published: true, minLevel: 10, huntId: 'arena', difficulty: 'bold', openSlots: { knight: 2 } }),
    );
    setPartyCharacter('me');
    setPartyClient(fakeClient({ publish, create: async () => view({ huntId: 'arena', difficulty: 'bold', minLevel: 10 }) }));
    await partyActions.create();
    await partyActions.publish();
    expect(publish).toHaveBeenLastCalledWith('party-1', 'me');
    expect(party.get().party).toMatchObject({ published: true, minLevel: 10 });

    await partyActions.unpublish();
    expect(party.get().party).toMatchObject({ published: false, minLevel: 10 });
  });

  it('refresh follows the server: a ticket from another member starts the hunt, a 404 clears the form', async () => {
    const entered: string[] = [];
    setPartyCharacter('me');
    setEnterHunt((wsUrl) => { entered.push(wsUrl); });
    const mine = vi.fn<PartyClient['mine']>()
      .mockResolvedValueOnce({ party: view({ leaderId: 'other' }), ticket: null, invites: [] })
      .mockResolvedValueOnce({ party: null, ticket: { ticket: 't2', wsUrl: 'ws://n1/?ticket=t2', expiresAtMs: 1, sessionId: 's1' }, invites: [] });
    setPartyClient(fakeClient({ mine }));
    await partyActions.refresh();
    expect(party.get().party?.leaderId).toBe('other');
    expect(party.get().activePartyId).toBe('party-1');
    await partyActions.refresh();
    expect(entered).toEqual(['ws://n1/?ticket=t2']);
    expect(party.get().entering).toBe(true);
    expect(party.get().activePartyId).toBe('party-1');
  });

  it('refresh brings the invites[] union the server knows about (D8, #501 RF-09)', async () => {
    const social: SocialInviteView = { inviteId: 'i2', leaderId: 'lead', leaderName: 'Bia', createdAtMs: 9 };
    setPartyCharacter('me');
    setPartyClient(fakeClient({ mine: async () => ({ party: null, ticket: null, invites: [invite(), social] }) }));
    await partyActions.refresh();
    expect(party.get().invites).toHaveLength(2);
    expect(party.get().invites[0]?.leaderName).toBe('Alice');
    expect(party.get().invites[1]?.leaderName).toBe('Bia');
  });

  it('a refusal lands in `error`, in words, and the draft stays', async () => {
    setPartyCharacter('me');
    setPartyClient(fakeClient({ create: async () => { throw new Error('Você já está numa party.'); } }));
    await partyActions.create();
    expect(party.get()).toMatchObject({ error: 'Você já está numa party.', busy: false, party: null });
  });

  it('kick calls client.kick with targetId and updates party', async () => {
    setPartyCharacter('me');
    const kick = vi.fn<PartyClient['kick']>().mockResolvedValue(
      view({ members: [{ characterId: 'me', name: 'Eu' }] }),
    );
    setPartyClient(fakeClient({
      create: async () => view({
        members: [
          { characterId: 'me', name: 'Eu' },
          { characterId: 'target', name: 'Target' },
        ],
      }),
      kick,
    }));
    await partyActions.create();
    expect(party.get().party?.members).toHaveLength(2);
    await partyActions.kick('target');
    expect(kick).toHaveBeenCalledWith('party-1', 'me', 'target');
    expect(party.get().party?.members).toHaveLength(1);
  });
});

describe('social invite (#502)', () => {
  it('socialInvite calls the API without a party and announces the success (RF-01, RF-04)', async () => {
    const socialInvite = vi.fn<PartyClient['socialInvite']>().mockResolvedValue();
    setPartyCharacter('me');
    setPartyClient(fakeClient({ socialInvite }));
    await partyActions.socialInvite('friend');
    expect(socialInvite).toHaveBeenCalledWith('me', 'friend');
    expect(party.get()).toMatchObject({ notice: 'Convite enviado.', error: null, busy: false });
  });

  it('a typed refusal of the social invite lands in `error`, in words, never in `notice` (RF-04)', async () => {
    setPartyCharacter('me');
    setPartyClient(fakeClient({
      socialInvite: async () => { throw new Error('Quem convida precisa estar fora da caçada.'); },
    }));
    await partyActions.socialInvite('friend');
    expect(party.get()).toMatchObject({
      error: 'Quem convida precisa estar fora da caçada.', notice: null, busy: false, party: null,
    });
  });

  it('the next action clears the notice (DT-03)', async () => {
    setPartyCharacter('me');
    setPartyClient(fakeClient());
    await partyActions.socialInvite('friend');
    expect(party.get().notice).toBe('Convite enviado.');
    await partyActions.create();
    expect(party.get().notice).toBeNull();
  });

  it('acceptSocialInvite keeps the formed party and drops ONLY the accepted invite (RF-05)', async () => {
    // Mutação que mata: remover o convite ERRADO — os outros (tradicional ou social) ficam.
    const social: SocialInviteView = { inviteId: 'i1', leaderId: 'lead', leaderName: 'Bia', createdAtMs: 1 };
    const other: SocialInviteView = { inviteId: 'i2', leaderId: 'lead2', leaderName: 'Caio', createdAtMs: 2 };
    setPartyCharacter('me');
    setPartyClient(fakeClient({
      acceptSocialInvite: async () => ({ kind: 'formed', party: view({ id: 'party-new', leaderId: 'lead' }) }),
    }));
    party.set((state) => ({ ...state, invites: [invite(), social, other] }));
    await partyActions.acceptSocialInvite('i1');
    expect(party.get().party?.id).toBe('party-new');
    expect(party.get().entering).toBe(false);
    expect(party.get().invites.map((entry) => ('inviteId' in entry ? entry.inviteId : entry.partyId)))
      .toEqual(['party-9', 'i2']);
  });

  it('acceptSocialInvite of a party in course enters by the ticket — the same enterOrForm (DT-04)', async () => {
    const entered: string[] = [];
    const social: SocialInviteView = { inviteId: 'i1', leaderId: 'lead', leaderName: 'Bia', createdAtMs: 1 };
    setPartyCharacter('me');
    setEnterHunt((wsUrl) => { entered.push(wsUrl); });
    setPartyClient(fakeClient({
      acceptSocialInvite: async () => ({
        kind: 'entered',
        ticket: { ticket: 't', wsUrl: 'ws://n1/?ticket=t', expiresAtMs: 1, sessionId: 's1' },
      }),
    }));
    party.set((state) => ({ ...state, invites: [social] }));
    await partyActions.acceptSocialInvite('i1');
    expect(entered).toEqual(['ws://n1/?ticket=t']);
    expect(party.get()).toMatchObject({ entering: true, party: null, invites: [] });
  });

  it('dismissSocialInvite is LOCAL (no network), and refresh does not bring it back (DT-05)', async () => {
    const social = (over: Partial<SocialInviteView> = {}): SocialInviteView =>
      ({ inviteId: 'i1', leaderId: 'lead', leaderName: 'Bia', createdAtMs: 1, ...over });
    const mine = vi.fn<PartyClient['mine']>()
      .mockResolvedValue({ party: null, ticket: null, invites: [invite(), social()] });
    setPartyCharacter('me');
    setPartyClient(fakeClient({ mine }));
    party.set((state) => ({ ...state, invites: [invite(), social()] }));

    partyActions.dismissSocialInvite('i1');
    expect(party.get().dismissedSocial).toEqual(['i1']);
    expect(party.get().invites.map((entry) => ('inviteId' in entry ? entry.inviteId : entry.partyId)))
      .toEqual(['party-9']);

    // O `/mine` do polling continua trazendo — o filtro da store é quem esconde o dispensado;
    // o convite TRADICIONAL nunca é filtrado por isso.
    await partyActions.refresh();
    expect(party.get().invites.map((entry) => ('inviteId' in entry ? entry.inviteId : entry.partyId)))
      .toEqual(['party-9']);
  });
});

describe('find party: rooms (#501 RF-04)', () => {
  it('fetchRooms propagates the candidate (and the hunt filter) to the client', async () => {
    const rooms = vi.fn<PartyClient['rooms']>().mockResolvedValue([room()]);
    setPartyClient(fakeClient({ rooms }));
    await expect(fetchRooms({ characterId: 'me', huntId: 'arena' })).resolves.toEqual([room()]);
    expect(rooms).toHaveBeenCalledWith({ characterId: 'me', huntId: 'arena' });
    await expect(fetchRooms({ characterId: 'me' })).resolves.toEqual([room()]);
    expect(rooms).toHaveBeenLastCalledWith({ characterId: 'me' });
  });

  it('fetchRooms without a client returns [] and never throws', async () => {
    setPartyClient(null);
    await expect(fetchRooms({ characterId: 'me' })).resolves.toEqual([]);
  });

  it('fetchRooms returns the server list and swallows a background failure', async () => {
    setPartyClient(fakeClient({ rooms: async () => [room()] }));
    await expect(fetchRooms({ characterId: 'me' })).resolves.toEqual([room()]);

    setPartyClient(fakeClient({ rooms: async () => { throw new Error('offline'); } }));
    await expect(fetchRooms({ characterId: 'me' })).resolves.toEqual([]);
  });
});

describe('matchmaking (#199)', () => {
  it('seek waits when nobody matched, and the party that the polling finds ends the wait', async () => {
    setPartyCharacter('me');
    const mine = vi.fn<PartyClient['mine']>().mockResolvedValueOnce({ party: view({ leaderId: 'other' }), ticket: null, invites: [] });
    setPartyClient(fakeClient({ mine }));
    await partyActions.seek();
    expect(party.get()).toMatchObject({ seeking: true, party: null });
    await partyActions.refresh();
    expect(party.get()).toMatchObject({ seeking: false, party: { leaderId: 'other' } });
    // Casou na hora: nada a esperar.
    setPartyClient(fakeClient({ seek: async () => ({ party: view() }) }));
    party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
    await partyActions.seek();
    expect(party.get()).toMatchObject({ seeking: false, party: { id: 'party-1' } });
    await partyActions.stopSeeking();
    expect(party.get().seeking).toBe(false);
  });
});

describe('the retired contract stays retired (#503, RF-09)', () => {
  it('propose and approve do not exist in the client anymore — typecheck and source agree', async () => {
    const apiSource = await readFile(new URL('./api.ts', import.meta.url), 'utf8');
    const storeSource = await readFile(new URL('./store.ts', import.meta.url), 'utf8');
    // Mutação que mata: `/propose` (o shim) ou `/approve` de volta no fio do cliente.
    expect(apiSource).not.toContain('/propose');
    expect(apiSource).not.toContain('/approve');
    expect(apiSource).not.toContain('propose(');
    expect(apiSource).not.toContain('approve(');
    expect(storeSource).not.toContain('partyActions.propose');
    expect(storeSource).not.toContain('partyActions.approve');
  });

  it('publish never carries a level range again (the configured state is what is published)', async () => {
    const apiSource = await readFile(new URL('./api.ts', import.meta.url), 'utf8');
    expect(apiSource).not.toContain('publish(partyId, characterId, range');
  });

  it('the typed refusals of the new contract become words in REFUSAL (RF-12)', async () => {
    const apiSource = await readFile(new URL('./api.ts', import.meta.url), 'utf8');
    expect(apiSource).toContain("'room-not-eligible': 'Você não pode entrar nesta sala.'");
    expect(apiSource).toContain("'no-vocation-slot': 'Nenhuma vaga para a sua vocação nesta sala.'");
    expect(apiSource).toContain("'composition-too-large'");
    expect(apiSource).toContain("'unknown-vocation'");
  });
});
