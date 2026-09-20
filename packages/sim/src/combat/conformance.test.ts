// Conformance do pipeline de combate (CMB-10, #336; contrato do ADR 0031).
//
// O que este arquivo prende, em duas camadas:
//
//   1. a MATRIZ de oráculos explícitos — cada caso declara semente, plano de avanço e o
//      resultado esperado, escrito à mão (DT-01). Cobre físico/elemental, resistência,
//      vulnerabilidade, imunidade, defesa/escudo, crítico, leech, mana shield e morte. Cada
//      caso roda a 100 ms, a 1000 ms e com snapshot no meio e restauração: resultados, RNG,
//      agregados e morte têm de coincidir;
//   2. o MOTOR de verdade (ability à distância/em área, condição/DOT e campo), montado com o
//      conteúdo real, para prender que os prazos e o estado atravessam snapshot/restauração
//      idênticos — a aresta que uma média de dano não vê.
//
// O oráculo é dado legível, nunca um snapshot que a implementação gerou. A igualdade entre
// cadências é o invariante 2; a independência de observador é o 3; a versão fixada na sessão é
// o 7.

import { buildContent, compileMitigation, placeholderAppearances } from '@draconya/content';
import type { Combat, DamageModifiers, RawContent, Spell, Supply } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import type { CharacterState } from '../character.js';
import { areaTiles } from '../area.js';
import { balanceOf, castSpell, ownPurse, useSupply } from '../casting.js';
import { applyDamageOutcome } from './outcome.js';
import { resolveDamage } from './damage.js';
import type { DamageIntent, Defender } from './damage.js';
import type { DefenseSource } from './defense.js';
import { resolveWeaponPower } from './weapon-power.js';
import { MonsterRuntime } from '../monster/monster.js';
import type { MonsterState } from '../monster/monster.js';
import { Rng } from '../rng.js';
import { EventPriority } from '../schedule.js';
import { Session, zeroAggregates } from '../session.js';
import type { Aggregates, Ruleset } from '../session.js';
import { createHuntSession, HuntRuleset } from '../rulesets/hunt.js';
import { statsForLevel } from '../progression.js';
import type { Progression } from '@draconya/content';
import {
  coarsenPlan,
  compareConformance,
  compareObservations,
  conformanceObservationOf,
  conformanceResultOf,
  runConformancePlan,
} from './conformance.js';
import type {
  CombatConformanceAggregates,
  CombatConformanceCase,
  CombatConformanceParticipant,
  CombatConformanceResult,
} from './conformance.js';

// --- o perfil de combate das fixtures ---------------------------------------------------------

const COMBAT: Combat = {
  id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0, damageType: 'physical' },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
  // O estágio de defesa existe no perfil; quem não veste a peça não consome o sorteio (CMB-04).
  defense: { blockChance: 1, blockTypes: ['physical'] },
};

const shield = (defense: number): DefenseSource => ({ kind: 'shield', defense });
const mitigation = (resistances: Record<string, number>, immunities: string[] = []) =>
  compileMitigation({ resistances, immunities } as Parameters<typeof compileMitigation>[0]);

// --- o ruleset sintético: um golpe por cadência, pelo pipeline canônico -----------------------

interface PipelineSpec {
  readonly cadenceMs: number;
  readonly attack: DamageIntent;
  readonly target: 'character' | 'dummy';
  readonly defender?: Defender;
  readonly dummyArmor?: number;
  readonly dummyHealth?: number;
  readonly character?: Partial<CharacterState>;
}

const heroState = (spec: PipelineSpec): CharacterState => ({
  id: 'hero', position: { x: 0, y: 0, z: 7 },
  health: 5_000, maxHealth: 5_000, mana: 0, maxMana: 1_000,
  level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  ...spec.character,
});

/**
 * Um ruleset que resolve dano DE VERDADE pelo ponto canônico, a cada `cadenceMs`. O alvo é o
 * personagem (um monstro atacando) ou um monstro de vida absurda (o personagem atacando, para
 * exercitar leech). Não tem estado próprio: o alvo de vida absurda nunca muda, então a retomada
 * não precisa dele.
 */
