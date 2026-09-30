// BFS limitado e determinístico para o FOLLOW do bot (#527, ADR 0009 emenda, ADR 0037).
//
// A rota autorada continua só passo guloso (ADR 0009) — isso não muda aqui. Este arquivo existe
// para o CONTRÁRIO: quando o passo guloso do follow (ou da travessia de escada do follow) empaca
// contra uma parede que exige rodear — um corredor em "U", por exemplo, onde os três candidatos
// do guloso (direção + dois vizinhos) são todos parede, mas existe caminho livre saindo pelo
// lado OPOSTO. Um monstro empacado assim, PERSEGUINDO, é o comportamento certo (ADR 0009: "não
// conserte"); um SEGUIDOR empacado assim, 8 tiles do líder, é exatamente o defeito que uma QA ao
// vivo achou — ele nunca tenta o único jeito de continuar. O bot é automação própria (ADR 0037),
// não uma mecânica de jogo — path-find aqui não quebra a fidelidade ao Tibia que o resto da
// simulação mantém. O segundo consumidor é a VOLTA AO SPAWN do monstro (#655,
// `walkBackPathStep` em `monster/monster.ts`): lá empacar não é o comportamento certo — o
// Canary volta com A* —, e o monstro preso numa bolsa nunca ficaria ocioso (ADR 0009, emenda do
// #655).
// O terceiro consumidor é a INVOCAÇÃO de personagem que segue o mestre (#599,
// `summonFollowStep`): lá o passo tem CUSTO — o diagonal dura o triplo —, e o BFS de custo igual
// andaria de viés; por isso `cheapestPath` (cardinal 10, diagonal 35, o A* do Canary) mora aqui.

import type { Blocked, GridPoint } from '../monster/step.js';

/** As oito direções, em ordem fixa — a MESMA ordem angular de `monster/step.ts`, por
 * consistência; a ordem em si só precisa ser fixa para o resultado ser determinístico. */
