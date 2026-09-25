// Chance de acerto à distância (#522, ADR 0037 d.5, `combat-v2`): as TRÊS tabelas do Canary por
// balde (`WeaponDistance::useWeapon`, 75/90/100), o caminho direto (`ammunition.hitChance`), o
// balde flat de `ammunition.maxHitChance` (#524) e o bônus/malus `weapon.hitChance` (#524).

import type { Combat } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { distanceHitChancePercent, rollDistanceHit } from './distance-hit.js';

/** As três tabelas do Canary, transcritas como dado — `baseline.json`. */
const TABLE: NonNullable<Combat['distanceHitChance']> = {
  defaultMaxHitChance: 90,
  buckets: [
    {
      maxHitChance: 75,
      tiers: [
        { distance: 1, skillCap: 74, perSkill: 1.00, flat: 1 },
        { distance: 2, skillCap: 28, perSkill: 2.40, flat: 8 },
        { distance: 3, skillCap: 45, perSkill: 1.55, flat: 6 },
        { distance: 4, skillCap: 58, perSkill: 1.25, flat: 3 },
        { distance: 5, skillCap: 74, perSkill: 1.00, flat: 1 },
        { distance: 6, skillCap: 90, perSkill: 0.80, flat: 3 },
        { distance: 7, skillCap: 104, perSkill: 0.70, flat: 2 },
      ],
    },
    {
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
    },
    {
      maxHitChance: 100,
      tiers: [
        { distance: 1, skillCap: 73, perSkill: 1.35, flat: 1 },
        { distance: 2, skillCap: 30, perSkill: 3.20, flat: 4 },
        { distance: 3, skillCap: 48, perSkill: 2.05, flat: 2 },
        { distance: 4, skillCap: 65, perSkill: 1.50, flat: 2 },
        { distance: 5, skillCap: 73, perSkill: 1.35, flat: 1 },
        { distance: 6, skillCap: 87, perSkill: 1.20, flat: -4 },
        { distance: 7, skillCap: 90, perSkill: 1.10, flat: 1 },
      ],
    },
  ],
};

