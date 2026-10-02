// Agregador de métricas do `bench:city` (OW-07, #828).
//
// PURO: recebe amostras e devolve números. Não mede nada, não lê relógio, não escreve na tela —
// quem mede é `city-scenario.ts`, e quem imprime é `city-broadcast.ts`. A separação existe para
// que a conta que vira número de documentação seja testável sem subir a Cidade: percentil errado
// por um índice é o tipo de defeito que o relatório esconde, porque o número continua parecendo
// razoável.
//
// O que se mede é o CUSTO DO LEQUE de saída da praça compartilhada: cada passo de um jogador vira
// uma mensagem para cada vizinho. O ADR 0060 aposta que esse leque, e não a CPU do `sim`, é o que
// cede primeiro quando o mundo enche. A linha de base (OW-07) codificava cada mensagem uma vez por
// destinatário; o OW-22 a codifica uma vez por ciclo, e a coluna `B cod/vis/s` é o que separa os
// dois números — bytes ENTREGUES (o fio, que não muda) e bytes SERIALIZADOS (a CPU, que cai).

/** A janela de percentis que o relatório publica. */
export interface Distribution {
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

/** O que um ciclo do hospedeiro (100 ms) custou e deixou represado. */
export interface CycleSample {
  /** CPU do ciclo inteiro em µs: `handle` + `flush`. */
  readonly cpuUs: number;
  /** A parte que enfileira: os `walk` que chegaram na janela (movimento, AOI, montar mensagem). */
  readonly handleUs: number;
  /** A parte que codifica e escreve: `host.cycle` (recolhimento de repouso + flush). */
  readonly flushUs: number;
  /** A maior fila entre os visualizadores, no instante do flush, antes de ele esvaziá-la. */
  readonly queueMax: number;
}

/** O que sai de uma rodada, em bruto. */
export interface RunInput {
  readonly samples: readonly CycleSample[];
  /** Quantos visualizadores olhavam a praça. É o divisor das taxas "por visualizador". */
  readonly viewers: number;
  /** Duração de um ciclo, em ms de relógio SIMULADO — o `CYCLE_MS` do hospedeiro. */
  readonly cycleMs: number;
  /** Bytes escritos no socket: o frame, sem o cabeçalho do WebSocket (o uWS não comprime). */
  readonly bytes: number;
  /**
   * Bytes que o hospedeiro SERIALIZOU na janela (`SessionHost.encodeStats`, OW-22): os frames que o
   * cache de codificação produziu, e não os que entregou. Sem o cache — a linha de base do OW-07 —
   * seria igual aos bytes de mensagem entregues, porque cada destinatário codificava a sua cópia.
   */
  readonly encodedBytes: number;
  /** Mensagens que couberam nesses frames, contadas pelo próprio visualizador. */
  readonly messages: number;
  /** Quadros escritos: um por visualizador por ciclo em que havia o que mandar. */
  readonly frames: number;
  /** Visualizadores derrubados pelo teto de fila: o número que invalida a linha quando não é 0. */
  readonly drops: number;
}

export interface RunSummary {
  readonly cycles: number;
  /** Tempo SIMULADO coberto pelas amostras. */
  readonly elapsedSeconds: number;
  readonly cpuUs: Distribution;
  readonly handleUs: Distribution;
  readonly flushUs: Distribution;
  /** A maior fila de cada flush, em distribuição: o `max` é o que se compara ao teto. */
  readonly queue: Distribution;
  readonly bytesPerViewerPerSecond: number;
  /** Bytes serializados por visualizador por segundo: o que a CPU codificou, e não o que foi ao fio. */
  readonly encodedBytesPerViewerPerSecond: number;
  readonly messagesPerViewerPerSecond: number;
  readonly framesPerViewerPerSecond: number;
  /** Bytes por quadro escrito: o quanto o envelope de lote pesa na média. */
  readonly bytesPerFrame: number;
  /** O p99 de CPU do ciclo como fração do ciclo: 1 é o nó sem folga nenhuma. */
  readonly cycleBudgetShare: number;
  readonly drops: number;
}

/**
 * Percentil por posto mais próximo (nearest-rank): o menor valor tal que ao menos `p`% das
 * amostras são menores ou iguais a ele. Sem interpolação de propósito — o p99 de 300 ciclos
 * tem de ser um ciclo que de fato aconteceu, e não uma média entre dois.
 *
 * `p` em 0–100. Vazio devolve 0: uma rodada sem ciclo não tem percentil, e o relatório precisa
 * imprimir alguma coisa em vez de `NaN`.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { p50: 0, p99: 0, max: 0, mean: 0 };
  let sum = 0;
  let max = -Infinity;
  for (const value of values) {
    sum += value;
    if (value > max) max = value;
  }
  return {
    p50: percentile(values, 50),
    p99: percentile(values, 99),
    max,
    mean: sum / values.length,
  };
}

export function summarize(input: RunInput): RunSummary {
  const { samples, viewers, cycleMs, bytes, encodedBytes, messages, frames, drops } = input;
  const elapsedSeconds = (samples.length * cycleMs) / 1000;
  // Sem tempo ou sem visualizador não há taxa: 0, e não `Infinity`.
  const perViewerSecond = (total: number): number => (
    elapsedSeconds === 0 || viewers === 0 ? 0 : total / viewers / elapsedSeconds
  );
  const cpuUs = distribution(samples.map((sample) => sample.cpuUs));
  return {
    cycles: samples.length,
    elapsedSeconds,
    cpuUs,
    handleUs: distribution(samples.map((sample) => sample.handleUs)),
    flushUs: distribution(samples.map((sample) => sample.flushUs)),
    queue: distribution(samples.map((sample) => sample.queueMax)),
    bytesPerViewerPerSecond: perViewerSecond(bytes),
    encodedBytesPerViewerPerSecond: perViewerSecond(encodedBytes),
    messagesPerViewerPerSecond: perViewerSecond(messages),
    framesPerViewerPerSecond: perViewerSecond(frames),
    bytesPerFrame: frames === 0 ? 0 : bytes / frames,
    cycleBudgetShare: cycleMs === 0 ? 0 : cpuUs.p99 / (cycleMs * 1000),
    drops,
  };
}

// --- tabela ----------------------------------------------------------------------------------

export type TableFormat = 'text' | 'markdown';

/**
 * Tabela alinhada. Em texto, o cabeçalho e as linhas vão em colunas de largura fixa; em
 * markdown, sai pronta para colar em `docs/product/` — que é o destino da medição, e copiar
 * número de um terminal para a documentação é onde ele troca de casa decimal.
 *
 * Todas as colunas alinham à direita: o que se tabela aqui é número.
 */
export function formatTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  format: TableFormat = 'text',
): string[] {
  if (format === 'markdown') {
    return [
      `| ${header.join(' | ')} |`,
      `|${header.map(() => '---:').join('|')}|`,
      ...rows.map((row) => `| ${row.join(' | ')} |`),
    ];
  }
  const widths = header.map((title, column) => Math.max(
    title.length,
    ...rows.map((row) => (row[column] ?? '').length),
  ));
  const line = (cells: readonly string[]): string => cells
    .map((cell, column) => cell.padStart(widths[column] ?? 0))
    .join('  ');
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)];
}

const numberFormats = new Map<number, Intl.NumberFormat>();

/** Número em pt-BR (vírgula decimal), como o resto da documentação do projeto. */
export function formatNumber(value: number, fractionDigits = 0): string {
  let format = numberFormats.get(fractionDigits);
  if (format === undefined) {
    format = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
    });
    numberFormats.set(fractionDigits, format);
  }
  return format.format(value);
}
