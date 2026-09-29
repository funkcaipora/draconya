import { describe, expect, it } from 'vitest';
import { VEIL_PER_FLOOR, shade, veilTint } from './floors.js';

describe('veilTint e shade (FUN-121)', () => {
  it('o andar do jogador não tem véu; cada nível abaixo escurece em progressão geométrica', () => {
    expect(veilTint(0)).toBe(0xffffff);
    const grey = Math.round(255 * VEIL_PER_FLOOR);
    expect(veilTint(1)).toBe((grey << 16) | (grey << 8) | grey);
    expect(veilTint(2)).toBeLessThan(veilTint(1));
    expect(veilTint(3)).toBeLessThan(veilTint(2));
  });

  it('shade escurece canal a canal, e não mexe em quem está no andar do jogador', () => {
    expect(shade(0x2b2b33, 0)).toBe(0x2b2b33);
    expect(shade(0xff0000, 1)).toBe(Math.round(255 * VEIL_PER_FLOOR) << 16);
    expect(shade(0x2b2b33, 1)).toBe((Math.round(0x2b * VEIL_PER_FLOOR) << 16)
      | (Math.round(0x2b * VEIL_PER_FLOOR) << 8) | Math.round(0x33 * VEIL_PER_FLOOR));
  });
});
