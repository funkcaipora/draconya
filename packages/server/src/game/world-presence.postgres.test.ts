import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { totalXpForLevel, XLOG_DELAY_MS } from '@draconya/sim';
import type { Point } from '@draconya/sim';
import { localToAbsolute } from '@draconya/content';
import type { Content } from '@draconya/content';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { accounts, characters, ledger } from '../db/schema.js';
import { createLogger } from '../log.js';
import { ReceiptStore } from '../receipts.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { settleCharacterProgress } from '../jobs/ledger.js';
import { SessionHost } from './host.js';
import { createSessionWiring } from './sessions.js';
import { FakeSocket } from './testing.js';

// A presença do mundo (#840, OW-19) do socket ao banco, no Postgres e no Redis de verdade: o personagem
// fecha o navegador, o `sim` o tira aos 60 s, o hospedeiro grava o checkpoint de saída no Redis e o `jobs`
// o liquida — e é a LINHA de `characters` que se confere: a posição absoluta, a vida e a mana com que ele
// saiu, que são o que o próximo ticket lê (OW-15). É o critério "sai aos 60 s, com posição e vida salvas"
// da issue, medido onde ele importa: o que o jogador encontra quando volta.
//
// O Redis é o banco 26 (`testing/redis.ts`), e nada aqui o apaga ou varre inteiro: todo personagem nasce com
// UUID, e a liquidação é POR PERSONAGEM — o caminho do ticket.
const logger = createLogger('silent', 'test');
const { redis, available: redisReady } = await connectTestRedis(26);

let db: TestDatabase | null = null;
let ready = false;
if (redisReady && (process.env['DATABASE_TEST_URL'] ?? '') !== '') {
  try {
    db = await connectTestDatabase();
    ready = true;
  } catch {
    db = null;
  }
}

afterAll(async () => {
  if (redisReady) await redis.quit();
  await db?.cleanup();
});

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => (cached ??= loadContent(DATA));

const absolute = (tile: { x: number; y: number; z: number }): Point => {
  const map = real().maps.get('thais');
  const point = map === undefined ? undefined : localToAbsolute(map, tile);
  if (point === undefined) throw new Error(`fora do recorte: ${JSON.stringify(tile)}`);
  return point;
};
const TEMPLE = { x: 94, y: 88, z: 7 };
/** A rua ao sul do templo: andável e FORA da PZ. */
const STREET = { x: 94, y: 97, z: 7 };

async function seedCharacter(database: NonNullable<typeof db>): Promise<{ characterId: string; accountId: string }> {
  const accountId = randomUUID();
  const characterId = randomUUID();
  await database.database.db.insert(accounts).values({
    id: accountId, email: `${accountId}@example.com`, externalAuthId: accountId,
  });
  await database.database.db.insert(characters).values({
    id: characterId, accountId, name: `Presença ${characterId.slice(0, 8)}`, level: 8,
    xp: totalXpForLevel(8, real().progression),
  });
  return { characterId, accountId };
}

const rowOf = async (database: NonNullable<typeof db>, characterId: string) => {
  const [row] = await database.database.db
    .select({
      gold: characters.gold, health: characters.health, mana: characters.mana,
      worldX: characters.worldX, worldY: characters.worldY, worldZ: characters.worldZ,
      townId: characters.townId, durableVersion: characters.durableVersion,
    })
    .from(characters).where(eq(characters.id, characterId));
  if (row === undefined) throw new Error('personagem não encontrado');
  return row;
};
const ledgerOf = async (database: NonNullable<typeof db>, characterId: string) =>
  database.database.db
    .select({ type: ledger.type, seq: ledger.seq, delta: ledger.delta, sessionId: ledger.sessionId })
    .from(ledger).where(eq(ledger.characterId, characterId)).orderBy(asc(ledger.seq));

