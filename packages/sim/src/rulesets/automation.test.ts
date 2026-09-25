// A integração das automações no ruleset de hunt (AB-08): o evento periódico na fila, a
// antecipação por dano/vencimento, a independência entre automações e a equivalência 10 Hz/1 Hz.
//
// A lógica pura é provada com atuador falso em `automation.test.ts`; aqui o que se prova é o
// RELÓGIO — que a decisão vive na fila e não no tick (invariante 2, ADR 0020).

import {
  BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema, buildContent,
  placeholderAppearances,
} from '@draconya/content';
import type { Content, Progression, RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import type { InventoryState } from '../inventory.js';
import { statsForLevel } from '../progression.js';
import type { Session } from '../session.js';
import { createHuntSession } from './hunt.js';

const map = {
  id: 'arena', z: 7,
  grid: ['######', '#....#', '#....#', '#....#', '######'],
};

const route = {
  id: 'arena-loop', mapId: 'arena',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 1, z: 7 }, { x: 4, y: 1, z: 7 },
    { x: 4, y: 2, z: 7 }, { x: 4, y: 3, z: 7 }, { x: 3, y: 3, z: 7 }, { x: 2, y: 3, z: 7 },
    { x: 1, y: 3, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [{ routeIndex: 0, radius: 1 }],
};

/** Um monstro inofensivo: serve para o mundo existir, não para machucar. */
const dummy = {
  id: 'dummy', name: 'Dummy', recommendedLevel: 1,
  health: 1_000_000, experience: 0, attack: 0, armor: 0,
  attackIntervalMs: 10_000, speed: 1500, aggroRadius: 1, attackRange: 1,
  loot: { items: [] },
};

const brawler = {
  id: 'brawler', name: 'Brawler', recommendedLevel: 1,
  health: 1_000_000, experience: 0, attack: 40, armor: 0,
  attackIntervalMs: 10_000, speed: 1500, aggroRadius: 8, attackRange: 1,
  loot: { items: [] },
};

const hunt = {
  id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
  difficulties: {
    cautious: {
      monsterCount: 1, composition: [{ monsterId: 'dummy', weight: 1 }], respawnDelayMs: 30_000,
    },
    bold: {
      monsterCount: 1, composition: [{ monsterId: 'brawler', weight: 1 }], respawnDelayMs: 30_000,
    },
  },
};

const progression = {
  id: 'baseline', startingHealth: 1_000, startingMana: 200, startingCapacity: 1_000,
  healthPerLevel: 0, manaPerLevel: 0, capacityPerLevel: 0, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  regen: { healthPerSecond: 0, manaPerSecond: 0 },
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
} as Progression;

const combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 }, minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0 },
};

const stamina = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
const party = { id: 'baseline', maxMembers: 4 };

const skills = [
  { id: 'melee', name: 'Corpo a Corpo', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5 },
  { id: 'distance', name: 'Distância', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'distance-hit', points: 1 }, damagePerLevel: 0 },
];
const weaponFamilies = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'sword', name: 'Sword', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'distance', name: 'Distance', kind: 'distance', skillId: 'distance', range: 6, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
];

const items = [
  {
    id: 'life-ring', name: 'Life Ring', kind: 'ring', slot: 'finger',
    weight: 1, value: 0, durationMs: 3_000,
  },
  {
    id: 'glacier-amulet', name: 'Glacier Amulet', kind: 'amulet', slot: 'neck',
    weight: 5.5, value: 0, charges: 2,
    mitigation: { resistances: { physical: 0.5 } },
  },
  { id: 'spike-sword', name: 'Spike Sword', kind: 'weapon', slot: 'hand', weight: 50, value: 0, attack: 24 },
  { id: 'wooden-shield', name: 'Wooden Shield', kind: 'shield', slot: 'shield', weight: 40, value: 0, defense: 5 },
  {
    id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', twoHanded: true, weight: 31, value: 0,
    weapon: { kind: 'distance', family: 'distance', range: 6, ammoFamily: 'arrow' },
  },
];

const ammunition = [
  { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1 },
];