describe('distanceHitChancePercent — o balde 90 (duas mãos, o único com munição hoje)', () => {
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

  it('o percentual nunca passa de 100 nem fica negativo', () => {
    for (const distance of [1, 2, 3, 4, 5, 6, 7]) {
      const percent = distanceHitChancePercent(distance, 999, TABLE);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });
});

describe('distanceHitChancePercent — o balde 75 (uma mão)', () => {
  it('distância 1, skill 74 (teto): min(74,74) + 1 = 75', () => {
    expect(distanceHitChancePercent(1, 74, TABLE, 75)).toBe(75);
  });

  it('distância 2, skill 28 (teto): ⌊28 × 2,40⌋ + 8 = 75', () => {
    expect(distanceHitChancePercent(2, 28, TABLE, 75)).toBe(75);
  });

  it('distância 7, skill 104 (teto): ⌊104 × 0,70⌋ + 2 = 74', () => {
    expect(distanceHitChancePercent(7, 104, TABLE, 75)).toBe(74);
  });

  it('o balde 75 é sempre MENOR ou igual ao 90 na mesma distância/skill — a besta é melhor', () => {
    for (const distance of [1, 2, 3, 4, 6, 7]) {
      expect(distanceHitChancePercent(distance, 50, TABLE, 75))
        .toBeLessThanOrEqual(distanceHitChancePercent(distance, 50, TABLE, 90));
    }
  });
});

describe('distanceHitChancePercent — o balde 100', () => {
  it('distância 1, skill 73 (teto): ⌊73 × 1,35⌋ + 1 = 99', () => {
    expect(distanceHitChancePercent(1, 73, TABLE, 100)).toBe(99);
  });

  it('distância 6, skill 87 (teto): ⌊87 × 1,20⌋ − 4 = 100 (o único `flat` negativo)', () => {
    expect(distanceHitChancePercent(6, 87, TABLE, 100)).toBe(100);
  });

  it('distância 6, skill baixa: o `flat` negativo pode passar de baixo de zero, mas o clamp segura', () => {
    expect(distanceHitChancePercent(6, 0, TABLE, 100)).toBe(0);
  });
});

describe('distanceHitChancePercent — distância fora da tabela é MISS, nunca o teto do balde', () => {
  it('tile 0, ou além de 7, é 0% em qualquer balde reconhecido — o Canary erra sempre, não quase sempre', () => {
    for (const bucket of [75, 90, 100]) {
      expect(distanceHitChancePercent(0, 999, TABLE, bucket)).toBe(0);
      expect(distanceHitChancePercent(8, 999, TABLE, bucket)).toBe(0);
    }
  });
});

describe('distanceHitChancePercent — `ammunition.maxHitChance` (#524)', () => {
  it('ausente usa o balde default da tabela (90)', () => {
    expect(distanceHitChancePercent(3, 45, TABLE)).toBe(90);
  });

  it('igual ao balde default (90) explícito é o mesmo que ausente', () => {
    expect(distanceHitChancePercent(3, 45, TABLE, 90)).toBe(distanceHitChancePercent(3, 45, TABLE));
  });

  it('um balde que NENHUMA tabela modela (91, o power bolt) vira chance FIXA — ignora skill e distância', () => {
    expect(distanceHitChancePercent(1, 0, TABLE, 91)).toBe(91);
    expect(distanceHitChancePercent(7, 999, TABLE, 91)).toBe(91);
  });
});

describe('distanceHitChancePercent — `ammunition.hitChance` direto (#522)', () => {
  it('declarado e ≠ 0 IGNORA a tabela inteira — skill e distância não importam', () => {
    expect(distanceHitChancePercent(1, 0, TABLE, undefined, 80)).toBe(80);
    expect(distanceHitChancePercent(7, 999, TABLE, undefined, 80)).toBe(80);
  });

  it('vence mesmo com `maxHitChance` também declarado — a ordem do Canary confere `hitChance` primeiro', () => {
    expect(distanceHitChancePercent(1, 0, TABLE, 90, 80)).toBe(80);
  });

  it('ausente, ou igual a 0, cai para o caminho de `maxHitChance`/tabela', () => {
    expect(distanceHitChancePercent(3, 45, TABLE, undefined, 0)).toBe(90);
    expect(distanceHitChancePercent(3, 45, TABLE, undefined, undefined)).toBe(90);
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

  it('distância fora da tabela nunca acerta (MISS garantido), mesmo com skill altíssima', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(rollDistanceHit(8, 999, TABLE, Rng.fromSeed(`nohit-${i}`))).toBe(false);
    }
  });

  it('`weaponHitChanceBonus` (o arco, #524) soma ao percentual da munição, sempre', () => {
    // Distância 6, skill 40 → 40% de base; +10 do arco → 50%.
    const trials = 5_000;
    let hits = 0;
    for (let i = 0; i < trials; i += 1) {
      if (rollDistanceHit(6, 40, TABLE, Rng.fromSeed(`bonus-${i}`), undefined, undefined, 10)) hits += 1;
    }
    const observed = hits / trials;
    expect(observed).toBeGreaterThan(0.45);
    expect(observed).toBeLessThan(0.55);
  });

  it('o bônus da arma soma até no MISS garantido — um bônus suficiente ainda pode acertar', () => {
    // Distância 8 é MISS garantido (0%) na tabela; +100 do arco satura em 100%.
    for (let i = 0; i < 50; i += 1) {
      expect(rollDistanceHit(8, 0, TABLE, Rng.fromSeed(`missbonus-${i}`), undefined, undefined, 100)).toBe(true);
    }
  });

  it('o bônus da arma some no caminho DIRETO da munição também (nunca é ignorado)', () => {
    // hitChance direto 80 fixo, arco com malus -80 → chance 0, nunca acerta.
    for (let i = 0; i < 50; i += 1) {
      expect(rollDistanceHit(1, 999, TABLE, Rng.fromSeed(`clamp-${i}`), undefined, 80, -80)).toBe(false);
    }
  });

  it('o percentual final é sempre limitado a [0, 100] mesmo com bônus extremo', () => {
    // 90% de base + 100 de bônus não pode virar "mais que certeza" — sempre acerta.
    for (let i = 0; i < 50; i += 1) {
      expect(rollDistanceHit(6, 90, TABLE, Rng.fromSeed(`clampmax-${i}`), undefined, undefined, 100)).toBe(true);
    }
  });
});
