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
// **Licença (ADR 0019, ADR 0037 d.3).** O Canary é GPL v2: entram NÚMEROS e o COMPORTAMENTO
// observável, nunca o código. As contas abaixo foram lidas em `src/creatures/combat/condition.cpp`
// (`ConditionFeared`, 2163-2455), e o que sai daqui é o que ELAS entregam — as cinco regiões e o
// índice inicial de cada uma, a ordem das oito direções, o lado do ponto sintético por direção,
// as distâncias `{15, 9, 3, 1}` e o giro do índice, o raio de busca 7, o alcance 30 e o custo de
// passo 10/35 (`MAP_NORMALWALKCOST`/`MAP_DIAGONALWALKCOST`, `map/utils/astarnodes.hpp`). A busca
// em si é original: o Canary a faz por um A* com tabela de nós, lista de vizinhos por direção do
// pai e heurística própria (`Map::getPathMatchingCond`), e aqui ela é uma varredura de custo
// mínimo (Dijkstra) sobre a caixa seguida de uma escolha do destino — a mesma separação que
// `line-of-sight.ts` faz com o `checkSightLine` do TFS. Os testes fixam o QUE sai (para onde o
// personagem foge, em campo aberto e contra parede), nunca como o Canary chega lá.
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
 * Para onde cai o ponto SINTÉTICO que `getFleePath` mira, por direção do vetor, em múltiplos do
 * tamanho `size` (`[x, y]`, indexado pelo valor do enum `Direction`). A busca FOGE do ponto (o
 * destino é o tile alcançável mais distante dele), então o ponto fica do lado OPOSTO ao da fuga.
 * O que o Canary faz é o que está aqui, defeitos inclusos, e o comportamento observado é o que
 * vale: o `SOUTH` mira o mesmo lado do `NORTH` (e foge para o norte), e os dois diagonais do norte
 * miram o mesmo ponto (e fogem para o oeste) — `fear.test.ts` fixa o que cada índice faz.
 */
const SYNTHETIC_SIDE: readonly (readonly [number, number])[] = [
  [0, 1], // north
  [-1, 0], // east
  [0, 1], // south
  [1, 0], // west
  [1, 1], // southwest
  [-1, 1], // southeast
  [1, -1], // northwest
  [1, -1], // northeast
];

/** O ponto sintético para uma direção do vetor e uma distância `size` (ver `SYNTHETIC_SIDE`). */
function syntheticTarget(from: GridPoint, direction: number, size: number): GridPoint {
  const side = SYNTHETIC_SIDE[direction];
  if (side === undefined) return { x: from.x, y: from.y };
  return { x: from.x + side[0] * size, y: from.y + side[1] * size };
}

// --- a busca de caminho -------------------------------------------------------------------------
//
// O que a busca do Canary ENTREGA, que é o que este módulo reproduz (`Creature::getPathTo(ponto,
// lista, 0, 30)` com `fullPathSearch` e `clearSight`):
//
//   1. o universo é a caixa de `SEARCH_RADIUS` tiles ao redor do personagem, andada em oito
//      direções (a diagonal passa por quina, como no resto do Tibia) por tiles que `walkable`
//      aceita;
//   2. um passo custa 10 na cardinal e 35 na diagonal — a diagonal sai MAIS CARA que duas
//      cardinais, e por isso o caminho de menor custo é quase sempre em L;
//   3. o destino é o tile alcançável MAIS DISTANTE (Chebyshev) do ponto sintético, desde que haja
//      visão livre até o ponto e ele fique a até 30 tiles em cada eixo; o tile do próprio ponto
//      (distância zero) nunca vale, e o de PARTIDA entra na disputa — se nenhum alcançável fica
//      mais longe que ele, a lista sai VAZIA;
//   4. o caminho é um de menor custo até o destino. Sem nenhum tile que valha, não há resposta.
//
// O que o Canary NÃO fixa é o desempate, e o dele é a ORDEM em que o A* visita os nós (o de menor
// custo mais heurística primeiro; o empate de total depende da versão AVX2/SSE do `getBestNode`,
// que muda de um build para outro). Aqui o desempate é uma escolha declarada e determinística, e
// reproduz o que o Canary mostra: a fuga RETA em campo aberto, e nos empates simétricos o oeste
// antes do leste e o norte antes do sul (e o oeste e o leste antes do norte e do sul):
//
//   - entre destinos à mesma distância do ponto, o de menor `custo + 8 × (|dx| + |dy|)` (o mais
//     barato de alcançar e o mais alinhado com o ponto);
//   - sobrando empate, e entre caminhos do mesmo custo, o de passos "menores" na ordem de
//     preferência `STEP_ORDER` (O, L, N, S e depois as diagonais), lida passo a passo.
//
// Contra o A* que este arquivo tinha antes — uma transcrição do `getPathMatchingCond`, retirada
// por violar o limite do ADR 0019 —, medido em ~20 000 casos de campo com parede e visão
// aleatórias: o custo e o tamanho do caminho coincidem em TODOS, o destino em ~98 % e o caminho
// inteiro em ~70 % (o resto são caminhos de mesmo custo com a curva em outro passo).

