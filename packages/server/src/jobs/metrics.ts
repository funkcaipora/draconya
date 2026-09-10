// Métricas do processo `jobs` (FUN-59).
//
// A FUN-47 pedia `orphan_sessions` e não entregou, por uma razão estrutural: quem detecta
// sessão órfã é o `jobs`, e o `jobs` não tinha por onde falar — processo de fundo, sem servidor
// HTTP. Uma gauge no nó de jogo seria sempre zero, o que é pior que não ter: um painel que diz
// "nenhuma órfã" sem nunca ter olhado.
//
// Espelha `game/metrics.ts` de propósito, inclusive nas três regras que valem para qualquer
// métrica nova:
//
//   - duração é HISTOGRAMA, nunca média — a média esconde a cauda;
//   - nada de rótulo por `characterId` ou `sessionId` — são milhares de valores;
//   - `node_id` é rótulo PADRÃO do registro, não de cada métrica.
//
// A métrica que mais importa aqui é `receipts_failed_total`: extrato que fica no Redis é
// progresso não creditado, e ninguém estava olhando.

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Faixas em SEGUNDOS. O ciclo roda a cada dez, então o que interessa é distinguir "coube" de
 * "está encostando no intervalo" — e a partir daí o `cycles_skipped_total` é quem fala.
 */
const CYCLE_SECONDS_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** O que um ciclo produziu. Zero em tudo é um ciclo normal, não um ciclo vazio de propósito. */
export interface CycleResult {
  readonly slotsReleased: number;
  readonly receiptsWritten: number;
  readonly receiptsFailed: number;
}

export class JobsMetrics {
  readonly registry: Registry;

  readonly #orphans: Gauge;
  readonly #slotsReleased: Counter;
  readonly #receiptsWritten: Counter;
  readonly #receiptsFailed: Counter;
  readonly #cycleDuration: Histogram;
  readonly #cycleFailures: Counter;
  readonly #cyclesSkipped: Counter;
  readonly #lastSuccess: Gauge;
  readonly #lockHeld: Gauge;

  constructor(nodeId: string) {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ node_id: nodeId });
    // Heap, event loop e GC de graça, como nos outros dois papéis.
    collectDefaultMetrics({ register: this.registry });

    this.#orphans = new Gauge({
      name: 'draconya_orphan_sessions',
      help: 'Snapshots without a directory lease, as of the last sweep',
      registers: [this.registry],
    });
    this.#slotsReleased = new Counter({
      name: 'draconya_jobs_slots_released_total',
      help: 'Character slots returned by the abandoned-ticket sweep',
      registers: [this.registry],
    });
    this.#receiptsWritten = new Counter({
      name: 'draconya_jobs_receipts_written_total',
      help: 'Session receipts that reached the ledger',
      registers: [this.registry],
    });
    this.#receiptsFailed = new Counter({
      name: 'draconya_jobs_receipts_failed_total',
      help: 'Session receipts that could not be written and stayed in Redis',
      registers: [this.registry],
    });
    this.#cycleDuration = new Histogram({
      name: 'draconya_jobs_cycle_duration_seconds',
      help: 'Seconds spent in one scheduler cycle',
      buckets: CYCLE_SECONDS_BUCKETS,
      registers: [this.registry],
    });
    this.#cycleFailures = new Counter({
      name: 'draconya_jobs_cycle_failures_total',
      help: 'Scheduler cycles that threw',
      registers: [this.registry],
    });
    this.#cyclesSkipped = new Counter({
      name: 'draconya_jobs_cycles_skipped_total',
      help: 'Scheduler cycles skipped because the previous one was still running',
      registers: [this.registry],
    });
    this.#lastSuccess = new Gauge({
      name: 'draconya_jobs_last_success_timestamp_seconds',
      help: 'Unix time of the last scheduler cycle that completed without throwing',
      registers: [this.registry],
    });
    this.#lockHeld = new Gauge({
      name: 'draconya_jobs_lock_held',
      help: 'Whether this process currently holds the jobs singleton lock',
      registers: [this.registry],
    });
  }

  /**
   * Um ciclo terminou sem lançar. O carimbo de sucesso é o que permite o alerta que de fato
   * importa — "não roda há N minutos" —, porque contador que para de subir não dispara nada
   * sozinho.
   */
  observeCycle(durationSeconds: number, result: CycleResult, nowMs: number): void {
    this.#cycleDuration.observe(durationSeconds);
    this.#slotsReleased.inc(result.slotsReleased);
    this.#receiptsWritten.inc(result.receiptsWritten);
    this.#receiptsFailed.inc(result.receiptsFailed);
    this.#lastSuccess.set(nowMs / 1000);
  }

  /** O ciclo lançou. Conta, e a duração não entra: um ciclo que explodiu não mediu nada. */
  observeCycleFailure(): void {
    this.#cycleFailures.inc();
  }

  /** Reentrância: o ciclo anterior não terminou. É o primeiro sinal de intervalo apertado. */
  /**
   * `1` quando este processo é o `jobs` agora (FUN-91). Somando o cluster, o normal é UM.
   * Zero por muito tempo significa que ninguém está varrindo; dois significa que o lock
   * falhou, e as duas leituras só existem porque a métrica é por processo.
   */
  observeLock(held: boolean): void {
    this.#lockHeld.set(held ? 1 : 0);
  }

  observeSkipped(): void {
    this.#cyclesSkipped.inc();
  }

  /**
   * Quantas órfãs a varredura ENCONTROU. Um zero aqui é um zero observado — a varredura olhou
   * e não achou —, e não o zero de uma gauge que nunca foi escrita.
   */
  observeOrphans(count: number): void {
    this.#orphans.set(count);
  }
}
