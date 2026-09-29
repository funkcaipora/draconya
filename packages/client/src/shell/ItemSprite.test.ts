import { describe, expect, it } from 'vitest';
import { fitInSquare, ITEM_SPRITE_SIZE } from './ItemSprite.js';

describe('fitInSquare (FUN-108)', () => {
  it('um quadro de 32×32 sai 1:1, no canto', () => {
    expect(fitInSquare(32, 32, ITEM_SPRITE_SIZE)).toEqual({ x: 0, y: 0, width: 32, height: 32 });
  });

  it('um quadro de 64×64 (item grande) é reduzido para caber nos 32', () => {
    // Mutação que mata: desenhar no tamanho do quadro (`width: sprite.width`) — o item grande
    // sairia cortado a um quarto, e nenhum item do catálogo atual é grande o bastante para
    // alguém notar na tela.
    expect(fitInSquare(64, 64, ITEM_SPRITE_SIZE)).toEqual({ x: 0, y: 0, width: 32, height: 32 });
  });

  it('um quadro retangular mantém a proporção e fica centrado', () => {
    // 64×32 → 32×16, com 8 px de folga em cima e embaixo. Mutação que mata: escalar cada
    // eixo por conta própria (`size / width` e `size / height` separados) — viraria 32×32.
    expect(fitInSquare(64, 32, ITEM_SPRITE_SIZE)).toEqual({ x: 0, y: 8, width: 32, height: 16 });
    expect(fitInSquare(32, 64, ITEM_SPRITE_SIZE)).toEqual({ x: 8, y: 0, width: 16, height: 32 });
  });

  it('NUNCA amplia: um quadro menor que o slot fica do tamanho que é, centrado', () => {
    // Mutação que mata: tirar o `1` do `Math.min` — 16×16 viraria 32×32 borrado.
    expect(fitInSquare(16, 16, ITEM_SPRITE_SIZE)).toEqual({ x: 8, y: 8, width: 16, height: 16 });
  });

  it('o arredondamento é para BAIXO, e a folga ímpar sobra do lado de baixo/direita', () => {
    // 64×24 → 32×12, folga de 20 → 10 em cima; 64×26 → 32×13, folga de 19 → 9 em cima e 10
    // embaixo. Mutação que mata: `Math.round` ou `Math.ceil` no lugar do `Math.floor` do
    // deslocamento — 9,5 viraria 10 e o quadro andaria um pixel para baixo. É o pixel que
    // faz o ícone parecer desalinhado com o slot vizinho.
    expect(fitInSquare(64, 26, ITEM_SPRITE_SIZE)).toEqual({ x: 0, y: 9, width: 32, height: 13 });
  });
});
