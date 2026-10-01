import { describe, expect, it } from 'vitest';
import {
  absoluteToLocal, buildRoute, buildTilemap, isBlocked, localToAbsolute, validateRoute, ZONE_FLAG, ZONE_PALETTE,
  zoneChar, zoneFlagsAt,
} from './map.js';
import { tilemapSchema } from './schemas.js';
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
  spawnPoints: [{ routeIndex: 2, radius: 2, monsterId: 'rat', respawnDelayMs: 1000 }],
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

describe('coordenada absoluta do Tibia ↔ local do recorte (#829, ADR 0060 d.3.b)', () => {
  // x 32275–32281, y 32153–32156, z 6–7: um recorte pequeno no canto de Thais.
  const imported = buildTilemap({
    id: 'recorte', z: 7,
    floors: {
      '6': { grid: ['.......', '.......', '.......', '.......'] },
      '7': { grid: ['.......', '.......', '.......', '.......'] },
    },
    source: {
      file: 'otservbr.otbm', sha256: 'a'.repeat(64),
      region: { x: [32275, 32281], y: [32153, 32156], z: [6, 7] },
    },
  });

  it('perde a origem do recorte em x e y e mantém o andar', () => {
    expect(absoluteToLocal(imported, { x: 32277, y: 32155, z: 7 })).toEqual({ x: 2, y: 2, z: 7 });
  });

  it('as bordas de dentro valem e um passo além não', () => {
    expect(absoluteToLocal(imported, { x: 32275, y: 32153, z: 6 })).toEqual({ x: 0, y: 0, z: 6 });
    expect(absoluteToLocal(imported, { x: 32281, y: 32156, z: 7 })).toEqual({ x: 6, y: 3, z: 7 });
    for (const outside of [
      { x: 32274, y: 32155, z: 7 }, { x: 32282, y: 32155, z: 7 },
      { x: 32277, y: 32152, z: 7 }, { x: 32277, y: 32157, z: 7 },
      { x: 32277, y: 32155, z: 5 }, { x: 32277, y: 32155, z: 8 },
    ]) {
      expect(absoluteToLocal(imported, outside), JSON.stringify(outside)).toBeUndefined();
    }
  });

  it('o inverso devolve a coordenada absoluta, e a ida e a volta fecham', () => {
    expect(localToAbsolute(imported, { x: 2, y: 2, z: 7 })).toEqual({ x: 32277, y: 32155, z: 7 });
    const at = { x: 32279, y: 32154, z: 6 };
    const local = absoluteToLocal(imported, at);
    if (local === undefined) throw new Error('o ponto cabe no recorte');
    expect(localToAbsolute(imported, local)).toEqual(at);
  });

  it('mapa sem `source` não tem origem: nenhuma das duas traduz', () => {
    // Um mapa autorado à mão não é um pedaço do mapa do Tibia — "absoluto" não quer dizer nada nele.
    expect(absoluteToLocal(map, { x: 1, y: 1, z: 7 })).toBeUndefined();
    expect(localToAbsolute(map, { x: 1, y: 1, z: 7 })).toBeUndefined();
  });
});

describe('camada de bloqueio de visão (#553)', () => {
  it('sem `sight` declarado, `blocksSight` é `null` — nenhum tile bloqueia', () => {
    const floor = map.floors.get(7);
    expect(floor?.blocksSight).toBeNull();
  });

  it('com `sight` declarado, monta o bitmap independente de `grid`', () => {
    const withSight = buildTilemap({
      id: 'm2', z: 7,
      floors: {
        7: {
          grid: ['#####', '#...#', '#...#', '#...#', '#####'],
          // (2,2) bloqueia VISÃO sem bloquear PASSO — decoração com `unsight` sem `unpass`.
          sight: ['#####', '#...#', '#.#.#', '#...#', '#####'],
        },
      },
    });
    const floor = withSight.floors.get(7);
    expect(floor?.blocksSight).not.toBeNull();
    expect(floor?.blocksSight?.[2 * withSight.width + 2]).toBe(1);
    expect(floor?.blocksSight?.[1 * withSight.width + 1]).toBe(0);
    expect(isBlocked(withSight, 2, 2)).toBe(false); // passo continua livre
  });
});

