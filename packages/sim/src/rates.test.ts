import { describe, expect, it } from 'vitest';
import { NEUTRAL_RATES, ratesSchema } from '@draconya/content';
import {
  applyAttackRate, applyRate, creatureRatesFor, experienceRateFor, rateFromStages, skillRateFor,
} from './rates.js';

// Os `experienceStages` de exemplo do `data/stages.lua` do Canary.
const canaryStages = [
  { minLevel: 1, maxLevel: 8, multiplier: 7 },
  { minLevel: 9, maxLevel: 20, multiplier: 6 },
  { minLevel: 21, maxLevel: 50, multiplier: 5 },
  { minLevel: 51, maxLevel: 100, multiplier: 4 },
  { minLevel: 101, multiplier: 2 },
];

describe('rateFromStages', () => {
  it('acha a faixa que contém o level, com maxLevel inclusivo', () => {
    expect(rateFromStages(canaryStages, 1, 1)).toBe(7);
    expect(rateFromStages(canaryStages, 8, 1)).toBe(7);
    expect(rateFromStages(canaryStages, 9, 1)).toBe(6);
    expect(rateFromStages(canaryStages, 100, 1)).toBe(4);
  });

  it('a faixa sem maxLevel é aberta para cima', () => {
    expect(rateFromStages(canaryStages, 101, 1)).toBe(2);
    expect(rateFromStages(canaryStages, 2_000, 1)).toBe(2);
  });

  it('fora de toda faixa cai no fallback', () => {
    expect(rateFromStages(canaryStages, 0, 3)).toBe(3);
    expect(rateFromStages([{ minLevel: 10, maxLevel: 20, multiplier: 5 }], 21, 1.5)).toBe(1.5);
    expect(rateFromStages([], 50, 4)).toBe(4);
  });

  it('a primeira faixa que contém o level vence', () => {
    const overlapping = [
      { minLevel: 1, maxLevel: 10, multiplier: 3 },
      { minLevel: 5, maxLevel: 20, multiplier: 9 },
    ];
    expect(rateFromStages(overlapping, 7, 1)).toBe(3);
  });
});

describe('experienceRateFor', () => {
  it('sem stages é o rate simples', () => {
    expect(experienceRateFor(NEUTRAL_RATES, 5)).toBe(1);
    expect(experienceRateFor(ratesSchema.parse({ experience: 2 }), 5)).toBe(2);
  });

  it('com useStages usa a faixa do level; desligado ignora a tabela', () => {
    const on = ratesSchema.parse({ useStages: true, experience: 1, experienceStages: canaryStages });
    expect(experienceRateFor(on, 5)).toBe(7);
    expect(experienceRateFor(on, 9)).toBe(6);
    const off = ratesSchema.parse({ useStages: false, experience: 1, experienceStages: canaryStages });
    expect(experienceRateFor(off, 5)).toBe(1);
  });
});

describe('skillRateFor', () => {
  const rates = ratesSchema.parse({
    useStages: true, skill: 2, magic: 3,
    skillStages: [{ minLevel: 10, maxLevel: 60, multiplier: 5 }],
    magicLevelStages: [{ minLevel: 0, maxLevel: 3, multiplier: 8 }, { minLevel: 4, multiplier: 4 }],
  });

  it("'magic' usa magic e magicLevelStages", () => {
    expect(skillRateFor(rates, 'magic', 3)).toBe(8);
    expect(skillRateFor(rates, 'magic', 4)).toBe(4);
  });

  it('as outras skills usam skill e skillStages, com fallback fora de faixa', () => {
    expect(skillRateFor(rates, 'melee', 10)).toBe(5);
    expect(skillRateFor(rates, 'melee', 61)).toBe(2);
    expect(skillRateFor(rates, 'distance', 9)).toBe(2);
  });

  it('sem useStages é o rate simples de cada lado', () => {
    const off = { ...rates, useStages: false };
    expect(skillRateFor(off, 'magic', 3)).toBe(3);
    expect(skillRateFor(off, 'melee', 10)).toBe(2);
  });
});

describe('applyRate / applyAttackRate / creatureRatesFor', () => {
  it('rate 1 devolve o valor intacto, sem arredondar', () => {
    expect(applyRate(7.5, 1)).toBe(7.5);
    expect(applyAttackRate(7.5, 1)).toBe(7.5);
  });

  it('fora de 1, arredonda para baixo', () => {
    expect(applyRate(5, 2)).toBe(10);
    expect(applyRate(5, 1.5)).toBe(7);
    expect(applyAttackRate(7, 1.5)).toBe(10);
  });

  it('boss usa o bloco boss; o resto, monster', () => {
    const rates = ratesSchema.parse({ monster: { health: 2 }, boss: { attack: 3 } });
    expect(creatureRatesFor(rates, false)).toEqual({ health: 2, attack: 1, defense: 1 });
    expect(creatureRatesFor(rates, true)).toEqual({ health: 1, attack: 3, defense: 1 });
  });
});
