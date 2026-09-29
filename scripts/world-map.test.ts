import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeSector, SECTOR_SIZE, sectorPath } from '../packages/client/src/world/sector.js';
import { readOtbmTiles } from './otbm.js';
import type { OtbmTile } from './otbm.js';
import { buildWorld, checkWorld, formatWorldIndex } from './world-map.js';

const META = { version: '1332', source: { file: 'fixture.otbm', sha256: 'a'.repeat(64) } };
const tile = (x: number, y: number, z: number, extra: Partial<OtbmTile> = {}): OtbmTile =>
  ({ x, y, z, ground: 100, items: [], flags: 0, ...extra });

describe('buildWorld', () => {
  it('agrupa por setor e andar, com coordenada local e o índice por andar', () => {
    const build = buildWorld([
      tile(32000, 32000, 7),
      tile(32031, 32031, 7, { ground: null, items: [{ id: 5, count: 3 }], flags: 1 | 64 | 256, houseId: 9 }),
      tile(32032, 32000, 7),
      tile(32100, 32200, 8),
    ], META);
    expect([...build.sectors.keys()].sort()).toEqual(['7/1000-1000.bin', '7/1001-1000.bin', '8/1003-1006.bin']);
    expect(decodeSector(build.sectors.get('7/1000-1000.bin') as Uint8Array).tiles).toEqual([
      { x: 0, y: 0, ground: 100, items: [], flags: 0 },
      // flags num byte: o bit 256 do OTBM não é zona e fica de fora.
      { x: 31, y: 31, ground: 0, items: [{ id: 5, count: 3 }], flags: 1 | 64, houseId: 9 },
    ]);
    expect(build.index.floors).toEqual([
      { z: 7, bbox: { x: [32000, 32063], y: [32000, 32031] }, sectors: [[1000, 1000], [1001, 1000]] },
      { z: 8, bbox: { x: [32096, 32127], y: [32192, 32223] }, sectors: [[1003, 1006]] },
    ]);
    expect(build.tiles).toBe(4);
  });

  it('setor que reaparece depois de outros é fundido, e o último vence na mesma célula', () => {
    const far = Array.from({ length: 5000 }, (_, i) => tile((i % 100) * SECTOR_SIZE, 20000 + Math.floor(i / 100) * SECTOR_SIZE, 9));
    const build = buildWorld([
      tile(32000, 32000, 7, { ground: 1 }),
      ...far,
      tile(32001, 32000, 7, { ground: 2 }),
      tile(32000, 32000, 7, { ground: 3 }),
    ], META);
    const tiles = decodeSector(build.sectors.get(sectorPath(7, 1000, 1000)) as Uint8Array).tiles;
    expect(tiles.map((t) => [t.x, t.ground])).toEqual([[0, 3], [1, 2]]);
    expect(build.duplicates).toBe(1);
  });

  it('o resultado não depende da ordem dos setores no arquivo', () => {
    const a = buildWorld([tile(10, 10, 7), tile(100, 100, 7), tile(11, 10, 7)], META);
    const b = buildWorld([tile(100, 100, 7), tile(11, 10, 7), tile(10, 10, 7)], META);
    expect([...a.sectors.entries()].sort()).toEqual([...b.sectors.entries()].sort());
    expect(formatWorldIndex(a.index)).toBe(formatWorldIndex(b.index));
  });
});

describe('checkWorld', () => {
  let dir: string | null = null;
  afterEach(() => { if (dir !== null) rmSync(dir, { recursive: true, force: true }); dir = null; });

  it('confere, e aponta o que falta, o que difere, o que sobra e o índice', () => {
    dir = mkdtempSync(join(tmpdir(), 'world-'));
    const build = buildWorld([tile(10, 10, 7), tile(100, 100, 7)], META);
    for (const [key, bytes] of build.sectors) {
      mkdirSync(dirname(join(dir, key)), { recursive: true });
      writeFileSync(join(dir, key), bytes);
    }
    writeFileSync(join(dir, 'index.json'), formatWorldIndex(build.index));
    expect(checkWorld(build, dir)).toEqual({ missing: [], stale: [], extra: [], indexStale: false });

    writeFileSync(join(dir, '7/0-0.bin'), Uint8Array.from([0]));
    rmSync(join(dir, '7/3-3.bin'));
    writeFileSync(join(dir, '7/9-9.bin'), Uint8Array.from([0]));
    writeFileSync(join(dir, 'index.json'), '{}');
    expect(checkWorld(build, dir)).toEqual({ missing: ['7/3-3.bin'], stale: ['7/0-0.bin'], extra: ['7/9-9.bin'], indexStale: true });
  });
});

// O mapa real, quando está na máquina: um setor de Thais escrito em `things/` bate tile a tile
// com o que o leitor do OTBM entrega para a mesma região. Pula onde o mapa não foi gerado.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OTBM = join(ROOT, 'things', 'maps', 'otservbr.otbm');
const THAIS_SECTOR = join(ROOT, 'things', '1332', 'world', sectorPath(7, 1011, 1007));
const real = existsSync(OTBM) && existsSync(THAIS_SECTOR);

describe.skipIf(!real)('mundo real (things/)', () => {
  it('o setor do templo de Thais bate com o OTBM', () => {
    const region = { x: [32352, 32383] as [number, number], y: [32224, 32255] as [number, number], z: [7, 7] as [number, number] };
    const expected = [...readOtbmTiles(new Uint8Array(readFileSync(OTBM)), region)]
      .map((t) => ({ x: t.x - 32352, y: t.y - 32224, ground: t.ground ?? 0, items: t.items.map((i) => i.id) }))
      .sort((a, b) => a.y * 32 + a.x - (b.y * 32 + b.x));
    const actual = decodeSector(new Uint8Array(readFileSync(THAIS_SECTOR))).tiles
      .map((t) => ({ x: t.x, y: t.y, ground: t.ground, items: t.items.map((i) => i.id) }));
    expect(actual.length).toBeGreaterThan(500);
    expect(actual).toEqual(expected);
  }, 30_000);
});
