// A semântica de SLOT das automações (AB-08): trocar o modelo sem trocar o slot do item é o
// erro que só apareceria na hunt, quando a automação tentasse vestir um anel no colo.
//
// O vocabulário é do AB-03; esta task estende `validateBotConfigV2` para cruzar cada id com o
// slot que o modelo exige.

import { describe, expect, it } from 'vitest';
import { validateBotConfigV2 } from './bot.js';
import { buildContent, placeholderAppearances } from './content.js';
import type { RawContent } from './content.js';
import {
  BOT_AUTOMATION_MODELS, BOT_SET_COUNT, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema,
} from './schemas.js';
import { BOT_AUTOMATION_CATALOGUE } from './bot-automation.js';
import type { BotConfigV2 } from './schemas.js';

const base: RawContent = {
  monsters: [], hunts: [], vocations: [],
  progression: [{
    id: 'baseline', startingHealth: 150, startingMana: 60, startingCapacity: 400,
    healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
    vocationLevel: 8, startingSpeed: 300, speedPerLevel: 0,
    regen: { healthPerSecond: 1, manaPerSecond: 1 },
    xp: { base: 20, exponent: 2 },
    deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
  }],
  combat: [{
    id: 'baseline', dodgeMultiplier: 0.5,
    armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 }, minimumDamageFraction: 0.1,
    player: {
      attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 4, dodgeChance: 0.05,
    },
  }],
  stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
  party: [{ id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 } }],
  bot: [{
    id: 'baseline', vocabularyVersion: BOT_VOCABULARY_VERSION, categoryCooldownMs: 1_000,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
  }],
  spells: [],
  skills: [
    { id: 'melee', name: 'Corpo a Corpo', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5 },
    { id: 'distance', name: 'Distância', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'distance-hit', points: 1 }, damagePerLevel: 0 },
  ],
  weaponFamilies: [
    { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
    { id: 'sword', name: 'Sword', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
    { id: 'distance', name: 'Distance', kind: 'distance', skillId: 'distance', range: 6, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  ],
  items: [
    { id: 'life-ring', name: 'Life Ring', kind: 'ring', slot: 'finger', weight: 1, value: 0, armor: 2 },
    { id: 'glacier-amulet', name: 'Glacier Amulet', kind: 'amulet', slot: 'neck', weight: 5, value: 0 },
    {
      id: 'arrow', name: 'Arrow', kind: 'ammo', slot: 'ammo', weight: 0.1, value: 0, stackable: true,
      attack: 20, price: 1, restock: { batch: 100, min: 0 }, ammunition: { family: 'arrow' },
    },
    {
      id: 'burst-arrow', name: 'Burst Arrow', kind: 'ammo', slot: 'ammo', weight: 0.1, value: 0, stackable: true,
      attack: 25, price: 1, restock: { batch: 100, min: 0 }, ammunition: { family: 'arrow' },
    },
    { id: 'spike-sword', name: 'Spike Sword', kind: 'weapon', slot: 'hand', weight: 50, value: 0, attack: 24 },
    { id: 'wooden-shield', name: 'Wooden Shield', kind: 'shield', slot: 'shield', weight: 40, value: 0, defense: 5 },
    {
      id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', twoHanded: true, weight: 31, value: 0,
      weapon: { kind: 'distance', family: 'distance', range: 6, ammoFamily: 'arrow' },
    },
  ],
};

const content = buildContent({ appearances: [placeholderAppearances(base)], ...base });

const config = (automations: readonly unknown[]): BotConfigV2 => botConfigV2Schema.parse({
  version: BOT_VOCABULARY_VERSION,
  activeSet: 0,
  sets: Array.from({ length: BOT_SET_COUNT }, () => ({
    slots: Array.from({ length: BOT_SLOTS_PER_SET }, () => null),
  })),
  automations,
});

describe('validateBotConfigV2 confere o slot de cada id de automação (AB-08)', () => {
  it('aceita os ids no slot que o modelo exige', () => {
    expect(validateBotConfigV2(config([
      { model: 'renew-ring', params: { itemId: 'life-ring' } },
      { model: 'renew-amulet', params: { itemId: 'glacier-amulet' } },
      { model: 'swap-ammo-by-targets', params: { ammoA: 'burst-arrow', ammoB: 'arrow' } },
      {
        model: 'swap-weapon-shield-by-hp',
        params: { oneHanded: 'spike-sword', shield: 'wooden-shield', twoHanded: 'bow' },
      },
      { model: 'swap-ring', params: { itemId: 'life-ring' } },
    ]), content)).toEqual([]);
  });

  it('recusa o anel no slot errado, nomeando modelo, item e slot esperado', () => {
    const problems = validateBotConfigV2(config([
      { model: 'renew-ring', params: { itemId: 'glacier-amulet' } },
    ]), content);
    expect(problems[0]).toContain('renew-ring');
    expect(problems[0]).toContain('glacier-amulet');
    expect(problems[0]).toContain('finger');
  });

  it('recusa o colar fora do neck', () => {
    const problems = validateBotConfigV2(config([
      { model: 'renew-amulet', params: { itemId: 'life-ring' } },
    ]), content);
    expect(problems[0]).toContain('renew-amulet');
    expect(problems[0]).toContain('neck');
  });

  it('recusa munição fora do slot ammo', () => {
    const problems = validateBotConfigV2(config([
      { model: 'swap-ammo-by-targets', params: { ammoA: 'life-ring', ammoB: 'arrow' } },
    ]), content);
    expect(problems[0]).toContain('swap-ammo-by-targets');
    expect(problems[0]).toContain('life-ring');
    expect(problems[0]).toContain('ammo');
  });

  it('recusa escudo que não é escudo e arma que não é de mão', () => {
    const problems = validateBotConfigV2(config([
      {
        model: 'swap-weapon-shield-by-hp',
        params: { oneHanded: 'life-ring', shield: 'arrow', twoHanded: 'bow' },
      },
    ]), content);
    expect(problems.some((problem) => problem.includes('"life-ring"') && problem.includes('hand')))
      .toBe(true);
    expect(problems.some((problem) => problem.includes('"arrow"') && problem.includes('shield')))
      .toBe(true);
  });

  it('recusa o anel do swap-ring fora do finger', () => {
    const problems = validateBotConfigV2(config([
      { model: 'swap-ring', params: { itemId: 'glacier-amulet' } },
    ]), content);
    expect(problems[0]).toContain('swap-ring');
    expect(problems[0]).toContain('finger');
  });

  it('item inexistente continua sendo recusado pelo motivo de sempre', () => {
    const problems = validateBotConfigV2(config([
      { model: 'renew-ring', params: { itemId: 'nao-existe' } },
    ]), content);
    expect(problems[0]).toContain('nao-existe');
    expect(problems[0]).toContain('não existe');
  });
});

describe('BOT_AUTOMATION_CATALOGUE descreve os cinco modelos (AB-09)', () => {
  it('cobre todo modelo do vocabulário, com rótulo e parâmetros', () => {
    // Um modelo novo sem descritor sumiria do painel do AB-12 em silêncio: o teste prende a
    // cobertura, e o catálogo é o que a tela oferece.
    expect(BOT_AUTOMATION_CATALOGUE.map((descriptor) => descriptor.model))
      .toEqual([...BOT_AUTOMATION_MODELS]);
    for (const descriptor of BOT_AUTOMATION_CATALOGUE) {
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.params.length).toBeGreaterThan(0);
    }
  });
});
