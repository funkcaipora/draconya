import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import type { CharacterState } from './character.js';
import { applyDamageOutcome } from './combat/outcome.js';
import type { DamageOutcome } from './combat/damage.js';
import { Conditions, conditionFromSpec, tickOf } from './conditions.js';
import type { ConditionState } from './conditions.js';
import { MonsterRuntime } from './monster/monster.js';

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

  it('a política `strongest` mantém o mais forte e NÃO reagenda o mais fraco', () => {
    // Mutação que mata: trocar por `refresh` no `apply` — o veneno fraco rebaixaria o forte.
    const conditions = new Conditions();
    const strong: ConditionState = {
      key: 'poison', targetId: 'm:1', expiresAtMs: 10_000, merge: 'strongest',
      tick: { kind: 'damage', amount: 30, intervalMs: 1_000, damageType: 'earth', source: 'spell' },
    };
    const weak: ConditionState = {
      ...strong, expiresAtMs: 20_000,
      tick: { kind: 'damage', amount: 5, intervalMs: 1_000, damageType: 'earth', source: 'spell' },
    };
    expect(conditions.apply(strong)).toBeNull();
    expect(conditions.apply(weak)).toBe(strong);
    // O objeto guardado continua sendo o forte — é o que o ruleset compara para não reagendar.
    expect(conditions.get('poison')).toBe(strong);
    // `replace`/`refresh` substituem: o novo vence mesmo sendo mais fraco.
    expect(conditions.apply({ ...weak, merge: 'refresh' })).toBe(strong);
    expect(conditions.get('poison')?.tick?.amount).toBe(5);
  });

  it('o tique de dano (DOT) viaja no estado e um snapshot antigo sem `kind` lê como cura', () => {
    const conditions = new Conditions();
    conditions.apply({
      key: 'fire', targetId: 'm:1', expiresAtMs: 5_000,
      tick: { kind: 'damage', amount: 12, intervalMs: 1_000, damageType: 'fire', source: 'spell' },
    });
    expect(tickOf(conditions.get('fire') as ConditionState)?.kind).toBe('damage');
    // Formato do #155: sem `kind`. Ausente é cura, e o snapshot continua legível sem bump.
    expect(tickOf({ key: 'heal-over-time', expiresAtMs: 1, tick: { amount: 3, intervalMs: 1 } })?.kind)
      .toBe('heal');
    expect(tickOf({ key: 'haste', expiresAtMs: 1 })).toBeNull();
  });

  it('compila um `ConditionSpec` do conteúdo para o alvo, com prazo lógico absoluto', () => {
    const condition = conditionFromSpec(
      {
        key: 'poison', merge: 'strongest', durationMs: 4_000,
        effect: { kind: 'damage-over-time', amount: 7, intervalMs: 2_000, damageType: 'earth' },
      },
      'm:9', 'hero', 1_000, 'spell',
    );
    expect(condition.targetId).toBe('m:9');
    expect(condition.sourceId).toBe('hero');
    expect(condition.expiresAtMs).toBe(5_000);
    expect(condition.tick).toEqual({ kind: 'damage', amount: 7, intervalMs: 2_000, damageType: 'earth', source: 'spell' });
  });
});

describe('condições no monstro (CMB-07)', () => {
  const monster = (): MonsterRuntime => new MonsterRuntime({
    id: 7, monsterId: 'rat', position: { x: 2, y: 2 }, home: { x: 2, y: 2 },
    health: 100, targetId: null, cooldowns: {},
  });

  it('o monstro carrega condição, serializa e restaura', () => {
    const runtime = monster();
    runtime.conditions.apply({
      key: 'poison', targetId: 'm:7', expiresAtMs: 5_000,
      tick: { kind: 'damage', amount: 9, intervalMs: 1_000, damageType: 'earth', source: 'spell' },
    });
    const restored = new MonsterRuntime(JSON.parse(JSON.stringify(runtime.getState())) as never);
    expect(restored.conditions.get('poison')?.tick?.amount).toBe(9);
    // Sem condição a chave é omitida: um snapshot anterior a esta issue continua lido.
    expect(monster().getState()).not.toHaveProperty('conditions');
  });
});

describe('the mana shield on the character', () => {
  const state = (shielded = true): CharacterState => ({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: 100, maxHealth: 100, mana: 30, maxMana: 100,
    level: 14, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
    ...(shielded ? { conditions: [{ key: 'mana-shield' as const, spellId: 'magic-shield', expiresAtMs: 180_000 }] } : {}),
  });

  // O CMB-08 tirou o escudo de `receiveDamage`: ele agora é um estágio de `applyDamageOutcome`,
  // e é lá que o teste mede o que absorveu.
  const damage = (resolvedDamage: number): DamageOutcome => ({
    profile: 'combat-v1',
    intent: { rawDamage: resolvedDamage, source: 'monster-attack', damageType: 'physical' },
    damageType: 'physical',
    afterDefense: resolvedDamage, afterArmor: resolvedDamage, armorReduction: 0,
    minimumDamage: 0, afterResistance: resolvedDamage, immune: false, dodged: false,
    critical: false, resolvedDamage,
  });

  it('takes the damage from mana first, and reports what left the health', () => {
    // Mutação que mata: descontar da vida antes da mana, ou informar o total.
    const hero = new CharacterRuntime(state());
    const first = applyDamageOutcome(hero, damage(50), null);
    expect(first.healthDamage).toBe(20);
    expect(first.absorbedByMana).toBe(30);
    expect(hero.mana).toBe(0);
    expect(hero.health).toBe(80);
    // Mana zerada: o escudo continua "ativo", e tudo vai na vida — como no Tibia.
    const second = applyDamageOutcome(hero, damage(10), null);
    expect(second.healthDamage).toBe(10);
    expect(second.absorbedByMana).toBe(0);
    expect(hero.health).toBe(70);
  });

  it('is not there without the condition, and the character serializes direction and conditions', () => {
    const plain = new CharacterRuntime(state(false));
    const hit = applyDamageOutcome(plain, damage(50), null);
    expect(hit.healthDamage).toBe(50);
    expect(hit.absorbedByMana).toBe(0);
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

  it('absorbs from mana via extraManaShield without mana-shield condition, and does not double-absorb when both are active', () => {
    // extraManaShield = true (e.g. Energy Ring) sem a condição mana-shield: o estágio é o de
    // `applyDamageOutcome` (CMB-08), o mesmo da condição.
    const hero = new CharacterRuntime(state(false));
    const ring = applyDamageOutcome(hero, damage(50), null, 1, true);
    expect(ring.healthDamage).toBe(20);
    expect(ring.absorbedByMana).toBe(30);
    expect(hero.mana).toBe(0);
    expect(hero.health).toBe(80);

    // Condição mana-shield E extraManaShield ao mesmo tempo: absorve uma vez só, não debita duas vezes
    const both = new CharacterRuntime(state(true));
    const twice = applyDamageOutcome(both, damage(20), null, 1, true);
    expect(twice.healthDamage).toBe(0);
    expect(twice.absorbedByMana).toBe(20);
    expect(both.mana).toBe(10);
    expect(both.health).toBe(100);
  });
});