const pipelineRuleset = (spec: PipelineSpec): Ruleset => {
  const dummy = spec.target === 'dummy'
    ? new MonsterRuntime({
        id: 1, monsterId: 'dummy', position: { x: 1, y: 1 }, home: { x: 1, y: 1 },
        health: spec.dummyHealth ?? 1_000_000_000, targetId: null, cooldowns: {},
      } as MonsterState)
    : null;
  return {
    type: 'hunt',
    hz: () => 1,
    onEnter(session, subject) {
      session.scheduleIn('pipeline', 0, { priority: EventPriority.Attack, subject: subject.id });
    },
    onCreatureDied(session) { session.end('death'); },
    onEnd() {},
    onEvent(session, event) {
      const attacker = session.participants.find((participant) => participant.id === event.subject);
      if (attacker === undefined) return;
      if (dummy !== null) {
        const outcome = resolveDamage(
          spec.attack, { armor: spec.dummyArmor ?? 0, dodgeChance: 0 }, 'pve', COMBAT, session.rng,
        );
        const applied = applyDamageOutcome(dummy, outcome, attacker);
        session.credit(attacker.id, 'xpGained', applied.healthDamage);
        session.credit(attacker.id, 'bestBasicHit', outcome.resolvedDamage);
      } else {
        const defender = spec.defender ?? { armor: 0, dodgeChance: 0 };
        const outcome = resolveDamage(spec.attack, defender, 'pve', COMBAT, session.rng);
        const applied = applyDamageOutcome(
          attacker, outcome, null, attacker.conditions.damageTakenScale(),
        );
        session.credit(attacker.id, 'xpGained', applied.healthDamage);
        session.credit(attacker.id, 'bestBasicHit', outcome.resolvedDamage);
        if (attacker.health <= 0) { session.kill(attacker); return; }
      }
      session.scheduleIn('pipeline', spec.cadenceMs, { priority: EventPriority.Attack, subject: attacker.id });
    },
  };
};

const pipelineSession = (seed: string, spec: PipelineSpec): Session => {
  const session = new Session({
    id: 'conformance', contentVersion: 'v1', ruleset: pipelineRuleset(spec),
    rng: Rng.fromSeed(seed), createdAtMs: 0,
  });
  session.enter(new CharacterRuntime(heroState(spec)));
  return session;
};

// --- o oráculo --------------------------------------------------------------------------------

const zeroCombatAggregates = (): CombatConformanceAggregates => {
  const { durationMs: _durationMs, ...rest } = zeroAggregates();
  return rest;
};

const expected = (
  participant: Partial<CombatConformanceParticipant>,
  aggregates: Partial<CombatConformanceAggregates> = {},
  ended: CombatConformanceResult['ended'] = null,
): CombatConformanceResult => ({
  ended,
  aggregates: { ...zeroCombatAggregates(), ...aggregates },
  participants: [{
    id: 'hero', health: 5_000, mana: 0, alive: true, xp: 0, level: 1, ...participant,
  }],
});

/** O plano de 100 ms: 100 passos, 10 s lógicos. A cadência de 1000 ms é `coarsenPlan(·, 10)`. */
const PLAN_100 = Array.from({ length: 100 }, () => 100);
const CADENCE_1000 = 1_000;

const physical = (rawDamage: number, modifiers?: DamageModifiers): DamageIntent => ({
  rawDamage, source: 'basic-attack', damageType: 'physical',
  ...(modifiers === undefined ? {} : { modifiers }),
});
const fire = (rawDamage: number): DamageIntent =>
  ({ rawDamage, source: 'basic-attack', damageType: 'fire' });

interface MatrixCase extends CombatConformanceCase {
  readonly spec: PipelineSpec;
}

