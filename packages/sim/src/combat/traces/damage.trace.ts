// Trace de dano (RF-02 da #469; consolidado pela #473).
//
// Duas camadas:
//
//   1. a TABELA de elementos — cada um dos oito tipos contra armadura, resistência,
//      vulnerabilidade e imunidade, com número fixado. É o oráculo do resolver canônico do
//      CMB-02/CMB-03, escrito à mão;
//   2. a ORDEM de emissão de um golpe elemental contra o personagem — `creature-hit` antes do
//      `creature-health` (FUN-109), com o APLICADO, não o resolvido.
//
// A #473 consolidou o pipeline: armadura e escudo SÓ no físico, mitigação elemental integral,
// `damageType` preservado no outcome e suporte a dano composto (primary/secondary). O oráculo
// não mudou de número — a #473 é aditiva —, e ganhou o caso de fraqueza de 10 % e a travessia
// do `damageType`.
//
// A referência é o Canary (§18): armadura por tipo, resistência por fração, piso sem revogar
// imunidade. A taxonomia de oito tipos é o contrato da emenda do ADR 0031 (CMB-03).

import { compileMitigation } from '@draconya/content';
import type { DamageType } from '@draconya/content';
import { Rng } from '../../rng.js';
import { resolveDamage } from '../damage.js';
import type { DamageIntent, DamageOutcome } from '../damage.js';
import { runTrace, TRACE_COMBAT } from './harness.js';
import type { CombatGoldenTrace } from './types.js';

/** Sorteio de Dodge falso, para o caso medir só a mitigação. */
const noDodge = (): Rng => ({ chance: () => false } as unknown as Rng);

export interface DamageElementOracleCase {
  readonly id: string;
  readonly damageType: DamageType;
  readonly rawDamage: number;
  readonly armor: number;
  readonly resistances?: Readonly<Partial<Record<DamageType, number>>>;
  readonly immunities?: readonly DamageType[];
  /** O resolvido esperado. Escrito à mão, conferido contra o contrato do ADR 0031. */
  readonly resolved: number;
}

const intent = (damageType: DamageType, rawDamage: number): DamageIntent =>
  ({ rawDamage, source: 'basic-attack', damageType });

const defenderOf = (case_: DamageElementOracleCase) => ({
  armor: case_.armor,
  dodgeChance: 0,
  ...(case_.resistances === undefined && case_.immunities === undefined
    ? {}
    : {
      mitigation: compileMitigation({
        resistances: case_.resistances ?? {},
        immunities: [...(case_.immunities ?? [])],
      }),
    }),
});

/**
 * Os oito tipos canônicos (ADR 0031, emenda CMB-03), com armadura 20 e poder 100.
 *
 * A tabela de armadura é a do `baseline`: físico vale 1, todo o resto vale 0. Um tipo não
 * físico atravessa a armadura intacto — não por exceção no código, mas porque o conteúdo diz.
 */
