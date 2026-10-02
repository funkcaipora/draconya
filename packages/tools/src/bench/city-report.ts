// O relatório do `bench:city` (OW-07, #828): máquina, tabela e leitura.
//
// Puro na entrada e na saída — recebe as rodadas já medidas e devolve linhas de texto. Quem faz
// `console.log` é `city-broadcast.ts`. Mora num módulo à parte para o teste do CI montar o relatório
// inteiro a partir de uma rodada curta: a tabela que vira documentação não pode quebrar sem que
// nenhum teste perceba, como quebrou o bench anterior.

import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import { formatNumber, formatTable } from './city-metrics.js';
import type { TableFormat } from './city-metrics.js';
import { CYCLE_MS } from './city-scenario.js';
import type { CityRun } from './city-scenario.js';

/**
 * A máquina, em linhas. O número só vale com ela junto (ADR 0013): o ciclo é single-thread, então
 * quem decide é desempenho por core, e um core de Ampere, um de EPYC e um de M-series rendem valores
 * bem diferentes. A carga da máquina vai junto porque este bench roda em máquina de desenvolvimento,
 * e um p99 medido com outras coisas rodando é outro número.
 */
export function describeMachine(): string[] {
  const [core] = cpus();
  const [load] = loadavg();
  return [
    `plataforma          ${platform()} ${arch()}`,
    `cpu                 ${core?.model ?? 'desconhecida'} × ${cpus().length}`,
    `node                ${process.version}`,
    `memória total       ${formatNumber(totalmem() / 1024 ** 3, 1)} GiB`,
    `carga (1 min)       ${formatNumber(load ?? 0, 2)}  (acima de ~1 por core, o p99 não é de confiança)`,
  ];
}

const COLUMNS = [
  'jogadores', 'vizinhos', 'passos/s',
  'CPU p50 µs', 'CPU p99 µs', 'flush p50 µs', 'p99 / ciclo',
  'B/vis/s', 'B cod/vis/s', 'msg/vis/s', 'fila máx', 'quedas',
] as const;

/** Uma linha da tabela para cada rodada. */
export function reportRows(runs: readonly CityRun[]): string[][] {
  return runs.map((run) => {
    const { summary } = run;
    // Passos ACEITOS por jogador por segundo: o ideal é 1000 / passo (6,7 a 150 ms). Muito abaixo
    // quer dizer que o cenário ficou preso em parede ou em tile ocupado, e a linha mede outra coisa.
    const stepsPerSecond = summary.elapsedSeconds === 0 || run.scenario.players === 0
      ? 0
      : run.moves / run.scenario.players / summary.elapsedSeconds;
    return [
      formatNumber(run.scenario.players),
      formatNumber(run.neighbours, 1),
      formatNumber(stepsPerSecond, 1),
      formatNumber(summary.cpuUs.p50),
      formatNumber(summary.cpuUs.p99),
      formatNumber(summary.flushUs.p50),
      `${formatNumber(summary.cycleBudgetShare * 100, 1)} %`,
      formatNumber(summary.bytesPerViewerPerSecond),
      formatNumber(summary.encodedBytesPerViewerPerSecond),
      formatNumber(summary.messagesPerViewerPerSecond),
      formatNumber(summary.queue.max),
      formatNumber(summary.drops),
    ];
  });
}

export function reportTable(runs: readonly CityRun[], format: TableFormat = 'text'): string[] {
  return formatTable(COLUMNS, reportRows(runs), format);
}

/** O que cada coluna é, e o que invalida uma linha. Vai depois de todas as tabelas. */
export function readingGuide(queueLimit: number): string[] {
  return [
    `O ciclo é o do hospedeiro: ${CYCLE_MS} ms, um frame por visualizador. Todos os números abaixo`,
    'são por ciclo ou por visualizador, nunca da praça inteira.',
    '',
    '  vizinhos      quantos enxergam cada jogador (AOI); sem AOI seria jogadores − 1',
    '  passos/s      passos ACEITOS por jogador por segundo; o ideal é 1000 / passo da Cidade (6,7',
    '                a 150 ms). Espalhados deve chegar perto; no templo fica bem abaixo, porque tile',
    '                é exclusivo e quinhentas pessoas num salão só andam quando alguém sai da frente',
    '  CPU µs        CPU do ciclo (`process.cpuUsage`): os `walk` da janela + o `host.cycle`',
    '  flush p50     a parte da CPU que codifica e escreve o frame, no p50',
    '  p99 / ciclo   o p99 de CPU como fração dos 100 ms: 100 % é o nó sem folga nenhuma',
    '  B/vis/s       bytes do frame por visualizador por segundo (o uWS não comprime: o frame é o fio)',
    '  B cod/vis/s   bytes que o hospedeiro SERIALIZOU por visualizador por segundo: o cache de codificação',
    '                (OW-22) faz a mesma mensagem para N visualizadores custar uma codificação por ciclo,',
    '                então fica abaixo de B/vis/s; antes do OW-22 era igual a ele, menos o envelope de lote',
    '  msg/vis/s     mensagens por visualizador por segundo, contadas pelo `Viewer`',
    `  fila máx      a maior fila de um visualizador no instante do flush; o teto é ${queueLimit}`,
    '  quedas        visualizadores derrubados pelo teto de fila; diferente de 0, a linha não mede o jogo',
    '',
    'Quedas diferentes de 0 invalidam a linha: o cliente derrubado deixa de receber, e a média por',
    'visualizador fica subestimada (o divisor continua sendo todos os que entraram).',
    'O p99 só vale com a máquina quieta (veja a carga no cabeçalho), e a comparação antes/depois é',
    'sempre na mesma máquina e sob a mesma carga.',
  ];
}
