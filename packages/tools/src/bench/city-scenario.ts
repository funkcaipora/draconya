// O cenário do `bench:city`: a praça compartilhada, medida pelo caminho real (FUN-33, OW-07).
//
// Aqui mora a MEDIÇÃO; `city-broadcast.ts` é só a borda (lê o ambiente e imprime) e
// `city-metrics.ts` é a conta. Módulo que executa ao ser importado é armadilha (AGENTS.md do
// pacote): o teste precisa montar o cenário sem subir a tabela inteira.
//
// ## O que passa pelo caminho de produção
//
// `SessionHost` + `CityShard` + `Viewer` de verdade, e o codec real: cada mensagem de saída é
// codificada pelo cache do ciclo (`EncodeCache`, OW-22: uma vez por objeto de mensagem, e não mais
// uma por destinatário) e o lote de cada visualizador é montado em `Viewer.flush` (`packBatch`); o
// socket aqui só CONTA os bytes do frame que sairia no fio. O uWS roda sem permessage-deflate (`server.ts` não
// configura `compression`), então o frame é o fio, mais 2 a 10 bytes de cabeçalho do WebSocket por
// quadro. Os `walk` entram por `host.handle`, como no socket.
//
// ## O relógio é parte do cenário
//
// O bench anterior fixava `now: () => 0`. Desde o FUN-122 o hospedeiro recusa o `walk` que chega
// antes de o passo anterior acabar, e com o relógio parado todo passo depois do primeiro era
// recusado: a tabela do FUN-120 deixou de ser reproduzível e ninguém viu, porque o bench não roda
// no CI. Agora o relógio é SIMULADO e avança no ritmo de produção:
//
//   - o passo da Cidade é `city.stepDurationMs` (150 ms em `city.json`);
//   - o hospedeiro fecha um ciclo a cada `CYCLE_MS` (100 ms, `host.ts`): um frame por visualizador;
//   - o relógio anda no máximo divisor comum dos dois (50 ms), e cada jogador tenta um passo por
//     período, defasado dos outros — como clientes reais, que não pisam todos no mesmo
//     milissegundo.
//
// ## O que é custo de CPU aqui
//
// `process.cpuUsage()` em volta de cada janela: CPU, e não parede — uma máquina ocupada com outros
// processos (é o caso desta, que roda agentes em paralelo) não infla o p99 com o tempo em que o
// processo esteve preemptado. A parede da mesma janela também é somada, só para o relatório
// mostrar a razão CPU/parede: razão baixa quer dizer que o número não é de confiança.
//
// A contabilidade do próprio bench (varrer filas, contar quedas) fica FORA das janelas.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildContent, floorChangeAt, isBlocked } from '@draconya/content';
import type { Content, RawContent, Tilemap } from '@draconya/content';
import { loadContent } from '@draconya/content/load';
import type { C2SMessage } from '@draconya/protocol';
import type { CharacterRuntime } from '@draconya/sim';
import {
  CityShard, DEFAULT_MAX_QUEUED, SessionHost, createCitySessionFactory, createLogger,
} from '@draconya/server';
import type { Viewer, ViewerSocket } from '@draconya/server';
import { summarize } from './city-metrics.js';
import type { CycleSample, RunSummary } from './city-metrics.js';

/**
 * O ciclo do hospedeiro, em ms (`CYCLE_MS` em `packages/server/src/game/host.ts`): um frame por
 * visualizador a cada 100 ms. Espelhado, e não importado, porque a constante não é exportada;
 * `city-scenario.test.ts` confere o valor contra o fonte do hospedeiro.
 */
export const CYCLE_MS = 100;

/** O passo da praça sintética, igual ao da Cidade do jogo (`data/city/city.json`, ADR 0025). */
const SYNTHETIC_STEP_MS = 150;

