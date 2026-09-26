import { describe, expect, it } from 'vitest';
import { buildRoute, buildTilemap, routeSchema } from '../packages/content/src/index.js';
import { formatRoute, parseSpawn, shortestPath, traceRoute } from './trace-route.js';

//     0 1 2 3 4 5 6
//   0 # # # # # # #
//   1 # . . # . . #
//   2 # . . # . . #
//   3 # . . . . . #      ← a passagem entre as duas salas
//   4 # . . # . . #
//   5 # # # # # # #
const map = buildTilemap({
  id: 'salas', z: 7,
  grid: ['#######', '#..#..#', '#..#..#', '#.....#', '#..#..#', '#######'],
});

describe('shortestPath (FUN-123)', () => {
  it('acha o caminho mais curto a pé, pelos quatro vizinhos, sem os extremos repetidos', () => {
    const path = shortestPath(map, 7, { x: 1, y: 1 }, { x: 5, y: 1 });
    // Desce até a passagem, atravessa, sobe: 8 passos.
    expect(path).toHaveLength(8);
    expect(path?.at(-1)).toEqual({ x: 5, y: 1, z: 7 });
    expect(path?.[0]).not.toEqual({ x: 1, y: 1, z: 7 });
    for (const tile of path ?? []) expect(map.blocked[tile.y * map.width + tile.x]).toBe(0);
  });

  it('null quando não há caminho', () => {
    const walled = buildTilemap({ id: 'duas', z: 7, grid: ['#####', '#.#.#', '#####'] });
    expect(shortestPath(walled, 7, { x: 1, y: 1 }, { x: 3, y: 1 })).toBeNull();
  });
});

describe('traceRoute (FUN-123)', () => {
  it('liga os pontos na ordem e fecha o laço de volta ao primeiro — e o carregador aceita', () => {
    const route = traceRoute(map, 7, 'volta', [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 4 }], []);
    expect(route.tiles[0]).toEqual({ x: 1, y: 1, z: 7 });
    // O último tile é adjacente ao primeiro: o fecho não é um tile a mais.
    const last = route.tiles.at(-1);
    expect(Math.abs((last?.x ?? 0) - 1) + Math.abs((last?.y ?? 0) - 1)).toBe(1);
    expect(() => buildRoute(routeSchema.parse(route), map)).not.toThrow();
  });

  it('ancora cada spawn no índice da rota mais próximo do tile pedido, e leva a posição exata', () => {
    const route = traceRoute(map, 7, 'volta', [{ x: 1, y: 1 }, { x: 5, y: 1 }], [{ x: 5, y: 2, radius: 2 }, { x: 1, y: 1, radius: 1 }]);
    expect(route.spawnPoints).toEqual([
      { routeIndex: 0, radius: 1, at: { x: 1, y: 1, z: 7 } },
      { routeIndex: route.tiles.findIndex((t) => t.x === 5 && t.y === 2), radius: 2, at: { x: 5, y: 2, z: 7 } },
    ]);
  });

  it('ponto em parede, ou sem caminho, é erro com o nome do ponto', () => {
    expect(() => traceRoute(map, 7, 'x', [{ x: 1, y: 1 }, { x: 3, y: 1 }], [])).toThrow(/ponto 1 \(3,1,7\) não é andável/);
    const walled = buildTilemap({ id: 'duas', z: 7, grid: ['#####', '#.#.#', '#####'] });
    expect(() => traceRoute(walled, 7, 'x', [{ x: 1, y: 1 }, { x: 3, y: 1 }], [])).toThrow(/não há caminho/);
  });

  it('o JSON escrito é válido e reconstrói a rota', () => {
    const route = traceRoute(map, 7, 'volta', [{ x: 1, y: 1 }, { x: 5, y: 4 }], [{ x: 5, y: 4, radius: 3 }]);
    const parsed = routeSchema.parse(JSON.parse(formatRoute(route)));
    expect(parsed.tiles).toEqual(route.tiles);
    expect(parsed.spawnPoints).toEqual(route.spawnPoints);
  });
});

