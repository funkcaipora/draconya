import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import type { CharacterState } from './character.js';
import { Conditions } from './conditions.js';
import type { ConditionState } from './conditions.js';

// As condições (#155): estado com prazo, sem tempo dentro — quem vence é a fila. O que se
// prende aqui é a política (uma por chave, relançar substitui), as leituras e a serialização.

const haste = (over: Partial<ConditionState> = {}): ConditionState => ({
  key: 'haste', spellId: 'haste', expiresAtMs: 30_000, speedPercent: 30, ...over,
});

describe('Conditions', () => {
  it('holds one per kind: applying again replaces and returns the previous one', () => {
    const conditions = new Conditions();
    expect(conditions.apply(haste())).toBeNull();
    expect(conditions.apply(haste({ spellId: 'charge', speedPercent: 90, expiresAtMs: 5_000 })))
      .toEqual(haste());
    expect(conditions.size).toBe(1);
    expect(conditions.get('haste')?.speedPercent).toBe(90);
    expect(conditions.remove('haste')?.spellId).toBe('charge');
    expect(conditions.remove('haste')).toBeNull();
  });

  it('reads speed, damage dealt by source, damage taken and the shield — and 1 without anything', () => {
    const conditions = new Conditions();
    expect(conditions.speedScale()).toBe(1);
    expect(conditions.damageDealtScale('melee')).toBe(1);
    expect(conditions.damageTakenScale()).toBe(1);
    expect(conditions.hasManaShield()).toBe(false);

    conditions.apply(haste());
    expect(conditions.speedScale()).toBeCloseTo(1.3);
    // Swift Foot: haste que baixa o dano; Blood Rage: postura que sobe o corpo a corpo e o dano
    // tomado. As duas SOMAM por fonte.
    conditions.apply(haste({ damageDealtPercent: { melee: -30, distance: -30, spell: -30 } }));
    conditions.apply({
      key: 'buff', spellId: 'blood-rage', expiresAtMs: 10_000,
      damageDealtPercent: { melee: 25 }, damageTakenPercent: 15,
    });
    expect(conditions.damageDealtScale('melee')).toBeCloseTo(0.95);
    expect(conditions.damageDealtScale('distance')).toBeCloseTo(0.7);
    expect(conditions.damageDealtScale('spell')).toBeCloseTo(0.7);
    expect(conditions.damageTakenScale()).toBeCloseTo(1.15);
    conditions.apply({ key: 'mana-shield', spellId: 'magic-shield', expiresAtMs: 180_000 });
    expect(conditions.hasManaShield()).toBe(true);
  });

  it('serializes and comes back the same', () => {
    const conditions = new Conditions();
    conditions.apply(haste());
    conditions.apply({ key: 'heal-over-time', spellId: 'recovery', expiresAtMs: 60_000, tick: { amount: 20, intervalMs: 3_000 } });
    const restored = Conditions.fromState(JSON.parse(JSON.stringify(conditions.getState())) as ConditionState[]);
    expect(restored.getState()).toEqual(conditions.getState());
    expect(Conditions.fromState(undefined).size).toBe(0);
  });
});

describe('the mana shield on the character', () => {
  const state = (shielded = true): CharacterState => ({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: 100, maxHealth: 100, mana: 30, maxMana: 100,
    level: 14, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
    ...(shielded ? { conditions: [{ key: 'mana-shield' as const, spellId: 'magic-shield', expiresAtMs: 180_000 }] } : {}),
  });

  it('takes the damage from mana first, and returns only what left the health', () => {
    // Mutação que mata: descontar da vida antes da mana, ou devolver o total.
    const hero = new CharacterRuntime(state());
    expect(hero.receiveDamage(50)).toBe(20);
    expect(hero.mana).toBe(0);
    expect(hero.health).toBe(80);
    // Mana zerada: o escudo continua "ativo", e tudo vai na vida — como no Tibia.
    expect(hero.receiveDamage(10)).toBe(10);
    expect(hero.health).toBe(70);
  });

  it('is not there without the condition, and the character serializes direction and conditions', () => {
    const plain = new CharacterRuntime(state(false));
    expect(plain.receiveDamage(50)).toBe(50);
    expect(plain.mana).toBe(30);
    expect(plain.direction).toBe('south');
    expect(plain.getState()).not.toHaveProperty('conditions');

    const shielded = new CharacterRuntime(state());
    shielded.direction = 'east';
    const restored = new CharacterRuntime(JSON.parse(JSON.stringify(shielded.getState())) as CharacterState);
    expect(restored.direction).toBe('east');
    expect(restored.conditions.hasManaShield()).toBe(true);
    expect(restored.speedScale).toBe(1);
  });
});
