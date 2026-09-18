// A fórmula de poder de uma arma (CMB-05, #333): escala por level e skill, faixa de spread e
// faixa fixa de wand/rod. O que este arquivo prende é o RNG: spread zero NÃO consome sorteio,
// e é isso que mantém a sequência da hunt idêntica à do v1 (DT-03).

import type { WeaponProfile } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { resolveWeaponPower } from './weapon-power.js';

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
