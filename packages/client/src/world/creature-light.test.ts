import { describe, expect, it } from 'vitest';
import { TILE } from './camera.js';
import {
  LIGHT_MAX_TILES, LIGHT_RING_ALPHA, LIGHT_RINGS, lightRadiusPx, lightRings, lightTint,
} from './creature-light.js';

describe('a luz que o monstro carrega (#620)', () => {
  it('o alcance é `level` tiles, e o teto protege o desenho de um valor absurdo', () => {
    // O protocolo aceita até 255; os monstros gerados vão de 1 a 6 (o Canary tem um de 10, o Lava Golem).
    expect(lightRadiusPx(1)).toBe(TILE);
    expect(lightRadiusPx(4)).toBe(4 * TILE);
    expect(lightRadiusPx(255)).toBe(LIGHT_MAX_TILES * TILE);
    expect(lightRadiusPx(-3)).toBe(0);
  });

  it('a cor é a da paleta de 216 cores do Tibia: `c = r·36 + g·6 + b`, cada canal em passos de 51', () => {
    // 0 preto, 215 branco, 180 = 5·36 (vermelho puro), 30 = 5·6 (verde puro), 5 (azul puro).
    expect(lightTint(0)).toBe(0x000000);
    expect(lightTint(215)).toBe(0xffffff);
    expect(lightTint(180)).toBe(0xff0000);
    expect(lightTint(30)).toBe(0x00ff00);
    expect(lightTint(5)).toBe(0x0000ff);
    // 208 = 5·36 + 4·6 + 4: a luz alaranjada de fogo que os monstros do Canary declaram.
    expect(lightTint(208)).toBe(0xffcccc);
    // Fora da paleta é preto, e não uma cor inventada.
    expect(lightTint(216)).toBe(0x000000);
  });

  it('o clarão é uma pilha de círculos concêntricos: do menor ao maior raio, o maior é o alcance inteiro', () => {
    const rings = lightRings(4);
    expect(rings).toHaveLength(LIGHT_RINGS);
    const radii = rings.map(([radius]) => radius);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(radii.at(-1)).toBe(4 * TILE);
    expect(radii[0]).toBeCloseTo((4 * TILE) / LIGHT_RINGS);
    for (const [, alpha] of rings) expect(alpha).toBe(LIGHT_RING_ALPHA);
    // Somados no centro, os anéis não passam de um terço da cor — um clarão, não um disco chapado.
    expect(LIGHT_RINGS * LIGHT_RING_ALPHA).toBeLessThan(0.34);
  });
});
