import { describe, expect, it } from 'vitest';
import { VEIL_PER_FLOOR, floorsBelow, shade, veilTint } from './floors.js';

describe('floorsBelow (FUN-121)', () => {
  const thais = [4, 5, 6, 7];

  it('na superfície, do andar do jogador até o 7, o mais fundo primeiro', () => {
    expect(floorsBelow(thais, 7)).toEqual([7]);
    expect(floorsBelow(thais, 6)).toEqual([7, 6]);
    expect(floorsBelow(thais, 4)).toEqual([7, 6, 5, 4]);
  });

  it('nunca um andar ACIMA do jogador: não há telhado', () => {
    expect(floorsBelow(thais, 6)).not.toContain(5);
    expect(floorsBelow(thais, 7)).not.toContain(6);
  });

  it('no subsolo, só o andar do jogador — o bueiro não mostra a rua', () => {
    expect(floorsBelow([8], 8)).toEqual([8]);
    expect(floorsBelow([7, 8, 9], 8)).toEqual([8]);
    expect(floorsBelow([7, 8, 9], 9)).toEqual([9]);
  });

  it('andar que a cena não tem simplesmente não entra', () => {
    expect(floorsBelow([7], 5)).toEqual([7]);
    expect(floorsBelow([4, 5], 7)).toEqual([]);
  });
});

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
