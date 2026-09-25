// A fórmula de poder de uma arma (CMB-05, #333): escala por level e skill, faixa de spread e
// faixa fixa de wand/rod. O que este arquivo prende é o RNG: spread zero NÃO consome sorteio,
// e é isso que mantém a sequência da hunt idêntica à do v1 (DT-03).
//
// Desde o #522 (ADR 0037 d.5, `combat-v2`) o arquivo também prende a fórmula do Canary
// (`Weapons::getMaxWeaponDamage`) e a normal truncada (`normalRandomInt`) que substitui o
// `spread` no perfil novo — ver "combat-v2" mais abaixo.

import type { Combat, WeaponProfile } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { normalRandomInt, resolveWeaponPower } from './weapon-power.js';

const rng = (): Rng => Rng.fromSeed('weapon-power');

/** Um perfil escalado: `base * (1 + level × levelFactor + steps × skillFactor)`. */
const scaled = (over: Partial<NonNullable<WeaponProfile['power']>> = {}): WeaponProfile => ({
  family: 'sword',
  damageType: 'physical',
  range: 1,
  power: { base: 100, levelFactor: 0, skillFactor: 0, skillStartingLevel: 10, spread: 0, ...over },
});

describe('resolveWeaponPower — a fórmula escalada (CMB-05)', () => {
  it('sem contribuição de skill, devolve o `base`', () => {
    expect(resolveWeaponPower(scaled(), 1, 10, rng())).toBe(100);
  });

  it('a skill conta a partir do `skillStartingLevel` — abaixo dele, não acrescenta', () => {
    const profile = scaled({ skillFactor: 0.5, skillStartingLevel: 10 });
    expect(resolveWeaponPower(profile, 1, 8, rng())).toBe(100);
    expect(resolveWeaponPower(profile, 1, 10, rng())).toBe(100);
  });

  it('a contribuição por nível de skill multiplica o `base`', () => {
    const profile = scaled({ skillFactor: 0.5, skillStartingLevel: 10 });
    // 100 × (1 + 2 × 0,5) = 200.
    expect(resolveWeaponPower(profile, 1, 12, rng())).toBe(200);
  });

  it('o `levelFactor` entra junto da skill', () => {
    const profile = scaled({ levelFactor: 0.1, skillFactor: 0.5, skillStartingLevel: 10 });
    // 100 × (1 + 10 × 0,1 + 1 × 0,5) = 250.
    expect(resolveWeaponPower(profile, 10, 11, rng())).toBe(250);
  });
});

describe('resolveWeaponPower — spread e consumo de RNG (CMB-05)', () => {
  it('spread zero devolve o valor exato e NÃO consome sorteio', () => {
    const generator = rng();
    const before = generator.getState();
    expect(resolveWeaponPower(scaled(), 1, 10, generator)).toBe(100);
    expect(generator.getState()).toEqual(before);
  });

  it('spread positivo consome exatamente UM sorteio e cai na faixa', () => {
    const generator = rng();
    const before = generator.getState();
    // mid = 100, spread 0,2 → [80, 120].
    const value = resolveWeaponPower(scaled({ spread: 0.2 }), 1, 10, generator);
    expect(generator.getState()).not.toEqual(before);
    expect(value).toBeGreaterThanOrEqual(80);
    expect(value).toBeLessThanOrEqual(120);
    expect(Number.isInteger(value)).toBe(true);
  });

  it('a faixa é `⌊mid × (1 − spread)⌋` a `⌈mid × (1 + spread)⌉`', () => {
    const profile = scaled({ base: 11, spread: 0.5 });
    // mid = 11; min = floor(5,5) = 5; max = ceil(16,5) = 17.
    const values = new Set<number>();
    for (let i = 0; i < 200; i += 1) values.add(resolveWeaponPower(profile, 1, 10, Rng.fromSeed(`s${i}`)));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...values)).toBeLessThanOrEqual(17);
  });
});

describe('resolveWeaponPower — a faixa fixa de wand/rod (CMB-05)', () => {
  it('sorteia `integer(min, max)` e consome um sorteio por golpe', () => {
    const profile: WeaponProfile = {
      family: 'wand', damageType: 'energy', range: 3, fixedDamage: { min: 8, max: 18 },
    };
    const generator = rng();
    const before = generator.getState();
    const value = resolveWeaponPower(profile, 1, 0, generator);
    expect(generator.getState()).not.toEqual(before);
    expect(value).toBeGreaterThanOrEqual(8);
    expect(value).toBeLessThanOrEqual(18);
  });

  it('IGNORA a skill: wand/rod não recebem multiplicador de weapon skill (DT-02)', () => {
    const profile: WeaponProfile = {
      family: 'wand', damageType: 'energy', range: 3, fixedDamage: { min: 10, max: 10 },
    };
    // Mesmo com skill alta e um `power` ao lado, o caminho fixo ganha e o valor é a faixa.
    expect(resolveWeaponPower(profile, 99, 99, rng())).toBe(10);
  });
});

