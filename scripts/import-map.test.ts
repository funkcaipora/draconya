import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NO_FLAGS } from '../packages/client/src/assets/appearances.js';
import type { AppearanceFlags } from '../packages/client/src/assets/appearances.js';
import { buildTilemap, groundSpeed, isBlocked } from '../packages/content/src/map.js';
import {
  checkMaps, collectTiles, formatContentMap, formatStackMap, importRegion, parsePoint, parseRange,
} from './import-map.js';
import type { OtbmTile, Region } from './otbm.js';

// Um "pacote" sintético: cada id com as flags que interessam ao importador.
const FLOOR = 100; // chão de velocidade 130
const MUD = 101; // chão de velocidade 200
const WALL = 200; // bottom + unpass
const TORCH = 201; // item comum, passável
const STAIRS = 202; // item passável sem chão embaixo (o degrau)
const WATER = 102; // chão com unpass
const flagsOf = (id: number): AppearanceFlags | null => {
  switch (id) {
    case FLOOR: return { ...NO_FLAGS, bankWaypoints: 130, fullbank: true };
    case MUD: return { ...NO_FLAGS, bankWaypoints: 200 };
    case WALL: return { ...NO_FLAGS, bottom: true, unpass: true, unsight: true };
    case TORCH: return { ...NO_FLAGS, take: true };
    case STAIRS: return { ...NO_FLAGS };
    case WATER: return { ...NO_FLAGS, bankWaypoints: 0, unpass: true };
    default: return null;
  }
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
});
