import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_PARTY, party, partyActions, partyEntered, setEnterHunt, setPartyCharacter, setPartyClient } from './store.js';
import type { PartyClient, PartyView } from './api.js';

// A store da party (#197): cópia do formulário do servidor, e o momento de ENTRAR — quando
// chega um ticket (do `start` ou do polling), a hunt é o ticket oferecido à conexão, uma vez.

const view = (over: Partial<PartyView> = {}): PartyView => ({
  id: 'party-1', leaderId: 'me', mode: 'split', huntId: null, difficulty: null,
  members: [{ characterId: 'me', approved: false }], ...over,
});

function fakeClient(over: Partial<PartyClient> = {}): PartyClient {
  return {
    create: async () => view(),
    mine: async () => ({ party: view(), ticket: null }),
    invite: async () => {},
    join: async () => view({ leaderId: 'other' }),
    leave: async () => {},
    propose: async () => view({ huntId: 'arena', difficulty: 'bold' }),
    approve: async () => view(),
    start: async () => ({ sessionId: 's1', ticket: { ticket: 't', wsUrl: 'ws://n1/?ticket=t', expiresAtMs: 1, sessionId: 's1' } }),
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

  it('refresh follows the server: a ticket from another member starts the hunt, a 404 clears the form', async () => {
    const entered: string[] = [];
    setPartyCharacter('me');
    setEnterHunt((wsUrl) => { entered.push(wsUrl); });
    const mine = vi.fn<PartyClient['mine']>()
      .mockResolvedValueOnce({ party: view({ leaderId: 'other' }), ticket: null })
      .mockResolvedValueOnce({ party: null, ticket: { ticket: 't2', wsUrl: 'ws://n1/?ticket=t2', expiresAtMs: 1, sessionId: 's1' } });
    setPartyClient(fakeClient({ mine }));
    await partyActions.refresh();
    expect(party.get().party?.leaderId).toBe('other');
    await partyActions.refresh();
    expect(entered).toEqual(['ws://n1/?ticket=t2']);
    expect(party.get().entering).toBe(true);
  });

  it('a refusal lands in `error`, in words, and the draft stays', async () => {
    setPartyCharacter('me');
    setPartyClient(fakeClient({ create: async () => { throw new Error('Você já está numa party.'); } }));
    await partyActions.create();
    expect(party.get()).toMatchObject({ error: 'Você já está numa party.', busy: false, party: null });
  });
});