/** O nó `game` com o mundo real (a Thais do OTBM) e o Redis de verdade. */
function node() {
  const content = real();
  let nowMs = 0;
  const wiring = createSessionWiring(content, () => nowMs, { openWorld: true });
  const receipts = new ReceiptStore(redis);
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, receipts, now: () => nowMs, openWorld: true,
    createSession: wiring.createSession, buildSession: wiring.buildSession,
    itemCatalog: content.items, blessingCatalog: content.blessings, progression: content.progression,
  });
  const enter = async (
    ids: { characterId: string; accountId: string },
    ticket: { readonly worldPosition?: Point; readonly health?: number; readonly mana?: number } = {},
  ) => {
    await host.prepare(
      ids.characterId,
      { level: 8, xp: totalXpForLevel(8, content.progression), townId: 'thais', durableVersion: 0, ...ticket },
      ids.accountId,
    );
    const viewer = host.attach(new FakeSocket(), ids.characterId);
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    const session = host.sessionFor(ids.characterId);
    const hero = session?.participants.find((participant) => participant.id === ids.characterId);
    if (session === undefined || hero === undefined) throw new Error('o personagem não entrou no mundo');
    return { viewer, session, hero };
  };
  return {
    host, receipts, enter,
    tick: (ms: number) => { nowMs += ms; host.cycle(nowMs); },
  };
}

describe.runIf(ready)('fechar o navegador no mundo chega ao banco (#840, OW-19)', () => {
  const sweep = (database: NonNullable<typeof db>, receipts: ReceiptStore, characterId: string) =>
    settleCharacterProgress(characterId, {
      database: database.database.db, receipts, logger, progression: real().progression, openWorld: true,
    });

  it('na PZ: sai aos 60 s, e a linha do personagem guarda o tile, a vida e a mana com que ele saiu', async () => {
    const database = db as NonNullable<typeof db>;
    const ids = await seedCharacter(database);
    const keeper = await seedCharacter(database);
    const n = node();
    const { viewer, hero, session } = await n.enter(ids, { health: 123, mana: 7 });
    await n.enter(keeper);
    // O que rendeu antes de a conexão cair: 100 de gold, que o ledger conta UMA vez — no extrato de saída.
    hero.goldDelta += 100;
    session.credit(ids.characterId, 'goldGained', 100);

    viewer.markClosed();
    n.host.detach(viewer);
    n.tick(XLOG_DELAY_MS);
    await vi.waitFor(() => { expect(n.host.sessionFor(ids.characterId)).toBeUndefined(); });

    // Liquidar o que ficou no Redis — o caminho do ticket e do `jobs`.
    expect(await sweep(database, n.receipts, ids.characterId)).toMatchObject({ failed: 0 });
    expect(await rowOf(database, ids.characterId)).toMatchObject({
      worldX: absolute(TEMPLE).x, worldY: absolute(TEMPLE).y, worldZ: absolute(TEMPLE).z,
      townId: 'thais', health: hero.health, mana: hero.mana, gold: 100,
    });
    const rows = await ledgerOf(database, ids.characterId);
    expect(rows.map((row) => row.type)).toEqual(['session-manual-exit']);
    expect(rows.reduce((total, row) => total + row.delta, 0)).toBe(100);
    // O personagem que ficou no mundo não foi tocado: nenhuma linha dele no ledger.
    expect(n.host.sessionFor(keeper.characterId)).toBeDefined();
  });

  it('o x-log numa rua, depois de a luta acabar: a âncora é o tile da rua', async () => {
    const database = db as NonNullable<typeof db>;
    const ids = await seedCharacter(database);
    const n = node();
    const { viewer, hero, session } = await n.enter(ids, { worldPosition: absolute(STREET) });
    hero.lastCombatActionAtMs = session.nowMs;

    viewer.markClosed();
    n.host.detach(viewer);
    n.tick(10_000);
    hero.lastCombatActionAtMs = session.nowMs; // outro golpe aos 10 s: a janela recomeça
    n.tick(XLOG_DELAY_MS - 10_000); // aos 60 s a tentativa vem, e a luta a segura
    expect(n.host.sessionFor(ids.characterId)).toBeDefined();
    n.tick(10_001); // 70 s: a janela do último golpe venceu, e o `sim` o tira
    await vi.waitFor(() => { expect(n.host.sessionFor(ids.characterId)).toBeUndefined(); });

    expect(await sweep(database, n.receipts, ids.characterId)).toMatchObject({ failed: 0 });
    expect(await rowOf(database, ids.characterId)).toMatchObject({
      worldX: absolute(STREET).x, worldY: absolute(STREET).y, worldZ: absolute(STREET).z,
    });
  });
});
