// Trace de cura (RF-04 da #469; fórmula canônica e runas pela #475).
//
// Referência: Exura (Light Healing), Exura Gran (Intense Healing), Exura Vita (Ultimate
// Healing), Mass Healing, Wound Cleansing, Divine Healing e as runas UH/IH. A #475 fechou as
// três lacunas que este arquivo nomeava: a fórmula canônica do Canary substituiu a conversão
// provisória do `basePower`, a Mass Healing cura em área centrada no lançador, e UH/IH existem
// como supply de cura. O `healingGaps` fica VAZIO porque nada da referência de cura ficou de
// fora.
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

// Light Healing (`exura`): min = level/5 + ML×1.4 + 8, max = level/5 + ML×2.0 + 11. O BP 40
// continua no catálogo como número de exibição (ADR 0033); a fórmula VENCE (#475).
const LIGHT_HEALING: Spell = {
  id: 'light-healing-druid', name: 'Light Healing', manaCost: 20, cooldownMs: 1_000,
  group: 'healing', groupCooldownMs: 1_000, minLevel: 8, vocationId: 'druid',
  effect: {
    kind: 'heal', basePower: 40,
    formula: { levelFactor: 0.2, skillMin: 1.4, skillMax: 2.0, baseMin: 8, baseMax: 11 },
  },
};

// Ultimate Healing (`exura vita`): min = level/5 + ML×4.3 + 40, max = level/5 + ML×5.3 + 60.
const ULTIMATE_HEALING: Spell = {
  id: 'ultimate-healing-druid', name: 'Ultimate Healing', manaCost: 160, cooldownMs: 1_000,
  group: 'healing', groupCooldownMs: 1_000, minLevel: 30, vocationId: 'druid',
  effect: {
    kind: 'heal', basePower: 250,
    formula: { levelFactor: 0.2, skillMin: 4.3, skillMax: 5.3, baseMin: 40, baseMax: 60 },
  },
};

// Mass Healing (`exura gran mas res`): mesma escala da Light Healing com bases maiores, e a
// forma 3x3 centrada no lançador (#475). Aqui o trace prende a fórmula do CONJURADOR; os
// aliados na área são cobertos pela `HuntRuleset` em `hunt.test.ts`.
const MASS_HEALING: Spell = {
  id: 'mass-healing', name: 'Mass Healing', manaCost: 150, cooldownMs: 2_000,
  group: 'healing', groupCooldownMs: 1_000, minLevel: 36, vocationId: 'druid',
  effect: {
    kind: 'heal', basePower: 200,
    area: { shape: 'circle', radius: 1, centered: 'caster' },
    formula: { levelFactor: 0.2, skillMin: 1.4, skillMax: 2.0, baseMin: 40, baseMax: 60 },
  },
};

// Ultimate Healing Rune (UH): min = level/5 + ML×5.7 + 36, max = level/5 + ML×10.3 + 65. É o
// exemplo do contrato da #475; o supply escala pelo MAGIC LEVEL e debita gold no uso.
const ULTIMATE_HEALING_RUNE: Supply = {
  id: 'ultimate-healing-rune', name: 'Ultimate Healing Rune', price: 35,
  group: 'healing', groupCooldownMs: 1_000,
  requires: { level: 24, magicLevel: 4 },
  effect: {
    kind: 'heal', range: 4,
    formula: { levelFactor: 0.2, skillMin: 5.7, skillMax: 10.3, baseMin: 36, baseMax: 65 },
  },
};

const HEALTH_POTION: Supply = {
  id: 'health-potion', name: 'Health Potion', price: 45, group: 'potion',
  groupCooldownMs: 1_000, requires: {}, effect: { kind: 'heal', amount: 80 },
};

/** A referência de cura está inteira: a #475 fechou a área, as runas e a fórmula. */
export const healingGaps: readonly CombatTraceGap[] = [];

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

/** Light Healing: a fórmula Canary em level 8, magic 0 → 9~12; a semente fixa dá 10. */
export const lightHealingTrace: CombatGoldenTrace = {
  id: 'heal-light',
  description: 'Light Healing (fórmula Canary) em level 8, magic 0, com semente fixa',
  reference: {
    source: 'tibiawiki',
    sections: ['§22 Spells', '#475', 'ADR 0019'],
    note: 'min = 8/5 + 0×1.4 + 8 = 9; max = 8/5 + 0×2.0 + 11 = 12. Mutação que mata: cair no '
      + 'basePower 40 daria 50~69.',
  },
  seed: 'm24-heal-light',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'creature-healed', subject: 'hero', payload: { creatureId: 'hero', amount: 10, source: 'spell' } },
    { atMs: 0, kind: 'creature-health', subject: 'hero', payload: { creatureId: 'hero', health: 50, maxHealth: 200 } },
  ],
  gaps: [],
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

