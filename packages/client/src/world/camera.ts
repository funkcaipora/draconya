// Câmera: que pedaço do mundo cabe na tela, e onde cada tile cai nela (FUN-23).
//
// Matemática pura, sem Pixi. É a parte da renderização que dá para testar sem GPU, e é a
// que erra silenciosamente: um off-by-one aqui aparece como uma faixa de tiles que some na
// borda, que ninguém liga à câmera.

import type { Point } from '../state/world.js';

/** Lado do tile em pixels. Pixel art exige escala inteira — ver `roundPixels` no viewport. */
export const TILE = 32;

/**
 * Raio de INTERESSE da rede (FUN-33), em tiles. O servidor só manda criaturas dentro desta
 * janela em torno do personagem; a CÂMERA não é mais limitada por ela. Desde #415 o canvas
 * inteiro é desenhado — fora do interesse aparece chão sem criatura, como no Tibia —, e o
 * teto de 18×14 vale só para o que chega pelo fio. Ver `viewFor`.
 */
export const VIEW_WIDTH = 18;
export const VIEW_HEIGHT = 14;

/**
 * O zoom inteiro do mundo para uma tela (FUN-115). Pixel art só escala em inteiro — 1,5×
 * borra —, e o Huntera, que é a referência visual, desenha o tile a 64 px numa tela comum:
 * é o que faz o rato ter tamanho de rato, e não de formiga num canvas pequeno no meio da
 * tela. Dois a partir de 560 px de altura (nove tiles inteiros), três a partir de 1 400.
 */
export function zoomFor(widthPx: number, heightPx: number): number {
  const shorter = Math.min(widthPx, heightPx);
  if (shorter >= 1_400) return 3;
  if (shorter >= 560) return 2;
  return 1;
}

/**
 * Quantos tiles cabem numa tela, num zoom. FRACIONÁRIO de propósito: a câmera centra o alvo
 * exatamente no meio do canvas, seja qual for a largura, e `visibleTiles` já pinta a margem.
 *
 * **Sem teto (#415):** o mundo ocupa o canvas INTEIRO, e o que a tela desenha é o tamanho real
 * dela. O teto de `VIEW_WIDTH × VIEW_HEIGHT` é do raio de interesse da rede, não da câmera —
 * limitar aqui deixava o alvo à esquerda do centro e uma faixa preta onde o canvas não era
 * pintado. Fora do interesse aparece chão sem criatura, que é o que o Tibia faz.
 */
export function viewFor(widthPx: number, heightPx: number, zoom: number): Viewport {
  return {
    widthTiles: widthPx / (TILE * zoom),
    heightTiles: heightPx / (TILE * zoom),
  };
}

export interface Viewport {
  readonly widthTiles: number;
  readonly heightTiles: number;
}

export interface TileWindow {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Canto superior esquerdo da câmera, em tiles fracionários, centrada no alvo.
 *
 * Sem arredondar: o alvo se move em posição fracionária durante a interpolação, e travar a
 * câmera em tile inteiro faria a tela andar aos solavancos enquanto o personagem desliza.
 */
export function cameraOrigin(target: Point, view: Viewport): { x: number; y: number } {
  return {
    x: target.x - (view.widthTiles - 1) / 2,
    y: target.y - (view.heightTiles - 1) / 2,
  };
}

/**
 * Faixa de tiles que precisa ser desenhada. Uma tile de margem de cada lado, porque a câmera
 * fica entre tiles: sem a margem, a coluna que está entrando pela borda só aparece quando já
 * deveria estar inteira na tela.
 */
export function visibleTiles(target: Point, view: Viewport): TileWindow {
  const origin = cameraOrigin(target, view);
  return {
    minX: Math.floor(origin.x) - 1,
    minY: Math.floor(origin.y) - 1,
    maxX: Math.ceil(origin.x + view.widthTiles) + 1,
    maxY: Math.ceil(origin.y + view.heightTiles) + 1,
  };
}

/** De coordenada de mundo (tiles, possivelmente fracionária) para pixel na tela. */
export function toScreen(
  position: { x: number; y: number },
  target: Point,
  view: Viewport,
): { x: number; y: number } {
  const origin = cameraOrigin(target, view);
  return {
    x: (position.x - origin.x) * TILE,
    y: (position.y - origin.y) * TILE,
  };
}

/**
 * De pixel do canvas para coordenada de mundo (tiles, fracionária) — o inverso de `toScreen`.
 *
 * O ponto entra em pixels de TILE (o mesmo espaço de `toScreen`); quem tem pixels do cliente
 * divide pelo zoom do stage antes de chamar (ver `creatureAt` no viewport).
 */
export function fromScreen(
  point: { x: number; y: number },
  target: Point,
  view: Viewport,
): { x: number; y: number } {
  const origin = cameraOrigin(target, view);
  return {
    x: point.x / TILE + origin.x,
    y: point.y / TILE + origin.y,
  };
}

/**
 * O tile inteiro sob um pixel de tela — a inversa de `toScreen` quantizada.
 *
 * `toScreen` desenha o tile `tx` em `[(tx − origem)·TILE, (tx − origem + 1)·TILE)`, um intervalo
 * semiaberto: o inverso de um pixel dentro dele é o PISO, não o arredondamento. Com `round`, a
 * metade direita/inferior de cada sprite cai no tile seguinte e o clique erra a criatura.
 */
export function tileAtScreen(
  point: { x: number; y: number },
  target: Point,
  view: Viewport,
): { x: number; y: number } {
  const at = fromScreen(point, target, view);
  return { x: Math.floor(at.x), y: Math.floor(at.y) };
}

/**
 * Ordem de desenho de criaturas: quem está mais ao sul cobre quem está ao norte, e o desempate
 * é por `x` para a ordem ser estável. Sem desempate, duas criaturas no mesmo `y` trocam de
 * ordem entre quadros e piscam uma na frente da outra.
 */
export function compareDrawOrder(
  a: { readonly y: number; readonly x: number },
  b: { readonly y: number; readonly x: number },
): number {
  return a.y - b.y || a.x - b.x;
}
