import { describe, expect, it } from 'vitest';
import {
  distribution, formatNumber, formatTable, percentile, summarize,
} from './city-metrics.js';
import type { CycleSample } from './city-metrics.js';

// A conta que vira número de documentação. Um percentil errado por um índice é o defeito que o
// relatório esconde — o número continua parecendo razoável —, então cada fronteira tem teste.

const sample = (cpuUs: number, queueMax = 0, handleUs = cpuUs / 2): CycleSample => ({
  cpuUs, handleUs, flushUs: cpuUs - handleUs, queueMax,
});

describe('percentile (nearest-rank)', () => {
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it('devolve um valor que de fato aconteceu, sem interpolar', () => {
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 99)).toBe(99);
    expect(percentile(hundred, 100)).toBe(100);
    // 4 amostras: o p50 é a 2ª (posto ceil(0,5 × 4) = 2), e não a média de 20 e 30.
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
  });

  it('não depende da ordem de entrada e não muda o array recebido', () => {
    const input = [30, 10, 40, 20];
    expect(percentile(input, 50)).toBe(20);
    expect(input).toEqual([30, 10, 40, 20]);
  });

  it('p99 de menos de 100 amostras é o maior', () => {
    // É por isso que o bench mede centenas de ciclos: com 30, o p99 É o máximo.
    expect(percentile([5, 1, 9, 3], 99)).toBe(9);
  });

  it('p0 é o menor, e vazio é 0 em vez de NaN', () => {
    expect(percentile([7, 3, 9], 0)).toBe(3);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([42], 99)).toBe(42);
  });
});

describe('distribution', () => {
  it('p50, p99, máximo e média', () => {
    expect(distribution([10, 20, 30, 40])).toEqual({ p50: 20, p99: 40, max: 40, mean: 25 });
  });

  it('vazio é tudo zero', () => {
    expect(distribution([])).toEqual({ p50: 0, p99: 0, max: 0, mean: 0 });
  });
});

describe('summarize', () => {
  const run = {
    samples: [sample(100, 4), sample(200, 8), sample(300, 12), sample(400, 40)],
    viewers: 2,
    cycleMs: 100,
    bytes: 4_000,
    messages: 80,
    frames: 8,
    drops: 0,
  };

  it('taxas por visualizador por segundo: o divisor é visualizador × tempo simulado', () => {
    const summary = summarize(run);
    // 4 ciclos de 100 ms = 0,4 s; 4.000 B / 2 visualizadores / 0,4 s.
    expect(summary.elapsedSeconds).toBeCloseTo(0.4);
    expect(summary.bytesPerViewerPerSecond).toBeCloseTo(5_000);
    expect(summary.messagesPerViewerPerSecond).toBeCloseTo(100);
    expect(summary.framesPerViewerPerSecond).toBeCloseTo(10);
    expect(summary.bytesPerFrame).toBe(500);
  });

  it('CPU e fila saem como distribuição; o máximo da fila é o que se compara ao teto', () => {
    const summary = summarize(run);
    expect(summary.cycles).toBe(4);
    expect(summary.cpuUs).toEqual({ p50: 200, p99: 400, max: 400, mean: 250 });
    expect(summary.queue.max).toBe(40);
    expect(summary.queue.p50).toBe(8);
    // handleUs e flushUs somam o ciclo.
    expect(summary.handleUs.mean + summary.flushUs.mean).toBeCloseTo(summary.cpuUs.mean);
  });

  it('o p99 de CPU como fração do ciclo: 400 µs de um ciclo de 100 ms é 0,4 %', () => {
    expect(summarize(run).cycleBudgetShare).toBeCloseTo(0.004);
  });

  it('as quedas passam inteiras: é o que invalida a linha', () => {
    expect(summarize({ ...run, drops: 3 }).drops).toBe(3);
  });

  it('rodada vazia ou sem visualizador não vira NaN nem Infinity', () => {
    const empty = summarize({ ...run, samples: [], bytes: 0, messages: 0, frames: 0 });
    expect(empty.bytesPerViewerPerSecond).toBe(0);
    expect(empty.bytesPerFrame).toBe(0);
    expect(empty.cpuUs.p99).toBe(0);
    const alone = summarize({ ...run, viewers: 0 });
    expect(alone.bytesPerViewerPerSecond).toBe(0);
    expect(Number.isFinite(alone.messagesPerViewerPerSecond)).toBe(true);
  });
});

describe('formatTable', () => {
  const header = ['jogadores', 'B/vis/s'];
  const rows = [['100', '1.234'], ['500', '56']];

  it('em texto, alinha cada coluna à direita pela maior célula', () => {
    expect(formatTable(header, rows)).toEqual([
      'jogadores  B/vis/s',
      '---------  -------',
      '      100    1.234',
      '      500       56',
    ]);
  });

  it('em markdown, sai pronta para colar em docs/product, com colunas à direita', () => {
    expect(formatTable(header, rows, 'markdown')).toEqual([
      '| jogadores | B/vis/s |',
      '|---:|---:|',
      '| 100 | 1.234 |',
      '| 500 | 56 |',
    ]);
  });

  it('tabela sem linhas tem só o cabeçalho', () => {
    expect(formatTable(header, [])).toHaveLength(2);
  });
});

describe('formatNumber', () => {
  it('pt-BR: vírgula decimal e ponto de milhar, como o resto da documentação', () => {
    expect(formatNumber(1234.5, 1)).toBe('1.234,5');
    expect(formatNumber(11.06, 1)).toBe('11,1');
    expect(formatNumber(0)).toBe('0');
  });
});
