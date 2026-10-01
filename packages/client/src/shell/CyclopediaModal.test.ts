import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CyclopediaModal,
  bossEntryOf,
  categoryOf,
  entryOf,
  filterBosses,
  filterEntries,
  filterItems,
  itemsFooterNote,
  sortBosses,
  sortEntries,
} from './CyclopediaModal.js';
import type { CyclopediaTab } from './CyclopediaModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { BestiaryConfig, BosstiaryConfig, Catalogue, ItemDefinition, MonsterListing } from '../state/hud.js';
import type { BossListing } from './bosstiary-progress.js';

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
    hunts: [], monsters, ammunition: [], vocations: [], charms: [], vocationLevel: 8,
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
      monster: rat, kills: 50_000, progress: { reached: 0, next: null }, goal: 0, done: false,
      percent: 0, stage: null,
    });
  });

  it('derives the Canary stage from the entry the catalogue carries (#601, ADR 0053 d.1)', () => {
    const dragon: MonsterListing = {
      id: 'dragon',
      name: 'Dragon',
      bestiary: { stars: 3, occurrence: 0, firstUnlock: 50, secondUnlock: 500, toKill: 1_000, charmsPoints: 25 },
    };
    expect(entryOf(dragon, 0, config).stage).toBe(0);
    expect(entryOf(dragon, 50, config).stage).toBe(1);
    expect(entryOf(dragon, 500, config).stage).toBe(2);
    expect(entryOf(dragon, 1_000, config).stage).toBe(3);
    // Sem `bestiary` no catálogo (nó `game` anterior a esta issue), `null` — e não 0, que
    // afirmaria uma ficha travada que o servidor nunca declarou.
    expect(entryOf(rat, 1_000, config).stage).toBeNull();
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

  it('shows the Canary stage, difficulty stars, occurrence and Charm points (#601)', async () => {
    const dragon: MonsterListing = {
      id: 'dragon',
      name: 'Dragon',
      bestiary: { stars: 3, occurrence: 0, firstUnlock: 50, secondUnlock: 500, toKill: 1_000, charmsPoints: 25 },
    };
    hud.set((state) => ({
      ...state,
      catalogue: catalogue({ monsters: [...monsters, dragon] }),
      bestiary: { rat: 10_000, bat: 25_000, mite: 0, dragon: 1_000 },
    }));
    const html = await render();
    const text = visibleText(html);

    // A ficha completa do Dragon: estágio, estrelas e ocorrência aparecem à parte do marco
    // de XP (ADR 0053 d.2) — os dois vocabulários coexistem na mesma tela.
    expect(text).toContain('Completo');
    expect(text).toContain('★★★☆☆');
    expect(text).toContain('Comum');
    // Só o Dragon completou a ficha: os 25 pontos de Charm dele, nenhum dos outros três.
    expect(html).toContain('Pontos de Charm: <b>25</b>');
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

  it('renders a tablist with Itens, Bestiary, Bosstiary and Charms, Bestiary selected by default', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue() }));
    const html = await render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab" aria-selected="false" class="ui-tab">Itens</button>');
    expect(html).toContain('role="tab" aria-selected="true" class="ui-tab ui-tab-active">Bestiary</button>');
    // O Bosstiary saiu do papel no #629: a aba existe, mas só abre quando o jogador a escolhe.
    expect(html).toContain('role="tab" aria-selected="false" class="ui-tab">Bosstiary</button>');
    expect(html).not.toContain('Progresso no Bosstiary');
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

// O Bosstiary (#629, ADR 0052 d.1): registro cru do servidor + tabela do catálogo, nível derivado.
const bosstiaryConfig: BosstiaryConfig = {
  levels: {
    bane: [{ kills: 25, points: 5 }, { kills: 100, points: 15 }, { kills: 300, points: 30 }],
    archfoe: [{ kills: 5, points: 10 }, { kills: 20, points: 30 }, { kills: 60, points: 60 }],
    nemesis: [{ kills: 1, points: 10 }, { kills: 3, points: 30 }, { kills: 5, points: 60 }],
  },
};
const dreadmaw: MonsterListing = { id: 'dreadmaw', name: 'Dreadmaw', bosstiary: { rarity: 'nemesis', raceId: 639 } };
const ghazbaran: MonsterListing = { id: 'ghazbaran', name: 'Ghazbaran', bosstiary: { rarity: 'archfoe', raceId: 100 } };
const wildness: MonsterListing = { id: 'wildness', name: 'Wildness', bosstiary: { rarity: 'bane', raceId: 200 } };
const bosses: BossListing[] = [
  { id: 'dreadmaw', name: 'Dreadmaw', rarity: 'nemesis', raceId: 639 },
  { id: 'ghazbaran', name: 'Ghazbaran', rarity: 'archfoe', raceId: 100 },
  { id: 'wildness', name: 'Wildness', rarity: 'bane', raceId: 200 },
];

describe('Cyclopedia Bosstiary pure functions (#629)', () => {
  it('derives each boss level and next goal from the raw register and the catalogue table', () => {
    const kills = { '639': 3, '100': 4 };
    const [dread, ghaz, wild] = bosses.map((boss) => bossEntryOf(boss, kills, bosstiaryConfig));
    expect(dread?.progress).toMatchObject({ kills: 3, level: 2, nextKills: 5 });
    expect(ghaz?.progress).toMatchObject({ kills: 4, level: 0, nextKills: 5 });
    expect(wild?.progress).toMatchObject({ kills: 0, level: 0, nextKills: 25, percent: 0 });
  });

  it('filters by a case-insensitive name substring, and sorts by kills, name or rarity', () => {
    const kills = { '639': 1, '100': 9, '200': 1 };
    const entries = bosses.map((boss) => bossEntryOf(boss, kills, bosstiaryConfig));
    expect(filterBosses(entries, 'GHAZ').map((entry) => entry.boss.id)).toEqual(['ghazbaran']);
    expect(filterBosses(entries, '').map((entry) => entry.boss.id)).toEqual(['dreadmaw', 'ghazbaran', 'wildness']);
    expect(sortBosses(entries, 'kills').map((entry) => entry.boss.id)).toEqual(['ghazbaran', 'dreadmaw', 'wildness']);
    expect(sortBosses(entries, 'name').map((entry) => entry.boss.id)).toEqual(['dreadmaw', 'ghazbaran', 'wildness']);
    expect(sortBosses(entries, 'rarity').map((entry) => entry.boss.id)).toEqual(['dreadmaw', 'ghazbaran', 'wildness']);
  });
});

describe('CyclopediaModal Bosstiary tab (#629)', () => {
  const withBosses = (over: Partial<Catalogue> = {}) =>
    catalogue({ monsters: [...monsters, dreadmaw, ghazbaran, wildness], bosstiary: bosstiaryConfig, ...over });

  it('lists every boss with rarity, level and kills toward the next level, plus the boss points', async () => {
    hud.set((state) => ({
      ...state, catalogue: withBosses(), bosstiary: { kills: { '639': 3, '100': 20 }, points: 70 },
    }));
    const html = await render({ initialTab: 'Bosstiary' });
    const text = visibleText(html);

    expect(html).toContain('role="tab" aria-selected="true" class="ui-tab ui-tab-active">Bosstiary</button>');
    expect(text).toContain('Progresso no Bosstiary');
    expect(text).toContain('Todos os bosses do Bosstiary');
    for (const boss of bosses) expect(text).toContain(boss.name);
    // Dreadmaw (Nemesis) com 3 abates: nível 2, faltam 2 para os 5 do nível 3.
    expect(text).toContain('Nível 2/3');
    expect(text).toContain('3 / 5');
    // Ghazbaran (Archfoe) com 20 abates: nível 2 (o 2º degrau é 20), próximo é 60.
    expect(text).toContain('20 / 60');
    expect(html).toContain('Pontos de boss: <b>70</b>');
    expect(html).toContain('Bosses abatidos: <b>2 / 3</b>');
    expect(text).toContain('Nemesis');
    expect(text).toContain('Archfoe');
    expect(text).toContain('Bane');
    expect(text).toContain('3 bosses no Bosstiary');
  });

  it('a maxed boss shows a check instead of a next goal', async () => {
    hud.set((state) => ({
      ...state, catalogue: withBosses(), bosstiary: { kills: { '639': 9 }, points: 100 },
    }));
    const html = await render({ initialTab: 'Bosstiary' });
    const text = visibleText(html);
    expect(text).toContain('Nível 3/3');
    expect(text).toContain('✓ 9');
    expect(html).toContain('Nível máximo: <b>1</b>');
  });

  it('shows zeros and no NaN before the register arrives or without a level table', async () => {
    const { bosstiary: _bosstiary, ...withoutTable } = withBosses();
    hud.set((state) => ({ ...state, catalogue: withoutTable, bosstiary: null }));
    const html = await render({ initialTab: 'Bosstiary' });
    const text = visibleText(html);
    expect(html).toContain('Pontos de boss: <b>0</b>');
    expect(text).toContain('Nível 0/3');
    expect(text).not.toContain('Nível máximo');
    expect(text).not.toContain('NaN');
  });

  it('boss never appears in the Bestiary tab, and the Bestiary footer counts only common monsters', async () => {
    hud.set((state) => ({ ...state, catalogue: withBosses() }));
    const html = await render({ initialTab: 'Bestiary' });
    const text = visibleText(html);
    expect(text).toContain('Rat');
    expect(text).not.toContain('Dreadmaw');
    expect(text).not.toContain('Ghazbaran');
    expect(text).toContain('Bônus do Bestiário');
    expect(text).toContain('/ 15 marcos');
  });

  it('says so when the server has no boss instead of showing an empty list', async () => {
    hud.set((state) => ({ ...state, catalogue: catalogue() }));
    const text = visibleText(await render({ initialTab: 'Bosstiary' }));
    expect(text).toContain('Este servidor não tem Bosstiary.');
    expect(text).not.toContain('Progresso no Bosstiary');
  });

  it('a variant that shares the raceId is listed once, and its kills are the shared counter', async () => {
    const variant: MonsterListing = {
      id: 'dreadmaw-tamed', name: 'Dreadmaw Tamed', bosstiary: { rarity: 'nemesis', raceId: 639 },
    };
    hud.set((state) => ({
      ...state,
      catalogue: withBosses({ monsters: [...monsters, dreadmaw, variant] }),
      bosstiary: { kills: { '639': 2 }, points: 40 },
    }));
    const text = visibleText(await render({ initialTab: 'Bosstiary' }));
    expect(text).toContain('Dreadmaw');
    expect(text).not.toContain('Dreadmaw Tamed');
    expect(text).toContain('1 boss no Bosstiary');
  });
});
