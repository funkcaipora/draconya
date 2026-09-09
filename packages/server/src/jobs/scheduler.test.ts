import { describe, expect, it } from 'vitest';
import { createLogger } from '../log.js';
import type { TicketService } from '../tickets.js';
import { JobsMetrics } from './metrics.js';
import { createJobsCycle } from './scheduler.js';

const logger = createLogger('silent', 'test');
const scrape = async (metrics: JobsMetrics): Promise<string> => metrics.registry.metrics();

/** Um `TicketService` de mentira que faz o que o teste mandar na varredura. */
const ticketsThat = (sweep: () => Promise<number>): TicketService =>
  ({ sweepAbandoned: sweep } as unknown as TicketService);

describe('o ciclo do jobs mede (FUN-59)', () => {
  it('um ciclo que lança sobe as falhas, e o ciclo seguinte roda', async () => {
    // O `catch` continua engolindo — um ciclo que explode não pode derrubar o processo —,
    // mas antes só logava, e log ninguém alerta.
    const metrics = new JobsMetrics('j');
    let calls = 0;
    const cycle = createJobsCycle(logger, {
      metrics,
      tickets: ticketsThat(async () => {
        calls += 1;
        if (calls === 1) throw new Error('redis foi passear');
        return 0;
      }),
    });

    await cycle.run();
    await cycle.run();

    expect(calls).toBe(2);
    const text = await scrape(metrics);
    expect(text).toMatch(/draconya_jobs_cycle_failures_total\{[^}]*\} 1/);
    // Só o ciclo bom entra no histograma e no carimbo: o que explodiu não mediu nada.
    expect(text).toMatch(/draconya_jobs_cycle_duration_seconds_count\{[^}]*\} 1/);
  });

  it('um ciclo reentrante é pulado e contado', async () => {
    // A reentrância mora no ciclo, não no timer, para valer igual para quem dispara pelo
    // relógio e para quem dispara à mão. Ciclo pulado é o primeiro sinal de intervalo apertado.
    const metrics = new JobsMetrics('j');
    let release: () => void = () => {};
    const blocked = new Promise<number>((resolve) => { release = () => resolve(0); });
    const cycle = createJobsCycle(logger, { metrics, tickets: ticketsThat(() => blocked) });

    const first = cycle.run();
    expect(cycle.running).toBe(true);
    await cycle.run();                     // o anterior ainda não terminou: pula
    release();
    await first;

    const text = await scrape(metrics);
    expect(text).toMatch(/draconya_jobs_cycles_skipped_total\{[^}]*\} 1/);
    expect(text).toMatch(/draconya_jobs_cycle_duration_seconds_count\{[^}]*\} 1/);
    expect(cycle.running).toBe(false);
  });

  it('conta o que cada tarefa produziu, com o relógio injetado no carimbo', async () => {
    const metrics = new JobsMetrics('j');
    let nowMs = 1_700_000_000_000;
    const cycle = createJobsCycle(logger, {
      metrics,
      now: () => nowMs,
      tickets: ticketsThat(async () => 3),
    });
    await cycle.run();
    nowMs += 10_000;
    await cycle.run();

    const text = await scrape(metrics);
    expect(text).toMatch(/draconya_jobs_slots_released_total\{[^}]*\} 6/);
    expect(text).toMatch(/draconya_jobs_last_success_timestamp_seconds\{[^}]*\} 1700000010/);
  });

  it('sem métricas injetadas, o ciclo roda igual', async () => {
    // O `jobs` sem `/metrics` continua sendo o `jobs`. É o modo que os testes de integração
    // usam, e o que uma montagem parcial produz.
    let calls = 0;
    const cycle = createJobsCycle(logger, { tickets: ticketsThat(async () => { calls += 1; return 0; }) });
    await cycle.run();
    expect(calls).toBe(1);
  });
});
