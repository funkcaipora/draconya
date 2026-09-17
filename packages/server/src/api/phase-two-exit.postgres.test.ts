// O critério de saída da Fase 2, ponta a ponta (§44.3).
//
// **É o irmão do `phase-one-exit.test.ts`, e existe pela mesma razão.** Aquele prova que a
// sessão sobrevive ao navegador e ao restart; este prova que ela RENDE enquanto ninguém olha —
// e que o número que o jogador lê é o número que chega ao banco.
//
// O plano nomeia o critério da F2 como "§44.3 inteiro: hunt solo AFK com bot, supply, loot,
// analisador, stamina zero, morte". Sem um teste, isso é uma lista de coisas que existem
// separadas: o bot tem teste, o loot tem teste, o ledger tem teste — e nada afirma que os três
// contam a MESMA história sobre a mesma hunt.
//
// O roteiro, com sockets, Postgres e Redis de verdade:
//
//   1. conta, personagem com gold, ticket, socket
//   2. CONFIGURAR o bot pelo socket — curar e beber poção, como um jogador faria
//   3. entrar na hunt e FECHAR o navegador
//   4. avançar tempo: o bot age sozinho, mata, coleta e gasta
//   5. voltar: o analisador mostra o que rendeu
//   6. drenar: o extrato vira linha de personagem, e os números BATEM com os do analisador
//   7. stamina zero para de render, e a morte devolve à Cidade
//
// **O tempo é dirigido, não esperado**, e **cada passo verifica ESTADO** — as duas regras do
// teste da F1, pelas mesmas razões que estão escritas lá.

import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeS2C, encodeC2S } from '@draconya/protocol';
import type { S2CMessage } from '@draconya/protocol';
import { buildContent, botConfigSchema, placeholderAppearances } from '@draconya/content';
import { BOT_VOCABULARY_VERSION } from '@draconya/content';
import type { RawContent } from '@draconya/content';
import { AuthService } from '../auth/service.js';
import { RedisAuthSessionStore } from '../auth/sessions.js';
import { loadConfiguration } from '../config.js';
import { DrizzleGameRepository } from '../db/repository.js';
import { characters, itemInstances } from '../db/schema.js';
import { SessionDirectory } from '../directory.js';
import { createGame, type GameRole } from '../game/server.js';
import { buildCatalogue } from '../game/catalogue.js';
import {
  createBotConfigValidator, createCitySessionFactory, createSessionBuilder,
  createSessionRestorer,
} from '../game/sessions.js';
import { writePendingReceipts } from '../jobs/ledger.js';
import { createLogger } from '../log.js';
import { BotConfigStore } from '../bot-config-store.js';
import { settleBotConfig, writePendingBotConfigs } from '../jobs/bot-config.js';
import { settleCharacterState } from '../jobs/character-state.js';
import { createJobsCycle } from '../jobs/scheduler.js';
import { ReceiptStore } from '../receipts.js';
import { SnapshotStore } from '../snapshots.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { rawTestContent } from '../testing/content.js';
import { totalXpForLevel } from '@draconya/sim';
import { TicketService } from '../tickets.js';
import { buildApi } from './server.js';
import { eq } from 'drizzle-orm';

const logger = createLogger('silent', 'phase-two');

/**
 * O conteúdo desta fase, e ele NÃO é o `testContent()` compartilhado.
 *
 * A F2 precisa de coisas que o conteúdo de teste comum não tem, e que mudá-lo para ter
 * quebraria testes que não falam disso: um item que sempre cai (para provar loot), mana para o
 * bot curar, e um rato que machuca de verdade (para a morte acontecer sem esperar uma hora).
 */
const base = rawTestContent();
const baseProgression = base.progression?.[0];
if (baseProgression === undefined) throw new Error('conteúdo de teste sem progressão');

