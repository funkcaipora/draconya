// A fuga da condição `feared` (M44-04, #622) — o que `ConditionFeared` do Canary decide, puro.
//
// A `feared` do Tibia não é "um passo sorteado como o drunk": é uma caminhada FORÇADA. A cada
// segundo de pensamento da criatura (`Game::checkCreatures`, 1000 ms) a condição escolhe uma
// direção de fuga a partir de ONDE o lançador estava (`fleeingFromPos`), procura um caminho até
// um ponto sintético naquela direção (`getFleePath`) e entrega a lista de passos ao jogador
// (`Game::forcePlayerAutoWalk`, só jogador — nenhuma criatura que não seja `Player` anda por
// isso). Este módulo tem as três contas que ficam fora do ruleset — a escolha da direção, a
// varredura das quatro distâncias e a busca de caminho — e não sabe o que é sessão, relógio ou
// evento: quem agenda e quem anda é `rulesets/hunt.ts`.
//
// **O que é transcrição fiel e o que é aproximação** (o ADR 0019 proíbe copiar código GPL; os
// NÚMEROS e o MECANISMO abaixo foram lidos em `src/creatures/combat/condition.cpp:2163-2380`
// (`ConditionFeared`), `src/map/map.cpp` (`getPathMatchingCond`) e `src/map/utils/astarnodes.cpp`
// do Canary local):
//
// - a tabela das cinco REGIÕES de `getFleeDirection` e o índice inicial de cada uma;
// - o vetor `m_directionsVector` e o deslocamento do ponto sintético por direção, com as duas
//   esquisitices do Canary preservadas de propósito (o caso `SOUTH` soma `+y` como o `NORTH`, e
//   os dois diagonais do norte somam o mesmo par) — o comportamento observado é o da fonte;
// - as distâncias `{15, 9, 3, 1}` e o giro do índice quando nenhuma dá caminho;
// - `getRandomDirection` grava o VALOR do enum `Direction` (N=0, E=1, S=2, W=3, SW=4, SE=5,
//   NW=6, NE=7) como se fosse um índice do vetor — outra esquisitice, preservada;
// - a busca de caminho é o A* de `getPathMatchingCond` com os parâmetros que `getFleePath` passa
//   (`maxSearchDist` 7, `maxTargetDist` 30, visão livre até o ponto), com o mesmo custo de passo
//   (10 cardinal, 35 diagonal), a mesma heurística e a mesma lista de vizinhos por direção do
//   pai. A ÚNICA coisa que não é reproduzível é o desempate entre nós de mesmo custo: o
//   `getBestNode` do Canary tem uma versão por conjunto de instruções (AVX2/SSE), e o desempate
//   muda de uma para outra. Aqui vale o mais antigo (o índice menor), que é o da versão escalar.
//
// O único sorteio de toda a mecânica é o do tile do PRÓPRIO lançador (`getRandomDirection`); o
// resto é determinístico dado o mapa. O `Rng` da sessão entra só por aí.

import type { GridPoint } from './monster/step.js';
import type { Rng } from './rng.js';

/**
 * A `Direction` do Canary/TFS (`src/game/movement/position.hpp`): os VALORES são contrato — a
 * caminhada forçada viaja no snapshot como estes números, e `getRandomDirection` do Canary usa o
 * valor como índice.
 */
export const CANARY_DIRECTION = {
  north: 0, east: 1, south: 2, west: 3, southwest: 4, southeast: 5, northwest: 6, northeast: 7,
} as const;
export type CanaryDirection = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** O deslocamento de um passo por direção (`getNextPosition`, `src/utils/tools.cpp:581`). */
const NEXT_POSITION: readonly GridPoint[] = [
  { x: 0, y: -1 }, // north
  { x: 1, y: 0 }, // east
  { x: 0, y: 1 }, // south
  { x: -1, y: 0 }, // west
  { x: -1, y: 1 }, // southwest
  { x: 1, y: 1 }, // southeast
  { x: -1, y: -1 }, // northwest
  { x: 1, y: -1 }, // northeast
];

/** Para onde um passo na direção `direction` leva a partir de `from` (só x/y). */
export function stepFrom(from: GridPoint, direction: number): GridPoint {
  const offset = NEXT_POSITION[direction];
  if (offset === undefined) return { x: from.x, y: from.y };
  return { x: from.x + offset.x, y: from.y + offset.y };
}

