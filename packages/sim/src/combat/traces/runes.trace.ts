// Trace de runas de ataque (#469, RF-05; #476).
//
// Referência: Avalanche, Great Fireball, Thunderstorm e Stone Shower em círculo de 37 tiles,
// Explosion em cruz e Sudden Death / Heavy Magic Missile em alvo único. O catálogo tem as sete
// runas com a fórmula canônica do Canary desde a #476 — a mesma `formula` da magia de dano
// (#474), escalada pelo magic level. O `avalancheTrace` continua no caminho do `basePower` de
// propósito: ele é a regressão do ADR 0031 (conteúdo sem fórmula não muda bit a bit), enquanto
// `canaryRunes` é o oráculo da paridade nova.
//
// As lacunas que a #469 abriu — `runes-not-in-catalog`, `canary-rune-formula` e
// `sudden-death-single-target` — estão fechadas: `runesGaps` é vazio.

import type { DamageType, SpellFormula, Supply } from '@draconya/content';
import { areaTiles } from '../../area.js';
import { runTrace } from './harness.js';
import type { CombatGoldenTrace, CombatTraceGap } from './types.js';

const AVALANCHE: Supply = {
  id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, group: 'attack',
  groupCooldownMs: 2_000, requires: { level: 30, magicLevel: 4 },
  effect: {
    kind: 'damage', basePower: 45, range: 8, damageType: 'ice',
    area: { shape: 'circle', radius: 3, centered: 'target' },
  },
};

/**
 * O número que a referência Canary fixa para o círculo de raio 3: 3, 5, 7, 7, 7, 5, 3.
 * O `area.ts` recorta os cantos por Manhattan desde a #472 — ver `circleRadiusThreeTiles`.
 */
export const CANARY_CIRCLE_RADIUS_3_TILES = 37;

/** A #476 fechou o catálogo, a fórmula e a runa de alvo único: não sobra lacuna de runa. */
export const runesGaps: readonly CombatTraceGap[] = [];

/** Level e magic level do oráculo de paridade, iguais ao teste da fórmula da magia (#474). */
export const CANARY_RUNE_LEVEL = 50;
export const CANARY_RUNE_MAGIC_LEVEL = 40;

/** A forma da runa de ataque: círculo de raio 3, cruz de raio 1 ou alvo único (sem área). */
export type RuneShape = 'circle-3' | 'cross-1' | 'single';

/** Uma runa do Canary com o ORÁCULO da fórmula escrito à mão — nunca derivado do motor. */
export interface CanaryRune {
  readonly supply: Supply;
  readonly damageType: DamageType;
  readonly shape: RuneShape;
  /** Piso da fórmula em `CANARY_RUNE_LEVEL` / `CANARY_RUNE_MAGIC_LEVEL`. */
  readonly min: number;
  /** Teto da fórmula em `CANARY_RUNE_LEVEL` / `CANARY_RUNE_MAGIC_LEVEL`. */
  readonly max: number;
}

const circle = (radius: number): { shape: 'circle'; radius: number; centered: 'target' } =>
  ({ shape: 'circle', radius, centered: 'target' });

type DamageEffect = Extract<Supply['effect'], { kind: 'damage' }>;

const damage = (
  damageType: DamageType, formula: SpellFormula, area?: DamageEffect['area'],
): DamageEffect => area === undefined
  ? { kind: 'damage', formula, range: 8, damageType }
  : { kind: 'damage', formula, range: 8, damageType, area };

/**
 * As runas de ataque do Canary (#476), auditadas no baseline `d245c95` (ADR 0019). O `min`/`max`
 * é o oráculo escrito à mão para level 50 / ML 40 — o número que o teste compara com a rolagem
 * real do motor. `Sudden Death` segue os coeficientes da issue #476.
 */
export const canaryRunes: readonly CanaryRune[] = [
  {
    damageType: 'ice', shape: 'circle-3', min: 65, max: 139,
    supply: {
      id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, group: 'attack',
      groupCooldownMs: 2_000, requires: { level: 30, magicLevel: 4 },
      effect: damage('ice',
        { levelFactor: 0.2, skillMin: 1.2, skillMax: 2.8, baseMin: 7, baseMax: 17 },
        circle(3)),
    },
  },
  {
    damageType: 'fire', shape: 'circle-3', min: 65, max: 139,
    supply: {
      id: 'great-fireball-rune', name: 'Great Fireball Rune', price: 45, group: 'attack',
      groupCooldownMs: 2_000, requires: { level: 30, magicLevel: 4 },
      effect: damage('fire',
        { levelFactor: 0.2, skillMin: 1.2, skillMax: 2.8, baseMin: 7, baseMax: 17 },
        circle(3)),
    },
  },
  {
    damageType: 'energy', shape: 'circle-3', min: 56, max: 130,
    supply: {
      id: 'thunderstorm-rune', name: 'Thunderstorm Rune', price: 25, group: 'attack',
      groupCooldownMs: 2_000, requires: { level: 28, magicLevel: 4 },
      effect: damage('energy',
        { levelFactor: 0.2, skillMin: 1, skillMax: 2.6, baseMin: 6, baseMax: 16 },
        circle(3)),
    },
  },
  {
    damageType: 'earth', shape: 'circle-3', min: 56, max: 130,
    supply: {
      id: 'stone-shower-rune', name: 'Stone Shower Rune', price: 25, group: 'attack',
      groupCooldownMs: 2_000, requires: { level: 28, magicLevel: 4 },
      effect: damage('earth',
        { levelFactor: 0.2, skillMin: 1, skillMax: 2.6, baseMin: 6, baseMax: 16 },
        circle(3)),
    },
  },
  {
    damageType: 'death', shape: 'single', min: 226, max: 354,
    supply: {
      id: 'sudden-death-rune', name: 'Sudden Death Rune', price: 108, group: 'attack',
      groupCooldownMs: 2_000, requires: { level: 45, magicLevel: 15 },
      effect: damage('death',
        { levelFactor: 0.2, skillMin: 4.6, skillMax: 7.4, baseMin: 32, baseMax: 48 }),
    },
  },
  {
    damageType: 'energy', shape: 'single', min: 28, max: 83,
    supply: {
      id: 'heavy-magic-missile-rune', name: 'Heavy Magic Missile Rune', price: 7,
      group: 'attack', groupCooldownMs: 2_000, requires: { level: 25, magicLevel: 3 },
      effect: damage('energy',
        { levelFactor: 0.2, skillMin: 0.4, skillMax: 1.59, baseMin: 2, baseMax: 10 }),
    },
  },
  {
    damageType: 'physical', shape: 'cross-1', min: 10, max: 202,
    supply: {
      id: 'explosion-rune', name: 'Explosion Rune', price: 25, group: 'attack',
      groupCooldownMs: 2_000, requires: { level: 31, magicLevel: 6 },
      effect: damage('physical',
        { levelFactor: 0.2, skillMin: 0, skillMax: 4.8, baseMin: 0, baseMax: 0 },
        { shape: 'cross', radius: 1 }),
    },
  },
];