describe('resolveWeaponPower — perfil sem dano', () => {
  it('sem `power` nem `fixedDamage`, devolve zero sem consumir sorteio', () => {
    const generator = rng();
    const before = generator.getState();
    expect(resolveWeaponPower({ family: 'fist', damageType: 'physical', range: 1 }, 1, 0, generator)).toBe(0);
    expect(generator.getState()).toEqual(before);
  });
});

// --- combat-v2 (#522, ADR 0037 d.5): a fórmula do Canary --------------------------------------

/** Um `Combat` `combat-v2` mínimo, só com o que `resolveWeaponPower` lê. */
const combatV2 = (
  weaponDamage: Partial<NonNullable<Combat['weaponDamage']>> = {},
): Combat => ({
  id: 'baseline', compatibilityProfile: 'combat-v2', dodgeMultiplier: 0.5,
  armorEffectiveness: {
    physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0,
  },
  minimumDamageFraction: 0.1,
  player: {
    attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0,
    damageType: 'physical',
  },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
  weaponDamage: { meleeCoefficient: 0.085, distanceCoefficient: 0.09, attackFactor: 1, ...weaponDamage },
} as Combat);

const melee = (attack: number): WeaponProfile => ({
  family: 'sword', damageType: 'physical', range: 1,
  power: { base: attack, levelFactor: 0, skillFactor: 0, skillStartingLevel: 10, spread: 0 },
});
const bow = (attack: number): WeaponProfile => ({
  family: 'distance', damageType: 'physical', range: 6,
  power: { base: attack, levelFactor: 0, skillFactor: 0, skillStartingLevel: 10, spread: 0 },
});

/** Amostra `resolveWeaponPower` `n` vezes, uma semente por amostra. */
function sample(
  profile: WeaponProfile, level: number, skillLevel: number, combat: Combat,
  vocationMultiplier: number, n: number, seedPrefix: string,
): number[] {
  const values: number[] = [];
  for (let i = 0; i < n; i += 1) {
    values.push(resolveWeaponPower(
      profile, level, skillLevel, Rng.fromSeed(`${seedPrefix}-${i}`), combat, vocationMultiplier,
    ));
  }
  return values;
}

describe('resolveWeaponPower — combat-v2: tabela (attack, skill, level, attackFactor) → faixa do Canary', () => {
  // `Weapons::getMaxWeaponDamage`: maxDamage = round(coef × attackFactor × attack × skill +
  // ⌊level/5⌋) × vocationMultiplier; minDamage = ⌊level/5⌋ (0 se attack ≤ 0 em corpo a corpo).

  it('corpo a corpo: arma 50, skill 105, level 200 → [40, 486] (o exemplo da própria issue #522)', () => {
    const values = sample(melee(50), 200, 105, combatV2(), 1, 300, 'v2-melee-200');
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(40);
      expect(value).toBeLessThanOrEqual(486);
    }
    expect(Math.min(...values)).toBeLessThan(80); // a amostra realmente cobre perto do piso
    expect(Math.max(...values)).toBeGreaterThan(440); // e perto do teto
  });

  it('distância: munição 40, skill 90, level 100 → [20, 344]', () => {
    const values = sample(bow(40), 100, 90, combatV2(), 1, 300, 'v2-distance-100');
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(20);
      expect(value).toBeLessThanOrEqual(344);
    }
  });

  it('corpo a corpo com `attack` ≤ 0: MÁXIMO e MÍNIMO zeram (o portão `isMelee` do Canary)', () => {
    const values = sample(melee(0), 50, 50, combatV2(), 1, 20, 'v2-melee-zero');
    expect(values.every((value) => value === 0)).toBe(true);
  });

  it('distância NÃO tem o portão de corpo a corpo: `attack` 0 ainda rende o termo de level', () => {
    // minDamage = maxDamage = ⌊50/5⌋ = 10 quando `attack` é 0 — sem faixa, sempre 10.
    const values = sample(bow(0), 50, 50, combatV2(), 1, 20, 'v2-distance-zero');
    expect(values.every((value) => value === 10)).toBe(true);
  });

  it('`vocationMultiplier` escala só o MÁXIMO, truncado — o MÍNIMO nunca muda', () => {
    // maxRounded = round(0,085 × 1 × 20 × 20 + 2) = 36; maxDamage = trunc(36 × 1,1) = 39.
    const values = sample(melee(20), 10, 20, combatV2(), 1.1, 300, 'v2-vocation');
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(39);
    }
  });

  it('`attackFactor` do conteúdo escala o MÁXIMO (a postura, quando existir, troca só este valor)', () => {
    // maxRounded = round(0,085 × 0,75 × 50 × 50 + 10) = 169; minDamage = 10.
    const values = sample(melee(50), 50, 50, combatV2({ attackFactor: 0.75 }), 1, 300, 'v2-attackfactor');
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(169);
    }
  });
});

