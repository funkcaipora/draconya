// Agregação e relatório do cliente de carga (FUN-45).
//
// Duas saídas, e as duas importam: **legível**, para alguém olhar durante a rodada, e **JSON**,
// porque os números vão para o `docs/technical-architecture.md` e comparar duas rodadas à mão a
// partir de texto formatado é como o número vira impressão.
//
// **Percentil, não média.** É a mesma razão da FUN-47: a média esconde a cauda, e é a cauda que
// o jogador sente. Uma latência média de 20 ms com p99 de 2 s é um jogo travando para um a cada
// cem, e a média não diz isso.

import { arch, cpus, platform } from 'node:os';

export interface SessionSample {
  readonly joinMs: number;
  readonly bytes: number;
  readonly frames: number;
  readonly messages: number;
  readonly latencies: number[];
  readonly failed: string | null;
}

export interface ServerSnapshot {
  /** Heap do nó de jogo, em bytes, lido do `/metrics` dele (FUN-47). */
  readonly heapBytes: number | null;
  readonly sessions: number | null;
  /** Soma e contagem do histograma de custo de tick, para tirar a média do lado do servidor. */
  readonly tickDurationUs: number | null;
}

/**
 * Duas leituras do `/metrics`: ANTES de abrir sessão nenhuma e DEPOIS.
 *
 * Memória por sessão é a DIFERENÇA dividida pelas sessões, não o heap inteiro dividido por
 * elas. A primeira versão fazia a segunda conta e reportou 1,3 MiB por sessão com cinquenta
 * sessões — que era, quase todo, a linha de base do processo (api, game e jobs no mesmo
 * runtime) atribuída a quem não a gastou.
 */
export interface ServerMeasurement {
  readonly before: ServerSnapshot;
  readonly after: ServerSnapshot;
}

export interface LoadReport {
  readonly startedAt: string;
  readonly machine: { platform: string; arch: string; cpus: number; node: string };
  readonly scenario: {
    sessions: number; mode: string; durationMs: number; workers: number;
    apiUrl: string; huntId: string; difficulty: string;
    /** Parties de N (#198). Ausente ou 1 é solo. */
    party?: number; partyMode?: string;
  };
  readonly sessions: {
    opened: number; failed: number; failures: Record<string, number>;
    joinMs: Percentiles;
  };
  readonly traffic: {
    bytesPerSecond: number; framesPerSecond: number; messagesPerSecond: number;
    bytesPerSessionPerSecond: number;
  };
  readonly latencyMs: Percentiles | null;
  readonly server: {
    heapBytesPerSession: number | null;
    /** Sessões que o nó já hospedava ANTES da rodada. Ver `marginalHeap`. */
    sessionsBefore: number | null;
    sessionsSeen: number | null;
    tickDurationUs: number | null;
  };
}

export interface Percentiles {
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/**
 * Percentis por posição no vetor ordenado, sem interpolar.
 *
 * Interpolar inventaria um valor que ninguém observou, e o ponto de um percentil de latência é
 * justamente apontar uma medida real que aconteceu com alguém.
 */
export function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) return { samples: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] as number;
  return {
    samples: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted[sorted.length - 1] as number),
  };
}

export function buildReport(
  scenario: LoadReport['scenario'],
  samples: readonly SessionSample[],
  server: ServerMeasurement,
): LoadReport {
  const live = samples.filter((sample) => sample.failed === null);
  const failures: Record<string, number> = {};
  for (const sample of samples) {
    if (sample.failed === null) continue;
    failures[sample.failed] = (failures[sample.failed] ?? 0) + 1;
  }

  const seconds = scenario.durationMs / 1000;
  const bytes = live.reduce((total, sample) => total + sample.bytes, 0);
  const frames = live.reduce((total, sample) => total + sample.frames, 0);
  const messages = live.reduce((total, sample) => total + sample.messages, 0);
  const latencies = live.flatMap((sample) => sample.latencies);

  const [core] = cpus();
  return {
    startedAt: new Date().toISOString(),
    machine: {
      platform: `${platform()} ${arch()}`,
      arch: core?.model ?? 'unknown',
      cpus: cpus().length,
      node: process.version,
    },
    scenario,
    sessions: {
      opened: live.length,
      failed: samples.length - live.length,
      failures,
      joinMs: percentiles(live.map((sample) => sample.joinMs)),
    },
    traffic: {
      bytesPerSecond: round(bytes / seconds),
      framesPerSecond: round(frames / seconds),
      messagesPerSecond: round(messages / seconds),
      bytesPerSessionPerSecond: live.length === 0 ? 0 : round(bytes / seconds / live.length),
    },
    latencyMs: latencies.length === 0 ? null : percentiles(latencies),
    server: {
      heapBytesPerSession: marginalHeap(server),
      sessionsBefore: server.before.sessions,
      sessionsSeen: server.after.sessions,
      tickDurationUs: server.after.tickDurationUs,
    },
  };
}