const cases: readonly MatrixCase[] = [
  {
    id: 'physical-plain', seed: 'cmb10-physical', advancePlanMs: PLAN_100,
    spec: { cadenceMs: CADENCE_1000, attack: physical(100), target: 'character', defender: { armor: 20, dodgeChance: 0 } },
    // 100 − 20 de armadura = 80; 11 golpes (t=0..10000).
    expected: expected({ health: 4_120 }, { xpGained: 880, bestBasicHit: 80 }),
  },
  {
    id: 'elemental-ignores-armor', seed: 'cmb10-elemental', advancePlanMs: PLAN_100,
    spec: { cadenceMs: CADENCE_1000, attack: fire(100), target: 'character', defender: { armor: 20, dodgeChance: 0 } },
    // A tabela diz que a armadura não vale contra fogo: 100 por golpe.
    expected: expected({ health: 3_900 }, { xpGained: 1_100, bestBasicHit: 100 }),
  },
  {
    id: 'resistance-halves', seed: 'cmb10-resist', advancePlanMs: PLAN_100,
    spec: {
      cadenceMs: CADENCE_1000, attack: fire(100), target: 'character',
      defender: { armor: 0, dodgeChance: 0, mitigation: mitigation({ fire: 0.5 }) },
    },
    expected: expected({ health: 4_450 }, { xpGained: 550, bestBasicHit: 50 }),
  },
  {
    id: 'vulnerability-amplifies', seed: 'cmb10-vuln', advancePlanMs: PLAN_100,
    spec: {
      cadenceMs: CADENCE_1000, attack: fire(100), target: 'character',
      defender: { armor: 0, dodgeChance: 0, mitigation: mitigation({ fire: -0.5 }) },
    },
    expected: expected({ health: 3_350 }, { xpGained: 1_650, bestBasicHit: 150 }),
  },
  {
    id: 'immunity-zeroes', seed: 'cmb10-immune', advancePlanMs: PLAN_100,
    spec: {
      cadenceMs: CADENCE_1000, attack: fire(100), target: 'character',
      defender: { armor: 0, dodgeChance: 0, mitigation: mitigation({}, ['fire']) },
    },
    // A imunidade zera mesmo com piso, e consome a MESMA rolagem de Dodge.
    expected: expected({ health: 5_000 }, { xpGained: 0, bestBasicHit: 0 }),
  },
  {
    id: 'defense-blocks-physical', seed: 'cmb10-defense', advancePlanMs: PLAN_100,
    spec: {
      cadenceMs: CADENCE_1000, attack: physical(100), target: 'character',
      defender: { armor: 0, dodgeChance: 0, defense: shield(30) },
    },
    // blockChance 1: bloqueia min(30, 100); o piso sobre o poder bruto mantém o golpe vivo.
    expected: expected({ health: 4_230 }, { xpGained: 770, bestBasicHit: 70 }),
  },
  {
    id: 'defense-passes-elemental', seed: 'cmb10-defense-elem', advancePlanMs: PLAN_100,
    spec: {
      cadenceMs: CADENCE_1000, attack: fire(100), target: 'character',
      defender: { armor: 0, dodgeChance: 0, defense: shield(30) },
    },
    // Fogo não está em `blockTypes`: o estágio é identidade e NÃO consome sorteio.
    expected: expected({ health: 3_900 }, { xpGained: 1_100, bestBasicHit: 100 }),
  },
  {
    id: 'dodge-halves', seed: 'cmb10-dodge', advancePlanMs: PLAN_100,
    spec: { cadenceMs: CADENCE_1000, attack: physical(100), target: 'character', defender: { armor: 0, dodgeChance: 1 } },
    expected: expected({ health: 4_450 }, { xpGained: 550, bestBasicHit: 50 }),
  },
  {
    id: 'critical-doubles', seed: 'cmb10-crit', advancePlanMs: PLAN_100,
    spec: {
      cadenceMs: CADENCE_1000, target: 'dummy', dummyArmor: 0,
      attack: physical(100, { critical: { chance: 1, multiplier: 2 } }),
    },
    expected: expected({ health: 5_000, mana: 0 }, { xpGained: 2_200, bestBasicHit: 200 }),
  },
  {
    id: 'life-leech-heals-attacker', seed: 'cmb10-lifeleech', advancePlanMs: PLAN_100,
    spec: {
      cadenceMs: CADENCE_1000, target: 'dummy', dummyArmor: 0,
      attack: physical(100, { lifeLeech: 0.5 }),
      character: { health: 1_000, maxHealth: 5_000 },
    },
    // 50 de vida por golpe, 11 golpes: 1.000 + 550.
    expected: expected({ health: 1_550 }, { xpGained: 1_100, bestBasicHit: 100 }),
  },
  {
    id: 'mana-leech-fills-attacker', seed: 'cmb10-manaleech', advancePlanMs: PLAN_100,
    spec: {
      cadenceMs: CADENCE_1000, target: 'dummy', dummyArmor: 0,
      attack: physical(100, { manaLeech: 0.25 }),
      character: { mana: 0, maxMana: 1_000 },
    },
    // 25 de mana por golpe, 11 golpes.
    expected: expected({ mana: 275 }, { xpGained: 1_100, bestBasicHit: 100 }),
  },
  {
    id: 'mana-shield-absorbs', seed: 'cmb10-manashield', advancePlanMs: PLAN_100,
    spec: {
      cadenceMs: CADENCE_1000, attack: physical(100), target: 'character',
      defender: { armor: 0, dodgeChance: 0 },
      character: {
        mana: 250, maxMana: 1_000,
        conditions: [{ key: 'mana-shield', spellId: 'magic-shield', expiresAtMs: 180_000 }],
      },
    },
    // 2 golpes inteiros (200), o terceiro absorve 50 e fere 50, os 8 restantes ferem 100.
    expected: expected({ health: 4_150, mana: 0 }, { xpGained: 850, bestBasicHit: 100 }),
  },
  {
    id: 'death-ends-session', seed: 'cmb10-death', advancePlanMs: PLAN_100,
    spec: {
      cadenceMs: CADENCE_1000, attack: physical(100), target: 'character',
      defender: { armor: 0, dodgeChance: 0 },
      character: { health: 50, maxHealth: 5_000 },
    },
    expected: expected(
      { health: 0, alive: false }, { xpGained: 50, bestBasicHit: 100, deaths: 1 }, 'death',
    ),
  },
];

