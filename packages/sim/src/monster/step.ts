// Passo guloso (FUN-40, ADR 0009).
//
// O ALGORITMO INTEIRO:
//
//   1. tenta o tile que mais aproxima do alvo
//   2. bloqueado? tenta os dois vizinhos daquela direção
//   3. nada? espera este tick
//
// Sem caminho guardado. Sem A*. O(1) por monstro por tick.
//
// A consequência que vale entender agora: como o monstro NÃO GUARDA CAMINHO, não existe
// invalidação de rota. Um campo bloqueante posto no meio do mapa custa ZERO — ele só reavalia
// o próximo tile, como já faria. É isso que torna magic wall barato na F5, e é por isso que
// trocar por busca de caminho real "para melhorar a IA" sairia caro em mais de um sentido.

export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

/** `true` quando o tile não pode ser ocupado — parede, borda, ou outra criatura. */
export type Blocked = (x: number, y: number) => boolean;

/**
 * As oito direções, em ordem angular. A ordem importa: "os dois vizinhos da direção geral"
 * são os índices ±1 nesta lista, e é ela que transforma a regra em duas linhas de código.
 */
const DIRECTIONS: readonly GridPoint[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

const sign = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);

/**
 * Próximo tile, ou `null` para esperar.
 *
 * Espera acontece em dois casos que valem distinguir na leitura: já estar no alvo, e estar
 * cercado. O segundo é o monstro EMPACADO numa concavidade — comportamento esperado, igual
 * ao do Tibia, e que os jogadores reconhecem como certo. Não conserte.
 */
export function greedyStep(from: GridPoint, target: GridPoint, blocked: Blocked): GridPoint | null {
  const dx = sign(target.x - from.x);
  const dy = sign(target.y - from.y);
  if (dx === 0 && dy === 0) return null;

  const primary = DIRECTIONS.findIndex((d) => d.x === dx && d.y === dy);
  if (primary < 0) return null;

  // Primeiro o que mais aproxima; depois os dois vizinhos. A ordem entre os dois vizinhos é
  // fixa (horário antes de anti-horário) de propósito: alternar exigiria guardar estado por
  // monstro, e um viés estável é preferível a um viés que depende de quantas vezes o monstro
  // já tentou — este último é o que produz movimento errático que ninguém consegue reproduzir.
  for (const offset of [0, 1, -1]) {
    const direction = DIRECTIONS[(primary + offset + DIRECTIONS.length) % DIRECTIONS.length];
    if (direction === undefined) continue;
    const x = from.x + direction.x;
    const y = from.y + direction.y;
    if (!blocked(x, y)) return { x, y };
  }
  return null;
}

/**
 * Um passo AFASTANDO da ameaça (FUN-85), para a postura "manter distância".
 *
 * É o passo guloso com o alvo ESPELHADO: refletir a ameaça para o outro lado do personagem dá
 * exatamente a direção oposta, e daí em diante valem as mesmas três tentativas — a direção que
 * mais afasta, depois as duas vizinhas. Escrever um segundo algoritmo de fuga seria a mesma
 * regra de desvio em dois lugares, divergindo na terceira mudança.
 *
 * Empacado devolve `null`, como o guloso: recuar até a parede e ficar lá é o comportamento
 * certo, não um caso a consertar.
 */
export function fleeStep(from: GridPoint, threat: GridPoint, blocked: Blocked): GridPoint | null {
  return greedyStep(from, { x: 2 * from.x - threat.x, y: 2 * from.y - threat.y }, blocked);
}

/** Distância de Chebyshev: um passo diagonal custa o mesmo que um reto, como na grade. */
export function distance(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Adjacente inclui diagonal — mesma regra que a validação de rota usa (FUN-9). */
export function isAdjacent(a: GridPoint, b: GridPoint): boolean {
  const d = distance(a, b);
  return d === 1;
}
