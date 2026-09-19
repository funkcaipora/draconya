import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartyModal, RoomsTab, startRoomsPolling } from './PartyModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import { INITIAL_PARTY, PARTY_POLL_MS, party, setPartyClient } from '../party/store.js';
import type { PartyClient, PartyView, RoomView } from '../party/api.js';

// "Gerenciar party" (#320, RC-07): título "Party · N" do `party-state`, abas Formação/Na hunt,
// a Formação reaproveitando PartyPanel, a aba Na hunt com os mesmos dados de PartyMembers e o
// rodapé de status só na Formação.
//
// #404 acrescenta a terceira aba, "Encontrar Party": publicar/despublicar a sala do líder
// (RF-01), o polling de 2 s enquanto ela está montada (RF-02) e o "Entrar" desabilitado com o
// motivo (RF-03).

async function render(hunting: boolean): Promise<string> {
  const { prelude } = await prerender(createElement(PartyModal, { hunting, onClose: () => {} }));
  return new Response(prelude).text();
}

function partyView(members: ReadonlyArray<{ characterId: string; name: string; alive: boolean; healthPercent: number; vocationId: string | null }>): void {
  hud.set((state) => ({
    ...state,
    characterId: 'me',
    party: { leaderId: members[0]?.characterId ?? 'nobody', mode: 'shared', members: [...members] },
  }));
}

const formation = (over: Partial<PartyView> = {}): PartyView => ({
  id: 'p', leaderId: 'me', mode: 'split', huntId: 'arena', difficulty: 'bold',
  members: [{ characterId: 'me', name: 'Eu', approved: false }],
  published: false, minLevel: null, maxLevel: null, state: 'forming', sessionId: null, ...over,
});

const room = (over: Partial<RoomView> = {}): RoomView => ({
  partyId: 'party-9', huntId: 'arena', difficulty: 'bold',
  leader: { characterId: 'lead', name: 'Alice', level: 40 },
  vocations: [], members: 2, maxMembers: 8, minLevel: 10, maxLevel: 50, state: 'forming', ...over,
});

async function renderRooms(rooms: readonly RoomView[], current: PartyView | null): Promise<string> {
  const { prelude } = await prerender(createElement(RoomsTab, {
    rooms, current, me: 'me', myLevel: 20, busy: false,
  }));
  return new Response(prelude).text();
}

function fakeClient(over: Partial<PartyClient> = {}): PartyClient {
  const noop = async (): Promise<never> => { throw new Error('not used'); };
  return {
    create: noop, mine: noop, invite: noop, join: noop, leave: noop, kick: noop, propose: noop,
    approve: noop, start: noop, seek: noop, stopSeeking: noop, publish: noop, unpublish: noop,
    rooms: async () => [], decline: noop, ...over,
  };
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me' }));
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
  setPartyClient(null);
});

describe('PartyModal (#320)', () => {
  it('title counts the hud party-state, not the formation store', async () => {
    partyView([
      { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100, vocationId: null },
      { characterId: 'b', name: 'Ana', alive: true, healthPercent: 80, vocationId: null },
      { characterId: 'c', name: 'Cid', alive: true, healthPercent: 70, vocationId: null },
    ]);
    expect(await render(true)).toContain('Party · 3');
  });

  it('opens on "Na hunt" while hunting, "Formação" otherwise', async () => {
    expect(await render(true)).toMatch(/ui-tab-active">Na hunt/);
    expect(await render(false)).toMatch(/ui-tab-active">Formação/);
  });

  it('reuses PartyPanel in the Formação tab', async () => {
    const html = await render(false);
    expect(html).toContain('Criar party');
    expect(html).toContain('Procurar party');
  });

  it('has the third "Encontrar Party" tab (#404, D8)', async () => {
    const html = await render(false);
    expect(html).toContain('Encontrar Party');
  });

  it('lists companions in the Na hunt tab, with the leader star always golden and "caiu" for the fallen', async () => {
    partyView([
      { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80, vocationId: null },
      { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55, vocationId: null },
      { characterId: 'c', name: 'Cid', alive: false, healthPercent: 0, vocationId: null },
    ]);
    const html = await render(true);

    expect(html).toContain('party-modal-leader-star');
    expect(html).toContain('você');
    expect(html).toContain('80 %');
    expect(html).toContain('caiu');
    expect(html).toContain('party-modal-companion-down');
  });

  it('shows the footer status only on Formação with a formation', async () => {
    party.set(() => ({
      ...INITIAL_PARTY,
      characterId: 'me',
      party: formation({ members: [
        { characterId: 'me', name: 'Eu', approved: true },
        { characterId: 'b', name: 'Bob', approved: false },
      ] }),
    }));

    expect(await render(false)).toContain('Aguardando aprovação');
    expect(await render(true)).not.toContain('Aguardando aprovação');
  });

  it('says "Todos aprovaram" when everyone approved', async () => {
    party.set(() => ({
      ...INITIAL_PARTY,
      characterId: 'me',
      party: formation({ members: [
        { characterId: 'me', name: 'Eu', approved: true },
        { characterId: 'b', name: 'Bob', approved: true },
      ] }),
    }));

    expect(await render(false)).toContain('Todos aprovaram');
  });
});

describe('Encontrar Party (#404, D8)', () => {
  it('shows Publicar for an unpublished leader room and Despublicar once published (RF-01)', async () => {
    const unpublished = await renderRooms([], formation({ published: false }));
    expect(unpublished).toContain('Publicar');
    expect(unpublished).not.toContain('Despublicar');

    const published = await renderRooms([], formation({ published: true, minLevel: 10, maxLevel: 50 }));
    expect(published).toContain('Despublicar');
    expect(published).toContain('Sala publicada.');
  });

  it('hides the publish controls when not the leader or without a proposed hunt (RF-01)', async () => {
    const notLeader = await renderRooms([], formation({ leaderId: 'other' }));
    expect(notLeader).not.toContain('Publicar');

    const noHunt = await renderRooms([], formation({ huntId: null, difficulty: null }));
    expect(noHunt).not.toContain('Publicar');
  });

  it('disables "Entrar" with the exact reason: full room and level out of range (RF-03)', async () => {
    const html = await renderRooms([
      room({ partyId: 'full', members: 8, maxMembers: 8 }),
      room({ partyId: 'band', minLevel: 30, maxLevel: 50 }),
      room({ partyId: 'open' }),
    ], null);

    expect(html).toContain('Sala cheia');
    expect(html).toContain('Fora da faixa (30–50)');
    // Só a sala compatível tem o botão habilitado.
    expect((html.match(/<button[^>]*disabled[^>]*>Entrar<\/button>/g) ?? []).length).toBe(2);
    expect(html).toContain('Alice · LV 40 · 2/8');
  });

  it('polls rooms() every 2s while mounted and stops on cleanup (RF-02)', async () => {
    vi.useFakeTimers();
    try {
      const rooms = vi.fn<PartyClient['rooms']>().mockResolvedValue([]);
      setPartyClient(fakeClient({ rooms }));
      const set = vi.fn();
      const stop = startRoomsPolling(set);

      // O primeiro carregamento é imediato; o tick de 2 s traz o segundo.
      await vi.advanceTimersByTimeAsync(PARTY_POLL_MS);
      expect(rooms).toHaveBeenCalledTimes(2);

      stop();
      await vi.advanceTimersByTimeAsync(PARTY_POLL_MS * 3);
      expect(rooms).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
