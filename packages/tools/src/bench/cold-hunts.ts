// Cenário frio: milhares de hunts desanexadas (FUN-46). Desde o CMB-10 (#336) o mesmo relatório
// roda também o CENÁRIO MISTO de combate (`SCENARIO=combat`), que compõe ability, área,
// resistência, defesa, condição/campo e modificadores — o pipeline que o M19 entregou.
//
// **É a medição que decide se a arquitetura está certa**, e o único número do projeto que não
// dá para derivar de fora. Toda a projeção de custo depende do custo de tick por instância; se
// o número real estourar a projeção por uma ordem de grandeza, é aqui que a arquitetura muda —
// e não depois de cinco meses de conteúdo empilhado em cima.
//
//   pnpm bench:hunts                          # 5.000 hunts, o cenário frio da issue
//   HUNTS=500 MINUTES=1 pnpm bench:hunts
//   SCENARIO=combat pnpm bench:hunts          # o cenário misto do CMB-10
//
// **O número só vale com a máquina junto.** O tick é single-thread, então quem decide é
// desempenho por core, e um OCPU Ampere, um core de EPYC e um core M-series rendem valores
// bem diferentes (ADR 0013). Medir no laptop e extrapolar para o servidor erra — por isso o
// relatório imprime a arquitetura, e por isso ele não substitui uma rodada na máquina de
// destino.
//
// Mede quatro coisas, e a primeira não é necessariamente o gargalo:
//
//   custo de tick por instância   CPU, que é o que a projeção usa
//   memória por sessão            5.000 snapshots gordos é problema de RAM, não de CPU
//   tamanho de snapshot           o mesmo problema, do lado do Redis
//   pausa de GC                   pico importa tanto quanto média

import { performance, PerformanceObserver } from 'node:perf_hooks';
import { arch, cpus, platform, totalmem } from 'node:os';
import { CharacterRuntime, createHuntSession, statsForLevel } from '@draconya/sim';
import type { HuntRuleset } from '@draconya/sim';
import type { Session } from '@draconya/sim';
import { scenario } from './cold-scenario.js';
import {
  COMBAT_DIFFICULTY, COMBAT_HUNT_ID, combatCharacter, combatScenario,
} from './combat-scenario.js';

const HUNTS = Number(process.env['HUNTS'] ?? 5_000);
/**
 * Personagens por instância (#407, ADR 0033 D12): 1 é o solo de sempre; 8 é o teto que o M20
 * introduz. É a medição dos laços de até 8 por abate, supply e golpe que o plano §5 prevê.
 */
const PARTY = Math.max(1, Number(process.env['PARTY'] ?? 1));
/** Minutos SIMULADOS, não de espera: o relógio é parâmetro (invariante 1). */
const MINUTES = Number(process.env['MINUTES'] ?? 10);
/** Desanexada roda a 1 Hz (ADR 0003). É o cenário da issue. */
const HZ = Number(process.env['HZ'] ?? 1);
/** `cold` (o motor, FUN-46) ou `combat` (o pipeline do M19, CMB-10). */
const SCENARIO = process.env['SCENARIO'] ?? 'cold';
const COMBAT = SCENARIO === 'combat';

// --- medição ---------------------------------------------------------------------------------

/**
 * Memória depois de um GC forçado.
 *
 * Sem `--expose-gc` o número inclui lixo ainda não recolhido e superestima a sessão. O
 * relatório diz qual dos dois casos rodou, porque a diferença é grande o bastante para mudar
 * a conclusão sobre o gargalo ser RAM.
 */
function heapMb(): number {
  const forced = (globalThis as { gc?: () => void }).gc;
  if (forced !== undefined) forced();
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

let gcPauseMs = 0;
let gcPeakMs = 0;
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    gcPauseMs += entry.duration;
    gcPeakMs = Math.max(gcPeakMs, entry.duration);
  }
});
const content = COMBAT ? combatScenario() : scenario();
const stats = statsForLevel(1, null, content.progression);
const huntId = COMBAT ? COMBAT_HUNT_ID : 'cold';
const difficulty = COMBAT ? COMBAT_DIFFICULTY : 'reckless';
const sessionPrefix = COMBAT ? 'combat' : 'cold';

