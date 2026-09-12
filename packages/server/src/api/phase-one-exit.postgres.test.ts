// O critério de saída da Fase 1, ponta a ponta (FUN-44).
//
// **É o contrato de regressão da propriedade central do projeto**: a sessão sobrevive ao
// navegador e ao restart. Quando este arquivo quebrar daqui a três meses, vai ser porque
// alguém reintroduziu acoplamento entre socket e sessão — e ele avisa antes de produção.
//
// O roteiro é o da issue, com sockets, Postgres e Redis de verdade:
//
//   1. criar conta, criar personagem, pedir ticket, conectar
//   2. entrar numa hunt; percorrer a rota, matar e ganhar XP
//   3. FECHAR o socket — sem sair da hunt
//   4. avançar tempo suficiente para subir de level
//   5. reconectar; o estado traz o progresso correto
//   6. matar o nó sem drenar; subir outro; a sessão volta do snapshot
//   7. drenar com sessão ativa; extrato creditado no banco; nenhuma órfã
//
// **O tempo é dirigido, não esperado.** Um teste que dorme dez minutos não roda no CI e
// portanto não roda nunca — é mais uma razão para `sim/` não ter relógio global (invariante 1).
// O relógio do nó é injetado, e o laço de ciclo real (100 ms) aplica o salto simulado.
//
// **Cada passo verifica ESTADO, não ausência de erro.** "Não lançou exceção" passa com a
// sessão parada.

import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeS2C, encodeC2S } from '@draconya/protocol';
import type { S2CMessage } from '@draconya/protocol';
import { AuthService } from '../auth/service.js';
import { RedisAuthSessionStore } from '../auth/sessions.js';
import { loadConfiguration } from '../config.js';
import { DrizzleGameRepository } from '../db/repository.js';
import { characters } from '../db/schema.js';
import { SessionDirectory } from '../directory.js';
import { createGame, type GameRole } from '../game/server.js';
import {
  createCitySessionFactory, createSessionBuilder, createSessionRestorer,
} from '../game/sessions.js';
import { settleCharacterProgress, writePendingReceipts } from '../jobs/ledger.js';
import { createLogger } from '../log.js';
import { ReceiptStore } from '../receipts.js';
import { SnapshotStore } from '../snapshots.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { testContent } from '../testing/content.js';
import { TicketService } from '../tickets.js';
import { buildApi } from './server.js';
import { eq } from 'drizzle-orm';

const logger = createLogger('silent', 'phase-one');
const content = testContent();

const { redis, available: redisReady } = await connectTestRedis(7);
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

