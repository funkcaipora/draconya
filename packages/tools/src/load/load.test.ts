import { describe, expect, it } from 'vitest';
import { ArgumentError, parseArguments, parseDuration } from './args.js';
import { buildReport, percentiles, type SessionSample } from './report.js';
import { slice } from './runner.js';

const none = { heapBytes: null, sessions: null, tickDurationUs: null };
const empty = { before: none, after: none };

const sample = (over: Partial<SessionSample> = {}): SessionSample => ({
  joinMs: 10, bytes: 1_000, frames: 10, messages: 20, latencies: [5, 10], failed: null, ...over,
});

describe('argumentos', () => {
  it('entende as unidades de duração', () => {
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('1500ms')).toBe(1_500);
    expect(parseDuration('250')).toBe(250);
  });

  it('recusa número que não é número, em vez de abrir zero sessões', () => {
    // `Number('mil')` é `NaN`, e `NaN` sessões abre zero em silêncio — o relatório diria que
    // tudo passou porque nada falhou.
    expect(() => parseArguments(['--sessions', 'mil'], 8)).toThrow(ArgumentError);
    expect(() => parseDuration('dez minutos')).toThrow(ArgumentError);
  });

  it('recusa modo que não existe', () => {
    expect(() => parseArguments(['--mode', 'meio-anexado'], 8)).toThrow(/attached/);
  });

  it('recusa argumento solto, que quase sempre é uma flag mal escrita', () => {
    expect(() => parseArguments(['--sessions'], 8)).toThrow(ArgumentError);
  });

  it('nunca põe mais worker que sessão', () => {
    // Processo que abre zero sessão só custa memória e polui o relatório com fatia vazia.
    expect(parseArguments(['--sessions', '3', '--workers', '16'], 8).workers).toBe(3);
  });

  it('cai para o número de núcleos, com teto', () => {
    expect(parseArguments([], 4).workers).toBe(4);
    expect(parseArguments([], 64).workers).toBe(8);
  });
});

describe('divisão entre workers', () => {
  it('não perde nem inventa sessão no arredondamento', () => {
    for (const [sessions, workers] of [[1000, 8], [7, 3], [1, 1], [5000, 6]] as const) {
      const shares = slice(sessions, workers);
      expect(shares).toHaveLength(workers);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(sessions);
    }
  });
});

describe('percentis', () => {
  it('não interpola: todo valor relatado foi observado por alguém', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    const p = percentiles(values);
    expect(values).toContain(p.p50);
    expect(values).toContain(p.p99);
    expect(p.max).toBe(100);
  });

  it('vetor vazio não vira NaN', () => {
    expect(percentiles([])).toEqual({ samples: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe('relatório', () => {
  const scenario = {
    sessions: 2, mode: 'attached', durationMs: 10_000, workers: 1,
    apiUrl: 'http://x', huntId: 'arena', difficulty: 'cautious',
  };

  it('conta sessão que falhou, e diz por quê', () => {
    // Um relatório verde com metade das sessões mortas é pior que um vermelho.
    const report = buildReport(scenario, [
      sample(), sample({ failed: 'ticket failed: 409' }), sample({ failed: 'ticket failed: 409' }),
    ], empty);

    expect(report.sessions.opened).toBe(1);
    expect(report.sessions.failed).toBe(2);
    expect(report.sessions.failures).toEqual({ 'ticket failed: 409': 2 });
  });

  it('tráfego é por segundo, e também por sessão por segundo', () => {
    // Bytes/s totais crescem com a carga e não dizem nada sozinhos; por sessão é o número que
    // a projeção de banda usa.
    const report = buildReport(scenario, [sample({ bytes: 10_000 }), sample({ bytes: 10_000 })],
      empty);

    expect(report.traffic.bytesPerSecond).toBe(2_000);
    expect(report.traffic.bytesPerSessionPerSecond).toBe(1_000);
  });

  it('sem socket não há latência, e o relatório diz isso em vez de imprimir zero', () => {
    const report = buildReport({ ...scenario, mode: 'detached' },
      [sample({ latencies: [] })], empty);
    expect(report.latencyMs).toBeNull();
  });

  it('memória por sessão sai do servidor, e é nula quando ele não tem sessão', () => {
    // Dividir por zero e imprimir `Infinity` seria um relatório dizendo que cada sessão custa
    // infinito.
    const semSessoes = buildReport(scenario, [sample()], {
      before: { heapBytes: 100_000, sessions: 0, tickDurationUs: null },
      after: { heapBytes: 200_000, sessions: 0, tickDurationUs: null },
    });
    expect(semSessoes.server.heapBytesPerSession).toBeNull();

    // MARGINAL: o que o heap cresceu, dividido pelas sessões que apareceram. O heap inteiro
    // dividido pelas sessões atribuiria a linha de base do processo a quem não a gastou.
    const comSessoes = buildReport(scenario, [sample()], {
      before: { heapBytes: 100_000, sessions: 0, tickDurationUs: null },
      after: { heapBytes: 200_000, sessions: 4, tickDurationUs: 12.5 },
    });
    expect(comSessoes.server.heapBytesPerSession).toBe(25_000);
    expect(comSessoes.server.tickDurationUs).toBe(12.5);
    // Nó vazio antes da rodada: a medida não está contaminada.
    expect(comSessoes.server.sessionsBefore).toBe(0);

    // Heap que ENCOLHEU entre as duas leituras — o coletor rodou no meio — é "não sei", e
    // não um negativo com cara de medição.
    const coletou = buildReport(scenario, [sample()], {
      before: { heapBytes: 200_000, sessions: 0, tickDurationUs: null },
      after: { heapBytes: 100_000, sessions: 4, tickDurationUs: null },
    });
    expect(coletou.server.heapBytesPerSession).toBeNull();
  });
});
