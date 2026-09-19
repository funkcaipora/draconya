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
// 6. CAMADA: chão e bordas (`clip`) são `ground`; `bottom`, `unpass`/`unsight` e o que mede
//    mais de um tile (pela folha do catálogo) são `scene`; `top` fica acima das criaturas. A
//    partir do primeiro `scene` do tile, todo item não-`top` que vem depois também é `scene` —
//    o quadro pendurado na parede é parte dela, e sozinho seria chão. `scene` acumula elevação
//    como `ground`; o container espacial que separa as camadas na tela é de outra issue (385).

import type { AppearanceFlags } from '../assets/appearances.js';
import { groundCell, type Pattern } from './keys.js';
import type { StackedItem, TileStack } from './scene.js';

/** O teto da elevação acumulada num tile, em pixels — o do cliente do Tibia. */
export const MAX_ELEVATION = 24;

export type DrawLayer = 'ground' | 'scene' | 'top';

/** Dimensão de um objeto em TILES, como `AssetPack.objectSize` devolve: `{1, 1}` é 32×32, `{2, 2}` é 64×64. */
export interface ObjectSize {
  readonly width: number;
  readonly height: number;
}

/** Um quadro a desenhar: qual objeto, em que célula do padrão, deslocado quanto, em que camada. */
export interface DrawnObject {
  readonly appearanceId: number;
  readonly cell: { readonly x: number; readonly y: number };
  /** Deslocamento em pixels a partir da âncora do tile, para a ESQUERDA (`dx`) e para CIMA (`dy`). */
  readonly dx: number;
  readonly dy: number;
  readonly layer: DrawLayer;
  /**
   * Quantos objetos `scene` deste tile vieram ANTES deste: para um `scene`, é a posição dele
   * entre os `scene` do tile (0 = o primeiro); para `ground` e `top`, é só a contagem, sem
   * uso. É o desempate que 385 soma ao `zIndex` para dois `scene` do mesmo tile não trocarem
   * de ordem entre quadros.
   */
  readonly sceneSlot: number;
}

export interface DrawnTile {
  readonly objects: readonly DrawnObject[];
  /** Quanto uma criatura neste tile sobe, em pixels: a elevação acumulada pelos itens. */
  readonly creatureElevation: number;
  /** Alguém que anda vê parede aqui? — `unpass` no chão ou em qualquer item. */
  readonly blocked: boolean;
}

/** O que o pintor precisa saber de cada aparência: as flags, o padrão e a dimensão do quadro. */
export interface ObjectInfo {
  flagsOf(appearanceId: number): AppearanceFlags;
  patternOf(appearanceId: number): Pattern;
  /** Reserva por dimensão, em tiles. `{1, 1}` quando o pacote não sabe. */
  sizeOf(appearanceId: number): ObjectSize;
}

/**
 * A célula de um empilhável pela CONTAGEM, no padrão de `4×2` do Tibia: 1, 2, 3 e 4 moedas
 * são as quatro células da primeira linha; a partir de 5, 10, 25 e 50 as da segunda. Sem
 * contagem é a célula 0. Quem chama garante o padrão de 4×2; com outro, o `%` só evita
 * estourar.
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
 * A camada de UM objeto, sem olhar o resto do tile.
 *
 * A ORDEM das perguntas é a regra. `bottom` primeiro: parede e porta fechada são cenário, e é
 * `bottom` quem vence quando um pacote marca `bottom` E `top` — a mesma precedência das
 * passagens de `drawTile`, em que a de `top` exige `!flags.bottom`. `top` em seguida: o arco é
 * `top` seja qual for o tamanho, e uma porta aberta de 64 px continua acima de quem passa. Chão
 * e borda depois: chão é chão mesmo quando a folha é grande. Só então as outras flags de
 * cenário — `unpass` é pilar, estátua, caixa que não se atravessa; `unsight` é o que bloqueia a
 * vista, que é alto por definição. E POR ÚLTIMO a dimensão, como reserva: um objeto passável e
 * sem flag que ainda assim mede mais de um tile transborda para o tile de cima e o da esquerda,
 * e precisa de ordem espacial para não cobrir quem está lá. A dimensão nunca vem antes das
 * flags — o PRD §14 proíbe classificar parede pelo tamanho da textura, e a folha de 64 px de
 * um item baixo (um tapete largo) não o torna parede.
 */
