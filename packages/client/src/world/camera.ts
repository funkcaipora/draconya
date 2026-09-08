// Câmera: que pedaço do mundo cabe na tela, e onde cada tile cai nela (FUN-23).
//
// Matemática pura, sem Pixi. É a parte da renderização que dá para testar sem GPU, e é a
// que erra silenciosamente: um off-by-one aqui aparece como uma faixa de tiles que some na
// borda, que ninguém liga à câmera.

import type { Point } from '../state/world.js';

/** Lado do tile em pixels. Pixel art exige escala inteira — ver `roundPixels` no viewport. */
export const TILE = 32;

/**
 * Campo de visão, em tiles. ~18×14 é também o raio de interesse da rede (FUN-33): o que o
 * servidor manda e o que a tela mostra têm que ser a mesma coisa, senão ou se paga banda por
 * algo invisível, ou aparece um buraco onde deveria ter criatura.
 */
export const VIEW_WIDTH = 18;
export const VIEW_HEIGHT = 14;

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
