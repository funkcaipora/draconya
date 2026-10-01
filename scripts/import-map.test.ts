import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NO_FLAGS } from '../packages/client/src/assets/appearances.js';
import type { AppearanceFlags } from '../packages/client/src/assets/appearances.js';
import {
  buildTilemap, groundSpeed, isBlocked, ZONE_FLAG, zoneFlagsAt,
} from '../packages/content/src/map.js';
import {
  applyZones, checkMaps, collectTiles, deriveZones, formatContentMap, formatStackMap, importRegion, parsePoint,
  parseRange, summarizeZones, zoneFlagsOf,
} from './import-map.js';
import type { CheckOutcome } from './import-map.js';
import { NODE, otbmNode, TILE_FLAG, u16, u32, u8 } from './otbm.js';
import type { OtbmTile, Region } from './otbm.js';
import { buildSceneryIndex } from './scenery.js';
import type { CanaryTables } from './scenery.js';

// Um "pacote" sintético: cada id com as flags que interessam ao importador.
const FLOOR = 100; // chão de velocidade 130
const MUD = 101; // chão de velocidade 200
const WALL = 200; // bottom + unpass
const TORCH = 201; // item comum, passável
const STAIRS = 202; // item passável sem chão embaixo (o degrau)
const WATER = 102; // chão com unpass
// Cenário usável (#727): porta comum, alavanca (par 2772/2773 do fixture) e capim.
const DOOR_CLOSED = 300; // unpass — é a porta FECHADA
const DOOR_OPEN = 301; // passável — a mesma porta ABERTA
const LEVER_DOWN = 302;
const LEVER_UP = 303;
const GRASS_UNCUT = 304;
const GRASS_CUT = 305;
const flagsOf = (id: number): AppearanceFlags | null => {
  switch (id) {
    case FLOOR: return { ...NO_FLAGS, bankWaypoints: 130, fullbank: true };
    case MUD: return { ...NO_FLAGS, bankWaypoints: 200 };
    case WALL: return { ...NO_FLAGS, bottom: true, unpass: true, unsight: true };
    case TORCH: return { ...NO_FLAGS, take: true };
    case STAIRS: return { ...NO_FLAGS };
    case WATER: return { ...NO_FLAGS, bankWaypoints: 0, unpass: true };
    case DOOR_CLOSED: return { ...NO_FLAGS, unpass: true };
    case DOOR_OPEN: return { ...NO_FLAGS };
    case LEVER_DOWN: case LEVER_UP: case GRASS_UNCUT: case GRASS_CUT: return { ...NO_FLAGS };
    default: return null;
  }
};
const sceneryTables: CanaryTables = {
  id: 'canary-test', source: 'fixture',
  doors: {
    locked: [], quest: [], level: [],
    common: [{ closed: DOOR_CLOSED, open: DOOR_OPEN }],
  },
  grass: [{ uncut: GRASS_UNCUT, cut: GRASS_CUT, durationSec: 300 }],
  stonePiles: [],
  ropeSpots: { ground: [], special: [] },
  ladders: [],
  levers: [LEVER_DOWN, LEVER_UP],
};
const nameOf = (id: number): string | undefined => (id === STAIRS ? 'stairs' : undefined);

const tile = (x: number, y: number, z: number, ground: number | null, items: number[] = [], extra: Partial<OtbmTile> = {}): OtbmTile =>
  ({ x, y, z, ground, items: items.map((id) => ({ id })), flags: 0, ...extra });

const region: Region = { x: [1000, 1004], y: [2000, 2002], z: [7, 7] };
const source = { file: 'test.otbm', sha256: 'f'.repeat(64) };

//   x: 1000 1001 1002 1003 1004
//  y2000  W    F    F    M    W
//  y2001  W    F    ~    F    W       ~ = água (chão unpass)
//  y2002  W    W    S    W    W       S = degrau sem chão
const room = (): OtbmTile[] => [
  tile(1000, 2000, 7, FLOOR, [WALL]), tile(1001, 2000, 7, FLOOR), tile(1002, 2000, 7, FLOOR, [TORCH]),
  tile(1003, 2000, 7, MUD), tile(1004, 2000, 7, FLOOR, [WALL]),
  tile(1000, 2001, 7, FLOOR, [WALL]), tile(1001, 2001, 7, FLOOR), tile(1002, 2001, 7, WATER),
  tile(1003, 2001, 7, FLOOR), tile(1004, 2001, 7, FLOOR, [WALL]),
  tile(1000, 2002, 7, FLOOR, [WALL]), tile(1001, 2002, 7, FLOOR, [WALL]), tile(1002, 2002, 7, null, [STAIRS]),
  tile(1003, 2002, 7, FLOOR, [WALL]), tile(1004, 2002, 7, FLOOR, [WALL]),
];

