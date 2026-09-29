import { describe, expect, it } from 'vitest';
import { createCensus, formatSummary, SECTOR_SIZE } from './map-census.js';
import type { OtbmHeader, OtbmTile } from './otbm.js';

// O censo é agregação pura: a fixture é uma lista de tiles, nunca um OTBM de 176 MB.

const header: OtbmHeader = { version: 4, width: 2048, height: 2048, itemsMajorVersion: 4, itemsMinorVersion: 4 };
const tile = (x: number, y: number, z: number, extra: Partial<OtbmTile> = {}): OtbmTile =>
  ({ x, y, z, ground: 100, items: [], flags: 0, ...extra });

function run(tiles: OtbmTile[], pack?: { version: string; has: (id: number) => boolean }) {
  const census = createCensus();
  for (const t of tiles) census.add(t);
  return census.finish({ header, towns: [], waypoints: [], ...(pack === undefined ? {} : { pack }) });
}

describe('createCensus', () => {
  it('conta tiles, tiles sem chão, bbox e setores por andar', () => {
    const report = run([
      tile(32000, 32000, 7),
      tile(32031, 32031, 7, { ground: null, items: [{ id: 5 }] }),
      tile(32032, 32000, 7),
      tile(32100, 32200, 8),
    ]);
    expect(report.tiles).toBe(4);
    expect(report.floors).toEqual([
      { z: 7, tiles: 3, withoutGround: 1, bbox: { x: [32000, 32032], y: [32000, 32031] }, sectors: 2 },
      { z: 8, tiles: 1, withoutGround: 0, bbox: { x: [32100, 32100], y: [32200, 32200] }, sectors: 1 },
    ]);
    expect(report.size.sectors).toBe(3);
    expect(report.size.sectorSize).toBe(SECTOR_SIZE);
  });

  it('o tile repetido conta como conflito, não como tile a mais', () => {
    const report = run([tile(32000, 32000, 7), tile(32000, 32000, 7, { ground: 200 })]);
    expect(report.tiles).toBe(1);
    expect(report.tileRecords).toBe(2);
    expect(report.duplicates).toBe(1);
  });

  it('mede a cobertura do pacote por id e por tile afetado', () => {
    const report = run([
      tile(1, 1, 7, { ground: 100, items: [{ id: 900 }] }),
      tile(2, 1, 7, { ground: 100, items: [{ id: 900 }, { id: 901 }] }),
    ], { version: '1332', has: (id) => id === 100 });
    expect(report.appearances.distinct).toBe(3);
    expect(report.appearances.pack).toEqual({
      version: '1332', missing: 2, tilesAffected: 3,
      missingIds: [{ id: 900, tiles: 2 }, { id: 901, tiles: 1 }],
    });
  });

  it('sem pacote, a cobertura é null', () => {
    expect(run([tile(1, 1, 7)]).appearances.pack).toBeNull();
  });

  it('conta zonas pelas flags e casas distintas', () => {
    const report = run([
      tile(1, 1, 7, { flags: 1 | 8 }),
      tile(2, 1, 7, { flags: 4 | 16, houseId: 10 }),
      tile(3, 1, 7, { houseId: 10 }),
      tile(4, 1, 7, { houseId: 11 }),
    ]);
    expect(report.zones).toEqual({ protectionZone: 1, noPvp: 1, noLogout: 1, pvpZone: 1, houseTiles: 3, houses: 2 });
  });

  it('separa teleporte por script, teleporte quebrado e o que leva a tile existente', () => {
    const report = run([
      tile(1, 1, 7, { items: [{ id: 1, teleportTo: { x: 2, y: 1, z: 7 } }] }),
      tile(2, 1, 7, { items: [{ id: 1, teleportTo: { x: 0, y: 0, z: 0 } }] }),
      tile(3, 1, 7, { items: [{ id: 1, teleportTo: { x: 500, y: 500, z: 9 } }, { id: 2, houseDoorId: 1, actionId: 5, uniqueId: 6 }] }),
    ]);
    expect(report.items).toEqual({
      teleports: 3, scriptedTeleports: 1,
      teleportsToNowhere: [{ from: { x: 3, y: 1, z: 7 }, to: { x: 500, y: 500, z: 9 } }],
      houseDoors: 1, withActionId: 1, withUniqueId: 1,
    });
  });

  it('estima o tamanho: binário por tile mais 2 bytes por setor, e gzip medido', () => {
    const report = run([tile(1, 1, 7, { items: [{ id: 7, count: 3 }, { id: 8 }] })]);
    // dx dy chão(2) n + (id 2 + contagem 1) + id 2 = 10, mais 2 do setor.
    expect(report.size.binaryBytes).toBe(12);
    expect(report.size.binaryGzipBytes).toBeGreaterThan(0);
    expect(report.size.jsonBytes).toBe(JSON.stringify([1, 1, 7, 100, [[7, 3], 8]]).length + 2);
  });

  it('o resumo cita o que o relatório mede', () => {
    const summary = formatSummary(run([tile(1, 1, 7)]));
    expect(summary).toMatch(/tiles: 1/);
    expect(summary).toMatch(/pacote de arte ausente/);
  });
});