export interface CityScenario {
  /** O rótulo da linha na tabela. */
  readonly label: string;
  readonly players: number;
  /** O lado da praça sintética; na Thais real não é usado. */
  readonly size: number;
  readonly entryTiles?: number;
  /** Espalhar antes de medir? Sem isto, todo mundo fica empilhado no ponto de entrada. */
  readonly spread?: boolean;
  /** A Thais real do conteúdo (FUN-120), em vez da praça sintética de `size`. */
  readonly thais?: boolean;
}

export interface RunOptions {
  /** Passos por jogador, na janela medida. */
  readonly steps: number;
  /** Passos por jogador descartados antes de medir, para o JIT aquecer. */
  readonly warmupSteps?: number;
  /** `true`: o que o jogo faz. `false`: o grupo de controle, cada passo para a sessão inteira. */
  readonly aoi: boolean;
  /** O conteúdo real, carregado uma vez pelo chamador. Sem ele, cada cenário carrega o seu. */
  readonly content?: Content;
  /**
   * `true` (padrão): o que o jogo faz — a mesma mensagem para N visualizadores é codificada uma vez
   * por ciclo (OW-22). `false`: o grupo de controle, cada visualizador codifica a sua cópia.
   */
  readonly encodeOnce?: boolean;
  /** O teto de fila do visualizador. Padrão: o do jogo. Só o teste o baixa, para provocar queda. */
  readonly maxQueued?: number;
  /** Cada frame que saiu no fio na janela medida. Para o teste decodificar o que foi contado. */
  readonly tap?: (characterId: string, frame: Uint8Array) => void;
}

export interface CityRun {
  readonly scenario: CityScenario;
  readonly aoi: boolean;
  readonly summary: RunSummary;
  /** Quantos, em média, enxergam um jogador. É o número que decide a AOI. */
  readonly neighbours: number;
  /** Passos tentados e aceitos na janela medida. A razão diz se o cenário andou ou ficou preso. */
  readonly attempts: number;
  readonly moves: number;
  /** `stepDurationMs` do cenário. */
  readonly stepMs: number;
  /** CPU / parede das janelas medidas. Perto de 1: o número é de CPU. Muito abaixo: máquina cheia. */
  readonly cpuToWall: number;
  /** O teto de fila do visualizador, para comparar com `summary.queue.max`. */
  readonly queueLimit: number;
  /**
   * Totais em bruto da janela medida, de que as taxas por visualizador saem. `encodedBytes` é o que
   * o hospedeiro SERIALIZOU (o cache de codificação do OW-22); `encoded` e `reused` contam as
   * mensagens que o cache codificou e as entregas que ele serviu sem codificar.
   */
  readonly totals: {
    readonly bytes: number;
    readonly messages: number;
    readonly frames: number;
    readonly encodedBytes: number;
    readonly encoded: number;
    readonly reused: number;
  };
}

/** O conteúdo de verdade, com a Thais importada (FUN-120). Roda a partir de `packages/tools`. */
export function realContent(): Content {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  return loadContent(resolve(repo, process.env['CONTENT_DIR'] ?? 'packages/content/data'));
}

/**
 * Campo de distância A PÉ até um alvo, no andar dado: quatro vizinhos, parede e escada não
 * entram. É o único pathfinding do repositório, e mora numa ferramenta: quem anda no jogo é o
 * cliente, um tile por vez; aqui ele só serve para espalhar quinhentas pessoas pelas ruas.
 */
function distanceField(map: Tilemap, target: { x: number; y: number }, z: number): Uint16Array {
  const field = new Uint16Array(map.width * map.height).fill(0xffff);
  const queue = [target.y * map.width + target.x];
  field[queue[0] as number] = 0;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head] as number;
    const x = index % map.width;
    const y = Math.floor(index / map.width);
    const d = (field[index] as number) + 1;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const next = ny * map.width + nx;
      if (field[next] !== 0xffff || isBlocked(map, nx, ny, z) || floorChangeAt(map, nx, ny, z) !== null) continue;
      field[next] = d;
      queue.push(next);
    }
  }
  return field;
}

