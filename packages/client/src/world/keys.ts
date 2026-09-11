// As chaves do `TextureBook`, e o que entra nelas (FUN-23).
//
// Puro, como `camera.ts`: é aritmética de string, e o defeito que ela evita é silencioso —
// uma chave errada não quebra nada, só faz o cache guardar uma textura por tile em vez de uma
// por célula do padrão, e a tela continua certa enquanto a memória de GPU sobe.

import type { Direction } from '../assets/pack.js';
import type { OutfitColors } from '../assets/outfit.js';

/** As dimensões do padrão de um objeto, como `AssetPack.objectPattern` devolve. */
export interface Pattern {
  readonly width: number;
  readonly height: number;
}

/**
 * Em que célula do padrão um tile cai.
 *
 * É o `x % largura, y % altura` do cliente do Tibia, com o resto sempre NÃO negativo: `%`
 * em JavaScript devolve negativo para negativo, e uma chave com `-1` seria uma célula que o
 * padrão não tem. Padrão de 1 cai sempre na célula (0, 0), que é o objeto sem padrão.
 */
export function groundCell(x: number, y: number, pattern: Pattern): { x: number; y: number } {
  return { x: modulo(x, pattern.width), y: modulo(y, pattern.height) };
}

/**
 * A chave de textura de um objeto do mapa num tile.
 *
 * **Por célula do padrão, não por tile.** Um chão de 4×4 tem dezesseis quadros, e é isso que
 * a chave precisa distinguir: (5, 0) e (1, 0) são o MESMO quadro num padrão de largura 4, e
 * dar a cada um sua chave pediria o mesmo bitmap ao pacote uma vez por tile — mil e
 * seiscentas texturas num mapa de 40×40 onde cabem dezesseis.
 */
export function groundKey(appearanceId: number, x: number, y: number, pattern: Pattern): string {
  const cell = groundCell(x, y, pattern);
  return `object:${appearanceId}:${cell.x}:${cell.y}`;
}

/**
 * A chave de textura de um quadro de criatura.
 *
 * As cores entram na chave: o mesmo outfit com cores diferentes são bitmaps diferentes, e o
 * quadro pintado não pode reaproveitar a entrada do quadro cru. Sem cores, um marcador fixo —
 * é a entrada de monstro, que não tem cor de jogador.
 */
export function creatureKey(
  appearanceId: number, direction: Direction, moving: boolean, phase: number,
  colors?: OutfitColors,
): string {
  const paint = colors === undefined
    ? '-'
    : `${colors.head},${colors.body},${colors.legs},${colors.feet}`;
  return `outfit:${appearanceId}:${direction}:${moving ? 'w' : 's'}:${phase}:${paint}`;
}

function modulo(value: number, size: number): number {
  if (size <= 1) return 0;
  return ((value % size) + size) % size;
}