const snapshotOf = (session: Session): ReturnType<Session['snapshot']> =>
  JSON.parse(JSON.stringify(session.snapshot())) as ReturnType<Session['snapshot']>;

/** Roda o caso com o plano dado; com `resumeAt`, corta no meio, serializa e retoma. */
function runCase(case_: MatrixCase, planMs: readonly number[], resumeAt?: number): Session {
  if (resumeAt === undefined) {
    const session = pipelineSession(case_.seed, case_.spec);
    runConformancePlan(session, planMs);
    return session;
  }
  const first = pipelineSession(case_.seed, case_.spec);
  runConformancePlan(first, planMs.slice(0, resumeAt));
  const snap = snapshotOf(first);
  const resumed = Session.fromSnapshot(snap, pipelineRuleset(case_.spec), new Rng(snap.rng));
  runConformancePlan(resumed, planMs.slice(resumeAt));
  return resumed;
}

describe('matriz de conformance: oráculos explícitos (CMB-10)', () => {
  for (const case_ of cases) {
    it(`${case_.id}: o oráculo escrito à mão é o resultado a 100 ms`, () => {
      const actual = conformanceResultOf(runCase(case_, case_.advancePlanMs));
      expect(compareConformance(case_.expected, actual)).toEqual([]);
    });

    it(`${case_.id}: 1000 ms rende o MESMO resultado e o MESMO RNG`, () => {
      const fine = conformanceObservationOf(runCase(case_, case_.advancePlanMs));
      const coarse = conformanceObservationOf(
        runCase(case_, coarsenPlan(case_.advancePlanMs, 10)),
      );
      expect(compareObservations(fine, coarse)).toEqual([]);
    });

    it(`${case_.id}: snapshot no meio e retomada consomem a MESMA sequência`, () => {
      const straight = conformanceObservationOf(runCase(case_, case_.advancePlanMs));
      const resumed = conformanceObservationOf(
        runCase(case_, case_.advancePlanMs, case_.advancePlanMs.length / 2),
      );
      expect(compareObservations(straight, resumed)).toEqual([]);
    });
  }
});

// --- o motor de verdade: ability, condição/DOT e campo ----------------------------------------

const ARENA_GRID = [
  '##########',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '##########',
];
const ARENA_ROUTE = {
  id: 'arena-loop', mapId: 'arena',
  tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
  spawnPoints: [{ routeIndex: 0, radius: 1 }],
};

const PROGRESSION: Progression = {
  id: 'baseline', startingHealth: 5_000, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { healthPerSecond: 0, manaPerSecond: 0 },
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
  startingKit: [], satchelInitialSlots: 10, containerRow: 5,
};

/** O monstro que compõe o cenário: ability em área, DOT e campo, tudo com número fixo. */
const HUNT_MONSTER = {
  id: 'flamer', name: 'Flamer', recommendedLevel: 1, health: 10_000_000, experience: 5,
  attack: 0, armor: 0, attackIntervalMs: 1_000, speed: 1, aggroRadius: 20, attackRange: 1,
  loot: { items: [] },
  abilities: [{
    id: 'flame', cadenceMs: 1_000,
    target: { range: 20, area: { shape: 'circle', radius: 1, centered: 'target' } },
    power: 100, damageType: 'fire',
    condition: {
      key: 'burn', merge: 'refresh', durationMs: 4_000,
      effect: { kind: 'damage-over-time', amount: 10, intervalMs: 1_000, damageType: 'fire' },
    },
    field: {
      id: 'fire', durationMs: 3_000,
      shape: { shape: 'circle', radius: 1, centered: 'target' },
      condition: {
        key: 'fire', merge: 'refresh', durationMs: 3_000,
        effect: { kind: 'damage-over-time', amount: 10, intervalMs: 1_000, damageType: 'fire' },
      },
    },
  }],
};

