import { describe, expect, it } from 'vitest';
import { buildRoute, buildTilemap, isBlocked, validateRoute } from './map.js';
import type { RouteData, TilemapInput } from './schemas.js';

const mapData: TilemapInput = {
  id: 'm', z: 7,
  grid: [
    '#####',
    '#...#',
    '#.#.#',
    '#...#',
    '#####',
  ],
};
const map = buildTilemap(mapData);

/** Laço em volta do bloco central: 1,1 → 3,1 → 3,3 → 1,3 → volta. */
const loop: RouteData = {
  id: 'r', mapId: 'm',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 1, z: 7 },
    { x: 3, y: 2, z: 7 }, { x: 3, y: 3, z: 7 }, { x: 2, y: 3, z: 7 },
    { x: 1, y: 3, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [{ routeIndex: 2, radius: 2 }],
};

describe('tilemap', () => {
  it('converte a grade em bitmap plano', () => {
    expect(map.width).toBe(5);
    expect(map.height).toBe(5);
    expect(map.blocked.length).toBe(25);
  });

  it('# bloqueia e . é livre', () => {
    expect(isBlocked(map, 0, 0)).toBe(true);
    expect(isBlocked(map, 1, 1)).toBe(false);
    expect(isBlocked(map, 2, 2)).toBe(true); // bloco central
  });

  it('fora dos limites conta como bloqueado', () => {
    // Consulta de passo de monstro não pode precisar checar limite antes de perguntar.
    expect(isBlocked(map, -1, 1)).toBe(true);
    expect(isBlocked(map, 99, 1)).toBe(true);
  });

  it('linha mais curta que a largura é bloqueada no resto', () => {
    // Fora do mapa desenhado não é chão livre.
    const irregular = buildTilemap({ id: 'x', z: 7, grid: ['.....', '..'] });
    expect(isBlocked(irregular, 4, 1)).toBe(true);
    expect(isBlocked(irregular, 1, 1)).toBe(false);
  });
});

describe('rota', () => {
  it('aceita um laço válido e ancora os spawns nos tiles', () => {
    const route = buildRoute(loop, map);
    expect(route.tiles.length).toBe(8);
    expect(route.spawnPoints[0]?.at).toEqual({ x: 3, y: 1, z: 7 });
  });

  it('recusa laço aberto — o defeito que ninguém percebe', () => {
    // Rota aberta faz o personagem chegar ao fim e PARAR. Sem esta checagem, o sintoma é
    // "a hunt travou", relatado dias depois, sem ligação com o arquivo de rota.
    const aberta: RouteData = { ...loop, tiles: loop.tiles.slice(0, 5) };
    expect(validateRoute(aberta, map).join()).toMatch(/não fecha o laço/);
    expect(() => buildRoute(aberta, map)).toThrow(/não fecha o laço/);
  });

  it('recusa tile em parede', () => {
    const naParede: RouteData = {
      ...loop,
      tiles: [{ x: 2, y: 2, z: 7 }, { x: 2, y: 1, z: 7 }],
    };
    expect(validateRoute(naParede, map).join()).toMatch(/em parede/);
  });

  it('recusa tile fora do mapa', () => {
    const foraDoMapa: RouteData = {
      ...loop,
      tiles: [{ x: 50, y: 50, z: 7 }, { x: 1, y: 1, z: 7 }],
    };
    expect(validateRoute(foraDoMapa, map).join()).toMatch(/fora do mapa/);
  });

  it('recusa passo não adjacente, que faria o personagem teleportar', () => {
    const salto: RouteData = {
      ...loop,
      tiles: [{ x: 1, y: 1, z: 7 }, { x: 3, y: 3, z: 7 }, { x: 1, y: 2, z: 7 }],
    };
    expect(validateRoute(salto, map).join()).toMatch(/não é adjacente/);
  });

  it('recusa spawn apontando índice inexistente', () => {
    const ruim: RouteData = { ...loop, spawnPoints: [{ routeIndex: 99, radius: 2 }] };
    expect(validateRoute(ruim, map).join()).toMatch(/índice 99/);
  });

  it('junta todos os problemas, em vez de parar no primeiro', () => {
    const ruim: RouteData = {
      ...loop,
      tiles: [{ x: 2, y: 2, z: 7 }, { x: 50, y: 50, z: 7 }],
      spawnPoints: [{ routeIndex: 99, radius: 1 }],
    };
    expect(validateRoute(ruim, map).length).toBeGreaterThanOrEqual(3);
  });
});
