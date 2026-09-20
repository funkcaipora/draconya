import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INITIAL_PARTY, fetchRooms, party, partyActions, partyEntered, setEnterHunt, setPartyCharacter, setPartyClient,
} from './store.js';
import type { PartyClient, PartyInviteView, PartyView, RoomView } from './api.js';

// A store da party (#197): cópia do formulário do servidor, e o momento de ENTRAR — quando
// chega um ticket (do `start` ou do polling), a hunt é o ticket oferecido à conexão, uma vez.
//
// M20 (#402/#403, #404): `join` discriminado (`formed`/`entered`), `invites[]` do `/mine`,
// `publish`/`unpublish` e `fetchRooms` (a listagem de OUTRAS parties, fora de `busy`).

const view = (over: Partial<PartyView> = {}): PartyView => ({
  id: 'party-1', leaderId: 'me', mode: 'split', huntId: null, difficulty: null,
  members: [{ characterId: 'me', name: 'Eu', approved: false }],
  published: false, minLevel: null, maxLevel: null, state: 'forming', sessionId: null, ...over,
});

const room = (over: Partial<RoomView> = {}): RoomView => ({
  partyId: 'party-9', huntId: 'arena', difficulty: 'bold',
  leader: { characterId: 'lead', name: 'Alice', level: 40 },
  vocations: [], members: 2, maxMembers: 8, minLevel: 10, maxLevel: 50, state: 'forming', ...over,
});

const invite = (over: Partial<PartyInviteView> = {}): PartyInviteView => ({
  partyId: 'party-9', leaderId: 'lead', leaderName: 'Alice', huntId: 'arena', state: 'forming', ...over,
});

function fakeClient(over: Partial<PartyClient> = {}): PartyClient {
  return {
    create: async () => view(),
    mine: async () => ({ party: view(), ticket: null, invites: [] }),
    invite: async () => {},
    join: async () => ({ kind: 'formed', party: view({ leaderId: 'other' }) }),
    leave: async () => {},
    kick: async () => view(),
    propose: async () => view({ huntId: 'arena', difficulty: 'bold' }),
    approve: async () => view(),
    start: async () => ({ sessionId: 's1', ticket: { ticket: 't', wsUrl: 'ws://n1/?ticket=t', expiresAtMs: 1, sessionId: 's1' } }),
    seek: async () => ({ party: null }),
    stopSeeking: async () => {},
    publish: async () => view({ published: true }),
    unpublish: async () => {},
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
    await partyActions.propose({ huntId: 'arena', difficulty: 'bold', mode: 'split' });
    expect(party.get().party?.huntId).toBe('arena');
    await partyActions.leave();
    expect(party.get().party).toBeNull();
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
    // O `session-state` da hunt chegou: a tela fecha.
    partyEntered();
    expect(party.get().entering).toBe(false);
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

  it('declineInvite calls the API and drops the invite from the list (D8)', async () => {
    const decline = vi.fn<PartyClient['decline']>().mockResolvedValue();
    setPartyCharacter('me');
    setPartyClient(fakeClient({ decline }));
    party.set((state) => ({ ...state, invites: [invite(), invite({ partyId: 'party-10' })] }));
    await partyActions.declineInvite('party-9');
    expect(decline).toHaveBeenCalledWith('party-9', 'me');
    expect(party.get().invites.map((entry) => entry.partyId)).toEqual(['party-10']);
  });

  it('publish and unpublish change the local copy of the room', async () => {
    const publish = vi.fn<PartyClient['publish']>().mockResolvedValue(
      view({ published: true, minLevel: 10, maxLevel: 20, huntId: 'arena', difficulty: 'bold' }),
    );
    setPartyCharacter('me');
    setPartyClient(fakeClient({ publish, create: async () => view({ huntId: 'arena', difficulty: 'bold' }) }));
    await partyActions.create();
    await partyActions.publish({ minLevel: 10, maxLevel: 20 });
    expect(publish).toHaveBeenCalledWith('party-1', 'me', { minLevel: 10, maxLevel: 20 });
    expect(party.get().party).toMatchObject({ published: true, minLevel: 10, maxLevel: 20 });

    await partyActions.unpublish();
    expect(party.get().party).toMatchObject({ published: false, minLevel: null, maxLevel: null });
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
    await partyActions.refresh();
    expect(entered).toEqual(['ws://n1/?ticket=t2']);
    expect(party.get().entering).toBe(true);
  });

  it('refresh brings the invites[] the server knows about (D8)', async () => {
    setPartyCharacter('me');
    setPartyClient(fakeClient({ mine: async () => ({ party: null, ticket: null, invites: [invite()] }) }));
    await partyActions.refresh();
    expect(party.get().invites).toHaveLength(1);
    expect(party.get().invites[0]?.leaderName).toBe('Alice');
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
      view({ members: [{ characterId: 'me', name: 'Eu', approved: false }] }),
    );
    setPartyClient(fakeClient({
      create: async () => view({
        members: [
          { characterId: 'me', name: 'Eu', approved: false },
          { characterId: 'target', name: 'Target', approved: false },
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

describe('find party: rooms (D8)', () => {
  it('fetchRooms without a client returns [] and never throws', async () => {
    setPartyClient(null);
    await expect(fetchRooms()).resolves.toEqual([]);
  });

  it('fetchRooms returns the server list and swallows a background failure', async () => {
    setPartyClient(fakeClient({ rooms: async () => [room()] }));
    await expect(fetchRooms()).resolves.toEqual([room()]);

    setPartyClient(fakeClient({ rooms: async () => { throw new Error('offline'); } }));
    await expect(fetchRooms()).resolves.toEqual([]);
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
