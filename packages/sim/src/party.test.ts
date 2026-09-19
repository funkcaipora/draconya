import { describe, expect, it } from 'vitest';
import type { Item, PartyConfig } from '@draconya/content';
import {
  autoSellLimit, bagValue, reserveProportionally, settleEntries, shareCostsOf, splitEqually,
  splitLootOf, uniqueVocations, xpPool, xpShare,
} from './party.js';
import type { BagEntry, GoldEntry, MemberCapacity, PartyBagState, PartyMember } from './party.js';

// As contas da party (#189, ADR 0027), por tabela. O que se prende aqui é a fórmula do
// `docs/party-hunt-plan.md` §3.3 — e que nada consome RNG nem sai de inteiro.

const config: PartyConfig = {
  id: 'baseline', maxMembers: 8, matchmakingLevelRange: 0,
  xpPoolPercentByUniqueVocations: {
    '1': 125, '2': 150, '3': 175, '4': 200, '5': 200, '6': 200, '7': 200, '8': 200,
  },
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

  it('a tabela vai até 8, e o teto de 200 % se mantém', () => {
    // #392/#394: `maxMembers` é 8 e a tabela ganha "5".."8" = 200. Oito vocações únicas
    // (o teto do conteúdo real é 5, mas a tabela aceita até 8 chaves) não passam de 200 %.
    const eight = ['knight', 'druid', 'sorcerer', 'paladin', 'monk', 'a', 'b', 'c']
      .map((vocation, index) => m(`m${String(index)}`, vocation));
    expect(xpPool(100, eight, config)).toBe(200);
    expect(xpShare(100, eight, config)).toBe(25);
    expect(xpPool(100, [k('a'), d('b'), s('c'), p('d'), m('e', 'monk')], config)).toBe(200);
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

describe('settleEntries', () => {
  const catalogItem = (id: string, value: number): Item =>
    ({ id, name: id, kind: 'other', weight: 1, value, stackable: true } as unknown as Item);
  const catalog = new Map<string, Item>([
    ['sword', catalogItem('sword', 10)],
    ['cheese', catalogItem('cheese', 0)],
  ]);
  const carried = (itemId: string, quantity = 1, instanceId = `s:${itemId}`) =>
    ({ instanceId, itemId, quantity });
  const bag = (gold: GoldEntry[], items: BagEntry[], capacity = 400): PartyBagState =>
    ({ gold, items, capacity, overweight: false });

  it('autovenda: 30 gold entre 4 presentes → 8/8/7/7 (resto na ordem de entrada)', () => {
    const settled = settleEntries(
      bag([{ amount: 30, eligible: ['a', 'b', 'c', 'd'] }], []), ['a', 'b', 'c', 'd'], catalog,
    );
    expect([...settled.shares]).toEqual([['a', 8], ['b', 8], ['c', 7], ['d', 7]]);
    expect(settled.total).toBe(30);
  });

  it('elegibilidade: cada entrada paga só quem estava no drop (A50/B50/C0; Y 34/33/33)', () => {
    // X cai com A,B; C entra; B sai. O settlement inclui quem sai (eligible ∩ present).
    const x: BagEntry = { item: carried('sword', 10, 's:x'), eligible: ['a', 'b'] };
    const y: BagEntry = { item: carried('sword', 10, 's:y'), eligible: ['a', 'b', 'c'] };
    const settled = settleEntries(bag([], [x, y]), ['a', 'b', 'c'], catalog);
    expect(settled.shares.get('a')).toBe(84);
    expect(settled.shares.get('b')).toBe(83);
    expect(settled.shares.get('c')).toBe(33);
    expect(settled.total).toBe(200);

    // Só X: 100 entre A e B; C (que entrou depois) não recebe nada dela.
    const justX = settleEntries(bag([], [x]), ['a', 'b', 'c'], catalog);
    expect([...justX.shares]).toEqual([['a', 50], ['b', 50]]);
    expect(justX.shares.get('c')).toBeUndefined();
  });

  it('entrada MIGRADA (eligible: []) divide entre os presentes — a regra de hoje (D5)', () => {
    const settled = settleEntries(bag([{ amount: 9, eligible: [] }], []), ['a', 'b', 'c'], catalog);
    expect([...settled.shares]).toEqual([['a', 3], ['b', 3], ['c', 3]]);
  });

  it('item com value: 0 vai para unsold e não vira gold; fora do catálogo também', () => {
    const settled = settleEntries(bag([], [
      { item: carried('cheese', 3, 's:c'), eligible: ['a', 'b'] },
      { item: carried('ghost', 1, 's:g'), eligible: ['a', 'b'] },
    ]), ['a', 'b'], catalog);
    expect(settled.shares.size).toBe(0);
    expect(settled.total).toBe(0);
    expect(settled.unsold.map((i) => i.itemId)).toEqual(['cheese', 'ghost']);
  });

  it('a soma das cotas É o total, e a bolsa não é mutada', () => {
    const state = bag(
      [{ amount: 7, eligible: ['a', 'b'] }],
      [{ item: carried('sword', 2, 's:x'), eligible: ['a'] }],
    );
    const settled = settleEntries(state, ['a', 'b'], catalog);
    expect(settled.total).toBe(27);
    expect([...settled.shares.values()].reduce((sum, gold) => sum + gold, 0)).toBe(27);
    expect(state.gold).toHaveLength(1);
    expect(state.items).toHaveLength(1);
  });
});

describe('reserveProportionally (#396, plano §3)', () => {
  const cap = (id: string, available: number): MemberCapacity => ({ id, available });

  it('R_i = W × B_i / ΣB sobre a capacidade DISPONÍVEL (§12.1)', () => {
    // A 1 000, B 500, bolsa 300 → A 200, B 100 (20 % cada).
    const two = reserveProportionally(300, [cap('a', 1_000), cap('b', 500)]);
    expect(two.get('a')).toBe(200);
    expect(two.get('b')).toBe(100);

    // Três: 1 000 / 500 / 250, bolsa 700 → 400 / 200 / 100 (40 % cada).
    const three = reserveProportionally(700, [cap('a', 1_000), cap('b', 500), cap('c', 250)]);
    expect(three.get('a')).toBe(400);
    expect(three.get('b')).toBe(200);
    expect(three.get('c')).toBe(100);
    expect([...three.values()].reduce((sum, n) => sum + n, 0)).toBe(700);
  });

  it('em OVERWEIGHT cada um reserva no máximo a própria disponível, nunca o peso da bolsa', () => {
    const over = reserveProportionally(2_000, [cap('a', 1_000), cap('b', 500)]);
    expect(over.get('a')).toBe(1_000);
    expect(over.get('b')).toBe(500);
    // Σ reservas = Σ disponível, o excedente fica sem reserva de ninguém (§14).
    expect([...over.values()].reduce((sum, n) => sum + n, 0)).toBe(1_500);
  });

  it('disponível 0 (ou negativa) não gera reserva negativa nem NaN', () => {
    const zero = reserveProportionally(100, [cap('a', 0), cap('b', -50)]);
    expect([...zero.values()]).toEqual([0, 0]);
    for (const value of zero.values()) expect(Number.isFinite(value)).toBe(true);

    const empty = reserveProportionally(100, []);
    expect(empty.size).toBe(0);
  });

  it('peso 0 (ou negativo) reserva 0 para todos', () => {
    expect([...reserveProportionally(0, [cap('a', 1_000), cap('b', 500)]).values()]).toEqual([0, 0]);
    expect([...reserveProportionally(-5, [cap('a', 1_000)]).values()]).toEqual([0]);
  });
});

describe('bagValue (#396, PRD §10)', () => {
  const item = (id: string, value: number): Item =>
    ({ id, name: id, kind: 'other', weight: 1, value, stackable: true } as unknown as Item);
  const catalog = new Map<string, Item>([
    ['sword', item('sword', 10)],
    ['cheese', item('cheese', 0)],
  ]);
  const carried = (itemId: string, quantity = 1) => ({ instanceId: `s:${itemId}`, itemId, quantity });

  it('soma o gold da bolsa com value × quantity dos itens', () => {
    const state: PartyBagState = {
      gold: [{ amount: 7, eligible: ['a'] }],
      items: [
        { item: carried('sword', 2), eligible: ['a'] },
        { item: carried('cheese', 3), eligible: ['a'] },
      ],
      capacity: 0,
      overweight: false,
    };
    expect(bagValue(state, catalog)).toBe(27);
  });

  it('item com value 0 — ou fora do catálogo — não entra na conta', () => {
    const state: PartyBagState = {
      gold: [],
      items: [
        { item: carried('cheese', 5), eligible: ['a'] },
        { item: carried('ghost', 1), eligible: ['a'] },
      ],
      capacity: 0,
      overweight: false,
    };
    expect(bagValue(state, catalog)).toBe(0);
  });
});

describe('autoSellLimit (#395)', () => {
  const limits = { free: 5, premium: 20 };

  it('lê o Premium do LÍDER; a lista guarda 18 e só os 5 primeiros valem com free', () => {
    expect(autoSellLimit({ lead: true }, 'lead', limits)).toBe(20);
    expect(autoSellLimit({ lead: false }, 'lead', limits)).toBe(5);
    expect(autoSellLimit({}, 'lead', limits)).toBe(5);
    // O Premium de OUTRO membro não vale: o limite é do líder.
    expect(autoSellLimit({ b: true }, 'lead', limits)).toBe(5);
    const configured = Array.from({ length: 18 }, (_, i) => `i${String(i)}`);
    expect(configured.slice(0, autoSellLimit({}, 'lead', limits))).toHaveLength(5);
    expect(configured).toHaveLength(18);
  });

  it('sem o bloco de conteúdo, o limite é zero', () => {
    expect(autoSellLimit({ lead: true }, 'lead', undefined)).toBe(0);
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

