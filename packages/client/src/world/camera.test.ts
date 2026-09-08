import { describe, expect, it } from 'vitest';
import { cameraOrigin, compareDrawOrder, toScreen, visibleTiles, TILE } from './camera.js';

const view = { widthTiles: 18, heightTiles: 14 };
const at = (x: number, y: number) => ({ x, y, z: 7 });

describe('camera', () => {
  it('centres the target on screen', () => {
    const screen = toScreen(at(10, 10), at(10, 10), view);
    expect(screen).toEqual({ x: ((18 - 1) / 2) * TILE, y: ((14 - 1) / 2) * TILE });
  });

  it('follows a fractional position instead of snapping to whole tiles', () => {
    // O alvo se move em posição fracionária durante a interpolação. Travar a câmera em tile
    // inteiro faria a tela andar aos solavancos enquanto o personagem desliza.
    const a = cameraOrigin(at(10, 10), view);
    const b = cameraOrigin({ x: 10.5, y: 10, z: 7 }, view);
    expect(b.x - a.x).toBeCloseTo(0.5);
  });

  it('keeps a margin of one tile so the entering column is already drawn', () => {
    const window = visibleTiles(at(10, 10), view);
    const origin = cameraOrigin(at(10, 10), view);
    expect(window.minX).toBeLessThan(origin.x);
    expect(window.maxX).toBeGreaterThan(origin.x + view.widthTiles);
  });

  it('orders by y, then by x', () => {
    // O desempate por `x` é o que torna a ordem estável: sem ele, duas criaturas no mesmo
    // `y` trocam de ordem entre quadros e piscam uma na frente da outra.
    const creatures = [
      { x: 5, y: 3 }, { x: 1, y: 3 }, { x: 9, y: 1 },
    ].sort(compareDrawOrder);
    expect(creatures).toEqual([{ x: 9, y: 1 }, { x: 1, y: 3 }, { x: 5, y: 3 }]);
  });
});
