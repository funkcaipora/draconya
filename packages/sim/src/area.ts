// As formas de área das magias (#155, ADR 0026 decisão 5; referência §19).
//
// Uma abstração só — forma → tiles → entidades — em vez de um laço por magia: é o que a
// referência manda ("não hardcode cada magia com loops próprios"), e é o que faz uma magia
// nova ser um JSON, não um `if`. PURO: entra geometria, sai lista de tiles, em ordem
// determinística (fileira a fileira, da esquerda para a direita olhando para a frente).
//
// O cone é `2·⌊k/2⌋+1` por fileira — 1, 3, 3, 5, 5 —, que reproduz a forma da onda do Tibia
// como fato observável, sem copiar matriz nenhuma do TFS (GPL, ADR 0019).

import type { SpellArea } from '@draconya/content';
import type { WorldPoint } from './movement.js';

export type Direction = 'north' | 'east' | 'south' | 'west';

/** Para onde "à frente" aponta, por direção. */
const FORWARD: Readonly<Record<Direction, WorldPoint>> = {
  north: { x: 0, y: -1, z: 0 },
  south: { x: 0, y: 1, z: 0 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
};

/** Perpendicular à frente: é ao longo dela que a fileira se abre. */
const SIDE: Readonly<Record<Direction, WorldPoint>> = {
  north: { x: 1, y: 0, z: 0 },
  south: { x: 1, y: 0, z: 0 },
  east: { x: 0, y: 1, z: 0 },
  west: { x: 0, y: 1, z: 0 },
};

/**
 * A forma sai do LANÇADOR — sem alvo, sem alcance? `wave`, `cleave`, `beam` e o círculo
 * centrado no lançador. Alvo único (sem área) e o círculo no alvo são o outro caso.
 */
export function isSelfOrigin(area: SpellArea | undefined): boolean {
  if (area === undefined) return false;
  return area.shape !== 'circle' || area.centered === 'caster';
}

/**
 * Os tiles de uma forma, a partir do lançador (`origin`) e da direção dele; `target` só
 * importa para o círculo centrado no alvo. Sem conferência de mapa: tile fora do mapa não tem
 * ninguém em cima, e conferir aqui seria acoplar geometria a mundo.
 */
export function areaTiles(
  shape: SpellArea, origin: WorldPoint, direction: Direction, target?: WorldPoint,
): WorldPoint[] {
  const f = FORWARD[direction];
  const s = SIDE[direction];
  switch (shape.shape) {
    case 'circle': {
      const centre = shape.centered === 'caster' || target === undefined ? origin : target;
      const tiles: WorldPoint[] = [];
      for (let dy = -shape.radius; dy <= shape.radius; dy += 1) {
        for (let dx = -shape.radius; dx <= shape.radius; dx += 1) {
          tiles.push({ x: centre.x + dx, y: centre.y + dy, z: centre.z });
        }
      }
      return tiles;
    }
    case 'cleave':
      return row(origin, f, s, 1, 3);
    case 'beam': {
      const tiles: WorldPoint[] = [];
      for (let k = 1; k <= shape.length; k += 1) tiles.push(...row(origin, f, s, k, 1));
      return tiles;
    }
    case 'wave': {
      const tiles: WorldPoint[] = [];
      for (let k = 1; k <= shape.length; k += 1) {
        tiles.push(...row(origin, f, s, k, 2 * Math.floor(k / 2) + 1));
      }
      return tiles;
    }
  }
}

/** A fileira a `distance` tiles à frente, com `width` (ímpar) tiles centrados na linha da frente. */
function row(
  origin: WorldPoint, f: WorldPoint, s: WorldPoint, distance: number, width: number,
): WorldPoint[] {
  const half = (width - 1) / 2;
  const out: WorldPoint[] = [];
  for (let i = -half; i <= half; i += 1) {
    out.push({
      x: origin.x + f.x * distance + s.x * i,
      y: origin.y + f.y * distance + s.y * i,
      z: origin.z,
    });
  }
  return out;
}

/**
 * A direção de um passo `from → to`. Diagonal: a componente HORIZONTAL decide — é uma regra
 * nossa (a spec da #155, DT-05), não um fato do Tibia. Sem deslocamento, `null`: quem chama
 * mantém a direção que tinha.
 */
export function directionOf(from: WorldPoint, to: WorldPoint): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx !== 0) return dx > 0 ? 'east' : 'west';
  if (dy !== 0) return dy > 0 ? 'south' : 'north';
  return null;
}

/** A chave de um tile num `Set`: é como a mira confere quem caiu na forma. */
export function tileKey(point: WorldPoint): string {
  return `${String(point.x)},${String(point.y)},${String(point.z)}`;
}
