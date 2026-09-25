// O critério de saída do M13, ponta a ponta (§44.4, ADR 0027, #198).
//
// **É o irmão dos dois critérios anteriores, e existe pela mesma razão.** A F1 prova que a
// sessão sobrevive ao navegador; a F2 prova que ela rende sozinha; este prova que QUATRO
// personagens rendem JUNTOS — e que cada um leva a sua parte ao banco, da mesma sessão.
//
// O roteiro, com HTTP, sockets, Postgres e Redis de verdade:
//
//   1. quatro contas, quatro personagens de quatro vocações, na Cidade
//   2. o líder cria a party pelo `api`, convida, os outros entram, ele inicia (sem aprovação)
//   3. o líder abre o socket com o ticket da party — que CRIA a hunt com os quatro — e FECHA;
//      os outros três NUNCA conectam (invariante 3)
//   4. avançar tempo: os quatro caçam; cada rato rende 50 % da XP a cada um; a bolsa enche
//   5. um membro entra e SAI: leva a cota do settlement no extrato dele; a hunt continua
//   6. drenar: três extratos; o ledger tem quatro linhas da mesma sessão, e a conta fecha
//
// **O tempo é dirigido, nunca esperado**, e **cada passo verifica ESTADO**.

import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeS2C, encodeC2S } from '@draconya/protocol';
import type { S2CMessage } from '@draconya/protocol';
import { buildContent, placeholderAppearances } from '@draconya/content';
import type { RawContent } from '@draconya/content';
import { totalXpForLevel } from '@draconya/sim';
import { and, eq } from 'drizzle-orm';
import { AuthService } from '../auth/service.js';
import { RedisAuthSessionStore } from '../auth/sessions.js';
import { loadConfiguration } from '../config.js';
import { DrizzleGameRepository } from '../db/repository.js';
import { characters, ledger } from '../db/schema.js';
import { SessionDirectory } from '../directory.js';
import { createGame, type GameRole } from '../game/server.js';
import { buildCatalogue } from '../game/catalogue.js';
import {
  createBotConfigValidator, createCitySessionFactory, createSessionBuilder,
  createSessionRestorer,
} from '../game/sessions.js';
import { settleCharacterProgress, writePendingReceipts } from '../jobs/ledger.js';
import { createLogger } from '../log.js';
import { PartyStore } from '../party-store.js';
import { ReceiptStore } from '../receipts.js';
import { SnapshotStore } from '../snapshots.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { rawTestContent } from '../testing/content.js';
import { TicketService } from '../tickets.js';
import { buildApi } from './server.js';

const logger = createLogger('silent', 'party-exit');

/**
 * O conteúdo deste critério: quatro vocações (o pool de XP é por vocações únicas), um rato
 * de 5 XP com gold fixo e um dente que a bolsa VENDE — `value: 3` é o que transforma a
 * bolsa em gold no settlement.
 */
const base = rawTestContent();
const baseProgression = base.progression?.[0];
if (baseProgression === undefined) throw new Error('conteúdo de teste sem progressão');

const VOCATIONS = ['knight', 'druid', 'sorcerer', 'paladin'] as const;
/**
 * Uma arena de 8×5: a de teste comum tem 2×2 de chão, e quatro heróis a enchem — não sobra
 * tile para o rato nascer, e a hunt inteira fica parada sem erro nenhum. O laço passa por
 * fora e os ratos nascem no meio, longe de onde os quatro entram.
 */
