import { describe, expect, it } from 'vitest';
import { areaTiles, directionOf, isSelfOrigin, tileKey } from './area.js';
import type { Direction } from './area.js';

// As formas (#155): tiles exatos por forma e direção. A onda é o que mais importa — o cone
// `1, 3, 3, 5, 5` é a forma do Tibia como fato, e um cone torto acerta o monstro errado.

const origin = { x: 10, y: 10, z: 7 };
const keys = (tiles: ReadonlyArray<{ x: number; y: number; z: number }>): string[] => tiles.map(tileKey);

describe('areaTiles', () => {
  it('wave 5 to the north is 17 tiles widening 1, 3, 3, 5, 5', () => {
    const tiles = areaTiles({ shape: 'wave', length: 5 }, origin, 'north');
    expect(tiles).toHaveLength(1 + 3 + 3 + 5 + 5);
    expect(tiles[0]).toEqual({ x: 10, y: 9, z: 7 });
    expect(keys(tiles.slice(1, 4))).toEqual(['9,8,7', '10,8,7', '11,8,7']);
    expect(keys(tiles.slice(4, 7))).toEqual(['9,7,7', '10,7,7', '11,7,7']);
    expect(keys(tiles.slice(7, 12))).toEqual(['8,6,7', '9,6,7', '10,6,7', '11,6,7', '12,6,7']);
    // Nunca o tile do lançador, nunca atrás dele.
    expect(tiles.every((t) => t.y < origin.y)).toBe(true);
  });

  it('turns with the direction: the same wave east goes right and opens along y', () => {
    const tiles = areaTiles({ shape: 'wave', length: 2 }, origin, 'east');
    expect(keys(tiles)).toEqual(['11,10,7', '12,9,7', '12,10,7', '12,11,7']);
    const west = areaTiles({ shape: 'wave', length: 2 }, origin, 'west');
    expect(keys(west)).toEqual(['9,10,7', '8,9,7', '8,10,7', '8,11,7']);
    const south = areaTiles({ shape: 'wave', length: 2 }, origin, 'south');
    expect(keys(south)).toEqual(['10,11,7', '9,12,7', '10,12,7', '11,12,7']);
  });

  it('cleave is the three tiles in front; beam is a straight line', () => {
    for (const direction of ['north', 'east', 'south', 'west'] as Direction[]) {
      expect(areaTiles({ shape: 'cleave' }, origin, direction)).toHaveLength(3);
      const beam = areaTiles({ shape: 'beam', length: 8 }, origin, direction);
      expect(beam).toHaveLength(8);
      // Uma coordenada fixa, a outra andando: é uma linha.
      const fixed = direction === 'north' || direction === 'south' ? 'x' : 'y';
      expect(new Set(beam.map((t) => t[fixed])).size).toBe(1);
    }
    expect(keys(areaTiles({ shape: 'cleave' }, origin, 'north'))).toEqual(['9,9,7', '10,9,7', '11,9,7']);
    expect(keys(areaTiles({ shape: 'beam', length: 3 }, origin, 'south'))).toEqual(['10,11,7', '10,12,7', '10,13,7']);
  });

  it('circle: radius 1 is the full 3x3 (9 tiles); radius 3 clips the corners to 37', () => {
    const around = areaTiles({ shape: 'circle', radius: 1, centered: 'caster' }, origin, 'north');
    expect(around).toHaveLength(9);
    expect(keys(around)).toContain('10,10,7');
    const onTarget = areaTiles({ shape: 'circle', radius: 3, centered: 'target' }, origin, 'north', { x: 20, y: 20, z: 7 });
    expect(onTarget).toHaveLength(37);
    // Linhas 3/5/7/7/7/5/3 — o recorte de Manhattan reproduz a `AREA_CIRCLE3X3` (ADR 0019).
    const rows = new Map<number, number>();
    for (const tile of onTarget) rows.set(tile.y, (rows.get(tile.y) ?? 0) + 1);
    expect([...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count))
      .toEqual([3, 5, 7, 7, 7, 5, 3]);
    // O canto (x+3, y+3) NÃO pertence à área; a borda cardinal (x+3, y) pertence.
    expect(keys(onTarget)).not.toContain('23,23,7');
    expect(keys(onTarget)).toContain('23,20,7');
    // Sem alvo, o círculo no alvo cai no lançador em vez de em lugar nenhum.
    expect(areaTiles({ shape: 'circle', radius: 1, centered: 'target' }, origin, 'north')[4]).toEqual(origin);
  });

  it('circle: radius 2 uses the same Manhattan clip (21 tiles)', () => {
    expect(areaTiles({ shape: 'circle', radius: 2, centered: 'caster' }, origin, 'north'))
      .toHaveLength(21);
  });

  it('cross: radius 1 is the five cardinal tiles; radius 2 extends each axis', () => {
    const cross = areaTiles({ shape: 'cross', radius: 1 }, origin, 'north', { x: 20, y: 20, z: 7 });
    expect(keys(cross)).toEqual(['20,20,7', '21,20,7', '19,20,7', '20,21,7', '20,19,7']);
    const wider = areaTiles({ shape: 'cross', radius: 2 }, origin, 'north', { x: 20, y: 20, z: 7 });
    expect(wider).toHaveLength(9);
    // Sem alvo, a cruz cai no lançador em vez de em lugar nenhum.
    expect(areaTiles({ shape: 'cross', radius: 1 }, origin, 'north')[0]).toEqual(origin);
  });

  it('knows which shapes leave the caster without a target', () => {
    expect(isSelfOrigin(undefined)).toBe(false);
    expect(isSelfOrigin({ shape: 'circle', radius: 1, centered: 'target' })).toBe(false);
    expect(isSelfOrigin({ shape: 'circle', radius: 1, centered: 'caster' })).toBe(true);
    expect(isSelfOrigin({ shape: 'cross', radius: 1 })).toBe(false);
    expect(isSelfOrigin({ shape: 'wave', length: 3 })).toBe(true);
    expect(isSelfOrigin({ shape: 'cleave' })).toBe(true);
    expect(isSelfOrigin({ shape: 'beam', length: 5 })).toBe(true);
  });
});

describe('directionOf', () => {
  it('follows the step, and the horizontal component wins on a diagonal (DT-05)', () => {
    expect(directionOf(origin, { x: 10, y: 9, z: 7 })).toBe('north');
    expect(directionOf(origin, { x: 10, y: 11, z: 7 })).toBe('south');
    expect(directionOf(origin, { x: 11, y: 10, z: 7 })).toBe('east');
    expect(directionOf(origin, { x: 9, y: 10, z: 7 })).toBe('west');
    expect(directionOf(origin, { x: 11, y: 9, z: 7 })).toBe('east');
    expect(directionOf(origin, { x: 9, y: 11, z: 7 })).toBe('west');
    // Sem passo, sem direção: quem chama mantém a que tinha.
    expect(directionOf(origin, origin)).toBeNull();
  });
});