export function layerOf(flags: AppearanceFlags, size: ObjectSize): DrawLayer {
  if (flags.bottom) return 'scene';
  if (flags.top) return 'top';
  if (flags.clip || flags.bankWaypoints !== undefined) return 'ground';
  if (flags.unpass || flags.unsight) return 'scene';
  if (size.width > 1 || size.height > 1) return 'scene';
  return 'ground';
}

/**
 * A pilha de um tile em `(x, y)`, pronta para desenhar. `x` e `y` só entram na célula do padrão
 * — a posição na tela é de quem chama.
 */
export function drawTile(tile: TileStack, x: number, y: number, info: ObjectInfo): DrawnTile {
  const objects: DrawnObject[] = [];
  let elevation = 0;
  let blocked = false;
  /** Quantos `scene` já saíram neste tile. Zero é "a pilha ainda é chão". */
  let sceneCount = 0;
  const hooks = { south: false, east: false };
  for (const item of tile.items) {
    const flags = info.flagsOf(item.id);
    if ((flags.hookSouth ?? 0) > 0) hooks.south = true;
    if ((flags.hookEast ?? 0) > 0) hooks.east = true;
  }

  const place = (item: StackedItem, flags: AppearanceFlags, layer: DrawLayer): void => {
    const pattern = info.patternOf(item.id);
    // Empilhável é o que veio COM contagem do arquivo, e a tabela de contagem só vale para o
    // padrão de 4×2 que ela descreve — é o que o cliente do Tibia faz; com outro padrão
    // (a moeda de 4×3 do 13.x) a célula volta a ser a da posição, como qualquer item. Uma
    // moeda só é a célula 0, e não a que o `x % 4` daria.
    const cell = flags.hang
      ? hangCell(hooks, pattern)
      : item.count !== undefined && pattern.width === 4 && pattern.height === 2
        ? countCell(item.count, pattern)
        : groundCell(x, y, pattern);
    // `top` ignora a elevação; `ground` E `scene` sobem pelo que veio antes — a caixa em cima
    // do pilar continua subindo 24 px, ela só mudou de camada.
    const lift = layer === 'top' ? 0 : elevation;
    // `0 - …`, e não `-(…)`: `-(0)` é `-0`, que `toEqual` distingue e que ninguém quer.
    objects.push({
      appearanceId: item.id, cell, layer, sceneSlot: sceneCount,
      dx: 0 - (lift + (flags.shiftX ?? 0)), dy: 0 - (lift + (flags.shiftY ?? 0)),
    });
    if (layer === 'scene') sceneCount += 1;
    const height = flags.elevation ?? 0;
    if (layer !== 'top' && height > 0) elevation = Math.min(MAX_ELEVATION, elevation + height);
  };

  /**
   * A camada de um item DENTRO da pilha: a de `layerOf`, exceto que a partir do primeiro
   * `scene` todo item não-`top` é `scene`. É a regra do quadro pendurado: o `hang` sozinho é um
   * item de 32 px no chão, mas em cima da parede ele é parte dela — e se ficasse em `ground`
   * seria desenhado ATRÁS da parede, no container de baixo, e sumiria dentro dela.
   */
  const layerInStack = (flags: AppearanceFlags, id: number): DrawLayer => {
    const own = layerOf(flags, info.sizeOf(id));
    return own !== 'top' && sceneCount > 0 ? 'scene' : own;
  };

  if (tile.ground > 0) {
    const flags = info.flagsOf(tile.ground);
    blocked = blocked || flags.unpass;
    place({ id: tile.ground }, flags, 'ground');            // chão é chão: não passa por layerOf
  }
  // As quatro passagens da ordem: bordas, `bottom`, comuns, `top`. Dentro de cada uma, a ordem
  // do arquivo — o primeiro item do tile no OTBM é o de baixo.
  const flagged = tile.items.map((item) => ({ item, flags: info.flagsOf(item.id) }));
  for (const { flags } of flagged) blocked = blocked || flags.unpass;
  for (const { item, flags } of flagged) if (flags.clip) place(item, flags, 'ground');  // borda idem
  for (const { item, flags } of flagged) {
    if (!flags.clip && flags.bottom) place(item, flags, layerInStack(flags, item.id));  // → 'scene'
  }
  for (const { item, flags } of flagged) {
    if (!flags.clip && !flags.bottom && !flags.top) place(item, flags, layerInStack(flags, item.id));
  }
  const creatureElevation = elevation;
  for (const { item, flags } of flagged) if (!flags.clip && !flags.bottom && flags.top) place(item, flags, 'top');

  return { objects, creatureElevation, blocked };
}