/** Ultimate Healing: a fórmula Canary em level 30, magic 0 → 46~66; a semente fixa dá 55. */
export const ultimateHealingTrace: CombatGoldenTrace = {
  id: 'heal-ultimate',
  description: 'Ultimate Healing (fórmula Canary) em level 30, magic 0, com semente fixa',
  reference: {
    source: 'tibiawiki',
    sections: ['§22 Spells', '#475'],
    note: 'min = 30/5 + 0×4.3 + 40 = 46; max = 30/5 + 0×5.3 + 60 = 66.',
  },
  seed: 'm24-heal-ultimate',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'creature-healed', subject: 'hero', payload: { creatureId: 'hero', amount: 55, source: 'spell' } },
    { atMs: 0, kind: 'creature-health', subject: 'hero', payload: { creatureId: 'hero', health: 155, maxHealth: 5000 } },
  ],
  gaps: [],
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

/** Mass Healing: a fórmula do conjurador em level 36, magic 0 → 47~67; a semente fixa dá 60. */
export const massHealingTrace: CombatGoldenTrace = {
  id: 'heal-mass',
  description: 'Mass Healing (fórmula Canary) em level 36, magic 0, com semente fixa',
  reference: {
    source: 'tibiawiki',
    sections: ['§22 Spells', '#475'],
    note: 'min = 36/5 + 0×1.4 + 40 = 47; max = 36/5 + 0×2.0 + 60 = 67. A área 3x3 e os '
      + 'aliados são cobertos pela HuntRuleset.',
  },
  seed: 'm24-heal-mass',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'creature-healed', subject: 'hero', payload: { creatureId: 'hero', amount: 60, source: 'spell' } },
    { atMs: 0, kind: 'creature-health', subject: 'hero', payload: { creatureId: 'hero', health: 100, maxHealth: 200 } },
  ],
  gaps: [],
  run: () => runTrace({
    seed: 'm24-heal-mass',
    hero: {
      health: 40, maxHealth: 200, mana: 200, maxMana: 200,
      level: 36, vocationId: 'druid',
    },
    monsters: [],
    steps: [{ dtMs: 1000, action: { kind: 'spell', spell: MASS_HEALING } }, { dtMs: 1000 }],
  }).events,
};

/** UH rune: level 50, ML 40 → 274~487; a semente fixa dá 368, e o gold sai no ato. */
export const ultimateHealingRuneTrace: CombatGoldenTrace = {
  id: 'heal-uh-rune',
  description: 'Ultimate Healing Rune (fórmula Canary) em level 50, ML 40, com semente fixa',
  reference: {
    source: 'tibiawiki',
    sections: ['§20.1', '#475', 'ADR 0032 d.6'],
    note: 'min = 50/5 + 40×5.7 + 36 = 274; max = 50/5 + 40×10.3 + 65 = 487. O supply-used '
      + 'sai antes da cura e o gold é debitado uma vez.',
  },
  seed: 'm24-heal-uh',
  advancePlanMs: [1000, 1000],
  expected: [
    { atMs: 0, kind: 'supply-used', subject: 'hero', payload: { characterId: 'hero', supplyId: 'ultimate-healing-rune', targets: [], tileCount: 0 } },
    { atMs: 0, kind: 'creature-healed', subject: 'hero', payload: { creatureId: 'hero', amount: 368, source: 'supply' } },
    { atMs: 0, kind: 'creature-health', subject: 'hero', payload: { creatureId: 'hero', health: 468, maxHealth: 5000 } },
  ],
  gaps: [],
  run: () => runTrace({
    seed: 'm24-heal-uh',
    hero: {
      health: 100, maxHealth: 5_000, mana: 0, maxMana: 0,
      level: 50, gold: 100, goldDelta: 0,
    },
    monsters: [],
    steps: [{
      dtMs: 1000,
      action: { kind: 'supply', supply: ULTIMATE_HEALING_RUNE, skillLevel: 40 },
    }, { dtMs: 1000 }],
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
  healFixedTrace, lightHealingTrace, ultimateHealingTrace, massHealingTrace,
  ultimateHealingRuneTrace, healthPotionTrace,
];
