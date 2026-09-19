import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Catalogue, HuntListing } from '../state/hud.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import {
  HuntDetailsModal, lootItemsOf, monstersOf, pullSizeLabel, pullSizesOf,
} from './HuntDetailsModal.js';

const ratMonster = { id: 'rat', name: 'Rat', health: 20, experience: 5 };
const caveRatMonster = { id: 'cave-rat', name: 'Cave Rat', health: 30, experience: 10 };

const cheeseItem = {
  id: 'cheese', name: 'Cheese', appearanceId: 3607, weight: 0.4, slot: null, twoHanded: false,
};
const goldCoinItem = {
  id: 'gold-coin', name: 'Gold Coin', appearanceId: 3031, weight: 0.1, slot: null, twoHanded: false,
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

const huntWithoutDesc: HuntListing = { ...huntWithDesc, description: undefined };

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
});

describe('HuntDetailsModal (#325, #349, SV-05, SV-13)', () => {
  it('RF-01: hunt with two monsters in catalogue shows name, health and XP for both', async () => {
    hud.set((state) => ({ ...state, huntId: 'rat-cellars', difficulty: 'bold' }));
    const html = await render({ open: true });

    expect(html).toContain('Rat');
    expect(html).toContain('Cave Rat');
    expect(html).toContain('Vida 20');
    expect(html).toContain('Exp 5');
    expect(html).toContain('Vida 30');
    expect(html).toContain('Exp 10');
  });

  it('RF-02: hunt with three difficulties shows pull sizes with count', async () => {
    hud.set((state) => ({ ...state, huntId: 'rat-cellars', difficulty: 'bold' }));
    const html = await render({ open: true });

    expect(html).toContain('Cauteloso · 2');
    expect(html).toContain('Ousado · 5');
    expect(html).toContain('Agressivo · 8');
  });

  it('RF-03: hunt with loot shows name of each item, without PEGAR, VENDER or rarity words', async () => {
    hud.set((state) => ({ ...state, huntId: 'rat-cellars', difficulty: 'bold' }));
    const html = await render({ open: true });

    expect(html).toContain('Cheese');
    expect(html).toContain('Gold Coin');
    const forbidden = ['PEGAR', 'VENDER', 'Raro', 'Comum', 'Incomum', 'Semi-raro'];
    for (const word of forbidden) expect(html).not.toContain(word);
  });

  it('RF-04a: hunt WITH description renders the description text', async () => {
    hud.set((state) => ({ ...state, huntId: 'rat-cellars', difficulty: 'bold' }));
    const html = await render({ open: true });

    expect(html).toContain('Bueiro infestado de ratos sob Rookgaard.');
    expect(html).toContain('hunt-details-desc');
  });

  it('RF-04b: hunt WITHOUT description does NOT render .hunt-details-desc or a placeholder dash', async () => {
    hud.set((state) => ({
      ...state, huntId: 'rat-cellars', difficulty: 'bold',
      catalogue: { ...catalogue, hunts: [huntWithoutDesc] },
    }));
    const html = await render({ open: true });

    expect(html).not.toContain('hunt-details-desc');
  });

  it('RF-05: in neither state does the HTML contain forbidden estimate strings', async () => {
    const forbidden = ['Seu recorde', 'XP/h', 'gp/h', 'gold/h'];

    const htmlEmpty = await render({ open: true });
    for (const phrase of forbidden) expect(htmlEmpty).not.toContain(phrase);

    hud.set((state) => ({ ...state, huntId: 'rat-cellars', difficulty: 'bold' }));
    const htmlKnown = await render({ open: true });
    for (const phrase of forbidden) expect(htmlKnown).not.toContain(phrase);
  });

  it('RF-06: regression check that modal title, hunt name, recommended level and close button are present', async () => {
    hud.set((state) => ({ ...state, huntId: 'rat-cellars', difficulty: 'bold' }));
    const html = await render({ open: true });

    expect(html).toContain('Detalhes da caçada');
    expect(html).toContain(huntWithDesc.name);
    expect(html).toContain(`${String(huntWithDesc.recommendedLevel)}+`);
    expect(html).toContain('Fechar');
  });

  it('renders the omission paragraph and no h2 when hud.huntId is null', async () => {
    const html = await render({ open: true });

    expect(html).toContain('Não foi possível identificar a caçada atual.');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('ui-stat-row');
  });

  it('renders the same omission when hud.huntId points to a hunt absent from the catalogue', async () => {
    // Reconexão trocou o catálogo, ou um nó `game` anterior à SV-05: o id não bate com nada.
    hud.set((state) => ({ ...state, huntId: 'an-old-hunt-gone-after-reconnect', difficulty: 'bold' }));
    const html = await render({ open: true });

    expect(html).toContain('Não foi possível identificar a caçada atual.');
    expect(html).not.toContain('Rat Cellars');
  });

  it('uses the same omission while the catalogue has not arrived', async () => {
    hud.set((state) => ({ ...state, huntId: 'rat-cellars', difficulty: 'bold', catalogue: null }));
    const html = await render({ open: true });

    expect(html).toContain('Não foi possível identificar a caçada atual.');
    expect(html).not.toContain('Rat Cellars');
  });

  it('renders nothing when open is false', async () => {
    const html = await render({ open: false });
    expect(html).toBe('');
  });
});

