// Conteúdo mínimo para teste, montado em memória.
//
// Existe porque a criação de sessão passou a depender de `Content` (FUN-37: HP e mana saem da
// tabela de progressão, não de números fixos). Ler o conteúdo real de disco em teste ligaria
// cada teste de sessão ao balanceamento do jogo — mudar o HP inicial no JSON quebraria testes
// que não falam de HP nenhum.

import { buildContent } from '@draconya/content';
import type { Content } from '@draconya/content';

export const TEST_MAP = { id: 'arena', z: 7, grid: ['####', '#..#', '#..#', '####'] };

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
  id: 'baseline', startingHealth: 150, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  stepDurationMs: 500, xp: { base: 20, exponent: 2 },
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
};

export function testContent(): Content {
  return buildContent({
    monsters: [TEST_RAT], hunts: [TEST_HUNT], vocations: [],
    progression: [TEST_PROGRESSION], combat: [TEST_COMBAT], stamina: [TEST_STAMINA],
    maps: [TEST_MAP], routes: [TEST_ROUTE],
  });
}
