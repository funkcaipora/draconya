import { describe, expect, it } from 'vitest';
import type { ItemDefinition } from '../state/hud.js';
import { LOOT_SEARCH_RESULT_LIMIT, visibleLootItems } from './loot-filter.js';

function item(id: string, name: string): ItemDefinition {
  return { id, name, appearanceId: 1, weight: 1, slot: null, twoHanded: false };
}

const rat = item('rat-tail', 'Rat Tail');
const rope = item('rope', 'Rope');
const goldCoin = item('gold-coin', 'Gold Coin');
const wormArmor = item('worm-armor', 'Worm Armor');

describe('visibleLootItems (#764)', () => {
  it('sem busca e sem nada marcado, não desenha o catálogo inteiro — lista vazia', () => {
    const result = visibleLootItems([rat, rope, goldCoin, wormArmor], { itemIds: [], autoSell: [] }, '');
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('sem busca, os itens já marcados (itemIds OU autoSell) aparecem, na ordem do catálogo', () => {
    const result = visibleLootItems(
      [rat, rope, goldCoin, wormArmor],
      { itemIds: ['worm-armor'], autoSell: ['rope'] },
      '',
    );
    expect(result.rows.map((row) => row.id)).toEqual(['rope', 'worm-armor']);
  });

  it('com busca, os marcados continuam no topo e o resto do catálogo entra pelo nome', () => {
    const result = visibleLootItems(
      [rat, rope, goldCoin, wormArmor],
      { itemIds: ['gold-coin'], autoSell: [] },
      'ro',
    );
    // "gold-coin" está marcado e vem primeiro; só "Rope" casa com "ro" entre os não marcados.
    expect(result.rows.map((row) => row.id)).toEqual(['gold-coin', 'rope']);
  });

  it('busca é por nome, case-insensitive, e ignora espaço nas pontas', () => {
    const result = visibleLootItems([rat, rope, goldCoin], { itemIds: [], autoSell: [] }, '  ROPE  ');
    expect(result.rows.map((row) => row.id)).toEqual(['rope']);
  });

  it('item já marcado não aparece DUAS vezes quando o nome também casa com a busca', () => {
    const result = visibleLootItems(
      [rat, rope, goldCoin],
      { itemIds: ['rope'], autoSell: [] },
      'rope',
    );
    expect(result.rows.map((row) => row.id)).toEqual(['rope']);
    expect(result.rows).toHaveLength(1);
  });

  it('resultado da busca é cortado por `limit`, e `truncated` avisa quando sobrou item de fora', () => {
    const items = Array.from({ length: 60 }, (_value, index) => item(`item-${String(index)}`, `Sword ${String(index)}`));
    const result = visibleLootItems(items, { itemIds: [], autoSell: [] }, 'sword', 50);
    expect(result.rows).toHaveLength(50);
    expect(result.matchCount).toBe(60);
    expect(result.shownMatches).toBe(50);
    expect(result.truncated).toBe(true);
  });

  it('resultado que cabe no limite não é marcado como truncado', () => {
    const items = Array.from({ length: 10 }, (_value, index) => item(`item-${String(index)}`, `Sword ${String(index)}`));
    const result = visibleLootItems(items, { itemIds: [], autoSell: [] }, 'sword', 50);
    expect(result.truncated).toBe(false);
    expect(result.matchCount).toBe(10);
  });

  it('itens já marcados contam contra o limite da busca — a lista nunca passa de `limit` linhas', () => {
    const items = Array.from({ length: 60 }, (_value, index) => item(`item-${String(index)}`, `Sword ${String(index)}`));
    const result = visibleLootItems(items, { itemIds: ['item-0', 'item-1'], autoSell: [] }, 'sword', 50);
    expect(result.rows).toHaveLength(50);
    expect(result.shownMatches).toBe(48);
  });

  it('o limite padrão exportado é 50', () => {
    expect(LOOT_SEARCH_RESULT_LIMIT).toBe(50);
  });
});
