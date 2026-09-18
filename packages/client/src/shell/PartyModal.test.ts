import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyModal } from './PartyModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import { INITIAL_PARTY, party } from '../party/store.js';

// "Gerenciar party" (#320, RC-07): título "Party · N" do `party-state`, abas Formação/Na hunt,
// a Formação reaproveitando PartyPanel, a aba Na hunt com os mesmos dados de PartyMembers e o
// rodapé de status só na Formação.

async function render(hunting: boolean): Promise<string> {
  const { prelude } = await prerender(createElement(PartyModal, { hunting, onClose: () => {} }));
  return new Response(prelude).text();
}

function partyView(members: ReadonlyArray<{ characterId: string; name: string; alive: boolean; healthPercent: number }>): void {
  hud.set((state) => ({
    ...state,
    characterId: 'me',
    party: { leaderId: members[0]?.characterId ?? 'nobody', mode: 'shared', members: [...members] },
  }));
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me' }));
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
});

describe('PartyModal (#320)', () => {
  it('title counts the hud party-state, not the formation store', async () => {
    partyView([
      { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100 },
      { characterId: 'b', name: 'Ana', alive: true, healthPercent: 80 },
      { characterId: 'c', name: 'Cid', alive: true, healthPercent: 70 },
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

  it('lists companions in the Na hunt tab, with the leader star always golden and "caiu" for the fallen', async () => {
    partyView([
      { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80 },
      { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55 },
      { characterId: 'c', name: 'Cid', alive: false, healthPercent: 0 },
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
      party: { id: 'p', leaderId: 'me', huntId: null, difficulty: null, mode: 'split', members: [
        { characterId: 'me', approved: true },
        { characterId: 'b', approved: false },
      ] },
    }));

    expect(await render(false)).toContain('Aguardando aprovação');
    expect(await render(true)).not.toContain('Aguardando aprovação');
  });

  it('says "Todos aprovaram" when everyone approved', async () => {
    party.set(() => ({
      ...INITIAL_PARTY,
      characterId: 'me',
      party: { id: 'p', leaderId: 'me', huntId: null, difficulty: null, mode: 'split', members: [
        { characterId: 'me', approved: true },
        { characterId: 'b', approved: true },
      ] },
    }));

    expect(await render(false)).toContain('Todos aprovaram');
  });
});
