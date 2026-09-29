// O motor do cliente sintético de carga (FUN-45).
//
// Separado do `main` porque **módulo que executa ao ser importado é uma armadilha**: a
// primeira versão punha a chamada aqui, e importar `slice` num teste subia os workers e
// esperava a duração inteira — sessenta segundos para rodar treze asserções puras.
//
// **Fala o protocolo, não o DOM.** Sem Playwright, sem navegador headless: não dá para subir
// cinco mil Chromes, e mesmo que desse mediria o custo do navegador — que não é a pergunta.
//
// O que ele mede de um lado e o que lê do outro:
//
//   do CLIENTE   bytes/s, frames/s, latência de ping→pong, tempo de entrada
//   do SERVIDOR  memória por sessão e custo de tick, lidos do `/metrics` do nó (FUN-47)
//
// A divisão não é arbitrária: memória por sessão é do servidor, e estimá-la do lado de fora
// seria inventar. Ler do próprio nó que está sob carga fecha o laço com a FUN-47.

import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ArgumentError, USAGE, parseArguments, type LoadOptions } from './args.js';
import {
  buildReport, formatReport, type ServerSnapshot, type SessionSample,
} from './report.js';

const WORKER = fileURLToPath(new URL('./worker.ts', import.meta.url));

/**
 * Lê o `/metrics` do nó de jogo e tira dele o que o cliente não consegue saber.
 *
 * Falha em silêncio de propósito — devolvendo `null`, que o relatório imprime como
 * "indisponível". O nó pode estar atrás de rede, ou nem ter métrica; nada disso justifica
 * perder a rodada de carga inteira depois de dez minutos.
 */
async function scrapeServer(metricsUrl: string | null): Promise<ServerSnapshot> {
  const empty: ServerSnapshot = { heapBytes: null, sessions: null, tickDurationUs: null };
  if (metricsUrl === null) return empty;
  try {
    const response = await fetch(`${metricsUrl}/metrics`);
    if (!response.ok) return empty;
    const text = await response.text();

    const value = (pattern: RegExp): number | null => {
      const match = pattern.exec(text);
      return match?.[1] === undefined ? null : Number(match[1]);
    };
    const sessions = [...text.matchAll(/^draconya_sessions_active\{[^}]*\} ([\d.e+-]+)$/gm)]
      .reduce((total, match) => total + Number(match[1]), 0);
    const sum = value(/^draconya_tick_duration_us_sum\{[^}]*\} ([\d.e+-]+)$/m);
    const count = value(/^draconya_tick_duration_us_count\{[^}]*\} ([\d.e+-]+)$/m);

    return {
      heapBytes: value(/^nodejs_heap_size_used_bytes\{[^}]*\} ([\d.e+-]+)$/m),
      sessions: sessions === 0 ? null : sessions,
      // Média a partir do histograma. É a única coisa que dá para tirar do texto exposto sem
      // reimplementar o cálculo de quantil — e o quantil de verdade fica no Prometheus, que é
      // onde ele deve estar.
      tickDurationUs: sum === null || count === null || count === 0 ? null : sum / count,
    };
  } catch {
    return empty;
  }
}

/** Divide N sessões em `workers` fatias, sem perder nem inventar nenhuma no arredondamento. */
export function slice(sessions: number, workers: number): number[] {
  const base = Math.floor(sessions / workers);
  const extra = sessions % workers;
  return Array.from({ length: workers }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * A divisão com parties (#198): uma party NÃO atravessa workers — cada worker recebe fatias
 * inteiras de `party` sessões, e a sobra (`sessions % party`) entra solo no último. Dividir
 * as sessões cruas e deixar cada worker agrupar as suas quebrava parties no meio: 20 sessões
 * em 2 workers de 10 davam 2 parties + 2 solos POR worker, e o relatório dizia "5 de 4".
 */
export function slicePartied(sessions: number, workers: number, party: number): number[] {
  if (party <= 1) return slice(sessions, workers);
  const parties = Math.floor(sessions / party);
  const shares = slice(parties, workers).map((n) => n * party);
  const solo = sessions - parties * party;
  shares[shares.length - 1] = (shares[shares.length - 1] ?? 0) + solo;
  return shares;
}

async function runWorker(options: LoadOptions, sessions: number): Promise<SessionSample[]> {
  return new Promise((resolve) => {
    const child = fork(WORKER, [], {
      // O worker é TypeScript, como todo código first-party (ADR 0016). Sem o carregador ele
      // subiria e morreria num erro de sintaxe que não menciona TypeScript em lugar nenhum.
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const samples: SessionSample[] = [];
    child.on('message', (result: { samples: SessionSample[] }) => {
      samples.push(...result.samples);
    });
    child.on('exit', () => { resolve(samples); });
    child.send({
      apiUrl: options.apiUrl,
      sessions,
      mode: options.mode,
      durationMs: options.durationMs,
      huntId: options.huntId,
      party: options.party,
      shareCosts: options.shareCosts,
      splitLoot: options.splitLoot,
      difficulty: options.difficulty,
      pingIntervalMs: options.pingIntervalMs,
      rampMs: options.rampMs,
    });
  });
}

export async function runLoad(): Promise<number> {
  let options: LoadOptions;
  try {
    options = parseArguments(process.argv.slice(2), cpus().length);
  } catch (error) {
    if (!(error instanceof ArgumentError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 1;
  }

  const shares = slicePartied(options.sessions, options.workers, options.party);
  console.error(
    `abrindo ${options.sessions} sessões em ${options.workers} worker(s), modo ${options.mode}…`,
  );

  // ANTES de abrir qualquer sessão: é a linha de base do processo, e sem ela a memória por
  // sessão vira o heap inteiro dividido pelas sessões — incluindo tudo o que o `api` e o
  // `jobs` gastam sem ter sessão nenhuma.
  const before = await scrapeServer(options.metricsUrl);
  const samples = (await Promise.all(shares.map((share) => runWorker(options, share)))).flat();
  // Lido DEPOIS da rodada, com as sessões ainda de pé: durante a rampa o número estaria
  // subindo, e um heap medido no meio da subida não é memória por sessão de coisa nenhuma.
  const after = await scrapeServer(options.metricsUrl);

  const report = buildReport({
    sessions: options.sessions,
    mode: options.mode,
    durationMs: options.durationMs,
    workers: options.workers,
    apiUrl: options.apiUrl,
    huntId: options.huntId,
    difficulty: options.difficulty,
    party: options.party,
    shareCosts: options.shareCosts,
    splitLoot: options.splitLoot,
  }, samples, { before, after });

  console.log(formatReport(report));
  if (options.json !== null) {
    writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`relatório em ${options.json}`);
  }

  // Sessão que não abriu é falha da rodada, não detalhe: um relatório verde com metade das
  // sessões mortas é pior que um vermelho.
  return report.sessions.failed > 0 ? 1 : 0;
}
