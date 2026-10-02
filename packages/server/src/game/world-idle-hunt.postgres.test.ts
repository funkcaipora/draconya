import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { Session, totalXpForLevel } from '@draconya/sim';
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

// O mundo e a hunt idle (#841, OW-20) do socket ao banco, no Postgres e no Redis de verdade: o personagem sai
// do mundo para uma hunt, fecha o navegador, a hunt acaba — e é a LINHA de `characters` que se confere, porque
// é ela que o próximo ticket lê. O personagem fica em REPOUSO, no tile de onde saiu (ou no templo, se morreu,
// de vida e mana cheias), e nunca no mundo: lá nada o tiraria de uma luta, e ele chegaria sem visualizador.
//
// O Redis é o banco 21 (`testing/redis.ts`), e nada aqui o apaga ou varre inteiro: todo personagem nasce com
// UUID, e a liquidação é POR PERSONAGEM — o caminho do ticket.
const logger = createLogger('silent', 'test');
const { redis, available: redisReady } = await connectTestRedis(21);

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
/** A rua ao sul do templo: andável e FORA da PZ. */
const STREET = { x: 94, y: 97, z: 7 };
const HUNT = 'rat-cellars';

async function seedCharacter(database: NonNullable<typeof db>): Promise<{ characterId: string; accountId: string }> {
  const accountId = randomUUID();
  const characterId = randomUUID();
  await database.database.db.insert(accounts).values({
    id: accountId, email: `${accountId}@example.com`, externalAuthId: accountId,
  });
  await database.database.db.insert(characters).values({
    id: characterId, accountId, name: `Idle ${characterId.slice(0, 8)}`, level: 8,
    xp: totalXpForLevel(8, real().progression),
  });
  return { characterId, accountId };
}

const rowOf = async (database: NonNullable<typeof db>, characterId: string) => {
  const [row] = await database.database.db
    .select({
      health: characters.health, mana: characters.mana,
      worldX: characters.worldX, worldY: characters.worldY, worldZ: characters.worldZ,
      townId: characters.townId, durableVersion: characters.durableVersion,
    })
    .from(characters).where(eq(characters.id, characterId));
  if (row === undefined) throw new Error('personagem não encontrado');
  return row;
};
const ledgerTypes = async (database: NonNullable<typeof db>, characterId: string): Promise<string[]> =>
  (await database.database.db
    .select({ type: ledger.type })
    .from(ledger).where(eq(ledger.characterId, characterId)).orderBy(asc(ledger.seq))).map((row) => row.type);

/** Faz a hunt acabar DENTRO de um avanço, como acaba de verdade — o ciclo pula a sessão que acabou entre dois. */
function endInsideNextAdvance(session: Session, finish: (session: Session) => void): void {
  let done = false;
  vi.spyOn(session, 'advanceBy').mockImplementation((ms: number) => {
    Session.prototype.advanceBy.call(session, ms);
    if (done || session.ended !== null) return;
    done = true;
    finish(session);
  });
}

/** O nó `game` com o mundo real (a Thais do OTBM), a hunt real e o Redis de verdade. */
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
    return { viewer };
  };
  const hero = (characterId: string) => {
    const found = host.sessionFor(characterId)?.participants.find((participant) => participant.id === characterId);
    if (found === undefined) throw new Error('o personagem não está na sessão');
    return found;
  };
  /** Do mundo para a hunt, pelo menu: o `enter-hunt` do cliente. */
  const goHunting = async (characterId: string, viewer: ReturnType<typeof host.attach>) => {
    host.handle(viewer, { type: 'enter-hunt', huntId: HUNT });
    await vi.waitFor(() => { expect(host.sessionFor(characterId)?.ruleset.type).toBe('hunt'); });
  };
  return {
    host, receipts, enter, hero, goHunting, wiring,
    tick: (ms: number) => { nowMs += ms; host.cycle(nowMs); },
  };
}

