// A escolha da criatura sob um tile (AB-13, #428). PURO: sem React, sem Pixi, sem `net/`.
//
// O clique no mundo é uma INTENÇÃO (invariante 4): quem decide se o id é alvo válido, qual é o
// alvo efetivo e a queda para `nearest` é o servidor (#424). Aqui só se responde "qual criatura
// está desenhada sob este ponto agora" — a mesma regra de quem cobre quem no canvas
// (`spatialOrder`, o `zIndex` de `scene`), para o clique acertar o que o olho vê.

import { spatialOrder } from './depth.js';
import { interpolate, type Creature } from '../state/world.js';

/**
 * O tile inteiro em que a criatura está desenhada no instante dado (interpolação do passo).
 *
 * A posição é a INTERPOLADA, não a de origem: no meio de um passo a criatura está entre dois
 * tiles, e mirar o tile de origem acertaria o lugar de onde ela saiu, não onde o cursor a vê.
 */
export function creatureTile(
  creature: Creature, nowMs: number,
): { x: number; y: number; z: number } {
  const at = interpolate(creature, nowMs);
  return { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) };
}

/**
 * A criatura sob um tile: quando há mais de uma, a que é desenhada POR CIMA — a de
 * `spatialOrder` maior (mais ao sul/leste), a mesma regra de quem cobre quem no canvas.
 * `null` é tile sem criatura.
 *
 * O filtro é pelo tile ARREDONDADO (onde o cursor caiu); o desempate usa a posição
 * FRACIONÁRIA, senão duas criaturas no mesmo tile arredondado empatariam sempre e a primeira
 * do `Map` venceria — não necessariamente a que cobre no canvas.
 */
export function pickCreature(
  creatures: Iterable<Creature>, tile: { x: number; y: number; z: number }, nowMs: number,
): number | null {
  let picked: number | null = null;
  let top: { x: number; y: number } | null = null;
  for (const creature of creatures) {
    const cell = creatureTile(creature, nowMs);
    if (cell.x !== tile.x || cell.y !== tile.y || cell.z !== tile.z) continue;
    const at = interpolate(creature, nowMs);
    if (top === null || spatialOrder(at.x, at.y) > spatialOrder(top.x, top.y)) {
      picked = creature.id;
      top = { x: at.x, y: at.y };
    }
  }
  return picked;
}
