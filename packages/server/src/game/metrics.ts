// Métricas do nó de jogo (FUN-47).
//
// O mínimo para o teste de carga produzir número, e a base do painel da F7. A que mais importa
// é `draconya_tick_duration_us`, porque toda a projeção de custo do projeto depende dela e ela
// é a única estimativa que não dá para derivar de fora.
//
// **Histograma, nunca média.** A média esconde a cauda, e é a cauda que satura o nó: uma
// instância patológica no p99 derruba o marco de 10 Hz de TODAS as outras do mesmo processo,
// porque o tick é single-thread. Um número médio bonito com p99 ruim é exatamente o relatório
// que faz ninguém investigar.
//
// **Sem cardinalidade alta.** Nada de rótulo por `characterId` ou `sessionId`: são milhares de
// valores, e isso mata qualquer backend de métrica — o custo aparece no Prometheus, longe daqui,
// e quem paga não liga uma coisa à outra. Os rótulos são tipo de sessão (seis valores) e
// anexada (dois).
//
// Os nomes são em INGLÊS mesmo com a issue escrevendo-os em português: nome de métrica é
// contrato de rede, como chave de log e coluna de banco, e o CLAUDE.md põe contrato em inglês.
//
// `orphan_sessions` NÃO mora aqui, e é decisão: quem detecta sessão órfã é o `jobs`, e a gauge
// vive lá (`jobs/metrics.ts`, FUN-59). Uma cópia aqui seria sempre zero — um painel dizendo
// "nenhuma órfã" sem nunca ter olhado.

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { SessionType } from '@draconya/sim';

/**
 * Faixas em MICROSSEGUNDOS, escolhidas em volta do que foi medido: a FUN-46 mediu 11–15 µs por
 * tick de instância desanexada com 38 monstros. As faixas cobrem duas ordens de grandeza acima
 * disso, que é onde uma regressão interessante apareceria.
 */
const TICK_US_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1_000, 5_000, 25_000];

/**
 * Atraso em MILISSEGUNDOS. O orçamento de um tick de 10 Hz é 100 ms, então as faixas se apertam
 * embaixo e se abrem depois do orçamento — o que interessa é distinguir "no prazo" de "o nó
 * está saturando", não medir com precisão um atraso que já é grande demais.
 */
const LAG_MS_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000];

const REATTACH_MS_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000];

/**
 * A partir de quanto atraso vale acordar alguém.
 *
 * 250 ms é dois ciclos e meio de um tick de 10 Hz: um pico isolado não acorda ninguém, e um nó
 * que passa disso com frequência está de fato saturando. O alerta sai como log de aviso porque
 * é onde o nó consegue falar hoje — quando existir Alertmanager, a regra é a mesma expressão.
 */
export const TICK_LAG_BUDGET_MS = 250;

export class GameMetrics {
  readonly registry: Registry;

  readonly #sessions: Gauge<'type' | 'attached'>;
  readonly #tickDuration: Histogram<'type'>;
  readonly #tickLag: Histogram<'type'>;
  readonly #messages: Counter;
  readonly #bytes: Counter;
  readonly #reattach: Histogram;
  readonly #slots: Gauge;
  readonly #lagBudgetExceeded: Counter<'type'>;

  constructor(nodeId: string) {
    this.registry = new Registry();
    // `node_id` como rótulo padrão, e não como rótulo de cada métrica: assim ele não
    // multiplica a cardinalidade de nenhuma série e continua permitindo somar o cluster.
    this.registry.setDefaultLabels({ node_id: nodeId });
    // Heap, event loop e GC vêm de graça — e depois da FUN-46 a pausa de GC é justamente o
    // número operacional que merece atenção: 100 ms a 10 Hz é um tick perdido para todas as
    // sessões anexadas do nó ao mesmo tempo.
    collectDefaultMetrics({ register: this.registry });

    this.#sessions = new Gauge({
      name: 'draconya_sessions_active',
      help: 'Sessions hosted on this node, by type and whether anyone is watching',
      labelNames: ['type', 'attached'],
      registers: [this.registry],
    });
    this.#tickDuration = new Histogram({
      name: 'draconya_tick_duration_us',
      help: 'Microseconds spent simulating one session tick',
      labelNames: ['type'],
      buckets: TICK_US_BUCKETS,
      registers: [this.registry],
    });
    this.#tickLag = new Histogram({
      name: 'draconya_tick_lag_ms',
      help: 'How far a tick ran past the rate it asked for',
      labelNames: ['type'],
      buckets: LAG_MS_BUCKETS,
      registers: [this.registry],
    });
    this.#messages = new Counter({
      name: 'draconya_messages_sent_total',
      help: 'Protocol messages written to sockets',
      registers: [this.registry],
    });
    this.#bytes = new Counter({
      name: 'draconya_bytes_sent_total',
      help: 'Bytes written to sockets, after batching',
      registers: [this.registry],
    });
    this.#reattach = new Histogram({
      name: 'draconya_reattach_duration_ms',
      help: 'Milliseconds to put a reconnecting character back on a session',
      buckets: REATTACH_MS_BUCKETS,
      registers: [this.registry],
    });
    this.#slots = new Gauge({
      name: 'draconya_active_slots_per_account',
      help: 'Largest number of characters one account has hosted on this node',
      registers: [this.registry],
    });
    this.#lagBudgetExceeded = new Counter({
      name: 'draconya_tick_lag_budget_exceeded_total',
      help: `Ticks that ran more than ${TICK_LAG_BUDGET_MS} ms past their rate`,
      labelNames: ['type'],
      registers: [this.registry],
    });
  }

  /**
   * Recontagem completa das sessões. Chamada uma vez por ciclo, não por sessão.
   *
   * `reset` antes de escrever porque um tipo que ZERA precisa aparecer como zero: sem isso a
   * última contagem fica congelada no painel, e "as hunts pararam" vira "as hunts continuam
   * iguais" — a leitura mais perigosa possível.
   */
  observeSessions(counts: ReadonlyMap<string, number>): void {
    this.#sessions.reset();
    for (const [key, value] of counts) {
      const [type, attached] = key.split('|');
      this.#sessions.set({ type: type ?? 'unknown', attached: attached ?? 'false' }, value);
    }
  }

  observeTick(type: SessionType, durationUs: number, lagMs: number): void {
    this.#tickDuration.observe({ type }, durationUs);
    this.#tickLag.observe({ type }, lagMs);
    if (lagMs > TICK_LAG_BUDGET_MS) this.#lagBudgetExceeded.inc({ type });
  }

  observeFrame(messages: number, bytes: number): void {
    this.#messages.inc(messages);
    this.#bytes.inc(bytes);
  }

  observeReattach(durationMs: number): void {
    this.#reattach.observe(durationMs);
  }

  /**
   * Quantos personagens de uma mesma conta este nó hospeda, no máximo.
   *
   * Só subir é sintoma de vazamento no limite de dois ativos por conta (FUN-15) — e o efeito
   * para o jogador é "não consigo mais logar", que ninguém relaciona com sessão.
   */
  observeSlots(maxPerAccount: number): void {
    this.#slots.set(maxPerAccount);
  }
}