describe('rota multiandar (#519)', () => {
  // A mesma casa de duas escadas do `map.test.ts`: descer em (2,1,7) pousa em (3,1,6); subir em
  // (3,2,6) pousa em (2,2,7).
  const casa = buildTilemap({
    id: 'casa', z: 7,
    floors: {
      '7': { grid: ['######', '#....#', '#....#', '######'] },
      '6': { grid: ['######', '#....#', '#....#', '######'] },
    },
    floorChanges: [
      { from: { x: 2, y: 1, z: 7 }, to: { x: 3, y: 1, z: 6 } },
      { from: { x: 3, y: 2, z: 6 }, to: { x: 2, y: 2, z: 7 } },
    ],
  });

  it('shortestPath atravessa a escada: o tile gravado é o degrau, não o pouso', () => {
    // De (1,1,7) a (3,1,6): um passo até o degrau (2,1,7), e o degrau É o segundo (e último)
    // tile do caminho — o pouso em (3,1,6) nunca é um tile à parte, porque `move()` nunca deixa
    // ninguém parado nele.
    const path = shortestPath(casa, 7, { x: 1, y: 1 }, { x: 3, y: 1, z: 6 });
    expect(path).toEqual([{ x: 2, y: 1, z: 7 }]);
  });

  it('traceRoute liga pontos de andares diferentes, atravessando as duas escadas', () => {
    // Três pontos de descanso reais — nenhum deles é o degrau de uma escada —, um por trecho:
    // z7 → (desce por (2,1,7)) → z6 → (sobe por (3,2,6)) → z7 de volta.
    const route = traceRoute(
      casa, 7, 'casa-loop',
      [{ x: 1, y: 1, z: 7 }, { x: 1, y: 1, z: 6 }, { x: 4, y: 2, z: 7 }],
      [],
    );
    expect(route.tiles.map((t) => t.z)).toContain(7);
    expect(route.tiles.map((t) => t.z)).toContain(6);
    expect(() => buildRoute(routeSchema.parse(route), casa)).not.toThrow();
  });

  it('ponto de passagem numa escada é erro — ninguém para nela', () => {
    expect(() => traceRoute(casa, 7, 'x', [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }], []))
      .toThrow(/é o degrau de uma escada — não é um lugar onde se para/);
  });

  it('spawn com x,y,z,radius,monsterId ancora no andar certo e leva o monstro', () => {
    const route = traceRoute(
      casa, 7, 'casa-loop',
      [{ x: 1, y: 1, z: 7 }, { x: 1, y: 1, z: 6 }, { x: 4, y: 2, z: 7 }],
      [{ x: 3, y: 1, z: 6, radius: 1, monsterId: 'dragon' }],
    );
    const spawn = route.spawnPoints[0];
    expect(spawn?.monsterId).toBe('dragon');
    expect(spawn?.at).toEqual({ x: 3, y: 1, z: 6 });
    // Ancorado num tile de z6, nunca de z7 — mesmo que um tile de z7 estivesse geometricamente
    // mais perto por (x, y).
    expect(route.tiles[spawn?.routeIndex ?? -1]?.z).toBe(6);
  });

  it('spawn com respawnDelayMs leva o spawntime do PONTO, não da dificuldade', () => {
    // O Canary declara `spawntime` por `<monster>` — cada ponto pode ter o seu, como os 90 s
    // da Darashia Dragon Lair.
    const route = traceRoute(
      casa, 7, 'casa-loop',
      [{ x: 1, y: 1, z: 7 }, { x: 1, y: 1, z: 6 }, { x: 4, y: 2, z: 7 }],
      [{ x: 3, y: 1, z: 6, radius: 1, monsterId: 'dragon', respawnDelayMs: 90_000 }],
    );
    expect(route.spawnPoints[0]?.respawnDelayMs).toBe(90_000);
  });

  it('parseSpawn (CLI) aceita x,y,z,radius,monsterId,respawnDelayMs', () => {
    expect(parseSpawn('3,1,6,1,dragon,90000'))
      .toEqual({ x: 3, y: 1, z: 6, radius: 1, monsterId: 'dragon', respawnDelayMs: 90_000 });
  });

  it('--spawn com 2 ou 3 campos continua no formato de sempre (x,y[,radius])', () => {
    // Sem os campos novos, o comportamento é bit a bit o de antes — nenhuma rota já commitada
    // muda ao regenerar.
    const route = traceRoute(map, 7, 'volta', [{ x: 1, y: 1 }, { x: 5, y: 1 }], [{ x: 5, y: 2, radius: 2 }]);
    expect(route.spawnPoints[0]).toEqual({
      routeIndex: route.tiles.findIndex((t) => t.x === 5 && t.y === 2),
      radius: 2,
      at: { x: 5, y: 2, z: 7 },
    });
  });
});