function engineContent(): ReturnType<typeof buildContent> {
  const raw: RawContent = {
    monsters: [HUNT_MONSTER],
    hunts: [{
      id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
      difficulties: {
        cautious: { monsterCount: 1, composition: [{ monsterId: 'flamer', weight: 1 }], respawnDelayMs: 30_000 },
      },
    }],
    vocations: [], progression: [PROGRESSION],
    combat: [{ ...COMBAT, player: { ...COMBAT.player, attackPower: 25, attackIntervalMs: 2_000 } }],
    stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
    party: [{ id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 } }],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1_000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [{ id: 'arena', z: 7, grid: ARENA_GRID }],
    routes: [ARENA_ROUTE],
  };
  return buildContent({ ...raw, appearances: [placeholderAppearances(raw)] });
}

const engineCharacter = (content: ReturnType<typeof buildContent>, id = 'hero'): CharacterRuntime => {
  const stats = statsForLevel(1, null, content.progression);
  return new CharacterRuntime({
    id, position: { x: 1, y: 1, z: 7 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: 0, maxMana: stats.maxMana,
    level: 1, xp: 0, vocationId: null, staminaMs: 86_400_000, staminaUpdatedAtMs: 0,
    goldDelta: 0, alive: true, cooldowns: {}, capacity: 1_000,
  });
};

function engineSession(id: string): Session {
  const content = engineContent();
  const session = createHuntSession({
    id, content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
  });
  session.enter(engineCharacter(content));
  return session;
}

function resumeEngine(id: string, snap: ReturnType<Session['snapshot']>): Session {
  const content = engineContent();
  const session = createHuntSession({
    id, content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
  });
  // A instância é remontada a partir do snapshot; o ruleset novo é o mesmo conteúdo.
  const restored = Session.fromSnapshot(
    snap,
    (session.ruleset as HuntRuleset),
    new Rng(snap.rng),
  );
  return restored;
}

describe('ability, condição/DOT e campo no motor (CMB-10)', () => {
  it('o cenário misto monta e a ability em área aplica condição e deixa o campo', () => {
    const session = engineSession('engine-mix');
    runConformancePlan(session, Array.from({ length: 50 }, () => 100));
    const ruleset = session.ruleset as HuntRuleset;
    // O campo vive no ruleset, com prazo LÓGICO absoluto; a condição vive no personagem.
    const field = ruleset.fields[0];
    expect(field).toBeDefined();
    const hero = session.participants[0] as CharacterRuntime;
    expect(hero.conditions.get('burn')).not.toBeNull();
    expect(session.aggregates.kills).toBe(0);
  });

  it('100 ms e 1000 ms rendem o MESMO snapshot (prazos, campo e RNG inclusive)', () => {
    const fine = engineSession('engine-rate');
    runConformancePlan(fine, Array.from({ length: 50 }, () => 100));
    const coarse = engineSession('engine-rate');
    runConformancePlan(coarse, Array.from({ length: 5 }, () => 1_000));
    expect(conformanceObservationOf(coarse).rng).toEqual(conformanceObservationOf(fine).rng);
    expect(JSON.stringify(snapshotOf(coarse))).toBe(JSON.stringify(snapshotOf(fine)));
  });

  it('um snapshot no meio de DOT e campo retoma com o MESMO prazo e resultado', () => {
    const plan = Array.from({ length: 50 }, () => 100);
    const straight = engineSession('engine-resume');
    runConformancePlan(straight, plan);

    const interrupted = engineSession('engine-resume');
    runConformancePlan(interrupted, plan.slice(0, 25));
    const snap = snapshotOf(interrupted);
    const resumed = resumeEngine('engine-resume', snap);
    runConformancePlan(resumed, plan.slice(25));

    // O snapshot final é idêntico — prazo de DOT, campo, monstro, fila e RNG.
    expect(JSON.stringify(snapshotOf(resumed))).toBe(JSON.stringify(snapshotOf(straight)));
    expect(conformanceObservationOf(resumed)).toEqual(conformanceObservationOf(straight));
  });

  it('o vencimento do campo é o instante de aplicação mais a duração do conteúdo', () => {
    const session = engineSession('engine-deadline');
    // Um passo de 100 ms: a ability vence em t=0 e o campo nasce com prazo 0 + 3000.
    session.advanceBy(100);
    const field = (session.ruleset as HuntRuleset).fields[0];
    expect(field?.expiresAtMs).toBe(3_000);
  });
});

// --- famílias de arma (CMB-05) ----------------------------------------------------------------

describe('famílias de arma: o poder sai do perfil, sem RNG quando spread é zero (CMB-05)', () => {
  const profile = (family: string, base: number, damageType: string, spread: number) => ({
    family, damageType, range: 1,
    power: { base, levelFactor: 0, skillFactor: 0.02, skillStartingLevel: 0, spread },
  });
  const zero = Rng.fromSeed('weapon');

  it('corpo a corpo escala por skill e devolve o valor puro com spread 0', () => {
    // base 20 + 10 níveis × 2 % = 24; spread 0 NÃO consome sorteio.
    const power = resolveWeaponPower(profile('sword', 20, 'physical', 0) as never, 1, 10, zero);
    expect(power).toBeCloseTo(24);
    expect(zero.getState()).toEqual(Rng.fromSeed('weapon').getState());
  });

  it('wand usa a faixa fixa da arma, uma rolagem por golpe', () => {
    const wand = { family: 'wand', damageType: 'energy', range: 3, fixedDamage: { min: 8, max: 8 } };
    const rng = Rng.fromSeed('wand');
    expect(resolveWeaponPower(wand as never, 1, 0, rng)).toBe(8);
    expect(rng.getState()).not.toEqual(Rng.fromSeed('wand').getState());
  });
});

// --- a conformance do CMB-08, preservada ------------------------------------------------------

const combatModifiers: Combat = {
  id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0, damageType: 'physical' },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
  modifiers: { critical: { chance: 0.5, multiplier: 2 }, lifeLeech: 0.5, manaLeech: 0.25 },
};

