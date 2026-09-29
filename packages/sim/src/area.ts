// As formas de área das magias (#155, ADR 0026 decisão 5; referência §19).
//
// Uma abstração só — forma → tiles → entidades — em vez de um laço por magia: é o que a
// referência manda ("não hardcode cada magia com loops próprios"), e é o que faz uma magia
// nova ser um JSON, não um `if`. PURO: entra geometria, sai lista de tiles, em ordem
// determinística (fileira a fileira, da esquerda para a direita olhando para a frente).
//
// O cone é `2·⌊k/2⌋+1` por fileira — 1, 3, 3, 5, 5 —, que reproduz a forma da onda do Tibia
// como fato observável, sem copiar matriz nenhuma do TFS (GPL, ADR 0019).
//
// O círculo tem DOIS mecanismos, e a magia e a ability de monstro usam mecanismos DIFERENTES do
// Canary para o "mesmo" raio (#523, revisão pós-review):
//
//   - MAGIA: as `AREA_CIRCLEnXn` nomeadas de `data/scripts/lib/register_spells.lua`. Para
//     raio 1 (3x3 completo) e raio 3 (`AREA_CIRCLE3X3`, 37 tiles) o corte é por Manhattan com um
//     bônus de achatamento (`|dx|+|dy| <= radius + ⌊radius/2⌋`) — 3/5/7/7/7/5/3 no raio 3. O
//     raio 2 (`AREA_CIRCLE2X2`) usa o MESMO bônus (`⌊2/2⌋=1`, 3/5/5/5/3, 21 tiles). Do raio 4 em
//     diante (`AREA_CIRCLE4X4/5X5/6X6`, conferidas em `things/sources/canary` local) o Canary
//     NÃO acrescenta bônus — é o diamante de Manhattan puro (`|dx|+|dy| <= radius`, 41/61/85
//     tiles) —, uma descontinuidade real da autoria das matrizes, não um erro de leitura: os
//     dois comportamentos são fatos observados, não uma fórmula única que os explique.
//   - MONSTRO: `AreaCombat::setupArea(int32_t radius)` (`src/creatures/combat/combat.cpp`) usa
//     uma tabela de ANÉIS 13×13 fixa (valores 1-8) e inclui o tile quando `valor <= radius` —
//     um raio de monstro N NÃO é o mesmo alcance físico que um raio de magia N (ex.: raio de
//     monstro 5 dá a MESMA forma que `AREA_CIRCLE3X3`, 37 tiles — coincidência de forma, não de
//     unidade). `MONSTER_CIRCLE_HALF_WIDTHS` registra a largura de cada fileira por raio (1-8,
//     saturando no raio 8 — a tabela de anéis não cresce mais depois disso) como fato medido
//     contra a tabela do combat.cpp, nunca a matriz GPL em si (ADR 0019) — a mesma disciplina já
//     usada para a onda e para `AREA_CIRCLE3X3` abaixo.
//
// Nenhum monstro do catálogo usa `circle` hoje (#0 da auditoria de level 200) — a distinção
// existe para quando a ability da ordem/dragão chegar, e os testes de `area.test.ts` prendem os
// dois mecanismos separadamente contra os números conferidos.

import type { SpellArea } from '@draconya/content';
import type { WorldPoint } from './movement.js';

export type Direction = 'north' | 'east' | 'south' | 'west';

/**
 * Quem pede a forma (#523): a magia/runa do jogador usa as `AREA_CIRCLEnXn` nomeadas, a ability
 * de monstro usa a tabela de anéis por raio. Só o `circle` lê isto — as outras formas (onda,
 * cleave, feixe, cruz) não têm mecanismo separado por monstro no Canary consultado.
 */
export type AreaSource = 'spell' | 'monster';

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
 * centrado no lançador. Alvo único (sem área), o círculo no alvo e a cruz no alvo são o outro
 * caso.
 */
export function isSelfOrigin(area: SpellArea | undefined): boolean {
  if (area === undefined) return false;
  switch (area.shape) {
    case 'circle': return area.centered === 'caster';
    // A cruz é centrada no alvo (Explosion) — como o círculo no alvo, exige mira e alcance.
    case 'cross': return false;
    case 'wave':
    case 'cleave':
    case 'beam': return true;
  }
}

/**
 * Larguras de fileira do círculo de ABILITY DE MONSTRO, por raio (1-8; #523). Medidas contra a
 * tabela de anéis 13×13 de `AreaCombat::setupArea(int32_t radius)`
 * (`src/creatures/combat/combat.cpp`, `things/sources/canary` local): um tile do anel entra
 * quando o valor dele é `<= radius`. Índice `0` de cada linha é a fileira central; a tabela é
 * simétrica, então só a metade (incluindo o centro) precisa estar aqui. Fato medido, não a
 * matriz do Canary copiada (ADR 0019) — como a onda e o `AREA_CIRCLE3X3` acima.
 */
const MONSTER_CIRCLE_HALF_WIDTHS: readonly (readonly number[])[] = [
  [1],                          // raio 1: só o centro
  [3, 1],                       // raio 2: centro 3, uma fileira de cada lado com 1
  [3, 3],                       // raio 3
  [5, 5, 3],                    // raio 4
  [7, 7, 5, 3],                 // raio 5 (mesma forma da AREA_CIRCLE3X3 da magia — coincidência de forma, não de raio)
  [9, 9, 7, 5, 3],               // raio 6
  [11, 9, 9, 7, 5, 1],           // raio 7
  [13, 11, 11, 9, 7, 5, 1],      // raio 8 — a tabela de anéis satura aqui; raio > 8 repete estas larguras
];

