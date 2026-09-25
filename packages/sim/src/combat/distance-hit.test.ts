// Chance de acerto à distância (#522, ADR 0037 d.5, `combat-v2`): a tabela por skill/tile do
// Canary (`WeaponDistance::useWeapon`, balde "de duas mãos", teto 90%), o balde flat de
// `ammunition.maxHitChance` e o bônus/malus de `weapon.hitChance` (#524).

import type { Combat } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { distanceHitChancePercent, rollDistanceHit } from './distance-hit.js';

/** A tabela de duas mãos do Canary, transcrita como dado — `baseline.json`. */
const TABLE: NonNullable<Combat['distanceHitChance']> = {
  maxHitChance: 90,
  tiers: [
    { distance: 1, skillCap: 74, perSkill: 1.20, flat: 1 },
    { distance: 2, skillCap: 28, perSkill: 3.20, flat: 0 },
    { distance: 3, skillCap: 45, perSkill: 2.00, flat: 0 },
    { distance: 4, skillCap: 58, perSkill: 1.55, flat: 0 },
    { distance: 5, skillCap: 74, perSkill: 1.20, flat: 1 },
    { distance: 6, skillCap: 90, perSkill: 1.00, flat: 0 },
    { distance: 7, skillCap: 90, perSkill: 1.00, flat: 0 },
  ],
};

describe('distanceHitChancePercent — a tabela por skill e distância (#522)', () => {
  it('distância 1, skill 10 (nível inicial): ⌊10 × 1,20⌋ + 1 = 13', () => {
    expect(distanceHitChancePercent(1, 10, TABLE)).toBe(13);
  });

  it('distância 1, skill 105 (level 200 realista): teto 74 × 1,20 + 1 = 89 (⌊88,8⌋+1)', () => {
    // min(105, 74) = 74; ⌊74 × 1,20⌋ = 88; + 1 = 89.
    expect(distanceHitChancePercent(1, 105, TABLE)).toBe(89);
  });

  it('distância 2, skill 28 (no teto exato): ⌊28 × 3,20⌋ = 89', () => {
    expect(distanceHitChancePercent(2, 28, TABLE)).toBe(89);
  });

  it('distância 2, skill acima do teto (28): satura no teto, não cresce mais', () => {
    expect(distanceHitChancePercent(2, 28, TABLE)).toBe(distanceHitChancePercent(2, 90, TABLE));
  });

  it('distância 3, skill 45 (teto): ⌊45 × 2,00⌋ = 90', () => {
    expect(distanceHitChancePercent(3, 45, TABLE)).toBe(90);
  });

  it('distância 4, skill 58 (teto): ⌊58 × 1,55⌋ = 89', () => {
    expect(distanceHitChancePercent(4, 58, TABLE)).toBe(89);
  });

  it('distância 5 usa a MESMA fórmula da distância 1 (o Canary as agrupa)', () => {
    expect(distanceHitChancePercent(5, 40, TABLE)).toBe(distanceHitChancePercent(1, 40, TABLE));
  });

  it('distância 6 e 7 são 1:1 com a skill, até o teto 90', () => {
    expect(distanceHitChancePercent(6, 50, TABLE)).toBe(50);
    expect(distanceHitChancePercent(7, 50, TABLE)).toBe(50);
    expect(distanceHitChancePercent(6, 999, TABLE)).toBe(90);
  });

  it('tile fora da tabela (0, ou além de 7) usa o teto do balde: 90', () => {
    expect(distanceHitChancePercent(0, 50, TABLE)).toBe(90);
    expect(distanceHitChancePercent(8, 50, TABLE)).toBe(90);
  });

  it('o percentual nunca passa de 100 nem fica negativo', () => {
    for (const distance of [1, 2, 3, 4, 5, 6, 7]) {
      const percent = distanceHitChancePercent(distance, 999, TABLE);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });
});

describe('distanceHitChancePercent — `ammunition.maxHitChance` (#524)', () => {
  it('ausente, ou igual ao balde da tabela (90), usa a tabela', () => {
    expect(distanceHitChancePercent(3, 45, TABLE)).toBe(90);
    expect(distanceHitChancePercent(3, 45, TABLE, 90)).toBe(90);
  });

  it('um balde DIFERENTE vira chance FIXA, sem tabela — o power bolt do Tibia (91)', () => {
    // A skill e a distância deixam de importar: 91 vale para qualquer uma.
    expect(distanceHitChancePercent(1, 0, TABLE, 91)).toBe(91);
    expect(distanceHitChancePercent(7, 999, TABLE, 91)).toBe(91);
  });
});

describe('rollDistanceHit — a rolagem, sempre consumida (#522)', () => {
  it('consome exatamente uma fração do Rng, mesmo com chance 0 ou 100', () => {
    for (const skillLevel of [0, 200]) {
      const generator = Rng.fromSeed(`roll-${skillLevel}`);
      const before = generator.getState();
      rollDistanceHit(1, skillLevel, TABLE, generator);
      expect(generator.getState()).not.toEqual(before);
    }
  });

  it('a frequência observada numa amostra grande bate o percentual esperado', () => {
    const distance = 6; // 1:1 com a skill — fácil de prever: skill 40 → 40%.
    const skillLevel = 40;
    const trials = 5_000;
    let hits = 0;
    for (let i = 0; i < trials; i += 1) {
      if (rollDistanceHit(distance, skillLevel, TABLE, Rng.fromSeed(`freq-${i}`))) hits += 1;
    }
    const observed = hits / trials;
    expect(observed).toBeGreaterThan(0.35);
    expect(observed).toBeLessThan(0.45);
  });

  it('`weaponHitChanceBonus` (o arco, #524) soma ao percentual da munição, sempre', () => {
    // Distância 6, skill 40 → 40% de base; +10 do arco → 50%.
    const trials = 5_000;
    let hits = 0;
    for (let i = 0; i < trials; i += 1) {
      if (rollDistanceHit(6, 40, TABLE, Rng.fromSeed(`bonus-${i}`), undefined, 10)) hits += 1;
    }
    const observed = hits / trials;
    expect(observed).toBeGreaterThan(0.45);
    expect(observed).toBeLessThan(0.55);
  });

  it('o bônus da arma some no balde FLAT da munição também (nunca é ignorado)', () => {
    // maxHitChance 91 fixo, arco com malus -91 → chance 0, nunca acerta.
    for (let i = 0; i < 50; i += 1) {
      expect(rollDistanceHit(1, 999, TABLE, Rng.fromSeed(`clamp-${i}`), 91, -91)).toBe(false);
    }
  });

  it('o percentual final é sempre limitado a [0, 100] mesmo com bônus extremo', () => {
    // 90% de base + 100 de bônus não pode virar "mais que certeza" — sempre acerta.
    for (let i = 0; i < 50; i += 1) {
      expect(rollDistanceHit(6, 90, TABLE, Rng.fromSeed(`clampmax-${i}`), undefined, 100)).toBe(true);
    }
  });
});