export const DAMAGE_ELEMENT_ORACLE: readonly DamageElementOracleCase[] = [
  { id: 'physical-armor', damageType: 'physical', rawDamage: 100, armor: 20, resolved: 80 },
  { id: 'energy-ignores-armor', damageType: 'energy', rawDamage: 100, armor: 20, resolved: 100 },
  { id: 'earth-ignores-armor', damageType: 'earth', rawDamage: 100, armor: 20, resolved: 100 },
  { id: 'fire-ignores-armor', damageType: 'fire', rawDamage: 100, armor: 20, resolved: 100 },
  { id: 'ice-ignores-armor', damageType: 'ice', rawDamage: 100, armor: 20, resolved: 100 },
  { id: 'holy-ignores-armor', damageType: 'holy', rawDamage: 100, armor: 20, resolved: 100 },
  { id: 'death-ignores-armor', damageType: 'death', rawDamage: 100, armor: 20, resolved: 100 },
  { id: 'arcane-ignores-armor', damageType: 'arcane', rawDamage: 100, armor: 20, resolved: 100 },
  {
    id: 'fire-resistance-halves', damageType: 'fire', rawDamage: 100, armor: 0,
    resistances: { fire: 0.5 }, resolved: 50,
  },
  {
    id: 'fire-vulnerability-amplifies', damageType: 'fire', rawDamage: 100, armor: 0,
    resistances: { fire: -0.5 }, resolved: 150,
  },
  {
    // #473: o exemplo do próprio issue — fraqueza de 10 % rende 110 % do poder.
    id: 'fire-vulnerability-ten-percent', damageType: 'fire', rawDamage: 100, armor: 0,
    resistances: { fire: -0.1 }, resolved: 110,
  },
  {
    id: 'fire-immunity-zeroes', damageType: 'fire', rawDamage: 100, armor: 0,
    immunities: ['fire'], resolved: 0,
  },
  {
    // O piso entra ANTES da resistência: max(10, 100 − 500) × 0,5 = 5 (emenda CMB-03).
    id: 'floor-before-resistance', damageType: 'physical', rawDamage: 100, armor: 500,
    resistances: { physical: 0.5 }, resolved: 5,
  },
];

/** Resolve um caso do oráculo pelo ponto canônico. Usado pelo teste e pela revisão. */
export function resolveOracleCase(case_: DamageElementOracleCase): number {
  return resolveOracleOutcome(case_).resolvedDamage;
}

/**
 * O outcome INTEIRO de um caso (#473, RF-05): o mesmo ponto canônico, sem descartar o que a
 * #473 exige que o resultado preserve — o `damageType` resolvido.
 */
export function resolveOracleOutcome(case_: DamageElementOracleCase): DamageOutcome {
  return resolveDamage(
    intent(case_.damageType, case_.rawDamage), defenderOf(case_), 'pve', TRACE_COMBAT, noDodge(),
    // `TRACE_COMBAT` é sempre `combat-v1` — `nowMs` é ignorado fora do `combat-v3` (#548).
    0,
  );
}

/** Um golpe de fogo e um físico no herói: o evento carrega o APLICADO, e sai antes da barra. */
export const damageEventOrderTrace: CombatGoldenTrace = {
  id: 'damage-event-order',
  description: 'Golpe elemental e físico no personagem: creature-hit antes de creature-health',
  reference: {
    source: 'otclient',
    sections: ['FUN-109', 'combat-events.ts'],
    note: 'O número flutuante acompanha a barra caindo, não o contrário.',
  },
  seed: 'm24-damage-order',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'creature-hit', subject: 'hero', payload: { creatureId: 'hero', attackerId: 'm:1', amount: 100, source: 'melee', position: { x: 0, y: 0, z: 7 } } },
    { atMs: 0, kind: 'creature-health', subject: 'hero', payload: { creatureId: 'hero', health: 200, maxHealth: 300 } },
    { atMs: 1000, kind: 'creature-hit', subject: 'hero', payload: { creatureId: 'hero', attackerId: 'm:1', amount: 80, source: 'melee', position: { x: 0, y: 0, z: 7 } } },
    { atMs: 1000, kind: 'creature-health', subject: 'hero', payload: { creatureId: 'hero', health: 120, maxHealth: 300 } },
  ],
  gaps: [],
  run: () => runTrace({
    seed: 'm24-damage-order',
    hero: { health: 300, maxHealth: 300 },
    heroDefender: { armor: 20, dodgeChance: 0 },
    monsters: [{ id: 1, monsterId: 'orc', position: { x: 1, y: 0 }, health: 100 }],
    steps: [
      { dtMs: 1000, action: { kind: 'monster-attack', rawDamage: 100, damageType: 'fire' } },
      { dtMs: 1000, action: { kind: 'monster-attack', rawDamage: 100, damageType: 'physical' } },
    ],
  }).events,
};