/** Atalho para o teste: a runa de alvo único (Sudden Death). */
export const suddenDeathRune: Supply = (canaryRunes.find(
  (rune) => rune.supply.id === 'sudden-death-rune',
) as CanaryRune).supply;

/** Avalanche em 4 alvos dentro do raio: alvo principal primeiro, demais na ordem de nascimento. */
export const avalancheTrace: CombatGoldenTrace = {
  id: 'rune-avalanche',
  description: 'Avalanche (círculo de raio 3) atinge o alvo e os vizinhos, com uma rolagem por alvo',
  reference: {
    source: 'canary',
    sections: ['§19 Area Combat', '#165', 'ADR 0026 decisão 8'],
    note: 'Uma rolagem por alvo, na ordem de nascimento; o supply-used sai antes dos golpes.',
  },
  seed: 'm24-avalanche',
  advancePlanMs: [1000, 1000, 1000],
  expected: [
    { atMs: 0, kind: 'supply-used', subject: 'hero', payload: { characterId: 'hero', supplyId: 'avalanche-rune', targets: ['m:1', 'm:2', 'm:3', 'm:4'], tileCount: 37 } },
    { atMs: 0, kind: 'creature-hit', subject: 'm:1', payload: { creatureId: 'm:1', attackerId: 'hero', amount: 134, source: 'spell', position: { x: 5, y: 0, z: 7 } } },
    { atMs: 0, kind: 'creature-health', subject: 'm:1', payload: { creatureId: 'm:1', health: 366, maxHealth: 500 } },
    { atMs: 0, kind: 'creature-hit', subject: 'm:2', payload: { creatureId: 'm:2', attackerId: 'hero', amount: 171, source: 'spell', position: { x: 5, y: 1, z: 7 } } },
    { atMs: 0, kind: 'creature-health', subject: 'm:2', payload: { creatureId: 'm:2', health: 329, maxHealth: 500 } },
    { atMs: 0, kind: 'creature-hit', subject: 'm:3', payload: { creatureId: 'm:3', attackerId: 'hero', amount: 175, source: 'spell', position: { x: 5, y: 2, z: 7 } } },
    { atMs: 0, kind: 'creature-health', subject: 'm:3', payload: { creatureId: 'm:3', health: 325, maxHealth: 500 } },
    { atMs: 0, kind: 'creature-hit', subject: 'm:4', payload: { creatureId: 'm:4', attackerId: 'hero', amount: 138, source: 'spell', position: { x: 6, y: 0, z: 7 } } },
    { atMs: 0, kind: 'creature-health', subject: 'm:4', payload: { creatureId: 'm:4', health: 362, maxHealth: 500 } },
  ],
  gaps: runesGaps,
  run: () => runTrace({
    seed: 'm24-avalanche',
    hero: {
      position: { x: 0, y: 0, z: 7 }, mana: 0, maxMana: 100,
      level: 30, gold: 100,
    },
    monsters: [
      { id: 1, monsterId: 'dragon', position: { x: 5, y: 0 }, health: 500 },
      { id: 2, monsterId: 'dragon', position: { x: 5, y: 1 }, health: 500 },
      { id: 3, monsterId: 'dragon', position: { x: 5, y: 2 }, health: 500 },
      { id: 4, monsterId: 'dragon', position: { x: 6, y: 0 }, health: 500 },
    ],
    steps: [
      { dtMs: 1000, action: { kind: 'supply', supply: AVALANCHE, skillLevel: 4 } },
      { dtMs: 1000 },
      { dtMs: 1000 },
    ],
  }).events,
};

/**
 * O círculo da referência, medido no `area.ts` direto. O oráculo do trace escrito como dado:
 * `CANARY_CIRCLE_RADIUS_3_TILES` é o número do Canary e o resultado do motor tem que bater com
 * ele — é a paridade que a #472 fechou.
 */
export function circleRadiusThreeTiles(): ReturnType<typeof areaTiles> {
  return areaTiles(
    { shape: 'circle', radius: 3, centered: 'target' },
    { x: 0, y: 0, z: 7 },
    'south',
    { x: 0, y: 0, z: 7 },
  );
}