/** A praça sintética: um quadrado murado, do tamanho pedido, com o passo da Cidade do jogo. */
export const cityContent = (size: number): Content => buildContent({
  monsters: [], hunts: [], vocations: [],
  progression: [{
    id: 'baseline', startingHealth: 150, startingMana: 60, startingCapacity: 400,
    healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
    startingSpeed: 300, speedPerLevel: 0,
    regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
    xp: { kind: 'power', base: 20, exponent: 2 },
    deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.56, promotionReduction: 0.3 },
  }],
  combat: [{
    id: 'baseline', dodgeMultiplier: 0.5,
    armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0, manadrain: 0, arcane: 0 }, minimumDamageFraction: 0.1,
    player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0 },
  }],
  stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
  party: [{ id: 'baseline', maxMembers: 4 }],
  bot: [{
    id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1_000,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
  }],
  maps: [{
    id: 'city', z: 7,
    entryPoint: { x: Math.floor(size / 2), y: Math.floor(size / 2) },
    grid: Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) =>
        (x === 0 || y === 0 || x === size - 1 || y === size - 1 ? '#' : '.')).join('')),
  }],
  routes: [],
  city: { mapId: 'city', stepDurationMs: SYNTHETIC_STEP_MS },
} satisfies RawContent);

const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;

/** Períodos de passo sem a dispersão progredir, passados os quais ela dá o resto por preso. */
const PATIENCE_PERIODS = 30;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Um socket que só conta o que sairia no fio. */
class MeteredSocket implements ViewerSocket {
  readonly #characterId: string;
  readonly #onWrite: (characterId: string, frame: Uint8Array) => void;

  constructor(characterId: string, onWrite: (characterId: string, frame: Uint8Array) => void) {
    this.#characterId = characterId;
    this.#onWrite = onWrite;
  }

  send(message: ArrayBuffer | Uint8Array): unknown {
    this.#onWrite(
      this.#characterId,
      message instanceof Uint8Array ? message : new Uint8Array(message),
    );
    return 1;
  }

  /** Cliente que drena: o teto de bytes represados é do `Viewer` e não é o assunto aqui. */
  getBufferedAmount(): number { return 0; }

  end(): void {}
}

interface Walker {
  readonly id: string;
  readonly index: number;
  readonly viewer: Viewer;
  readonly character: CharacterRuntime;
  /** Em que tick, dentro do período do passo, este jogador pisa. */
  readonly phase: number;
  target?: { x: number; y: number };
  /** Passos já tentados: escolhe a direção do próximo, para ninguém empurrar a mesma parede. */
  attempts: number;
  dropped: boolean;
}

interface Intent {
  readonly walker: Walker;
  readonly atMs: number;
  readonly message: C2SMessage;
}