const raw: RawContent = {
  ...base,
  items: [{
    id: 'rat-tooth', name: 'Dente de Rato', kind: 'other', weight: 1, value: 0,
  }, {
    id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 1, value: 0,
    twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' },
  }],
  ammunition: [{
    id: 'arrow', name: 'Arrow', family: 'arrow', attack: 20, price: 0,
  }, {
    id: 'sniper-arrow', name: 'Sniper Arrow', family: 'arrow', attack: 30, price: 5,
    requires: { level: 20 },
  }],
  hunts: [...(base.hunts ?? []), {
    // A hunt em que se morre. Existe porque a morte é metade do §44.3 e esperar por ela num
    // rato de 6 de dano levaria horas simuladas — o que este teste mede é o CAMINHO da morte
    // (encerrar, creditar, devolver à Cidade), não quanto tempo ela demora.
    id: 'lethal', name: 'Arena Letal', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
    difficulties: {
      cautious: {
        monsterCount: 1, composition: [{ monsterId: 'reaper', weight: 1 }],
        respawnDelayMs: 1_000,
      },
    },
  }],
  monsters: [{
    id: 'reaper', name: 'Ceifador', recommendedLevel: 1,
    health: 100_000, experience: 0, attack: 400, armor: 0,
    attackIntervalMs: 1_000, speed: 300, aggroRadius: 8,
    loot: { items: [] },
  }, {
    id: 'rat', name: 'Rat', recommendedLevel: 1, health: 20, experience: 5,
    attack: 6, armor: 0, attackIntervalMs: 2_000, speed: 300, aggroRadius: 4,
    // Chance 1 tira o sorteio da conta: o que este teste mede é o caminho do loot até o
    // banco, não a distribuição.
    loot: {
      gold: { chance: 1, min: 2, max: 2 },
      items: [{ itemId: 'rat-tooth', chance: 1, min: 1, max: 1 }],
    },
  }],
  progression: [{
    ...baseProgression,
    // Mana para o bot ter o que gastar curando, e HP folgado pelo mesmo motivo do teste da
    // F1: um personagem que morre no meio faz o teste falhar por balanceamento.
    startingMana: 200,
  }],
};
// A aparência é derivada DEPOIS da troca de monstros e itens (FUN-94): a tabela que veio de
// `rawTestContent` só conhece o rato, e o Ceifador e o dente entram aqui.
const content = buildContent({ ...raw, appearances: [placeholderAppearances(raw)] });
const { redis, available: redisReady } = await connectTestRedis(11);
let database: TestDatabase | null = null;
let ready = false;
if (redisReady && (process.env['DATABASE_TEST_URL'] ?? '') !== '') {
  try {
    database = await connectTestDatabase();
    ready = true;
  } catch {
    database = null;
  }
}

let repository: DrizzleGameRepository;
let directory: SessionDirectory;
let snapshots: SnapshotStore;
let receipts: ReceiptStore;
let botConfigs: BotConfigStore;
let tickets: TicketService;
let api: ReturnType<typeof buildApi>;
let baseUrl: string;
const games = new Set<GameRole>();
const sockets = new Set<WebSocket>();

/** O relógio da simulação, em milissegundos. O teste o empurra; ninguém dorme. */
let clockMs = 0;

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing test port');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

const nodeIds = new Set<string>();

async function startNode(nodeId: string): Promise<GameRole> {
  nodeIds.add(nodeId);
  const port = await availablePort();
  const configuration = loadConfiguration({
    DATABASE_URL: database?.url, REDIS_URL: process.env['TEST_REDIS_URL'], NODE_ENV: 'test',
    GAME_PORT: String(port), GAME_PUBLIC_URL: `ws://127.0.0.1:${port}`, NODE_ID: nodeId,
  });
  const game = createGame(configuration, logger, {
    directory, tickets, snapshots, receipts,
    saveBotConfig: (id, config) => botConfigs.save(id, config),
    contentVersion: content.version,
    createSession: createCitySessionFactory(content),
    buildSession: createSessionBuilder(content),
    restoreSession: createSessionRestorer(content),
    // O nó de VERDADE tem os dois: sem o validador, `bot-config` é recusado com "este
    // servidor não aceita configuração", e o teste mediria um servidor que não é o de
    // produção. O catálogo entra pela mesma razão.
    acceptBotConfig: createBotConfigValidator(content),
    itemCatalog: content.items,
    ammunition: content.ammunition,
    catalogue: () => buildCatalogue(content),
    now: () => clockMs,
  });
  await game.start();
  games.add(game);
  return game;
}

