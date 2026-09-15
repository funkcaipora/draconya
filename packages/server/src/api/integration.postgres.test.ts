import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildContent, placeholderAppearances } from '@draconya/content';
import type { Content } from '@draconya/content';
import { decodeS2C, encodeC2S } from '@draconya/protocol';
import type { S2CMessage } from '@draconya/protocol';
import { CharacterRuntime, createHuntSession, statsForLevel } from '@draconya/sim';
import { AuthService } from '../auth/service.js';
import { RedisAuthSessionStore } from '../auth/sessions.js';
import { loadConfiguration } from '../config.js';
import { DrizzleGameRepository } from '../db/repository.js';
import { characters } from '../db/schema.js';
import { SessionDirectory } from '../directory.js';
import { createGame } from '../game/server.js';
import { createCitySessionFactory } from '../game/sessions.js';
import { settleCharacterProgress, writePendingReceipts } from '../jobs/ledger.js';
import { createLogger } from '../log.js';
import { ReceiptStore } from '../receipts.js';
import type { Role } from '../role.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { TEST_PROGRESSION, rawTestContent } from '../testing/content.js';
import { TicketService } from '../tickets.js';
import { buildApi } from './server.js';

const logger = createLogger('silent', 'integration');

/**
 * O conteúdo de teste, mais o kit de nascimento (#153): machete na mão e mochila nas costas.
 * O conteúdo de teste puro não tem item nenhum, e é assim que os outros testes o querem; aqui
 * o kit precisa existir de ponta a ponta — criação, ticket, sessão, `inventory` no socket.
 */
function integrationContent(): Content {
  const raw = rawTestContent();
  const armory = {
    items: [
      { id: 'machete', name: 'Machete', kind: 'weapon', slot: 'hand', weight: 16.5, value: 0, attack: 12 },
      { id: 'backpack', name: 'Backpack', kind: 'container', slot: 'back', weight: 18, value: 0, initialSlots: 20 },
      // A arma do Knight (#154): exige a vocação, como as quatro de verdade.
      { id: 'steel-axe', name: 'Steel Axe', kind: 'weapon', slot: 'hand', weight: 41, value: 0, attack: 21,
        requires: { vocationId: 'knight' } },
    ],
    vocations: [{
      id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25,
      startingWeaponItemId: 'steel-axe',
    }],
    progression: [{
      ...TEST_PROGRESSION,
      startingKit: [{ itemId: 'machete', slot: 'hand' }, { itemId: 'backpack', slot: 'back' }],
    }],
  };
  return buildContent({ ...raw, ...armory, appearances: [placeholderAppearances({ ...raw, ...armory })] });
}

let database: TestDatabase;
let redis: Redis;
let repository: DrizzleGameRepository;
let directory: SessionDirectory;
let receipts: ReceiptStore;
let app: ReturnType<typeof buildApi>;
let game: Role;
let baseUrl: string;
const sockets = new Set<WebSocket>();

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing test port');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
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

async function login() {
  const response = await request('/api/auth/dev-login', 'POST', undefined, {
    email: `${randomUUID()}@example.com`,
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (cookie === undefined) throw new Error('missing session cookie');
  const principal = await response.json();
  return { cookie, accountId: String(principal.accountId) };
}

async function createCharacter(cookie: string, name = `Hero ${randomUUID().replace(/[^a-f]/g, '')}`) {
  const response = await request('/api/characters', 'POST', cookie, { name });
  expect(response.status).toBe(201);
  return response.json();
}

function receive(socket: WebSocket): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket message timeout')), 3000);
    socket.addEventListener('message', (event) => {
      clearTimeout(timer);
      resolve(new Uint8Array(event.data as ArrayBuffer));
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket handshake rejected'));
    }, { once: true });
  });
}

