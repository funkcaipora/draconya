import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyLootWindow } from './PartyBag.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

// "Party loot" (#316, RC-03): a bolsa compartilhada como janela flutuante, com título/meta do
// kit, grade FIXA 6×2 com o slot de GOLD, sem "cap reservado"/"valor est." e com o settlement
// real preservado como desvio consciente.

const catalogue = {
  hunts: [], monsters: [], ammunition: [], vocations: [], vocationLevel: 8,
  items: [{ id: 'sword', name: 'Espada', appearanceId: 3, weight: 30, slot: 'hand', twoHanded: false }],
  bot: { vocabularyVersion: 1, slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 }, spells: [], supplies: [] },
} as unknown as Catalogue;

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(PartyLootWindow, { onClose: () => {} }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me', catalogue }));
});

describe('PartyLootWindow (#316)', () => {
  it('does not exist in solo nor in split mode, nor without a bag', async () => {
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, party: { leaderId: 'me', mode: 'split', members: [] }, partyBag: { gold: 1, items: [], weight: 0, capacity: 10 } }));
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, party: { leaderId: 'me', mode: 'shared', members: [] }, partyBag: null }));
    expect(await render()).toBe('');
  });

  it('uses the kit title and the static meta, never weight/capacity in the meta', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: { gold: 27, items: [], weight: 60, capacity: 800 },
    }));
    const html = await render();
    expect(html).toContain('Party loot');
    expect(html).toContain('vendido e dividido ao fim');
    expect(html).not.toContain('60/800 oz · 27 gold');
  });

  it('renders a fixed 6×2 grid: items, the GOLD slot, and empty slots', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: {
        gold: 27,
        items: [{ instanceId: 's:1', itemId: 'sword', quantity: 2 }, { instanceId: 's:2', itemId: 'ghost', quantity: 1 }],
        weight: 60,
        capacity: 800,
      },
    }));
    const html = await render();
    expect(html).toContain('title="Espada"');
    expect(html).toContain('<b class="ui-slot-count">2</b>');
    expect(html).toContain('GOLD');
    expect(html).toContain('27');
    // 2 itens + GOLD + 9 vazios = 12 lugares.
    expect((html.match(/class="ui-slot[" ]/g) ?? []).length).toBe(12);
  });

  it('never shows "reservado" nor "valor est." (invariante 4)', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: { gold: 27, items: [], weight: 60, capacity: 800 },
    }));
    const html = await render();
    expect(html).not.toContain('reservado');
    expect(html).not.toContain('valor est.');
  });

  it('shows the kit explanatory note and the real last settlement', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: { gold: 27, items: [], weight: 60, capacity: 800 },
      lastSettlement: { total: 130, shares: [{ characterId: 'me', gold: 44 }] },
    }));
    const html = await render();
    expect(html).toContain('Cap = soma das capacidades dos membros, dividida entre eles. Ao fim da caçada a bolsa é vendida e o gold rateado.');
    expect(html).toContain('vendeu 130 gold · você levou 44');
    // O corpo traz o peso/capacidade real que saiu do meta.
    expect(html).toContain('800');
    expect(html).toContain('60 oz em uso');
  });
});
