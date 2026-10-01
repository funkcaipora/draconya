import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeS2C } from '@draconya/protocol';
import { DEFAULT_MAX_QUEUED } from '@draconya/server';
import { CYCLE_MS, realContent, runCityScenario } from './city-scenario.js';
import type { CityRun, CityScenario } from './city-scenario.js';
import type { Content } from '@draconya/content';
import { reportRows, reportTable, readingGuide } from './city-report.js';

// O `bench:city` não roda no CI como número — a praça de 500 leva minutos. O que quebrou o bench
// anterior sem ninguém ver foi o CONTRATO: o hospedeiro passou a recusar o passo adiantado
// (FUN-122) e o relógio parado do bench fez todo `walk` depois do primeiro ser recusado, com a
// tabela ainda saindo bonita. Estes testes rodam o bench em modo CURTO pelo mesmo caminho do
// relatório, e prendem que a medição anda, conta o que o fio levou e fecha com o codec real.

const HERE = dirname(fileURLToPath(import.meta.url));

/** Uma praça sintética pequena, espalhada: rápida, e com o corte da AOI visível. */
const SQUARE: CityScenario = { label: 'espalhados', players: 24, size: 96, entryTiles: 48, spread: true };

describe('o relógio simulado do bench:city', () => {
  it('o ciclo do bench é o do hospedeiro (host.ts)', () => {
    // A constante do hospedeiro não é exportada; se ela mudar lá e não aqui, o bench passa a
    // medir um frame por ciclo que o jogo não manda.
    const host = readFileSync(resolve(HERE, '..', '..', '..', 'server', 'src', 'game', 'host.ts'), 'utf8');
    const declared = /const CYCLE_MS = (\d+);/.exec(host);
    expect(declared?.[1]).toBeDefined();
    expect(CYCLE_MS).toBe(Number(declared?.[1]));
  });

  it('o jogador anda no ritmo da Cidade: o passo aceito é 1000 / passo, e não só o primeiro', () => {
    // Mutação que mata: voltar o relógio para `now: () => 0`. O hospedeiro recusa todo `walk`
    // depois do primeiro e `passos/s` cai para perto de zero.
    const run = runCityScenario(SQUARE, { steps: 20, warmupSteps: 4, aoi: true });
    const stepsPerSecond = run.moves / SQUARE.players / run.summary.elapsedSeconds;
    const ideal = 1000 / run.stepMs;
    expect(run.stepMs).toBe(150);
    expect(stepsPerSecond).toBeGreaterThan(ideal * 0.8);
    expect(stepsPerSecond).toBeLessThanOrEqual(ideal + 1e-9);
  });
});

