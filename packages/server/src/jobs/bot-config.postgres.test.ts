import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { botConfigSchema } from '@draconya/content';
import { decodeS2C, encodeC2S, type S2CMessage } from '@draconya/protocol';
import { BotConfigStore } from '../bot-config-store.js';
import { connectTestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { testContent } from '../testing/content.js';
import { DrizzleGameRepository } from '../db/repository.js';
import { characters } from '../db/schema.js';
import { createLogger } from '../log.js';
import { ReceiptStore } from '../receipts.js';
import { AuthService } from '../auth/service.js';
import { RedisAuthSessionStore } from '../auth/sessions.js';
import { loadConfiguration } from '../config.js';
import { buildApi } from '../api/server.js';
import { SessionDirectory } from '../directory.js';
import { TicketService } from '../tickets.js';
import { createGame } from '../game/server.js';
import { createBotConfigValidator, createCitySessionFactory } from '../game/sessions.js';
import { settleBotConfig, writePendingBotConfigs } from './bot-config.js';
import { settleCharacterState } from './character-state.js';
import { createJobsCycle } from './scheduler.js';

// Banco 0 é seguro AQUI: connectTestRedis exige destino descartável explícito.
const { redis, available } = await connectTestRedis(0);
if (!available) throw new Error('Integration Redis is unavailable');
const db = await connectTestDatabase();
const repository = new DrizzleGameRepository(db.database.db);
const botConfigs = new BotConfigStore(redis);
const logger = createLogger('silent', 'bot-config-test');
const options = { database: db.database.db, botConfigs, logger };
const EMPTY = botConfigSchema.parse({ version: 1, heal: [], potion: [], attack: [], rune: [], support: [] });
const HEAL = botConfigSchema.parse({ ...EMPTY, heal: [
  { when: { kind: 'hp', op: '<=', percent: 70 }, do: { kind: 'spell', spellId: 'heal' } },
] });
let characterId: string;
let accountId: string;

beforeEach(async () => {
  await redis.flushdb();
  const account = await repository.ensureAccount({ externalAuthId: randomUUID(), email: `${randomUUID()}@example.com` });
  accountId = account.id;
  const character = await repository.createCharacter(account.id, `Hero ${randomUUID()}`);
  characterId = character.id;
});

afterAll(async () => {
  await redis.flushdb();
  await redis.quit();
  await db.cleanup();
});

const stored = async () => (await repository.getCharacter(accountId, characterId))?.botConfig;

describe('bot configuration write-behind', () => {
  it('writes through the jobs cycle and does not expire pending preferences', async () => {
    await botConfigs.save(characterId, HEAL);
    expect(await stored()).toBeNull();
    expect(await redis.ttl('bot-config:pending')).toBe(-1);
    await createJobsCycle(logger, { database: db.database.db, botConfigs }).run();
    expect(await stored()).toEqual(HEAL);
    expect(await botConfigs.pendingCharacters()).toEqual([]);
  });

  it('keeps pending data when Postgres fails and retries successfully', async () => {
    await botConfigs.save(characterId, HEAL);
    const failure = vi.spyOn(db.database.db, 'transaction').mockRejectedValueOnce(new Error('Database unavailable'));
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
    await db.database.db.update(characters).set({ deletedAt: new Date() }).where(eq(characters.id, characterId));
    expect(await settleBotConfig(characterId, options)).toBe(0);
    const [row] = await db.database.db.select().from(characters).where(eq(characters.id, characterId));
    expect(row?.botConfig).toBeNull();
    expect(await botConfigs.load(characterId)).toBeNull();
  });

  it('fails admission instead of silently returning stale preferences', async () => {
    await botConfigs.save(characterId, HEAL);
    const failure = vi.spyOn(botConfigs, 'load').mockRejectedValueOnce(new Error('Redis unavailable'));
    try {
      await expect(settleCharacterState(characterId, { ...options, receipts: new ReceiptStore(redis) }))
        .rejects.toThrow('Redis unavailable');
    } finally { failure.mockRestore(); }
    expect(await botConfigs.load(characterId)).not.toBeNull();
  });
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing test port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

/** Escuta desde o primeiro quadro: nenhuma resposta pode cair entre duas esperas. */
function connect(url: string) {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const messages: S2CMessage[] = [];
  const wake = new Set<() => void>();
  socket.addEventListener('message', (event) => {
    messages.push(...(decodeS2C(new Uint8Array(event.data as ArrayBuffer)) ?? []));
    for (const notify of wake) notify();
  });
  return {
    socket,
    until(type: S2CMessage['type']): Promise<S2CMessage> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { wake.delete(check); reject(new Error(`Missing ${type}`)); }, 5000);
        function check() {
          const index = messages.findIndex((message) => message.type === type);
          if (index < 0) return;
          const [found] = messages.splice(index, 1);
          clearTimeout(timeout);
          wake.delete(check);
          resolve(found!);
        }
        wake.add(check);
        check();
      });
    },
  };
}