describe('importRegion (FUN-118)', () => {
  it('deriva a grade das flags: parede e água bloqueiam, tocha não, degrau sem chão anda', () => {
    const { content, report } = importRegion(room(), { id: 'sala', region, flagsOf, nameOf, source, version: '1332' });
    expect(content.floors?.['7']?.grid).toEqual(['#...#', '#.#.#', '##.##']);
    expect(report.perFloor).toEqual([{ z: 7, tiles: 15, blocked: 9, walkable: 6 }]);
    expect(report.unknownIds).toEqual([]);
    expect(report.stairCandidates).toEqual([{ x: 2, y: 2, z: 7, id: STAIRS, name: 'stairs' }]);
  });

  it('deriva a camada de visão (#553) da flag `unsight`, independente de `unpass`', () => {
    const { content } = importRegion(room(), { id: 'sala', region, flagsOf, nameOf, source, version: '1332' });
    // WALL tem unpass E unsight — bloqueia os dois, como na grade de movimento.
    // WATER (1002,2001) tem unpass SEM unsight — bloqueia passo (`grid` tem `#` ali), mas não
    // visão (`sight` tem `.` no mesmo lugar): a linha 1 diverge das duas grades.
    expect(content.floors?.['7']?.sight).toEqual(['#...#', '#...#', '##.##']);
    expect(content.floors?.['7']?.grid).toEqual(['#...#', '#.#.#', '##.##']);
  });

  it('a velocidade do chão vira paleta em ordem crescente, e o padrão vale para quem não tem chão', () => {
    const { content } = importRegion(room(), { id: 'sala', region, flagsOf, source, version: '1332' });
    // 130 → a, 150 (o degrau sem chão, padrão) → b, 200 → c.
    expect(content.speedPalette).toEqual({ a: 130, b: 150, c: 200 });
    expect(content.floors?.['7']?.speed).toEqual([' aac ', ' a a ', '  b  ']);
    const map = buildTilemap(content);
    expect(groundSpeed(map, 3, 0, 7)).toBe(200);
    expect(groundSpeed(map, 2, 2, 7)).toBe(150);
    expect(isBlocked(map, 2, 1, 7)).toBe(true);
    expect(isBlocked(map, 2, 2, 7)).toBe(false);
  });

  it('a pilha do cliente é local ao recorte, na ordem do arquivo, com chão 0 quando não há', () => {
    const { stack } = importRegion(room(), { id: 'sala', region, flagsOf, source, version: '1332' });
    expect(stack.width).toBe(5);
    expect(stack.height).toBe(3);
    expect(stack.floors).toEqual([7]);
    expect(stack.tiles).toContainEqual([2, 2, 7, 0, [STAIRS]]);
    expect(stack.tiles).toContainEqual([2, 0, 7, FLOOR, [TORCH]]);
    expect(stack.tiles).toHaveLength(15);
  });

  it('o último tile vence quando o arquivo repete a coordenada, e o relatório conta', () => {
    const twice = [...room(), tile(1001, 2000, 7, FLOOR, [WALL])];
    const { content, report } = importRegion(twice, { id: 'sala', region, flagsOf, source, version: '1332' });
    expect(report.conflicts).toBe(1);
    expect(content.floors?.['7']?.grid?.[0]).toBe('##..#');
  });

  it('tile sem chão e sem item fica fora do mapa; com item, é decidido pelos itens', () => {
    const tiles = [...room(), tile(1003, 2001, 7, null, [])];
    const { content, report } = importRegion(tiles, { id: 'sala', region, flagsOf, source, version: '1332' });
    // O último venceu com nada dentro: some, e vira `#` por ausência.
    expect(content.floors?.['7']?.grid?.[1]).toBe('#.###');
    expect(report.dropped).toBe(1);
  });

  it('id que o pacote não tem é erro — a menos que se peça para seguir', () => {
    const tiles = [...room(), tile(1001, 2001, 7, FLOOR, [999])];
    expect(() => importRegion(tiles, { id: 'sala', region, flagsOf, source, version: '1332' })).toThrow(/999/);
    const { report } = importRegion(tiles, { id: 'sala', region, flagsOf, source, version: '1332', allowUnknown: true });
    expect(report.unknownIds).toEqual([999]);
  });

  it('a entrada vira coordenada local e tem de ser andável', () => {
    const { content } = importRegion(room(), { id: 'sala', region, flagsOf, source, version: '1332', entryPoint: { x: 1001, y: 2001, z: 7 } });
    expect(content.entryPoint).toEqual({ x: 1, y: 1, z: 7 });
    expect(() => importRegion(room(), { id: 'sala', region, flagsOf, source, version: '1332', entryPoint: { x: 1002, y: 2001, z: 7 } }))
      .toThrow(/não é um tile andável/);
  });

  it('--keep-from apara à componente andável mais a borda, e a caixa encolhe', () => {
    // Duas salas separadas por parede: fica só a da semente.
    const two = [
      ...room(),
      tile(1010, 2000, 7, FLOOR, [WALL]), tile(1011, 2000, 7, FLOOR), tile(1012, 2000, 7, FLOOR, [WALL]),
    ];
    const wide: Region = { x: [1000, 1012], y: [2000, 2002], z: [7, 7] };
    const { content, report } = importRegion(two, { id: 'sala', region: wide, flagsOf, source, version: '1332', keepFrom: { x: 1001, y: 2000, z: 7 } });
    expect(report.region).toEqual({ x: [1000, 1004], y: [2000, 2002], z: [7, 7] });
    expect(content.floors?.['7']?.grid).toEqual(['#...#', '#.#.#', '##.##']);
    expect(content.source?.region.x).toEqual([1000, 1004]);
  });

  it('--keep-from mantém os outros andares dentro da caixa resultante', () => {
    // A componente é do andar da semente; z6 nunca entra no flood-fill e ainda assim é o teto
    // do lugar recortado — sumir com ele era o defeito: Thais importada só com o z7.
    const two = [
      ...room(),
      ...room().map((t) => ({ ...t, z: 6 })),
      tile(1010, 2000, 7, FLOOR, [WALL]), tile(1011, 2000, 7, FLOOR), tile(1012, 2000, 7, FLOOR, [WALL]),
      tile(1011, 2000, 6, FLOOR),
    ];
    const wide: Region = { x: [1000, 1012], y: [2000, 2002], z: [6, 7] };
    const { content, report } = importRegion(two, { id: 'sala', region: wide, flagsOf, source, version: '1332', keepFrom: { x: 1001, y: 2000, z: 7 } });
    expect(report.region).toEqual({ x: [1000, 1004], y: [2000, 2002], z: [6, 7] });
    expect(content.floors?.['6']?.grid).toEqual(['#...#', '#.#.#', '##.##']);
    // A sala isolada some nos dois andares: 3 tiles em z7 e 1 em z6.
    expect(report.dropped).toBe(4);
  });

  it('id desconhecido numa sala que o recorte descartou não é erro nem entra no relatório', () => {
    const two = [
      ...room(),
      tile(1010, 2000, 7, FLOOR, [WALL]), tile(1011, 2000, 7, FLOOR, [999]), tile(1012, 2000, 7, FLOOR, [WALL]),
    ];
    const wide: Region = { x: [1000, 1012], y: [2000, 2002], z: [7, 7] };
    const { report } = importRegion(two, { id: 'sala', region: wide, flagsOf, source, version: '1332', keepFrom: { x: 1001, y: 2000, z: 7 } });
    expect(report.unknownIds).toEqual([]);
  });

  it('os dois formatos escritos são JSON válido e reconstroem o mapa', () => {
    const result = importRegion(room(), { id: 'sala', region, flagsOf, source, version: '1332' });
    const content = JSON.parse(formatContentMap(result.content)) as unknown;
    expect(buildTilemap(result.content).width).toBe(buildTilemap(content as typeof result.content).width);
    const stack = JSON.parse(formatStackMap(result.stack)) as { tiles: unknown[] };
    expect(stack.tiles).toHaveLength(15);
  });
});

