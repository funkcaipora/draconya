import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { MODE_TEXT, PartyBag } from './PartyBag.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

// A bolsa compartilhada (#197, DS-14, #311): só em `shared`, com o que o servidor mandou — grade de
// `Slot`, barra de capacidade em uso, texto explicativo da capacidade e o último settlement dito
// para quem ficou, tudo com formatação pt-BR.

const catalogue = {
  hunts: [], monsters: [], ammunition: [], vocations: [], vocationLevel: 8,
  items: [{ id: 'sword', name: 'Espada', appearanceId: 3, weight: 30, slot: 'hand', twoHanded: false }],
  bot: { vocabularyVersion: 1, advancedFromLevel: 50, slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 }, advancedOnly: { conditions: [], targetPolicies: [], postures: [] }, spells: [], supplies: [] },
} as unknown as Catalogue;

async function render(collapsed = false): Promise<string> {
  const { prelude } = await prerender(createElement(PartyBag, { collapsed }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me', catalogue }));
});

describe('PartyBag', () => {
  it('does not exist in solo nor in split mode', async () => {
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, party: { leaderId: 'me', mode: 'split', members: [] }, partyBag: { gold: 1, items: [], weight: 0, capacity: 10 } }));
    expect(await render()).toBe('');
  });

  it('an empty bag says so, without a grid', async () => {
    hud.set((state) => ({ ...state, party: { leaderId: 'me', mode: 'shared', members: [] }, partyBag: { gold: 0, items: [], weight: 0, capacity: 500 } }));
    const html = await render();
    expect(html).toContain('vazia');
    expect(html).not.toContain('party-bag-grid');
  });

  it('shows items in a Slot grid, gold, weight over capacity with a bar, explanatory note, and last settlement with my share', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: { gold: 27, items: [{ instanceId: 's:1', itemId: 'sword', quantity: 2 }, { instanceId: 's:2', itemId: 'ghost', quantity: 1 }], weight: 60, capacity: 800 },
      lastSettlement: { total: 130, shares: [{ characterId: 'me', gold: 44 }, { characterId: 'b', gold: 43 }] },
    }));
    const html = await render();
    expect(html).toContain('Bolsa da party · Compartilhado');
    expect(html).toContain('60/800 oz · 27 gold');
    expect(html).toContain('title="Espada"');
    // O `Slot` do design system (DS-04, #247) mostra a contagem crua, sem prefixo "×" — a spec
    // desta issue foi escrita antes de `Slot.tsx` existir de fato; aqui se confere o real.
    expect(html).toContain('<b class="ui-slot-count">2</b>');
    expect(html).toContain('title="ghost"');
    expect(html).toContain('party-bag-cap-fill');
    expect(html).toContain('width:8%'); // 60/800 arredondado
    expect(html).toContain('Capacidade = soma das capacidades dos presentes · vendida e dividida ao sair alguém e no fim.');
    expect(html).toContain('vendeu 130 gold · você levou 44');
    // Minimizada: só o cabeçalho do Panel — o corpo (grade e settlement) some.
    const collapsed = await render(true);
    expect(collapsed).toContain('27 gold');
    expect(collapsed).not.toContain('Espada');
    expect(collapsed).not.toContain('party-bag-grid');
  });

  it('formats large numbers with pt-BR thousand separators (R3-17, RF-07)', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: { gold: 12345, items: [], weight: 6789, capacity: 9000 },
      lastSettlement: { total: 100000, shares: [{ characterId: 'me', gold: 50000 }] },
    }));
    const html = await render();
    expect(html).toContain('6.789/9.000 oz · 12.345 gold');
    expect(html).toContain('vendeu 100.000 gold · você levou 50.000');
  });

  it('MODE_TEXT maps mode to faithful pt-BR text (R3-14, RF-06)', () => {
    expect(MODE_TEXT.shared).toBe('Compartilhado');
    expect(MODE_TEXT.split).toBe('Dividido');
  });
});