const characterFor = (i: number): CharacterRuntime => COMBAT
  ? combatCharacter(content, `p${i}`, { x: 0, y: 0, z: 7 })
  : new CharacterRuntime({
    id: `p${i}`, position: { x: 0, y: 0, z: 7 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: 0, maxMana: stats.maxMana,
    level: 1, xp: 0, vocationId: null, staminaMs: 86_400_000, staminaUpdatedAtMs: 0,
    goldDelta: 0, alive: true, cooldowns: {},
  });

const before = heapMb();
const sessions: Session[] = [];
for (let i = 0; i < HUNTS; i++) {
  const session = createHuntSession({
    id: `${sessionPrefix}-${i}`, content, huntId, difficulty, createdAtMs: 0,
  });
  // PARTY personagens por instância: o cenário do solo é `PARTY=1`, e o de 8 exercita os
  // laços por participante que o M20 acrescentou (#407).
  for (let p = 0; p < PARTY; p++) session.enter(characterFor(i * PARTY + p));
  sessions.push(session);
}

// Um avanço para povoar: os monstros nascem no primeiro, e medir antes disso mediria
// instâncias vazias — que é o cenário que não interessa a ninguém.
const stepMs = 1_000 / HZ;
for (const session of sessions) {
  session.advanceBy(stepMs);
  session.drainEvents();
}

const afterFirstTick = heapMb();

/**
 * Aquecimento, e ele NÃO é detalhe.
 *
 * A primeira versão deste arquivo mediu 51 µs num cenário pequeno e 12 µs no grande — a mesma
 * simulação, quatro vezes mais barata só porque o laço rodou o suficiente para o JIT otimizar.
 * Sem descartar o começo, o número medido dependeria do tamanho do cenário, e comparar duas
 * rodadas deixaria de significar coisa alguma.
 *
 * O alvo é contado em TICKS DE SESSÃO, não em ticks do laço: o que aquece o JIT é quantas
 * vezes o código rodou, e 60 ticks de 5.000 hunts são 300.000 execuções enquanto 60 ticks de
 * 300 hunts são 18.000.
 */
const WARMUP_SESSION_TICKS = 300_000;
const totalTicks = Math.round((MINUTES * 60_000) / stepMs);
const warmupTicks = Math.min(
  Math.ceil(WARMUP_SESSION_TICKS / HUNTS),
  Math.floor(totalTicks / 2),
);
let tick = 2;
for (; tick <= warmupTicks + 1; tick++) {
  for (const session of sessions) {
    session.advanceBy(stepMs);
    session.drainEvents();
  }
}

const ticks = totalTicks;
const measuredFrom = tick;

// O observador entra SÓ AGORA, e sai logo depois do laço. Ligado durante o aquecimento, ele
// contaria também os `gc()` que a medição de memória força — coletas maiores que qualquer
// natural, que apareciam como um pico de 315 ms e não eram do jogo.
//
// `{ type: 'gc' }`, e NÃO `{ entryTypes: ['gc'] }`: a segunda forma é aceita sem reclamar e
// não entrega entrada nenhuma no Node 24. O relatório imprimia "0 ms de GC" com cara de
// ótimo resultado, medindo coisa nenhuma.
observer.observe({ type: 'gc' });
const startedAt = performance.now();
const cpuAtStart = process.cpuUsage();
// Drena a cada avanço, como `SessionHost.cycle` faz haja ou não visualizador (FUN-69). Sem
// isto o bench mede um buffer de eventos que enche e descarta — cenário que produção não
// tem, porque o hospedeiro drena sempre.
for (; tick <= ticks; tick++) {
  for (const session of sessions) {
    session.advanceBy(stepMs);
    session.drainEvents();
  }
}
const elapsedMs = performance.now() - startedAt;
// CPU de verdade, ao lado da parede (#179): num laptop paginando, a parede mediu 380 µs por
// tick onde a CPU gastou 16 — e o relatório dizia "20× pior" sem avisar que a máquina, e não
// o código, era o problema. O número comparável continua sendo o de parede (é o que a
// projeção e as rodadas anteriores usam); o de CPU é o que diz se ele vale alguma coisa.
const cpu = process.cpuUsage(cpuAtStart);
const cpuMs = (cpu.user + cpu.system) / 1_000;
const measuredTicks = ticks - measuredFrom + 1;

// O observador entrega as entradas numa tarefa própria, e este script é síncrono do início ao
// fim: sem ceder o laço de eventos aqui, o relatório imprimia SEMPRE "0 ms de GC".
await new Promise((resolve) => { setTimeout(resolve, 50); });
observer.disconnect();
// Depois de desligar, para o `gc()` forçado não entrar na conta.
const afterRun = heapMb();

const perTickUs = (elapsedMs * 1_000) / (measuredTicks * HUNTS);
const perSessionKb = ((afterFirstTick - before) * 1024) / HUNTS;
const snapshotBytes = Buffer.byteLength(JSON.stringify(sessions[0]?.snapshot() ?? {}));
// Quanto de um core uma instância consome, com a taxa do cenário.
const coreFraction = (perTickUs / 1_000_000) * HZ;

let monsters = 0;
let kills = 0;
for (const session of sessions) {
  kills += session.aggregates.kills;
  monsters += (session.ruleset as HuntRuleset).monsters.length;
}

const [core] = cpus();
console.log('--- máquina ---------------------------------------------------------');
// O número não é comparável com nada sem isto (ADR 0013): o tick é single-thread, então quem
// decide é desempenho por core, e Ampere, EPYC e M-series rendem valores bem diferentes.
console.log(`plataforma          ${platform()} ${arch()}`);
console.log(`cpu                 ${core?.model ?? 'desconhecida'} × ${cpus().length}`);
console.log(`node                ${process.version}`);
console.log(`memória total       ${(totalmem() / 1024 ** 3).toFixed(1)} GiB`);
console.log(`gc forçado          ${(globalThis as { gc?: unknown }).gc !== undefined ? 'sim' : 'não (rode com --expose-gc para memória exata)'}`);

console.log('--- cenário ---------------------------------------------------------');
console.log(`cenário             ${SCENARIO}${COMBAT ? ' (pipeline de combate do M19)' : ' (motor, FUN-46)'}`);
console.log(`hunts               ${HUNTS.toLocaleString('pt-BR')} desanexadas a ${HZ} Hz`);
console.log(`party por sessão    ${PARTY}${PARTY > 1 ? ' (laços do M20)' : ''}`);
console.log(`monstros por hunt   ${(monsters / HUNTS).toFixed(1)} vivos ao fim`);
console.log(`simulado            ${MINUTES} min (${ticks.toLocaleString('pt-BR')} ticks)`);
console.log(`medidos             ${measuredTicks.toLocaleString('pt-BR')} (os ${warmupTicks} primeiros aquecem o JIT)`);
if (warmupTicks * HUNTS < WARMUP_SESSION_TICKS) {
  // Cenário pequeno demais para o JIT chegar ao regime. O número sai ALTO, e dizer isso é
  // melhor que publicá-lo como se fosse comparável.
  console.log('aviso               aquecimento curto; o custo por tick sai superestimado');
}
console.log(`abates              ${kills.toLocaleString('pt-BR')}`);

console.log('--- resultado -------------------------------------------------------');
console.log(`tempo de parede     ${(elapsedMs / 1_000).toFixed(1)} s`);
console.log(`cpu                 ${(cpuMs / 1_000).toFixed(1)} s (${((cpuMs / elapsedMs) * 100).toFixed(0)}% da parede)`);
if (cpuMs / elapsedMs < 0.8) {
  console.log('aviso               a CPU ficou ociosa: a máquina paginou ou disputou o core; o custo por tick não vale');
}
console.log(`por tick/instância  ${perTickUs.toFixed(1)} µs`);
console.log(`instâncias por core ${Math.floor(1 / coreFraction).toLocaleString('pt-BR')} a ${HZ} Hz`);
console.log(`memória por sessão  ${perSessionKb.toFixed(1)} KiB`);
console.log(`snapshot por sessão ${(snapshotBytes / 1024).toFixed(1)} KiB`);
console.log(`heap ao fim         ${afterRun.toFixed(0)} MiB`);
console.log(`gc                  ${gcPauseMs.toFixed(0)} ms no total, pico de ${gcPeakMs.toFixed(1)} ms`);