describe('importRegion — cenário usável (#727, ADR 0050 d.1)', () => {
  // Uma sala 3×1: porta comum fechada, alavanca (com aid), capim, e um baú (uid) e placa
  // (text) que nenhuma tabela do Canary cobre — classificados por atributo.
  const doorRegion: Region = { x: [1000, 1004], y: [3000, 3000], z: [7, 7] };
  const withItem = (x: number, y: number, z: number, ground: number, item: OtbmTile['items'][number]): OtbmTile =>
    ({ x, y, z, ground, items: [item], flags: 0 });
  const doorRoom = (): OtbmTile[] => [
    tile(1000, 3000, 7, FLOOR, [DOOR_CLOSED]),
    withItem(1001, 3000, 7, FLOOR, { id: LEVER_DOWN, actionId: 4000 }),
    tile(1002, 3000, 7, FLOOR, [GRASS_UNCUT]),
    withItem(1003, 3000, 7, FLOOR, { id: 2854, uniqueId: 500 }),
    withItem(1004, 3000, 7, FLOOR, { id: 1950, text: 'You see a sign.' }),
  ];

  it('o tile de uma porta comum FECHADA vira `.`, não `#` — quem bloqueia é o interativo, não a grade', () => {
    const sceneryIndex = buildSceneryIndex(sceneryTables);
    const { content } = importRegion(doorRoom(), {
      id: 'porta', region: doorRegion, flagsOf, source, version: '1332', sceneryIndex,
    });
    expect(content.floors?.['7']?.grid).toEqual(['.....']);
  });

  it('sem sceneryIndex, o comportamento é o de sempre — a porta fechada continua `#`', () => {
    const { content } = importRegion(doorRoom(), { id: 'porta', region: doorRegion, flagsOf, source, version: '1332' });
    expect(content.floors?.['7']?.grid).toEqual(['#....']);
    expect(content.interactables).toEqual([]);
  });

  it('classifica porta, alavanca, capim, baú e placa — cada um com kind, estado e appearanceKey', () => {
    const sceneryIndex = buildSceneryIndex(sceneryTables);
    const { content, report } = importRegion(doorRoom(), {
      id: 'porta', region: doorRegion, flagsOf, source, version: '1332', sceneryIndex,
    });
    expect(content.interactables).toEqual([
      { at: { x: 0, y: 0, z: 7 }, kind: 'door', initialState: 'closed', appearanceKey: 'door-300' },
      {
        at: { x: 1, y: 0, z: 7 }, kind: 'lever', initialState: 'down', appearanceKey: 'lever', aid: 4000,
      },
      {
        at: { x: 2, y: 0, z: 7 }, kind: 'grass', initialState: 'uncut', appearanceKey: 'grass-304',
        requires: { tool: 'machete' },
      },
      { at: { x: 3, y: 0, z: 7 }, kind: 'chest', initialState: 'default', appearanceKey: 'chest-2854', uid: 500 },
      {
        at: { x: 4, y: 0, z: 7 }, kind: 'sign', initialState: 'default', appearanceKey: 'sign-1950',
        text: 'You see a sign.',
      },
    ]);
    expect(Object.fromEntries(report.interactablesByKind)).toEqual({
      door: 1, lever: 1, grass: 1, chest: 1, sign: 1,
    });
  });

  it('formatContentMap escreve `interactables` no JSON — sem isto o cenário classificado nunca chega ao arquivo', () => {
    const sceneryIndex = buildSceneryIndex(sceneryTables);
    const { content } = importRegion(doorRoom(), {
      id: 'porta', region: doorRegion, flagsOf, source, version: '1332', sceneryIndex,
    });
    const parsed = JSON.parse(formatContentMap(content)) as { interactables: unknown[] };
    expect(parsed.interactables).toHaveLength(5);
  });

  it('mapa sem interativo nenhum não ganha `interactables` no JSON escrito', () => {
    const { content } = importRegion(room(), { id: 'sala', region, flagsOf, source, version: '1332' });
    const parsed = JSON.parse(formatContentMap(content)) as Record<string, unknown>;
    expect('interactables' in parsed).toBe(false);
  });

  it('appearances.scenery mescla o que a tabela do Canary já fecha com o que foi observado', () => {
    const sceneryIndex = buildSceneryIndex(sceneryTables);
    const { sceneryAppearances } = importRegion(doorRoom(), {
      id: 'porta', region: doorRegion, flagsOf, source, version: '1332', sceneryIndex,
    });
    expect(sceneryAppearances?.['door-300']).toEqual({ closed: 300, open: 301 });
    expect(sceneryAppearances?.lever).toEqual({ down: 302, up: 303 });
    expect(sceneryAppearances?.['grass-304']).toEqual({ uncut: 304, cut: 305 });
    expect(sceneryAppearances?.['chest-2854']).toEqual({ default: 2854 });
    expect(sceneryAppearances?.['sign-1950']).toEqual({ default: 1950 });
  });
});