/**
 * `m_directionsVector` do `ConditionFeared` (`condition.hpp:367`): a ORDEM em que o índice de fuga
 * (`fleeIndx`) anda — N, NE, E, SE, S, SW, W, NW —, cada entrada um valor do enum `Direction`.
 */
export const FLEE_DIRECTIONS: readonly CanaryDirection[] = [0, 7, 1, 5, 2, 4, 3, 6];

/** O `fleeIndx` inicial do Canary (`uint8_t fleeIndx = 99`): "nenhuma direção escolhida". */
export const NO_FLEE_INDEX = 99;

/** O que a busca precisa saber do mundo. Pura de tempo e de sessão: quem monta é o ruleset. */
export interface FleeMap {
  /**
   * O tile aceita um passo do personagem para a BUSCA (`Tile::queryAdd` com `FLAG_PATHFINDING`)?
   * Falso para parede, criatura no tile, escada/teleporte (o pathfinding os recusa) e fora do
   * mapa. Campo de dano NÃO barra aqui (`FLAG_IGNOREFIELDDAMAGE`) — quem barra é `harmfulField`.
   */
  walkable(x: number, y: number): boolean;
  /** Há um campo que causa dano e NÃO bloqueia no tile (`field && !isBlocking() && getDamage() != 0`)? */
  harmfulField(x: number, y: number): boolean;
  /** `Game::isSightClear(from, to, true)` — a linha entre os dois tiles está livre? */
  sightClear(from: GridPoint, to: GridPoint): boolean;
}

/** `ConditionFeared::canWalkTo`: o vizinho existe, está livre e não tem campo nocivo. */
function canWalkTo(map: FleeMap, from: GridPoint, direction: number): boolean {
  const next = stepFrom(from, direction);
  return map.walkable(next.x, next.y) && !map.harmfulField(next.x, next.y);
}

/** `ConditionFeared::isStuck`: nenhum dos oito vizinhos aceita o passo. */
export function isStuck(map: FleeMap, from: GridPoint): boolean {
  return FLEE_DIRECTIONS.every((direction) => !canWalkTo(map, from, direction));
}

/**
 * `ConditionFeared::getRandomDirection`: embaralha as oito direções, escolhe a primeira que
 * aceita o passo e grava o VALOR do enum dela como índice de fuga. Nenhuma aceita → `null`
 * (o `fleeIndx` fica como estava).
 */
function randomFleeIndex(map: FleeMap, from: GridPoint, rng: Rng): number | null {
  const order = [...FLEE_DIRECTIONS];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = rng.integer(0, i);
    const swap = order[i] as CanaryDirection;
    order[i] = order[j] as CanaryDirection;
    order[j] = swap;
  }
  const chosen = order.find((direction) => canWalkTo(map, from, direction));
  return chosen === undefined ? null : chosen;
}

/**
 * `ConditionFeared::getFleeDirection`: o índice de fuga inicial pela posição da criatura
 * relativa a `origin` (o tile do lançador). Cinco regiões, na ordem do Canary:
 *
 * | offset (criatura − lançador)  | índice                              |
 * |-------------------------------|-------------------------------------|
 * | `(0, 0)`                      | sorteio (`getRandomDirection`)      |
 * | `x ≥ 1`, `y ≤ 0`              | `y == 0` → 2 (E), senão 0 (N)       |
 * | `x ≥ 0`, `y ≥ 1`              | `x == 0` → 4 (S), senão 2 (E)       |
 * | `x ≤ -1`, `y ≥ 0`             | `y == 0` → 6 (W), senão 4 (S)       |
 * | `x ≤ 0`, `y ≤ -1`             | `x == 0` → 0 (N), senão 6 (W)       |
 *
 * As cinco cobrem o plano inteiro; o `NO_FLEE_INDEX` só volta do sorteio, quando os oito vizinhos
 * estão intransitáveis (o Canary deixa `fleeIndx` em 99 e tenta de novo no próximo pensamento).
 */
