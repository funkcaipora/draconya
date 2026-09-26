import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Sector, WorldIndex } from '../packages/client/src/world/sector.js';
import { crc32, encodePng } from './png.js';
import { buildMinimap, formatMinimapIndex } from './world-minimap.js';

/** Os pixels RGBA de um PNG sem filtro, como `encodePng` escreve. */
function pixelsOf(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const idat = png.indexOf('IDAT');
  const length = png.readUInt32BE(idat - 4);
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + length));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  return { width, height, rgba };
}

describe('encodePng', () => {
  it('escreve assinatura, IHDR RGBA e pixels que voltam iguais', () => {
    const rgba = Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255, 1, 2, 3, 4]);
    const png = encodePng(2, 2, rgba);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png[25]).toBe(6);
    expect(pixelsOf(png).rgba).toEqual(rgba);
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
});

describe('buildMinimap', () => {
  const index: WorldIndex = {
    format: 'draconya-world/1', version: '1332', source: { file: 'x', sha256: 'c'.repeat(64) }, sectorSize: 32,
    floors: [{ z: 7, bbox: { x: [256, 287], y: [0, 31] }, sectors: [[8, 0]] }],
  };
  const sector: Sector = { sx: 8, sy: 0, z: 7, tiles: [
    { x: 0, y: 0, ground: 10, items: [], flags: 0 },
    { x: 1, y: 0, ground: 10, items: [{ id: 20 }], flags: 0 },
    { x: 2, y: 0, ground: 99, items: [], flags: 0 },
  ] };
  const colors: Record<number, number> = { 10: 24, 20: 129 };
  const build = buildMinimap(index, () => sector, (id) => colors[id]);

  it('pinta o nível 0 com a cor do item mais alto, e sem cor fica transparente', () => {
    const { rgba } = pixelsOf(build.files.get('0/7/1-0.png') as Buffer);
    expect([...rgba.subarray(0, 4)]).toEqual([0, 204, 0, 255]);
    expect([...rgba.subarray(4, 8)]).toEqual([153, 153, 153, 255]);
    expect(rgba[11]).toBe(0);
  });

  it('cada nível junta 2×2 no bloco-pai, pelo primeiro pixel com cor', () => {
    const { rgba } = pixelsOf(build.files.get('1/7/0-0.png') as Buffer);
    // O bloco 1 do nível 0 é o quadrante direito do bloco 0 do nível 1: x 128.
    expect([...rgba.subarray(128 * 4, 128 * 4 + 4)]).toEqual([0, 204, 0, 255]);
    expect(build.index.levels).toHaveLength(6);
    expect(build.index.levels[0]).toEqual([{ z: 7, blocks: [[1, 0]] }]);
    expect(build.index.levels[5]).toEqual([{ z: 7, blocks: [[0, 0]] }]);
  });

  it('o índice formatado é determinístico', () => {
    expect(formatMinimapIndex(build.index)).toBe(formatMinimapIndex(buildMinimap(index, () => sector, (id) => colors[id]).index));
  });
});
