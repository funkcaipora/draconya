import { describe, expect, it } from 'vitest';
import type { BlessingPricing } from '@draconya/content';
import {
  blessingBit, blessingCost, blessingCount, hasBlessing, orderedBlessings, withBlessing,
} from './blessings.js';

// Os números do Canary (#570, `data/libs/systems/blessing.lua:148-166`,
// `config.lua.dist:496`), os mesmos do `packages/content/data/progression/baseline.json`.
const pricing: BlessingPricing = {
  freeBelowLevel: 21,
  flatUntilLevel: 30,
  flatPrice: 2000,
  highFromLevel: 120,
  midOffset: 20,
  midMultiplier: 200,
  midEnhancedMultiplier: 260,
  highBase: 20000,
  highEnhancedBase: 26000,
  highMultiplier: 75,
  highEnhancedMultiplier: 100,
};

describe('blessingCost — preço por level (#570, getBlessingCost do Canary)', () => {
  it('abaixo do level 21, toda bênção é grátis (Adventurer\'s Blessing)', () => {
    expect(blessingCost(1, false, pricing)).toBe(0);
    expect(blessingCost(20, false, pricing)).toBe(0);
    expect(blessingCost(20, true, pricing)).toBe(0);
  });

  it('do level 21 ao 30, o preço é fixo — regular e enhanced pagam o mesmo', () => {
    expect(blessingCost(21, false, pricing)).toBe(2000);
    expect(blessingCost(30, false, pricing)).toBe(2000);
    expect(blessingCost(30, true, pricing)).toBe(2000);
  });

  it('de 31 a 119, o preço é linear: 200×(level−20) regular, 260× enhanced', () => {
    expect(blessingCost(31, false, pricing)).toBe(200 * 11);
    expect(blessingCost(119, false, pricing)).toBe(200 * 99);
    expect(blessingCost(31, true, pricing)).toBe(260 * 11);
    expect(blessingCost(119, true, pricing)).toBe(260 * 99);
  });

  it('a partir de 120, a base sobe e o multiplicador cai: 20000+75×(level−120) regular', () => {
    expect(blessingCost(120, false, pricing)).toBe(20_000);
    expect(blessingCost(200, false, pricing)).toBe(20_000 + 75 * 80);
    expect(blessingCost(120, true, pricing)).toBe(26_000);
    expect(blessingCost(200, true, pricing)).toBe(26_000 + 100 * 80);
  });
});

describe('bitmask de bênçãos (#570)', () => {
  it('cada bênção é um bit pelo seu `order`, e a contagem é o popcount', () => {
    let mask = 0;
    expect(blessingCount(mask)).toBe(0);
    mask = withBlessing(mask, 3);
    expect(hasBlessing(mask, 3)).toBe(true);
    expect(hasBlessing(mask, 0)).toBe(false);
    expect(blessingCount(mask)).toBe(1);
    mask = withBlessing(mask, 0);
    mask = withBlessing(mask, 6);
    expect(blessingCount(mask)).toBe(3);
  });

  it('ligar o mesmo bit duas vezes é idempotente', () => {
    let mask = withBlessing(0, 2);
    mask = withBlessing(mask, 2);
    expect(blessingCount(mask)).toBe(1);
  });

  it('as sete bênçãos dão o bitmask cheio: 0b1111111 = 127', () => {
    let mask = 0;
    for (let order = 0; order < 7; order++) mask = withBlessing(mask, order);
    expect(mask).toBe(127);
    expect(blessingCount(mask)).toBe(7);
  });

  it('blessingBit é a potência de 2 do order', () => {
    expect(blessingBit(0)).toBe(1);
    expect(blessingBit(6)).toBe(64);
  });
});

describe('orderedBlessings — para a tela de compra (#570)', () => {
  it('ordena o catálogo pelo `order`, independente da ordem do mapa', () => {
    const catalog = new Map([
      ['b', { id: 'b', name: 'B', order: 1, enhanced: false }],
      ['a', { id: 'a', name: 'A', order: 0, enhanced: false }],
    ]);
    expect(orderedBlessings(catalog).map((blessing) => blessing.id)).toEqual(['a', 'b']);
  });
});
