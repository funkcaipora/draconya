// BFS limitado e determinístico para o FOLLOW do bot (#527, ADR 0009 emenda, ADR 0037).
//
// A rota autorada continua só passo guloso (ADR 0009) — isso não muda aqui. Este arquivo existe
// para o CONTRÁRIO: quando o passo guloso do follow (ou da travessia de escada do follow) empaca
// contra uma parede que exige rodear — um corredor em "U", por exemplo, onde os três candidatos
// do guloso (direção + dois vizinhos) são todos parede, mas existe caminho livre saindo pelo
// lado OPOSTO. Um monstro empacado assim é o comportamento certo (ADR 0009: "não conserte"); um
// SEGUIDOR empacado assim, 8 tiles do líder, é exatamente o defeito que uma QA ao vivo achou —
// ele nunca tenta o único jeito de continuar. O bot é automação própria (ADR 0037), não uma
// mecânica de jogo — path-find aqui não quebra a fidelidade ao Tibia que o resto da simulação
// mantém.

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

/** `p` está a exatamente um tile (Chebyshev) de `target`? O "encostado nele" do follow comum. */
export function isAdjacentTo(target: GridPoint): (p: GridPoint) => boolean {
  return (p) => Math.max(Math.abs(p.x - target.x), Math.abs(p.y - target.y)) === 1;
}

/** `p` É `target`? O "pisar em cima" de quem vai atravessar uma escada. */
export function isExactly(target: GridPoint): (p: GridPoint) => boolean {
  return (p) => p.x === target.x && p.y === target.y;
}