export function initialFleeIndex(map: FleeMap, from: GridPoint, origin: GridPoint, rng: Rng): number {
  const offsetX = from.x - origin.x;
  const offsetY = from.y - origin.y;
  if (offsetX === 0 && offsetY === 0) return randomFleeIndex(map, from, rng) ?? NO_FLEE_INDEX;
  if (offsetX >= 1 && offsetY <= 0) return offsetY === 0 ? 2 : 0;
  if (offsetX >= 0 && offsetY >= 1) return offsetX === 0 ? 4 : 2;
  if (offsetX <= -1 && offsetY >= 0) return offsetY === 0 ? 6 : 4;
  return offsetX === 0 ? 0 : 6;
}

/**
 * O ponto SINTÉTICO que `getFleePath` mira para uma direção do vetor e uma distância `size`
 * (`condition.cpp:2246-2276`). A busca de caminho FOGE dele (ver `findPath`: o melhor nó é o mais
 * distante do alvo), então o ponto fica do lado OPOSTO ao da fuga. Transcrito como está: o
 * `SOUTH` soma `+y` como o `NORTH`, e os dois diagonais do norte somam o mesmo par — o Canary
 * tem esses dois defeitos, e o comportamento observado é o que ele faz.
 */
function syntheticTarget(from: GridPoint, direction: number, size: number): GridPoint {
  switch (direction) {
    case CANARY_DIRECTION.north: return { x: from.x, y: from.y + size };
    case CANARY_DIRECTION.northeast: return { x: from.x + size, y: from.y - size };
    case CANARY_DIRECTION.east: return { x: from.x - size, y: from.y };
    case CANARY_DIRECTION.southeast: return { x: from.x - size, y: from.y + size };
    case CANARY_DIRECTION.south: return { x: from.x, y: from.y + size };
    case CANARY_DIRECTION.southwest: return { x: from.x + size, y: from.y + size };
    case CANARY_DIRECTION.west: return { x: from.x + size, y: from.y };
    case CANARY_DIRECTION.northwest: return { x: from.x + size, y: from.y - size };
    default: return { x: from.x, y: from.y };
  }
}

// --- a busca de caminho -------------------------------------------------------------------------

/** `Creature::getPathTo(target, list, 0, 30)` — os parâmetros que `getFleePath` passa. */
const SEARCH_RADIUS = 7; // `maxSearchDist` (o default do `getPathTo` de sete argumentos)
const MAX_TARGET_DISTANCE = 30;
const MIN_TARGET_DISTANCE = 0;
const NORMAL_WALK_COST = 10; // `MAP_NORMALWALKCOST`
const DIAGONAL_WALK_COST = 25; // `MAP_DIAGONALWALKCOST`
const MAX_NODES = 512; // `AStarNodes::MAX_NODES`

/**
 * Os cinco vizinhos que o A* do Canary expande a partir de um nó com PAI, por direção do nó ao
 * pai (`dirNeighbors`, `map.cpp`) — o pai nunca volta a ser vizinho. Indexado pelo `Direction`
 * (N, E, S, W, SW, SE, NW, NE). Sem pai, os oito (`ALL_NEIGHBORS`).
 */
const NEIGHBORS_BY_PARENT_DIRECTION: readonly (readonly (readonly [number, number])[])[] = [
  [[-1, 0], [0, 1], [1, 0], [1, 1], [-1, 1]],
  [[-1, 0], [0, 1], [0, -1], [-1, -1], [-1, 1]],
  [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1]],
  [[0, 1], [1, 0], [0, -1], [1, -1], [1, 1]],
  [[1, 0], [0, -1], [-1, -1], [1, -1], [1, 1]],
  [[-1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1]],
  [[0, 1], [1, 0], [1, -1], [1, 1], [-1, 1]],
  [[-1, 0], [0, 1], [-1, -1], [1, 1], [-1, 1]],
];
const ALL_NEIGHBORS: readonly (readonly [number, number])[] = [
  [-1, 0], [0, 1], [1, 0], [0, -1], [-1, -1], [1, -1], [1, 1], [-1, 1],
];

interface PathNode {
  readonly x: number;
  readonly y: number;
  /** O custo acumulado (`f` do Canary — o nome é deles, e não é o `f` do A* de livro). */
  cost: number;
  /** A heurística (`g` do Canary). O nó vale `cost + heuristic`. */
  readonly heuristic: number;
  readonly extra: number;
  parent: PathNode | null;
  open: boolean;
}

