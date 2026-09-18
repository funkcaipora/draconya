// O conteúdo sintético do cenário frio (FUN-46, #179).
//
// Vive num módulo próprio, e não dentro de `cold-hunts.ts`, para ser TESTÁVEL sem rodar a
// medição: o bench parou em silêncio quando FUN-94 tornou a tabela de aparências obrigatória
// em `buildContent`, e ninguém viu porque nenhum CI o roda. `cold-scenario.test.ts` monta o
// cenário e avança uma hunt — é o que reprova no PR, e não meses depois, quando o contrato de
// `buildContent` mudar de novo.

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Content } from '@draconya/content';

// Montado aqui, e não lido de `packages/content/data`, porque a medição precisa de uma
// instância CHEIA: a Rat Cellars de hoje tem 2 monstros por ponto em 4 pontos, e medir 8
// monstros diria pouco sobre as 10–40 que a issue pede.

const SIZE = 24;
const grid = Array.from({ length: SIZE }, (_, y) =>
  Array.from({ length: SIZE }, (_, x) => {
    if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) return '#';
    // Paredes espalhadas pelo MIOLO: caminho livre demais não exercita o desvio, que é o ramo
    // mais caro do passo guloso. O anel de fora fica limpo porque é por onde a rota passa — a
    // validação da FUN-9 recusa rota em cima de parede, e com razão.
    const inside = x >= 3 && x <= SIZE - 4 && y >= 3 && y <= SIZE - 4;
    return inside && x % 7 === 3 && y % 5 !== 0 ? '#' : '.';
  }).join(''));

/** Um laço retangular pelo miolo do mapa, sem encostar nas paredes espalhadas. */
function loop(): Array<{ x: number; y: number; z: number }> {
  const tiles: Array<{ x: number; y: number; z: number }> = [];
  const lo = 1;
  const hi = SIZE - 2;
  for (let x = lo; x < hi; x++) tiles.push({ x, y: lo, z: 7 });
  for (let y = lo; y < hi; y++) tiles.push({ x: hi, y, z: 7 });
  for (let x = hi; x > lo; x--) tiles.push({ x, y: hi, z: 7 });
  for (let y = hi; y > lo; y--) tiles.push({ x: lo, y, z: 7 });
  return tiles;
}

const tiles = loop();
// Um ponto de spawn a cada oito tiles, com 4 monstros cada: 40 monstros na instância, o topo
// da faixa que a issue pede.
const spawnPoints = tiles
  .map((_, index) => index)
  .filter((index) => index % 8 === 0)
  .slice(0, 10)
  .map((routeIndex) => ({ routeIndex, radius: 3 }));

export function scenario(): Content {
  const raw = {
    monsters: [{
      id: 'rat', name: 'Rat', recommendedLevel: 1,
      health: 200, experience: 5, attack: 4, armor: 0,
      attackIntervalMs: 2_000, speed: 300, aggroRadius: 8, attackRange: 1,
    }],
    hunts: [{
      id: 'cold', name: 'Cold', recommendedLevel: 1, mapId: 'cold', routeId: 'cold-loop',
      difficulties: {
        reckless: {
          monsterCount: 40,
          composition: [{ monsterId: 'rat', weight: 1 }],
          respawnDelayMs: 30_000,
        },
      },
    }],
    vocations: [],
    progression: [{
      id: 'baseline', startingHealth: 1_000_000, startingMana: 0, startingCapacity: 400,
      healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
      startingSpeed: 300, speedPerLevel: 0, regen: { healthPerSecond: 1, manaPerSecond: 1 },
      xp: { base: 20, exponent: 2 },
      deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
    }],
    combat: [{
      id: 'baseline', dodgeMultiplier: 0.5, armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
      minimumDamageFraction: 0.1,
      player: {
        attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0.05,
      },
    }],
    stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
    party: [{ id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 } }],
    // O bot é o produto (invariante 11): sem `bot/baseline.json` o conteúdo não monta.
    bot: [{ id: 'baseline', vocabularyVersion: 1, categoryCooldownMs: 1000, advancedFromLevel: 50,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [{ id: 'cold', z: 7, grid }],
    routes: [{ id: 'cold-loop', mapId: 'cold', tiles, spawnPoints }],
  };
  // A tabela de aparências é obrigatória desde FUN-94 (ADR 0008), e a de fixture gera ids
  // sequenciais — o bench não fala de arte (invariante 6), só precisa que o conteúdo monte.
  return buildContent({ ...raw, appearances: [placeholderAppearances(raw)] });
}