describe('importRegion — camada zones (#830, OW-09, ADR 0060 d.8)', () => {
  // A mesma sala `room()`, com flags nos tiles. Os bits seguem o OTBM: PZ 1, no-pvp 4,
  // no-logout 8, arena 16 (`canary/src/io/io_definitions.hpp:73-76`).
  const flagged = (flagsByTile: Record<string, number>, houses: readonly string[] = []): OtbmTile[] =>
    room().map((t) => {
      const k = `${t.x},${t.y}`;
      return { ...t, flags: flagsByTile[k] ?? 0, ...(houses.includes(k) ? { houseId: 7 } : {}) };
    });
  const options = { id: 'sala', region, flagsOf, nameOf, source, version: '1332' } as const;

  it('os valores de `ZONE_FLAG` (content) são os de `TILE_FLAG` do leitor de OTBM', () => {
    // O `content` não importa de `scripts/`, então a igualdade é prendida aqui, onde os dois
    // se enxergam: se um dia o leitor mudar um bit, a camada deixa de dizer o que o Canary diz.
    expect(ZONE_FLAG).toEqual({
      protection: TILE_FLAG.protectionZone, noPvp: TILE_FLAG.noPvp, noLogout: TILE_FLAG.noLogout,
      pvpZone: TILE_FLAG.pvpZone,
    });
  });

  it('PZ, no-pvp e arena são exclusivos na ordem do Canary; no-logout soma (iomap.cpp:165-177)', () => {
    const { protectionZone: pz, noPvp, noLogout, pvpZone } = TILE_FLAG;
    expect(zoneFlagsOf({ flags: 0 })).toBe(0);
    expect(zoneFlagsOf({ flags: pz })).toBe(ZONE_FLAG.protection);
    expect(zoneFlagsOf({ flags: noPvp })).toBe(ZONE_FLAG.noPvp);
    expect(zoneFlagsOf({ flags: pvpZone })).toBe(ZONE_FLAG.pvpZone);
    // Exclusividade: PZ vence no-pvp e arena; no-pvp vence arena.
    expect(zoneFlagsOf({ flags: pz | noPvp | pvpZone })).toBe(ZONE_FLAG.protection);
    expect(zoneFlagsOf({ flags: noPvp | pvpZone })).toBe(ZONE_FLAG.noPvp);
    // No-logout soma: sozinho, e sobre cada um dos três.
    expect(zoneFlagsOf({ flags: noLogout })).toBe(ZONE_FLAG.noLogout);
    expect(zoneFlagsOf({ flags: pz | noLogout })).toBe(ZONE_FLAG.protection | ZONE_FLAG.noLogout);
    expect(zoneFlagsOf({ flags: noPvp | noLogout })).toBe(ZONE_FLAG.noPvp | ZONE_FLAG.noLogout);
    expect(zoneFlagsOf({ flags: pvpZone | noLogout })).toBe(ZONE_FLAG.pvpZone | ZONE_FLAG.noLogout);
    // Bit que o Canary não conhece (2, 32…) é ignorado, como o `if` encadeado dele ignora.
    expect(zoneFlagsOf({ flags: 2 | 32 })).toBe(0);
    expect(zoneFlagsOf({ flags: 2 | pz })).toBe(ZONE_FLAG.protection);
  });

  it('tile de casa é PZ mesmo sem a flag no arquivo (House::addTile, house.cpp:26-28)', () => {
    expect(zoneFlagsOf({ flags: 0, houseId: 7 })).toBe(ZONE_FLAG.protection);
    expect(zoneFlagsOf({ flags: TILE_FLAG.noLogout, houseId: 7 })).toBe(ZONE_FLAG.protection | ZONE_FLAG.noLogout);
    // Casa com no-pvp no arquivo: a PZ da casa vence, como a ordem do Canary manda.
    expect(zoneFlagsOf({ flags: TILE_FLAG.noPvp, houseId: 7 })).toBe(ZONE_FLAG.protection);
  });

  it('escreve a camada por andar, um caractere por tile, e `buildTilemap` a devolve nos mesmos bits', () => {
    // y2000: 1000 PZ · 1001 normal · 1002 no-pvp + no-logout · 1003 arena · 1004 PZ + no-logout
    // y2001: 1001 só no-logout, e o 1003 é uma casa — PZ sem a flag no arquivo
    const tiles = flagged({
      '1000,2000': TILE_FLAG.protectionZone,
      '1002,2000': TILE_FLAG.noPvp | TILE_FLAG.noLogout,
      '1003,2000': TILE_FLAG.pvpZone,
      '1004,2000': TILE_FLAG.protectionZone | TILE_FLAG.noLogout,
      '1001,2001': TILE_FLAG.noLogout,
    }, ['1003,2001']);
    const { content } = importRegion(tiles, options);
    expect(content.floors?.['7']?.zones).toEqual(['p.NaP', '.l.p.', '.....']);
    const map = buildTilemap(content);
    expect(zoneFlagsAt(map, 0, 0, 7)).toBe(ZONE_FLAG.protection);
    expect(zoneFlagsAt(map, 1, 0, 7)).toBe(0);
    expect(zoneFlagsAt(map, 2, 0, 7)).toBe(ZONE_FLAG.noPvp | ZONE_FLAG.noLogout);
    expect(zoneFlagsAt(map, 3, 0, 7)).toBe(ZONE_FLAG.pvpZone);
    expect(zoneFlagsAt(map, 4, 0, 7)).toBe(ZONE_FLAG.protection | ZONE_FLAG.noLogout);
    expect(zoneFlagsAt(map, 1, 1, 7)).toBe(ZONE_FLAG.noLogout);
    expect(zoneFlagsAt(map, 3, 1, 7)).toBe(ZONE_FLAG.protection);
  });

  it('a camada não mexe em bloqueio, velocidade nem visão: o mesmo recorte sem flag dá as mesmas grades', () => {
    const plain = importRegion(room(), options).content.floors?.['7'];
    const zoned = importRegion(flagged({ '1001,2000': TILE_FLAG.protectionZone, '1002,2002': TILE_FLAG.noLogout }), options)
      .content.floors?.['7'];
    expect(zoned?.zones).toBeDefined();
    expect(zoned?.grid).toEqual(plain?.grid);
    expect(zoned?.speed).toEqual(plain?.speed);
    expect(zoned?.sight).toEqual(plain?.sight);
  });

  it('o tile bloqueado e o degrau sem chão também guardam a zona — tile a tile, como o Canary', () => {
    // 1000,2000 é parede (`#`) e 1002,2002 é o degrau sem chão: os dois existem no arquivo com
    // a flag, e a camada de zona não é a de passo.
    const { content } = importRegion(
      flagged({ '1000,2000': TILE_FLAG.protectionZone, '1002,2002': TILE_FLAG.protectionZone }), options,
    );
    const map = buildTilemap(content);
    expect(isBlocked(map, 0, 0, 7)).toBe(true);
    expect(zoneFlagsAt(map, 0, 0, 7)).toBe(ZONE_FLAG.protection);
    expect(zoneFlagsAt(map, 2, 2, 7)).toBe(ZONE_FLAG.protection);
  });

  it('andar sem nenhum tile de zona fica sem a camada, e o recorte todo sem flag não a ganha', () => {
    const upper = room().map((t) => ({ ...t, z: 6, flags: 0 }));
    const both = [...flagged({ '1001,2000': TILE_FLAG.protectionZone }), ...upper];
    const wide: Region = { x: [1000, 1004], y: [2000, 2002], z: [6, 7] };
    const { content } = importRegion(both, { ...options, region: wide });
    expect(content.floors?.['7']?.zones).toBeDefined();
    expect(content.floors?.['6']?.zones).toBeUndefined();
    const bare = importRegion(room(), options).content;
    expect(bare.floors?.['7']?.zones).toBeUndefined();
    expect(buildTilemap(bare).floors.get(7)?.zones).toBeNull();
  });

  it('o último tile vence também nas flags quando o arquivo repete a coordenada', () => {
    // O 1001,2000 volta no fim do arquivo sem flag: vence, e some a única zona.
    const cleared = [...flagged({ '1001,2000': TILE_FLAG.protectionZone }), { ...tile(1001, 2000, 7, FLOOR), flags: 0 }];
    expect(importRegion(cleared, options).content.floors?.['7']?.zones).toBeUndefined();
    // E o inverso: volta com no-pvp, e é o que fica.
    const set = [...room(), { ...tile(1001, 2000, 7, FLOOR), flags: TILE_FLAG.noPvp }];
    expect(importRegion(set, options).content.floors?.['7']?.zones?.[0]).toBe('.n...');
  });

  it('collectTiles carrega as flags e a casa', () => {
    const { tiles } = collectTiles([
      { ...tile(1, 1, 7, 1), flags: TILE_FLAG.protectionZone },
      { ...tile(2, 1, 7, 1), flags: 0, houseId: 9 },
    ]);
    expect(tiles.get('1,1,7')?.flags).toBe(TILE_FLAG.protectionZone);
    expect(tiles.get('2,1,7')).toMatchObject({ flags: 0, houseId: 9 });
  });

  it('`deriveZones` — sem pacote algum — dá as mesmas linhas que `importRegion`', () => {
    const tiles = flagged({
      '1000,2000': TILE_FLAG.protectionZone, '1002,2001': TILE_FLAG.noLogout, '1003,2000': TILE_FLAG.noPvp,
    }, ['1004,2001']);
    const imported = importRegion(tiles, options).content.floors?.['7']?.zones;
    expect(imported).toEqual(['p..n.', '..l.p', '.....']);
    expect(deriveZones(tiles, region, [7])['7']).toEqual(imported);
    // Tile sem chão e sem item não existe no mapa, e a flag dele não conta: o 1001,2002 volta
    // vazio e com PZ no fim do arquivo.
    const empty = [...tiles, { ...tile(1001, 2002, 7, null), flags: TILE_FLAG.protectionZone }];
    expect(deriveZones(empty, region, [7])['7']).toEqual(imported);
  });

  it('com `--keep-from`, `deriveZones` e `importRegion` ainda concordam sobre a caixa final', () => {
    const wide: Region = { x: [1000, 1012], y: [2000, 2002], z: [7, 7] };
    const two: OtbmTile[] = [
      ...flagged({ '1001,2000': TILE_FLAG.protectionZone }),
      { ...tile(1010, 2000, 7, FLOOR, [WALL]), flags: TILE_FLAG.protectionZone },
      { ...tile(1011, 2000, 7, FLOOR), flags: TILE_FLAG.protectionZone },
      { ...tile(1012, 2000, 7, FLOOR, [WALL]), flags: 0 },
    ];
    const { content, report } = importRegion(two, { ...options, region: wide, keepFrom: { x: 1001, y: 2000, z: 7 } });
    expect(report.region).toEqual({ x: [1000, 1004], y: [2000, 2002], z: [7, 7] });
    // `source.region` é a caixa final: é o que o `--check` e o `--zones-only` repassam.
    expect(deriveZones(two, report.region, [7])['7']).toEqual(content.floors?.['7']?.zones);
    expect(content.floors?.['7']?.zones).toEqual(['.p...', '.....', '.....']);
  });

  it('`formatContentMap` escreve `zones` depois de `sight`, JSON válido, e o arquivo reconstrói o mapa', () => {
    const { content } = importRegion(flagged({ '1001,2000': TILE_FLAG.protectionZone }), options);
    const parsed = JSON.parse(formatContentMap(content)) as { floors: Record<string, Record<string, string[]>> };
    expect(Object.keys(parsed.floors['7'] ?? {})).toEqual(['grid', 'speed', 'sight', 'zones']);
    expect(parsed.floors['7']?.zones).toEqual(content.floors?.['7']?.zones);
    expect(zoneFlagsAt(buildTilemap(parsed as unknown as typeof content), 1, 0, 7)).toBe(ZONE_FLAG.protection);
    // E sem a camada, o arquivo é o de antes: `sight` é a última e fecha sem vírgula sobrando.
    const bare = formatContentMap(importRegion(room(), options).content);
    expect(Object.keys((JSON.parse(bare) as { floors: Record<string, object> }).floors['7'] ?? {}))
      .toEqual(['grid', 'speed', 'sight']);
    expect(bare).not.toContain('"zones"');
  });

  it('`applyZones` troca só a camada: o resto do mapa sai idêntico, byte a byte', () => {
    const pzAtOne = flagged({ '1001,2000': TILE_FLAG.protectionZone });
    const { content } = importRegion(pzAtOne, options);
    const withoutZones = importRegion(room(), options).content;
    // Grafar a camada num mapa sem ela dá o mesmo arquivo que o importador escreve.
    expect(formatContentMap(applyZones(withoutZones, deriveZones(pzAtOne, region, [7]))))
      .toBe(formatContentMap(content));
    // Tirar a camada devolve o texto de antes, e aplicar de novo é idempotente.
    expect(formatContentMap(applyZones(content, {}))).toBe(formatContentMap(withoutZones));
    const once = applyZones(withoutZones, { '7': ['.p...', '.....', '.....'] });
    expect(formatContentMap(applyZones(once, { '7': ['.p...', '.....', '.....'] }))).toBe(formatContentMap(once));
  });

  it('`summarizeZones` conta tile a tile, por andar, ignorando o normal', () => {
    const { content } = importRegion(flagged({
      '1000,2000': TILE_FLAG.protectionZone, '1001,2000': TILE_FLAG.protectionZone,
      '1002,2000': TILE_FLAG.noLogout,
    }), options);
    expect(summarizeZones(content.floors)).toEqual([{ z: '7', counts: { p: 2, l: 1 } }]);
    expect(summarizeZones(importRegion(room(), options).content.floors)).toEqual([{ z: '7', counts: {} }]);
  });
});