function monsterCircleTiles(centre: WorldPoint, radius: number): WorldPoint[] {
  const halfWidths = MONSTER_CIRCLE_HALF_WIDTHS[Math.min(radius, 8) - 1] as readonly number[];
  const tiles: WorldPoint[] = [];
  for (let dy = -(halfWidths.length - 1); dy <= halfWidths.length - 1; dy += 1) {
    const width = halfWidths[Math.abs(dy)] as number;
    const half = (width - 1) / 2;
    for (let dx = -half; dx <= half; dx += 1) {
      tiles.push({ x: centre.x + dx, y: centre.y + dy, z: centre.z });
    }
  }
  return tiles;
}

/**
 * Os tiles de uma forma, a partir do lançador (`origin`) e da direção dele; `target` só
 * importa para o círculo e a cruz centrados no alvo. `source` (#523) escolhe o mecanismo do
 * círculo — `'spell'` por padrão, para não mudar nenhum call site existente. Sem conferência de
 * mapa: tile fora do mapa não tem ninguém em cima, e conferir aqui seria acoplar geometria a
 * mundo.
 */
export function areaTiles(
  shape: SpellArea, origin: WorldPoint, direction: Direction, target?: WorldPoint,
  source: AreaSource = 'spell',
): WorldPoint[] {
  const f = FORWARD[direction];
  const s = SIDE[direction];
  switch (shape.shape) {
    case 'circle': {
      const centre = shape.centered === 'caster' || target === undefined ? origin : target;
      if (source === 'monster') return monsterCircleTiles(centre, shape.radius);
      const tiles: WorldPoint[] = [];
      // Raio 1 é o 3x3 completo; raio 2-3 recortam os cantos pelo bônus de achatamento
      // (`+⌊radius/2⌋`); raio >= 4 é o diamante de Manhattan puro, sem bônus — ver o comentário
      // do topo do arquivo, os dois comportamentos são fatos observados, não uma fórmula só.
      const bonus = shape.radius <= 3 ? Math.floor(shape.radius / 2) : 0;
      const maxManhattan = shape.radius >= 2 ? shape.radius + bonus : Number.POSITIVE_INFINITY;
      for (let dy = -shape.radius; dy <= shape.radius; dy += 1) {
        for (let dx = -shape.radius; dx <= shape.radius; dx += 1) {
          if (Math.abs(dx) + Math.abs(dy) > maxManhattan) continue;
          tiles.push({ x: centre.x + dx, y: centre.y + dy, z: centre.z });
        }
      }
      return tiles;
    }
    case 'cross': {
      const centre = target ?? origin;
      const tiles: WorldPoint[] = [{ ...centre }];
      for (let d = 1; d <= shape.radius; d += 1) {
        tiles.push({ x: centre.x + d, y: centre.y, z: centre.z });
        tiles.push({ x: centre.x - d, y: centre.y, z: centre.z });
        tiles.push({ x: centre.x, y: centre.y + d, z: centre.z });
        tiles.push({ x: centre.x, y: centre.y - d, z: centre.z });
      }
      return tiles;
    }
    case 'cleave':
      // Os três tiles um passo à frente do lançador (#523, revisão: AREA_WAVE6 do Canary tem o
      // marcador do centro `3` — que TAMBÉM conta como tile atingido, `matrixarea.cpp` do TFS —
      // na mesma fileira dos dois `1`; mas o motor ANCORA essa fileira em `getNextPosition(dir,
      // casterPos)`, um passo à frente, não na posição do lançador — `Spells::getCasterPosition`/
      // `InstantSpell::castSpell` com `needDirection`, `spells.cpp`. Então em coordenadas do
      // mundo os três tiles caem juntos, a `distance` 1: `row(origin, f, s, 1, 3)` já dava isso
      // certo antes desta magia ganhar fórmula própria no #523.
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

/**
 * Para onde o monstro OLHA, virado para o alvo (#518, TFS `Monster::updateLookDirection`,
 * referência §15-19): o eixo de MAIOR deslocamento decide — `|dx| > |dy|` olha para leste/oeste,
 * `|dy| > |dx|` para norte/sul —, e o empate (inclusive os dois zerados) decide horizontal, pelo
 * sinal de `dx`. É DIFERENTE de `directionOf`: aquela é a direção de um PASSO e sempre prioriza
 * o eixo horizontal quando ele se move; esta é para onde o monstro fica de frente antes de
 * lançar `wave`/`beam`, recalculada a cada golpe — o monstro não guarda direção entre golpes.
 */
export function facingDirection(from: WorldPoint, to: WorldPoint): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDy > absDx) return dy < 0 ? 'north' : 'south';
  return dx < 0 ? 'west' : 'east';
}

/** A chave de um tile num `Set`: é como a mira confere quem caiu na forma. */
export function tileKey(point: WorldPoint): string {
  return `${String(point.x)},${String(point.y)},${String(point.z)}`;
}