const nodeKey = (x: number, y: number): string => `${String(x)},${String(y)}`;

/** A direção do enum de `Map::getPathMatchingCond` para o deslocamento nó → pai. */
function parentDirection(dx: number, dy: number): number {
  if (dy === 0) return dx === -1 ? CANARY_DIRECTION.west : CANARY_DIRECTION.east;
  if (dx === 0) return dy === -1 ? CANARY_DIRECTION.north : CANARY_DIRECTION.south;
  if (dy === -1) return dx === -1 ? CANARY_DIRECTION.northwest : CANARY_DIRECTION.northeast;
  return dx === -1 ? CANARY_DIRECTION.southwest : CANARY_DIRECTION.southeast;
}

/**
 * O passo `de → para` (vizinhos) como o valor do enum `Direction`.
 */
function directionBetween(from: GridPoint, to: GridPoint): CanaryDirection {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0) return dy < 0 ? 0 : 2;
  if (dy === 0) return dx > 0 ? 1 : 3;
  if (dx > 0) return dy > 0 ? 5 : 7;
  return dy > 0 ? 4 : 6;
}

/**
 * `Map::getPathMatchingCond` com os parâmetros do `getFleePath`: `null` quando o Canary devolve
 * `false` (nenhum nó cumpre a condição), a lista de passos — possivelmente VAZIA, quando o
 * melhor nó é o de partida — quando devolve `true`.
 *
 * A condição de acerto (`FrozenPathingConditionCall::operator()`) com `maxTargetDist = 30`: o nó
 * precisa estar a até 30 tiles do alvo em cada eixo, com visão livre até ele, e vale se estiver a
 * EXATOS 30 (acerto perfeito, a busca para) ou se estiver MAIS LONGE do alvo do que qualquer
 * acerto anterior ("não é bem o que queremos, mas o melhor até agora"). É essa segunda cláusula
 * que faz a busca FUGIR do ponto sintético: o nó escolhido é o mais distante dele que a caixa de
 * sete tiles alcança.
 */
function findPath(map: FleeMap, start: GridPoint, target: GridPoint): number[] | null {
  const nodes: PathNode[] = [{ x: start.x, y: start.y, cost: 0, heuristic: 0, extra: 0, parent: null, open: true }];
  const byPosition = new Map<string, PathNode>([[nodeKey(start.x, start.y), nodes[0] as PathNode]]);
  const startDistanceX = Math.abs(target.x - start.x);
  const startDistanceY = Math.abs(target.y - start.y);
  let bestMatch = 0;
  let found: PathNode | null = null;

  for (;;) {
    // `AStarNodes::getBestNode` (versão escalar): o aberto de menor `cost + heuristic`, o mais
    // antigo em caso de empate.
    let best: PathNode | null = null;
    let bestTotal = Number.MAX_SAFE_INTEGER;
    for (const node of nodes) {
      if (!node.open) continue;
      const total = node.cost + node.heuristic;
      if (total < bestTotal) { best = node; bestTotal = total; }
    }
    if (best === null) {
      if (found !== null) break;
      return null;
    }
    const node = best;

    // `pathCondition(startPos, pos, fpp, bestMatch)`.
    const spanX = Math.abs(target.x - node.x);
    const spanY = Math.abs(target.y - node.y);
    let matched = false;
    if (spanX <= MAX_TARGET_DISTANCE && spanY <= MAX_TARGET_DISTANCE
      && map.sightClear({ x: node.x, y: node.y }, target)) {
      const distance = Math.max(spanX, spanY);
      if (distance >= MIN_TARGET_DISTANCE) {
        if (distance === MAX_TARGET_DISTANCE) {
          bestMatch = 0;
          matched = true;
        } else if (distance > bestMatch) {
          bestMatch = distance;
          matched = true;
        }
      }
    }
    if (matched) {
      found = node;
      if (bestMatch === 0) break;
    }

    const neighbors = node.parent === null
      ? ALL_NEIGHBORS
      : NEIGHBORS_BY_PARENT_DIRECTION[parentDirection(node.parent.x - node.x, node.parent.y - node.y)]
        ?? ALL_NEIGHBORS;
    for (const [dx, dy] of neighbors) {
      const x = node.x + dx;
      const y = node.y + dy;
      if (Math.abs(x - start.x) > SEARCH_RADIUS || Math.abs(y - start.y) > SEARCH_RADIUS) continue;
      const existing = byPosition.get(nodeKey(x, y));
      // Um nó já conhecido carrega o custo de tile que tinha; um novo precisa aceitar o passo. O
      // jogador não paga custo extra de tile (`getTileWalkCost` só soma para criatura no tile —
      // que aqui nem entra — e para campo, que só conta para MONSTRO).
      if (existing === undefined && !map.walkable(x, y)) continue;
      const extra = existing === undefined ? 0 : existing.extra;
      const stepCost = (Math.abs(node.x - x) + Math.abs(node.y - y) - 1) * DIAGONAL_WALK_COST + NORMAL_WALK_COST;
      const newCost = node.cost + stepCost + extra;
      if (existing !== undefined) {
        if (existing.cost <= newCost) continue;
        existing.cost = newCost;
        existing.parent = node;
        existing.open = true;
        continue;
      }
      if (nodes.length >= MAX_NODES) {
        if (found !== null) break;
        return null;
      }
      const distanceX = Math.abs(target.x - x);
      const distanceY = Math.abs(target.y - y);
      const created: PathNode = {
        x, y, cost: newCost, extra, parent: node, open: true,
        heuristic: (distanceX - startDistanceX) * 8 + (distanceY - startDistanceY) * 8
          + Math.max(distanceX, distanceY) * 8,
      };
      nodes.push(created);
      byPosition.set(nodeKey(x, y), created);
    }
    node.open = false;
  }

  if (found === null) return null;
  // De trás para a frente, como o Canary monta `dirList`; aqui a lista já sai na ORDEM de
  // caminhada (o Canary a consome do fim para o começo).
  const backwards: number[] = [];
  let child: PathNode = found;
  while (child.parent !== null) {
    backwards.push(directionBetween(child.parent, child));
    child = child.parent;
  }
  return backwards.reverse();
}