function request(path: string, method = 'GET', cookie?: string, body?: object) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin: 'http://localhost:5173',
      ...(cookie === undefined ? {} : { cookie }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function login(): Promise<{ cookie: string; accountId: string }> {
  const response = await request('/api/auth/dev-login', 'POST', undefined, {
    email: `${randomUUID()}@example.com`,
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (cookie === undefined) throw new Error('missing session cookie');
  const principal = await response.json();
  return { cookie, accountId: String(principal.accountId) };
}

/** Abre um socket com um ticket novo e devolve as mensagens que chegarem. */
async function connect(cookie: string, characterId: string): Promise<Inbox> {
  const issued = await (await request('/api/tickets', 'POST', cookie, { characterId })).json();
  const socket = new WebSocket(String(issued.wsUrl));
  socket.binaryType = 'arraybuffer';
  sockets.add(socket);
  const inbox = new Inbox(socket);
  await inbox.waitFor('welcome');
  return inbox;
}

/**
 * Caixa de entrada do socket. Guarda TUDO que chegou, porque o teste pergunta pelo estado
 * depois — esperar por uma mensagem específica no instante em que ela chega é como um teste
 * de rede vira intermitente.
 */
class Inbox {
  readonly messages: S2CMessage[] = [];
  readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      this.messages.push(...(decodeS2C(new Uint8Array(event.data as ArrayBuffer)) ?? []));
    });
  }

  send(message: Parameters<typeof encodeC2S>[0]): void {
    this.socket.send(encodeC2S(message));
  }

  last<N extends S2CMessage['type']>(type: N): Extract<S2CMessage, { type: N }> | undefined {
    const found = [...this.messages].reverse().find((message) => message.type === type);
    return found as Extract<S2CMessage, { type: N }> | undefined;
  }

  async waitFor<N extends S2CMessage['type']>(
    type: N,
    timeoutMs = 4_000,
  ): Promise<Extract<S2CMessage, { type: N }>> {
    return this.#waitFrom(0, type, timeoutMs);
  }

  /**
   * Espera uma mensagem que ainda NÃO chegou. `waitFor` devolve a última já recebida, o que
   * é certo para "chegou um welcome?" e errado para "chegou o estado que eu acabei de pedir"
   * — ali ele devolveria o `session-state` de antes, e o teste passaria lendo dado velho.
   */
  async waitForNext<N extends S2CMessage['type']>(
    type: N,
    timeoutMs = 4_000,
  ): Promise<Extract<S2CMessage, { type: N }>> {
    return this.#waitFrom(this.messages.length, type, timeoutMs);
  }

  async #waitFrom<N extends S2CMessage['type']>(
    from: number, type: N, timeoutMs: number,
  ): Promise<Extract<S2CMessage, { type: N }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.slice(from).reverse().find((m) => m.type === type);
      if (found !== undefined) return found as Extract<S2CMessage, { type: N }>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
      // Cedência, com prazo: a mensagem vem da rede, e não há relógio a injetar (FUN-62).
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    }
  }

  close(): void {
    this.socket.close();
    sockets.delete(this.socket);
  }
}

/**
 * Empurra o relógio da simulação e espera o ciclo real aplicar o salto.
 *
 * Em saltos, não de uma vez: o acumulador de ação periódica tem teto de recuperação (32
 * aplicações), então um salto único de dez minutos seria descartado em parte. Saltos de cinco
 * segundos cabem com folga e continuam custando milissegundos de relógio de parede.
 */
async function advance(totalMs: number, stepMs = 5_000): Promise<void> {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    clockMs += stepMs;
    // Não é prazo, é cedência: o ciclo REAL do nó (100 ms) precisa acordar e ler o relógio
    // empurrado. Não dá para injetar — o ciclo é o `setInterval` do host de verdade, e é
    // justamente ele que este teste exercita (FUN-62).
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
}

/**
 * Encerra os nós vivos e APAGA o batimento deles.
 *
 * `drain` para o temporizador, mas a chave de batimento fica no Redis até o TTL vencer — e o
 * ticket é emitido para um nó que o diretório ainda vê vivo. O sintoma é o pior tipo: passa na
 * máquina rápida e falha no CI, com "timed out waiting for welcome", que não aponta para nada.
 *
 * É a mesma limpeza que o teste da F1 faz ao matar um nó, pela mesma razão.
 */
async function retireNodes(): Promise<void> {
  for (const game of games) {
    await game.drain().catch(() => undefined);
    games.delete(game);
  }
  for (const id of nodeIds) {
    await redis.del(`node:${id}:heartbeat`);
  }
}

/** Espera uma condição do nó com PRAZO, em vez de dormir um número escolhido no olho. */
async function until(condition: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
}

beforeAll(async () => {
  if (!ready || database === null) return;
  await redis.flushdb();
  repository = new DrizzleGameRepository(database.database.db);
  directory = new SessionDirectory(redis);
  snapshots = new SnapshotStore(redis);
  receipts = new ReceiptStore(redis);
  botConfigs = new BotConfigStore(redis);
  tickets = new TicketService(redis, directory);
  const configuration = loadConfiguration({
    DATABASE_URL: database.url, REDIS_URL: process.env['TEST_REDIS_URL'],
    NODE_ENV: 'test', AUTH_DEV_MODE: 'true',
  });
  const auth = new AuthService({
    repository, sessions: new RedisAuthSessionStore(redis, 3600), devMode: true,
  });
  api = buildApi(configuration, logger, {
    auth, repository, tickets,
    isCharacterActive: (accountId, characterId) => directory.isActive(accountId, characterId),
    locateSession: (characterId) => directory.lookup(characterId),
    // O processo de produção passa a mochila para a emissão do ticket; sem isso, uma arma
    // equipada no banco não chega ao `game` e o roteiro não exercita a munição escolhida.
    listItemInstances: (characterId) => repository.listItemInstances(characterId),
    // FUN-56: emitir ticket liquida o extrato pendente antes de ler a linha. Está aqui
    // porque é assim que o `main.ts` monta a rota — e este teste existe para exercitar o
    // caminho de produção, não uma versão dele.
    settleProgress: (characterId) => settleCharacterState(characterId, {
      botConfigs,
      database: (database as TestDatabase).database.db,
      receipts,
      logger,
      progression: content.progression,
    }),
  });
  baseUrl = await api.listen({ port: 0, host: '127.0.0.1' });
}, 30_000);