const modifierHero = (): CharacterRuntime => new CharacterRuntime({
  id: 'hero', position: { x: 0, y: 0, z: 7 },
  health: 100, maxHealth: 100, mana: 0, maxMana: 1_000,
  level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
});

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
      const participant = session.participants.find((c) => c.id === event.subject);
      if (participant === undefined) return;
      const outcome = resolveDamage(
        {
          rawDamage: session.rng.integer(10, 20),
          source: 'basic-attack',
          damageType: 'physical',
          modifiers: combatModifiers.modifiers,
        },
        { armor: 3, dodgeChance: 0.25 }, 'pve', combatModifiers, session.rng,
      );
      applyDamageOutcome(monster, outcome, participant);
      session.credit(participant.id, 'xpGained', outcome.resolvedDamage);
      session.credit(participant.id, 'bestBasicHit', outcome.resolvedDamage);
      session.scheduleIn('attack', 500, { priority: EventPriority.Attack, subject: participant.id });
    },
  };
};

const modifierSession = (seed: string): Session => {
  const session = new Session({
    id: 'conformance', contentVersion: 'v1', ruleset: modifierRuleset(),
    rng: Rng.fromSeed(seed), createdAtMs: 0,
  });
  session.enter(modifierHero());
  return session;
};

const runSteps = (session: Session, durationMs: number, stepMs: number): void => {
  for (let i = 0; i < Math.floor(durationMs / stepMs); i++) session.advanceBy(stepMs);
};

