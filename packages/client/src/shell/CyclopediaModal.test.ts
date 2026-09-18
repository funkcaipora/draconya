import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CyclopediaModal,
  entryOf,
  filterEntries,
  sortEntries,
} from './CyclopediaModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { BestiaryConfig, Catalogue, MonsterListing } from '../state/hud.js';

const config: BestiaryConfig = {
  milestones: [10_000, 25_000, 50_000, 100_000, 200_000],
  xpBonusPercentPerMilestone: 1,
};

const rat: MonsterListing = { id: 'rat', name: 'Rat' };
const bat: MonsterListing = { id: 'bat', name: 'Bat' };
const mite: MonsterListing = { id: 'mite', name: 'Ácaro' };
const monsters: MonsterListing[] = [rat, bat, mite];

function catalogue(over: Partial<Catalogue> = {}): Catalogue {
  return {
    hunts: [], monsters, ammunition: [], vocations: [], vocationLevel: 8,
    bot: {
      vocabularyVersion: 1, advancedFromLevel: 50, slots: {},
      advancedOnly: { conditions: [], targetPolicies: [], postures: [] }, spells: [], supplies: [],
    },
    items: [], bestiary: config,
    ...over,
  };
}

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(CyclopediaModal, { onClose: () => {} }));
  return new Response(prelude).text();
}

/** O render estático põe comentários entre expressões JSX adjacentes; texto de leitura os ignora. */
function visibleText(html: string): string {
  return html.replace(/<!--.*?-->/g, '');
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD }));
});

describe('Cyclopedia entries (#321, RC-08)', () => {
  it('uses the next milestone as goal, then fills the bar after the last milestone', () => {
    expect(entryOf(rat, 9_999, config)).toMatchObject({ goal: 10_000, done: false });
    expect(entryOf(rat, 200_000, config)).toMatchObject({
      goal: 200_000, done: true, percent: 100, progress: { reached: 5, next: null },
    });
  });

  it('keeps real kills but no fictional goal without a Bestiary configuration', () => {
    expect(entryOf(rat, 50_000, null)).toEqual({
      monster: rat, kills: 50_000, progress: { reached: 0, next: null }, goal: 0, done: false, percent: 0,
    });
  });

  it('filters by a case-insensitive name substring without reordering a blank query', () => {
    const entries = [entryOf(rat, 0, config), entryOf(bat, 0, config), entryOf(mite, 0, config)];
    expect(filterEntries(entries, 'rAt').map((entry) => entry.monster.id)).toEqual(['rat']);
    expect(filterEntries(entries, '').map((entry) => entry.monster.id)).toEqual(['rat', 'bat', 'mite']);
    expect(filterEntries(entries, 'hydra')).toEqual([]);
  });

  it('sorts by kills, Portuguese name, or progress with reached milestones as a tie-breaker', () => {
    const entries = [entryOf(rat, 10_000, config), entryOf(bat, 50_000, config), entryOf(mite, 10_000, config)];
    expect(sortEntries(entries, 'kills').map((entry) => entry.monster.id)).toEqual(['bat', 'rat', 'mite']);
    expect(sortEntries(entries, 'name').map((entry) => entry.monster.id)).toEqual(['mite', 'bat', 'rat']);
    expect(sortEntries(entries, 'progress').map((entry) => entry.monster.id)).toEqual(['bat', 'rat', 'mite']);

    const samePercent = { milestones: [10, 20, 40], xpBonusPercentPerMilestone: 1 };
    const tied = [entryOf(rat, 10, samePercent), entryOf(bat, 20, samePercent)];
    expect(sortEntries(tied, 'progress').map((entry) => entry.monster.id)).toEqual(['bat', 'rat']);
  });
});

describe('CyclopediaModal', () => {
  it('shows loading and the explicit absent message instead of an empty Bestiary', async () => {
    const loading = await render();
    expect(loading).toContain('Cyclopedia');
    expect(loading).toContain('Carregando…');

    hud.set((state) => ({ ...state, catalogue: catalogue({ monsters: [] }) }));
    const absent = await render();
    expect(absent).toContain('Este servidor não tem Bestiário.');
    expect(absent).not.toContain('Progresso no Bestiário');
  });

  it('renders every catalogued monster, a global bonus, stars, and the grid controls', async () => {
    hud.set((state) => ({
      ...state, catalogue: catalogue(), bestiary: { rat: 10_000, bat: 25_000, mite: 0 },
    }));
    const html = await render();
    const text = visibleText(html);

    for (const monster of monsters) expect(text).toContain(monster.name);
    expect(text).toContain('10.000 / 25.000');
    expect(text).toContain('25.000 / 50.000');
    expect(text).toContain('★1');
    expect(text).toContain('★2');
    expect(text).toContain('Progresso no Bestiário');
    // O bônus soma o marco do rato e os dois do morcego, não só a entrada atual.
    expect(html).toContain('Bônus do Bestiário: +3 % de experiência (3 / 15 marcos)');
    expect(html).toContain('title="Grade"');
    expect(html).toContain('title="Lista"');
    expect(html).toContain('cyclopedia-modal-grid');
  });

  it('shows real kills without a progress box or a zero bonus when the server has no config', async () => {
    const { bestiary: _bestiary, ...withoutConfig } = catalogue();
    hud.set((state) => ({
      ...state, catalogue: withoutConfig, bestiary: { rat: 50_000, bat: 7 },
    }));
    const html = await render();
    const text = visibleText(html);

    expect(text).toContain('50.000 / 0');
    expect(text).toContain('3 monstros no Bestiário');
    expect(text).not.toContain('Progresso no Bestiário');
    expect(text).not.toContain('Bônus do Bestiário');
    expect(text).not.toContain('NaN');
  });

  it('renders no single-item tab bar or decorative pager', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue() }));
    const html = await render();
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toMatch(/página|pagin/i);
  });
});
