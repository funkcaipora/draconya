import { describe, expect, it } from 'vitest';
import {
  decodeSector, encodeSector, isWorldIndex, SECTOR_SIZE, SectorError, sectorOf, sectorPath, stacksOf,
} from './sector.js';
import type { Sector } from './sector.js';

describe('encodeSector / decodeSector', () => {
  it('ida e volta preserva chão, pilha, contagem, flags e casa', () => {
    const sector: Sector = {
      sx: 1011, sy: 1007, z: 7,
      tiles: [
        { x: 0, y: 0, ground: 4515, items: [], flags: 0 },
        { x: 31, y: 0, ground: 0, items: [{ id: 1948 }], flags: 1 },
        { x: 5, y: 31, ground: 4515, items: [{ id: 3031, count: 57 }, { id: 2854 }], flags: 1 | 8, houseId: 2958 },
      ],
    };
    expect(decodeSector(encodeSector(sector))).toEqual(sector);
  });

  it('ordena os tiles por célula e é determinístico para a mesma entrada em outra ordem', () => {
    const a: Sector = { sx: 0, sy: 0, z: 8, tiles: [
      { x: 2, y: 1, ground: 10, items: [], flags: 0 },
      { x: 1, y: 0, ground: 11, items: [], flags: 0 },
    ] };
    const b: Sector = { ...a, tiles: [...a.tiles].reverse() };
    expect(encodeSector(a)).toEqual(encodeSector(b));
    expect(decodeSector(encodeSector(a)).tiles.map((t) => [t.x, t.y])).toEqual([[1, 0], [2, 1]]);
  });

  it('paleta maior que 256 passa a índice de dois bytes', () => {
    const tiles = Array.from({ length: 300 }, (_, i) => ({ x: i % SECTOR_SIZE, y: Math.floor(i / SECTOR_SIZE), ground: 1000 + i, items: [], flags: 0 }));
    const sector: Sector = { sx: 3, sy: 4, z: 9, tiles };
    expect(decodeSector(encodeSector(sector))).toEqual(sector);
  });

  it('a paleta encolhe o setor: um id repetido custa um byte por tile', () => {
    const tiles = Array.from({ length: SECTOR_SIZE * SECTOR_SIZE }, (_, i) => ({ x: i % SECTOR_SIZE, y: Math.floor(i / SECTOR_SIZE), ground: 4515, items: [], flags: 0 }));
    // cabeçalho 9 + paleta 2+2 + contagem 2 + 1024 × (cabeça 2 + chão 1 + n 1)
    expect(encodeSector({ sx: 0, sy: 0, z: 7, tiles }).length).toBe(9 + 4 + 2 + 1024 * 4);
  });

  it('recusa tile fora do setor e tile repetido', () => {
    expect(() => encodeSector({ sx: 0, sy: 0, z: 7, tiles: [{ x: 32, y: 0, ground: 1, items: [], flags: 0 }] })).toThrow(SectorError);
    expect(() => encodeSector({ sx: 0, sy: 0, z: 7, tiles: [
      { x: 1, y: 1, ground: 1, items: [], flags: 0 }, { x: 1, y: 1, ground: 2, items: [], flags: 0 },
    ] })).toThrow(/repetido/);
  });

  it('recusa o que não é setor, o truncado e o que sobra', () => {
    expect(() => decodeSector(Uint8Array.from([1, 2, 3, 4]))).toThrow(/DWS1/);
    const bytes = encodeSector({ sx: 0, sy: 0, z: 7, tiles: [{ x: 1, y: 1, ground: 9, items: [], flags: 0 }] });
    expect(() => decodeSector(bytes.subarray(0, bytes.length - 1))).toThrow(/truncado/);
    expect(() => decodeSector(Uint8Array.from([...bytes, 0]))).toThrow(/sobrando/);
  });
});

describe('ajudantes', () => {
  it('sectorOf e sectorPath concordam com o que o importador escreve', () => {
    expect(sectorOf(32369, 32241)).toEqual({ sx: 1011, sy: 1007 });
    expect(sectorPath(7, 1011, 1007)).toBe('7/1011-1007.bin');
  });

  it('stacksOf indexa a pilha por célula', () => {
    const stacks = stacksOf({ sx: 0, sy: 0, z: 7, tiles: [{ x: 3, y: 2, ground: 7, items: [{ id: 8 }], flags: 1 }] });
    expect(stacks.get(2 * SECTOR_SIZE + 3)).toEqual({ ground: 7, items: [{ id: 8 }] });
  });

  it('isWorldIndex reconhece o formato', () => {
    expect(isWorldIndex({ format: 'draconya-world/1', sectorSize: 32, floors: [] })).toBe(true);
    expect(isWorldIndex({ format: 'other', sectorSize: 32, floors: [] })).toBe(false);
    expect(isWorldIndex(null)).toBe(false);
  });
});
