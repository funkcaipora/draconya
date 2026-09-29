import { describe, expect, it } from 'vitest';
import type { WorldIndex } from '../packages/client/src/world/sector.js';
import { buildLights, tileLight } from './world-lights.js';

const LIGHTS: Record<number, readonly [number, number]> = { 2920: [7, 206], 3000: [3, 215] };
const lightOf = (id: number): readonly [number, number] | undefined => LIGHTS[id];

describe('tileLight', () => {
  it('a luz do tile é a do objeto mais forte; sem nada que ilumine é null', () => {
    expect(tileLight({ x: 0, y: 0, ground: 1, items: [{ id: 3000 }, { id: 2920 }], flags: 0 }, lightOf)).toEqual([7, 206]);
    expect(tileLight({ x: 0, y: 0, ground: 1, items: [], flags: 0 }, lightOf)).toBeNull();
  });
});

describe('buildLights', () => {
  it('agrupa as fontes por bloco de 256 e andar, com índice', () => {
    const index: WorldIndex = {
      format: 'draconya-world/1', version: '1332', source: { file: 'x', sha256: 'd'.repeat(64) }, sectorSize: 32,
      floors: [{ z: 11, bbox: { x: [32640, 32671], y: [31904, 31935] }, sectors: [[1020, 997]] }],
    };
    const build = buildLights(index, () => [
      { x: 9, y: 21, ground: 1, items: [{ id: 2920 }], flags: 0 },
      { x: 10, y: 21, ground: 1, items: [], flags: 0 },
    ], lightOf);
    expect(build.count).toBe(1);
    expect(JSON.parse(build.files.get('11/127-124.json') as string)).toEqual([[32649, 31925, 7, 206]]);
    expect(build.index.floors).toEqual([{ z: 11, blocks: [[127, 124]] }]);
  });
});
