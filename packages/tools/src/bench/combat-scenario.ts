// O cenário MISTO do benchmark de combate (CMB-10, #336; DT-03).
//
// O cenário frio (`cold-scenario.ts`) mede o custo de uma hunt cheia de ratos: golpe corpo a
// corpo, sem mitigação, sem defesa, sem condição. É representativo do MOTOR, e não do PIPELINE
// que o M19 entregou. Este cenário existe para medir a composição real: ability de monstro à
// distância e em área, resistência/vulnerabilidade, defesa de escudo, condição/DOT, campo por
// tile e modificadores (crítico/leech) — o caminho quente que o marco acrescentou.
//
// Vive em módulo próprio, como o cenário frio, para ser TESTÁVEL sem rodar a medição: o bench não
// roda no CI, e um contrato de `buildContent` que mude deixaria o cenário quebrado em silêncio.
// `combat-scenario.test.ts` monta e avança uma hunt — é o que reprova no PR.
//
// Nada aqui lê `things/` nem fala com serviço externo (invariante 6 e a própria issue): o
// conteúdo é sintético e a aparência é `placeholderAppearances`.

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Content, RawContent } from '@draconya/content';
import { CharacterRuntime, statsForLevel } from '@draconya/sim';
import type { Point } from '@draconya/sim';

const SIZE = 24;

/** O mesmo miolo do cenário frio: paredes espalhadas para exercitar o desvio do passo guloso. */
const grid = Array.from({ length: SIZE }, (_, y) =>
  Array.from({ length: SIZE }, (_, x) => {
    if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) return '#';
    const inside = x >= 3 && x <= SIZE - 4 && y >= 3 && y <= SIZE - 4;
    return inside && x % 7 === 3 && y % 5 !== 0 ? '#' : '.';
  }).join(''));

function loop(): Point[] {
  const tiles: Point[] = [];
  const lo = 1;
  const hi = SIZE - 2;
  for (let x = lo; x < hi; x++) tiles.push({ x, y: lo, z: 7 });
  for (let y = lo; y < hi; y++) tiles.push({ x: hi, y, z: 7 });
  for (let x = hi; x > lo; x--) tiles.push({ x, y: hi, z: 7 });
  for (let y = hi; y > lo; y--) tiles.push({ x: lo, y, z: 7 });
  return tiles;
}

const tiles = loop();
const spawnPoints = tiles
  .map((_, index) => index)
  .filter((index) => index % 8 === 0)
  .slice(0, 10)
  .map((routeIndex) => ({ routeIndex, radius: 3 }));

export const COMBAT_HUNT_ID = 'combat';
export const COMBAT_DIFFICULTY = 'reckless';

/** Os ids do cenário, para o teste estrutural prender que a composição continua de pé. */
export const COMBAT_MONSTER_IDS = ['flamer', 'brute'] as const;
export const COMBAT_SWORD_ID = 'combat-sword';
export const COMBAT_SHIELD_ID = 'combat-shield';
export const COMBAT_BACKPACK_ID = 'combat-backpack';

