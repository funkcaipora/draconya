// Trace de magias instantâneas (RF-03 da #469).
//
// A referência é o Canary (§22 do documento): uma magia tem portão (level, mana, cooldown de
// grupo) e efeito, e o efeito passa pelo MESMO resolver do golpe. O que este trace prende é a
// ORDEM — `spell-cast` ANTES dos `creature-hit` de cada alvo (FUN-109) — e a mira por forma,
// que a `HuntRuleset` também usa (`#aimFor`).
//
// A fórmula de dano de magia ainda é a provisória do `combat.spellPower`; a paridade com os
// coeficientes do Canary é a #474, e é lá que estes números passam a ser cobrados.

import type { Spell } from '@draconya/content';
import { runTrace } from './harness.js';
import type { CombatGoldenTrace } from './types.js';

const ICE_STRIKE: Spell = {
  id: 'ice-strike', name: 'Ice Strike', manaCost: 12, cooldownMs: 2_000,
  group: 'attack', groupCooldownMs: 2_000, minLevel: 1,
  effect: { kind: 'damage', power: 40, range: 3, damageType: 'ice' },
};

const BLAST: Spell = {
  id: 'blast', name: 'Blast', manaCost: 20, cooldownMs: 4_000, minLevel: 1,
  effect: {
    kind: 'damage', power: 50, range: 3, damageType: 'fire',
    area: { shape: 'circle', radius: 1, centered: 'target' },
  },
};

const FRONT_SWEEP: Spell = {
  id: 'front-sweep', name: 'Front Sweep', manaCost: 15, cooldownMs: 2_000, minLevel: 1,
  effect: { kind: 'damage', power: 30, damageType: 'physical', area: { shape: 'cleave' } },
};

/**
 * Strike de alvo único, duas vezes com o intervalo do cooldown. O segundo lançamento só
 * acontece em t=2000: um cooldown curto trancaria o segundo, e o trace mediria a recusa.
 * Cada alvo consome UMA rolagem por magia de `power` fixo? Não: `power` fixo não sorteia, e
 * é de propósito — o trace mede a cadência e a ordem, não a distribuição.
 */
export const spellSingleTargetTrace: CombatGoldenTrace = {
  id: 'spell-single-target',
  description: 'Ice Strike em alvo único, duas vezes, na cadência do cooldown de grupo',
  reference: {
    source: 'canary',
    sections: ['§18 Combat', '§22 Spells e abilities', 'ADR 0026 decisão 5'],
    note: 'Magia passa por resolveDamage e o spell-cast sai antes dos golpes dela.',
  },
  seed: 'm24-spell-strike',
  advancePlanMs: [1000, 1000, 1000, 1000],
  expected: [
    { atMs: 0, kind: 'spell-cast', subject: 'hero', payload: { casterId: 'hero', spellId: 'ice-strike', targets: ['m:1'], tileCount: 0 } },
    { atMs: 0, kind: 'creature-hit', subject: 'm:1', payload: { creatureId: 'm:1', attackerId: 'hero', amount: 40, source: 'spell', position: { x: 3, y: 0, z: 7 } } },
    { atMs: 0, kind: 'creature-health', subject: 'm:1', payload: { creatureId: 'm:1', health: 160, maxHealth: 200 } },
    { atMs: 2000, kind: 'spell-cast', subject: 'hero', payload: { casterId: 'hero', spellId: 'ice-strike', targets: ['m:1'], tileCount: 0 } },
    { atMs: 2000, kind: 'creature-hit', subject: 'm:1', payload: { creatureId: 'm:1', attackerId: 'hero', amount: 40, source: 'spell', position: { x: 3, y: 0, z: 7 } } },
    { atMs: 2000, kind: 'creature-health', subject: 'm:1', payload: { creatureId: 'm:1', health: 120, maxHealth: 200 } },
  ],
  gaps: [],
  run: () => runTrace({
    seed: 'm24-spell-strike',
    hero: { position: { x: 0, y: 0, z: 7 }, mana: 100, maxMana: 100 },
    monsters: [{ id: 1, monsterId: 'troll', position: { x: 3, y: 0 }, health: 200 }],
    steps: [
      { dtMs: 1000, action: { kind: 'spell', spell: ICE_STRIKE } },
      { dtMs: 1000 },
      { dtMs: 1000, action: { kind: 'spell', spell: ICE_STRIKE } },
      { dtMs: 1000 },
    ],
  }).events,
};

/**
 * Área centrada no alvo: o alvo principal primeiro, depois quem cai no raio, na ordem de
 * NASCIMENTO (a ordem é contrato — cada alvo consome uma rolagem).
 */