export function runCityScenario(scenario: CityScenario, options: RunOptions): CityRun {
  const { players, size, entryTiles } = scenario;
  const content = scenario.thais === true ? (options.content ?? realContent()) : cityContent(size);
  const cityMap = content.city;
  if (cityMap === undefined) throw new Error('o conteúdo não tem Cidade');
  const stepMs = content.citySettings?.stepDurationMs;
  if (stepMs === undefined) throw new Error('o conteúdo não tem o passo da Cidade');
  const floor = cityMap.entryPoint?.z ?? cityMap.z;

  // O relógio simulado: o máximo divisor comum do passo e do ciclo, para os dois caírem em tick
  // exato. 150 ms e 100 ms dão 50 ms: o passo é de 3 ticks, o ciclo de 2.
  const tickMs = gcd(stepMs, CYCLE_MS);
  const stepTicks = stepMs / tickMs;
  const cycleTicks = CYCLE_MS / tickMs;
  const clock = { ms: 0 };
  let tick = 0;

  // O que sai no fio: só conta a janela medida. Mensagens vêm do `onFrame` do próprio
  // visualizador; bytes e quadros, do socket — são duas leituras do mesmo envio, e o teste
  // confere que fecham.
  let recording = false;
  const totals = {
    bytes: 0, messages: 0, frames: 0, encodedBytes: 0, encoded: 0, reused: 0,
  };
  const onWrite = (characterId: string, frame: Uint8Array): void => {
    if (!recording) return;
    totals.bytes += frame.byteLength;
    totals.frames += 1;
    options.tap?.(characterId, frame);
  };

  const logger = createLogger('silent', 'bench');
  // Uma cópia só: aqui o assunto é o leque, e o teto de população é a outra defesa do FUN-33.
  const shard = new CityShard(content, () => 0, {
    capacity: players + 1,
    ...(entryTiles === undefined ? {} : { entryTiles }),
  });
  const host = new SessionHost({
    nodeId: 'bench', contentVersion: content.version, logger,
    createSession: createCitySessionFactory(content, () => 0, shard),
    now: () => clock.ms,
    // `onFrame` é o contador do próprio visualizador (FUN-47): quantas mensagens couberam no
    // quadro. Contar `send` do socket contaria QUADROS, e o lote é um por ciclo.
    viewer: {
      onFrame: (messages: number) => { if (recording) totals.messages += messages; },
      ...(options.maxQueued === undefined ? {} : { maxQueued: options.maxQueued }),
    },
    // Desligar a AOI é o cenário ANTERIOR ao FUN-33: cada passo para todos da sessão.
    ...(options.aoi ? {} : { areaOfInterest: false }),
    // E desligar a codificação única é o ANTERIOR ao OW-22: cada visualizador codifica a sua cópia.
    ...(options.encodeOnce === false ? { encodeOnce: false } : {}),
  });

  // --- a chegada ---------------------------------------------------------------------------

  const walkers: Walker[] = [];
  for (let index = 0; index < players; index++) {
    const id = `p${index}`;
    const viewer = host.attach(new MeteredSocket(id, onWrite), id);
    const character = host.sessionFor(id)?.participants.find((participant) => participant.id === id);
    if (character === undefined) throw new Error(`o personagem ${id} não entrou na Cidade`);
    walkers.push({
      id, index, viewer, character, phase: index % stepTicks, attempts: 0, dropped: false,
    });
    // Quem chega recebe a praça inteira no `welcome` e no `snapshot`; esvaziar a fila a cada
    // entrada é a hora do login espalhada no tempo, e não quinhentos na mesma fração de segundo.
    host.flush();
  }

  const dropped = new Set<string>();
  /**
   * Lê a fila de cada visualizador ANTES do flush — é o instante em que ela está mais cheia — e
   * marca quem estourou o teto. Fica fora das janelas de CPU: é contabilidade do bench.
   */
  const scanViewers = (): number => {
    let queueMax = 0;
    for (const walker of walkers) {
      if (walker.dropped) continue;
      queueMax = Math.max(queueMax, walker.viewer.queued);
      if (walker.viewer.dead) {
        walker.dropped = true;
        dropped.add(walker.id);
      }
    }
    return queueMax;
  };

  /** Quem pisa neste tick. */
  const readyAt = (at: number): Walker[] => walkers.filter(
    (walker) => !walker.dropped && (at + stepTicks - walker.phase) % stepTicks === 0,
  );

  // --- a dispersão, antes de medir ---------------------------------------------------------
  //
  // `placeReachable` entrega o tile livre mais próximo do ponto de entrada, então todo mundo
  // chega empilhado no mesmo punhado de tiles — que é a Cidade de hoje, com um ponto de entrada e
  // mais nada. Para medir a praça COM lugares, cada um caminha até um destino próprio antes de a
  // contagem começar. Roda no MESMO relógio da medição: o hospedeiro recusa o passo adiantado, e
  // o ciclo fecha de 100 em 100 ms como em produção.

  const side = Math.ceil(Math.sqrt(players));
  const spreadStride = Math.max(1, Math.floor((size - 4) / side));
  /** Na Thais real, o campo de distância até o alvo de cada um; na praça, o alvo basta. */
  const fields = new Map<string, Uint16Array>();
  if (scenario.spread === true) {
    if (scenario.thais === true) {
      // Os alvos são tiles alcançáveis a pé da entrada, tomados a intervalos iguais na ordem de
      // largura: é o que espalha as pessoas pelas ruas em vez de amontoá-las no templo.
      const entryPoint = cityMap.entryPoint ?? { x: 0, y: 0 };
      const fromEntry = distanceField(cityMap, entryPoint, floor);
      const reachable: number[] = [];
      for (let index = 0; index < fromEntry.length; index++) {
        if (fromEntry[index] !== 0xffff) reachable.push(index);
      }
      reachable.sort((a, b) => (fromEntry[a] as number) - (fromEntry[b] as number) || a - b);
      const stride = Math.max(1, Math.floor(reachable.length / players));
      for (const walker of walkers) {
        const tile = reachable[Math.min(reachable.length - 1, walker.index * stride)] as number;
        walker.target = { x: tile % cityMap.width, y: Math.floor(tile / cityMap.width) };
        fields.set(walker.id, distanceField(cityMap, walker.target, floor));
      }
    } else {
      for (const walker of walkers) {
        walker.target = {
          x: 2 + (walker.index % side) * spreadStride,
          y: 2 + Math.floor(walker.index / side) * spreadStride,
        };
      }
    }
  }

  const centre = size / 2;
  /**
   * Quão longe do destino alguém está: pela distância a pé na Thais, pela do centro na praça. É a
   * chave da ordem "de fora para dentro" — na praça, quem está mais longe do centro sai primeiro.
   */
  const remaining = (walker: Walker): number => {
    const field = fields.get(walker.id);
    const position = walker.character.position;
    if (field !== undefined) return field[position.y * cityMap.width + position.x] ?? 0xffff;
    return Math.abs(position.x - centre) + Math.abs(position.y - centre);
  };
  /** Quanto falta DE FATO até o alvo do jogador: o que a dispersão tem de reduzir. */
  const toTarget = (walker: Walker): number => {
    const field = fields.get(walker.id);
    const position = walker.character.position;
    if (field !== undefined) return field[position.y * cityMap.width + position.x] ?? 0xffff;
    const target = walker.target;
    return target === undefined ? 0 : Math.abs(position.x - target.x) + Math.abs(position.y - target.y);
  };

  /** Os passos que o jogador tentaria, em ordem de preferência, rumo ao alvo. */
  const candidates = (walker: Walker): ReadonlyArray<readonly [number, number]> => {
    const from = walker.character.position;
    const target = walker.target;
    if (target === undefined) return [];
    const field = fields.get(walker.id);
    if (field !== undefined) {
      // Na Thais, o vizinho que mais aproxima A PÉ — as ruas têm esquina, e "na direção do
      // alvo" bate na parede. Os cardeais em ordem de distância; o que já chegou fica.
      if (field[from.y * cityMap.width + from.x] === 0) return [];
      return ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const)
        .filter(([sx, sy]) => (field[(from.y + sy) * cityMap.width + from.x + sx] ?? 0xffff) !== 0xffff)
        .sort((a, b) => (field[(from.y + a[1]) * cityMap.width + from.x + a[0]] as number)
          - (field[(from.y + b[1]) * cityMap.width + from.x + b[0]] as number));
    }
    const dx = Math.sign(target.x - from.x);
    const dy = Math.sign(target.y - from.y);
    if (dx === 0 && dy === 0) return [];
    // Diagonal primeiro, e os dois eixos como saída. Sem as alternativas, um passo recusado por
    // tile ocupado é um jogador PARADO, e cem jogadores parados um na frente do outro travam a
    // dispersão inteira... e um desvio lateral quando nem os eixos servem: é o que permite
    // contornar quem já chegou e parou no caminho.
    return [[dx, dy], [dx, 0], [0, dy], [dy, dx], [-dy, -dx]];
  };

  /** Fecha um ciclo do hospedeiro fora da janela medida (chegada e dispersão). */
  const closeUnrecordedCycle = (): void => {
    scanViewers();
    clock.ms = tick * tickMs;
    host.cycle(clock.ms);
  };

  let dispersionTicks = 0;
  if (scenario.spread === true) {
    // O teto é generoso porque quinhentas pessoas saindo de um punhado de tiles formam
    // engarrafamento, e a saída é por PROGRESSO: quando a soma das distâncias que faltam deixa de
    // cair por `PATIENCE_PERIODS` períodos de passo, ou todos chegaram, ou o que sobrou está preso
    // — numa rua de um tile, quem chegou primeiro trava quem precisa passar por ele. Sem esta
    // saída a dispersão roda até o teto, porque quem está preso oscila entre dois tiles e conta
    // como "moveu".
    const maxRounds = scenario.thais === true ? Math.max(cityMap.width, cityMap.height) * 8 : size * 8;
    let bestLeft = Infinity;
    let stalledPeriods = 0;
    for (let spent = 0; spent < maxRounds * stepTicks; spent++) {
      clock.ms = tick * tickMs;
      // De FORA para dentro. Todo mundo empurrando ao mesmo tempo de dentro de um punhado de
      // tiles trava: quem está no miolo não tem para onde ir enquanto quem está na borda não
      // saiu. Mover primeiro quem está mais longe é o que desfaz o engarrafamento.
      const ready = readyAt(tick)
        .map((walker) => ({ walker, left: remaining(walker) }))
        .sort((a, b) => b.left - a.left);
      for (const { walker } of ready) {
        const from = walker.character.position;
        const fromX = from.x;
        const fromY = from.y;
        for (const [sx, sy] of candidates(walker)) {
          if (sx === 0 && sy === 0) continue;
          host.handle(walker.viewer, {
            type: 'walk-to', destination: { x: fromX + sx, y: fromY + sy, z: floor },
          });
          const to = walker.character.position;
          if (fromX !== to.x || fromY !== to.y) break;
        }
      }
      tick += 1;
      dispersionTicks += 1;
      if (tick % cycleTicks === 0) closeUnrecordedCycle();
      if (tick % stepTicks !== 0) continue;
      const left = walkers.reduce((total, walker) => total + (walker.dropped ? 0 : toTarget(walker)), 0);
      if (left === 0) break;
      if (left < bestLeft) {
        bestLeft = left;
        stalledPeriods = 0;
      } else if (++stalledPeriods >= PATIENCE_PERIODS) {
        break;
      }
    }
  }
  // Alinha o relógio ao próximo ciclo e esvazia as filas: a janela medida começa limpa.
  while (tick % cycleTicks !== 0) tick += 1;
  closeUnrecordedCycle();

  if (process.env['BENCH_DEBUG'] !== undefined) {
    // `BENCH_DEBUG=1` mostra se a dispersão chegou onde queria. Sem isso, um cenário que não
    // espalhou ninguém sai como se tivesse espalhado, e o número publicado seria de outro
    // experimento — foi assim que a primeira versão desta medição quase reportou 272 vizinhos.
    let atTarget = 0;
    let remainingSum = 0;
    for (const walker of walkers) {
      remainingSum += toTarget(walker);
      if (walker.target !== undefined
        && walker.character.position.x === walker.target.x
        && walker.character.position.y === walker.target.y) atTarget += 1;
    }
    console.log(`  [debug] spread=${scenario.spread === true} ticks=${dispersionTicks} `
      + `noAlvo=${atTarget}/${players} distMedia=${(remainingSum / players).toFixed(1)} `
      + `quedas=${dropped.size}`);
  }

  // --- a janela medida ---------------------------------------------------------------------

  const samples: CycleSample[] = [];
  let attempts = 0;
  let moves = 0;
  let cpuTotalUs = 0;
  let wallTotalUs = 0;

  /**
   * Um ciclo de 100 ms: os `walk` que chegam nele, e depois o fechamento do hospedeiro. Direção
   * derivada do índice e da contagem de passos do jogador — um `east` para todo mundo faria a
   * praça inteira empurrar contra a mesma parede, e o que sobraria de medição seriam as recusas.
   */
  const measuredCycle = (record: boolean): void => {
    const intents: Intent[] = [];
    for (let offset = 0; offset < cycleTicks; offset++) {
      const at = tick + offset;
      for (const walker of readyAt(at)) {
        intents.push({
          walker,
          atMs: at * tickMs,
          message: { type: 'walk', direction: DIRECTIONS[(walker.index + walker.attempts) % 4] ?? 'north' },
        });
        walker.attempts += 1;
      }
    }

    let cycleMoves = 0;
    const handleCpu = process.cpuUsage();
    const handleWall = performance.now();
    for (const intent of intents) {
      clock.ms = intent.atMs;
      const before = intent.walker.character.position;
      const fromX = before.x;
      const fromY = before.y;
      host.handle(intent.walker.viewer, intent.message);
      const after = intent.walker.character.position;
      if (fromX !== after.x || fromY !== after.y) cycleMoves += 1;
    }
    const handleCpuUs = diffCpu(handleCpu);
    const handleWallUs = (performance.now() - handleWall) * 1000;

    tick += cycleTicks;
    const queueMax = scanViewers();
    clock.ms = tick * tickMs;
    const flushCpu = process.cpuUsage();
    const flushWall = performance.now();
    host.cycle(clock.ms);
    const flushCpuUs = diffCpu(flushCpu);
    const flushWallUs = (performance.now() - flushWall) * 1000;

    if (!record) return;
    attempts += intents.length;
    moves += cycleMoves;
    cpuTotalUs += handleCpuUs + flushCpuUs;
    wallTotalUs += handleWallUs + flushWallUs;
    samples.push({
      cpuUs: handleCpuUs + flushCpuUs, handleUs: handleCpuUs, flushUs: flushCpuUs, queueMax,
    });
  };

  const cyclesFor = (steps: number): number => Math.max(1, Math.round((steps * stepMs) / CYCLE_MS));
  for (let cycle = 0; cycle < cyclesFor(options.warmupSteps ?? 30); cycle++) measuredCycle(false);
  recording = true;
  // O que o hospedeiro serializou na janela é a diferença dos contadores dele, que só sobem.
  const encodedBefore = host.encodeStats;
  for (let cycle = 0; cycle < cyclesFor(options.steps); cycle++) measuredCycle(true);
  recording = false;
  const encodedAfter = host.encodeStats;
  totals.encodedBytes = encodedAfter.encodedBytes - encodedBefore.encodedBytes;
  totals.encoded = encodedAfter.encoded - encodedBefore.encoded;
  totals.reused = encodedAfter.reused - encodedBefore.reused;

  const neighbours = walkers.reduce(
    (total, walker) => total + (options.aoi ? host.interestOf(walker.id).length : players - 1), 0,
  ) / players;

  return {
    scenario,
    aoi: options.aoi,
    summary: summarize({
      samples, viewers: players, cycleMs: CYCLE_MS,
      bytes: totals.bytes, encodedBytes: totals.encodedBytes, messages: totals.messages,
      frames: totals.frames, drops: dropped.size,
    }),
    neighbours,
    attempts,
    moves,
    stepMs,
    cpuToWall: wallTotalUs === 0 ? 0 : cpuTotalUs / wallTotalUs,
    queueLimit: options.maxQueued ?? DEFAULT_MAX_QUEUED,
    totals,
  };
}

/** Microssegundos de CPU (usuário + sistema) desde `since`. */
function diffCpu(since: NodeJS.CpuUsage): number {
  const used = process.cpuUsage(since);
  return used.user + used.system;
}
