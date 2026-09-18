import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CyclopediaModal,
  categoryOf,
  entryOf,
  filterEntries,
  filterItems,
  itemsFooterNote,
  sortEntries,
} from './CyclopediaModal.js';
import type { CyclopediaTab } from './CyclopediaModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { BestiaryConfig, Catalogue, ItemDefinition, MonsterListing } from '../state/hud.js';

const config: BestiaryConfig = {
  milestones: [10_000, 25_000, 50_000, 100_000, 200_000],
  xpBonusPercentPerMilestone: 1,
};

const rat: MonsterListing = { id: 'rat', name: 'Rat' };
const bat: MonsterListing = { id: 'bat', name: 'Bat' };
const mite: MonsterListing = { id: 'mite', name: 'Ácaro' };
const monsters: MonsterListing[] = [rat, bat, mite];

const sword: ItemDefinition = {
  id: 'sword', name: 'Espada Longa', appearanceId: 101, weight: 35,
  slot: 'hand', twoHanded: false, attack: 24, armor: 0,
};
const shield: ItemDefinition = {
  id: 'shield', name: 'Escudo de Madeira', appearanceId: 102, weight: 40,
  slot: 'shield', twoHanded: false, attack: 0, armor: 4,
};
const cheese: ItemDefinition = {
  id: 'cheese', name: 'Queijo', appearanceId: 103, weight: 4,
  slot: null, twoHanded: false, attack: 0, armor: 0,
};
const machete: ItemDefinition = {
  id: 'machete', name: 'Machete', appearanceId: 104, weight: 16.5,
  slot: 'hand', twoHanded: false, attack: 12, armor: 0,
};
const items: ItemDefinition[] = [sword, shield, cheese, machete];

function catalogue(over: Partial<Catalogue> = {}): Catalogue {
  return {
    hunts: [], monsters, vocations: [], vocationLevel: 8,
    bot: {
      vocabularyVersion: 1, slots: {},
      spells: [], supplies: [],
    },
    items, bestiary: config,
    ...over,
  };
}

async function render(props?: { initialTab?: CyclopediaTab }): Promise<string> {
  const { prelude } = await prerender(createElement(CyclopediaModal, { onClose: () => {}, ...props }));
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

describe('Cyclopedia items pure functions (#344, SV-08)', () => {
  it('categoryOf maps known slots, falls back to the slot id, or returns Outros when null', () => {
    expect(categoryOf(sword)).toBe('Mão');
    expect(categoryOf(shield)).toBe('Escudo');
    expect(categoryOf(cheese)).toBe('Outros');
    expect(categoryOf({ ...sword, slot: 'head' })).toBe('Cabeça');
    expect(categoryOf({ ...sword, slot: 'neck' })).toBe('Pescoço');
    expect(categoryOf({ ...sword, slot: 'chest' })).toBe('Peito');
    expect(categoryOf({ ...sword, slot: 'legs' })).toBe('Pernas');
    expect(categoryOf({ ...sword, slot: 'feet' })).toBe('Pés');
    expect(categoryOf({ ...sword, slot: 'finger' })).toBe('Dedo');
    expect(categoryOf({ ...sword, slot: 'ammo' })).toBe('Munição');
    expect(categoryOf({ ...sword, slot: 'back' })).toBe('Mochila');
    expect(categoryOf({ ...sword, slot: 'custom_slot' })).toBe('custom_slot');
  });

  it('filterItems filters by a case-insensitive name substring without reordering a blank query', () => {
    expect(filterItems(items, 'eSPaDa').map((item) => item.id)).toEqual(['sword']);
    expect(filterItems(items, 'e').map((item) => item.id)).toEqual(['sword', 'shield', 'cheese', 'machete']);
    expect(filterItems(items, '').map((item) => item.id)).toEqual(['sword', 'shield', 'cheese', 'machete']);
    expect(filterItems(items, 'inexistente')).toEqual([]);
  });

  it('itemsFooterNote formats the total count, or the filtered count out of the total', () => {
    expect(itemsFooterNote(items, '')).toBe('4 itens no catálogo');
    expect(itemsFooterNote(items, 'espada')).toBe('1 de 4 itens');
    expect(itemsFooterNote(items, 'inexistente')).toBe('0 de 4 itens');
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

  it('renders a tablist with exactly Itens and Bestiary, Bestiary selected by default', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue() }));
    const html = await render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab" aria-selected="false" class="ui-tab">Itens</button>');
    expect(html).toContain('role="tab" aria-selected="true" class="ui-tab ui-tab-active">Bestiary</button>');
    expect(html).not.toContain('Bosstiary');
    expect(html).not.toMatch(/página|pagin/i);
    expect(html).toContain('Todas as entradas do Bestiário');
    expect(html).not.toContain('cyclopedia-modal-items-list');
  });

  it('renders the Items tab when initialTab is Itens, with a row per catalogued item', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue() }));
    const html = await render({ initialTab: 'Itens' });
    expect(html).toContain('role="tab" aria-selected="true" class="ui-tab ui-tab-active">Itens</button>');
    expect(html).toContain('role="tab" aria-selected="false" class="ui-tab">Bestiary</button>');
    expect(html).toContain('cyclopedia-modal-items-list');
    expect(html).not.toContain('Todas as entradas do Bestiário');

    expect(html).toContain('cyclopedia-modal-item-row');
    expect(html).toContain('cyclopedia-modal-item-sprite');
    for (const item of items) expect(html).toContain(item.name);
    expect(html).toContain('cyclopedia-modal-item-category">Mão<');
    expect(html).toContain('cyclopedia-modal-item-category">Escudo<');
    expect(html).toContain('cyclopedia-modal-item-category">Outros<');
  });

  it('renders the attack badge only when attack is greater than zero', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue() }));
    const html = await render({ initialTab: 'Itens' });
    expect(html).toContain('⚔ Atq 24');
    expect(html).toContain('⚔ Atq 12');
    expect(html).not.toContain('⚔ Atq 0');
  });

  it('renders the armor badge only when armor is greater than zero', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue() }));
    const html = await render({ initialTab: 'Itens' });
    expect(html).toContain('⛨ Def 4');
    expect(html).not.toContain('⛨ Def 0');
  });

  it('formats weight in pt-BR with up to two decimal digits', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue() }));
    const html = await render({ initialTab: 'Itens' });
    expect(html).toContain('⚖ 16,5 oz');
    expect(html).toContain('⚖ 35 oz');
  });

  it('renders a single shared search input above the tabs for both tabs', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue() }));
    const bestiaryHtml = await render({ initialTab: 'Bestiary' });
    expect(bestiaryHtml).toContain('class="ui-input ui-input-sm cyclopedia-modal-search"');
    expect(bestiaryHtml).toContain('placeholder="Digite para buscar…"');

    const itemsHtml = await render({ initialTab: 'Itens' });
    expect(itemsHtml).toContain('class="ui-input ui-input-sm cyclopedia-modal-search"');
    expect(itemsHtml).toContain('placeholder="Digite para buscar…"');
  });

  it('shows the empty message when the item catalogue is empty', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue({ items: [] }) }));
    const html = await render({ initialTab: 'Itens' });
    expect(html).toContain('Nenhum item encontrado.');
  });

  it('shows itemsFooterNote on the Itens tab, never the Bestiary note or kit mock pagination', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue() }));
    const html = await render({ initialTab: 'Itens' });
    expect(html).toContain('4 itens no catálogo');
    expect(html).not.toContain('Bônus do Bestiário');
    expect(html).not.toMatch(/1 – 8 de 867/);
  });
});