it('saves over a game-only socket and restores the edit on another node before any jobs cycle', async () => {
  const content = testContent();
  const directory = new SessionDirectory(redis);
  const tickets = new TicketService(redis, directory);
  const receipts = new ReceiptStore(redis);
  const auth = new AuthService({ repository, sessions: new RedisAuthSessionStore(redis, 3600), devMode: true });
  const api = buildApi(loadConfiguration({
    PROCESSES: 'api', DATABASE_URL: db.url, REDIS_URL: 'redis://localhost', AUTH_DEV_MODE: 'true',
  }), logger, {
    repository, tickets, auth,
    settleProgress: (id) => settleCharacterState(id, { ...options, receipts }),
  });
  const login = await api.inject({ method: 'POST', url: '/api/auth/dev-login',
    headers: { origin: 'http://localhost:5173' }, payload: { email: `${randomUUID()}@example.com` } });
  expect(login.statusCode).toBe(200);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const owner = login.json<{ accountId: string }>().accountId;
  const character = await repository.createCharacter(owner, `Player ${randomUUID()}`);
  const sockets: WebSocket[] = [];
  const nodes: ReturnType<typeof createGame>[] = [];
  async function node(nodeId: string) {
    const port = await availablePort();
    const configuration = loadConfiguration({
      PROCESSES: 'game', REDIS_URL: 'redis://localhost', NODE_ID: nodeId,
      GAME_PORT: String(port), GAME_PUBLIC_URL: `ws://127.0.0.1:${port}`,
    });
    expect(configuration.DATABASE_URL).toBeUndefined();
    const game = createGame(configuration, logger, {
      directory, tickets, receipts, contentVersion: content.version,
      createSession: createCitySessionFactory(content),
      acceptBotConfig: createBotConfigValidator(content),
      saveBotConfig: (id, config) => botConfigs.save(id, config),
    });
    nodes.push(game);
    await game.start();
    return game;
  }
  async function enter() {
    const response = await api.inject({ method: 'POST', url: '/api/tickets',
      headers: { origin: 'http://localhost:5173', cookie }, payload: { characterId: character.id } });
    expect(response.statusCode).toBe(200);
    const connection = connect(response.json<{ wsUrl: string }>().wsUrl);
    sockets.push(connection.socket);
    await connection.until('welcome');
    return connection;
  }
  try {
    const first = await node('bot-node-one');
    const connection = await enter();
    connection.socket.send(encodeC2S({ type: 'bot-config', config: HEAL }));
    expect(await connection.until('bot-config-result')).toEqual({ type: 'bot-config-result', ok: true });
    expect((await repository.getCharacter(owner, character.id))?.botConfig).toBeNull();
    expect(await botConfigs.load(character.id)).not.toBeNull();
    await first.drain();
    nodes.shift();
    await node('bot-node-two');
    const reconnected = await enter();
    reconnected.socket.send(encodeC2S({ type: 'session-attach' }));
    expect(await reconnected.until('session-state')).toEqual(expect.objectContaining({ botConfig: HEAL }));
    expect((await repository.getCharacter(owner, character.id))?.botConfig).toEqual(HEAL);
    expect(await botConfigs.load(character.id)).toBeNull();
  } finally {
    for (const socket of sockets) socket.close();
    for (const game of nodes) await game.drain();
    await api.close();
  }
}, 15000);