export const spellAreaTrace: CombatGoldenTrace = {
  id: 'spell-area',
  description: 'Blast em círculo de raio 1: alvo principal primeiro e vizinhos na ordem de nascimento',
  reference: {
    source: 'canary',
    sections: ['§19 Area Combat', 'FUN-92', 'ADR 0026 decisão 5'],
    note: 'A área colhe todos os alvos ANTES de aplicar dano; a ordem é a de nascimento.',
  },
  seed: 'm24-spell-area',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'spell-cast', subject: 'hero', payload: { casterId: 'hero', spellId: 'blast', targets: ['m:3', 'm:1'], tileCount: 9 } },
    { atMs: 0, kind: 'creature-hit', subject: 'm:3', payload: { creatureId: 'm:3', attackerId: 'hero', amount: 50, source: 'spell', position: { x: 2, y: 0, z: 7 } } },
    { atMs: 0, kind: 'creature-health', subject: 'm:3', payload: { creatureId: 'm:3', health: 150, maxHealth: 200 } },
    { atMs: 0, kind: 'creature-hit', subject: 'm:1', payload: { creatureId: 'm:1', attackerId: 'hero', amount: 50, source: 'spell', position: { x: 3, y: 0, z: 7 } } },
    { atMs: 0, kind: 'creature-health', subject: 'm:1', payload: { creatureId: 'm:1', health: 150, maxHealth: 200 } },
  ],
  gaps: [],
  run: () => runTrace({
    seed: 'm24-spell-area',
    hero: { position: { x: 0, y: 0, z: 7 }, mana: 100, maxMana: 100 },
    monsters: [
      { id: 1, monsterId: 'troll', position: { x: 3, y: 0 }, health: 200 },
      { id: 2, monsterId: 'troll', position: { x: 4, y: 0 }, health: 200 },
      { id: 3, monsterId: 'troll', position: { x: 2, y: 0 }, health: 200 },
      { id: 4, monsterId: 'troll', position: { x: 4, y: 1 }, health: 200 },
    ],
    steps: [{ dtMs: 1000, action: { kind: 'spell', spell: BLAST } }, { dtMs: 1000 }],
  }).events,
};

/**
 * Forma que sai do LANÇADOR (self-origin): a direção é a do passo, e aqui ninguém andou, então
 * é `south`. O `cleave` são os três tiles à frente — dois monstros caem neles.
 */
export const spellSelfOriginTrace: CombatGoldenTrace = {
  id: 'spell-self-origin',
  description: 'Front Sweep (cleave) acerta os três tiles à frente, na direção do lançador',
  reference: {
    source: 'canary',
    sections: ['§19 Area Combat', '#155', 'ADR 0026 decisão 5'],
    note: 'Onda, cleave, feixe e círculo no lançador não exigem alvo nem alcance.',
  },
  seed: 'm24-spell-self',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'spell-cast', subject: 'hero', payload: { casterId: 'hero', spellId: 'front-sweep', targets: ['m:1', 'm:2'], tileCount: 3 } },
    { atMs: 0, kind: 'creature-hit', subject: 'm:1', payload: { creatureId: 'm:1', attackerId: 'hero', amount: 30, source: 'spell', position: { x: 0, y: 1, z: 7 } } },
    { atMs: 0, kind: 'creature-health', subject: 'm:1', payload: { creatureId: 'm:1', health: 170, maxHealth: 200 } },
    { atMs: 0, kind: 'creature-hit', subject: 'm:2', payload: { creatureId: 'm:2', attackerId: 'hero', amount: 30, source: 'spell', position: { x: -1, y: 1, z: 7 } } },
    { atMs: 0, kind: 'creature-health', subject: 'm:2', payload: { creatureId: 'm:2', health: 170, maxHealth: 200 } },
  ],
  gaps: [],
  run: () => runTrace({
    seed: 'm24-spell-self',
    hero: { position: { x: 0, y: 0, z: 7 }, mana: 100, maxMana: 100 },
    monsters: [
      { id: 1, monsterId: 'troll', position: { x: 0, y: 1 }, health: 200 },
      { id: 2, monsterId: 'troll', position: { x: -1, y: 1 }, health: 200 },
      { id: 3, monsterId: 'troll', position: { x: 0, y: -1 }, health: 200 },
    ],
    steps: [{ dtMs: 1000, action: { kind: 'spell', spell: FRONT_SWEEP } }, { dtMs: 1000 }],
  }).events,
};

export const spellTraces: readonly CombatGoldenTrace[] = [
  spellSingleTargetTrace, spellAreaTrace, spellSelfOriginTrace,
];