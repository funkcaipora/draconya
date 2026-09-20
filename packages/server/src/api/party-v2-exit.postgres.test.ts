// O critério de saída do M20, ponta a ponta (§5, ADR 0035, #407).
//
// **É o irmão do critério do M13, e existe pela mesma razão.** O do M13 prova que quatro
// personagens rendem JUNTOS; este prova que OITO personagens de quatro vocações atravessam as
// cinco mudanças do M20 na MESMA sessão, na ordem em que um jogador as encontraria: sala
// pública com faixa de level (um fora é recusado), entrada em curso, os dois eixos mutáveis,
// coleta/autovenda com o limite do líder Premium, autovenda por elegibilidade, bolsa com
// reserva proporcional e OVERWEIGHT, troca de liderança recalculando o limite, follow de
// membro e cura de aliado, e o ledger fechando com uma linha por membro.
//
// O roteiro, com HTTP, sockets, Postgres e Redis de verdade:
//
//   1. oito contas/personagens, dois por vocação; só o líder é Premium
//   2. a party pelo `api`, configuração com os DOIS eixos e composição por vocação (2 de cada),
//      level mínimo 10; sala publicada SEM corpo (RF-03)
//   3. seis entram (convidados) e iniciam; o líder conecta (o socket dele cria a hunt) — o 7º
//      entra pela sala com a hunt EM CURSO e o 8º também, cada um pela VAGA da vocação dele
//   4. um level 5 tenta a sala e é recusado (`room-not-eligible`)
//   5. o líder configura coleta/autovenda; o limite é o de Premium (20)
//   6. avançar: a autovenda credita só quem estava no abate; a bolsa reserva proporcional e
//      enche até OVERWEIGHT sem perder item
//   7. o líder (Premium) sai: o mais antigo (Free) assume e o limite cai para 5
//   8. um membro segue outro e fica adjacente; a druida cura o aliado
//   9. drenar: oito extratos, oito linhas de ledger da MESMA sessão, e a soma fecha
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
  createBotConfigValidator, createCitySessionFactory, createLateJoiner, createSessionBuilder,
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

const logger = createLogger('silent', 'party-v2-exit');

/**
 * O conteúdo deste critério: quatro vocações (duas de cada), um rato de 5 XP com gold fixo e
 * DOIS itens — um que a autovenda vende (`rat-tooth`, `value: 3`) e um pesado que a bolsa
 * coleciona até encher (`rat-tail`, `weight: 10`). A capacidade por level é ZERO e a inicial é
 * 10: cada membro carrega exatamente uma cauda, então oito abates enchem a bolsa e forçam
 * OVERWEIGHT sem precisar mexer em inventário por coluna (DT-02 do #407).
 */
const base = rawTestContent();
const baseProgression = base.progression?.[0];
const baseParty = base.party?.[0];
if (baseProgression === undefined || baseParty === undefined) {
  throw new Error('conteúdo de teste sem progressão ou party');
}

const VOCATIONS = ['knight', 'druid', 'sorcerer', 'paladin'] as const;
/**
 * A arena de 14×9 (interior 12×7): oito heróis e os ratos precisam de ESPAÇO. A de 8×5 do
 * critério do M13 enche com quatro, e com oito o anel de um tile congestiona — o passo guloso
 * do follow não acha tile livre para se aproximar. A rota é o perímetro do interior.
 */
