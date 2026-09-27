// O sorteio de valor de combate por perfil (#681): magia, runa, poção e ability/cura de monstro
// saem da normal truncada do Canary só sob `combat-v3`; v1/v2 continuam no `rng.integer`, bit a
// bit (ADR 0031).

import type { Combat } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { rollCombatValue } from './combat-value.js';
import { normalRandomInt } from './weapon-power.js';

const profile = (compatibilityProfile: Combat['compatibilityProfile']): Pick<Combat, 'compatibilityProfile'> => ({
  compatibilityProfile,
});

describe('rollCombatValue — o perfil escolhe a distribuição (#681)', () => {
  for (const id of ['combat-v1', 'combat-v2'] as const) {
    it(`${id} devolve exatamente o \`rng.integer\` e deixa o Rng no mesmo estado`, () => {
      const rng = Rng.fromSeed(`value-${id}`);
      const clone = new Rng(rng.getState());
      expect(rollCombatValue(rng, 10, 90, profile(id))).toBe(clone.integer(10, 90));
      expect(rng.getState()).toEqual(clone.getState());
    });
  }

  it('sem contexto de combate cai no uniforme de sempre', () => {
    const rng = Rng.fromSeed('value-none');
    const clone = new Rng(rng.getState());
    expect(rollCombatValue(rng, 250, 350, undefined)).toBe(clone.integer(250, 350));
    expect(rng.getState()).toEqual(clone.getState());
  });

  it('combat-v3 devolve `normalRandomInt` do mesmo estado', () => {
    const rng = Rng.fromSeed('value-v3');
    for (let i = 0; i < 50; i += 1) {
      const clone = new Rng(rng.getState());
      expect(rollCombatValue(rng, 250, 350, profile('combat-v3'))).toBe(normalRandomInt(clone, 250, 350));
      expect(rng.getState()).toEqual(clone.getState());
    }
  });

  it('combat-v3 com `min === max` ainda consome o sorteio (nunca um atalho pelo valor)', () => {
    const rng = Rng.fromSeed('value-v3-fixed');
    const before = rng.getState();
    expect(rollCombatValue(rng, 0, 0, profile('combat-v3'))).toBe(0);
    expect(rng.getState()).not.toEqual(before);
  });

  it('combat-v3 concentra no meio: menos de 5 % em [0,10] e média perto de 50', () => {
    const rng = Rng.fromSeed('value-v3-distribution');
    const draws = 10_000;
    let low = 0;
    let sum = 0;
    for (let i = 0; i < draws; i += 1) {
      const value = rollCombatValue(rng, 0, 100, profile('combat-v3'));
      if (value <= 10) low += 1;
      sum += value;
    }
    expect(low / draws).toBeLessThan(0.05);
    const mean = sum / draws;
    expect(mean).toBeGreaterThanOrEqual(48);
    expect(mean).toBeLessThanOrEqual(52);
  });
});
