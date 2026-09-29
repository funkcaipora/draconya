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
  hunts: [], monsters: [], vocations: [], vocationLevel: 8,
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

  it('RF-05: shows total value and "Sua capacidade reservada" with the percent (v2)', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: {
        gold: 27, items: [], weight: 60, capacity: 800, value: 130,
        reservations: [
          { characterId: 'other', reserved: 10, available: 100 },
          { characterId: 'me', reserved: 30, available: 200 },
        ],
      },
    }));
    const html = await render();
    expect(html).toContain('Valor total');
    expect(html).toContain('130');
    expect(html).toContain('Sua capacidade reservada');
    // 30 / 200 = 15 %.
    expect(html).toContain('30 oz (15 %)');
  });

  it('RF-05: omits the reservation line when `me` has no entry (D8, never a fabricated zero)', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: {
        gold: 27, items: [], weight: 60, capacity: 800,
        reservations: [{ characterId: 'other', reserved: 10, available: 100 }],
      },
    }));
    const html = await render();
    expect(html).not.toContain('Sua capacidade reservada');
  });

  it('RF-05: omits the percent when available is 0, never divides by zero', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: {
        gold: 0, items: [], weight: 0, capacity: 800,
        reservations: [{ characterId: 'me', reserved: 0, available: 0 }],
      },
    }));
    const html = await render();
    expect(html).toContain('Sua capacidade reservada');
    expect(html).toContain('0 oz');
    expect(html).not.toContain('0 oz (');
  });

  it('RF-06: shows the OVERWEIGHT badge when true, and it disappears when false', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: { gold: 0, items: [], weight: 900, capacity: 800, overweight: true },
    }));
    const overweight = await render();
    expect(overweight).toContain('OVERWEIGHT');
    expect(overweight).toContain('party-loot-overweight');

    hud.set((state) => ({
      ...state,
      partyBag: { gold: 0, items: [], weight: 700, capacity: 800, overweight: false },
    }));
    const normal = await render();
    expect(normal).not.toContain('OVERWEIGHT');
  });

  it('omits the value row when `value` is undefined (node prior to #400)', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: { gold: 27, items: [], weight: 60, capacity: 800 },
    }));
    const html = await render();
    expect(html).not.toContain('Valor total');
    expect(html).not.toContain('Sua capacidade reservada');
  });

  it('mounts with `splitLoot` on even when `shareCosts` is off (v2 axes are independent)', async () => {
    // O `mode` derivado seria 'split' com os dois eixos independentes; a bolsa existe sse
    // `splitLoot` está ligado, então a janela NÃO pode usar `mode === 'shared'`.
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'split', shareCosts: false, splitLoot: true, members: [] },
      partyBag: { gold: 0, items: [], weight: 0, capacity: 800 },
    }));
    expect(await render()).not.toBe('');
  });

  it('caps the fixed 6×2 grid with a `+N` chip on overflow, never growing (DT-02)', async () => {
    const items = Array.from({ length: 13 }, (_, index) => ({
      instanceId: `s:${String(index)}`, itemId: 'sword', quantity: 1,
    }));
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: { gold: 0, items, weight: 0, capacity: 800 },
    }));
    const html = await render();
    // 10 itens desenhados + GOLD + chip = 12 lugares; 13 − 10 = +3.
    expect((html.match(/class="ui-slot[" ]/g) ?? []).length).toBe(12);
    expect(html).toContain('party-loot-overflow');
    expect(html).toContain('+3');
    expect(html).not.toContain('ui-slot--empty');
  });
});
