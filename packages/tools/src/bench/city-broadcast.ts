// Quanto custa a praça compartilhada, em MENSAGENS (FUN-33).
//
// **É a medição que decide se a AOI funcionou.** O critério da issue é literal: 500 clientes na
// Cidade não podem fazer a transmissão crescer quadraticamente. A conta que a issue usa para
// justificar o trabalho — 2.000 jogadores × 2 passos/s × 2.000 destinatários = 8 milhões de
// mensagens por segundo — é a projeção do que acontece SEM interest management.
//
//   pnpm bench:city                  # 100, 200 e 500 jogadores, na praça sintética
//   PLAYERS=1000 STEPS=40 pnpm bench:city
//   MAP=thais pnpm bench:city        # a Thais real (FUN-120): todos no templo, e espalhados
//
// O número que interessa não é o total: é **destinatários por passo**. Se ele ficar praticamente
// igual entre 100 e 500 jogadores, o custo é linear na população — cada passo continua indo para
// os vizinhos, e vizinhos não crescem com quantos estão na praça, porque o mapa é o mesmo e tile
// é exclusivo. Se ele acompanhar a população, a AOI não está cortando nada.
//
// A comparação sai nas duas colunas: com AOI e com a transmissão para a sessão inteira, que é o
// que existia antes desta issue.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContent, floorChangeAt, isBlocked } from '@draconya/content';
import type { Content, RawContent, Tilemap } from '@draconya/content';
import { loadContent } from '@draconya/content/load';
import { CityShard, SessionHost, createCitySessionFactory, createLogger } from '@draconya/server';
import type { Viewer, ViewerSocket } from '@draconya/server';

const PLAYERS = process.env['PLAYERS'] === undefined
  ? [100, 200, 500]
  : [Number(process.env['PLAYERS'])];
/** Passos por jogador. Cada um é um `walk` pelo caminho real do socket. */
const STEPS = Number(process.env['STEPS'] ?? 20);
/** `MAP=thais` mede na Thais real do conteúdo, em vez da praça sintética. */
const THAIS = process.env['MAP'] === 'thais';

/** O conteúdo de verdade, com a Thais importada (FUN-120). O `pnpm` roda isto de `packages/tools`. */
function realContent(): Content {
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

/** Passos por jogador. Cada um é um `walk` pelo caminho real do socket. */
const cityContent = (size: number): Content => buildContent({
  monsters: [], hunts: [], vocations: [],
  progression: [{
    id: 'baseline', startingHealth: 150, startingMana: 60, startingCapacity: 400,
    healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
    startingSpeed: 300, speedPerLevel: 0,
    regen: { healthPerSecond: 1, manaPerSecond: 1 },
    xp: { base: 20, exponent: 2 },
    deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
  }],
  combat: [{
    id: 'baseline', dodgeMultiplier: 0.5,
    armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 }, minimumDamageFraction: 0.1,
    player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0 },
  }],
  stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
  party: [{ id: 'baseline', maxMembers: 4, xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200 } }],
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
  city: { mapId: 'city', stepDurationMs: 500 },
} satisfies RawContent);

/** Um socket que não faz nada: aqui o assunto é quantidade de mensagem, não byte no fio. */
class SilentSocket implements ViewerSocket {
  send(): unknown { return 1; }
  getBufferedAmount(): number { return 0; }
  end(): void {}
}

interface Measurement {
  readonly messages: number;
  readonly moves: number;
  /** Mensagens por passo bem-sucedido, appear e disappear inclusive. */
  readonly perMove: number;
  /** Quantos, em média, enxergam um jogador. É o número que decide. */
  readonly neighbours: number;
}

const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;

interface Scenario {
  readonly players: number;
  /** O lado da praça sintética; na Thais real é só o rótulo da tabela. */
  readonly size: number;
  readonly entryTiles?: number;
  /** Espalhar antes de medir? Sem isto, todo mundo fica empilhado no ponto de entrada. */
  readonly spread?: boolean;
  /** A Thais real do conteúdo (FUN-120), em vez da praça sintética de `size`. */
  readonly thais?: boolean;
}