describe('checkMaps — camada zones, sem o pacote de arte (#830)', () => {
  let dir: string | null = null;
  afterEach(() => { if (dir !== null) rmSync(dir, { recursive: true, force: true }); dir = null; });

  // Um OTBM mínimo, montado do formato: por andar, tiles em (1000.., 2000) com as flags dadas.
  const otbmWith = (floors: Readonly<Record<number, readonly number[]>>): Uint8Array => {
    const areas = Object.entries(floors).map(([z, flagsOfTiles]) => {
      const tiles = flagsOfTiles.map((flags, dx) =>
        otbmNode(NODE.tile, [...u8(dx), ...u8(0), 0x03, ...u32(flags), 0x09, ...u16(410)]));
      return otbmNode(NODE.tileArea, [...u16(1000), ...u16(2000), ...u8(Number(z))], tiles);
    });
    const mapData = otbmNode(NODE.mapData, [], areas);
    const root = otbmNode(NODE.root, [...u32(4), ...u16(2048), ...u16(2048), ...u32(4), ...u32(4)], [mapData]);
    return Uint8Array.from([0, 0, 0, 0, ...root]);
  };
  const setup = (
    floorsInOtbm: Readonly<Record<number, readonly number[]>>, floorsInMap: Readonly<Record<string, object>>,
  ): { maps: string; things: string; otbmDir: string } => {
    dir = mkdtempSync(join(tmpdir(), 'maps-zones-'));
    const maps = join(dir, 'maps');
    const things = join(dir, 'things');
    const otbmDir = join(things, 'maps');
    mkdirSync(maps);
    mkdirSync(otbmDir, { recursive: true });
    const otbm = otbmWith(floorsInOtbm);
    writeFileSync(join(otbmDir, 'world.otbm'), otbm);
    const sha256 = createHash('sha256').update(otbm).digest('hex');
    const zs = Object.keys(floorsInOtbm).map(Number);
    writeFileSync(join(maps, 'thais.json'), JSON.stringify({
      id: 'thais', z: 7, floors: floorsInMap,
      source: { file: 'world.otbm', sha256, region: { x: [1000, 1002], y: [2000, 2000], z: [Math.min(...zs), Math.max(...zs)] } },
    }));
    return { maps, things, otbmDir };
  };
  const PZ = TILE_FLAG.protectionZone;
  // Sem o pacote a geometria é `absent`; `zonesChecked` diz que a camada foi conferida mesmo assim.
  const noPack = (things: string, zonesChecked = true): CheckOutcome => ({
    file: 'thais.json', status: 'absent', detail: `pacote 1332 não está em ${things}`,
    ...(zonesChecked ? { zonesChecked: true as const } : {}),
  });

  it('zonas que conferem com os TILE_FLAGS do OTBM passam, e a geometria sem pacote segue `absent`', () => {
    const { maps, things, otbmDir } = setup(
      { 7: [PZ, 0, PZ | TILE_FLAG.noLogout] }, { '7': { grid: ['...'], zones: ['p.P'] } },
    );
    expect(checkMaps(maps, things, '1332', otbmDir)).toEqual([noPack(things)]);
  });

  it('zonas editadas à mão, ou de um OTBM que mudou, reprovam MESMO sem o pacote de arte', () => {
    const { maps, things, otbmDir } = setup(
      { 7: [PZ, 0, PZ | TILE_FLAG.noLogout] }, { '7': { grid: ['...'], zones: ['p..'] } },
    );
    const [outcome] = checkMaps(maps, things, '1332', otbmDir);
    expect(outcome?.status).toBe('stale');
    expect(outcome?.detail).toMatch(/zonas \(zones\) do andar 7 diferem/);
    expect(outcome?.detail).toMatch(/--id thais --zones-only/);
  });

  it('o mapa que ainda não tem a camada não é cobrado por ela — as hunts não mudam', () => {
    const { maps, things, otbmDir } = setup({ 7: [PZ, 0, 0] }, { '7': { grid: ['...'] } });
    expect(checkMaps(maps, things, '1332', otbmDir)).toEqual([noPack(things, false)]);
  });

  it('o mapa que TEM a camada num andar e não a tem noutro onde o OTBM diz ter zona reprova', () => {
    const { maps, things, otbmDir } = setup(
      { 7: [PZ, 0, 0], 6: [0, PZ, 0] },
      { '7': { grid: ['...'], zones: ['p..'] }, '6': { grid: ['...'] } },
    );
    const [outcome] = checkMaps(maps, things, '1332', otbmDir);
    expect(outcome?.status).toBe('stale');
    expect(outcome?.detail).toMatch(/do andar 6 diferem/);
  });

  it('um andar sem zona alguma no OTBM e sem a camada no arquivo confere', () => {
    const { maps, things, otbmDir } = setup(
      { 7: [PZ, 0, 0], 6: [0, 0, 0] },
      { '7': { grid: ['...'], zones: ['p..'] }, '6': { grid: ['...'] } },
    );
    expect(checkMaps(maps, things, '1332', otbmDir)).toEqual([noPack(things)]);
  });
});