/** O raio (Chebyshev) da caixa de busca ao redor do personagem (`maxSearchDist` do `getPathTo`). */
const SEARCH_RADIUS = 7;
const BOX_SIDE = SEARCH_RADIUS * 2 + 1;
/** O alcance máximo do destino ao ponto, por eixo (`maxTargetDist`). */
const MAX_TARGET_DISTANCE = 30;
const CARDINAL_STEP_COST = 10;
const DIAGONAL_STEP_COST = 35;
/** O peso da distância Manhattan ao ponto no desempate entre destinos igualmente longe dele. */
const ALIGNMENT_WEIGHT = 8;
const UNREACHED = Number.POSITIVE_INFINITY;

/**
 * Os oito passos, na ORDEM DE PREFERÊNCIA do desempate (a posição na lista é o `rank` do passo):
 * oeste, leste, norte, sul, e depois as diagonais. É o que decide entre dois caminhos do mesmo
 * custo e entre dois destinos empatados.
 */
const STEP_ORDER: readonly { readonly dx: number; readonly dy: number; readonly direction: CanaryDirection }[] = [
  { dx: -1, dy: 0, direction: CANARY_DIRECTION.west },
  { dx: 1, dy: 0, direction: CANARY_DIRECTION.east },
  { dx: 0, dy: -1, direction: CANARY_DIRECTION.north },
  { dx: 0, dy: 1, direction: CANARY_DIRECTION.south },
  { dx: -1, dy: -1, direction: CANARY_DIRECTION.northwest },
  { dx: 1, dy: -1, direction: CANARY_DIRECTION.northeast },
  { dx: 1, dy: 1, direction: CANARY_DIRECTION.southeast },
  { dx: -1, dy: 1, direction: CANARY_DIRECTION.southwest },
];

/** O índice da célula `(dx, dy)` — relativa ao personagem — na caixa de busca, por linhas. */
const cellOf = (dx: number, dy: number): number => (dy + SEARCH_RADIUS) * BOX_SIDE + (dx + SEARCH_RADIUS);
const stepCost = (dx: number, dy: number): number =>
  dx !== 0 && dy !== 0 ? DIAGONAL_STEP_COST : CARDINAL_STEP_COST;

