import { createElement, type ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { Events } from './Analyzer.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

/** A árvore em HTML, sem DOM, como em `Inventory.test.ts` e `Bestiary.test.ts`. */
async function render(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element);
  return new Response(prelude).text();
}

const catalogue: Catalogue = {
  hunts: [{ id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1, difficulties: ['cautious'], outfitIds: [], lootDrops: 0 }],
  monsters: [{ id: 'rat', name: 'Rato' }],
  ammunition: [], vocations: [], vocationLevel: 8,
  bot: {
    vocabularyVersion: 1, advancedFromLevel: 50, slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [], supplies: [{ id: 'mana-potion', name: 'Poção de Mana', price: 50, effect: 'mana', requires: {} }],
  },
  items: [],
  bestiary: { milestones: [10_000], xpBonusPercentPerMilestone: 1 },
};

const events = [
  { atMs: 0, type: 'entered-hunt', detail: 'rat-cellars/cautious' },
  { atMs: 1_000, type: 'supply-unaffordable', detail: 'mana-potion' },
  { atMs: 2_000, type: 'bestiary-milestone', detail: 'rat/1' },
];

beforeEach(() => { hud.set(() => INITIAL_HUD); });

describe('os eventos notáveis com os nomes do CATÁLOGO (FUN-110, FUN-113)', () => {
  it('hunt, supply e monstro saem com nome, e o marco com o bônus do catálogo', async () => {
    // Mutação que mata: apagar `monsters`, `supplies`, `hunts` ou `percentPerMilestone` da
    // montagem de `names` em `Events` — o evento sairia com o id cru.
    hud.set((state) => ({ ...state, catalogue }));
    const html = await render(createElement(Events, { events }));
    expect(html).toContain('Entrou em Rat Cellars · Cauteloso');
    expect(html).toContain('Gold acabou para Poção de Mana');
    expect(html).toContain('Bestiário: Rato · marco 1 (+1 % XP)');
  });

  it('sem catálogo os ids ficam no lugar dos nomes, e o marco sai sem bônus', async () => {
    const html = await render(createElement(Events, { events }));
    expect(html).toContain('Entrou em rat-cellars · Cauteloso');
    expect(html).toContain('Bestiário: rat · marco 1');
    expect(html).not.toContain('% XP');
  });
});