const ARENA = { id: 'arena', z: 7, grid: ['##########', '#........#', '#........#', '#........#', '#........#', '#........#', '##########'] };
const LOOP = {
  id: 'arena-loop', mapId: 'arena',
  tiles: [
    { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 3, y: 1, z: 7 }, { x: 4, y: 1, z: 7 },
    { x: 5, y: 1, z: 7 }, { x: 6, y: 1, z: 7 }, { x: 7, y: 1, z: 7 }, { x: 8, y: 1, z: 7 },
    { x: 8, y: 2, z: 7 }, { x: 8, y: 3, z: 7 }, { x: 8, y: 4, z: 7 }, { x: 8, y: 5, z: 7 },
    { x: 7, y: 5, z: 7 }, { x: 6, y: 5, z: 7 }, { x: 5, y: 5, z: 7 }, { x: 4, y: 5, z: 7 },
    { x: 3, y: 5, z: 7 }, { x: 2, y: 5, z: 7 }, { x: 1, y: 5, z: 7 }, { x: 1, y: 4, z: 7 },
    { x: 1, y: 3, z: 7 }, { x: 1, y: 2, z: 7 },
  ],
  spawnPoints: [{ routeIndex: 9, radius: 2 }, { routeIndex: 15, radius: 2 }],
};
const raw: RawContent = {
  ...base,
  maps: [ARENA, ...(base.maps ?? []).filter((map) => (map as { id: string }).id !== 'arena')],
  routes: [LOOP],
  hunts: [{
    id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
    difficulties: { cautious: { monsterCount: 3, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 1_000 } },
  }],
  vocations: VOCATIONS.map((id) => ({ id, name: id, healthPerLevel: 10, manaPerLevel: 10, capacityPerLevel: 10 })),
  items: [{ id: 'rat-tooth', name: 'Dente de Rato', kind: 'other', weight: 1, value: 3 }],
  monsters: [{
    id: 'rat', name: 'Rat', recommendedLevel: 1, health: 20, experience: 5,
    attack: 1, armor: 0, attackIntervalMs: 2_000, speed: 300, aggroRadius: 4,
    loot: {
      gold: { chance: 1, min: 2, max: 2 },
      items: [{ itemId: 'rat-tooth', chance: 1, min: 1, max: 1 }],
    },
  }],
  progression: [{ ...baseProgression, startingMana: 0 }],
};
const content = buildContent({ ...raw, appearances: [placeholderAppearances(raw)] });
const { redis, available: redisReady } = await connectTestRedis(14);
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
    acceptBotConfig: createBotConfigValidator(content),
    itemCatalog: content.items,
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

  async waitFor<N extends S2CMessage['type']>(type: N, timeoutMs = 4_000): Promise<Extract<S2CMessage, { type: N }>> {
    return this.#waitFrom(0, type, timeoutMs);
  }

  async waitForNext<N extends S2CMessage['type']>(type: N, timeoutMs = 4_000): Promise<Extract<S2CMessage, { type: N }>> {
    return this.#waitFrom(this.messages.length, type, timeoutMs);
  }

  async #waitFrom<N extends S2CMessage['type']>(from: number, type: N, timeoutMs: number): Promise<Extract<S2CMessage, { type: N }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.slice(from).reverse().find((m) => m.type === type);
      if (found !== undefined) return found as Extract<S2CMessage, { type: N }>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    }
  }

  close(): void {
    this.socket.close();
    sockets.delete(this.socket);
  }
}

/** Abre o socket com uma `wsUrl` já emitida — a do ticket de party. */
async function open(wsUrl: string): Promise<Inbox> {
  const socket = new WebSocket(wsUrl);
  socket.binaryType = 'arraybuffer';
  sockets.add(socket);
  const inbox = new Inbox(socket);
  await inbox.waitFor('welcome');
  return inbox;
}