const DIRECTIONS: readonly GridPoint[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

const key = (p: GridPoint): string => `${String(p.x)},${String(p.y)}`;

/**
 * O caminho mais curto de `from` até o PRIMEIRO tile que satisfaz `isGoal`, dentro de um raio
 * (Chebyshev) de `radius` tiles a partir de `from` — nunca o mapa inteiro. `null` quando nenhum
 * tile assim existe dentro do raio (o caso comum: o alvo genuinamente não está por perto, e o
 * chamador decide o que fazer — esperar, desistir, o que for).
 *
 * BFS simples, sem heurística: a fila é FIFO (`Array.shift`, aceitável até `(2·radius+1)²`
 * tiles — trinta de raio é ~3700 no pior caso, barato para uma decisão de bot, e cacheada pelo
 * chamador enquanto o alvo não se move). Vizinhos numa ordem FIXA (`DIRECTIONS`) é o que torna
 * o caminho reproduzível quando há mais de um mais-curto empatado — sem isso, a ordem de
 * iteração dependeria de detalhe de implementação do `Map`, não de regra nenhuma.
 *
 * Devolve o caminho INTEIRO (sem `from`, incluindo o tile-alvo) — o chamador toma só o primeiro
 * tile como o passo desta vez, e pode guardar o resto como cache até o alvo se mover.
 */
export function boundedPath(
  from: GridPoint, isGoal: (p: GridPoint) => boolean, blocked: Blocked, radius: number,
): readonly GridPoint[] | null {
  if (isGoal(from)) return [];

  const cameFrom = new Map<string, GridPoint>();
  const visited = new Set<string>([key(from)]);
  const queue: GridPoint[] = [from];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === undefined) break;

    for (const direction of DIRECTIONS) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (Math.max(Math.abs(next.x - from.x), Math.abs(next.y - from.y)) > radius) continue;
      const nextKey = key(next);
      if (visited.has(nextKey)) continue;
      if (blocked(next.x, next.y)) continue;
      visited.add(nextKey);
      cameFrom.set(nextKey, current);

      if (isGoal(next)) {
        const path: GridPoint[] = [next];
        let walk = next;
        for (;;) {
          const prev = cameFrom.get(key(walk));
          if (prev === undefined || (prev.x === from.x && prev.y === from.y)) break;
          path.unshift(prev);
          walk = prev;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * O custo de um passo cardinal e de um diagonal no A* do Canary (`AStarNodes::getMapWalkCost`,
 * `map/utils/astarnodes.cpp`): `(|dx| + |dy| − 1) × MAP_DIAGONALWALKCOST + MAP_NORMALWALKCOST`, com
 * `MAP_NORMALWALKCOST` 10 e `MAP_DIAGONALWALKCOST` 25 — o cardinal custa 10 e o diagonal 35.
 * Números do mecanismo (ADR 0019).
 */
const CARDINAL_COST = 10;
const DIAGONAL_COST = 35;

/**
 * O caminho de MENOR CUSTO de `from` até o primeiro tile que satisfaz `isGoal` — o passo cardinal
 * custa 10 e o diagonal 35, como o A* do Canary (`Map::getPathMatching`) —, dentro de um raio
 * (Chebyshev) de `radius`. É o que `boundedPath` não é: o BFS trata os oito vizinhos como iguais,
 * e um seguidor que anda de viés na diagonal gasta o triplo do tempo por tile (o passo diagonal
 * dura três vezes, `Creature::getStepDuration`) para chegar ao MESMO lugar. Quem só precisa de
 * "existe caminho" (o follow do bot, a volta ao spawn) continua no BFS; quem segue outra criatura
 * em tempo real (a invocação, #599) pede este.
 *
 * Dijkstra com fila de prioridade por (custo, ordem de inserção) — o desempate pela ordem em que
 * o nó entrou na fila, e os vizinhos em `DIRECTIONS`, é o que torna o resultado reproduzível, sem
 * sorteio. Devolve o caminho INTEIRO sem `from`, como `boundedPath`; `[]` se `from` já é objetivo.
 */
export function cheapestPath(
  from: GridPoint, isGoal: (p: GridPoint) => boolean, blocked: Blocked, radius: number,
): readonly GridPoint[] | null {
  if (isGoal(from)) return [];

  interface Entry { readonly cost: number; readonly seq: number; readonly point: GridPoint }
  const heap: Entry[] = [];
  const before = (a: Entry, b: Entry): boolean => a.cost < b.cost || (a.cost === b.cost && a.seq < b.seq);
  const push = (entry: Entry): void => {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const up = heap[parent] as Entry;
      if (!before(entry, up)) break;
      heap[i] = up;
      i = parent;
    }
    heap[i] = entry;
  };
  const pop = (): Entry | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined) return top;
    if (heap.length === 0) return top;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const child = right < heap.length && before(heap[right] as Entry, heap[left] as Entry) ? right : left;
      if (!before(heap[child] as Entry, last)) break;
      heap[i] = heap[child] as Entry;
      i = child;
    }
    heap[i] = last;
    return top;
  };

  const best = new Map<string, number>([[key(from), 0]]);
  const cameFrom = new Map<string, GridPoint>();
  const settled = new Set<string>();
  let seq = 0;
  push({ cost: 0, seq, point: from });

  for (let entry = pop(); entry !== undefined; entry = pop()) {
    const current = entry.point;
    const currentKey = key(current);
    if (settled.has(currentKey)) continue;
    settled.add(currentKey);

    if (isGoal(current)) {
      const path: GridPoint[] = [current];
      let walk = current;
      for (;;) {
        const prev = cameFrom.get(key(walk));
        if (prev === undefined || (prev.x === from.x && prev.y === from.y)) break;
        path.unshift(prev);
        walk = prev;
      }
      return path;
    }

    for (const direction of DIRECTIONS) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (Math.max(Math.abs(next.x - from.x), Math.abs(next.y - from.y)) > radius) continue;
      const nextKey = key(next);
      if (settled.has(nextKey) || blocked(next.x, next.y)) continue;
      const cost = entry.cost + (direction.x !== 0 && direction.y !== 0 ? DIAGONAL_COST : CARDINAL_COST);
      const known = best.get(nextKey);
      if (known !== undefined && known <= cost) continue;
      best.set(nextKey, cost);
      cameFrom.set(nextKey, current);
      seq += 1;
      push({ cost, seq, point: next });
    }
  }
  return null;
}

/** `p` está a exatamente um tile (Chebyshev) de `target`? O "encostado nele" do follow comum. */
export function isAdjacentTo(target: GridPoint): (p: GridPoint) => boolean {
  return (p) => Math.max(Math.abs(p.x - target.x), Math.abs(p.y - target.y)) === 1;
}

/** `p` É `target`? O "pisar em cima" de quem vai atravessar uma escada. */
export function isExactly(target: GridPoint): (p: GridPoint) => boolean {
  return (p) => p.x === target.x && p.y === target.y;
}