/**
 * Espera a mensagem PEDIDA, e não o próximo quadro.
 *
 * Anexar já enfileira catálogo e inventário (FUN-79, FUN-90), então "a próxima coisa que
 * chegar" deixou de ser a resposta ao que se acabou de mandar — e um teste que assume isso
 * quebra a cada mensagem nova no boot, sempre por uma razão que não é a dele.
 */
async function awaitMessage(socket: WebSocket, type: string): Promise<S2CMessage> {
  for (let frame = 0; frame < 8; frame++) {
    const found = decodeS2C(await receive(socket))?.find((m) => m.type === type);
    if (found !== undefined) return found;
  }
  throw new Error(`never received a ${type} message`);
}

beforeAll(async () => {
  database = await connectTestDatabase();
  const connection = await connectTestRedis(4);
  if (!connection.available) throw new Error('integration Redis is unavailable');
  redis = connection.redis;
  await redis.flushdb();
  repository = new DrizzleGameRepository(database.database.db);
  directory = new SessionDirectory(redis);
  const tickets = new TicketService(redis, directory);
  const gamePort = await availablePort();
  const configuration = loadConfiguration({
    DATABASE_URL: database.url, REDIS_URL: process.env['TEST_REDIS_URL'],
    NODE_ENV: 'test', AUTH_DEV_MODE: 'true', GAME_PORT: String(gamePort),
    GAME_PUBLIC_URL: `ws://127.0.0.1:${gamePort}`, NODE_ID: 'integration-node',
  });
  const auth = new AuthService({
    repository, sessions: new RedisAuthSessionStore(redis, 3600), devMode: true,
  });
  receipts = new ReceiptStore(redis);
  const content = integrationContent();
  app = buildApi(configuration, logger, {
    auth, repository, tickets,
    // O kit e a mochila de verdade (#153): o `main.ts` liga os dois do mesmo jeito.
    startingKit: content.progression.startingKit,
    listItemInstances: (characterId) => repository.listItemInstances(characterId),
    isCharacterActive: async (accountId, characterId) =>
      (await directory.lookup(characterId)) !== null
      || (await directory.activeSlots(accountId)).includes(characterId),
    // A liquidação de verdade, não um stub: é ela que o ticket exige (FUN-56), e um stub
    // aqui deixaria a suíte passar com a rota configurada de um jeito que produção não usa.
    settleProgress: (characterId) => settleCharacterProgress(characterId, {
      database: database.database.db,
      receipts,
      logger,
      progression: content.progression,
    }),
  });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  game = createGame(configuration, logger, {
    directory, tickets, contentVersion: 'integration-v1', itemCatalog: content.items,
    // O extrato de estado durável do shard (#154) precisa de onde gravar; e a escolha de
    // vocação, do catálogo dela — ligados como o `main.ts` liga.
    receipts, vocations: content.vocations, vocationLevel: content.progression.vocationLevel,
    createSession: createCitySessionFactory(content),
  });
  await game.start();
  await directory.heartbeat('integration-node', { sessions: 0, url: configuration.GAME_PUBLIC_URL });
}, 20_000);

afterAll(async () => {
  for (const socket of sockets) socket.close();
  await app?.close();
  await game?.drain();
  if (redis !== undefined) { await redis.flushdb(); await redis.quit(); }
  await database?.cleanup();
});