describe('normalRandomInt — a normal truncada do Canary (#522)', () => {
  it('cai sempre dentro de [min, max], inclusive nos extremos, numa amostra grande', () => {
    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < 2_000; i += 1) {
      const value = normalRandomInt(Rng.fromSeed(`normal-${i}`), 10, 30);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(30);
      if (value === 10) sawMin = true;
      if (value === 30) sawMax = true;
    }
    // A rejeição em [0,1] deixa a cauda mais gorda perto da borda que um corte simples: os dois
    // extremos aparecem numa amostra de 2.000, e é isso que prova que a faixa é alcançável.
    expect(sawMin).toBe(true);
    expect(sawMax).toBe(true);
  });

  it('devolve `min` sempre quando `min === max`, mas ainda assim consome o Rng', () => {
    const generator = Rng.fromSeed('normal-flat');
    const before = generator.getState();
    expect(normalRandomInt(generator, 7, 7)).toBe(7);
    expect(generator.getState()).not.toEqual(before);
  });

  it('aceita `min` e `max` invertidos, como o `std::minmax` do Canary', () => {
    for (let i = 0; i < 50; i += 1) {
      const value = normalRandomInt(Rng.fromSeed(`normal-inv-${i}`), 30, 10);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(30);
    }
  });
});

describe('resolveWeaponPower — combat-v2: variância pela normal truncada (#522)', () => {
  it('a normal truncada roda SEMPRE, mesmo com min === max — a sequência não depende do valor', () => {
    const generator = Rng.fromSeed('v2-always-rolls');
    const before = generator.getState();
    resolveWeaponPower(melee(0), 1, 10, generator, combatV2(), 1);
    expect(generator.getState()).not.toEqual(before);
  });

  it('a distribuição da amostra bate a normal truncada (média 0,5 × faixa, desvio ≈ 0,22 × faixa)', () => {
    // Faixa larga (attack alto, level baixo) para o arredondamento não distorcer a estatística:
    // maxRounded = round(0,085 × 1 × 1000 × 12) ≈ 1020; min = 0 (level 1).
    const values = sample(melee(1_000), 1, 12, combatV2(), 1, 4_000, 'v2-distribution');
    const n = values.length;
    const mean = values.reduce((total, value) => total + value, 0) / n;
    const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    // Teórico: média ≈ metade da faixa (~510), desvio ≈ 0,22 × faixa (~224) — a normal padrão
    // truncada em [-2,2] tem desvio ≈0,8797, escalado por 0,25 (o desvio do Canary) dá ≈0,2199.
    expect(mean).toBeGreaterThan(460);
    expect(mean).toBeLessThan(560);
    expect(stddev).toBeGreaterThan(170);
    expect(stddev).toBeLessThan(280);
  });
});

describe('resolveWeaponPower — combat-v2: retrocompatibilidade (DT-03)', () => {
  it('sem `combat`, a fórmula é a v1 de sempre — nenhuma chamada existente muda', () => {
    const profile = melee(20);
    const withV2Formula = { ...profile, power: { ...profile.power!, skillFactor: 0.02 } };
    // 20 × (1 + (12 − 10) × 0,02) = 20,8 — a conta v1, sem RNG (spread 0).
    expect(resolveWeaponPower(withV2Formula, 1, 12, Rng.fromSeed('v1-omitted'))).toBeCloseTo(20.8);
  });

  it('com `combat-v1` explícito, a fórmula continua a v1 mesmo se `weaponDamage` estiver presente', () => {
    const v1Combat: Combat = { ...combatV2(), compatibilityProfile: 'combat-v1' };
    const profile = { ...melee(20), power: { ...melee(20).power!, skillFactor: 0.02 } };
    expect(resolveWeaponPower(profile, 1, 12, Rng.fromSeed('v1-explicit'), v1Combat)).toBeCloseTo(20.8);
  });
});
