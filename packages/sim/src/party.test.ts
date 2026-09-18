import { describe, expect, it } from 'vitest';
import type { Item, PartyConfig } from '@draconya/content';
import { settleBag, shareCostsOf, splitEqually, splitLootOf, uniqueVocations, xpPool, xpShare } from './party.js';
import type { PartyMember } from './party.js';

// As contas da party (#189, ADR 0027), por tabela. O que se prende aqui é a fórmula do
// `docs/party-hunt-plan.md` §3.3 — e que nada consome RNG nem sai de inteiro.

const config: PartyConfig = {
  id: 'baseline', maxMembers: 4, matchmakingLevelRange: 0,
  xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 },
};

const m = (id: string, vocationId: string | null = null): PartyMember => ({ id, vocationId });
const k = (id: string) => m(id, 'knight');
const d = (id: string) => m(id, 'druid');
const s = (id: string) => m(id, 'sorcerer');
const p = (id: string) => m(id, 'paladin');

describe('uniqueVocations', () => {
  it('counts distinct vocations, and "none" is one of them', () => {
    expect(uniqueVocations([])).toBe(0);
    expect(uniqueVocations([m('a'), m('b')])).toBe(1);
    expect(uniqueVocations([m('a'), k('b')])).toBe(2);
    expect(uniqueVocations([k('a'), k('b'), d('c')])).toBe(2);
    expect(uniqueVocations([k('a'), d('b'), s('c'), p('d')])).toBe(4);
  });
});

describe('xpShare — a tabela do plano (§3.3), monstro de 100 XP', () => {
  it.each<[string, PartyMember[], number, number]>([
    ['solo', [k('a')], 100, 100],
    ['knight + knight', [k('a'), k('b')], 125, 62],
    ['knight + druid', [k('a'), d('b')], 150, 75],
    ['knight + sem vocação', [k('a'), m('b')], 150, 75],
    ['sem vocação + sem vocação', [m('a'), m('b')], 125, 62],
    ['knight + druid + sorcerer', [k('a'), d('b'), s('c')], 175, 58],
    ['knight + druid + sorcerer + paladin', [k('a'), d('b'), s('c'), p('d')], 200, 50],
    ['4 únicas com um morto (3 elegíveis)', [k('a'), d('b'), s('c')], 175, 58],
    ['knight + knight + druid + druid', [k('a'), k('b'), d('c'), d('d')], 150, 37],
    ['ninguém elegível', [], 100, 0],
  ])('%s', (_name, eligible, pool, share) => {
    expect(xpPool(100, eligible, config)).toBe(pool);
    expect(xpShare(100, eligible, config)).toBe(share);
    expect(Number.isInteger(xpShare(100, eligible, config))).toBe(true);
  });

  it('rounds the pool down in integer arithmetic, and discards the remainder of the split', () => {
    // 7 × 175 / 100 = 12,25 → 12; 12 / 3 = 4 (nenhum ponto sobrando para o "último golpe").
    expect(xpPool(7, [k('a'), d('b'), s('c')], config)).toBe(12);
    expect(xpShare(7, [k('a'), d('b'), s('c')], config)).toBe(4);
    // Rato de 5 XP, party de quatro únicas: pool 10, cota 2 — o número do critério de saída.
    expect(xpShare(5, [k('a'), d('b'), s('c'), p('d')], config)).toBe(2);
  });

  it('solo never reads the table, and a missing key means no bonus', () => {
    // Mutação que mata: `eligible.length < 1` — o solo passaria a ler a linha "1" e render 125.
    expect(xpPool(100, [k('a')], { ...config, xpPoolPercentByUniqueVocations: { '1': 999 } })).toBe(100);
    expect(xpPool(100, [k('a'), d('b')], { ...config, xpPoolPercentByUniqueVocations: { '1': 125 } })).toBe(100);
  });
});

