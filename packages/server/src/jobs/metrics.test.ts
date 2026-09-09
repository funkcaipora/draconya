import { describe, expect, it } from 'vitest';
import { JobsMetrics } from './metrics.js';

const scrape = async (metrics: JobsMetrics): Promise<string> => metrics.registry.metrics();
const cycle = (over: Partial<Parameters<JobsMetrics['observeCycle']>[1]> = {}) => ({
  slotsReleased: 0, receiptsWritten: 0, receiptsFailed: 0, ...over,
});

describe('métricas do jobs (FUN-59)', () => {
  it('sai em formato consultável, com o nó no rótulo PADRÃO', async () => {
    // Rótulo padrão do registro, e não de cada métrica: não multiplica cardinalidade nenhuma
    // e continua permitindo somar o cluster. Mesma escolha da FUN-47.
    const metrics = new JobsMetrics('jobs-a');
    metrics.observeOrphans(3);

    const text = await scrape(metrics);
    expect(text).toContain('# HELP draconya_orphan_sessions');
    expect(text).toMatch(/draconya_orphan_sessions\{node_id="jobs-a"\} 3/);
  });

  it('a órfã é um zero OBSERVADO, e o carimbo de sucesso avança a cada ciclo', async () => {
    // Era a pendência da FUN-47: uma gauge sempre-zero no nó de jogo diria "nenhuma órfã" sem
    // nunca ter olhado. Aqui o zero vem da varredura, e o carimbo diz quando ela olhou.
    const metrics = new JobsMetrics('j');
    metrics.observeOrphans(0);
    metrics.observeCycle(0.02, cycle(), 1_700_000_000_000);
    const first = await scrape(metrics);
    expect(first).toMatch(/draconya_orphan_sessions\{[^}]*\} 0/);
    expect(first).toMatch(/draconya_jobs_last_success_timestamp_seconds\{[^}]*\} 1700000000/);

    metrics.observeCycle(0.02, cycle(), 1_700_000_010_000);
    expect(await scrape(metrics))
      .toMatch(/draconya_jobs_last_success_timestamp_seconds\{[^}]*\} 1700000010/);
  });

  it('a duração do ciclo é HISTOGRAMA, não média', async () => {
    // Mesma regra da FUN-47: a média esconde a cauda, e um ciclo lento de vez em quando é
    // exatamente o que precede o `cycles_skipped_total` começar a subir.
    const metrics = new JobsMetrics('j');
    for (const s of [0.02, 0.03, 0.04, 8]) metrics.observeCycle(s, cycle(), 0);

    const text = await scrape(metrics);
    expect(text).toMatch(/draconya_jobs_cycle_duration_seconds_bucket\{[^}]*le="0.05"[^}]*\} 3/);
    expect(text).toMatch(/draconya_jobs_cycle_duration_seconds_count\{[^}]*\} 4/);
  });

  it('conta o que cada tarefa do ciclo produziu, e o extrato falhado à parte', async () => {
    // `receipts_failed_total` é a mais importante: extrato que fica no Redis é progresso não
    // creditado, e ninguém estava olhando.
    const metrics = new JobsMetrics('j');
    metrics.observeCycle(0.1, cycle({ slotsReleased: 2, receiptsWritten: 5, receiptsFailed: 1 }), 0);
    metrics.observeCycle(0.1, cycle({ receiptsFailed: 1 }), 0);

    const text = await scrape(metrics);
    expect(text).toMatch(/draconya_jobs_slots_released_total\{[^}]*\} 2/);
    expect(text).toMatch(/draconya_jobs_receipts_written_total\{[^}]*\} 5/);
    expect(text).toMatch(/draconya_jobs_receipts_failed_total\{[^}]*\} 2/);
  });

  it('falha e reentrância são contadores separados', async () => {
    const metrics = new JobsMetrics('j');
    metrics.observeCycleFailure();
    metrics.observeSkipped();
    metrics.observeSkipped();

    const text = await scrape(metrics);
    expect(text).toMatch(/draconya_jobs_cycle_failures_total\{[^}]*\} 1/);
    expect(text).toMatch(/draconya_jobs_cycles_skipped_total\{[^}]*\} 2/);
  });

  it('nenhuma série tem rótulo por personagem ou sessão', async () => {
    // A mesma armadilha que a FUN-47 já cobre no `game`: são milhares de valores, e isso mata
    // qualquer backend de métrica — o custo aparece no Prometheus, longe daqui.
    const metrics = new JobsMetrics('j');
    metrics.observeCycle(0.1, cycle({ receiptsWritten: 1 }), 0);
    metrics.observeOrphans(1);
    const text = await scrape(metrics);
    expect(text).not.toMatch(/character_id=|session_id=/);
  });
});