/** O mesmo relatório, para alguém ler durante a rodada. */
export function formatReport(report: LoadReport): string {
  const lines: string[] = [];
  const row = (label: string, value: string): void => {
    lines.push(`${label.padEnd(24)}${value}`);
  };

  lines.push('--- máquina do cliente ----------------------------------------------');
  row('plataforma', report.machine.platform);
  row('cpu', `${report.machine.arch} × ${report.machine.cpus}`);
  row('node', report.machine.node);

  lines.push('--- cenário ---------------------------------------------------------');
  row('sessões', `${report.scenario.sessions.toLocaleString('pt-BR')} em modo ${report.scenario.mode}`);
  row('workers', String(report.scenario.workers));
  row('duração', `${Math.round(report.scenario.durationMs / 1000)} s`);
  row('hunt', `${report.scenario.huntId} / ${report.scenario.difficulty}`);
  if ((report.scenario.party ?? 1) > 1) {
    const size = report.scenario.party ?? 1;
    // A sobra entra solo, e o relatório diz: "3 parties de 4 + 1 solo" é o que se rodou.
    const parties = Math.floor(report.scenario.sessions / size);
    const solo = report.scenario.sessions - parties * size;
    row('parties', `${String(parties)} de ${String(size)} (${report.scenario.partyMode ?? 'split'})${solo > 0 ? ` + ${String(solo)} solo` : ''}`);
  }

  lines.push('--- sessões ---------------------------------------------------------');
  row('abertas', String(report.sessions.opened));
  row('falharam', String(report.sessions.failed));
  for (const [reason, count] of Object.entries(report.sessions.failures)) {
    row('  ' + reason.slice(0, 40), String(count));
  }
  row('entrada p50/p99', `${report.sessions.joinMs.p50} / ${report.sessions.joinMs.p99} ms`);

  lines.push('--- tráfego ---------------------------------------------------------');
  row('bytes/s', report.traffic.bytesPerSecond.toLocaleString('pt-BR'));
  row('bytes/s por sessão', report.traffic.bytesPerSessionPerSecond.toLocaleString('pt-BR'));
  row('frames/s', report.traffic.framesPerSecond.toLocaleString('pt-BR'));
  row('mensagens/s', report.traffic.messagesPerSecond.toLocaleString('pt-BR'));

  if (report.latencyMs === null) {
    // Dizer POR QUE não há amostra, em vez de imprimir zero. No modo desanexado é esperado —
    // não há socket. No anexado é defeito, e chamar os dois de "sem amostra" esconderia o
    // segundo atrás do primeiro.
    row('latência', report.scenario.mode === 'detached'
      ? 'sem amostra — modo desanexado não mantém socket'
      : 'SEM AMOSTRA no modo anexado: nenhum pong voltou');
  } else {
    lines.push('--- latência (ping → pong) ------------------------------------------');
    row('p50 / p95 / p99', `${report.latencyMs.p50} / ${report.latencyMs.p95} / ${report.latencyMs.p99} ms`);
    row('máximo', `${report.latencyMs.max} ms`);
  }

  lines.push('--- nó de jogo (/metrics) -------------------------------------------');
  row('sessões vistas', report.server.sessionsSeen === null ? 'indisponível' : String(report.server.sessionsSeen));
  row(
    'memória por sessão',
    report.server.heapBytesPerSession === null
      ? 'indisponível (o heap encolheu entre as leituras: o coletor rodou)'
      : `${(report.server.heapBytesPerSession / 1024).toFixed(1)} KiB`,
  );
  if (report.server.heapBytesPerSession !== null && (report.server.sessionsBefore ?? 0) > 0) {
    // O crescimento do heap durante a rodada é das sessões que já estavam lá também.
    row('  aviso', `contaminado: o nó já tinha ${report.server.sessionsBefore} sessões`);
  }
  row(
    'custo de tick médio',
    report.server.tickDurationUs === null ? 'indisponível' : `${report.server.tickDurationUs.toFixed(1)} µs`,
  );

  return lines.join('\n');
}

/**
 * Custo MARGINAL de memória: o que o heap cresceu, dividido pelas sessões que apareceram.
 *
 * `null` quando não dá para saber — sem leitura, sem sessão nova, ou com o heap tendo
 * ENCOLHIDO entre as duas medidas, o que acontece quando o coletor roda no meio. Nesse caso
 * o número honesto é "não sei", e não um negativo ou um zero que parece medição.
 *
 * **E ele só vale num nó VAZIO.** Com sessões já rodando, o crescimento do heap durante a
 * rodada é das que já estavam lá também, e dividir tudo pelas novas atribui a elas um custo
 * que não é delas — foi assim que uma medida deu 168 KiB por sessão anexada com mil sessões
 * desanexadas simulando ao lado. O relatório avisa; a medida confiável de memória por sessão
 * é o `pnpm bench:hunts`, que conta os objetos da simulação direto.
 */
function marginalHeap(server: ServerMeasurement): number | null {
  const { before, after } = server;
  if (before.heapBytes === null || after.heapBytes === null) return null;
  const sessions = (after.sessions ?? 0) - (before.sessions ?? 0);
  const grown = after.heapBytes - before.heapBytes;
  if (sessions <= 0 || grown <= 0) return null;
  return Math.round(grown / sessions);
}

const round = (value: number): number => Math.round(value * 10) / 10;