function rawCombatContent(): RawContent {
  return {
    monsters: [
      {
        id: 'flamer', name: 'Flamer', recommendedLevel: 1,
        health: 300, experience: 20, attack: 8, armor: 2,
        attackIntervalMs: 2_000, speed: 180, aggroRadius: 8, attackRange: 1,
        loot: { gold: { chance: 1, min: 2, max: 5 }, items: [] },
        // CMB-03: resistência a fogo e vulnerabilidade a gelo, no mesmo monstro.
        mitigation: { resistances: { fire: 0.5, ice: -0.25 }, immunities: [] },
        // CMB-06/CMB-07: ability em ÁREA com DOT e campo por tile, e uma à distância.
        abilities: [
          {
            id: 'flame-burst', cadenceMs: 1_500,
            target: { range: 6, area: { shape: 'circle', radius: 1, centered: 'target' } },
            power: { min: 6, max: 12 }, damageType: 'fire',
            presentation: { missileKey: 'fire-missile', impactKey: 'fire-impact' },
            condition: {
              key: 'burn', merge: 'refresh', durationMs: 4_000,
              effect: { kind: 'damage-over-time', amount: 4, intervalMs: 1_000, damageType: 'fire' },
            },
            field: {
              id: 'fire-field', durationMs: 5_000,
              shape: { shape: 'circle', radius: 1, centered: 'target' },
              condition: {
                key: 'fire-field', merge: 'refresh', durationMs: 5_000,
                effect: { kind: 'damage-over-time', amount: 3, intervalMs: 1_000, damageType: 'fire' },
              },
            },
          },
          {
            id: 'spit', cadenceMs: 2_000,
            target: { range: 5 }, power: { min: 4, max: 9 }, damageType: 'physical',
          },
        ],
      },
      {
        id: 'brute', name: 'Brute', recommendedLevel: 1,
        health: 500, experience: 30, attack: { min: 6, max: 14 }, armor: 4,
        attackIntervalMs: 2_000, speed: 160, aggroRadius: 8, attackRange: 1,
        damageType: 'physical',
        loot: { gold: { chance: 1, min: 3, max: 7 }, items: [] },
        // Imunidade explícita, sem piso que a revogue (CMB-03).
        mitigation: { resistances: { physical: 0.2 }, immunities: [] },
      },
    ],
    hunts: [{
      id: COMBAT_HUNT_ID, name: 'Combat Cellars', recommendedLevel: 1,
      mapId: 'combat', routeId: 'combat-loop',
      difficulties: {
        reckless: {
          monsterCount: 40,
          composition: [{ monsterId: 'flamer', weight: 3 }, { monsterId: 'brute', weight: 1 }],
          respawnDelayMs: 30_000,
        },
      },
    }],
    vocations: [],
    progression: [{
      // Vida enorme, como no cenário frio: o benchmark mede CUSTO, e um personagem que morre no
      // meio encerra a sessão e o laço medido passa a rodar sessões mortas — que custam quase
      // nada e fazem o µs/tick despencar para zero. O balanceamento não é o assunto aqui.
      id: 'baseline', startingHealth: 1_000_000, startingMana: 500, startingCapacity: 1_000,
      healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
      startingSpeed: 300, speedPerLevel: 0, regen: { healthPerSecond: 1, manaPerSecond: 1 },
      xp: { base: 20, exponent: 2 },
      deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
    }],
    combat: [{
      id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
      armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
      minimumDamageFraction: 0.1,
      player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 4, dodgeChance: 0.05, damageType: 'physical' },
      // CMB-04: o estágio de defesa do perfil, com a skill que sobe por bloqueio.
      defense: { skillId: 'shielding', blockChance: 0.6, blockTypes: ['physical'] },
      // CMB-08: crítico e leech declarados — o atacante do cenário consome o sorteio do crítico.
      modifiers: { critical: { chance: 0.1, multiplier: 2 }, lifeLeech: 0.1, manaLeech: 0.05 },
    }],
    skills: [
      {
        id: 'melee', name: 'Melee', startingLevel: 10, curve: { base: 50, factor: 1.1 },
        gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.02,
      },
      {
        id: 'shielding', name: 'Shielding', startingLevel: 10, curve: { base: 50, factor: 1.1 },
        gain: { on: 'shield-block', points: 1 }, damagePerLevel: 0.02,
      },
    ],
    weaponFamilies: [
      { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
      { id: 'sword', name: 'Sword', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
    ],
    items: [
      {
        id: COMBAT_SWORD_ID, name: 'Combat Sword', kind: 'weapon', slot: 'hand',
        weapon: { kind: 'melee', family: 'sword', range: 1, damageType: 'physical' },
        weight: 30, value: 10, attack: 30, defense: 8,
      },
      {
        id: COMBAT_SHIELD_ID, name: 'Combat Shield', kind: 'shield', slot: 'shield',
        weight: 25, value: 10, defense: 20,
      },
      {
        id: COMBAT_BACKPACK_ID, name: 'Combat Backpack', kind: 'container', slot: 'back',
        weight: 18, value: 5, initialSlots: 20,
      },
    ],
    stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
    party: [{ id: 'baseline', maxMembers: 4 }],
    bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1_000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [{ id: 'combat', z: 7, grid }],
    routes: [{ id: 'combat-loop', mapId: 'combat', tiles, spawnPoints }],
  };
}

export function combatScenario(): Content {
  const raw = rawCombatContent();
  // A tabela de aparências é obrigatória desde FUN-94 (ADR 0008); a de fixture gera ids
  // sequenciais — o bench não fala de arte (invariante 6), só precisa que o conteúdo monte.
  return buildContent({ ...raw, appearances: [placeholderAppearances(raw)] });
}

/**
 * O personagem do cenário entra VESTIDO: espada de uma mão (defesa + família de arma), escudo
 * (o estágio de defesa do CMB-04) e mochila. Sem isto o benchmark mediria o pipeline com os
 * estágios de identidade — exatamente o que o cenário misto existe para não fazer.
 */
export function combatCharacter(content: Content, id: string, position: Point): CharacterRuntime {
  const stats = statsForLevel(1, null, content.progression);
  return new CharacterRuntime({
    id, position,
    health: stats.maxHealth, maxHealth: stats.maxHealth,
    mana: stats.maxMana, maxMana: stats.maxMana,
    level: 1, xp: 0, vocationId: null,
    staminaMs: 86_400_000, staminaUpdatedAtMs: 0,
    goldDelta: 0, alive: true, cooldowns: {},
    capacity: stats.capacity,
    inventory: {
      backpack: [],
      equipped: {
        hand: { instanceId: `${id}:sword`, itemId: COMBAT_SWORD_ID, quantity: 1 },
        shield: { instanceId: `${id}:shield`, itemId: COMBAT_SHIELD_ID, quantity: 1 },
        back: { instanceId: `${id}:backpack`, itemId: COMBAT_BACKPACK_ID, quantity: 1 },
      },
    },
  });
}
