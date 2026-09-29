// As chaves do `TextureBook`, e o que entra nelas (FUN-23).
//
// Puro, como `camera.ts`: é aritmética de string, e o defeito que ela evita é silencioso —
// uma chave errada não quebra nada, só faz o cache guardar uma textura por tile em vez de uma
// por célula do padrão, e a tela continua certa enquanto a memória de GPU sobe.

import { missileCell, type Direction } from '../assets/pack.js';
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
  return objectKey(appearanceId, groundCell(x, y, pattern));
}

/**
 * A mesma chave, pela CÉLULA já resolvida (FUN-121): a pilha de um tile escolhe a célula por
 * posição, por contagem ou pelo gancho da parede (`tile-stack.ts`), e o livro não precisa saber
 * qual das três foi.
 */
export function objectKey(appearanceId: number, cell: { readonly x: number; readonly y: number }): string {
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

/**
 * A chave de textura de um quadro de EFEITO (FUN-106): o id e a fase. Um efeito de dez fases
 * são dez texturas, compartilhadas por todo tile em que ele toca.
 */
export function effectKey(effectId: number, phase: number): string {
  return `effect:${effectId}:${phase}`;
}

/**
 * As chaves de TODAS as fases de um efeito, da 0 à última, para o viewport pedi-las ao livro de
 * uma vez quando o efeito nasce (FUN-106). `phaseCount` é o tamanho de `AssetPack.effectPhases`.
 *
 * É a regra do "prefetch", em números: uma fase real tem 40 ms — dois quadros a 60 Hz — e
 * pedida só no quadro em que chega, cada uma passava o primeiro quadro sem textura, e o efeito
 * inteiro piscava fase a fase na primeira vez que tocava. Pedidas todas ao nascer, a fase 1 já
 * está no livro quando a 0 acaba. O índice de cada chave É a fase: quem itera sabe o que pedir.
 */
export function effectKeysOf(effectId: number, phaseCount: number): string[] {
  const keys: string[] = [];
  for (let phase = 0; phase < phaseCount; phase++) keys.push(effectKey(effectId, phase));
  return keys;
}

/**
 * A chave de textura de um PROJÉTIL voando de `dx`, `dy` (FUN-106).
 *
 * **Pela CÉLULA do padrão, não pelo delta** — a mesma razão de `groundKey`: um tiro de três
 * tiles e um de um tile na mesma direção são o mesmo quadro, e dar a cada delta sua chave
 * pediria o mesmo bitmap ao pacote uma vez por distância de tiro. A célula é por OCTANTE
 * (`missileCell`): `(3, 1)` e `(1, 0)` são o mesmo quadro de leste.
 */
export function missileKey(missileId: number, dx: number, dy: number): string {
  const cell = missileCell(dx, dy);
  return `missile:${missileId}:${cell.x}:${cell.y}`;
}

function modulo(value: number, size: number): number {
  if (size <= 1) return 0;
  return ((value % size) + size) % size;
}
