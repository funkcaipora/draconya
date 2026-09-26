// A aplicação de um outcome sobre o estado quente (CMB-08, emenda do ADR 0031).
//
// O que este arquivo prende: mana shield como estágio VISÍVEL (total e parcial), HP efetivamente
// removido (sem overkill na barra), leech com base no HP aplicado e clampado no teto do atacante,
// e dano integralmente absorvido que NÃO produz morte. O resolver puro é assunto de `damage.test`.

import type { DamageModifiers } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import type { CharacterState } from '../character.js';
import { MonsterRuntime } from '../monster/monster.js';
import type { MonsterState } from '../monster/monster.js';
import { applyDamageOutcome } from './outcome.js';
import type { DamageOutcome } from './damage.js';

const character = (over: Partial<CharacterState> = {}): CharacterRuntime =>
  new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: 100, maxHealth: 100, mana: 100, maxMana: 100,
    level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
    ...over,
  });

const monster = (health: number): MonsterRuntime =>
  new MonsterRuntime({
    id: 1, monsterId: 'rat', position: { x: 1, y: 1 }, health,
    home: { x: 1, y: 1 }, targetId: null, cooldowns: {},
  } as MonsterState);

/** Um outcome resolvido mínimo, com modificadores opcionais. */
const outcome = (resolvedDamage: number, modifiers?: DamageModifiers): DamageOutcome => ({
  profile: 'combat-v1',
  intent: {
    rawDamage: resolvedDamage, source: 'basic-attack', damageType: 'physical',
    ...(modifiers === undefined ? {} : { modifiers }),
  },
  damageType: 'physical',
  afterDefense: resolvedDamage, afterArmor: resolvedDamage, armorReduction: 0,
  minimumDamage: 0, afterResistance: resolvedDamage, immune: false, dodged: false,
  critical: false, resolvedDamage,
});

describe('mana shield é um estágio visível (DT-02)', () => {
  const shielded = (over: Partial<CharacterState> = {}): CharacterRuntime =>
    character({
      conditions: [{ key: 'mana-shield', spellId: 'magic-shield', expiresAtMs: 180_000 }],
      ...over,
    });

  it('absorção TOTAL: mana cai, HP não muda e não há morte', () => {
    const hero = shielded({ mana: 50 });
    const applied = applyDamageOutcome(hero, outcome(40), null);
    expect(applied.absorbedByMana).toBe(40);
    expect(applied.healthDamage).toBe(0);
    expect(hero.mana).toBe(10);
    expect(hero.health).toBe(100);
    expect(hero.alive).toBe(true);
  });

  it('absorção PARCIAL separa a mana absorvida do HP aplicado', () => {
    const hero = shielded({ mana: 30 });
    const applied = applyDamageOutcome(hero, outcome(50), null);
    expect(applied.absorbedByMana).toBe(30);
    expect(applied.healthDamage).toBe(20);
    expect(hero.mana).toBe(0);
    expect(hero.health).toBe(80);
  });

  it('mana zerada: o escudo segue ativo e tudo vai na vida, como no Tibia', () => {
    const hero = shielded({ mana: 0 });
    const applied = applyDamageOutcome(hero, outcome(25), null);
    expect(applied.absorbedByMana).toBe(0);
    expect(applied.healthDamage).toBe(25);
    expect(hero.conditions.hasManaShield()).toBe(true);
  });

  it('sem escudo a mana fica intacta', () => {
    const hero = character();
    const applied = applyDamageOutcome(hero, outcome(25), null);
    expect(applied.absorbedByMana).toBe(0);
    expect(applied.healthDamage).toBe(25);
    expect(hero.mana).toBe(100);
  });

  it('dano integralmente absorvido NÃO mata nem deixa vida negativa', () => {
    const hero = shielded({ health: 10, mana: 100 });
    const applied = applyDamageOutcome(hero, outcome(50), null);
    expect(applied.healthDamage).toBe(0);
    expect(hero.health).toBe(10);
    expect(hero.alive).toBe(true);
  });
});

describe('HP efetivamente removido e overkill', () => {
  it('a barra recebe `min(resolvido, vida)` — nunca o overkill', () => {
    const rat = monster(10);
    const applied = applyDamageOutcome(rat, outcome(100), null);
    expect(applied.healthDamage).toBe(10);
    expect(rat.health).toBe(0);
    expect(rat.alive).toBe(false);
  });

  it('monstro não tem mana: a absorção é sempre zero', () => {
    const applied = applyDamageOutcome(monster(50), outcome(20), null);
    expect(applied.absorbedByMana).toBe(0);
    expect(applied.healthDamage).toBe(20);
  });

  it('a postura do defensor escala o dano antes do escudo', () => {
    const hero = character({
      mana: 100,
      conditions: [
        { key: 'mana-shield', spellId: 'magic-shield', expiresAtMs: 180_000 },
        { key: 'buff', spellId: 'blood-rage', expiresAtMs: 180_000, damageTakenPercent: 50 },
      ],
    });
    const applied = applyDamageOutcome(hero, outcome(20), null, hero.conditions.damageTakenScale());
    expect(applied.absorbedByMana).toBe(30);
    expect(applied.healthDamage).toBe(0);
  });
});

