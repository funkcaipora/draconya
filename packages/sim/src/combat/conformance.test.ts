// Conformance dos outcomes avançados (CMB-08): semente, 1 Hz x 10 Hz e retomada.
//
// O que este arquivo prende é a propriedade central do invariante 2 aplicada aos modificadores:
// com a MESMA semente e os MESMOS instantes lógicos, o crítico e o leech rendem o mesmo — a
// 10 Hz anexada e a 1 Hz desanexada, e do outro lado de um snapshot. Se alguém puser uma decisão
// de jogo fora da fila (um `Math.random`, um acumulador por tick, um sorteio condicionado ao
// relógio), a igualdade quebra aqui antes de quebrar em produção.

import type { Combat } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { resolveDamage } from './damage.js';
import { applyDamageOutcome } from './outcome.js';
import { MonsterRuntime } from '../monster/monster.js';
import { Rng } from '../rng.js';
import { EventPriority } from '../schedule.js';
import { Session } from '../session.js';
import type { Ruleset } from '../session.js';

const combat: Combat = {
  id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0, damageType: 'physical' },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
  // A composição sob teste: crítico, life leech e mana leech juntos. É a única fonte de
  // aleatoriedade do cenário além da faixa de dano.
  modifiers: { critical: { chance: 0.5, multiplier: 2 }, lifeLeech: 0.5, manaLeech: 0.25 },
};

const character = (): CharacterRuntime => new CharacterRuntime({
  id: 'hero', position: { x: 0, y: 0, z: 7 },
  health: 100, maxHealth: 100, mana: 0, maxMana: 1_000,
  level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
});

/**
 * Um ruleset que resolve dano DE VERDADE pelo ponto canônico e aplica pelo outcome. O alvo é um
 * monstro de vida absurda (nunca morre, então `healthDamage` é sempre o resolvido) e o atacante
 * é o próprio personagem, que recebe o leech. A cada 500 ms lógicos, um golpe.
 */
const modifierRuleset = (): Ruleset => {
  const monster = new MonsterRuntime({
    id: 1, monsterId: 'dummy', position: { x: 1, y: 1 }, health: 1_000_000_000,
    home: { x: 1, y: 1 }, targetId: null, cooldowns: {},
  });
  return {
    type: 'hunt',
    hz: () => 1,
    onEnter(session, subject) {
      session.scheduleIn('attack', 0, { priority: EventPriority.Attack, subject: subject.id });
    },
    onCreatureDied: () => {},
    onEnd: () => {},
    onEvent(session, event) {
      const p = session.participants.find((c) => c.id === event.subject);
      if (p === undefined) return;
      const outcome = resolveDamage(
        {
          rawDamage: session.rng.integer(10, 20),
          source: 'basic-attack',
          damageType: 'physical',
          modifiers: combat.modifiers,
        },
        { armor: 3, dodgeChance: 0.25 }, 'pve', combat, session.rng,
      );
      applyDamageOutcome(monster, outcome, p);
      session.credit(p.id, 'xpGained', outcome.resolvedDamage);
      session.credit(p.id, 'bestBasicHit', outcome.resolvedDamage);
      session.scheduleIn('attack', 500, { priority: EventPriority.Attack, subject: p.id });
    },
  };
};

const conformanceSession = (seed: string): Session => {
  const session = new Session({
    id: 'conformance', contentVersion: 'v1', ruleset: modifierRuleset(),
    rng: Rng.fromSeed(seed), createdAtMs: 0,
  });
  session.enter(character());
  return session;
};

const run = (session: Session, durationMs: number, stepMs: number): void => {
  const steps = Math.floor(durationMs / stepMs);
  for (let i = 0; i < steps; i++) session.advanceBy(stepMs);
};

const snapshotOf = (session: Session): ReturnType<Session['snapshot']> =>
  JSON.parse(JSON.stringify(session.snapshot())) as ReturnType<Session['snapshot']>;

describe('conformance de modificadores: semente, taxas e retomada (CMB-08)', () => {
  it('a mesma semente rende o mesmo crítico, leech e sequência de RNG', () => {
    const a = conformanceSession('cmb-08-seed');
    const b = conformanceSession('cmb-08-seed');
    run(a, 20_000, 100);
    run(b, 20_000, 100);

    expect(a.aggregates.xpGained).toBe(b.aggregates.xpGained);
    expect(a.aggregates.bestBasicHit).toBe(b.aggregates.bestBasicHit);
    expect(a.participants[0]?.health).toBe(b.participants[0]?.health);
    expect(a.participants[0]?.mana).toBe(b.participants[0]?.mana);
    expect(a.getRngState()).toEqual(b.getRngState());
  });

  it('10 Hz e 1 Hz rendem o MESMO resultado, com a mesma semente', () => {
    const at = (stepMs: number) => {
      const session = conformanceSession('cmb-08-rate');
      run(session, 20_000, stepMs);
      const hero = session.participants[0] as CharacterRuntime;
      return {
        xp: session.aggregates.xpGained,
        best: session.aggregates.bestBasicHit,
        health: hero.health,
        mana: hero.mana,
        rng: session.getRngState(),
      };
    };
    expect(at(1_000)).toEqual(at(100));
  });

  it('um snapshot no meio retoma consumindo a MESMA sequência de sorteios', () => {
    const straight = conformanceSession('cmb-08-resume');
    run(straight, 20_000, 100);

    const interrupted = conformanceSession('cmb-08-resume');
    run(interrupted, 10_000, 100);
    const snap = snapshotOf(interrupted);
    const resumed = Session.fromSnapshot(snap, modifierRuleset(), new Rng(snap.rng));
    run(resumed, 10_000, 100);

    expect(resumed.aggregates.xpGained).toBe(straight.aggregates.xpGained);
    expect(resumed.aggregates.bestBasicHit).toBe(straight.aggregates.bestBasicHit);
    expect(resumed.participants[0]?.health).toBe(straight.participants[0]?.health);
    expect(resumed.participants[0]?.mana).toBe(straight.participants[0]?.mana);
    expect(resumed.getRngState()).toEqual(straight.getRngState());
  });
});