describe('conformance de modificadores: semente, taxas e retomada (CMB-08)', () => {
  it('a mesma semente rende o mesmo crítico, leech e sequência de RNG', () => {
    const a = modifierSession('cmb-08-seed');
    const b = modifierSession('cmb-08-seed');
    runSteps(a, 20_000, 100);
    runSteps(b, 20_000, 100);
    expect(a.aggregates.xpGained).toBe(b.aggregates.xpGained);
    expect(a.aggregates.bestBasicHit).toBe(b.aggregates.bestBasicHit);
    expect(a.getRngState()).toEqual(b.getRngState());
  });

  it('10 Hz e 1 Hz rendem o MESMO resultado, com a mesma semente', () => {
    const at = (stepMs: number) => {
      const session = modifierSession('cmb-08-rate');
      runSteps(session, 20_000, stepMs);
      return conformanceObservationOf(session);
    };
    expect(compareObservations(at(1_000), at(100))).toEqual([]);
  });

  it('um snapshot no meio retoma consumindo a MESMA sequência de sorteios', () => {
    const straight = modifierSession('cmb-08-resume');
    runSteps(straight, 20_000, 100);

    const interrupted = modifierSession('cmb-08-resume');
    runSteps(interrupted, 10_000, 100);
    const snap = snapshotOf(interrupted);
    const resumed = Session.fromSnapshot(snap, modifierRuleset(), new Rng(snap.rng));
    runSteps(resumed, 10_000, 100);

    expect(compareObservations(
      conformanceObservationOf(straight), conformanceObservationOf(resumed),
    )).toEqual([]);
  });
});

// --- oráculos de área e magia (M24-01, #469) --------------------------------------------------
//
// O elo entre a conformance do CMB-10 e os golden traces do M24: a ordem e o custo de uma
// magia/runa de área, agora como oráculo EXPLÍCITO neste arquivo. A geometria em si vive em
// `area.test.ts`; aqui o que se prende é que cada alvo consome UMA rolagem (a ordem é
// contrato) e que a mana/gold são cobrados UMA vez, não por alvo.

describe('oráculos de área e magia (M24-01, #469)', () => {
  const areaSpell: Spell = {
    id: 'blast', name: 'Blast', manaCost: 20, cooldownMs: 4_000, minLevel: 1,
    effect: {
      kind: 'damage', power: 30, range: 4, damageType: 'fire',
      area: { shape: 'circle', radius: 1, centered: 'target' },
    },
  };
  const avalanche: Supply = {
    id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, group: 'attack',
    groupCooldownMs: 2_000, requires: { level: 30, magicLevel: 4 },
    effect: {
      kind: 'damage', basePower: 45, range: 8, damageType: 'ice',
      area: { shape: 'circle', radius: 3, centered: 'target' },
    },
  };
  const caster = (mana: number, gold: number): CharacterRuntime => new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: 100, maxHealth: 100, mana, maxMana: 1_000,
    level: 30, xp: 0, gold, goldDelta: 0, alive: true, cooldowns: {},
  });
  const targets = [
    { armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 },
  ];

  it('magia de área: uma rolagem por alvo, mana cobrada uma vez', () => {
    const hero = caster(100, 0);
    const rng = Rng.fromSeed('m24-area-spell');
    const result = castSpell(
      hero, areaSpell, { distance: 2, targets }, 0, COMBAT, rng,
    );
    expect(result).toMatchObject({ ok: true, damage: 90, hits: [30, 30, 30] });
    expect(hero.mana).toBe(80);
    // Um Dodge por alvo: três rolagens, nenhuma a mais.
    const consumed = Rng.fromSeed('m24-area-spell');
    for (let i = 0; i < 3; i += 1) consumed.chance(1);
    expect(rng.getState()).toEqual(consumed.getState());
  });

  it('runa de área: gold cobrado uma vez e uma rolagem por alvo', () => {
    const hero = caster(0, 100);
    const rng = Rng.fromSeed('m24-area-rune');
    const result = useSupply(
      hero, avalanche, { distance: 5, targets }, COMBAT, rng, { skillLevel: 4, powerScale: 1 },
      ownPurse(hero), 0,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.goldSpent).toBe(14);
    expect(result.hits).toHaveLength(3);
    expect(result.damage).toBe(result.hits.reduce((total, hit) => total + hit, 0));
    expect(balanceOf(hero)).toBe(86);
  });

  it('a geometria do círculo: raio 1 são 9 tiles; raio 3 ainda é o quadrado 7x7 (49)', () => {
    const origin = { x: 0, y: 0, z: 7 };
    expect(areaTiles({ shape: 'circle', radius: 1, centered: 'target' }, origin, 'south', origin))
      .toHaveLength(9);
    // Referência Canary `AREA_CIRCLE3X3`: 37 tiles. O recorte dos cantos é a #472 — este
    // oráculo vira 37 quando ela chegar, e é por isso que ele está escrito aqui.
    expect(areaTiles({ shape: 'circle', radius: 3, centered: 'target' }, origin, 'south', origin))
      .toHaveLength(49);
  });
});