afterAll(async () => {
  for (const socket of sockets) socket.close();
  for (const game of games) await game.drain().catch(() => undefined);
  await api?.close();
  if (redisReady) { await redis.flushdb(); await redis.quit(); }
  await database?.cleanup();
});


/**
 * Um bot como um jogador escreveria: poção enquanto o arranhão é pequeno, magia quando aperta.
 *
 * **As duas categorias disparam juntas, e é de propósito.** Cura e poção têm cooldowns
 * independentes (§13.5): cada uma age por si, e uma configuração em que só a mais barata dispara
 * nunca exercitaria o gasto de gold — que é metade do §44.3.
 */
const BOT_CONFIG = {
  version: BOT_VOCABULARY_VERSION,
  heal: [{
    when: { kind: 'hp', op: '<=', percent: 90 },
    do: { kind: 'spell', spellId: 'heal' },
  }],
  potion: [{
    when: { kind: 'hp', op: '<=', percent: 98 },
    do: { kind: 'supply', supplyId: 'health-potion' },
  }],
  attack: [], rune: [], support: [],
};

describe.runIf(ready)('critério de saída da Fase 2 (§44.3)', () => {
  it('a hunt AFK rende, e o que o analisador mostra é o que o ledger recebe', async () => {
    await startNode('phase-two-a');

    // --- 1. conta, personagem COM GOLD, socket -----------------------------------------
    //
    // Gold na linha, porque supply é comprado com gold (§20.1): sem saldo, o bot recusa a
    // poção por `not-enough-gold` e o teste mediria a recusa em vez do gasto.
    const { cookie, accountId } = await login();
    const created = await (await request('/api/characters', 'POST', cookie, {
      name: `Hero ${randomUUID().slice(0, 8).replace(/[^a-z]/g, 'a')}`,
    })).json();
    const characterId = String(created.id);
    await (database as TestDatabase).database.db.update(characters)
      .set({ gold: 5_000 }).where(eq(characters.id, characterId));

    let inbox = await connect(cookie, characterId);

    // --- 2. CONFIGURAR o bot, como um jogador faria -------------------------------------
    inbox.send({ type: 'bot-config', config: BOT_CONFIG });
    const accepted = await inbox.waitFor('bot-config-result');
    // A recusa traria o motivo; exigir `ok` é o que impede o teste de seguir com um bot que
    // o servidor não aceitou — e aí a hunt renderia só pelo ataque básico, sem ninguém notar.
    expect(accepted).toMatchObject({ ok: true });

    // --- 3. entrar na hunt e FECHAR o navegador -----------------------------------------
    inbox.send({ type: 'enter-hunt', huntId: 'arena', difficulty: 'cautious' });
    expect((await inbox.waitFor('session-state')).sessionType).toBe('hunt');
    inbox.close();

    // --- 4. o bot age sozinho ------------------------------------------------------------
    await advance(300_000);

    // --- 5. voltar: o analisador mostra o que rendeu -------------------------------------
    inbox = await connect(cookie, characterId);
    inbox.send({ type: 'session-attach' });
    const analyzer = await inbox.waitForNext('session-state');
    const { aggregates } = analyzer;

    // O loop inteiro numa asserção: matou, ganhou XP, coletou gold e item, e GASTOU — que é
    // a metade do §44.3 que só existe com bot e supply juntos.
    expect(aggregates.kills).toBeGreaterThan(0);
    expect(aggregates.xpGained).toBeGreaterThan(0);
    expect(aggregates.goldGained).toBeGreaterThan(0);
    expect(aggregates.itemsLooted).toBeGreaterThan(0);
    expect(aggregates.suppliesUsed).toBeGreaterThan(0);
    expect(aggregates.goldSpent).toBeGreaterThan(0);
    // Maior hit resolvido: o analisador do §16.1 sem ele é uma tabela de contagens.
    expect(aggregates.bestBasicHit).toBeGreaterThan(0);

    // E a mochila chegou junto: o item que caiu está lá, não só no contador (FUN-90).
    // Sem mochila nas costas nesta fixture, o loot vai para a bolsa (#160): conta os dois.
    const carried = inbox.last('inventory');
    expect([...(carried?.backpack ?? []), ...(carried?.satchel ?? [])].filter((place) => place !== null).length).toBeGreaterThan(0);

    // --- 6. drenar: o extrato vira linha, e os números BATEM ------------------------------
    const [node] = [...games];
    await node?.drain();
    games.delete(node as GameRole);
    await redis.del('node:phase-two-a:heartbeat');

    const pending = await receipts.pending();
    const drained = pending.find((receipt) => receipt.reason === 'drain');
    expect(drained).toBeDefined();

    // **O NÚMERO QUE O JOGADOR LEU É O NÚMERO QUE VAI PARA O BANCO.** Se estes dois puderem
    // divergir, o analisador vira uma segunda contabilidade — e a divergência aparece como
    // "o analisador me deu mais gold do que caiu na conta", meses depois.
    expect(drained?.aggregates.xpGained).toBeGreaterThanOrEqual(aggregates.xpGained);
    expect(drained?.aggregates.goldGained).toBeGreaterThanOrEqual(aggregates.goldGained);
    expect(drained?.aggregates.goldSpent).toBeGreaterThanOrEqual(aggregates.goldSpent);

    await writePendingReceipts({
      database: (database as TestDatabase).database.db,
      receipts, logger, progression: content.progression,
    });
    const [row] = await (database as TestDatabase).database.db
      .select({ xp: characters.xp, gold: characters.gold })
      .from(characters)
      .where(eq(characters.id, characterId));

    // O saldo é o que entrou menos o que saiu, sobre o que ele tinha. Conferir a CONTA, e não
    // só "é maior que zero", é o que pega um ledger que credita e não debita.
    const expected = 5_000 + (drained?.aggregates.goldGained ?? 0)
      - (drained?.aggregates.goldSpent ?? 0);
    expect(row?.gold).toBe(expected);
    expect(row?.xp).toBeGreaterThanOrEqual(aggregates.xpGained);
    expect(await directory.activeSlots(accountId)).toEqual([]);
  }, 120_000);

  it('stamina zero PARA de render, e a hunt continua', async () => {
    await retireNodes();
    // §10.2: stamina zerada bloqueia XP e loot, e NÃO encerra a hunt. As duas metades importam
    // — encerrar sozinho seria o jogo decidindo por quem deixou o personagem rendendo, e
    // continuar rendendo seria a stamina não existir.
    await startNode('phase-two-b');
    const { cookie } = await login();
    const created = await (await request('/api/characters', 'POST', cookie, {
      name: `Tired ${randomUUID().slice(0, 8).replace(/[^a-z]/g, 'a')}`,
    })).json();
    const characterId = String(created.id);
    // Chega com a stamina no fim. O ticket leva o que a linha diz (invariante 4), e é assim
    // que o teste alcança em segundos um estado que leva vinte horas de jogo.
    //
    // `staminaUpdatedAt` é AGORA, e não a época: a entrada materializa a stamina (§10), e o
    // tempo desde a última atualização é recuperação. Com a data zerada, o personagem chegaria
    // com a barra CHEIA — e o teste mediria o oposto do que promete.
    await (database as TestDatabase).database.db.update(characters)
      .set({ staminaMs: 0, staminaUpdatedAt: new Date() })
      .where(eq(characters.id, characterId));

    const inbox = await connect(cookie, characterId);
    inbox.send({ type: 'enter-hunt', huntId: 'arena', difficulty: 'cautious' });
    await inbox.waitFor('session-state');

    // A asserção é "PARA de crescer", e não "é zero", e a diferença é honesta: entre gravar a
    // linha e o ticket ser emitido passam milissegundos, e a stamina RECUPERA nesse intervalo
    // (§10). Sobra uma lasca, que rende o primeiro abate. Exigir zero seria exigir que o
    // relógio não ande entre duas chamadas HTTP.
    await advance(60_000);
    inbox.send({ type: 'session-attach' });
    const cedo = (await inbox.waitForNext('session-state')).aggregates;
    // A lasca já queimou: o que ela rendeu está aqui dentro, e daqui para a frente é zero.
    expect(inbox.last('player-stats')?.staminaMs ?? 0).toBe(0);

    await advance(120_000);
    inbox.send({ type: 'session-attach' });
    const tarde = (await inbox.waitForNext('session-state')).aggregates;

    // Continuou matando — a hunt NÃO parou, e §10.2 é explícito que ela não para...
    expect(tarde.kills).toBeGreaterThan(cedo.kills);
    // ...e parou de render: nem XP, nem gold, nem item, por mais dois minutos de abates.
    expect(tarde.xpGained).toBe(cedo.xpGained);
    expect(tarde.goldGained).toBe(cedo.goldGained);
    expect(tarde.itemsLooted).toBe(cedo.itemsLooted);
    // E o jogador é AVISADO uma vez, em vez de descobrir pelo gold que não subiu.
    expect(tarde.durationMs).toBeGreaterThan(cedo.durationMs);
    inbox.close();
  }, 120_000);

  it('a morte encerra a hunt e devolve à Cidade, com o extrato', async () => {
    await retireNodes();
    // §26.1: morrer é o outro fim do loop. O que ele NÃO pode ser é sumir em silêncio — o
    // extrato sai, e o personagem volta vivo para a praça, curado (§26.1).
    await startNode('phase-two-c');
    const { cookie } = await login();
    const created = await (await request('/api/characters', 'POST', cookie, {
      name: `Doomed ${randomUUID().slice(0, 8).replace(/[^a-z]/g, 'a')}`,
    })).json();
    const characterId = String(created.id);

    const inbox = await connect(cookie, characterId);
    inbox.send({ type: 'enter-hunt', huntId: 'lethal', difficulty: 'cautious' });
    await inbox.waitFor('session-state');

    await advance(120_000);
    const ended = await inbox.waitFor('session-ended');

    expect(ended.reason).toBe('death');
    expect(ended.aggregates.deaths).toBe(1);
    // Voltou à Cidade, e vivo: "a hunt acabou" nunca pode significar "ficou sem sessão"
    // (invariante 8), e a PZ cura na entrada.
    //
    // `last`, e não `waitForNext`: a Cidade chega JUNTO do extrato, e esperar "a próxima"
    // esperaria uma mensagem que já passou. É a armadilha que o próprio `waitForNext`
    // documenta, do outro lado.
    await until(
      () => inbox.last('session-state')?.sessionType === 'city',
      'a volta para a Cidade',
    );
    const back = inbox.last('session-state');
    expect(back?.self.health).toBe(back?.self.maxHealth);
    expect(back?.self.health).toBeGreaterThan(0);
    inbox.close();
  }, 120_000);

  it('keeps settled gold and selected ammunition across City reattach (#241)', async () => {
    await retireNodes();
    const node = await startNode('phase-two-d');
    const { cookie } = await login();
    const created = await (await request('/api/characters', 'POST', cookie, {
      name: `Archer ${randomUUID().slice(0, 8).replace(/[^a-z]/g, 'a')}`,
    })).json();
    const characterId = String(created.id);
    const db = (database as TestDatabase).database.db;
    await db.update(characters)
      .set({ gold: 20_000, level: 20, xp: totalXpForLevel(20, content.progression) })
      .where(eq(characters.id, characterId));
    await db.insert(itemInstances).values({
      id: `${characterId}:bow`, itemId: 'bow', ownerCharacterId: characterId,
      quantity: 1, origin: 'admin', equippedSlot: 'hand',
    });
    expect((await db.select().from(itemInstances).where(eq(itemInstances.ownerCharacterId, characterId)))
      .find((item) => item.id === `${characterId}:bow`)?.equippedSlot).toBe('hand');

    let inbox = await connect(cookie, characterId);
    inbox.send({ type: 'select-ammo', ammoId: 'sniper-arrow' });
    expect((await inbox.waitFor('player-stats')).ammo.arrow).toBe('sniper-arrow');
    const cityHero = node.host?.sessionFor(characterId)?.participants.find((participant) => participant.id === characterId);
    expect(cityHero).toBeDefined();
    expect(cityHero?.inventory.getState().equipped.hand?.itemId).toBe('bow');
    inbox.send({ type: 'enter-hunt', huntId: 'arena', difficulty: 'cautious' });
    await inbox.waitFor('session-state');
    await advance(60_000);
    inbox.send({ type: 'session-attach' });
    const firstHunt = await inbox.waitForNext('session-state');
    expect(firstHunt.aggregates.goldSpent).toBeGreaterThan(0);

    inbox.send({ type: 'leave-hunt' });
    await until(() => inbox.last('session-state')?.sessionType === 'city', 'the first return to City');
    inbox.close();

    // O ticket liquida o extrato antes de a conexão nova chegar ao mesmo host de Cidade.
    inbox = await connect(cookie, characterId);
    inbox.send({ type: 'session-attach' });
    await inbox.waitForNext('session-state');
    const [row] = await db.select({ gold: characters.gold, ammo: characters.ammo })
      .from(characters).where(eq(characters.id, characterId));
    const hot = node.host?.sessionFor(characterId)?.participants.find((participant) => participant.id === characterId);
    const stats = inbox.last('player-stats');
    expect(hot?.gold).toBe(row?.gold);
    expect(hot?.goldDelta).toBe(0);
    expect(stats?.gold).toBe(row?.gold);
    expect(stats?.ammo.arrow).toBe('sniper-arrow');
    expect(row?.ammo).toEqual({ arrow: 'sniper-arrow' });

    inbox.send({ type: 'enter-hunt', huntId: 'arena', difficulty: 'cautious' });
    await inbox.waitForNext('session-state');
    await advance(60_000);
    inbox.send({ type: 'session-attach' });
    const secondHunt = await inbox.waitForNext('session-state');
    expect(secondHunt.aggregates.goldSpent).toBeGreaterThan(0);
    inbox.close();
  }, 120_000);
});

