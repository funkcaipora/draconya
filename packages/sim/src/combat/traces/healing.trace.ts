// Trace de cura (RF-04 da #469).
//
// Referência: Exura (cura fixa), Exura Gran / Light Healing, Exura Vita / Ultimate Healing,
// Mass Healing, e as runas UH/IH. O que existe hoje no catálogo é a cura de BP convertida por
// `combat.spellPower` (#155) e a poção; a paridade com a fórmula de cura do Canary é a #475.
//
// O evento de cura carrega o que REPÔS, não o que o efeito prometia (`#emitHealed`): curar 80
// em quem estava a 10 do teto é `creature-healed 10`. É isso que o oráculo prende.

import type { Spell, Supply } from '@draconya/content';
import { runTrace } from './harness.js';
import type { CombatGoldenTrace, CombatTraceGap } from './types.js';

const HEAL: Spell = {
  id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000, minLevel: 1,
  effect: { kind: 'heal', amount: 60 },
};

const LIGHT_HEALING: Spell = {
  id: 'light-healing-druid', name: 'Light Healing', manaCost: 20, cooldownMs: 1_000,
  group: 'healing', groupCooldownMs: 1_000, minLevel: 8, vocationId: 'druid',
  effect: { kind: 'heal', basePower: 40 },
};

const ULTIMATE_HEALING: Spell = {
  id: 'ultimate-healing-druid', name: 'Ultimate Healing', manaCost: 160, cooldownMs: 1_000,
  group: 'healing', groupCooldownMs: 1_000, minLevel: 30, vocationId: 'druid',
  effect: { kind: 'heal', basePower: 250 },
};

const HEALTH_POTION: Supply = {
  id: 'health-potion', name: 'Health Potion', price: 45, group: 'potion',
  groupCooldownMs: 1_000, requires: {}, effect: { kind: 'heal', amount: 80 },
};

export const healingGaps: readonly CombatTraceGap[] = [
  {
    id: 'mass-healing-area',
    reference: 'Mass Healing cura o lançador e a party num raio (TibiaWiki 13.32).',
    current: 'O catálogo cura só o lançador; não há cura em área para aliados.',
    task: '#475',
  },
  {
    id: 'uh-ih-runes',
    reference: 'UH (Ultimate Healing Rune) e IH (Intense Healing Rune) são runas de cura.',
    current: 'Runas de cura não existem: só a Avalanche de ataque está no catálogo.',
    task: '#475',
  },
  {
    id: 'canary-heal-formula',
    reference: 'Canary: min/max = (level/5) + (maglevel × fator) + base (TibiaWiki 13.32).',
    current: 'Fórmula provisória `spellPowerRange` sobre o Base Power (#155).',
    task: '#475',
  },
];

/** Cura fixa de 60 em quem estava a 40/100: repõe 60 e a barra vai a 100. */
export const healFixedTrace: CombatGoldenTrace = {
  id: 'heal-fixed',
  description: 'Cura de valor fixo repõe o valor, sem RNG',
  reference: {
    source: 'draconya',
    sections: ['casting.ts (FUN-74)', 'combat-events.ts (FUN-109)'],
    note: 'Cura fixa é o v1 do catálogo; serve de âncora determinística.',
  },
  seed: 'm24-heal-fixed',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'creature-healed', subject: 'hero', payload: { creatureId: 'hero', amount: 60, source: 'spell' } },
    { atMs: 0, kind: 'creature-health', subject: 'hero', payload: { creatureId: 'hero', health: 100, maxHealth: 100 } },
  ],
  gaps: [],
  run: () => runTrace({
    seed: 'm24-heal-fixed',
    hero: { health: 40, maxHealth: 100, mana: 100, maxMana: 100 },
    monsters: [],
    steps: [{ dtMs: 1000, action: { kind: 'spell', spell: HEAL } }, { dtMs: 1000 }],
  }).events,
};