describe('collectTiles', () => {
  it('conta leituras e conflitos', () => {
    const { tiles, conflicts, read } = collectTiles([tile(1, 1, 7, 1), tile(1, 1, 7, 2), tile(2, 1, 7, 3)]);
    expect(read).toBe(3);
    expect(conflicts).toBe(1);
    expect(tiles.get('1,1,7')?.ground).toBe(2);
  });
});

describe('argumentos', () => {
  it('lê faixas e pontos', () => {
    expect(parseRange('32275..32458')).toEqual([32275, 32458]);
    expect(parseRange('8')).toEqual([8, 8]);
    expect(() => parseRange('a..b')).toThrow(/faixa inválida/);
    expect(parsePoint('32369,32241,7')).toEqual({ x: 32369, y: 32241, z: 7 });
    expect(() => parsePoint('1,2')).toThrow(/ponto inválido/);
  });
});

describe('checkMaps', () => {
  let dir: string | null = null;
  afterEach(() => { if (dir !== null) rmSync(dir, { recursive: true, force: true }); dir = null; });

  it('mapa autorado à mão é hand-made, e mapa importado sem o OTBM na máquina é absent', () => {
    dir = mkdtempSync(join(tmpdir(), 'maps-'));
    const maps = join(dir, 'maps');
    mkdirSync(maps);
    writeFileSync(join(maps, 'hand.json'), JSON.stringify({ id: 'hand', z: 7, grid: ['###', '#.#', '###'] }));
    writeFileSync(join(maps, 'thais.json'), JSON.stringify({
      id: 'thais', z: 7, floors: { '7': { grid: ['###', '#.#', '###'] } },
      source: { file: 'nope.otbm', sha256: 'a'.repeat(64), region: { x: [0, 2], y: [0, 2], z: [7, 7] } },
    }));
    expect(checkMaps(maps, join(dir, 'things'), '1332', join(dir, 'things', 'maps'))).toEqual([
      { file: 'hand.json', status: 'hand-made' },
      { file: 'thais.json', status: 'absent' },
    ]);
  });

  it('com o OTBM mas sem o pacote de arte na máquina é absent, não exceção', () => {
    dir = mkdtempSync(join(tmpdir(), 'maps-'));
    const maps = join(dir, 'maps');
    const otbmDir = join(dir, 'things', 'maps');
    mkdirSync(maps);
    mkdirSync(otbmDir, { recursive: true });
    const otbm = Uint8Array.from([0, 0, 0, 0]);
    writeFileSync(join(otbmDir, 'world.otbm'), otbm);
    const sha256 = createHash('sha256').update(otbm).digest('hex');
    writeFileSync(join(maps, 'thais.json'), JSON.stringify({
      id: 'thais', z: 7, floors: { '7': { grid: ['###', '#.#', '###'] } },
      source: { file: 'world.otbm', sha256, region: { x: [0, 2], y: [0, 2], z: [7, 7] } },
    }));
    expect(checkMaps(maps, join(dir, 'things'), '1332', otbmDir)).toEqual([
      { file: 'thais.json', status: 'absent', detail: `pacote 1332 não está em ${join(dir, 'things')}` },
    ]);
  });
});
