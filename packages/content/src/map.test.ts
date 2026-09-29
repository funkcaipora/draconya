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

  it('ancora no `at` declarado quando o ponto o traz, e leva o `monsterId` junto (#519)', () => {
    const comSpawnDeclarado: RouteData = {
      ...loop,
      spawnPoints: [{ routeIndex: 2, radius: 1, at: { x: 40, y: 40, z: 12 }, monsterId: 'dragon' }],
    };
    const route = buildRoute(comSpawnDeclarado, map);
    expect(route.spawnPoints[0]).toEqual({
      routeIndex: 2, radius: 1, at: { x: 40, y: 40, z: 12 }, monsterId: 'dragon',
    });
  });

  it('leva o `respawnDelayMs` do ponto, o `spawntime` por posição do Canary (#519)', () => {
    // O Canary declara `spawntime` por `<monster>`, dentro do `<spawn>` — não por zona nem por
    // dificuldade. Sem o campo, `buildRoute` não inventa nada: quem lê decide o fallback
    // (`respawnDelayMs` da dificuldade), como sempre foi.
    const comSpawntime: RouteData = {
      ...loop,
      spawnPoints: [{ routeIndex: 0, radius: 1, monsterId: 'dragon', respawnDelayMs: 90_000 }],
    };
    const route = buildRoute(comSpawntime, map);
    expect(route.spawnPoints[0]?.respawnDelayMs).toBe(90_000);
    expect(route.spawnPoints[0]?.at).toEqual({ x: 1, y: 1, z: 7 }); // tiles[0], sem `at` próprio.

    const semSpawntime = buildRoute(loop, map);
    expect(semSpawntime.spawnPoints[0]?.respawnDelayMs).toBeUndefined();
  });
});

describe('rota multiandar (#519)', () => {
  // Duas salas empilhadas, ligadas por DUAS escadas deslocadas — como no Tibia, e como a casa
  // de `movement.test.ts` (FUN-119): descer em (2,1,7) pousa em (3,1,6); subir em (3,2,6) pousa
  // em (2,2,7). O laço (1,1,7) → (2,1,7) → (3,2,6) fecha de volta a (1,1,7) na diagonal, depois
  // de pousar em (2,2,7) — sem precisar de mais tiles.
  //
  //   z7            z6
  //   ######        ######
  //   #....#        #....#
  //   #....#        #....#
  //   ######        ######
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

  it('depois da escada, o próximo tile precisa ser adjacente ao POUSO dela, não ao degrau', () => {
    // O degrau em (2,1,z7) leva a (3,1,z6) — um tile ADIANTE, como no Tibia. Continuar a rota
    // em (1,1,z6) — adjacente ao degrau por (x, y), mas não ao pouso real — é o erro que esta
    // checagem existe para pegar: sem ela, o personagem "teleportaria" no passo seguinte.
    const naoAdjacenteAoPouso: RouteData = {
      id: 'r2', mapId: 'casa',
      tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 1, y: 1, z: 6 }],
      spawnPoints: [],
    };
    const problems = validateRoute(naoAdjacenteAoPouso, casa);
    expect(problems.join()).toMatch(/passo 1→2 não é adjacente nem escada: \(3,1,6\) para \(1,1,6\)/);
  });

  it('rota correta atravessa as duas escadas e fecha o laço, sem problema nenhum', () => {
    const rota: RouteData = {
      id: 'r3', mapId: 'casa',
      // (1,1,7) → degrau de descida (2,1,7), pousa em (3,1,6) → degrau de subida (3,2,6),
      // adjacente ao pouso anterior, pousa em (2,2,7) → fecha na diagonal de volta a (1,1,7).
      tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 2, z: 6 }],
      spawnPoints: [{ routeIndex: 1, radius: 1 }],
    };
    expect(validateRoute(rota, casa)).toEqual([]);
    expect(() => buildRoute(rota, casa)).not.toThrow();
  });

  it('recusa o andar errado no tile do degrau, com mensagem que diz qual devia ser', () => {
    const rota: RouteData = {
      id: 'r4', mapId: 'casa',
      // O segundo tile é o degrau, mas foi escrito com o andar de CHEGADA (6) em vez do de
      // ORIGEM (7) — o erro que a checagem existe para pegar antes de virar "a rota trava ali".
      tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 6 }, { x: 3, y: 2, z: 6 }],
      spawnPoints: [],
    };
    expect(validateRoute(rota, casa).join()).toMatch(/devia ser 7 \(o de ORIGEM\), não 6/);
  });
});
