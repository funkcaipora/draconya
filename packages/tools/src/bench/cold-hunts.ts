// Cenário frio: milhares de hunts desanexadas (FUN-46).
//
// **É a medição que decide se a arquitetura está certa**, e o único número do projeto que não
// dá para derivar de fora. Toda a projeção de custo depende do custo de tick por instância; se
// o número real estourar a projeção por uma ordem de grandeza, é aqui que a arquitetura muda —
// e não depois de cinco meses de conteúdo empilhado em cima.
//
//   pnpm bench:hunts                 # 5.000 hunts, o cenário da issue
//   HUNTS=500 MINUTES=1 pnpm bench:hunts
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
import { buildContent } from '@draconya/content';
import type { Content } from '@draconya/content';
import { CharacterRuntime, createHuntSession, statsForLevel } from '@draconya/sim';
import type { HuntRuleset } from '@draconya/sim';
import type { Session } from '@draconya/sim';

const HUNTS = Number(process.env['HUNTS'] ?? 5_000);
/** Minutos SIMULADOS, não de espera: o relógio é parâmetro (invariante 1). */
const MINUTES = Number(process.env['MINUTES'] ?? 10);
/** Desanexada roda a 1 Hz (ADR 0003). É o cenário da issue. */
const HZ = Number(process.env['HZ'] ?? 1);

// --- o conteúdo do cenário -------------------------------------------------------------------
//
// Montado aqui, e não lido de `packages/content/data`, porque a medição precisa de uma
// instância CHEIA: a Rat Cellars de hoje tem 2 monstros por ponto em 4 pontos, e medir 8
// monstros diria pouco sobre as 10–40 que a issue pede.

const SIZE = 24;
const grid = Array.from({ length: SIZE }, (_, y) =>
  Array.from({ length: SIZE }, (_, x) => {
    if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) return '#';
    // Paredes espalhadas pelo MIOLO: caminho livre demais não exercita o desvio, que é o ramo
    // mais caro do passo guloso. O anel de fora fica limpo porque é por onde a rota passa — a
    // validação da FUN-9 recusa rota em cima de parede, e com razão.
    const inside = x >= 3 && x <= SIZE - 4 && y >= 3 && y <= SIZE - 4;
    return inside && x % 7 === 3 && y % 5 !== 0 ? '#' : '.';
  }).join(''));

/** Um laço retangular pelo miolo do mapa, sem encostar nas paredes espalhadas. */
function loop(): Array<{ x: number; y: number; z: number }> {
  const tiles: Array<{ x: number; y: number; z: number }> = [];
  const lo = 1;
  const hi = SIZE - 2;
  for (let x = lo; x < hi; x++) tiles.push({ x, y: lo, z: 7 });
  for (let y = lo; y < hi; y++) tiles.push({ x: hi, y, z: 7 });
  for (let x = hi; x > lo; x--) tiles.push({ x, y: hi, z: 7 });
  for (let y = hi; y > lo; y--) tiles.push({ x: lo, y, z: 7 });
  return tiles;
}

const tiles = loop();
// Um ponto de spawn a cada oito tiles, com 4 monstros cada: 40 monstros na instância, o topo
// da faixa que a issue pede.
const spawnPoints = tiles
  .map((_, index) => index)
  .filter((index) => index % 8 === 0)
  .slice(0, 10)
  .map((routeIndex) => ({ routeIndex, radius: 3 }));

function scenario(): Content {
  return buildContent({
    monsters: [{
      id: 'rat', name: 'Rat', recommendedLevel: 1,
      health: 200, experience: 5, attack: 4, armor: 0,
      attackIntervalMs: 2_000, speed: 300, aggroRadius: 8, attackRange: 1,
    }],
    hunts: [{
      id: 'cold', name: 'Cold', recommendedLevel: 1, mapId: 'cold', routeId: 'cold-loop',
      difficulties: {
        reckless: {
          monsterCount: 40,
          composition: [{ monsterId: 'rat', weight: 1 }],
          respawnDelayMs: 30_000,
        },
      },
    }],
    vocations: [],
    progression: [{
      id: 'baseline', startingHealth: 1_000_000, startingMana: 0, startingCapacity: 400,
      healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
      startingSpeed: 300, speedPerLevel: 0, regen: { healthPerSecond: 1, manaPerSecond: 1 },
      xp: { base: 20, exponent: 2 },
      deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
    }],
    combat: [{
      id: 'baseline', dodgeMultiplier: 0.5, armorEffectiveness: { melee: 1, magic: 0 },
      minimumDamageFraction: 0.1,
      player: {
        attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0.05,
      },
    }],
    stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
    // O bot é o produto (invariante 11): sem `bot/baseline.json` o conteúdo não monta.
    bot: [{ id: 'baseline', vocabularyVersion: 1, categoryCooldownMs: 1000, advancedFromLevel: 50,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }],
    maps: [{ id: 'cold', z: 7, grid }],
    routes: [{ id: 'cold-loop', mapId: 'cold', tiles, spawnPoints }],
  });
}

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
const content = scenario();
const stats = statsForLevel(1, null, content.progression);

const before = heapMb();
const sessions: Session[] = [];
for (let i = 0; i < HUNTS; i++) {
  const session = createHuntSession({
    id: `cold-${i}`, content, huntId: 'cold', difficulty: 'reckless', createdAtMs: 0,
  });
  session.enter(new CharacterRuntime({
    id: `p${i}`, position: { x: 0, y: 0, z: 7 },
    health: stats.maxHealth, maxHealth: stats.maxHealth, mana: 0, maxMana: stats.maxMana,
    level: 1, xp: 0, vocationId: null, staminaMs: 86_400_000, staminaUpdatedAtMs: 0,
    goldDelta: 0, alive: true, cooldowns: {},
  }));
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
console.log(`hunts               ${HUNTS.toLocaleString('pt-BR')} desanexadas a ${HZ} Hz`);
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
console.log(`por tick/instância  ${perTickUs.toFixed(1)} µs`);
console.log(`instâncias por core ${Math.floor(1 / coreFraction).toLocaleString('pt-BR')} a ${HZ} Hz`);
console.log(`memória por sessão  ${perSessionKb.toFixed(1)} KiB`);
console.log(`snapshot por sessão ${(snapshotBytes / 1024).toFixed(1)} KiB`);
console.log(`heap ao fim         ${afterRun.toFixed(0)} MiB`);
console.log(`gc                  ${gcPauseMs.toFixed(0)} ms no total, pico de ${gcPeakMs.toFixed(1)} ms`);