async function advance(totalMs: number, stepMs = 5_000): Promise<void> {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    clockMs += stepMs;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
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
  const settleProgress = (characterId: string) => settleCharacterProgress(characterId, {
    database: (database as TestDatabase).database.db, receipts, logger, progression: content.progression,
  });
  api = buildApi(configuration, logger, {
    auth, repository, tickets,
    isCharacterActive: (accountId, characterId) => directory.isActive(accountId, characterId),
    locateSession: (characterId) => directory.lookup(characterId),
    // A lotação viva e o nó do líder do `/join` em curso (#402).
    directory,
    settleProgress,
    listItemInstances: (characterId) => repository.listItemInstances(characterId),
    // A party (#195), montada como o `main.ts` monta.
    party: new PartyStore(redis),
    partyLimits: {
      maxMembers: content.party.maxMembers,
      contentVersion: content.version,
      vocations: [...content.vocations.keys()],
      difficultiesOf: (huntId) => {
        const hunt = content.hunts.get(huntId);
        return hunt === undefined ? null : Object.keys(hunt.difficulties);
      },
    },
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

interface Member {
  readonly cookie: string;
  readonly accountId: string;
  readonly characterId: string;
  readonly vocation: string;
}

describe.runIf(ready)('critério de saída do M13 (§44.4, ADR 0027)', () => {
  it('quatro vocações numa party compartilhada rendem XP conservada (não last-hit), a bolsa vende e divide, e o ledger tem uma linha por membro', async () => {
    await startNode('party-exit-a');
    const db = (database as TestDatabase).database.db;

    // --- 1. quatro contas, quatro personagens de quatro vocações ------------------------
    const members: Member[] = [];
    for (const vocation of VOCATIONS) {
      const { cookie, accountId } = await login();
      const created = await (await request('/api/characters', 'POST', cookie, {
        name: `Hero ${randomUUID().slice(0, 8).replace(/[^a-z]/g, 'a')}`,
      })).json();
      const characterId = String(created.id);
      // Level 10 com a vocação escolhida: é o que faz o pool ser de 4 únicas → 200 %.
      await db.update(characters)
        .set({ level: 10, xp: totalXpForLevel(10, content.progression), vocation, gold: 100 })
        .where(eq(characters.id, characterId));
      members.push({ cookie, accountId, characterId, vocation });
    }
    const [leader, b, c, d] = members as [Member, Member, Member, Member];
    const post = (member: Member, path: string, body: Record<string, unknown> = {}) =>
      request(path, 'POST', member.cookie, { characterId: member.characterId, ...body });

    // --- 2. a party pelo api ---------------------------------------------------------------
    // Desde a #501 não existe aprovação de membros: o líder configura e inicia direto.
    const created = await (await post(leader, '/api/party')).json() as { id: string };
    for (const member of [b, c, d]) {
      expect((await post(leader, `/api/party/${created.id}/invite`, { inviteeId: member.characterId })).status).toBe(200);
      expect((await post(member, `/api/party/${created.id}/join`)).status).toBe(200);
    }
    expect((await post(leader, `/api/party/${created.id}/propose`, { huntId: 'arena', difficulty: 'cautious', mode: 'shared' })).status).toBe(200);
    const started = await (await post(leader, `/api/party/${created.id}/start`)).json() as { sessionId: string; ticket: { wsUrl: string } | null };
    expect(started.ticket).not.toBeNull();

    // --- 3. o líder conecta com o ticket da party — cria a hunt com os quatro — e FECHA ---
    let inbox = await open(started.ticket?.wsUrl ?? '');
    inbox.send({ type: 'session-attach' });
    const state = await inbox.waitFor('session-state');
    expect(state.sessionType).toBe('hunt');
    expect(state.party).toMatchObject({ leaderId: leader.characterId, mode: 'shared' });
    expect(state.party?.members.map((m) => m.characterId).sort()).toEqual(members.map((m) => m.characterId).sort());
    inbox.close();
    // Os outros três estão na hunt SEM nunca terem conectado (invariante 3).
    for (const member of [b, c, d]) {
      expect((await directory.lookup(member.characterId))?.sessionId).toBe(started.sessionId);
    }

    // --- 4. os quatro caçam sozinhos -------------------------------------------------------
    await advance(120_000);

    // --- 5. `c` entra, olha, e SAI: leva a cota do settlement -----------------------------
    // O ticket dele ficou esperando no `mine`; pegar é uma vez.
    const mine = await (await request(`/api/party/mine?characterId=${c.characterId}`, 'GET', c.cookie)).json() as { ticket: { wsUrl: string } | null };
    expect(mine.ticket).not.toBeNull();
    inbox = await open(mine.ticket?.wsUrl ?? '');
    inbox.send({ type: 'session-attach' });
    const seen = await inbox.waitFor('session-state');
    // Cada rato de 5 XP compartilhada rende ceil(5 × 200 / 400) = 3 por cabeça (§525, ADR 0027
    // emenda 2026-09-24) quando os quatro atendem a elegibilidade do TFS/Canary — mas o
    // PRIMEIRO abate acontece no instante 0, antes de qualquer um ter agido (`Party::
    // isPlayerActive`), e cai no rateio por DANO até então; hunts reais em 4 IAs independentes
    // por 2 minutos também esbarram ocasionalmente no alcance/atividade. O total fica ENTRE
    // 0 (rateio por dano pode zerar quem não bateu em nada) e `kills × 3` (o teto, se todo
    // abate tivesse sido compartilhado) — não é `kills × 2` fixo como antes do #525, e não é
    // um número exato: o id da sessão nasce de `randomUUID()` neste teste ponta a ponta, e a
    // semente do RNG de combate (`Rng.fromSeed(session.id)`) varia com ele a cada execução.
    expect(seen.aggregates.kills).toBeGreaterThan(0);
    expect(seen.aggregates.xpGained).toBeGreaterThan(0);
    expect(seen.aggregates.xpGained).toBeLessThanOrEqual(seen.aggregates.kills * 3);
    expect(seen.aggregates.goldGained).toBe(0);
    expect(seen.partyBag?.gold).toBeGreaterThan(0);
    const bagValue = (seen.partyBag?.gold ?? 0) + (seen.partyBag?.items.reduce((n, item) => n + item.quantity, 0) ?? 0) * 3;
    inbox.send({ type: 'leave-hunt' });
    const ended = await inbox.waitForNext('session-ended');
    expect(ended.reason).toBe('manual-exit');
    // A cota dele: a bolsa é vendida no instante da saída, ENTRADA por entrada (#395, D4) —
    // cada drop divide só entre quem estava presente no abate. O que importa aqui é que ele
    // leva a parte DELE; a conservação total (Σ ledger = Σ ganho) é conferida no fechamento.
    expect(ended.aggregates.goldGained).toBeGreaterThan(0);
    expect(ended.aggregates.goldGained).toBeLessThanOrEqual(bagValue);
    inbox.close();
    expect((await directory.lookup(c.characterId))?.type).toBe('city');
    for (const member of [leader, b, d]) {
      expect((await directory.lookup(member.characterId))?.sessionId).toBe(started.sessionId);
    }

    // --- 6. drenar: três extratos mais o de `c`; quatro linhas da mesma sessão -------------
    await advance(30_000);
    const [node] = [...games];
    await node?.drain();
    games.delete(node as GameRole);
    await redis.del('node:party-exit-a:heartbeat');

    const pending = await receipts.pending();
    const ofSession = pending.filter((receipt) => receipt.sessionId === started.sessionId);
    expect(ofSession.map((r) => r.characterId).sort()).toEqual(members.map((m) => m.characterId).sort());
    expect(new Set(ofSession.map((r) => r.seq)).size).toBe(4);
    // §525 (ADR 0027 emenda 2026-09-24): a XP compartilhada do TFS/Canary é TUDO OU NADA por
    // abate — um elegível que nunca atacou nem curou é INATIVO (`Party::isPlayerActive`), e
    // isso desliga a divisão igual para TODO o resto da party naquele abate, não só para ele.
    // Estes quatro personagens não têm bot configurado (só a IA padrão de auto-alvo); com um
    // deles nunca chegando a bater em nada nos 150 s simulados, a party inteira cai no rateio
    // por DANO pelo resto da hunt — cada um recebe proporcional ao que causou. "Todo mundo com
    // a mesma XP" deixou de ser garantia do sistema, e é isso que a fidelidade pede: dividir
    // igual com quem ficou parado seria dar XP de graça, e as engines de origem não fazem isso.
    // O que continua garantido — e é o que fecha o teste — é a CONSERVAÇÃO (ledger == ganho),
    // conferida mais abaixo.
    for (const receipt of ofSession) {
      expect(receipt.aggregates.xpGained).toBeGreaterThanOrEqual(0);
      expect(receipt.aggregates.xpGained).toBeLessThanOrEqual(receipt.aggregates.kills * 3);
    }

    await writePendingReceipts({ database: db, receipts, logger, progression: content.progression });
    const rows = await db.select({ characterId: ledger.characterId, seq: ledger.seq, delta: ledger.delta })
      .from(ledger).where(eq(ledger.sessionId, started.sessionId));
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.seq)).size).toBe(4);
    // FECHAMENTO: o que a party ganhou é o que caiu (gold dos ratos + dentes vendidos), e é
    // exatamente o que entrou nas quatro linhas do ledger. Nada foi gasto (sem bot).
    const totalCredited = rows.reduce((n, row) => n + row.delta, 0);
    const totalGained = ofSession.reduce((n, r) => n + r.aggregates.goldGained - r.aggregates.goldSpent, 0);
    expect(totalCredited).toBe(totalGained);
    expect(totalGained).toBeGreaterThan(0);
    for (const member of members) {
      const [row] = await db.select({ gold: characters.gold, xp: characters.xp }).from(characters)
        .where(and(eq(characters.id, member.characterId), eq(characters.accountId, member.accountId)));
      const receipt = ofSession.find((r) => r.characterId === member.characterId);
      expect(row?.gold).toBe(100 + (receipt?.aggregates.goldGained ?? 0) - (receipt?.aggregates.goldSpent ?? 0));
      expect(row?.xp).toBe(totalXpForLevel(10, content.progression) + (receipt?.aggregates.xpGained ?? 0));
      expect(await directory.activeSlots(member.accountId)).toEqual([]);
    }
  }, 120_000);
});
