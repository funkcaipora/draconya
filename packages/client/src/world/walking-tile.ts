// O walking tile: a que tile uma criatura PERTENCE para fins de ordem durante o passo (#386).
//
// É a regra do `Creature::updateWalkingTile()` do OTClient, em números — lida, nunca copiada
// (ADR 0019). O corpo virtual tem sempre 32×32, ancorado no canto inferior direito do tile; o
// tile que contém esse canto, deslocado pelo `shift` do outfit, é o walking tile. A troca
// acontece no MEIO do passo — aos 50 % para leste/sul, aos 75 % para norte/oeste, com o
// displacement usual de 8 px —, e é isso que faz a criatura ATRAVESSAR a profundidade como no
// Tibia, em vez de pular de trás para a frente da parede num quadro só.
//
// PURO, como `camera.ts`, `facing.ts` e `tile-stack.ts`: sem Pixi, sem `state/` (só o tipo
// `Point` é da natureza da posição), sem relógio. Importa `TILE` de `./camera.js` e mais nada.
//
// **Sprite grande não muda a regra, de propósito.** Não há parâmetro de tamanho: o viewport
// ancora TODO quadro no canto inferior direito do tile, então um 64×64 e um 32×32 têm o MESMO
// canto — e o corpo de referência do OTClient é sempre 32×32 por essa razão.

import { TILE } from './camera.js';

/** O `shift` de um outfit em pixels, para cima (`y`) e para a esquerda (`x`). */
export interface Displacement {
  readonly x: number;
  readonly y: number;
}

/** O deslocamento do caso comum — monstro sem `shift`: compartilhado, para não alocar por quadro. */
export const NO_DISPLACEMENT: Displacement = Object.freeze({ x: 0, y: 0 });

export interface WalkingTileInput {
  /** A posição INTERPOLADA, em tiles fracionários — `interpolate(creature, nowMs)`. */
  readonly position: { readonly x: number; readonly y: number };
  /** O tile lógico: o destino do passo em curso, ou a posição quando parada. */
  readonly logical: { readonly x: number; readonly y: number };
  readonly displacement: Displacement;
}

/**
 * O eixo que NÃO anda devolve o tile lógico: não há o que decidir nele. É o que faz uma
 * criatura parada — ou com o passo vencido — pertencer ao próprio tile seja qual for o
 * displacement, e o que impede um displacement maior que um tile de empurrar o eixo parado
 * para o vizinho (o OTClient deixaria; nenhum outfit real tem shift ≥ 32).
 */
function axis(position: number, logical: number, displacement: number): number {
  if (position === logical) return logical;
  // O canto inferior direito do corpo de 32×32, em pixels de mundo: a âncora do tile
  // fracionário mais TILE − 1, menos o displacement — que desloca para cima/esquerda.
  const corner = position * TILE + (TILE - 1) - displacement;
  const tile = Math.floor(corner / TILE);
  // Nunca fora do 3×3 em volta do tile lógico: é a janela em que o OTClient procura.
  return Math.min(logical + 1, Math.max(logical - 1, tile));
}

/** O tile responsável pela ORDEM da criatura neste instante. O andar é de quem chama. */
export function walkingTile(input: WalkingTileInput): { x: number; y: number } {
  const { position, logical, displacement } = input;
  return {
    x: axis(position.x, logical.x, displacement.x),
    y: axis(position.y, logical.y, displacement.y),
  };
}