describe('camada de zonas (#830, OW-09)', () => {
  // `.` normal, `p` PZ, `n` no-pvp, `a` arena, `l` só no-logout, `P`/`N`/`A` a zona mais no-logout.
  const zoned = buildTilemap({
    id: 'z', z: 7,
    floors: {
      7: {
        grid: ['#####', '#...#', '#...#', '#...#', '#####'],
        zones: ['ppppp', 'p.nPa', '.lN.A', 'pp', 'p'],
      },
      6: { grid: ['###', '#.#', '###'] },
    },
  });

  it('sem `zones` declarado, `zones` é `null` e todo tile é normal — a hunt não muda', () => {
    expect(map.floors.get(7)?.zones).toBeNull();
    expect(zoneFlagsAt(map, 1, 1)).toBe(0);
    // O andar sem a camada, num mapa que a declara em outro andar, é igual.
    expect(zoned.floors.get(6)?.zones).toBeNull();
    expect(zoneFlagsAt(zoned, 1, 1, 6)).toBe(0);
  });

  it('cada caractere da paleta vira a soma de bits do OTBM', () => {
    expect(zoneFlagsAt(zoned, 0, 0)).toBe(ZONE_FLAG.protection);
    expect(zoneFlagsAt(zoned, 1, 1)).toBe(0);
    expect(zoneFlagsAt(zoned, 2, 1)).toBe(ZONE_FLAG.noPvp);
    expect(zoneFlagsAt(zoned, 3, 1)).toBe(ZONE_FLAG.protection | ZONE_FLAG.noLogout);
    expect(zoneFlagsAt(zoned, 4, 1)).toBe(ZONE_FLAG.pvpZone);
    expect(zoneFlagsAt(zoned, 1, 2)).toBe(ZONE_FLAG.noLogout);
    expect(zoneFlagsAt(zoned, 2, 2)).toBe(ZONE_FLAG.noPvp | ZONE_FLAG.noLogout);
    expect(zoneFlagsAt(zoned, 4, 2)).toBe(ZONE_FLAG.pvpZone | ZONE_FLAG.noLogout);
  });

  it('os valores são os bits de `TILE_FLAGS` do Canary: 1, 4, 8 e 16', () => {
    // `canary/src/io/io_definitions.hpp:73-76`. O bit 2 (valor 2) não existe: o Canary pulou.
    expect(ZONE_FLAG).toEqual({ protection: 1, noPvp: 4, noLogout: 8, pvpZone: 16 });
    // Cada valor da paleta é distinto, e `zoneChar` é o inverso exato dela.
    const values = Object.values(ZONE_PALETTE);
    expect(new Set(values).size).toBe(values.length);
    for (const [char, value] of Object.entries(ZONE_PALETTE)) expect(zoneChar(value)).toBe(char);
  });

  it('linha mais curta que a largura é normal no resto — o inverso de `grid`, que bloqueia', () => {
    expect(zoneFlagsAt(zoned, 1, 3)).toBe(ZONE_FLAG.protection); // dentro do que a linha diz
    expect(zoneFlagsAt(zoned, 4, 3)).toBe(0); // depois do fim da linha
    expect(zoneFlagsAt(zoned, 0, 4)).toBe(ZONE_FLAG.protection);
    expect(zoneFlagsAt(zoned, 1, 4)).toBe(0);
  });

  it('fora do mapa, ou andar que o mapa não tem, é normal — bloqueio é de `isBlocked`', () => {
    expect(zoneFlagsAt(zoned, -1, 0)).toBe(0);
    expect(zoneFlagsAt(zoned, 99, 0)).toBe(0);
    expect(zoneFlagsAt(zoned, 0, 0, 3)).toBe(0);
  });

  it('o schema aceita `zones` e o formato de arquivo sem a camada continua válido', () => {
    expect(tilemapSchema.parse({ id: 'a', z: 7, floors: { 7: { grid: ['.'], zones: ['p'] } } }).floors?.['7']?.zones)
      .toEqual(['p']);
    expect(tilemapSchema.parse({ id: 'a', z: 7, floors: { 7: { grid: ['.'] } } }).floors?.['7']?.zones).toBeUndefined();
  });

  it('caractere fora da paleta derruba a montagem — nunca vira "normal" em silêncio', () => {
    expect(() => buildTilemap({ id: 'x', z: 7, floors: { 7: { grid: ['...'], zones: ['p?p'] } } }))
      .toThrow(/zona "\?" em \(1,0\) não está em ZONE_PALETTE/);
    expect(() => zoneChar(3)).toThrow(/não está em ZONE_PALETTE/); // PZ + bit 1, que o Canary não tem
    // PZ e no-pvp juntos (5) são exclusivos: o importador normaliza, e a paleta não os tem.
    expect(() => zoneChar(ZONE_FLAG.protection | ZONE_FLAG.noPvp)).toThrow(/não está em ZONE_PALETTE/);
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
    const ruim: RouteData = {
      ...loop, spawnPoints: [{ routeIndex: 99, radius: 2, monsterId: 'rat', respawnDelayMs: 1000 }],
    };
    expect(validateRoute(ruim, map).join()).toMatch(/índice 99/);
  });

  it('junta todos os problemas, em vez de parar no primeiro', () => {
    const ruim: RouteData = {
      ...loop,
      tiles: [{ x: 2, y: 2, z: 7 }, { x: 50, y: 50, z: 7 }],
      spawnPoints: [{ routeIndex: 99, radius: 1, monsterId: 'rat', respawnDelayMs: 1000 }],
    };
    expect(validateRoute(ruim, map).length).toBeGreaterThanOrEqual(3);
  });

  it('ancora no `at` declarado quando o ponto o traz, e leva o `monsterId` junto (#519)', () => {
    const comSpawnDeclarado: RouteData = {
      ...loop,
      spawnPoints: [{
        routeIndex: 2, radius: 1, at: { x: 40, y: 40, z: 12 }, monsterId: 'dragon', respawnDelayMs: 1000,
      }],
    };
    const route = buildRoute(comSpawnDeclarado, map);
    expect(route.spawnPoints[0]).toEqual({
      routeIndex: 2, radius: 1, at: { x: 40, y: 40, z: 12 }, monsterId: 'dragon', respawnDelayMs: 1000,
    });
  });

  it('leva `monsters` (vários candidatos com peso na mesma posição, #582) junto ao ponto', () => {
    const comMonstrosPesados: RouteData = {
      ...loop,
      spawnPoints: [{
        routeIndex: 2, radius: 1, at: { x: 40, y: 40, z: 12 }, respawnDelayMs: 1000,
        monsters: [{ monsterId: 'dragon', weight: 3 }, { monsterId: 'dragon-lord', weight: 1 }],
      }],
    };
    const route = buildRoute(comMonstrosPesados, map);
    expect(route.spawnPoints[0]).toEqual({
      routeIndex: 2, radius: 1, at: { x: 40, y: 40, z: 12 }, respawnDelayMs: 1000,
      monsters: [{ monsterId: 'dragon', weight: 3 }, { monsterId: 'dragon-lord', weight: 1 }],
    });
  });

  it('leva o `respawnDelayMs` do ponto, o `spawntime` por posição do Canary (#519, #583)', () => {
    // O Canary declara `spawntime` por `<monster>`, dentro do `<spawn>` — não por zona. Desde o
    // #583 é obrigatório: não há mais dificuldade para cair como fallback quando ausente.
    const comSpawntime: RouteData = {
      ...loop,
      spawnPoints: [{ routeIndex: 0, radius: 1, monsterId: 'dragon', respawnDelayMs: 90_000 }],
    };
    const route = buildRoute(comSpawntime, map);
    expect(route.spawnPoints[0]?.respawnDelayMs).toBe(90_000);
    expect(route.spawnPoints[0]?.at).toEqual({ x: 1, y: 1, z: 7 }); // tiles[0], sem `at` próprio.
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
      spawnPoints: [{ routeIndex: 1, radius: 1, monsterId: 'rat', respawnDelayMs: 1000 }],
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