const ARENA_WIDTH = 14;
const ARENA_HEIGHT = 9;
const ARENA = {
  id: 'arena', z: 7,
  grid: Array.from({ length: ARENA_HEIGHT }, (_, y) =>
    y === 0 || y === ARENA_HEIGHT - 1
      ? '#'.repeat(ARENA_WIDTH)
      : `#${'.'.repeat(ARENA_WIDTH - 2)}#`),
};
const LOOP = {
  id: 'arena-loop', mapId: 'arena',
  tiles: (() => {
    const lo = 1;
    const hiX = ARENA_WIDTH - 2;
    const hiY = ARENA_HEIGHT - 2;
    const tiles: Array<{ x: number; y: number; z: number }> = [];
    for (let x = lo; x <= hiX; x++) tiles.push({ x, y: lo, z: 7 });
    for (let y = lo + 1; y <= hiY; y++) tiles.push({ x: hiX, y, z: 7 });
    for (let x = hiX - 1; x >= lo; x--) tiles.push({ x, y: hiY, z: 7 });
    for (let y = hiY - 1; y > lo; y--) tiles.push({ x: lo, y, z: 7 });
    return tiles;
  })(),
  spawnPoints: [{ routeIndex: 8, radius: 2 }, { routeIndex: 24, radius: 2 }],
};
const raw: RawContent = {
  ...base,
  maps: [ARENA, ...(base.maps ?? []).filter((map) => (map as { id: string }).id !== 'arena')],
  routes: [LOOP],
  hunts: [{
    id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
    difficulties: { cautious: { monsterCount: 3, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 1_000 } },
  }],
  vocations: VOCATIONS.map((id) => ({ id, name: id, healthPerLevel: 100, manaPerLevel: 100, capacityPerLevel: 0 })),
  items: [
    { id: 'rat-tooth', name: 'Dente de Rato', kind: 'other', weight: 1, value: 3 },
    { id: 'rat-tail', name: 'Cauda de Rato', kind: 'other', weight: 10, value: 2 },
  ],
  monsters: [{
    id: 'rat', name: 'Rat', recommendedLevel: 1, health: 20, experience: 5,
    // `attack: 50` (não 1): com a vida alta do herói, um golpe de 1 é 0,04 % e nunca desce
    // abaixo do limiar de cura — o aliado tem de ficar de fato ferido para a regra valer.
    attack: 50, armor: 0, attackIntervalMs: 2_000, speed: 300, aggroRadius: 4,
    loot: {
      gold: { chance: 1, min: 2, max: 2 },
      items: [
        { itemId: 'rat-tooth', chance: 1, min: 1, max: 1 },
        { itemId: 'rat-tail', chance: 1, min: 1, max: 1 },
      ],
    },
  }],
  // A cura de ALIADO (D10): o alvo `lowest-hp-member` exige um efeito `target: 'friend'` com
  // alcance — a mesma régua que `validateBotConfig` cobra (ADR 0035 d.10).
  spells: [{ id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000, effect: { kind: 'heal', amount: 60, target: 'friend', range: 30 } }],
  supplies: [{ id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion', effect: { kind: 'heal', amount: 80 } }],
  party: [{
    ...baseParty,
    maxMembers: 8,
    // O teto de 8 do M20 (ADR 0035 D12) exige a tabela até "8": 5..8 repetem 200.
    xpPoolPercentByUniqueVocations: { '1': 125, '2': 150, '3': 175, '4': 200, '5': 200, '6': 200, '7': 200, '8': 200 },
  }],
  progression: [{
    ...baseProgression,
    startingMana: 1_000, manaPerLevel: 100,
    startingCapacity: 10, capacityPerLevel: 0,
  }],
};
const content = buildContent({ ...raw, appearances: [placeholderAppearances(raw)] });
const { redis, available: redisReady } = await connectTestRedis(16);
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
    // A entrada em curso (#402, D7): sem isto o ticket `party.join` é recusado no `prepare`.
    createParticipant: createLateJoiner(content, () => clockMs),
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
    return this.waitForWhere(type, () => true, timeoutMs);
  }

  async waitForNext<N extends S2CMessage['type']>(type: N, timeoutMs = 4_000): Promise<Extract<S2CMessage, { type: N }>> {
    return this.#waitFrom(this.messages.length, type, () => true, timeoutMs);
  }

  /**
   * Espera uma mensagem do tipo que satisfaça o predicado, varrendo TUDO o que já chegou. É o
   * que torna as asserções robustas a mensagens repetidas (`party-bag` a cada abate,
   * `party-state` a cada mudança): procurar a que importa, não a próxima.
   */
  async waitForWhere<N extends S2CMessage['type']>(
    type: N,
    predicate: (message: Extract<S2CMessage, { type: N }>) => boolean,
    timeoutMs = 4_000,
  ): Promise<Extract<S2CMessage, { type: N }>> {
    return this.#waitFrom(0, type, predicate, timeoutMs);
  }

  /** A ÚLTIMA mensagem do tipo já recebida — o estado mais recente sem esperar o relógio. */
  latest<N extends S2CMessage['type']>(type: N): Extract<S2CMessage, { type: N }> | undefined {
    return [...this.messages]
      .reverse()
      .find((message): message is Extract<S2CMessage, { type: N }> => message.type === type);
  }

  async #waitFrom<N extends S2CMessage['type']>(
    from: number,
    type: N,
    predicate: (message: Extract<S2CMessage, { type: N }>) => boolean,
    timeoutMs: number,
  ): Promise<Extract<S2CMessage, { type: N }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages
        .slice(from)
        .filter((message): message is Extract<S2CMessage, { type: N }> => message.type === type)
        .find(predicate);
      if (found !== undefined) return found;
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
    // Mais que o `CYCLE_MS` do host (100 ms): cada salto precisa de UM ciclo para virar
    // apresentação, e um passo único com espera curta não garante que ele rodou.
    await new Promise((resolve) => { setTimeout(resolve, 120); });
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
    directory,
    settleProgress,
    listItemInstances: (characterId) => repository.listItemInstances(characterId),
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
  readonly name: string;
  readonly premium: boolean;
}

