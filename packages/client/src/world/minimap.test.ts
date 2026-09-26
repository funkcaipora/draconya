import { describe, expect, it } from 'vitest';
import {
  atlasToTile, atlasWindow, blocksCovering, isMinimapIndex, minimapPath, tibiaRgb, tileAutomapColor,
  tilesPerBlock, tileToAtlas,
} from './minimap.js';

describe('paleta e cor do tile', () => {
  it('tibiaRgb decompõe r·36 + g·6 + b em passos de 51', () => {
    expect(tibiaRgb(0)).toEqual([0, 0, 0]);
    expect(tibiaRgb(24)).toEqual([0, 204, 0]);
    expect(tibiaRgb(215)).toEqual([255, 255, 255]);
    expect(tibiaRgb(216)).toEqual([0, 0, 0]);
  });

  it('a cor do tile é a do item mais alto com cor, senão a do chão, senão 0', () => {
    const colors: Record<number, number> = { 1: 24, 2: 129, 3: 0 };
    const colorOf = (id: number): number | undefined => colors[id];
    expect(tileAutomapColor(1, [{ id: 2 }, { id: 3 }, { id: 99 }], colorOf)).toBe(129);
    expect(tileAutomapColor(1, [{ id: 3 }], colorOf)).toBe(24);
    expect(tileAutomapColor(0, [{ id: 99 }], colorOf)).toBe(0);
  });
});

describe('blocos e níveis', () => {
  it('um bloco cobre 256·2^nível tiles, e o caminho é nível/andar/bx-by', () => {
    expect(tilesPerBlock(0)).toBe(256);
    expect(tilesPerBlock(5)).toBe(8192);
    expect(minimapPath(2, 7, 31, 31)).toBe('2/7/31-31.png');
  });

  it('blocksCovering lista os blocos da janela', () => {
    expect(blocksCovering(0, { minX: 250, minY: 0, maxX: 260, maxY: 10 })).toEqual([[0, 0], [1, 0]]);
    expect(blocksCovering(1, { minX: 32000, minY: 32000, maxX: 32100, maxY: 32100 })).toEqual([[62, 62]]);
  });

  it('isMinimapIndex reconhece o formato', () => {
    expect(isMinimapIndex({ format: 'draconya-minimap/1', block: 256, levels: [] })).toBe(true);
    expect(isMinimapIndex({ format: 'x', block: 256, levels: [] })).toBe(false);
  });
});

describe('vista do mapa-múndi', () => {
  const view = { cx: 32000, cy: 32000, level: 2, scale: 2 };
  it('centro da tela é o centro da vista, e ida e volta fecha', () => {
    expect(atlasToTile(view, 800, 600, 400, 300)).toEqual({ x: 32000, y: 32000 });
    // nível 2 a 2× → 2 tiles por pixel de tela
    expect(atlasToTile(view, 800, 600, 410, 300)).toEqual({ x: 32020, y: 32000 });
    expect(tileToAtlas(view, 800, 600, 32020, 31980)).toEqual({ px: 410, py: 290 });
  });

  it('a janela cobre a tela inteira', () => {
    expect(atlasWindow(view, 800, 600)).toEqual({ minX: 31200, minY: 31400, maxX: 32800, maxY: 32600 });
  });
});
