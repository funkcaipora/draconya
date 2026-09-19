import { describe, expect, it } from 'vitest';
import {
  CREATURE_SLOT, ROW_MULTIPLIER, SLOTS_PER_TILE, sceneZIndex, spatialOrder,
} from './depth.js';

const sign = (n: number): number => Math.sign(n);

describe('depth (ADR 0033)', () => {
  it('sul > norte: quem está mais ao sul é desenhado depois', () => {
    for (const x of [0, 1, 5, 42, 999]) {
      for (const y of [0, 1, 5, 42]) {
        expect(spatialOrder(x, y + 1)).toBeGreaterThan(spatialOrder(x, y));
      }
    }
  });

  it('mesmo y, leste > oeste: duas criaturas na mesma linha não empatam', () => {
    for (const x of [0, 1, 5, 42, 999]) {
      for (const y of [0, 1, 5, 42]) {
        expect(spatialOrder(x + 1, y)).toBeGreaterThan(spatialOrder(x, y));
      }
    }
  });

  it('nordeste depois de sudoeste: o par NE/SW que a fórmula por linha erra', () => {
    // `y * ROW_MULTIPLIER + x` daria ao NE `(x + 1, y - 1)` um valor MENOR que o do tile atual —
    // e a parede a sudoeste de um dragão cobriria a metade esquerda dele. O teste prende o sinal.
    for (const x of [0, 1, 5, 42]) {
      for (const y of [1, 5, 42]) {
        expect(spatialOrder(x + 1, y - 1)).toBeGreaterThan(spatialOrder(x, y));
      }
    }
  });

  it('itens do tile antes da criatura, e a criatura antes do tile seguinte', () => {
    for (let k = 0; k < CREATURE_SLOT; k++) {
      expect(sceneZIndex(5, 5, k)).toBeLessThan(sceneZIndex(5, 5, CREATURE_SLOT));
    }
    expect(sceneZIndex(5, 5, CREATURE_SLOT)).toBeLessThan(sceneZIndex(5, 6, 0));
  });

  it('slot preso a [0, 63]: um tile lotado não empurra a criatura para baixo dos itens', () => {
    expect(sceneZIndex(5, 5, -5)).toBe(sceneZIndex(5, 5, 0));
    expect(sceneZIndex(5, 5, 500)).toBe(sceneZIndex(5, 5, 63));
    expect(sceneZIndex(5, 5, 1.9)).toBe(sceneZIndex(5, 5, 1));
  });

  it('a diagonal do OTClient e `spatialOrder` concordam em todo par de vizinhos', () => {
    const SIZE = 5;
    const order = otclientOrder(SIZE);
    const directions = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ] as const;
    let checked = 0;
    for (const [key, index] of order) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        const neighbourIndex = order.get(`${nx},${ny}`);
        if (neighbourIndex === undefined) continue;
        expect(sign(index - neighbourIndex)).toBe(sign(spatialOrder(x, y) - spatialOrder(nx, ny)));
        checked += 1;
      }
    }
    // 5×5 tem 144 pares DIRIGIDOS de vizinhos nas 8 direções (20 por direção ortogonal ×4 +
    // 16 por diagonal ×4); cada um é comparado uma vez.
    expect(checked).toBe(144);
  });

  it('constantes: 10 000 por diagonal, 64 slots, criatura no 63', () => {
    expect(ROW_MULTIPLIER).toBe(10_000);
    expect(SLOTS_PER_TILE).toBe(64);
    expect(CREATURE_SLOT).toBe(63);
  });
});

/**
 * A ordem do `MapView` do OTClient: anti-diagonais `x + y` crescentes e, dentro de cada uma, do
 * sudoeste ao nordeste (`y` decrescente, `x` crescente). O mapa é `size × size`.
 */
function otclientOrder(size: number): Map<string, number> {
  const order = new Map<string, number>();
  let index = 0;
  for (let d = 0; d <= 2 * (size - 1); d++) {
    const lowestY = Math.max(0, d - (size - 1));
    const highestY = Math.min(size - 1, d);
    for (let y = highestY; y >= lowestY; y--) {
      order.set(`${d - y},${y}`, index);
      index += 1;
    }
  }
  return order;
}