describe('leech com base no HP aplicado, clampado no teto', () => {
  it('life leech repõe a fração do HP efetivamente removido', () => {
    const attacker = character({ health: 50 });
    const applied = applyDamageOutcome(
      monster(100), outcome(40, { lifeLeech: 0.5 }), attacker,
    );
    expect(applied.healthDamage).toBe(40);
    expect(applied.lifeLeechApplied).toBe(20);
    expect(attacker.health).toBe(70);
  });

  it('atacante cheio: repõe ZERO e o outcome não mente', () => {
    const attacker = character({ health: 100 });
    const applied = applyDamageOutcome(
      monster(100), outcome(40, { lifeLeech: 0.5 }), attacker,
    );
    expect(applied.lifeLeechApplied).toBe(0);
    expect(attacker.health).toBe(100);
  });

  it('overkill NÃO rende leech: a base é o HP removido, não o resolvido', () => {
    // 100 resolvido sobre um rato de 10: a barra perde 10, e o leech de 50 % repõe 5 — nunca 50.
    const attacker = character({ health: 0 });
    const applied = applyDamageOutcome(
      monster(10), outcome(100, { lifeLeech: 0.5 }), attacker,
    );
    expect(applied.healthDamage).toBe(10);
    expect(applied.lifeLeechApplied).toBe(5);
    expect(attacker.health).toBe(5);
  });

  it('dano integralmente absorvido pela mana não rende leech nenhum', () => {
    const attacker = character({ health: 0 });
    const target = character({
      mana: 100,
      conditions: [{ key: 'mana-shield', spellId: 'magic-shield', expiresAtMs: 180_000 }],
    });
    const applied = applyDamageOutcome(target, outcome(50, { lifeLeech: 0.5 }), attacker);
    expect(applied.healthDamage).toBe(0);
    expect(applied.lifeLeechApplied).toBe(0);
    expect(attacker.health).toBe(0);
  });

  it('mana leech repõe a fração, clampada no espaço do atacante', () => {
    const attacker = character({ mana: 90, maxMana: 100 });
    const applied = applyDamageOutcome(
      monster(100), outcome(40, { manaLeech: 0.5 }), attacker,
    );
    // 50 % de 40 = 20, mas só cabe 10.
    expect(applied.manaLeechApplied).toBe(10);
    expect(attacker.mana).toBe(100);
  });

  it('sem atacante não há leech — ataque de monstro e tique de DOT', () => {
    const applied = applyDamageOutcome(monster(100), outcome(40, { lifeLeech: 0.5 }), null);
    expect(applied.lifeLeechApplied).toBe(0);
    expect(applied.manaLeechApplied).toBe(0);
  });

  it('sem modificadores, o outcome é idêntico ao v1 (nenhum recurso extra)', () => {
    const attacker = character({ health: 50, mana: 50 });
    const applied = applyDamageOutcome(monster(100), outcome(40), attacker);
    expect(applied.lifeLeechApplied).toBe(0);
    expect(applied.manaLeechApplied).toBe(0);
    expect(attacker.health).toBe(50);
    expect(attacker.mana).toBe(50);
  });
});

describe('leech dividido por targetsAffected (M30-04, #551, Game::calculateLeechAmount)', () => {
  it('targetsAffected 1 (default) é a identidade — bit a bit o de sempre', () => {
    const attacker = character({ health: 0 });
    const applied = applyDamageOutcome(monster(100), outcome(40, { lifeLeech: 0.5 }), attacker);
    expect(applied.lifeLeechApplied).toBe(20);
  });

  it('cinco alvos: o fator é (0,1×5+0,9)/5 = 0,28, NÃO 0,2 (uma divisão simples)', () => {
    // 40 de HP removido, 50 % de leech, 5 alvos na MESMA ação: 40 × 0,5 × 0,28 = 5,6 → 6.
    // Uma divisão ingênua por 5 daria 40 × 0,5 / 5 = 4 — um número MENOR e diferente.
    const attacker = character({ health: 0 });
    const applied = applyDamageOutcome(
      monster(100), outcome(40, { lifeLeech: 0.5 }), attacker, 1, false, 5,
    );
    expect(applied.lifeLeechApplied).toBe(6);
  });

  it('mana leech também divide pelo mesmo targetsAffected', () => {
    const attacker = character({ mana: 0, maxMana: 100 });
    const applied = applyDamageOutcome(
      monster(100), outcome(40, { manaLeech: 0.5 }), attacker, 1, false, 5,
    );
    expect(applied.manaLeechApplied).toBe(6);
  });

  it('ainda clampado no teto do atacante mesmo com targetsAffected > 1', () => {
    const attacker = character({ health: 97, mana: 100 });
    const applied = applyDamageOutcome(
      monster(100), outcome(40, { lifeLeech: 0.5 }), attacker, 1, false, 5,
    );
    // 6 de leech não caberia todo — só 3 até o teto de 100.
    expect(applied.lifeLeechApplied).toBe(3);
    expect(attacker.health).toBe(100);
  });
});
