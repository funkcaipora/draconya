// A pilha de um tile, na ordem em que o Tibia a desenha (FUN-121).
//
// Puro: recebe a pilha (ids e contagens) e as flags de cada aparência, e devolve a lista de
// quadros a desenhar — id, célula do padrão, deslocamento em pixels e camada. Nenhum Pixi
// aqui; é o que permite testar a ordem, a elevação e os padrões com números, sem tela.
//
// As regras são as do cliente do Tibia, lidas no OTClient (MIT — `tile.cpp`, `item.cpp`;
// relatório na FUN-116; nada copiado):
//
// 1. ORDEM: chão (`bank`) → bordas (`clip`) → `bottom` (paredes, portas fechadas) → itens
//    comuns na ordem da pilha, o mais antigo primeiro → criaturas → `top` (arcos, portas
//    abertas), que fica ACIMA das criaturas.
// 2. ELEVAÇÃO: cada item desenhado soma `height.elevation` a um deslocamento acumulado, com
//    teto de 24 px (`MAX_ELEVATION`); o que vem depois — itens e criaturas — sobe para cima e
//    para a esquerda por esse tanto. `top` ignora a elevação: o arco não sobe com a caixa.
// 3. SHIFT: `shift.{x,y}` do próprio item o desloca para cima e para a esquerda, em pixels.
// 4. PADRÃO: chão e itens pela célula `(x % largura, y % altura)` (`groundCell`); empilhável
//    COM contagem pela tabela de contagem (`countCell`); pendurável (`hang`) pela parede do
//    mesmo tile — `hookSouth` escolhe a coluna 1, `hookEast` a coluna 2, quando o padrão tem.
// 5. ÂNCORA: o quadro é ancorado no canto INFERIOR DIREITO do tile e transborda para cima e
//    para a esquerda; `dx`/`dy` aqui são o deslocamento adicional, sempre ≤ 0.

import type { AppearanceFlags } from '../assets/appearances.js';
import { groundCell, type Pattern } from './keys.js';
import type { StackedItem, TileStack } from './scene.js';

/** O teto da elevação acumulada num tile, em pixels — o do cliente do Tibia. */
export const MAX_ELEVATION = 24;

export type DrawLayer = 'ground' | 'top';

/** Um quadro a desenhar: qual objeto, em que célula do padrão, deslocado quanto, em que camada. */
export interface DrawnObject {
  readonly appearanceId: number;
  readonly cell: { readonly x: number; readonly y: number };
  /** Deslocamento em pixels a partir da âncora do tile, para a ESQUERDA (`dx`) e para CIMA (`dy`). */
  readonly dx: number;
  readonly dy: number;
  readonly layer: DrawLayer;
}

export interface DrawnTile {
  readonly objects: readonly DrawnObject[];
  /** Quanto uma criatura neste tile sobe, em pixels: a elevação acumulada pelos itens. */
  readonly creatureElevation: number;
  /** Alguém que anda vê parede aqui? — `unpass` no chão ou em qualquer item. */
  readonly blocked: boolean;
}

/** O que o pintor precisa saber de cada aparência: as flags e as dimensões do padrão. */
export interface ObjectInfo {
  flagsOf(appearanceId: number): AppearanceFlags;
  patternOf(appearanceId: number): Pattern;
}

/**
 * A célula de um empilhável pela CONTAGEM, no padrão de `4×2` do Tibia: 1, 2, 3 e 4 moedas
 * são as quatro células da primeira linha; a partir de 5, 10, 25 e 50 as da segunda. Padrão
 * menor que isso cai na célula que existir — o `%` de sempre — e sem contagem é a célula 0.
 */
export function countCell(count: number | undefined, pattern: Pattern): { x: number; y: number } {
  if (count === undefined || count <= 1) return { x: 0, y: 0 };
  let index: number;
  if (count < 5) index = count - 1;
  else if (count < 10) index = 4;
  else if (count < 25) index = 5;
  else if (count < 50) index = 6;
  else index = 7;
  return { x: index % pattern.width, y: Math.floor(index / pattern.width) % pattern.height };
}

/** A célula de um pendurável pela parede do MESMO tile: sul → coluna 1, leste → coluna 2. */
function hangCell(hooks: { south: boolean; east: boolean }, pattern: Pattern): { x: number; y: number } {
  if (hooks.south) return { x: pattern.width >= 2 ? 1 : 0, y: 0 };
  if (hooks.east) return { x: pattern.width >= 3 ? 2 : 0, y: 0 };
  return { x: 0, y: 0 };
}

/**
 * A pilha de um tile em `(x, y)`, pronta para desenhar. `x` e `y` só entram na célula do padrão
 * — a posição na tela é de quem chama.
 */
export function drawTile(tile: TileStack, x: number, y: number, info: ObjectInfo): DrawnTile {
  const objects: DrawnObject[] = [];
  let elevation = 0;
  let blocked = false;
  const hooks = { south: false, east: false };
  for (const item of tile.items) {
    const flags = info.flagsOf(item.id);
    if ((flags.hookSouth ?? 0) > 0) hooks.south = true;
    if ((flags.hookEast ?? 0) > 0) hooks.east = true;
  }

  const place = (item: StackedItem, flags: AppearanceFlags, layer: DrawLayer): void => {
    const pattern = info.patternOf(item.id);
    // Empilhável é o que veio COM contagem do arquivo: a célula é da contagem, nunca da
    // posição — uma moeda só é a célula 0, e não a que o `x % 4` daria.
    const cell = flags.hang
      ? hangCell(hooks, pattern)
      : item.count !== undefined
        ? countCell(item.count, pattern)
        : groundCell(x, y, pattern);
    const lift = layer === 'top' ? 0 : elevation;
    // `0 - …`, e não `-(…)`: `-(0)` é `-0`, que `toEqual` distingue e que ninguém quer.
    objects.push({
      appearanceId: item.id, cell, layer,
      dx: 0 - (lift + (flags.shiftX ?? 0)), dy: 0 - (lift + (flags.shiftY ?? 0)),
    });
    const height = flags.elevation ?? 0;
    if (layer === 'ground' && height > 0) elevation = Math.min(MAX_ELEVATION, elevation + height);
  };

  if (tile.ground > 0) {
    const flags = info.flagsOf(tile.ground);
    blocked = blocked || flags.unpass;
    place({ id: tile.ground }, flags, 'ground');
  }
  // As quatro passagens da ordem: bordas, `bottom`, comuns, `top`. Dentro de cada uma, a ordem
  // do arquivo — o primeiro item do tile no OTBM é o de baixo.
  const flagged = tile.items.map((item) => ({ item, flags: info.flagsOf(item.id) }));
  for (const { flags } of flagged) blocked = blocked || flags.unpass;
  for (const { item, flags } of flagged) if (flags.clip) place(item, flags, 'ground');
  for (const { item, flags } of flagged) if (!flags.clip && flags.bottom) place(item, flags, 'ground');
  for (const { item, flags } of flagged) {
    if (!flags.clip && !flags.bottom && !flags.top) place(item, flags, 'ground');
  }
  const creatureElevation = elevation;
  for (const { item, flags } of flagged) if (!flags.clip && !flags.bottom && flags.top) place(item, flags, 'top');

  return { objects, creatureElevation, blocked };
}