/** O bot com que o teste configura um membro — sem regras além das que o passo quer. */
function botConfig(over: Partial<{
  follow: { kind: 'none' } | { kind: 'leader' } | { kind: 'member'; characterId: string };
  heal: unknown[];
  ignore: string[];
}>): Record<string, unknown> {
  return {
    version: 1,
    targeting: { policy: 'nearest', prioritize: [], ignore: over.ignore ?? [], posture: { kind: 'stand' } },
    exit: [],
    follow: over.follow ?? { kind: 'none' },
    heal: over.heal ?? [],
    potion: [], attack: [], rune: [], support: [],
  };
}

describe.runIf(ready)('critério de saída do M20 (§5, ADR 0035)', () => {
  it('oito personagens de quatro vocações formam sala, entram em curso, trocam de líder, vendem, pesam, seguem e curam', async () => {
    await startNode('party-v2-exit-a');
    const db = (database as TestDatabase).database.db;

    // --- 1. oito contas/personagens, dois por vocação; só o líder é Premium ----------------
    const members: Member[] = [];
    for (const [i, vocation] of [...VOCATIONS, ...VOCATIONS].entries()) {
      const { cookie, accountId } = await login();
      // 16 letras: o `replace` colapsa dígitos em 'a', então um sufixo curto colide e a
      // criação falha — oito nomes no mesmo teste tornam isso visível.
      const name = `Hero ${randomUUID().replace(/[^a-z]/g, 'a').slice(0, 16)}`;
      const createdResponse = await request('/api/characters', 'POST', cookie, { name });
      expect(createdResponse.status, await createdResponse.clone().text()).toBe(201);
      const created = await createdResponse.json() as { id: string };
      const characterId = String(created.id);
      const premium = i === 0; // será o líder
      await db.update(characters).set({
        level: 20, xp: totalXpForLevel(20, content.progression), vocation, gold: 100,
        ...(premium ? { premiumUntil: new Date(Date.now() + 86_400_000) } : {}),
      }).where(eq(characters.id, characterId));
      members.push({ cookie, accountId, characterId, vocation, name, premium });
    }
    const [leader, a, b, c, d, e, f, g] = members as [Member, Member, Member, Member, Member, Member, Member, Member];
    const post = (member: Member, path: string, body: Record<string, unknown> = {}) =>
      request(path, 'POST', member.cookie, { characterId: member.characterId, ...body });

    // --- 2. a party, a composição por vocação e a sala pública (RF-01..RF-03) -------------
    // Oito personagens, dois por vocação: o alvo é o TOTAL desejado de cada vocação — e os
    // oito caem no teto de `maxMembers` (8) do conteúdo (ADR 0035 D12).
    const created = await (await post(leader, '/api/party')).json() as { id: string };
    expect((await post(leader, `/api/party/${created.id}/configure`, {
      huntId: 'arena', difficulty: 'cautious', minLevel: 10,
      vocationTargets: { knight: 2, druid: 2, sorcerer: 2, paladin: 2 },
      shareCosts: true, splitLoot: true,
    })).status).toBe(200);
    // A sala pública exige o estado configurado: publicar NÃO recebe corpo (RF-03).
    expect((await post(leader, `/api/party/${created.id}/publish`)).status).toBe(200);

    // --- 3. os seis primeiros entram (convidados: o convite passa livre da composição) e iniciam
    for (const member of [a, b, c, d, e]) {
      expect((await post(leader, `/api/party/${created.id}/invite`, { inviteeId: member.characterId })).status).toBe(200);
      expect((await post(member, `/api/party/${created.id}/join`)).status).toBe(200);
    }
    const started = await (await post(leader, `/api/party/${created.id}/start`)).json() as { sessionId: string; ticket: { wsUrl: string } | null };
    expect(started.ticket).not.toBeNull();

    // O líder conecta com o ticket da party — é ESSE socket que cria a hunt com os seis.
    let inbox = await open(started.ticket?.wsUrl ?? '');
    inbox.send({ type: 'session-attach' });
    let state = await inbox.waitFor('session-state');
    expect(state.sessionType).toBe('hunt');
    expect(state.party?.members).toHaveLength(6);
    expect(state.party?.settings).toMatchObject({ shareCosts: true, splitLoot: true });

    // --- 4. um level abaixo do mínimo tenta a sala EM CURSO e é recusado (RF-04/RF-05) ----
    const { cookie: outCookie } = await login();
    const outsider = await (await request('/api/characters', 'POST', outCookie, {
      name: `Forasteiro ${randomUUID().slice(0, 6).replace(/[^a-z]/g, 'a')}`,
    })).json() as { id: string };
    await db.update(characters).set({ level: 5 }).where(eq(characters.id, String(outsider.id)));
    const refused = await request(`/api/party/${created.id}/join`, 'POST', outCookie, {
      characterId: String(outsider.id),
    });
    expect(refused.status).toBe(403);
    expect((await refused.json() as { error: string }).error).toBe('room-not-eligible');

    // a, b e e conectam pelos SEUS tickets (o ticket é de uso único): a vira líder adiante,
    // b é o alvo do follow e e é a druida que cura.
    const attachMember = async (member: Member): Promise<Inbox> => {
      const mine = await (await request(
        `/api/party/mine?characterId=${encodeURIComponent(member.characterId)}`, 'GET', member.cookie,
      )).json() as { ticket: { wsUrl: string } | null };
      expect(mine.ticket).not.toBeNull();
      const box = await open(mine.ticket?.wsUrl ?? '');
      box.send({ type: 'session-attach' });
      await box.waitFor('session-state');
      return box;
    };
    const inboxA = await attachMember(a);
    const inboxB = await attachMember(b);
    const inboxE = await attachMember(e);

    // A druida cura desde cedo (D10): com o rato batendo de verdade, deixar a cura para o
    // fim do roteiro arriscaria a morte de um membro no meio — e a morte é saída, não teste.
    inboxE.send({ type: 'bot-config', config: botConfig({
      heal: [{
        when: { kind: 'hp', op: '<=', percent: 99 },
        do: { kind: 'spell', spellId: 'heal' },
        target: { kind: 'lowest-hp-member' },
      }],
    }) });
    await inboxE.waitFor('bot-config-result');

    // --- 5. o líder configura coleta/autovenda; o limite é o de Premium (D2) --------------
    // O `configureParty` aplica na hora, mas o `party-state` que o confirma sai no ciclo —
    // avançar um passo é o que o apresentador precisa para ver a mudança (invariante 2).
    inbox.send({ type: 'party-settings', collect: null, autoSell: ['rat-tooth'] });
    await advance(1_000);
    const configured = await inbox.waitForWhere('party-state',
      (message) => message.loot?.autoSell.includes('rat-tooth') === true);
    expect(configured.loot?.autoSellLimit).toBe(20);
    expect(configured.loot?.leaderPremium).toBe(true);

    // --- 6. com SEIS presentes: a autovenda credita só quem estava no abate (D2, D4) ------
    await advance(30_000);
    const autoSellSix = await inbox.waitForWhere('party-settlement',
      (message) => message.reason === 'auto-sell' && message.itemId === 'rat-tooth' && message.shares.length === 6);
    expect(autoSellSix.shares).toHaveLength(6);
    const bagSix = await inbox.waitForWhere('party-bag',
      (message) => message.items.some((item) => (item.eligible?.length ?? 0) === 6));
    expect(bagSix.items.every((item) => (item.eligible?.length ?? 0) > 0)).toBe(true);

    // --- 7. o 7º entra com a hunt EM CURSO, pela sala publicada (D7) ----------------------
    const joinedF = await post(f, `/api/party/${created.id}/join`);
    expect(joinedF.status).toBe(200);
    const joinedFBody = await joinedF.json() as { ticket: { wsUrl: string } | null };
    expect(joinedFBody.ticket).not.toBeNull();
    const inboxF = await open(joinedFBody.ticket?.wsUrl ?? '');
    inboxF.send({ type: 'session-attach' });
    const stateF = await inboxF.waitFor('session-state');
    expect(stateF.party?.members).toHaveLength(7);
    expect(stateF.party?.members.find((member) => member.characterId === f.characterId)?.joinedAtMs ?? 0).toBeGreaterThan(0);

    // --- 8. o 8º entra com a hunt EM CURSO, pela sala publicada — convite nenhum sai
    // durante hunt (RF-08), e o paladin ainda tem vaga na composição (1 de 2) --------------
    const joinedG = await post(g, `/api/party/${created.id}/join`);
    expect(joinedG.status).toBe(200);
    const joinedGBody = await joinedG.json() as { ticket: { wsUrl: string } | null };
    expect(joinedGBody.ticket).not.toBeNull();
    const inboxG = await open(joinedGBody.ticket?.wsUrl ?? '');
    inboxG.send({ type: 'session-attach' });
    const stateG = await inboxG.waitFor('session-state');
    expect(stateG.party?.members).toHaveLength(8);

    // --- 9. com OITO: a bolsa reserva proporcional e enche até OVERWEIGHT (D3) ------------
    await advance(30_000);
    // Um `party-bag` com as oito reservas E itens dos abates com seis e com oito: é a
    // elegibilidade por ENTRADA (D4) no mesmo fio, não um item sem procedência.
    const bagEight = await inbox.waitForWhere('party-bag',
      (message) => (message.reservations?.length ?? 0) === 8
        && message.items.some((item) => item.eligible?.length === 8)
        && message.items.some((item) => item.eligible?.length === 6));
    // A elegibilidade por ENTRADA (D4) no mesmo fio: itens dos seis primeiros abates e dos
    // abates com os oito.
    expect(bagEight.items.some((item) => item.eligible?.length === 6)).toBe(true);
    expect(bagEight.items.some((item) => item.eligible?.length === 8)).toBe(true);
    // OVERWEIGHT: a bolsa enche (peso = capacidade) e NÃO perde item — só para de coletar.
    // A reserva e o peso são do MESMO evento só na mensagem do último `party-bag-changed`:
    // `#partyBlock` monta o peso do estado ATUAL e as reservas do último evento, e um drain
    // com vários abates mistura os dois nas mensagens intermediárias.
    const bagOver = await inbox.waitForWhere('party-bag', (message) => {
      const reservations = message.reservations ?? [];
      if (message.overweight !== true || reservations.length !== 8) return false;
      const sum = reservations.reduce((total, reservation) => total + reservation.reserved, 0);
      return Math.abs(sum - message.weight) < 0.001;
    });
    const reservations = bagOver.reservations ?? [];
    expect(reservations).toHaveLength(8);
    // Σ reservas = peso (min(peso, ΣB)), em ponto flutuante.
    const totalReserved = reservations.reduce((sum, reservation) => sum + reservation.reserved, 0);
    expect(totalReserved).toBeCloseTo(bagOver.weight, 3);
    expect(bagOver.overweight).toBe(true);
    expect(bagOver.weight).toBeLessThanOrEqual(bagOver.capacity + 1e-6);
    const heldInstances = bagOver.items.map((item) => item.instanceId);
    await advance(10_000);
    // O relógio parou com o fim do `advance`, então o estado mais recente é a última
    // mensagem já recebida — esperar uma nova travaria para sempre (a simulação não anda).
    const stillFull = inbox.latest('party-bag');
    expect(stillFull).toBeDefined();
    expect(stillFull?.overweight).toBe(true);
    expect(stillFull?.weight).toBeCloseTo(bagOver.weight, 3);
    // Nada se perdeu: todo item que a bolsa segurava em OVERWEIGHT continua nela.
    for (const instanceId of heldInstances) {
      expect(stillFull?.items.some((item) => item.instanceId === instanceId)).toBe(true);
    }

    // --- 10. o líder (Premium) sai; o mais antigo (Free) assume e o limite cai (D2, D8) ---
    inbox.send({ type: 'leave-hunt' });
    const ended = await inbox.waitForNext('session-ended');
    expect(ended.reason).toBe('manual-exit');
    // A sucessão é anunciada no ciclo (`#presentPartyLive`), como a mudança de configuração.
    await advance(1_000);
    const stateNewLeader = await inboxF.waitForWhere('party-state',
      (message) => message.leaderId === a.characterId);
    expect(stateNewLeader.loot?.autoSellLimit).toBe(5);
    expect(stateNewLeader.loot?.leaderPremium).toBe(false);

    // --- 11. um membro segue outro e fica ADJACENTE (D9) ----------------------------------
    // Os dois com follow MÚTUO: como no teste unitário do `sim`, o alvo precisa ficar parado
    // para a adjacência ser determinística — quem já está ao lado não dá passo, e o seguidor
    // converge para o lado do outro.
    inboxA.send({ type: 'bot-config', config: botConfig({
      follow: { kind: 'member', characterId: b.characterId }, ignore: ['rat'],
    }) });
    await inboxA.waitFor('bot-config-result');
    inboxB.send({ type: 'bot-config', config: botConfig({
      follow: { kind: 'member', characterId: a.characterId }, ignore: ['rat'],
    }) });
    await inboxB.waitFor('bot-config-result');
    await advance(120_000);
    inboxA.send({ type: 'session-attach' });
    const positioned = await inboxA.waitForNext('session-state');
    const creatureNamed = (name: string) => positioned.world.creatures.find((creature) => creature.name === name);
    const positionA = creatureNamed(a.name);
    const positionB = creatureNamed(b.name);
    expect(positionA).toBeDefined();
    expect(positionB).toBeDefined();
    const distance = Math.max(
      Math.abs((positionA?.position.x ?? 0) - (positionB?.position.x ?? 0)),
      Math.abs((positionA?.position.y ?? 0) - (positionB?.position.y ?? 0)),
    );
    expect(distance).toBe(1);

    // --- 12. a druida cura o aliado de menor HP % (D10) -----------------------------------
    // A regra já está em vigor desde a entrada; o que se afirma aqui é que ela de fato disparou
    // na sessão — o `creature-healed` do `sim` vira `creature-hit` `kind: 'heal'` no fio.
    const healed = await inboxE.waitForWhere('creature-hit', (message) => message.kind === 'heal');
    expect(healed.amount).toBeGreaterThan(0);

    // --- 13. drena: oito extratos, oito linhas, e a soma fecha (invariante 10) ------------
    await advance(30_000);
    const [node] = [...games];
    await node?.drain();
    games.delete(node as GameRole);
    await redis.del('node:party-v2-exit-a:heartbeat');

    const pending = await receipts.pending();
    const ofSession = pending.filter((receipt) => receipt.sessionId === started.sessionId);
    expect(ofSession.map((receipt) => receipt.characterId).sort()).toEqual(members.map((member) => member.characterId).sort());
    expect(new Set(ofSession.map((receipt) => receipt.seq)).size).toBe(8);

    await writePendingReceipts({ database: db, receipts, logger, progression: content.progression });
    const rows = await db.select({ characterId: ledger.characterId, seq: ledger.seq, delta: ledger.delta })
      .from(ledger).where(eq(ledger.sessionId, started.sessionId));
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((row) => row.characterId)).size).toBe(8);
    expect(new Set(rows.map((row) => row.seq)).size).toBe(8);
    // FECHAMENTO: Σ delta = Σ gold que caiu + vendas − supplies, e é o que entrou no ledger.
    const totalCredited = rows.reduce((sum, row) => sum + row.delta, 0);
    const totalGained = ofSession.reduce(
      (sum, receipt) => sum + receipt.aggregates.goldGained - receipt.aggregates.goldSpent, 0,
    );
    expect(totalCredited).toBe(totalGained);
    expect(totalGained).toBeGreaterThan(0);
    for (const member of members) {
      const [row] = await db.select({ gold: characters.gold }).from(characters)
        .where(and(eq(characters.id, member.characterId), eq(characters.accountId, member.accountId)));
      const receipt = ofSession.find((entry) => entry.characterId === member.characterId);
      expect(row?.gold).toBe(100 + (receipt?.aggregates.goldGained ?? 0) - (receipt?.aggregates.goldSpent ?? 0));
    }
  }, 240_000);
});