async function startNode(nodeId: string): Promise<GameRole> {
  const port = await availablePort();
  const configuration = loadConfiguration({
    DATABASE_URL: database?.url, REDIS_URL: process.env['TEST_REDIS_URL'], NODE_ENV: 'test',
    GAME_PORT: String(port), GAME_PUBLIC_URL: `ws://127.0.0.1:${port}`, NODE_ID: nodeId,
  });
  const game = createGame(configuration, logger, {
    directory, tickets, snapshots, receipts,
    contentVersion: content.version,
    createSession: createCitySessionFactory(content),
    buildSession: createSessionBuilder(content),
    restoreSession: createSessionRestorer(content),
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
    // FUN-56: emitir ticket liquida o extrato pendente antes de ler a linha. Está aqui
    // porque é assim que o `main.ts` monta a rota — e este teste existe para exercitar o
    // caminho de produção, não uma versão dele.
    settleProgress: (characterId) => settleCharacterProgress(characterId, {
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

describe.runIf(ready)('critério de saída da Fase 1', () => {
  it('a hunt sobrevive ao navegador fechado, à queda do nó e ao deploy', async () => {
    const node = await startNode('phase-one-a');

    // --- 1. conta, personagem, ticket, socket ------------------------------------------
    const { cookie, accountId } = await login();
    const created = await (await request('/api/characters', 'POST', cookie, {
      name: `Hero ${randomUUID().slice(0, 8).replace(/[^a-z]/g, 'a')}`,
    })).json();
    const characterId = String(created.id);
    let inbox = await connect(cookie, characterId);

    // --- 2. entrar na hunt, percorrer, matar, ganhar XP ---------------------------------
    inbox.send({ type: 'enter-hunt', huntId: 'arena', difficulty: 'cautious' });
    const entered = await inbox.waitFor('session-state');
    expect(entered.sessionType).toBe('hunt');

    await advance(60_000);
    inbox.send({ type: 'session-attach' });
    const hunting = await inbox.waitForNext('session-state');
    // ESTADO, não ausência de erro: o personagem matou e ganhou XP de verdade.
    expect(hunting?.aggregates.kills).toBeGreaterThan(0);
    expect(hunting?.self.xp).toBeGreaterThan(0);
    const xpBeforeClosing = hunting?.self.xp ?? 0;

    // A API já reporta a atividade pelo diretório, não pela coluna que ninguém escreve.
    const listed = await (await request('/api/characters', 'GET', cookie)).json();
    expect(listed.characters[0].state).toBe('hunt');

    // --- 3. FECHAR o navegador, sem sair da hunt ----------------------------------------
    inbox.close();
    await until(() => node.host?.viewersOf(characterId) === 0, 'the viewer to detach');

    // --- 4. tempo suficiente para subir de level ----------------------------------------
    await advance(300_000);

    // --- 5. voltar e reencontrar a sessão rodando --------------------------------------
    inbox = await connect(cookie, characterId);
    inbox.send({ type: 'session-attach' });
    const resumed = await inbox.waitFor('session-state');
    expect(resumed.sessionType).toBe('hunt');
    // Rendeu ENQUANTO NINGUÉM OLHAVA: é o projeto inteiro em uma asserção.
    expect(resumed.self.xp).toBeGreaterThan(xpBeforeClosing);
    expect(resumed.self.level).toBeGreaterThan(1);
    const xpBeforeCrash = resumed.self.xp;

    // --- 6. matar o nó sem drenar; outro nó retoma do snapshot --------------------------
    await node.host?.saveAll();
    inbox.close();
    node.stop();
    games.delete(node);
    // É assim que um nó morto se parece para o diretório: sem batimento.
    await redis.del('node:phase-one-a:heartbeat');

    await startNode('phase-one-b');
    inbox = await connect(cookie, characterId);
    inbox.send({ type: 'session-attach' });
    const afterCrash = await inbox.waitFor('session-state');

    expect(afterCrash.sessionType).toBe('hunt');
    // O progresso voltou do snapshot: nem zerado, nem inventado.
    expect(afterCrash.self.xp).toBeGreaterThanOrEqual(xpBeforeCrash);
    expect((await directory.lookup(characterId))?.nodeId).toBe('phase-one-b');
    // E o jogador é AVISADO da retomada, em vez de descobrir pelo extrato que não fecha.
    expect(inbox.last('system-message')?.text).toMatch(/retomada/i);

    // --- 7. deploy com drenagem: extrato creditado, nenhuma órfã ------------------------
    const xpBeforeDrain = afterCrash.self.xp;
    const [nodeB] = [...games];
    await nodeB?.drain();
    games.delete(nodeB as GameRole);

    // Creditada: o snapshot e o registro no diretório TÊM que sumir, senão a próxima conexão
    // retomaria o estado de antes do encerramento e creditaria os mesmos agregados de novo.
    expect(await snapshots.load(characterId)).toBeNull();
    expect(await directory.lookup(characterId)).toBeNull();

    // UM extrato, e o da Cidade não sumiu: ele já foi liquidado. Entrar na hunt encerrou a
    // sessão de Cidade, e toda sessão que acaba gera extrato — o da Cidade vem zerado, que é
    // o registro de que o personagem trocou de atividade. A reconexão do passo 6 emitiu um
    // ticket, e emitir ticket liquida o que aquele personagem tem pendente (FUN-56): é
    // justamente o que impede o jogador de reconectar e ver o personagem com o progresso de
    // antes. O que sobrou aqui é o da drenagem, que aconteceu depois da última reconexão.
    const pending = await receipts.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.reason).toBe('drain');
    expect(pending[0]?.aggregates.xpGained).toBeGreaterThan(0);
    // Cada sessão credita uma vez: `seq` repetido no mesmo `sessionId` seria crédito dobrado.
    expect(new Set(pending.map((r) => `${r.sessionId}:${r.seq}`)).size).toBe(pending.length);

    // O extrato vira linha de personagem: sem isto, tudo acima seria progresso que some na
    // próxima conexão (FUN-54).
    await writePendingReceipts({
      database: (database as TestDatabase).database.db,
      receipts,
      logger,
      progression: content.progression,
    });
    const [row] = await (database as TestDatabase).database.db
      .select({ xp: characters.xp, level: characters.level, gold: characters.gold })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(row?.xp).toBeGreaterThanOrEqual(xpBeforeDrain);
    expect(row?.level).toBeGreaterThan(1);
    // O loot dos abates chegou à linha (FUN-63): `goldDelta` → agregado → ledger → `gold`.
    expect(row?.gold).toBeGreaterThan(0);

    // Nenhuma órfã: o slot voltou, e a conta pode usar os outros personagens.
    expect(await directory.activeSlots(accountId)).toEqual([]);
  }, 120_000);
});