/** O resultado de `getFleePath`: se o Canary devolveu `true`, a lista de passos e o índice depois do giro. */
export interface FleePathResult {
  /** `false` só quando `isStuck` (nenhum vizinho aceita o passo). */
  readonly ok: boolean;
  /** Os passos, na ordem em que se anda. Pode ser vazia com `ok` — o Canary então não anda. */
  readonly path: readonly CanaryDirection[];
  /** O `fleeIndx` depois do giro: cada tentativa sem caminho o avança um. */
  readonly index: number;
}

/**
 * `ConditionFeared::getFleePath`: tenta as distâncias `{15, 9, 3, 1}` na direção do índice de
 * fuga; a primeira que dá um caminho NÃO vazio vale. Se nenhuma dá, o índice avança e a próxima
 * chamada (o próximo pensamento) tenta outra direção — o Canary repete o giro dentro da mesma
 * chamada só se `getPathTo` devolver `false` (nenhum acerto), o que com a distância 1 não
 * acontece na prática; o limite de voltas abaixo existe só para o laço nunca prender o `sim`.
 */
export function fleePath(map: FleeMap, from: GridPoint, index: number): FleePathResult {
  let fleeIndex = index;
  for (let round = 0; round < FLEE_DIRECTIONS.length * 2; round += 1) {
    let found = false;
    let path: CanaryDirection[] = [];
    for (const size of [15, 9, 3, 1]) {
      // O Canary só zera o índice quando ele chega a 8; o `NO_FLEE_INDEX` (99) atravessa esta
      // linha intacto e o `isStuck` logo abaixo o segura (ele só existe com os oito vizinhos
      // intransitáveis).
      if (fleeIndex === FLEE_DIRECTIONS.length) fleeIndex = 0;
      if (isStuck(map, from)) return { ok: false, path: [], index: fleeIndex };
      const direction = FLEE_DIRECTIONS[fleeIndex];
      if (direction === undefined) return { ok: false, path: [], index: fleeIndex };
      const result = findPath(map, from, syntheticTarget(from, direction, size));
      found = result !== null;
      path = (result ?? []) as CanaryDirection[];
      if (found && path.length > 0) break;
    }
    if (!found || path.length === 0) fleeIndex += 1;
    if (found) return { ok: true, path, index: fleeIndex };
  }
  return { ok: true, path: [], index: fleeIndex };
}
