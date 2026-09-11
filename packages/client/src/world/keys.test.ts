import { describe, expect, it } from 'vitest';
import { creatureKey, groundCell, groundKey } from './keys.js';

describe('groundKey (FUN-23)', () => {
  it('x=5 e x=1 num padrão de largura 4 são a MESMA chave', () => {
    // É o que faz um chão de 4×4 gerar dezesseis texturas, e não uma por tile.
    const pattern = { width: 4, height: 4 };
    expect(groundKey(355, 5, 0, pattern)).toBe(groundKey(355, 1, 0, pattern));
    expect(groundKey(355, 0, 7, pattern)).toBe(groundKey(355, 0, 3, pattern));
  });

  it('células diferentes do padrão são chaves diferentes', () => {
    const pattern = { width: 4, height: 4 };
    expect(groundKey(355, 1, 0, pattern)).not.toBe(groundKey(355, 2, 0, pattern));
    expect(groundKey(355, 0, 1, pattern)).not.toBe(groundKey(355, 0, 2, pattern));
    // E a largura é a largura, a altura é a altura: (1, 0) não é (0, 1).
    expect(groundKey(355, 1, 0, pattern)).not.toBe(groundKey(355, 0, 1, pattern));
  });

  it('a largura é a largura e a altura é a altura', () => {
    // Num padrão de 4×2, x=1 e x=3 são quadros diferentes, e y=1 e y=3 são o mesmo. Com os
    // eixos trocados os dois fatos se invertem — e num padrão quadrado ninguém percebe.
    const pattern = { width: 4, height: 2 };
    expect(groundKey(355, 1, 0, pattern)).not.toBe(groundKey(355, 3, 0, pattern));
    expect(groundKey(355, 0, 1, pattern)).toBe(groundKey(355, 0, 3, pattern));
  });

  it('padrão {1, 1} dá UMA chave para qualquer tile', () => {
    const pattern = { width: 1, height: 1 };
    const keys = new Set([
      groundKey(9, 0, 0, pattern), groundKey(9, 17, 3, pattern), groundKey(9, 40, 40, pattern),
    ]);
    expect(keys.size).toBe(1);
  });

  it('o id entra na chave: dois objetos na mesma célula não colidem', () => {
    const pattern = { width: 1, height: 1 };
    expect(groundKey(9, 0, 0, pattern)).not.toBe(groundKey(10, 0, 0, pattern));
  });

  it('a célula nunca é negativa', () => {
    // `%` em JavaScript devolve negativo para negativo, e `-1` seria uma célula que o padrão
    // não tem — o pacote cairia no quadro 0 e a chave diria outra coisa.
    expect(groundCell(-1, -1, { width: 4, height: 2 })).toEqual({ x: 3, y: 1 });
    expect(groundCell(-1, -1, { width: 1, height: 1 })).toEqual({ x: 0, y: 0 });
  });
});

describe('creatureKey (FUN-23)', () => {
  const colors = { head: 78, body: 69, legs: 58, feet: 76 };

  it('com cores e sem cores NÃO colidem', () => {
    expect(creatureKey(128, 'south', false, 0, colors))
      .not.toBe(creatureKey(128, 'south', false, 0));
  });

  it('cores diferentes são chaves diferentes — cada um dos quatro canais', () => {
    // Um canal por vez: variar só os pés deixava passar uma chave que esquecesse a cabeça,
    // o corpo ou as pernas. Mutação que mata: tirar qualquer canal do trecho de cores.
    const keys = new Set([
      creatureKey(128, 'south', false, 0, colors),
      creatureKey(128, 'south', false, 0, { ...colors, head: 0 }),
      creatureKey(128, 'south', false, 0, { ...colors, body: 0 }),
      creatureKey(128, 'south', false, 0, { ...colors, legs: 0 }),
      creatureKey(128, 'south', false, 0, { ...colors, feet: 0 }),
    ]);
    expect(keys.size).toBe(5);
  });

  it('o id do outfit entra na chave', () => {
    // Sem ele toda criatura com a mesma direção e fase dividiria uma textura: um rato e um
    // jogador virando o mesmo desenho. Mutação que mata: tirar `appearanceId` do template.
    expect(creatureKey(128, 'south', false, 0, colors))
      .not.toBe(creatureKey(21, 'south', false, 0, colors));
  });

  it('parado fase 0 e andando fase 0 são chaves diferentes', () => {
    expect(creatureKey(128, 'south', false, 0, colors))
      .not.toBe(creatureKey(128, 'south', true, 0, colors));
  });

  it('direção e fase entram na chave', () => {
    expect(creatureKey(128, 'south', true, 1, colors))
      .not.toBe(creatureKey(128, 'north', true, 1, colors));
    expect(creatureKey(128, 'south', true, 1, colors))
      .not.toBe(creatureKey(128, 'south', true, 2, colors));
  });
});