const content = (over: Partial<RawContent> = {}): Content => {
  const base: RawContent = {
    monsters: [dummy, brawler], hunts: [hunt], vocations: [], progression: [progression],
    combat: [combat], stamina: [stamina], party: [party], spells: [], skills, weaponFamilies,
    items, ammunition, maps: [map], routes: [route],
    bot: [{ id: 'baseline', vocabularyVersion: BOT_VOCABULARY_VERSION, categoryCooldownMs: 1_000, slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    ...over,
  };
  return buildContent({ appearances: [placeholderAppearances(base)], ...base });
};

const v2 = (automations: readonly unknown[]) => botConfigV2Schema.parse({
  version: BOT_VOCABULARY_VERSION,
  activeSet: 0,
  sets: Array.from({ length: 4 }, () => ({
    slots: Array.from({ length: BOT_SLOTS_PER_SET }, () => null),
  })),
  automations,
});

const hero = (inventory?: InventoryState): CharacterRuntime => {
  const stats = statsForLevel(1, null, progression);
  return new CharacterRuntime({
    id: 'hero', position: { x: 1, y: 1, z: 7 },
    health: stats.maxHealth, maxHealth: stats.maxHealth,
    mana: stats.maxMana, maxMana: stats.maxMana,
    level: 1, xp: 0, vocationId: null,
    staminaMs: stamina.maxMs, staminaUpdatedAtMs: 0,
    goldDelta: 0, alive: true, cooldowns: {}, capacity: stats.capacity,
    ...(inventory === undefined ? {} : { inventory }),
  });
};

function run(session: Session, durationMs: number, stepMs: number): void {
  const steps = Math.floor(durationMs / stepMs);
  for (let i = 0; i < steps && session.ended === null; i++) session.advanceBy(stepMs);
}

const eventsOf = (session: Session, type: string) =>
  session.notableEvents.filter((event) => event.type === type);

describe('renew-ring no mundo real (AB-08, ADR 0032 d.8)', () => {
  const start = (stepMs: number) => {
    const session = createHuntSession({
      id: 'renew', content: content(), huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      botConfig: v2([{ model: 'renew-ring', params: { itemId: 'life-ring' } }]),
    });
    const character = hero({
      backpack: [{ instanceId: 'bag-0', itemId: 'life-ring', quantity: 1 }],
      equipped: { finger: { instanceId: 'initial', itemId: 'life-ring', quantity: 1 } },
    });
    session.enter(character);
    run(session, 4_000, stepMs);
    return {
      equipped: character.inventory.equippedAt('finger')?.instanceId ?? null,
      equippedEvents: eventsOf(session, 'ring-equipped').length,
      blockedEvents: eventsOf(session, 'automation-blocked').length,
    };
  };

  it('o anel vence por duração e a automação equipa o próximo da mochila', () => {
    const result = start(100);
    expect(result.equipped).toBe('bag-0');
    expect(result.equippedEvents).toBe(1);
  });

  it('10 Hz e 1 Hz dão o MESMO resultado com a automação ligada', () => {
    // Se a decisão estivesse fora da fila, o anel venceria em instantes diferentes conforme a
    // taxa. O resultado — qual instância está no dedo e quantas renovações — tem de ser o mesmo.
    expect(start(1_000)).toEqual(start(100));
  });
});

describe('renew-amulet no mundo real (AB-08, ADR 0032 d.8)', () => {
  it('o colar esgota as cargas e a automação equipa o próximo', () => {
    const session = createHuntSession({
      id: 'renew-amulet', content: content(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      botConfig: v2([{ model: 'renew-amulet', params: { itemId: 'glacier-amulet' } }]),
    });
    const character = hero({
      backpack: [{ instanceId: 'amulet-1', itemId: 'glacier-amulet', quantity: 1 }],
      equipped: {
        neck: { instanceId: 'amulet-0', itemId: 'glacier-amulet', quantity: 1, charges: 1 },
      },
    });
    session.enter(character);
    session.advanceBy(300);

    // A carga esgotou no golpe do brawler; o item foi destruído e a automação equipou o próximo.
    expect(character.inventory.equippedAt('neck')?.instanceId).toBe('amulet-1');
  });
});

describe('#onAutomation não aborta na primeira automação bloqueada (RF-09)', () => {
  it('a ausência do primeiro item não impede a segunda automação', () => {
    const session = createHuntSession({
      id: 'blocked', content: content(), huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
      botConfig: v2([
        { model: 'renew-ring', params: { itemId: 'life-ring' } },
        { model: 'renew-amulet', params: { itemId: 'glacier-amulet' } },
      ]),
    });
    const character = hero({
      backpack: [{ instanceId: 'amulet-0', itemId: 'glacier-amulet', quantity: 1 }],
      equipped: {},
    });
    session.enter(character);
    session.advanceBy(100);

    expect(eventsOf(session, 'automation-blocked')[0]?.detail)
      .toBe('renew-ring:missing-item:life-ring');
    expect(eventsOf(session, 'amulet-equipped')[0]?.detail).toBe('glacier-amulet');
    expect(character.inventory.equippedAt('neck')?.itemId).toBe('glacier-amulet');
  });
});

describe('swap-weapon-shield-by-hp no mundo real (AB-08, ADR 0032 d.9)', () => {
  it('troca com o dano recebido, sem depender de tick nem de opcode', () => {
    const session = createHuntSession({
      id: 'swap', content: content(), huntId: 'arena', difficulty: 'bold', createdAtMs: 0,
      botConfig: v2([{
        model: 'swap-weapon-shield-by-hp',
        params: { oneHanded: 'spike-sword', shield: 'wooden-shield', twoHanded: 'bow' },
        enter: [{ kind: 'hp', op: '<', percent: 99 }],
        exit: [],
      }]),
    });
    const character = hero({
      backpack: [
        { instanceId: 'sword-0', itemId: 'spike-sword', quantity: 1 },
        { instanceId: 'shield-0', itemId: 'wooden-shield', quantity: 1 },
      ],
      equipped: { hand: { instanceId: 'bow-0', itemId: 'bow', quantity: 1 } },
    });
    session.enter(character);
    // O brawler bate no primeiro segundo; o dano antecipa a automação no mesmo despacho.
    session.advanceBy(300);

    expect(character.health).toBeLessThan(character.maxHealth);
    expect(character.inventory.equippedAt('hand')?.itemId).toBe('spike-sword');
    expect(character.inventory.equippedAt('shield')?.itemId).toBe('wooden-shield');
  });
});
