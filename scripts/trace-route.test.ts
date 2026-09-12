import { describe, expect, it } from 'vitest';
import { buildRoute, buildTilemap, routeSchema } from '../packages/content/src/index.js';
import { formatRoute, shortestPath, traceRoute } from './trace-route.js';

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
    expect(path?.at(-1)).toEqual({ x: 5, y: 1 });
    expect(path?.[0]).not.toEqual({ x: 1, y: 1 });
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

  it('ancora cada spawn no índice da rota mais próximo do tile pedido', () => {
    const route = traceRoute(map, 7, 'volta', [{ x: 1, y: 1 }, { x: 5, y: 1 }], [{ x: 5, y: 2, radius: 2 }, { x: 1, y: 1, radius: 1 }]);
    expect(route.spawnPoints).toEqual([{ routeIndex: 0, radius: 1 }, { routeIndex: route.tiles.findIndex((t) => t.x === 5 && t.y === 2), radius: 2 }]);
  });

  it('ponto em parede, ou sem caminho, é erro com o nome do ponto', () => {
    expect(() => traceRoute(map, 7, 'x', [{ x: 1, y: 1 }, { x: 3, y: 1 }], [])).toThrow(/ponto 1 \(3,1\) não é andável/);
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
