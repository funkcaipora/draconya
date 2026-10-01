// Quanto custa a praça compartilhada: CPU, bytes e fila do leque de saída (FUN-33, OW-07).
//
// **É a linha de base do leque.** Cada passo de um jogador vira uma mensagem para cada vizinho,
// codificada uma vez por destinatário no `Viewer`; o ADR 0060 aposta que é isso, e não a CPU do
// `sim`, que cede primeiro quando o mundo enche (OW-22 vem depois e precisa de um antes para
// comparar). O FUN-33 contava só mensagens; aqui cada cenário reporta, por ciclo e por
// visualizador, o que o nó de fato gasta:
//
//   µs de CPU por ciclo (p50 e p99)     o `walk` que chega + o `host.cycle`
//   bytes por visualizador por segundo  o frame, pelo mesmo codec do jogo
//   fila máxima por flush               contra o teto do `Viewer`
//
//   pnpm bench:city                      # a Thais real: no templo e espalhados; 100, 200 e 500
//   PLAYERS=1000 STEPS=100 pnpm bench:city
//   MAP=square pnpm bench:city           # a praça sintética do FUN-33, sem a Thais
//   AOI=both pnpm bench:city             # com AOI e com a transmissão para a sessão inteira
//   FORMAT=markdown pnpm bench:city      # a tabela pronta para colar em docs/product/
//   REPEAT=3 pnpm bench:city             # cada linha é a melhor de 3 rodadas (máquina ocupada)
//
// **O número só vale com a máquina junto** (ADR 0013): o relatório imprime plataforma, CPU, versão
// do Node e a carga no momento da medição. Medir no laptop e extrapolar para o servidor erra.
//
// Esta é só a borda — lê o ambiente e imprime. A medição vive em `city-scenario.ts`, a conta em
// `city-metrics.ts` e a tabela em `city-report.ts`; o teste do CI roda os três em modo curto.

import { DEFAULT_MAX_QUEUED } from '@draconya/server';
import { realContent, runCityScenario } from './city-scenario.js';
import type { CityRun, CityScenario } from './city-scenario.js';
import { readingGuide, describeMachine, reportTable } from './city-report.js';
import type { TableFormat } from './city-metrics.js';

const PLAYERS = process.env['PLAYERS'] === undefined
  ? [100, 200, 500]
  : process.env['PLAYERS'].split(',').map(Number);
/** Passos por jogador na janela medida. 200 passos a 150 ms são 300 ciclos: o p99 é o 3º pior. */
const STEPS = Number(process.env['STEPS'] ?? 200);
/** Passos por jogador descartados antes de medir: o aquecimento do JIT não é detalhe. */
const WARMUP = Number(process.env['WARMUP'] ?? 30);
/** `thais` (padrão) mede a Thais real do conteúdo; `square` a praça sintética do FUN-33. */
const MAP = process.env['MAP'] ?? 'thais';
const THAIS = MAP !== 'square';
const AOI = process.env['AOI'] ?? 'on';
const FORMAT: TableFormat = process.env['FORMAT'] === 'markdown' ? 'markdown' : 'text';
/**
 * Rodadas por linha. Numa máquina com outras coisas rodando o p99 mede a máquina, e o que se
 * publica é a MELHOR rodada (a de menor p50 de CPU): a menos perturbada, que é a que se compara
 * com a de depois. `REPEAT=1` (padrão) é a medição única.
 */
const REPEAT = Math.max(1, Number(process.env['REPEAT'] ?? 1));

const content = THAIS ? realContent() : undefined;

function group(title: string, scenarios: readonly CityScenario[], aoi: boolean): void {
  const runs: CityRun[] = scenarios.map((scenario) => {
    let best: CityRun | undefined;
    for (let attempt = 0; attempt < REPEAT; attempt++) {
      const run = runCityScenario(scenario, {
        steps: STEPS, warmupSteps: WARMUP, aoi, ...(content === undefined ? {} : { content }),
      });
      if (best === undefined || run.summary.cpuUs.p50 < best.summary.cpuUs.p50) best = run;
    }
    return best as CityRun;
  });
  const mode = aoi ? 'difusão por AOI' : 'difusão para a sessão inteira (grupo de controle)';
  console.log(FORMAT === 'markdown' ? `**${title}** — ${mode}` : `--- ${title} — ${mode} ${'-'.repeat(8)}`);
  console.log('');
  for (const line of reportTable(runs, FORMAT)) console.log(line);
  const ratios = runs.map((run) => run.cpuToWall);
  console.log('');
  console.log(`CPU / parede da janela medida: ${ratios.map((ratio) => ratio.toFixed(2)).join(', ')}`);
  console.log('');
}

const modes = AOI === 'both' ? [true, false] : [AOI !== 'off'];

console.log('--- máquina ---------------------------------------------------------');
for (const line of describeMachine()) console.log(line);
console.log('');
console.log('--- cenário ---------------------------------------------------------');
console.log(`mapa                ${THAIS ? 'Thais real (data/city/city.json)' : 'praça sintética'}`);
console.log(`passos por jogador  ${STEPS} medidos, ${WARMUP} de aquecimento`);
console.log(`rodadas por linha   ${REPEAT}${REPEAT > 1 ? ' (vale a de menor p50 de CPU)' : ''}`);
console.log('');

for (const aoi of modes) {
  if (THAIS) {
    // A Thais real (FUN-120): todo mundo chegando no templo — a hora do login —, e depois
    // espalhados pelas ruas, cada um num alvo alcançável a pé a intervalos iguais da entrada.
    group('THAIS: todo mundo no templo, como na hora do login',
      PLAYERS.map((players) => ({
        label: 'templo', players, size: 0, thais: true, entryTiles: players * 4,
      })), aoi);
    group('THAIS: as pessoas espalhadas pelas ruas',
      PLAYERS.map((players) => ({
        label: 'espalhados', players, size: 0, thais: true, entryTiles: players * 4, spread: true,
      })), aoi);
  } else {
    group('a praça de HOJE: um ponto de entrada, e todo mundo em cima dele',
      PLAYERS.map((players) => ({ label: 'praça', players, size: 128 })), aoi);
    group('a praça COM LUGARES: as pessoas espalhadas por ela',
      // Mapa proporcional à população, e cada um caminha até um destino próprio antes de a
      // contagem começar: é a praça com loja, depósito e ruas, em que ninguém fica em cima de
      // ninguém.
      PLAYERS.map((players) => ({
        label: 'espalhados',
        players,
        size: Math.round(Math.sqrt(players) * 14),
        entryTiles: players * 2,
        spread: true,
      })), aoi);
  }
}

for (const line of readingGuide(DEFAULT_MAX_QUEUED)) console.log(line);