/**
 * A persistência do bot sem Postgres no `game` (#263, ADR 0028), no MESMO fixture: o passo 2
 * do roteiro acima é "configurar o bot pelo socket", e é o que este bloco prova que sobrevive
 * — ao ciclo do `jobs`, à falha de cada serviço, a duas edições concorrentes, e à troca de nó
 * antes de qualquer ciclo.
 *
 * Mora aqui, e não num arquivo próprio, porque os bancos de Redis de teste acabaram: `testing/redis.ts`
 * lista 1 a 15, e o 0 é o do desenvolvimento local — um arquivo novo o tomaria e `flushdb`
 * apagaria o diretório de sessões de quem roda `pnpm check` com um jogo aberto ao lado.
 */
describe.runIf(ready)('persistência do bot entre processos (#263, ADR 0028)', () => {
  const db = () => (database as TestDatabase).database.db;
  const EMPTY = botConfigSchema.parse({ version: 1, heal: [], potion: [], attack: [], rune: [], support: [] });
  const HEAL = botConfigSchema.parse({ ...EMPTY, heal: [
    { when: { kind: 'hp', op: '<=', percent: 70 }, do: { kind: 'spell', spellId: 'heal' } },
  ] });
  let options: { database: ReturnType<typeof db>; botConfigs: BotConfigStore; logger: typeof logger };
  let characterId: string;
  let accountId: string;

  beforeEach(async () => {
    options = { database: db(), botConfigs, logger };
    // Só a fila e a quarentena, nunca `flushdb`: o fixture é compartilhado com o roteiro acima.
    await redis.del('bot-config:pending', 'bot-config:corrupt');
    const account = await repository.ensureAccount({
      externalAuthId: randomUUID(), email: `${randomUUID()}@example.com`,
    });
    accountId = account.id;
    characterId = (await repository.createCharacter(account.id, `Hero ${randomUUID()}`)).id;
  });

  const stored = async () => (await repository.getCharacter(accountId, characterId))?.botConfig;

  it('writes through the jobs cycle and does not expire pending preferences', async () => {
    await botConfigs.save(characterId, HEAL);
    expect(await stored()).toBeNull();
    expect(await redis.ttl('bot-config:pending')).toBe(-1);
    await createJobsCycle(logger, { database: db(), botConfigs }).run();
    expect(await stored()).toEqual(HEAL);
    expect(await botConfigs.pendingCharacters()).toEqual([]);
  });

  it('does not open a transaction when nothing is pending', async () => {
    // A admissão chama isto em toda listagem e em todo ticket: o caso comum custa um
    // `HEXISTS`, nunca uma trava de linha.
    const transaction = vi.spyOn(db(), 'transaction');
    try {
      expect(await settleBotConfig(characterId, options)).toBe(0);
      expect(transaction).not.toHaveBeenCalled();
    } finally { transaction.mockRestore(); }
  });

  it('keeps pending data when Postgres fails and retries successfully', async () => {
    await botConfigs.save(characterId, HEAL);
    const failure = vi.spyOn(db(), 'transaction').mockRejectedValueOnce(new Error('Database unavailable'));
    try {
      expect(await writePendingBotConfigs(options)).toEqual({ written: 0, failed: 1 });
      expect(await stored()).toBeNull();
      expect(await botConfigs.load(characterId)).not.toBeNull();
    } finally { failure.mockRestore(); }
    expect(await writePendingBotConfigs(options)).toEqual({ written: 1, failed: 0 });
    expect(await stored()).toEqual(HEAL);
  });

  it('retries a committed write after an acknowledgement failure', async () => {
    await botConfigs.save(characterId, HEAL);
    const failure = vi.spyOn(botConfigs, 'acknowledge').mockRejectedValueOnce(new Error('Redis unavailable'));
    try {
      await expect(settleBotConfig(characterId, options)).rejects.toThrow('Redis unavailable');
      expect(await stored()).toEqual(HEAL);
      expect(await botConfigs.load(characterId)).not.toBeNull();
    } finally { failure.mockRestore(); }
    await settleBotConfig(characterId, options);
    expect(await botConfigs.load(characterId)).toBeNull();
    expect(await stored()).toEqual(HEAL);
  });

  it('does not acknowledge a newer edit, even when the payload is identical', async () => {
    await botConfigs.save(characterId, HEAL);
    const earlier = (await botConfigs.load(characterId))!;
    await botConfigs.save(characterId, HEAL);
    await botConfigs.acknowledge(characterId, earlier);
    expect(await botConfigs.load(characterId)).not.toBeNull();
    await settleBotConfig(characterId, options);
    expect(await stored()).toEqual(HEAL);
  });

  it('serializes consumers and preserves an edit received during a database transaction', async () => {
    await botConfigs.save(characterId, HEAL);
    let read!: () => void;
    let resume!: () => void;
    const firstRead = new Promise<void>((resolve) => { read = resolve; });
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const originalLoad = botConfigs.load.bind(botConfigs);
    const delayed = vi.spyOn(botConfigs, 'load').mockImplementationOnce(async (id) => {
      const value = await originalLoad(id);
      read();
      await gate;
      return value;
    });
    const first = settleBotConfig(characterId, options);
    await firstRead;
    try {
      await botConfigs.save(characterId, EMPTY);
      const second = settleBotConfig(characterId, options);
      resume();
      await Promise.all([first, second]);
      expect(await stored()).toEqual(EMPTY);
      expect(await botConfigs.load(characterId)).toBeNull();
    } finally { resume(); delayed.mockRestore(); }
  });

  it('does not overwrite a deleted character or keep its pending entry forever', async () => {
    await botConfigs.save(characterId, HEAL);
    await db().update(characters).set({ deletedAt: new Date() }).where(eq(characters.id, characterId));
    expect(await settleBotConfig(characterId, options)).toBe(0);
    const [row] = await db().select().from(characters).where(eq(characters.id, characterId));
    expect(row?.botConfig).toBeNull();
    expect(await botConfigs.load(characterId)).toBeNull();
  });

  it.each([
    ['not JSON', 'not json'],
    ['JSON without an envelope', JSON.stringify({ nope: 1 })],
  ])('quarantines a corrupt pending entry (%s) instead of refusing admission', async (_, raw) => {
    // Valor corrompido vira AUSENTE, nunca login recusado (#265) — a regra das cores do
    // outfit e do Bestiário, aqui para a fila. A coluna fica como estava; o jogador salva de novo.
    await redis.hset('bot-config:pending', characterId, raw);
    const settled = await settleCharacterState(characterId, { ...options, receipts });
    expect(settled).toEqual({ written: 0, failed: 0 });
    expect(await stored()).toBeNull();
    expect(await botConfigs.load(characterId)).toBeNull();
    expect(await redis.hget('bot-config:corrupt', characterId)).toBe(raw);
  });

  it('never drops a valid edit that landed on top of a corrupt one', async () => {
    await botConfigs.save(characterId, HEAL);
    await botConfigs.quarantine(characterId, { serialized: 'garbage', corrupt: true });
    expect(await botConfigs.load(characterId)).toEqual(expect.objectContaining({ config: HEAL }));
    expect(await redis.hget('bot-config:corrupt', characterId)).toBe('garbage');
    expect(await settleBotConfig(characterId, options)).toBe(1);
    expect(await stored()).toEqual(HEAL);
  });

  it('fails admission instead of silently returning stale preferences', async () => {
    await botConfigs.save(characterId, HEAL);
    const failure = vi.spyOn(botConfigs, 'load').mockRejectedValueOnce(new Error('Redis unavailable'));
    try {
      await expect(settleCharacterState(characterId, { ...options, receipts }))
        .rejects.toThrow('Redis unavailable');
    } finally { failure.mockRestore(); }
    expect(await botConfigs.load(characterId)).not.toBeNull();
  });

  it('saves over a game-only socket and restores the edit on another node before any jobs cycle', async () => {
    await retireNodes();
    const { cookie, accountId: owner } = await login();
    const created = await (await request('/api/characters', 'POST', cookie, {
      name: `Player ${randomUUID().slice(0, 8).replace(/[^a-z]/g, 'a')}`,
    })).json();
    const playerId = String(created.id);

    // O nó de jogo não recebe repositório (é o `PROCESSES=game` de produção), e mesmo assim salva.
    await startNode('bot-node-one');
    const inbox = await connect(cookie, playerId);
    inbox.send({ type: 'bot-config', config: HEAL });
    expect(await inbox.waitForNext('bot-config-result')).toEqual({ type: 'bot-config-result', ok: true });
    expect((await repository.getCharacter(owner, playerId))?.botConfig).toBeNull();
    expect(await botConfigs.load(playerId)).not.toBeNull();
    inbox.close();

    // Outro nó, antes de qualquer ciclo do `jobs`: é a ADMISSÃO que leva a edição ao banco.
    await retireNodes();
    await startNode('bot-node-two');
    const reconnected = await connect(cookie, playerId);
    reconnected.send({ type: 'session-attach' });
    expect(await reconnected.waitForNext('session-state'))
      .toEqual(expect.objectContaining({ botConfig: HEAL }));
    expect((await repository.getCharacter(owner, playerId))?.botConfig).toEqual(HEAL);
    expect(await botConfigs.load(playerId)).toBeNull();
    reconnected.close();
  }, 30_000);
});
