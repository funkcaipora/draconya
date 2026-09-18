// A conformance de combate como CONTRATO executável (CMB-10, #336; ADR 0031).
//
// O ADR 0031 congela a fórmula, a ordem de RNG e a migração; a matriz daqui transforma esse
// contrato em dado: cada caso declara a semente, o plano de avanço LÓGICO e o resultado
// ESPERADO. O oráculo é escrito à mão e é legível (DT-01) — nunca um snapshot que a própria
// implementação gerou, porque um teste que deriva o esperado do observado concorda com o defeito
// que deveria pegar.
//
// O `RngState` fica FORA do oráculo de propósito: ele não é um número que se lê, é uma
// PROPRIEDADE de equivalência. A matriz o compara entre a cadência de 100 ms, a de 1000 ms e a
// retomada — que é exatamente onde uma mudança de ordem de sorteio aparece.
//
// A lógica de comparação é PURA (invariante 1): não conhece I/O, relógio nem framework. O
// builder de cenário — conteúdo, monstro, ability, campo — mora em `tools`/teste, porque medir a
// sessão real é assunto de quem tem o conteúdo.

import type { RngState } from '../rng.js';
import type { Aggregates, EndReason, Session } from '../session.js';

/**
 * Os agregados que a conformance compara. `durationMs` fica de fora: ele é o tempo de SESSÃO, e
 * uma sessão que encerra no meio de um `advanceBy` grava o passo inteiro — 100 ms e 1000 ms
 * medem o mesmo mundo com durações diferentes. Os agregados de COMBATE não têm essa aresta.
 */
export type CombatConformanceAggregates = Omit<Aggregates, 'durationMs'>;

/** O estado final de UM participante, o que a matriz declara como oráculo. */
export interface CombatConformanceParticipant {
  readonly id: string;
  readonly health: number;
  readonly mana: number;
  readonly alive: boolean;
  readonly xp: number;
  readonly level: number;
}

/**
 * O resultado auditável de um caso. É DADO LEGÍVEL — o esperado é escrito à mão no teste, e a
 * comparação é campo a campo para a divergência sair nomeada.
 */
export interface CombatConformanceResult {
  readonly ended: EndReason | null;
  readonly aggregates: CombatConformanceAggregates;
  readonly participants: readonly CombatConformanceParticipant[];
}

/**
 * Um caso da matriz (contrato da issue #336). `advancePlanMs` é a sequência de `dtMs` do avanço:
 * o plano de 100 ms e o de 1000 ms são o MESMO caso lógico, e é a matriz que prova que rendem o
 * mesmo.
 */
export interface CombatConformanceCase {
  readonly id: string;
  readonly seed: string;
  readonly advancePlanMs: readonly number[];
  readonly expected: CombatConformanceResult;
}

/**
 * O observado de uma sessão: o resultado mais o estado do RNG. O RNG não entra no oráculo
 * (ver o topo), mas entra na equivalência entre cadências e na retomada.
 */
export interface CombatConformanceObservation {
  readonly result: CombatConformanceResult;
  readonly rng: RngState;
}

/** Lê o resultado auditável de uma sessão, sem `durationMs` (ver `CombatConformanceAggregates`). */
export function conformanceResultOf(session: Session): CombatConformanceResult {
  const { durationMs: _durationMs, ...aggregates } = session.aggregates;
  return {
    ended: session.ended,
    aggregates,
    participants: session.participants.map((participant) => ({
      id: participant.id,
      health: participant.health,
      mana: participant.mana,
      alive: participant.alive,
      xp: participant.xp,
      level: participant.level,
    })),
  };
}

/** O resultado mais o RNG — o que a cadência e a retomada precisam comparar. */
export function conformanceObservationOf(session: Session): CombatConformanceObservation {
  return { result: conformanceResultOf(session), rng: session.getRngState() };
}

/** Avança a sessão pelo plano, um `dtMs` de cada vez. O plano é dado, nunca relógio de parede. */
export function runConformancePlan(session: Session, advancePlanMs: readonly number[]): void {
  for (const dtMs of advancePlanMs) session.advanceBy(dtMs);
}

/**
 * Agrupa o plano em passos maiores, somando `factor` passos consecutivos. É como o mesmo caso
 * lógico vira a cadência de 1000 ms a partir do plano de 100 ms, sem mudar o tempo total.
 */
export function coarsenPlan(
  advancePlanMs: readonly number[],
  factor: number,
): number[] {
  if (factor <= 1) return [...advancePlanMs];
  const coarse: number[] = [];
  for (let index = 0; index < advancePlanMs.length; index += factor) {
    let dtMs = 0;
    for (let offset = 0; offset < factor && index + offset < advancePlanMs.length; offset++) {
      dtMs += advancePlanMs[index + offset] as number;
    }
    coarse.push(dtMs);
  }
  return coarse;
}

const AGGREGATE_KEYS: readonly (keyof CombatConformanceAggregates)[] = [
  'xpGained', 'goldGained', 'goldSpent', 'kills', 'deaths',
  'itemsLooted', 'suppliesUsed', 'bestBasicHit', 'bestSpellHit',
];

/**
 * Compara oráculo e observado e devolve as divergências, nomeadas. Vetor vazio é igual.
 *
 * Comparação explícita, e não `JSON.stringify`: a diferença sai com o CAMPO que divergiu, que é
 * o que uma investigação de "por que a fórmula mudou" precisa ler.
 */
export function compareConformance(
  expected: CombatConformanceResult,
  actual: CombatConformanceResult,
): string[] {
  const problems: string[] = [];
  if (expected.ended !== actual.ended) {
    problems.push(`ended: esperado ${String(expected.ended)}, observado ${String(actual.ended)}`);
  }
  for (const key of AGGREGATE_KEYS) {
    if (expected.aggregates[key] !== actual.aggregates[key]) {
      problems.push(
        `aggregates.${key}: esperado ${expected.aggregates[key]}, observado ${actual.aggregates[key]}`,
      );
    }
  }
  if (expected.participants.length !== actual.participants.length) {
    problems.push(
      `participantes: esperado ${expected.participants.length}, observado ${actual.participants.length}`,
    );
  }
  for (const [index, want] of expected.participants.entries()) {
    const got = actual.participants[index];
    if (got === undefined) continue;
    for (const field of ['id', 'health', 'mana', 'alive', 'xp', 'level'] as const) {
      if (want[field] !== got[field]) {
        problems.push(
          `participants[${index}].${field} (${want.id}): esperado ${String(want[field])}, ` +
            `observado ${String(got[field])}`,
        );
      }
    }
  }
  return problems;
}

/**
 * Compara duas observações: o resultado auditável e o estado do RNG. É a igualdade que a matriz
 * exige entre a cadência de 100 ms, a de 1000 ms e a retomada — resultados, agregados, morte e a
 * sequência de sorteios.
 */
export function compareObservations(
  expected: CombatConformanceObservation,
  actual: CombatConformanceObservation,
): string[] {
  const problems = compareConformance(expected.result, actual.result);
  if (!sameRngState(expected.rng, actual.rng)) {
    problems.push(`rng: esperado ${JSON.stringify(expected.rng)}, observado ${JSON.stringify(actual.rng)}`);
  }
  return problems;
}

function sameRngState(a: RngState, b: RngState): boolean {
  return a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d;
}