function measure(scenario: Scenario, aoi: boolean): Measurement {
  const { players, size, entryTiles } = scenario;
  const content = scenario.thais === true ? realContent() : cityContent(size);
  const cityMap = content.city;
  if (cityMap === undefined) throw new Error('o conteúdo não tem Cidade');
  const floor = cityMap.entryPoint?.z ?? cityMap.z;
  const logger = createLogger('silent', 'bench');
  // Uma cópia só: aqui o assunto é a AOI, e o teto de população é a outra defesa da issue.
  const shard = new CityShard(content, () => 0, {
    capacity: players + 1,
    ...(entryTiles === undefined ? {} : { entryTiles }),
  });
  let messages = 0;
  const host = new SessionHost({
    nodeId: 'bench', contentVersion: content.version, logger,
    createSession: createCitySessionFactory(content, () => 0, shard),
    now: () => 0,
    // `onFrame` é o contador do próprio visualizador (FUN-47): quantas mensagens couberam no
    // quadro. Contar `send` do socket contaria QUADROS, e o lote é um por ciclo.
    viewer: { onFrame: (count: number) => { messages += count; } },
    // Desligar a AOI é o cenário ANTERIOR a esta issue: cada passo para todos da sessão.
    ...(aoi ? {} : { areaOfInterest: false }),
  });

  const entries: { id: string; viewer: Viewer; target?: { x: number; y: number } }[] = [];
  for (let i = 0; i < players; i++) {
    entries.push({ id: `p${i}`, viewer: host.attach(new SilentSocket(), `p${i}`) });
  }

  // DISPERSÃO, antes de medir.
  //
  // `placeReachable` entrega o tile livre mais próximo do ponto de entrada, então todo mundo chega
  // empilhado no mesmo punhado de tiles — que é a Cidade de hoje, com um ponto de entrada e
  // mais nada. Para medir a praça COM lugares, cada um caminha até um destino próprio antes de
  // a contagem começar.
  const side = Math.ceil(Math.sqrt(players));
  const spread = Math.max(1, Math.floor((size - 4) / side));
  /** Na Thais real, o campo de distância até o alvo de cada um; na praça, o alvo basta. */
  const fields = new Map<string, Uint16Array>();
  if (scenario.thais === true && scenario.spread === true) {
    // Os alvos são tiles alcançáveis a pé da entrada, tomados a intervalos iguais na ordem de
    // largura: é o que espalha as pessoas pelas ruas em vez de amontoá-las no templo.
    const entryPoint = cityMap.entryPoint ?? { x: 0, y: 0 };
    const fromEntry = distanceField(cityMap, entryPoint, floor);
    const reachable: number[] = [];
    for (let index = 0; index < fromEntry.length; index++) if (fromEntry[index] !== 0xffff) reachable.push(index);
    reachable.sort((a, b) => (fromEntry[a] as number) - (fromEntry[b] as number) || a - b);
    const stride = Math.max(1, Math.floor(reachable.length / players));
    for (const [index, entry] of entries.entries()) {
      const tile = reachable[Math.min(reachable.length - 1, index * stride)] as number;
      entry.target = { x: tile % cityMap.width, y: Math.floor(tile / cityMap.width) };
      fields.set(entry.id, distanceField(cityMap, entry.target, floor));
    }
  } else {
    for (const [index, entry] of entries.entries()) {
      entry.target = {
        x: 2 + (index % side) * spread,
        y: 2 + Math.floor(index / side) * spread,
      };
    }
  }
  // O teto é generoso porque quinhentas pessoas saindo de um punhado de tiles formam
  // engarrafamento: quase todo passo é recusado por tile ocupado no começo. A saída é quando
  // uma rodada inteira não move NINGUÉM — aí ou todos chegaram, ou o que sobrou está preso.
  const centre = size / 2;
  /** Quão longe do destino alguém está: pela distância a pé na Thais, pela do centro na praça. */
  const remaining = (id: string, position: { x: number; y: number }): number => {
    const field = fields.get(id);
    if (field !== undefined) return field[position.y * cityMap.width + position.x] ?? 0xffff;
    return Math.abs(position.x - centre) + Math.abs(position.y - centre);
  };
  let rounds = 0;
  const maxRounds = scenario.thais === true ? Math.max(cityMap.width, cityMap.height) * 8 : size * 8;
  for (let step = 0; scenario.spread === true && step < maxRounds; step++) {
    let moved = false;
    // De FORA para dentro. Todo mundo empurrando ao mesmo tempo de dentro de um punhado de
    // tiles trava: quem está no miolo não tem para onde ir enquanto quem está na borda não
    // saiu. Mover primeiro quem está mais longe do centro é o que desfaz o engarrafamento —
    // e é por isso que este laço ordena a cada rodada em vez de percorrer na ordem de chegada.
    const outwardFirst = [...entries].sort((a, b) => {
      const pa = host.sessionFor(a.id)?.participants.find((p) => p.id === a.id)?.position;
      const pb = host.sessionFor(b.id)?.participants.find((p) => p.id === b.id)?.position;
      const da = pa === undefined ? 0 : remaining(a.id, pa);
      const db = pb === undefined ? 0 : remaining(b.id, pb);
      return db - da;
    });
    for (const entry of outwardFirst) {
      const character = host.sessionFor(entry.id)?.participants.find((p) => p.id === entry.id);
      const target = entry.target;
      if (character === undefined || target === undefined) continue;
      const from = character.position;
      const field = fields.get(entry.id);
      let candidates: ReadonlyArray<readonly [number, number]>;
      if (field !== undefined) {
        // Na Thais, o vizinho que mais aproxima A PÉ — as ruas têm esquina, e "na direção do
        // alvo" bate na parede. Os cardeais em ordem de distância; o que já chegou fica.
        if (field[from.y * cityMap.width + from.x] === 0) continue;
        candidates = ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const)
          .filter(([sx, sy]) => (field[(from.y + sy) * cityMap.width + from.x + sx] ?? 0xffff) !== 0xffff)
          .sort((a, b) => (field[(from.y + a[1]) * cityMap.width + from.x + a[0]] as number)
            - (field[(from.y + b[1]) * cityMap.width + from.x + b[0]] as number));
      } else {
        const dx = Math.sign(target.x - from.x);
        const dy = Math.sign(target.y - from.y);
        if (dx === 0 && dy === 0) continue;
        // Diagonal primeiro, e os dois eixos como saída. Sem as alternativas, um passo recusado
        // por tile ocupado é um jogador PARADO, e cem jogadores parados um na frente do outro
        // travam a dispersão inteira — foi o que aconteceu na primeira versão desta medição.
        // ...e um desvio lateral quando nem os eixos servem: é o que permite contornar quem já
        // chegou e parou no caminho.
        candidates = [[dx, dy], [dx, 0], [0, dy], [dy, dx], [-dy, -dx]];
      }
      for (const [sx, sy] of candidates) {
        if (sx === 0 && sy === 0) continue;
        host.handle(entry.viewer, {
          type: 'walk-to', destination: { x: from.x + sx, y: from.y + sy, z: floor },
        });
        const to = character.position;
        if (from.x === to.x && from.y === to.y) continue;
        moved = true;
        break;
      }
    }
    host.flush();
    rounds = step + 1;
    if (!moved) break;
  }

  // `BENCH_DEBUG=1` mostra se a dispersão chegou onde queria. Sem isso, um cenário que não
  // espalhou ninguém sai como se tivesse espalhado, e o número publicado seria de outro
  // experimento — foi assim que a primeira versão desta medição quase reportou 272 vizinhos.
  if (process.env['BENCH_DEBUG'] !== undefined) {
    let atTarget = 0;
    let spreadSum = 0;
    for (const entry of entries) {
      const c = host.sessionFor(entry.id)?.participants.find((p) => p.id === entry.id);
      if (c === undefined || entry.target === undefined) continue;
      if (c.position.x === entry.target.x && c.position.y === entry.target.y) atTarget += 1;
      spreadSum += remaining(entry.id, c.position);
    }
    console.log(`  [debug] spread=${scenario.spread} rodadas=${rounds} `
      + `noAlvo=${atTarget}/${players} distMedia=${(spreadSum / players).toFixed(1)}`);
  }

  // Só as mensagens dos PASSOS contam: chegar e se espalhar acontece uma vez, e o que a issue
  // mede é o custo contínuo.
  host.flush();
  messages = 0;

  let moves = 0;
  for (let step = 0; step < STEPS; step++) {
    for (const [index, entry] of entries.entries()) {
      const character = host.sessionFor(entry.id)?.participants.find((p) => p.id === entry.id);
      const from = character?.position;
      // Direção derivada do índice e do passo: um `east` para todo mundo faria a praça inteira
      // empurrar contra a mesma parede, e o que sobraria de medição seriam as recusas.
      host.handle(entry.viewer, {
        type: 'walk', direction: DIRECTIONS[(index + step) % 4] ?? 'north',
      });
      const to = character?.position;
      if (from !== undefined && to !== undefined && (from.x !== to.x || from.y !== to.y)) {
        moves += 1;
      }
    }
    // Um quadro por ciclo, como em produção. Acumular a rodada inteira estouraria o teto de
    // mensagens do visualizador — e um visualizador derrubado não mede nada.
    host.flush();
  }

  const neighbours = entries.reduce(
    (total, entry) => total + (aoi ? host.interestOf(entry.id).length : players - 1), 0,
  ) / players;
  return { messages, moves, perMove: moves === 0 ? 0 : messages / moves, neighbours };
}