/** Cura de Base Power: o valor é sorteado no intervalo do BP — semente fixa, número fixo. */
export const lightHealingTrace: CombatGoldenTrace = {
  id: 'heal-light',
  description: 'Light Healing (BP 40) em level 8, magic 0, com semente fixa',
  reference: {
    source: 'tibiawiki',
    sections: ['§22 Spells', '#155', 'ADR 0026 decisão 5'],
    note: 'BP 40 calibrado para render ~59 no level 8 com magic 0; a paridade Canary é a #475.',
  },
  seed: 'm24-heal-light',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'creature-healed', subject: 'hero', payload: { creatureId: 'hero', amount: 59, source: 'spell' } },
    { atMs: 0, kind: 'creature-health', subject: 'hero', payload: { creatureId: 'hero', health: 99, maxHealth: 200 } },
  ],
  gaps: healingGaps,
  run: () => runTrace({
    seed: 'm24-heal-light',
    hero: {
      health: 40, maxHealth: 200, mana: 100, maxMana: 100,
      level: 8, vocationId: 'druid',
    },
    monsters: [],
    steps: [{ dtMs: 1000, action: { kind: 'spell', spell: LIGHT_HEALING } }, { dtMs: 1000 }],
  }).events,
};

/** Ultimate Healing: BP 250 no level 30 — a cura grande do druida. */
export const ultimateHealingTrace: CombatGoldenTrace = {
  id: 'heal-ultimate',
  description: 'Ultimate Healing (BP 250) em level 30, magic 0, com semente fixa',
  reference: {
    source: 'tibiawiki',
    sections: ['§22 Spells', '#155'],
    note: 'Exura Vita; a paridade Canary é a #475.',
  },
  seed: 'm24-heal-ultimate',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'creature-healed', subject: 'hero', payload: { creatureId: 'hero', amount: 688, source: 'spell' } },
    { atMs: 0, kind: 'creature-health', subject: 'hero', payload: { creatureId: 'hero', health: 788, maxHealth: 5000 } },
  ],
  gaps: healingGaps,
  run: () => runTrace({
    seed: 'm24-heal-ultimate',
    hero: {
      health: 100, maxHealth: 5_000, mana: 200, maxMana: 200,
      level: 30, vocationId: 'druid',
    },
    monsters: [],
    steps: [{ dtMs: 1000, action: { kind: 'spell', spell: ULTIMATE_HEALING } }, { dtMs: 1000 }],
  }).events,
};

/** Poção: `supply-used` antes do que repôs, e o gold debitado no ato. */
export const healthPotionTrace: CombatGoldenTrace = {
  id: 'heal-potion',
  description: 'Health potion repõe 80, e o supply-used sai antes da cura',
  reference: {
    source: 'draconya',
    sections: ['§20.1', 'FUN-77', 'FUN-109'],
    note: 'Poção e runa são suprimentos abstratos: gold no uso, sem pilha.',
  },
  seed: 'm24-heal-potion',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'supply-used', subject: 'hero', payload: { characterId: 'hero', supplyId: 'health-potion', targets: [], tileCount: 0 } },
    { atMs: 0, kind: 'creature-healed', subject: 'hero', payload: { creatureId: 'hero', amount: 80, source: 'supply' } },
    { atMs: 0, kind: 'creature-health', subject: 'hero', payload: { creatureId: 'hero', health: 130, maxHealth: 200 } },
  ],
  gaps: [],
  run: () => runTrace({
    seed: 'm24-heal-potion',
    hero: { health: 50, maxHealth: 200, mana: 0, maxMana: 100, gold: 100 },
    monsters: [],
    steps: [{ dtMs: 1000, action: { kind: 'supply', supply: HEALTH_POTION } }, { dtMs: 1000 }],
  }).events,
};

export const healingTraces: readonly CombatGoldenTrace[] = [
  healFixedTrace, lightHealingTrace, ultimateHealingTrace, healthPotionTrace,
];