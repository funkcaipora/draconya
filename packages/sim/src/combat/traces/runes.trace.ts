// Trace de runas de ataque (RF-05 da #469).
//
// Referência: Avalanche, GFB, Thunderstorm e Stone Shower em círculo de 37 tiles, e Sudden
// Death em alvo único. Hoje o catálogo tem a Avalanche (círculo de raio 3, Base Power 45), e o
// círculo do `area.ts` ainda é o QUADRADO 7×7 (49 tiles). A paridade com a matriz Canary
// `AREA_CIRCLE3X3` (37 tiles) é a #472; a fórmula Canary de runa é a #476.
//
// O trace fixa o que existe — incluindo os 49 tiles — e o `gap` diz, com número, o que a
// referência exige. Quando a #472 mudar o `area.ts`, ela muda o `expected` (o `tileCount`) e
// derruba o `gap`; é para isso que o trace é o contrato dela.

import type { Supply } from '@draconya/content';
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
 * O `area.ts` de hoje devolve 49 — ver `runesGaps` e o teste de lacuna.
 */
export const CANARY_CIRCLE_RADIUS_3_TILES = 37;

export const runesGaps: readonly CombatTraceGap[] = [
  {
    id: 'circle-radius-3-37-tiles',
    reference: `Canary AREA_CIRCLE3X3: 37 tiles (${String(CANARY_CIRCLE_RADIUS_3_TILES)}), linhas 3/5/7/7/7/5/3, |dx| + |dy| <= 4.`,
    current: 'Círculo Chebyshev completo: 49 tiles (quadrado 7×7).',
    task: '#472',
  },
  {
    id: 'runes-not-in-catalog',
    reference: 'GFB, Thunderstorm, Stone Shower e SD são runas de ataque do Tibia 13.32.',
    current: 'Só a Avalanche existe no catálogo de suprimentos.',
    task: '#476',
  },
  {
    id: 'canary-rune-formula',
    reference: 'Canary: min/max = (level/5) + (maglevel × fator) + base (por magia).',
    current: 'Fórmula provisória `spellPowerRange` sobre o Base Power (#155).',
    task: '#476',
  },
  {
    id: 'sudden-death-single-target',
    reference: 'Sudden Death é runa de ALVO ÚNICO, sem área.',
    current: 'O schema de runa de dano exige `area: circle` — não há runa de alvo único.',
    task: '#476',
  },
];

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
    { atMs: 0, kind: 'supply-used', subject: 'hero', payload: { characterId: 'hero', supplyId: 'avalanche-rune', targets: ['m:1', 'm:2', 'm:3', 'm:4'], tileCount: 49 } },
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
 * O círculo da referência, medido no `area.ts` direto. É o oráculo do `gap` acima escrito como
 * dado: `expected` é o número do Canary e `current` o que o motor devolve. Enquanto a #472 não
 * chegar, o teste de lacuna afirma o atual e imprime a referência.
 */
export function circleRadiusThreeTiles(): ReturnType<typeof areaTiles> {
  return areaTiles(
    { shape: 'circle', radius: 3, centered: 'target' },
    { x: 0, y: 0, z: 7 },
    'south',
    { x: 0, y: 0, z: 7 },
  );
}