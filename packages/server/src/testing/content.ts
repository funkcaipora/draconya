// Conteúdo mínimo para teste, montado em memória.
//
// Existe porque a criação de sessão passou a depender de `Content` (FUN-37: HP e mana saem da
// tabela de progressão, não de números fixos). Ler o conteúdo real de disco em teste ligaria
// cada teste de sessão ao balanceamento do jogo — mudar o HP inicial no JSON quebraria testes
// que não falam de HP nenhum.

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Content, RawContent } from '@draconya/content';

export const TEST_MAP = { id: 'arena', z: 7, grid: ['####', '#..#', '#..#', '####'] };

/** A Cidade de teste: uma sala de 4×4 com ponto de entrada no meio (FUN-60). */
export const TEST_CITY_MAP = {
  id: 'city', z: 7, entryPoint: { x: 2, y: 2 },
  grid: ['######', '#....#', '#....#', '#....#', '#....#', '######'],
};

export const TEST_ROUTE = {
  id: 'arena-loop', mapId: 'arena',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 2, y: 2, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [{ routeIndex: 2, radius: 1 }],
};

export const TEST_HUNT = {
  id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
  difficulties: {
    cautious: {
      monsterCount: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 1000,
    },
  },
};

export const TEST_PROGRESSION = {
  // HP inicial folgado, e é DECISÃO, não número escolhido no olho.
  //
  // O critério de saída da Fase 1 roda seis minutos simulados de hunt, e o que ele mede é
  // continuidade de sessão — navegador fechado, nó morto, deploy. Um personagem que morre no
  // meio faz o teste falhar por balanceamento, que é justamente o que este arquivo existe
  // para não amarrar.
  //
  // Precisou subir na FUN-68. Com o cooldown de ataque correndo em tempo de parede em vez de
  // congelar quando não há alvo, o ciclo de encontro nesta sala de 2×2 caiu de ~5 s para
  // ~2,25 s: o personagem mata mais rápido e, por isso, apanha mais. Medido nesta fixture —
  // 150 de vida morre aos 90 s com 40 abates; 1.200 termina os seis minutos com 181 abates.
  // O número é do teste; o balanceamento de verdade é `packages/content/data`.
  id: 'baseline', startingHealth: 1_200, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0, regen: { healthPerSecond: 1, manaPerSecond: 1 },
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
};

export const TEST_COMBAT = {
  id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 0, dodgeChance: 0 },
};

export const TEST_STAMINA = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };
/** A party de hunt (ADR 0027): a tabela real, para solo ser party de um. */
export const TEST_PARTY = { id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 } };

/**
 * As famílias de arma (CMB-05) do conteúdo de teste. O conteúdo não tem skill nenhuma, então
 * `buildContent` não confere o `skillId` — a arma bate o `attack` puro, que é o que estas
 * fixtures sempre mediram. Quem testa escala de skill usa conteúdo com skill.
 */
export const TEST_WEAPON_FAMILIES = [
  { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'sword', name: 'Sword', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'axe', name: 'Axe', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'club', name: 'Club', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'distance', name: 'Distance', kind: 'distance', skillId: 'distance', range: 6, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
  { id: 'wand', name: 'Wand', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
  { id: 'rod', name: 'Rod', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
];

const TEST_RAT = {
  id: 'rat', name: 'Rat', recommendedLevel: 1, health: 20, experience: 5,
  attack: 6, armor: 0, attackIntervalMs: 2000, speed: 300, aggroRadius: 4,
  loot: { gold: { chance: 1, min: 2, max: 2 }, items: [] },
};

/** Uma magia e os suprimentos abstratos, para as regras de bot apontarem para algo que existe. */
export const TEST_SPELL = {
  id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000,
  effect: { kind: 'heal', amount: 60 },
};
export const TEST_SUPPLIES = [
  {
    id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion',
    effect: { kind: 'heal', amount: 80 },
  },
];
/** A munição abstrata (ADR 0026 d.3): família, dano do tiro e preço por disparo. */
export const TEST_AMMUNITION = [
  { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 20, price: 1 },
];

/**
 * O conteúdo de teste ANTES de virar `Content`, para quem precisa trocar uma peça.
 *
 * Existe porque o mapa de Cidade daqui é 6×6, e num mapa desse tamanho todo mundo está a dois
 * tiles de todo mundo — o campo de visão da FUN-33 não teria o que cortar, e um teste de
 * interest management ali passaria sem exercitar nada.
 */
export function rawTestContent(): RawContent {
  // A aparência é DERIVADA (FUN-94): nenhum teste de servidor fala de arte, e a tabela real é
  // `packages/content/data/appearances/baseline.json`, escrita à mão.
  const raw: RawContent = {
    monsters: [TEST_RAT], hunts: [TEST_HUNT], vocations: [],
    progression: [TEST_PROGRESSION], combat: [TEST_COMBAT], stamina: [TEST_STAMINA], party: [TEST_PARTY],
    spells: [TEST_SPELL], supplies: TEST_SUPPLIES, ammunition: TEST_AMMUNITION,
    weaponFamilies: TEST_WEAPON_FAMILIES,
    // Sem itens por padrão: os testes que precisam de peça (colar, anel, espada) acrescentam a
    // própria na cópia do raw. A lista vazia existe para `[...raw.items]` continuar funcionando.
    items: [],
  // O bot é o produto (invariante 11): sem `bot/baseline.json` o conteúdo não monta. O gate de
  // level saiu no AB-03; aqui o vocabulário é o v2.
  bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [TEST_MAP, TEST_CITY_MAP], routes: [TEST_ROUTE],
    city: { mapId: 'city', stepDurationMs: 500 },
  };
  return { ...raw, appearances: [placeholderAppearances(raw)] };
}

export function testContent(): Content {
  return buildContent(rawTestContent());
}