describe('splitEqually', () => {
  it('sums to the total, with the remainder one by one on the first shares', () => {
    expect(splitEqually(10, 4)).toEqual([3, 3, 2, 2]);
    expect(splitEqually(0, 3)).toEqual([0, 0, 0]);
    expect(splitEqually(5, 1)).toEqual([5]);
    expect(splitEqually(7, 3)).toEqual([3, 2, 2]);
    expect(splitEqually(9, 0)).toEqual([]);
    for (const [total, n] of [[1, 4], [99, 7], [1_000_000, 3]] as const) {
      expect(splitEqually(total, n).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('settleBag', () => {
  const catalog = new Map<string, Item>([
    ['sword', { id: 'sword', name: 'Sword', kind: 'weapon', weight: 30, value: 10, stackable: false, attack: 0, armor: 0, twoHanded: false, requires: {} } as unknown as Item],
    ['cheese', { id: 'cheese', name: 'Cheese', kind: 'other', weight: 4, value: 0, stackable: true, attack: 0, armor: 0, twoHanded: false, requires: {} } as unknown as Item],
  ]);

  it('sells what has a value, splits it with the remainder in order, and returns the rest unsold', () => {
    // 7 + 10 × 2 = 27 → [9, 9, 9]; o queijo não vira gold.
    const bag = {
      gold: 7, capacity: 400,
      items: [
        { instanceId: 's:1', itemId: 'sword', quantity: 2 },
        { instanceId: 's:2', itemId: 'cheese', quantity: 3 },
      ],
    };
    const settled = settleBag(bag, ['a', 'b', 'c'], catalog);
    expect(settled.total).toBe(27);
    expect([...settled.shares]).toEqual([['a', 9], ['b', 9], ['c', 9]]);
    expect(settled.unsold).toEqual([{ instanceId: 's:2', itemId: 'cheese', quantity: 3 }]);
    // E a bolsa NÃO é mutada aqui: quem zera é o ruleset, depois de entregar.
    expect(bag.items).toHaveLength(2);
    expect(bag.gold).toBe(7);
  });

  it('puts the remainder on the first present, and an item outside the catalog goes unsold', () => {
    const bag = { gold: 0, capacity: 0, items: [{ instanceId: 's:1', itemId: 'sword', quantity: 1 }, { instanceId: 's:9', itemId: 'ghost', quantity: 1 }] };
    const settled = settleBag(bag, ['b', 'a'], catalog);
    expect([...settled.shares]).toEqual([['b', 5], ['a', 5]]);
    expect(settleBag({ ...bag, gold: 1 }, ['b', 'a'], catalog).shares.get('b')).toBe(6);
    expect(settled.unsold.map((i) => i.itemId)).toEqual(['ghost']);
    expect(settleBag(bag, [], catalog).shares.size).toBe(0);
  });
});

describe('shareCostsOf and splitLootOf (#359)', () => {
  it('falls back to mode when axes are omitted', () => {
    expect(shareCostsOf({ mode: 'split' })).toBe(false);
    expect(splitLootOf({ mode: 'split' })).toBe(false);

    expect(shareCostsOf({ mode: 'shared' })).toBe(true);
    expect(splitLootOf({ mode: 'shared' })).toBe(true);
  });

  it('respects explicit overrides over mode fallback', () => {
    // Combination C: shareCosts: true, splitLoot: false
    expect(shareCostsOf({ mode: 'split', shareCosts: true, splitLoot: false })).toBe(true);
    expect(splitLootOf({ mode: 'split', shareCosts: true, splitLoot: false })).toBe(false);

    // Combination D: shareCosts: false, splitLoot: true
    expect(shareCostsOf({ mode: 'split', shareCosts: false, splitLoot: true })).toBe(false);
    expect(splitLootOf({ mode: 'split', shareCosts: false, splitLoot: true })).toBe(true);

    // Explicit false overrides shared mode
    expect(shareCostsOf({ mode: 'shared', shareCosts: false })).toBe(false);
    expect(splitLootOf({ mode: 'shared', splitLoot: false })).toBe(false);

    // Explicit true overrides split mode
    expect(shareCostsOf({ mode: 'split', shareCosts: true })).toBe(true);
    expect(splitLootOf({ mode: 'split', splitLoot: true })).toBe(true);
  });
});