/** Compara dois caminhos (listas de `rank`) passo a passo; o prefixo vem antes. */
function compareRanks(a: readonly number[], b: readonly number[]): number {
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i += 1) {
    const difference = (a[i] as number) - (b[i] as number);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/** O que a varredura de custo sabe de cada célula da caixa: o custo e o caminho preferido até ela. */
interface Reach {
  /** O custo de chegar à célula, ou `UNREACHED`. */
  readonly cost: readonly number[];
  /** O caminho de menor custo até a célula, o "menor" na ordem `STEP_ORDER`; `[]` na partida. */
  readonly ranks: readonly (readonly number[])[];
}

/**
 * O custo de chegar a cada célula da caixa a partir do personagem, por menor custo, e o caminho
 * preferido até ela — a parte da busca que NÃO depende do ponto sintético, e por isso feita uma
 * vez por `fleePath`. A caixa tem 225 células: a varredura quadrática sai mais barata que manter
 * uma fila de prioridade. O caminho preferido de uma célula é o menor entre `caminho(vizinho) +
 * passo` dos vizinhos que a alcançam pelo custo mínimo — o menor caminho do vizinho já é o certo
 * porque `caminho + passo` preserva a ordem.
 */
function reachFrom(map: FleeMap, start: GridPoint): Reach {
  const cost = new Array<number>(BOX_SIDE * BOX_SIDE).fill(UNREACHED);
  const ranks = new Array<readonly number[]>(BOX_SIDE * BOX_SIDE).fill([]);
  const settled = new Array<boolean>(BOX_SIDE * BOX_SIDE).fill(false);
  // `walkable` pode custar (mundo, ocupação): cada célula é perguntada uma vez só.
  const walkable = new Map<number, boolean>();
  const accepts = (dx: number, dy: number): boolean => {
    const cell = cellOf(dx, dy);
    let known = walkable.get(cell);
    if (known === undefined) {
      known = map.walkable(start.x + dx, start.y + dy);
      walkable.set(cell, known);
    }
    return known;
  };
  cost[cellOf(0, 0)] = 0;
  for (;;) {
    let current = -1;
    let currentCost = UNREACHED;
    for (let cell = 0; cell < cost.length; cell += 1) {
      const candidate = cost[cell] as number;
      if (!settled[cell] && candidate < currentCost) {
        current = cell;
        currentCost = candidate;
      }
    }
    if (current === -1) return { cost, ranks };
    settled[current] = true;
    const x = (current % BOX_SIDE) - SEARCH_RADIUS;
    const y = Math.floor(current / BOX_SIDE) - SEARCH_RADIUS;
    STEP_ORDER.forEach(({ dx, dy }, rank) => {
      const nextX = x + dx;
      const nextY = y + dy;
      if (Math.abs(nextX) > SEARCH_RADIUS || Math.abs(nextY) > SEARCH_RADIUS) return;
      const next = cellOf(nextX, nextY);
      if (settled[next] || !accepts(nextX, nextY)) return;
      const total = currentCost + stepCost(dx, dy);
      const via = [...(ranks[current] as readonly number[]), rank];
      if (total < (cost[next] as number)
        || (total === cost[next] && compareRanks(via, ranks[next] as readonly number[]) < 0)) {
        cost[next] = total;
        ranks[next] = via;
      }
    });
  }
}

/**
 * A lista de passos da fuga para UM ponto sintético: `null` quando nenhum tile vale (o `false` do
 * Canary), a lista — possivelmente VAZIA, quando o melhor tile é o de partida — quando há.
 */
function pathAwayFrom(
  map: FleeMap, start: GridPoint, reach: Reach, target: GridPoint,
): CanaryDirection[] | null {
  // O destino: o alcançável mais longe do ponto (ver o comentário da seção).
  let best = -1;
  let bestDistance = 0;
  let bestKey = UNREACHED;
  for (let cell = 0; cell < reach.cost.length; cell += 1) {
    const reached = reach.cost[cell] as number;
    if (reached === UNREACHED) continue;
    const x = start.x + (cell % BOX_SIDE) - SEARCH_RADIUS;
    const y = start.y + Math.floor(cell / BOX_SIDE) - SEARCH_RADIUS;
    const offsetX = Math.abs(target.x - x);
    const offsetY = Math.abs(target.y - y);
    const distance = Math.max(offsetX, offsetY);
    if (distance === 0 || distance < bestDistance) continue;
    if (offsetX > MAX_TARGET_DISTANCE || offsetY > MAX_TARGET_DISTANCE) continue;
    const key = reached + ALIGNMENT_WEIGHT * (offsetX + offsetY);
    if (distance === bestDistance) {
      if (key > bestKey) continue;
      if (key === bestKey
        && compareRanks(reach.ranks[cell] as readonly number[], reach.ranks[best] as readonly number[]) >= 0) continue;
    }
    if (!map.sightClear({ x, y }, target)) continue;
    best = cell;
    bestDistance = distance;
    bestKey = key;
  }
  if (best === -1) return null;
  return (reach.ranks[best] as readonly number[]).map((rank) => (STEP_ORDER[rank] as { direction: CanaryDirection }).direction);
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

/** As distâncias do ponto sintético que `getFleePath` tenta, da maior para a menor. */
const FLEE_DISTANCES: readonly number[] = [15, 9, 3, 1];

/**
 * `ConditionFeared::getFleePath`: tenta as distâncias `{15, 9, 3, 1}` na direção do índice de
 * fuga; a primeira que dá um caminho NÃO vazio vale. Se nenhuma dá, o índice avança e a próxima
 * chamada (o próximo pensamento) tenta outra direção — o Canary repete o giro dentro da mesma
 * chamada só se a busca devolver `false` (nenhum tile vale) na última distância, o que com a
 * distância 1 não acontece na prática; o limite de voltas abaixo existe só para o laço nunca
 * prender o `sim`.
 */
export function fleePath(map: FleeMap, from: GridPoint, index: number): FleePathResult {
  let fleeIndex = index;
  let reach: Reach | null = null;
  for (let round = 0; round < FLEE_DIRECTIONS.length * 2; round += 1) {
    // O Canary só zera o índice quando ele chega a 8; o `NO_FLEE_INDEX` (99) atravessa esta
    // linha intacto e o `isStuck` logo abaixo o segura (ele só existe com os oito vizinhos
    // intransitáveis).
    if (fleeIndex === FLEE_DIRECTIONS.length) fleeIndex = 0;
    if (isStuck(map, from)) return { ok: false, path: [], index: fleeIndex };
    const direction = FLEE_DIRECTIONS[fleeIndex];
    if (direction === undefined) return { ok: false, path: [], index: fleeIndex };
    // A varredura de custo não depende do ponto: uma vez, e só quando alguém precisa dela.
    reach ??= reachFrom(map, from);
    let found: CanaryDirection[] | null = null;
    for (const size of FLEE_DISTANCES) {
      found = pathAwayFrom(map, from, reach, syntheticTarget(from, direction, size));
      if (found !== null && found.length > 0) break;
    }
    if (found === null || found.length === 0) fleeIndex += 1;
    if (found !== null) return { ok: true, path: found, index: fleeIndex };
  }
  return { ok: true, path: [], index: fleeIndex };
}