describe('o bench:city em modo curto', () => {
  const tapped: { id: string; frame: Uint8Array }[] = [];
  let run: CityRun;
  beforeAll(() => {
    run = runCityScenario(SQUARE, {
      steps: 20,
      warmupSteps: 4,
      aoi: true,
      tap: (id, frame) => { tapped.push({ id, frame: new Uint8Array(frame) }); },
    });
  }, 30_000);

  it('mede a janela pedida: 20 passos de 150 ms são 30 ciclos de 100 ms', () => {
    expect(run.summary.cycles).toBe(30);
    expect(run.summary.elapsedSeconds).toBeCloseTo(3);
  });

  it('o que contou é o que o codec real decodifica', () => {
    // O bench passa pelo `Viewer` de verdade; o socket só conta. Decodificar cada frame que
    // saiu e somar as mensagens tem de dar o que o próprio visualizador contou.
    expect(tapped.length).toBe(run.totals.frames);
    expect(tapped.reduce((sum, { frame }) => sum + frame.byteLength, 0)).toBe(run.totals.bytes);
    let decoded = 0;
    for (const { frame } of tapped) {
      const messages = decodeS2C(frame);
      expect(messages).not.toBeNull();
      decoded += messages?.length ?? 0;
    }
    expect(decoded).toBe(run.totals.messages);
    expect(run.totals.messages).toBeGreaterThan(0);
  });

  it('só vai para o fio, na janela medida, o que é de um visualizador que olha', () => {
    expect(new Set(tapped.map(({ id }) => id)).size).toBeLessThanOrEqual(SQUARE.players);
    expect(run.summary.bytesPerViewerPerSecond).toBeGreaterThan(0);
    expect(run.summary.messagesPerViewerPerSecond).toBeGreaterThan(0);
    // Bytes por quadro: o envelope de lote pesa na média, e quadro vazio não existe.
    expect(run.summary.bytesPerFrame).toBeGreaterThan(0);
  });

  it('CPU por ciclo é positiva e a fila fica sob o teto sem derrubar ninguém', () => {
    expect(run.summary.cpuUs.p50).toBeGreaterThan(0);
    expect(run.summary.cpuUs.p99).toBeGreaterThanOrEqual(run.summary.cpuUs.p50);
    expect(run.summary.flushUs.p50).toBeGreaterThan(0);
    expect(run.queueLimit).toBe(DEFAULT_MAX_QUEUED);
    expect(run.summary.queue.max).toBeGreaterThan(0);
    expect(run.summary.queue.max).toBeLessThanOrEqual(run.queueLimit);
    expect(run.summary.drops).toBe(0);
  });

  it('com AOI cada jogador tem menos vizinhos e a praça manda menos mensagens que sem AOI', () => {
    // O grupo de controle (a sessão inteira, que o FUN-33 substituiu) continua medível.
    const control = runCityScenario(SQUARE, { steps: 20, warmupSteps: 4, aoi: false });
    expect(control.neighbours).toBe(SQUARE.players - 1);
    expect(run.neighbours).toBeLessThan(control.neighbours);
    expect(run.totals.messages).toBeLessThan(control.totals.messages);
  });

  it('um visualizador que estoura o teto de fila é contado como queda, e a tabela mostra', () => {
    // Sem AOI cada passo vai para os 23 outros; com o teto em 5, quem acumula mais que isso entre
    // dois flushes cai — que é o que invalida uma linha de verdade, e o que `quedas` conta.
    const starved = runCityScenario(SQUARE, {
      steps: 20, warmupSteps: 4, aoi: false, maxQueued: 5,
    });
    expect(starved.queueLimit).toBe(5);
    expect(starved.summary.drops).toBeGreaterThan(0);
    expect(starved.summary.drops).toBeLessThanOrEqual(SQUARE.players);
    expect(reportRows([starved])[0]?.[10]).toBe(String(starved.summary.drops));
    expect(run.summary.drops).toBe(0);
  });

  it('o relatório monta a tabela em texto e em markdown, uma linha por rodada', () => {
    const text = reportTable([run]);
    expect(text).toHaveLength(3);
    expect(text[0]).toContain('CPU p99 µs');
    expect(text[0]).toContain('B/vis/s');
    expect(text[0]).toContain('fila máx');
    const markdown = reportTable([run], 'markdown');
    expect(markdown[0]?.startsWith('| jogadores')).toBe(true);
    expect(markdown).toHaveLength(3);
    const [row] = reportRows([run]);
    expect(row).toHaveLength(11);
    expect(row?.[0]).toBe('24');
    expect(readingGuide(run.queueLimit).join('\n')).toContain(`o teto é ${run.queueLimit}`);
  });
});

describe('o bench:city na Thais real, em modo curto', () => {
  // O caminho padrão do bench: o conteúdo de verdade, no templo e espalhados. É o que carrega o
  // `data/` inteiro, então este arquivo carrega uma vez só e roda os dois cenários.
  let content: Content;
  beforeAll(() => { content = realContent(); }, 60_000);

  it('o templo: todo mundo chega no mesmo punhado de tiles e o leque é a praça inteira', () => {
    const run = runCityScenario(
      { label: 'templo', players: 30, size: 0, thais: true, entryTiles: 120 },
      { steps: 10, warmupSteps: 2, aoi: true, content },
    );
    expect(run.summary.cycles).toBe(15);
    expect(run.summary.drops).toBe(0);
    // Trinta pessoas num templo se enxergam quase todas: a AOI não tem o que cortar na hora do login.
    expect(run.neighbours).toBeGreaterThan(20);
    expect(run.totals.messages).toBeGreaterThan(0);
  }, 30_000);

  it('espalhados: cada um caminha até um alvo a pé antes de a medição começar', () => {
    const run = runCityScenario(
      { label: 'espalhados', players: 30, size: 0, thais: true, entryTiles: 120, spread: true },
      { steps: 10, warmupSteps: 2, aoi: true, content },
    );
    expect(run.summary.drops).toBe(0);
    expect(run.moves).toBeGreaterThan(0);
    // Espalhados, a AOI corta: bem menos que os 29 outros enxergam cada um.
    expect(run.neighbours).toBeLessThan(25);
  }, 60_000);
});