function table(
  title: string,
  rows: readonly Scenario[],
): void {
  console.log(`--- ${title} ${'-'.repeat(Math.max(0, 60 - title.length))}`);
  console.log('jogadores   mapa      vizinhos por jogador      total de mensagens');
  console.log('                      com AOI   sessão inteira    com AOI    sessão inteira');
  for (const scenario of rows) {
    const { players, size } = scenario;
    const com = measure(scenario, true);
    const sem = measure(scenario, false);
    console.log(
      `${String(players).padStart(9)}   ${(scenario.thais === true ? 'thais' : `${size}×${size}`).padEnd(9)}`
      + `${com.neighbours.toFixed(1).padStart(7)}   ${sem.neighbours.toFixed(1).padStart(12)}    `
      + `${com.messages.toLocaleString('pt-BR').padStart(9)}  `
      + `${sem.messages.toLocaleString('pt-BR').padStart(14)}`,
    );
  }
  console.log('');
}

console.log(`passos por jogador  ${STEPS}`);
console.log('');
if (THAIS) {
  // A Thais real (FUN-120): todo mundo chegando no templo — a hora do login —, e depois
  // espalhados pelas ruas, cada um num alvo alcançável a pé a intervalos iguais da entrada.
  table('THAIS: todo mundo no templo, como na hora do login',
    PLAYERS.map((players) => ({ players, size: 0, thais: true, entryTiles: players * 4 })));
  table('THAIS: as pessoas espalhadas pelas ruas',
    PLAYERS.map((players) => ({ players, size: 0, thais: true, entryTiles: players * 4, spread: true })));
} else {
  table('a Cidade de HOJE: um ponto de entrada, e todo mundo em cima dele',
    PLAYERS.map((players) => ({ players, size: 128 })));
  table('a Cidade COM LUGARES: as pessoas espalhadas por ela',
    // Mapa proporcional à população, e cada um caminha até um destino próprio antes de a
    // contagem começar: é a praça com loja, depósito e ruas, em que ninguém fica em cima de
    // ninguém. É aqui que se vê a propriedade que a issue pede — o custo por passo PARA de
    // acompanhar quantos estão online.
    PLAYERS.map((players) => ({
      players,
      size: Math.round(Math.sqrt(players) * 14),
      entryTiles: players * 2,
      spread: true,
    })));
}

console.log('O número que decide é "vizinhos por jogador COM AOI".');
console.log('');
console.log('Na Cidade de hoje ele quase não cai: com um ponto de entrada e mais nada, todo');
console.log('mundo fica no mesmo punhado de tiles, e quem está ao alcance da vista É a praça');
console.log('inteira. A AOI não tem o que cortar quando ninguém se espalha — e isso é sobre a');
console.log('Cidade, não sobre a AOI.');
console.log('');
console.log('Na Cidade com lugares ele fica PARADO enquanto a população quintuplica, e é a');
console.log('propriedade que a issue pede: o custo por passo depende de quantos estão POR');
console.log('PERTO, e não de quantos estão online. A coluna ao lado — o comportamento anterior');
console.log('a esta issue — acompanha a população, e o total de mensagens com ela cresce ao');
console.log('quadrado.');
