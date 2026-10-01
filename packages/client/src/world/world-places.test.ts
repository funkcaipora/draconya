import { describe, expect, it } from 'vitest';
import { indexLinks } from './world-places.js';

describe('indexLinks', () => {
  const index = indexLinks({
    format: 'draconya-links/1',
    links: [
      [[10, 10, 7], [10, 11, 8], 'stairs'],
      [[10, 10, 7], [50, 50, 7], 'teleport'],
      [[20, 20, 7], [20, 21, 6], 'ladder'],
      [[20, 20, 8], [20, 21, 7], 'rope'],
    ],
    doors: [[5, 5, 7, 1234]],
  });

  it('acha a ligação pela origem; no mesmo tile, a primeira vence', () => {
    expect(index.from(10, 10, 7)).toEqual({ to: [10, 11, 8], kind: 'stairs' });
    expect(index.from(1, 1, 7)).toBeNull();
  });

  it('lista as ligações de um andar dentro da janela', () => {
    expect(index.within(7, { minX: 15, minY: 15, maxX: 25, maxY: 25 })).toEqual([[[20, 20, 7], [20, 21, 6], 'ladder']]);
    expect(index.within(8, { minX: 0, minY: 0, maxX: 100, maxY: 100 })).toHaveLength(1);
  });

  it('sabe onde há porta', () => {
    expect(index.doorAt(5, 5, 7)).toBe(true);
    expect(index.doorAt(5, 5, 8)).toBe(false);
  });
});