describe.runIf(ready)('a hunt idle acaba sem ninguém olhando e o banco guarda o repouso (#841, OW-20)', () => {
  const sweep = (database: NonNullable<typeof db>, receipts: ReceiptStore, characterId: string) =>
    settleCharacterProgress(characterId, {
      database: database.database.db, receipts, logger, progression: real().progression, openWorld: true,
    });

  it('a hunt que acaba com o navegador fechado: a linha guarda o tile de onde ele saiu e os vitais do fim', async () => {
    const database = db as NonNullable<typeof db>;
    const ids = await seedCharacter(database);
    const keeper = await seedCharacter(database);
    const n = node();
    const { viewer } = await n.enter(ids, { worldPosition: absolute(STREET), health: 123 });
    await n.enter(keeper);
    await n.goHunting(ids.characterId, viewer);
    const hero = n.hero(ids.characterId);
    // O navegador fecha DURANTE a hunt, e a hunt idle sobrevive a isso (invariante 3). O que ela rende entra
    // no extrato do fim, que é o checkpoint do repouso.
    viewer.markClosed();
    n.host.detach(viewer);
    hero.goldDelta += 70;
    const hunt = n.host.sessionFor(ids.characterId) as Session;
    hunt.credit(ids.characterId, 'goldGained', 70);
    endInsideNextAdvance(hunt, (session) => { session.end('exit-rule'); });

    n.tick(2_000);
    await vi.waitFor(() => { expect(n.host.sessionFor(ids.characterId)).toBeUndefined(); });

    // Em repouso: sem sessão, e o mundo — que segue de pé para o outro — não recebeu o desanexado.
    expect(n.wiring.worldShard?.populationOf('main')).toBe(1);
    expect(n.host.sessionFor(keeper.characterId)?.ruleset.type).toBe('world');
    expect(await sweep(database, n.receipts, ids.characterId)).toMatchObject({ failed: 0 });
    // A linha É o que o próximo ticket lê: o tile de onde ele saiu para a hunt e a vida com que a hunt acabou.
    expect(await rowOf(database, ids.characterId)).toMatchObject({
      worldX: absolute(STREET).x, worldY: absolute(STREET).y, worldZ: absolute(STREET).z,
      townId: 'thais', health: hero.health, mana: hero.mana,
    });
    // Duas saídas, duas linhas de ledger — a do mundo para a hunt e a do fim da hunt —, e o gold só uma vez.
    expect(await ledgerTypes(database, ids.characterId)).toEqual(['session-manual-exit', 'session-exit-rule']);
  });

  it('morrer na hunt desanexado: a linha guarda o templo (posição nula) e a vida e a mana CHEIAS', async () => {
    const database = db as NonNullable<typeof db>;
    const ids = await seedCharacter(database);
    const n = node();
    const { viewer } = await n.enter(ids, { worldPosition: absolute(STREET), health: 50, mana: 3 });
    await n.goHunting(ids.characterId, viewer);
    const hero = n.hero(ids.characterId);
    viewer.markClosed();
    n.host.detach(viewer);
    endInsideNextAdvance(n.host.sessionFor(ids.characterId) as Session, (session) => { session.kill(hero); });

    n.tick(2_000);
    await vi.waitFor(() => { expect(n.host.sessionFor(ids.characterId)).toBeUndefined(); });

    expect(await sweep(database, n.receipts, ids.characterId)).toMatchObject({ failed: 0 });
    // `player.cpp:4034-4041, 4226-4252`: a posição some (o login seguinte cai no templo) e os vitais voltam ao
    // máximo — da tabela do level que a morte deixou, que é o que `maxHealth` do personagem já diz.
    expect(await rowOf(database, ids.characterId)).toMatchObject({
      worldX: null, worldY: null, worldZ: null, townId: 'thais', health: hero.maxHealth, mana: hero.maxMana,
    });
    expect(await ledgerTypes(database, ids.characterId)).toEqual(['session-manual-exit', 'session-death']);
  });

  it('a drenagem com a hunt desanexada: a linha guarda a âncora, e o personagem não vai a mundo nenhum', async () => {
    const database = db as NonNullable<typeof db>;
    const ids = await seedCharacter(database);
    const n = node();
    const { viewer } = await n.enter(ids, { worldPosition: absolute(STREET) });
    await n.goHunting(ids.characterId, viewer);
    viewer.markClosed();
    n.host.detach(viewer);

    await n.host.drainAll();

    expect(n.host.sessionFor(ids.characterId)).toBeUndefined();
    expect(n.wiring.worldShard?.worlds).toBe(0);
    expect(await sweep(database, n.receipts, ids.characterId)).toMatchObject({ failed: 0 });
    expect(await rowOf(database, ids.characterId)).toMatchObject({
      worldX: absolute(STREET).x, worldY: absolute(STREET).y, worldZ: absolute(STREET).z,
    });
    expect(await ledgerTypes(database, ids.characterId)).toEqual(['session-manual-exit', 'session-drain']);
  });
});
