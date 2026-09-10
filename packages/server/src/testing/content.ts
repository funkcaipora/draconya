// Conteúdo mínimo para teste, montado em memória.
//
// Existe porque a criação de sessão passou a depender de `Content` (FUN-37: HP e mana saem da
// tabela de progressão, não de números fixos). Ler o conteúdo real de disco em teste ligaria
// cada teste de sessão ao balanceamento do jogo — mudar o HP inicial no JSON quebraria testes
// que não falam de HP nenhum.

import { buildContent } from '@draconya/content';
import type { Content } from '@draconya/content';

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
    beginner: {
      perSpawnPoint: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 1000,
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
  stepDurationMs: 500, regen: { healthPerSecond: 1, manaPerSecond: 1 },
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
};

export const TEST_COMBAT = {
  id: 'baseline', dodgeMultiplier: 0.5, armorEffectiveness: { melee: 1, magic: 0 },
  minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 0, dodgeChance: 0 },
};

export const TEST_STAMINA = { id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 };

const TEST_RAT = {
  id: 'rat', name: 'Rat', outfitId: 21, recommendedLevel: 1, health: 20, experience: 5,
  attack: 6, armor: 0, attackIntervalMs: 2000, stepDurationMs: 500, aggroRadius: 4,
  loot: { gold: { chance: 1, min: 2, max: 2 }, items: [] },
};

/** Uma magia e um supply, para as regras de bot destes testes apontarem para algo que existe. */
export const TEST_SPELL = {
  id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000,
  effect: { kind: 'heal', amount: 60 },
};
export const TEST_SUPPLY = {
  id: 'health-potion', name: 'Poção de Vida', price: 45,
  effect: { kind: 'heal', amount: 80 },
};

/**
 * O recorte do bot avançado neste conteúdo de teste é `lowest-hp` (FUN-81).
 *
 * O conteúdo REAL tem a lista vazia — o §13.2 não decidiu o recorte, e inventá-lo em
 * `bot/baseline.json` seria decidir balanceamento disfarçado de implementação. Aqui ela é
 * preenchida de propósito: o gate é mecanismo, e mecanismo se testa com dado de teste.
 */
export const TEST_ADVANCED_POLICY = 'lowest-hp';

export function testContent(): Content {
  return buildContent({
    monsters: [TEST_RAT], hunts: [TEST_HUNT], vocations: [],
    progression: [TEST_PROGRESSION], combat: [TEST_COMBAT], stamina: [TEST_STAMINA],
    spells: [TEST_SPELL], supplies: [TEST_SUPPLY],
 // O bot é o produto (invariante 11): sem `bot/baseline.json` o conteúdo não monta.
 bot: [{ id: 'baseline', vocabularyVersion: 1, categoryCooldownMs: 1000, advancedFromLevel: 50,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
    advancedOnly: { targetPolicies: [TEST_ADVANCED_POLICY] } }],
    maps: [TEST_MAP, TEST_CITY_MAP], routes: [TEST_ROUTE],
    city: { mapId: 'city' },
  });
}