describe('configuração de loot da party (#405, ADR 0033 D2)', () => {
  // Só há config com party E `splitLoot` ligado: sem bolsa compartilhada não há o que
  // configurar. `value: 0` é ignorado pelo servidor (D2).
  const member = { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100, vocationId: null };
  const party = {
    leaderId: 'me', mode: 'shared' as const, shareCosts: true, splitLoot: true,
    loot: { collect: null, autoSell: [], autoSellLimit: 5, leaderPremium: false },
    members: [member],
  };
  const cheeseWithValue = { ...cheeseItem, value: 5 };

  function setState(over: Partial<{ party: unknown; items: Catalogue['items'] }> = {}): void {
    hud.set((state) => ({
      ...state,
      characterId: 'me',
      huntId: 'rat-cellars',
      difficulty: 'bold',
      catalogue: { ...catalogue, items: over.items ?? [cheeseWithValue] },
      party: (over.party ?? party) as never,
    }));
  }

  it('RF-03/04: the leader sees PEGAR/VENDER per item and "Venda automática: N / limite"', async () => {
    setState();
    const html = await render({ open: true });
    expect(html).toContain('Configuração de loot da party');
    expect(html).toContain('PEGAR');
    expect(html).toContain('VENDER');
    expect(html).toContain('Venda automática: 0 / 5');
    // Líder com `collect: null` e item vendável: os dois nascem habilitados.
    expect(html).not.toContain('aria-disabled="true"');
  });

  it('RF-03: `value: 0` leaves VENDER disabled (D2)', async () => {
    setState({ items: [{ ...cheeseItem, value: 0 }] });
    const html = await render({ open: true });
    // PEGAR habilitado, VENDER desabilitado: exatamente um `aria-disabled`.
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(1);
  });

  it('RF-03: a member sees PEGAR and VENDER disabled', async () => {
    setState({ party: { ...party, leaderId: 'lead', members: [
      { ...member, characterId: 'lead' }, member,
    ] } });
    const html = await render({ open: true });
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(2);
  });

  it('RF-03: VENDER is disabled for an item that is not collected', async () => {
    setState({ party: { ...party, loot: { ...party.loot, collect: [] } } });
    const html = await render({ open: true });
    // PEGAR habilitado (dá para marcar), VENDER desabilitado (não coletado).
    expect((html.match(/aria-disabled="true"/g) ?? []).length).toBe(1);
  });

  it('hides the loot config without `splitLoot`, or without the `loot` block (DT-01)', async () => {
    setState({ party: { ...party, mode: 'split', shareCosts: false, splitLoot: false } });
    expect(await render({ open: true })).not.toContain('Configuração de loot da party');

    setState({ party: { ...party, loot: undefined } });
    expect(await render({ open: true })).not.toContain('Configuração de loot da party');
  });

  it('RF-03: unchecking PEGAR with `collect: null` sends every item except it, and clears autoSell', async () => {
    // Sem DOM, a regra de borda se prova pela costura: o ramo `collect === null` vira a lista
    // explícita de todos MENOS este, e o `autoSell` acompanha.
    const source = await readFile(new URL('./HuntDetailsModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain("sendIntent({ type: 'party-settings'");
    expect(source).toContain('collect === null');
    expect(source).toContain('autoSell: checked ? autoSell : autoSell.filter');
  });
});

describe('pure helpers (#349)', () => {
  it('monstersOf filters out monsters not present in catalogue.monsters and preserves order', () => {
    const catalogueMonsters = [ratMonster, caveRatMonster];
    const huntOrder: HuntListing = {
      ...huntWithDesc,
      monsters: [
        { id: 'cave-rat', name: 'Cave Rat' },
        { id: 'unknown-monster', name: 'Unknown Monster' },
        { id: 'rat', name: 'Rat' },
      ],
    };
    expect(monstersOf(huntOrder, catalogueMonsters)).toEqual([caveRatMonster, ratMonster]);
  });

  it('lootItemsOf filters out items not present in catalogue.items and preserves order', () => {
    const catalogueItems = [cheeseItem, goldCoinItem];
    const huntOrder: HuntListing = {
      ...huntWithDesc,
      loot: [
        { itemId: 'gold-coin', name: 'Gold Coin' },
        { itemId: 'unknown-item', name: 'Unknown Item' },
        { itemId: 'cheese', name: 'Cheese' },
      ],
    };
    expect(lootItemsOf(huntOrder, catalogueItems)).toEqual([goldCoinItem, cheeseItem]);
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

  it('pullSizesOf returns an empty list for a node prior to SV-19 (empty difficultyDetails)', () => {
    const rolledBack: HuntListing = { ...huntWithDesc, difficultyDetails: [] };
    expect(pullSizesOf(rolledBack)).toEqual([]);
  });

  it('pullSizeLabel formats pull size with localized difficulty and count', () => {
    expect(pullSizeLabel({ id: 'cautious', monsterCount: 2 })).toBe('Cauteloso · 2');
    expect(pullSizeLabel({ id: 'bold', monsterCount: 5 })).toBe('Ousado · 5');
    expect(pullSizeLabel({ id: 'reckless', monsterCount: 8 })).toBe('Agressivo · 8');
    expect(pullSizeLabel({ id: 'custom', monsterCount: 10 })).toBe('custom · 10');
  });
});
