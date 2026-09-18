import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  HuntDetailsModal,
  lootItemsOf,
  monstersOf,
  pullSizeLabel,
  pullSizesOf,
} from './HuntDetailsModal.js';
import { currentHunt, setCurrentHunt } from './current-hunt.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue, HuntListing } from '../state/hud.js';

const ratMonster = {
  id: 'rat',
  name: 'Rat',
  health: 20,
  experience: 5,
};

const caveRatMonster = {
  id: 'cave-rat',
  name: 'Cave Rat',
  health: 30,
  experience: 10,
};

const cheeseItem = {
  id: 'cheese',
  name: 'Cheese',
  appearanceId: 3607,
  weight: 0.4,
  slot: null,
  twoHanded: false,
};

const goldCoinItem = {
  id: 'gold-coin',
  name: 'Gold Coin',
  appearanceId: 3031,
  weight: 0.1,
  slot: null,
  twoHanded: false,
};

const huntWithDesc: HuntListing = {
  id: 'rat-cellars',
  name: 'Rat Cellars',
  recommendedLevel: 1,
  difficulties: ['cautious', 'bold', 'reckless'],
  difficultyDetails: [
    { id: 'cautious', monsterCount: 2 },
    { id: 'bold', monsterCount: 5 },
    { id: 'reckless', monsterCount: 8 },
  ],
  outfitIds: [21],
  lootDrops: 2,
  description: 'Bueiro infestado de ratos sob Rookgaard.',
  monsters: [
    { id: 'rat', name: 'Rat' },
    { id: 'cave-rat', name: 'Cave Rat' },
  ],
  loot: [
    { itemId: 'cheese', name: 'Cheese' },
    { itemId: 'gold-coin', name: 'Gold Coin' },
  ],
};

const huntWithoutDesc: HuntListing = {
  ...huntWithDesc,
  description: undefined,
};

const catalogue: Catalogue = {
  hunts: [huntWithDesc],
  monsters: [ratMonster, caveRatMonster],
  ammunition: [],
  bot: {
    vocabularyVersion: 1,
    advancedFromLevel: 50,
    slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [],
    supplies: [],
  },
  items: [cheeseItem, goldCoinItem],
  vocations: [],
  vocationLevel: 8,
};

async function render(props: { open: boolean; onClose?: () => void }): Promise<string> {
  const { prelude } = await prerender(createElement(HuntDetailsModal, { onClose: () => {}, ...props }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue }));
  setCurrentHunt(null);
});

describe('HuntDetailsModal (#325, #349)', () => {
  it('RF-01: hunt with two monsters in catalogue shows name, health and XP for both', async () => {
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const html = await render({ open: true });

    expect(html).toContain('Rat');
    expect(html).toContain('Cave Rat');
    expect(html).toContain('Vida 20');
    expect(html).toContain('Exp 5');
    expect(html).toContain('Vida 30');
    expect(html).toContain('Exp 10');
  });

  it('RF-02: hunt with three difficulties shows pull sizes with count', async () => {
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const html = await render({ open: true });

    expect(html).toContain('Cauteloso · 2');
    expect(html).toContain('Ousado · 5');
    expect(html).toContain('Agressivo · 8');
  });

  it('RF-03: hunt with loot shows name of each item, without PEGAR, VENDER or rarity words', async () => {
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const html = await render({ open: true });

    expect(html).toContain('Cheese');
    expect(html).toContain('Gold Coin');
    const forbidden = ['PEGAR', 'VENDER', 'Raro', 'Comum', 'Incomum', 'Semi-raro'];
    for (const word of forbidden) {
      expect(html).not.toContain(word);
    }
  });

  it('RF-04a: hunt WITH description renders the description text', async () => {
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const html = await render({ open: true });

    expect(html).toContain('Bueiro infestado de ratos sob Rookgaard.');
    expect(html).toContain('hunt-details-desc');
  });

  it('RF-04b: hunt WITHOUT description does NOT render .hunt-details-desc or placeholder', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      catalogue: {
        ...catalogue,
        hunts: [huntWithoutDesc],
      },
    }));
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const html = await render({ open: true });

    expect(html).not.toContain('hunt-details-desc');
    expect(html).not.toContain('—');
  });

  it('RF-05: in neither state does the HTML contain forbidden estimate strings', async () => {
    const forbidden = ['Seu recorde', 'XP/h', 'gp/h', 'gold/h'];

    setCurrentHunt(null);
    const htmlEmpty = await render({ open: true });
    for (const phrase of forbidden) {
      expect(htmlEmpty).not.toContain(phrase);
    }

    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const htmlKnown = await render({ open: true });
    for (const phrase of forbidden) {
      expect(htmlKnown).not.toContain(phrase);
    }
  });

  it('RF-06: regression check that modal title, hunt name, recommended level and close button are present', async () => {
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const html = await render({ open: true });

    expect(html).toContain('Detalhes da caçada');
    expect(html).toContain(huntWithDesc.name);
    expect(html).toContain(`${String(huntWithDesc.recommendedLevel)}+`);
    expect(html).toContain('Fechar');
  });

  it('renders omission paragraph and no h2 when currentHunt is null', async () => {
    setCurrentHunt(null);
    const html = await render({ open: true });

    expect(html).toContain('Esta caçada foi aberta antes desta sessão do navegador');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('ui-stat-row');
  });

  it('renders nothing when open is false', async () => {
    const html = await render({ open: false });
    expect(html).toBe('');
  });
});