describe('authentication and characters with PostgreSQL, Redis and WebSocket', () => {
  it('creates a persistent account and invalidates the Redis session on logout', async () => {
    expect((await request('/api/auth/me')).status).toBe(401);
    const { cookie, accountId } = await login();
    const token = cookie.split('=')[1]!;
    expect(await redis.ttl(`auth:session:${token}`)).toBeGreaterThan(0);
    expect((await request('/api/auth/me', 'GET', cookie)).status).toBe(200);
    expect(await repository.listCharacters(accountId)).toEqual([]);
    expect((await request('/api/auth/logout', 'POST', cookie)).status).toBe(200);
    expect(await redis.exists(`auth:session:${token}`)).toBe(0);
    expect((await request('/api/auth/me', 'GET', cookie)).status).toBe(401);
  });

  it('keeps initial state and enforces ownership and soft deletion across all routes', async () => {
    const owner = await login();
    const other = await login();
    const character = await createCharacter(owner.cookie);
    expect(character).toMatchObject({
      vocation: null, level: 1, xp: 0, gold: 0, capacity: 400,
      staminaMs: 86400000, premiumUntil: null, state: 'city',
    });
    expect(Number.isNaN(Date.parse(character.staminaUpdatedAt))).toBe(false);
    for (const [path, method, body] of [
      [`/api/characters/${character.id}/select`, 'POST', undefined],
      [`/api/characters/${character.id}`, 'DELETE', undefined],
      ['/api/tickets', 'POST', { characterId: character.id }],
    ] as const) {
      expect((await request(path, method, other.cookie, body)).status).toBe(404);
    }
    expect((await request(`/api/characters/${character.id}/select`, 'POST', owner.cookie)).status).toBe(200);
    expect((await request(`/api/characters/${character.id}`, 'DELETE', owner.cookie)).status).toBe(204);
    expect((await (await request('/api/characters', 'GET', owner.cookie)).json()).characters).toEqual([]);
    expect((await request('/api/tickets', 'POST', owner.cookie, { characterId: character.id })).status).toBe(404);
    expect((await request(`/api/characters/${character.id}/select`, 'POST', owner.cookie)).status).toBe(404);
  });

  it('rejects concurrent case-insensitive duplicate names using the database constraint', async () => {
    const owner = await login();
    const name = `Race ${randomUUID().replace(/[^a-f]/g, '')}`;
    const results = await Promise.all([
      request('/api/characters', 'POST', owner.cookie, { name }),
      request('/api/characters', 'POST', owner.cookie, { name: name.toUpperCase() }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it('reserves only two active characters while allowing more characters to exist', async () => {
    const owner = await login();
    const characters = [];
    for (let i = 0; i < 4; i++) characters.push(await createCharacter(owner.cookie));
    const responses = await Promise.all(characters.map((character) =>
      request('/api/tickets', 'POST', owner.cookie, { characterId: character.id })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 409, 409]);
    for (const id of await directory.activeSlots(owner.accountId)) {
      expect((await request(`/api/characters/${id}`, 'DELETE', owner.cookie)).status).toBe(409);
    }
  });

  it('serializes deletion and ticket issuance without issuing a deleted character ticket', async () => {
    for (let i = 0; i < 6; i++) {
      const owner = await login();
      const character = await createCharacter(owner.cookie);
      const [ticket, deletion] = await Promise.all([
        request('/api/tickets', 'POST', owner.cookie, { characterId: character.id }),
        request(`/api/characters/${character.id}`, 'DELETE', owner.cookie),
      ]);
      expect([[200, 409], [404, 204]]).toContainEqual([ticket.status, deletion.status]);
    }
  });

  it('settles pending progress before it hands out a ticket (FUN-56)', async () => {
    // O caminho inteiro, pela rota HTTP de verdade: extrato no Redis, `POST /api/tickets`,
    // linha do personagem em dia. Sem esta cobertura, tirar o `settleProgress` da composição
    // do `buildApi` passaria calado — e o jogador voltaria a reconectar dentro dos dez
    // segundos da varredura e ver o personagem com o progresso de antes.
    const owner = await login();
    const character = await createCharacter(owner.cookie);
    await receipts.save({
      sessionId: randomUUID(),
      characterId: character.id,
      accountId: owner.accountId,
      reason: 'drain',
      seq: 1,
      aggregates: {
        durationMs: 60_000, xpGained: 900, goldGained: 500, goldSpent: 120, kills: 12, deaths: 0,
       itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
      },
      notableEvents: [],
    });

    expect((await request('/api/tickets', 'POST', owner.cookie, {
      characterId: character.id,
    })).status).toBe(200);

    const [row] = await database.database.db
      .select({ xp: characters.xp, gold: characters.gold, level: characters.level })
      .from(characters)
      .where(eq(characters.id, character.id));
    expect(row).toMatchObject({ xp: 900, gold: 380 });
    expect(row?.level).toBeGreaterThan(1);
    expect(await receipts.pendingFor(character.id)).toEqual([]);
  });

  it('gold looted in a hunt reaches character.gold through the ledger (FUN-63)', async () => {
    // O caminho inteiro do loot: abate → `goldDelta` e agregado na sessão → extrato → linha
    // de ledger com `(session_id, seq)` → `character.gold` no Postgres. O que reprova aqui é
    // uma quebra entre o delta do personagem e o que o extrato leva — gold que o jogador viu
    // cair e que some no deploy.
    const owner = await login();
    const character = await createCharacter(owner.cookie);
    const content = integrationContent();
    const session = createHuntSession({
      id: randomUUID(), content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, content.progression);
    const hero = new CharacterRuntime({
      id: character.id, position: { x: 0, y: 0, z: 7 },
      health: stats.maxHealth, maxHealth: stats.maxHealth, mana: 0, maxMana: stats.maxMana,
      level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);
    while (session.aggregates.kills === 0 && session.nowMs < 60_000) session.advanceBy(100);
    expect(session.aggregates.kills).toBeGreaterThan(0);
    expect(hero.goldDelta).toBeGreaterThan(0);

    const [receipt] = session.end('manual-exit');
    if (receipt === undefined) throw new Error('sem extrato');
    expect(receipt.aggregates.goldGained).toBe(hero.goldDelta);
    await receipts.save({
      sessionId: session.id, characterId: character.id, accountId: owner.accountId,
      reason: receipt.reason, seq: 1, aggregates: receipt.aggregates, notableEvents: [],
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression: content.progression,
    });

    const [row] = await database.database.db
      .select({ gold: characters.gold })
      .from(characters)
      .where(eq(characters.id, character.id));
    expect(row?.gold).toBe(hero.goldDelta);
  });

  it('the character list and select settle pending progress before reading (FUN-66)', async () => {
    // A tela onde o jogador cai logo depois de sair de uma hunt. Ela lia a linha crua e, por
    // até dez segundos, mostrava o level e a XP de antes — duas telas discordando na mesma
    // sessão de uso. Mesmo caminho do ticket (FUN-56); a diferença é que aqui falhar não
    // recusa a resposta.
    const owner = await login();
    const character = await createCharacter(owner.cookie);
    await receipts.save({
      sessionId: randomUUID(), characterId: character.id, accountId: owner.accountId,
      reason: 'drain', seq: 1,
      aggregates: {
        durationMs: 60_000, xpGained: 900, goldGained: 500, goldSpent: 120, kills: 12, deaths: 0,
       itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
      },
      notableEvents: [],
    });

    const listed = await (await request('/api/characters', 'GET', owner.cookie)).json();
    const dto = (listed.characters as Array<{ id: string; xp: number; gold: number; level: number }>)
      .find((c) => c.id === character.id);
    expect(dto).toMatchObject({ xp: 900, gold: 380 });
    expect(dto?.level).toBeGreaterThan(1);
    expect(await receipts.pendingFor(character.id)).toEqual([]);

    // E `select`, com um segundo extrato: o id já é conhecido, liquida antes de ler.
    await receipts.save({
      sessionId: randomUUID(), characterId: character.id, accountId: owner.accountId,
      reason: 'drain', seq: 1,
      aggregates: {
        durationMs: 1_000, xpGained: 0, goldGained: 20, goldSpent: 0, kills: 0, deaths: 0,
       itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
      },
      notableEvents: [],
    });
    const selected = await (await request(
      `/api/characters/${character.id}/select`, 'POST', owner.cookie,
    )).json();
    expect(selected).toMatchObject({ id: character.id, gold: 400 });
  });

  it('uses a one-time ticket for a real socket, keeps the session after disconnect, and reconnects', async () => {
    const owner = await login();
    const character = await createCharacter(owner.cookie);
    const issue = await request('/api/tickets', 'POST', owner.cookie, { characterId: character.id });
    const ticket = await issue.json();
    const forgedUrl = new URL(ticket.wsUrl);
    forgedUrl.searchParams.set('ticket', owner.cookie.split('=')[1]!);
    const forged = new WebSocket(forgedUrl);
    sockets.add(forged);
    await expect(receive(forged)).rejects.toThrow('handshake rejected');
    const socket = new WebSocket(ticket.wsUrl);
    sockets.add(socket);
    socket.binaryType = 'arraybuffer';
    const welcome = decodeS2C(await receive(socket));
    expect(welcome).toContainEqual({ type: 'welcome', characterId: character.id, contentVersion: 'integration-v1' });
    const pong = awaitMessage(socket, 'pong');
    socket.send(encodeC2S({ type: 'ping', t: 123 }));
    expect(await pong).toEqual({ type: 'pong', t: 123 });
    const location = await directory.lookup(character.id);
    expect(location?.nodeId).toBe('integration-node');
    expect((await request(`/api/characters/${character.id}`, 'DELETE', owner.cookie)).status).toBe(409);
    const replay = new WebSocket(ticket.wsUrl);
    sockets.add(replay);
    await expect(receive(replay)).rejects.toThrow('handshake rejected');
    socket.close();
    const nextTicket = await (await request('/api/tickets', 'POST', owner.cookie, { characterId: character.id })).json();
    const reconnected = new WebSocket(nextTicket.wsUrl);
    sockets.add(reconnected);
    reconnected.binaryType = 'arraybuffer';
    await receive(reconnected);
    expect(await directory.lookup(character.id)).toEqual(location);
  });

  it('a new character is born wearing the kit, and the inventory on attach shows it (#153)', async () => {
    // Ponta a ponta: `POST /api/characters` grava o kit, o ticket o carrega em `inventory`, a
    // sessão de Cidade nasce com ele no `CharacterRuntime`, e o `inventory` do attach o mostra
    // equipado — com o peso contando na capacidade. O que reprova aqui é qualquer elo solto.
    const owner = await login();
    const character = await createCharacter(owner.cookie);
    const ticket = await (await request('/api/tickets', 'POST', owner.cookie, { characterId: character.id })).json();
    const socket = new WebSocket(ticket.wsUrl);
    sockets.add(socket);
    socket.binaryType = 'arraybuffer';
    // O inventário chega pela fila do attach, num quadro que pode ser o do `welcome` ou um
    // dos seguintes (FUN-102).
    const first = decodeS2C(await receive(socket)) ?? [];
    const inventory = first.find((m) => m.type === 'inventory') ?? await awaitMessage(socket, 'inventory');
    if (inventory.type !== 'inventory') throw new Error('não veio inventory');

    expect(inventory.equipped['hand']).toMatchObject({ itemId: 'machete', instanceId: `${character.id}:kit:1`, quantity: 1 });
    expect(inventory.equipped['back']).toMatchObject({ itemId: 'backpack', instanceId: `${character.id}:kit:2` });
    // Posicional (#160): os 20 lugares da mochila do kit, todos vazios; a bolsa com 10.
    expect(inventory.backpack).toHaveLength(20);
    expect(inventory.backpack.every((place) => place === null)).toBe(true);
    expect(inventory.satchel).toHaveLength(10);
    expect(inventory.capacity.used).toBeGreaterThan(0);
    expect(inventory.capacity.used).toBeLessThan(inventory.capacity.total);
  });

  it('choosing the vocation in the City survives a logout: ticket, session-state and inventory bring it back (#154)', async () => {
    // A premissa que a spec corrigiu: o shard não gravava extrato, e a escolha feita na praça
    // sumia no logout. Ponta a ponta: level 8 na linha → ticket → `choose-vocation` no socket
    // → `logout` → extrato de estado durável no Redis → `POST /api/tickets` liquida → a linha
    // tem `vocation`, e a sessão nova nasce com ela e com a arma na mão.
    const owner = await login();
    const character = await createCharacter(owner.cookie);
    await database.database.db
      .update(characters).set({ level: 8, xp: 20 * 64 }).where(eq(characters.id, character.id));

    const first = await (await request('/api/tickets', 'POST', owner.cookie, { characterId: character.id })).json();
    const socket = new WebSocket(first.wsUrl);
    sockets.add(socket);
    socket.binaryType = 'arraybuffer';
    await receive(socket);
    socket.send(encodeC2S({ type: 'choose-vocation', vocationId: 'knight' }));
    const stats = await awaitMessage(socket, 'player-stats');
    if (stats.type !== 'player-stats') throw new Error('não veio player-stats');
    expect(stats.vocationId).toBe('knight');
    socket.send(encodeC2S({ type: 'logout' }));
    await new Promise<void>((resolve) => { socket.addEventListener('close', () => { resolve(); }, { once: true }); });

    // O extrato está no Redis, e o ticket seguinte o liquida antes de ler a linha (FUN-56).
    await vi.waitFor(async () => { expect(await receipts.pendingFor(character.id)).toHaveLength(1); });
    const second = await (await request('/api/tickets', 'POST', owner.cookie, { characterId: character.id })).json();
    const [row] = await database.database.db
      .select({ vocation: characters.vocation }).from(characters).where(eq(characters.id, character.id));
    expect(row?.vocation).toBe('knight');

    const again = new WebSocket(second.wsUrl);
    sockets.add(again);
    again.binaryType = 'arraybuffer';
    const frames = decodeS2C(await receive(again)) ?? [];
    const inventory = frames.find((m) => m.type === 'inventory') ?? await awaitMessage(again, 'inventory');
    if (inventory.type !== 'inventory') throw new Error('não veio inventory');
    expect(inventory.equipped['hand']).toMatchObject({ itemId: 'steel-axe' });
    expect(inventory.backpack.filter((item) => item !== null).map((item) => item.itemId)).toEqual(['machete']);
    again.send(encodeC2S({ type: 'session-attach' }));
    const state = await awaitMessage(again, 'session-state');
    if (state.type !== 'session-state') throw new Error('não veio session-state');
    expect(state.self.vocationId).toBe('knight');
  });

  it('walk through the real socket moves the character, and session-state shows it (FUN-69)', async () => {
    // A ligação socket → host → sistema de movimento, ponta a ponta. O que reprova aqui é o
    // `walk` chegando e caindo no `default` de novo.
    const owner = await login();
    const character = await createCharacter(owner.cookie);
    const ticket = await (await request('/api/tickets', 'POST', owner.cookie, { characterId: character.id })).json();
    const socket = new WebSocket(ticket.wsUrl);
    sockets.add(socket);
    socket.binaryType = 'arraybuffer';
    await receive(socket);                                            // welcome

    // Nasceu PERTO do entryPoint da Cidade de teste — e não em (0,0), que é a FUN-60, nem
    // fora do mapa, que seria a praça compartilhada sem lugar para ele (FUN-71).
    //
    // "Perto" e não "em cima": a praça é uma cópia só (FUN-71), então o tile de entrada pode
    // estar ocupado por quem chegou antes, e o personagem entra no livre mais próximo. Achar
    // a PRÓPRIA criatura pelo `self.creatureId` é o que mantém este teste falando do
    // personagem deste teste, e não de quem mais estiver na praça.
    // `awaitMessage`, e não "o próximo quadro": o catálogo e o inventário do `attach` chegam
    // pela fila, num quadro que pode cair entre o `welcome` e o `session-state` — era a corrida
    // que a FUN-102 registrou como "não é timeout" (falhava em 150 ms, sob carga).
    socket.send(encodeC2S({ type: 'session-attach' }));
    // A posição vai em `world.creatures`, nunca em `self`: o cliente não decide onde está.
    const initial = await awaitMessage(socket, 'session-state');
    if (initial.type !== 'session-state') throw new Error('não veio session-state');
    const mine = initial.world.creatures.find((c) => c.id === initial.self.creatureId);
    if (mine === undefined) throw new Error('o personagem não está no próprio session-state');
    expect(mine.position.z).toBe(7);
    expect(Math.max(
      Math.abs(mine.position.x - 2), Math.abs(mine.position.y - 2),
    )).toBeLessThanOrEqual(2);

    // INTENÇÃO: uma direção. Quem resolve o tile é o servidor (invariante 4).
    const from = mine.position;
    socket.send(encodeC2S({ type: 'walk', direction: 'east' }));
    expect(await awaitMessage(socket, 'creature-move')).toEqual(expect.objectContaining({
      type: 'creature-move', from, to: { ...from, x: from.x + 1 },
    }));

    socket.send(encodeC2S({ type: 'session-attach' }));
    const state = await awaitMessage(socket, 'session-state');
    if (state.type !== 'session-state') throw new Error('não veio session-state');
    expect(state.world.creatures.find((c) => c.id === state.self.creatureId)?.position)
      .toEqual({ ...from, x: from.x + 1 });
  });

  it('say through the real socket comes back as chat-message, signed with the character name (FUN-58)', async () => {
    // A ligação socket → host → visualizadores, e o nome vindo do BANCO pelo ticket — nunca
    // do cliente, que não escolhe como aparece para os outros.
    const owner = await login();
    const character = await createCharacter(owner.cookie, 'Chatter');
    const ticket = await (await request('/api/tickets', 'POST', owner.cookie, { characterId: character.id })).json();
    const socket = new WebSocket(ticket.wsUrl);
    sockets.add(socket);
    socket.binaryType = 'arraybuffer';
    await receive(socket);                                            // welcome

    socket.send(encodeC2S({ type: 'say', channel: 'local', text: 'olá, sessão' }));
    expect(await awaitMessage(socket, 'chat-message')).toEqual({
      type: 'chat-message', channel: 'local', author: 'Chatter', text: 'olá, sessão',
    });
  });

  it('fails closed when the HTTP session store loses Redis', async () => {
    const owner = await login();
    const disconnected = new Redis(process.env['TEST_REDIS_URL']!, {
      lazyConnect: true, enableOfflineQueue: false, retryStrategy: () => null,
    });
    disconnected.disconnect();
    const configuration = loadConfiguration({
      DATABASE_URL: database.url, REDIS_URL: process.env['TEST_REDIS_URL'], NODE_ENV: 'test',
    });
    const failedApi = buildApi(configuration, logger, {
      auth: new AuthService({
        repository, sessions: new RedisAuthSessionStore(disconnected, 3600), devMode: true,
      }),
      repository,
    });
    try {
      const response = await failedApi.inject({
        method: 'GET', url: '/api/characters', headers: { cookie: owner.cookie },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'service-unavailable' });
    } finally {
      await failedApi.close();
    }
  });

  it('rejects a failed Redis handshake without stopping the game process', async () => {
    const port = await availablePort();
    const disconnected = new Redis(process.env['TEST_REDIS_URL']!, {
      lazyConnect: true, enableOfflineQueue: false, retryStrategy: () => null,
    });
    disconnected.disconnect();
    const configuration = loadConfiguration({
      DATABASE_URL: database.url, REDIS_URL: process.env['TEST_REDIS_URL'], NODE_ENV: 'test',
      GAME_PORT: String(port), NODE_ID: 'failed-handshake-node',
    });
    const failedGame = createGame(configuration, logger, {
      tickets: new TicketService(disconnected, directory),
      contentVersion: 'integration-v1', createSession: createCitySessionFactory(integrationContent()),
    });
    await failedGame.start();
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/?ticket=unavailable`);
      sockets.add(socket);
      await expect(receive(socket)).rejects.toThrow('handshake rejected');
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    } finally {
      await failedGame.drain();
    }
  });
});
