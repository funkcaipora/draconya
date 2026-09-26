import { describe, expect, it } from 'vitest';
import { createLightMap, darknessFor, lightCss } from './world-lights.js';

describe('luz do explorador', () => {
  it('subsolo é escuro; a superfície segue a hora do dia', () => {
    expect(darknessFor(8, 0)).toBeGreaterThan(0.8);
    expect(darknessFor(7, 0)).toBe(0);
    expect(darknessFor(7, 0.5)).toBe(0.5);
    expect(darknessFor(3, 2)).toBe(1);
  });

  it('a cor vem da paleta de 216', () => {
    expect(lightCss(215, 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('o mapa de luz pede o bloco perto da câmera e filtra pelo raio', async () => {
    const asked: string[] = [];
    const map = createLightMap({ format: 'draconya-lights/1', block: 256, floors: [{ z: 11, blocks: [[127, 124]] }] }, async (path) => {
      asked.push(path);
      return [[32649, 31925, 7, 206], [32700, 31925, 3, 215]];
    });
    expect(map.near(32649, 31925, 11, 10)).toEqual([]);
    expect(asked).toEqual(['11/127-124.json']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(map.revision()).toBe(1);
    expect(map.near(32649, 31925, 11, 10)).toEqual([[32649, 31925, 7, 206]]);
  });
});