describe('pure helpers (#349)', () => {
  it('monstersOf filters out monsters not present in catalogue.monsters and preserves order', () => {
    const catalogueMonsters = [ratMonster, caveRatMonster];
    const hunt: HuntListing = {
      ...huntWithDesc,
      monsters: [
        { id: 'cave-rat', name: 'Cave Rat' },
        { id: 'unknown-monster', name: 'Unknown Monster' },
        { id: 'rat', name: 'Rat' },
      ],
    };
    expect(monstersOf(hunt, catalogueMonsters)).toEqual([caveRatMonster, ratMonster]);

    const huntWithMonsterIds = {
      ...huntWithDesc,
      monsterIds: ['rat', 'missing-id'],
    };
    expect(monstersOf(huntWithMonsterIds as unknown as HuntListing, catalogueMonsters)).toEqual([ratMonster]);
  });

  it('lootItemsOf filters out items not present in catalogue.items and preserves order', () => {
    const catalogueItems = [cheeseItem, goldCoinItem];
    const hunt: HuntListing = {
      ...huntWithDesc,
      loot: [
        { itemId: 'gold-coin', name: 'Gold Coin' },
        { itemId: 'unknown-item', name: 'Unknown Item' },
        { itemId: 'cheese', name: 'Cheese' },
      ],
    };
    expect(lootItemsOf(hunt, catalogueItems)).toEqual([goldCoinItem, cheeseItem]);

    const huntWithStringLoot = {
      ...huntWithDesc,
      loot: ['cheese', 'unknown-item'],
    };
    expect(lootItemsOf(huntWithStringLoot as unknown as HuntListing, catalogueItems)).toEqual([cheeseItem]);
  });

  it('pullSizesOf returns pull sizes in the exact order of hunt.difficulties and filters missing', () => {
    const customHunt: HuntListing = {
      ...huntWithDesc,
      difficulties: ['reckless', 'cautious', 'missing-diff'],
      difficultyDetails: [
        { id: 'cautious', monsterCount: 2 },
        { id: 'bold', monsterCount: 5 },
        { id: 'reckless', monsterCount: 8 },
      ],
    };
    expect(pullSizesOf(customHunt)).toEqual([
      { id: 'reckless', monsterCount: 8 },
      { id: 'cautious', monsterCount: 2 },
    ]);
  });

  it('pullSizeLabel formats pull size with localized difficulty and count', () => {
    expect(pullSizeLabel({ id: 'cautious', monsterCount: 2 })).toBe('Cauteloso · 2');
    expect(pullSizeLabel({ id: 'bold', monsterCount: 5 })).toBe('Ousado · 5');
    expect(pullSizeLabel({ id: 'reckless', monsterCount: 8 })).toBe('Agressivo · 8');
    expect(pullSizeLabel({ id: 'custom', monsterCount: 10 })).toBe('custom · 10');
  });
});
