import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createHuntSession, totalXpForLevel } from '@draconya/sim';
import type { ConditionState } from '@draconya/sim';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, characters } from '../db/schema.js';
import { DrizzleGameRepository } from '../db/repository.js';
import { createLogger } from '../log.js';
import { ReceiptStore } from '../receipts.js';
import type { SessionReceipt } from '../receipts.js';
import { initialCharacterOf } from '../api/tickets.js';
import { SessionHost } from '../game/host.js';
import { characterFromTicket } from '../game/sessions.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { testContent, TEST_HUNT } from '../testing/content.js';
import { settleCharacterProgress, writePendingReceipts } from './ledger.js';

// O mundo e os vitais em REPOUSO (#836, OW-15, ADR 0060 d.6 e d.10.f), ponta a ponta no Postgres:
// a coluna → o ticket → a sessão → o extrato do Redis → o `jobs` → a coluna. É o teste que prende o
// que a issue promete: deslogar a 10 HP volta com 10 HP, no mesmo tile, e nada é descartado.

const logger = createLogger('silent', 'test');
const { redis, available: redisReady } = await connectTestRedis(25);

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

beforeEach(async () => {
  if (redisReady) await redis.flushdb();
});

const content = testContent();
const TEMPLE = { x: 32369, y: 32241, z: 7 };
const STREET = { x: 32369, y: 32250, z: 7 };

const receiptOf = (
  sessionId: string, characterId: string, overrides: Partial<SessionReceipt> = {},
): Omit<SessionReceipt, 'endedAtMs'> => ({
  sessionId, characterId, accountId: 'a1', reason: 'drain', seq: 1,
  aggregates: {
    durationMs: 60_000, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0,
    itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0, damageDealt: 0, healingDone: 0,
  },
  notableEvents: [],
  ...overrides,
});

async function seedCharacter(
  database: NonNullable<typeof db>, level = 1,
): Promise<{ characterId: string; accountId: string }> {
  const accountId = randomUUID();
  const characterId = randomUUID();
  await database.database.db.insert(accounts).values({
    id: accountId, email: `${accountId}@example.com`, externalAuthId: accountId,
  });
  await database.database.db.insert(characters).values({
    // O `level` da linha é derivado da XP pelo ledger (`levelForXp`): um level sem a XP dele voltaria
    // ao 1 no primeiro extrato.
    id: characterId, accountId, name: `Mundo ${characterId.slice(0, 8)}`, level,
    xp: totalXpForLevel(level, content.progression),
  });
  return { characterId, accountId };
}

const columnsOf = async (database: NonNullable<typeof db>, characterId: string) => {
  const [row] = await database.database.db
    .select({
      worldId: characters.worldId, worldX: characters.worldX, worldY: characters.worldY, worldZ: characters.worldZ,
      townId: characters.townId, health: characters.health, mana: characters.mana,
      conditions: characters.conditions, durableVersion: characters.durableVersion, xp: characters.xp,
    })
    .from(characters).where(eq(characters.id, characterId));
  if (row === undefined) throw new Error('personagem não encontrado');
  return row;
};

const haste: ConditionState = { key: 'haste', expiresAtMs: 6_500, speedPercent: 30 };
const poison: ConditionState = {
  key: 'poison', expiresAtMs: 1_000, nextTickAtMs: 100, tick: { amount: 3, intervalMs: 1_000, kind: 'damage' },
};

describe.runIf(ready)('o mundo e os vitais chegam ao Postgres pelo extrato (#836, OW-15)', () => {
  const flush = (database: NonNullable<typeof db>, receipts: ReceiptStore) =>
    writePendingReceipts({ database: database.database.db, receipts, logger, progression: content.progression });

  it('um personagem novo nasce no mundo `main`, na cidade `thais`, cheio e sem posição nem condição', async () => {
    const database = db as NonNullable<typeof db>;
    const { characterId } = await seedCharacter(database);

    expect(await columnsOf(database, characterId)).toEqual({
      worldId: 'main', worldX: null, worldY: null, worldZ: null, townId: 'thais', health: null, mana: null,
      conditions: null, durableVersion: 0, xp: 0,
    });
    const record = await new DrizzleGameRepository(database.database.db).getCharacterById(characterId);
    expect(record).toMatchObject({
      worldId: 'main', worldPosition: null, townId: 'thais', health: null, mana: null, conditions: null,
    });
  });

  it('grava a posição, a cidade, a vida, a mana e as condições do extrato, na coluna certa', async () => {
    const database = db as NonNullable<typeof db>;
    const { characterId } = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    await receipts.save(receiptOf(randomUUID(), characterId, {
      durableVersion: 1, worldPosition: STREET, townId: 'thais', health: 10, mana: 3, conditions: [haste, poison],
    }));
    await flush(database, receipts);

    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: STREET.x, worldY: STREET.y, worldZ: STREET.z, townId: 'thais', health: 10, mana: 3,
      conditions: [haste, poison], durableVersion: 1,
    });
    const record = await new DrizzleGameRepository(database.database.db).getCharacterById(characterId);
    expect(record?.worldPosition).toEqual(STREET);
  });

  it('a última escrita vence, EM QUALQUER direção: a vida SOBE de 10 para o máximo, e a posição muda de lugar', async () => {
    // Vida e posição DESCEM e SOBEM por natureza: fundir por máximo ou somar seria um erro de tipo.
    // Mutação que mata: `greatest`/`coalesce` no ledger — a vida de quem se curou ficaria em 10.
    const database = db as NonNullable<typeof db>;
    const { characterId } = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    await receipts.save(receiptOf(randomUUID(), characterId, {
      durableVersion: 1, worldPosition: STREET, health: 10, mana: 0, conditions: [haste],
    }));
    await flush(database, receipts);
    await receipts.save(receiptOf(randomUUID(), characterId, {
      durableVersion: 2, seq: 2, worldPosition: TEMPLE, health: 1_200, mana: 40, conditions: [],
    }));
    await flush(database, receipts);

    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: TEMPLE.x, worldY: TEMPLE.y, worldZ: TEMPLE.z, health: 1_200, mana: 40,
      // `conditions: []` é "nenhuma" e vira nulo: um `[]` e um `null` seriam dois nomes para o mesmo.
      conditions: null, durableVersion: 2,
    });
  });

  it('`worldPosition: null` — quem morreu, ou nunca esteve no mundo — zera as TRÊS colunas juntas: volta ao templo', async () => {
    const database = db as NonNullable<typeof db>;
    const { characterId } = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save(receiptOf(randomUUID(), characterId, { durableVersion: 1, worldPosition: STREET }));
    await flush(database, receipts);
    expect((await columnsOf(database, characterId)).worldX).toBe(STREET.x);

    await receipts.save(receiptOf(randomUUID(), characterId, { durableVersion: 2, seq: 2, worldPosition: null }));
    await flush(database, receipts);

    expect(await columnsOf(database, characterId)).toMatchObject({ worldX: null, worldY: null, worldZ: null });
  });

  it('o extrato SEM os campos — a flag desligada, um nó anterior — não toca em coluna nenhuma', async () => {
    // O portão do plano: com a flag desligada o jogo é o de hoje. Mutação que mata: escrever o
    // default quando o campo falta (`worldPosition: null` apagaria a posição que a linha guarda).
    const database = db as NonNullable<typeof db>;
    const { characterId } = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save(receiptOf(randomUUID(), characterId, {
      durableVersion: 1, worldPosition: STREET, townId: 'thais', health: 10, mana: 3, conditions: [haste],
    }));
    await flush(database, receipts);
    const before = await columnsOf(database, characterId);

    await receipts.save(receiptOf(randomUUID(), characterId, { durableVersion: 2, seq: 2 }));
    await receipts.save(receiptOf(randomUUID(), characterId, { seq: 3 }));
    await flush(database, receipts);

    // A versão sobe com o extrato versionado; o resto é o de antes.
    expect(await columnsOf(database, characterId)).toEqual({ ...before, durableVersion: 2 });
  });

  it('extrato ATRASADO nunca devolve a vida de ontem, o tile de antes nem a condição que já passou — mas os deltas entram', async () => {
    // A ordem por versão (#823): o mais velho chega depois de o mais novo já ter sido aplicado.
    const database = db as NonNullable<typeof db>;
    const { characterId } = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save(receiptOf(randomUUID(), characterId, {
      durableVersion: 5, worldPosition: STREET, health: 10, mana: 1, conditions: [],
    }));
    await flush(database, receipts);

    await receipts.save(receiptOf(randomUUID(), characterId, {
      durableVersion: 4, seq: 2, worldPosition: TEMPLE, health: 1_200, mana: 40, conditions: [haste],
      aggregates: { ...receiptOf('s', characterId).aggregates, xpGained: 50 },
    }));
    await flush(database, receipts);

    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: STREET.x, worldY: STREET.y, health: 10, mana: 1, conditions: null, durableVersion: 5,
      // O delta de XP é protegido por `UNIQUE (session_id, seq)`, não pela versão.
      xp: 50,
    });
  });

  it('reprocessar o MESMO extrato é nulo: nenhuma escrita a mais, nenhuma linha de ledger a mais', async () => {
    const database = db as NonNullable<typeof db>;
    const { characterId } = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const receipt = receiptOf(sessionId, characterId, {
      durableVersion: 1, worldPosition: STREET, health: 10, mana: 1, conditions: [haste],
    });
    await receipts.save(receipt);
    await flush(database, receipts);
    const first = await columnsOf(database, characterId);

    await receipts.save(receipt);
    await flush(database, receipts);

    expect(await columnsOf(database, characterId)).toEqual(first);
  });

  it('o banco recusa uma coordenada pela metade e a vida negativa — o CHECK vale mesmo se um caminho novo de escrita esquecer', async () => {
    const database = db as NonNullable<typeof db>;
    const { characterId } = await seedCharacter(database);
    await expect(database.database.db.update(characters).set({ worldX: 32369 }).where(eq(characters.id, characterId)))
      .rejects.toThrow();
    await expect(database.database.db.update(characters).set({ health: -1 }).where(eq(characters.id, characterId)))
      .rejects.toThrow();
    expect(await columnsOf(database, characterId)).toMatchObject({ worldX: null, health: null });
  });
});

describe.runIf(ready)('deslogar a 10 HP volta com 10 HP: coluna → ticket → sessão → extrato → coluna (#836, OW-15)', () => {
  /** Uma sessão de verdade com o personagem do TICKET dentro, hospedada com a flag no estado pedido. */
  async function playAndLogOut(options: {
    database: NonNullable<typeof db>; characterId: string; accountId: string; openWorld: boolean;
    play: (character: ReturnType<typeof characterFromTicket>) => void;
  }): Promise<void> {
    const { database, characterId, accountId } = options;
    const repository = new DrizzleGameRepository(database.database.db);
    const record = await repository.getCharacterById(characterId);
    if (record === null) throw new Error('personagem não encontrado');
    // O `api`: a linha vira o ticket, com a flag no estado pedido.
    const initial = initialCharacterOf(record, [], [], undefined, undefined, 0, options.openWorld);
    // O `game`: o ticket vira o personagem, que entra na sessão e joga.
    const character = characterFromTicket(content, characterId, initial, () => 0);
    const session = createHuntSession({
      id: randomUUID(), content, huntId: TEST_HUNT.id, difficulty: 'cautious', createdAtMs: 0,
    });
    session.enter(character);
    const receipts = new ReceiptStore(redis);
    const host = new SessionHost({
      nodeId: 'world-vitals', contentVersion: content.version, logger, receipts,
      openWorld: options.openWorld, createSession: () => session,
    });
    await host.prepare(characterId, initial, accountId);
    options.play(character);
    expect(await host.drainAll()).toBe(1);
    // O `jobs`: o extrato do Redis vira a coluna.
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression: content.progression,
    });
  }

  /** O ticket que o `api` emitiria agora, e o personagem que o `game` faria dele. */
  async function relog(database: NonNullable<typeof db>, characterId: string, openWorld: boolean) {
    const repository = new DrizzleGameRepository(database.database.db);
    const record = await repository.getCharacterById(characterId);
    if (record === null) throw new Error('personagem não encontrado');
    const initial = initialCharacterOf(record, [], [], undefined, undefined, 0, openWorld);
    return { initial, character: characterFromTicket(content, characterId, initial, () => 0) };
  }

  it('COM a flag: sai a 10 HP, no tile da rua, envenenado — e volta com 10 HP, no mesmo tile, com o veneno que faltava', async () => {
    const database = db as NonNullable<typeof db>;
    // Level 20: o conteúdo de teste só dá mana a partir do level 2, e 3 de mana precisa de teto.
    const { characterId, accountId } = await seedCharacter(database, 20);
    const maxed = (await relog(database, characterId, true)).character;
    expect(maxed.maxHealth).toBeGreaterThan(10);
    expect(maxed.maxMana).toBeGreaterThan(3);

    await playAndLogOut({
      database, characterId, accountId, openWorld: true,
      play: (character) => {
        character.health = 10;
        character.mana = 3;
        // O dono da sessão grava a âncora na saída (OW-16/OW-20); aqui, o que a hunt idle carrega.
        character.worldPosition = STREET;
        character.conditions.apply({
          key: 'poison', expiresAtMs: 4_000, nextTickAtMs: 1_000,
          tick: { amount: 3, intervalMs: 1_000, kind: 'damage' },
        });
      },
    });

    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: STREET.x, worldY: STREET.y, worldZ: STREET.z, townId: 'thais', health: 10, mana: 3,
    });
    const { initial, character } = await relog(database, characterId, true);
    expect(initial).toMatchObject({ worldPosition: STREET, townId: 'thais', health: 10, mana: 3 });
    expect(character.health).toBe(10);
    expect(character.mana).toBe(3);
    expect(character.worldPosition).toEqual(STREET);
    // O veneno faltava 4 000 ms no instante da saída (a sessão estava em 0 ms), e falta o mesmo ao voltar.
    expect(character.conditions.get('poison')).toMatchObject({ expiresAtMs: 4_000, nextTickAtMs: 1_000 });
    // Nada foi descartado: a linha é a mesma de antes, com as colunas preenchidas.
    expect((await new DrizzleGameRepository(database.database.db).getCharacterById(characterId))?.level).toBe(20);
  });

  it('SEM a flag — o default —: nenhuma coluna é escrita e o ticket nasce cheio, como hoje', async () => {
    const database = db as NonNullable<typeof db>;
    const { characterId, accountId } = await seedCharacter(database);

    await playAndLogOut({
      database, characterId, accountId, openWorld: false,
      play: (character) => { character.health = 10; character.mana = 3; character.worldPosition = STREET; },
    });

    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: null, worldY: null, worldZ: null, health: null, mana: null, conditions: null, townId: 'thais',
    });
    const { initial, character } = await relog(database, characterId, false);
    for (const field of ['worldPosition', 'townId', 'health', 'mana', 'conditions']) {
      expect(initial).not.toHaveProperty(field);
    }
    expect(character.health).toBe(character.maxHealth);
  });

  it('o ticket de quem nunca saiu do mundo não traz posição: cai no templo, e a vida é a cheia', async () => {
    const database = db as NonNullable<typeof db>;
    const { characterId } = await seedCharacter(database);
    const { initial, character } = await relog(database, characterId, true);
    expect(initial).toMatchObject({ townId: 'thais' });
    expect(initial).not.toHaveProperty('worldPosition');
    expect(initial).not.toHaveProperty('health');
    expect(character.worldPosition).toBeNull();
    expect(character.health).toBe(character.maxHealth);
  });

  it('quem morreu volta de vida cheia e sem posição: a morte manda ao templo, e zero nunca chega à linha', async () => {
    const database = db as NonNullable<typeof db>;
    const { characterId, accountId } = await seedCharacter(database);
    // Primeiro sai ferido, na rua.
    await playAndLogOut({
      database, characterId, accountId, openWorld: true,
      play: (character) => { character.health = 10; character.worldPosition = STREET; },
    });
    expect((await columnsOf(database, characterId)).health).toBe(10);

    // Depois joga de novo e morre.
    await playAndLogOut({
      database, characterId, accountId, openWorld: true,
      play: (character) => { character.health = 0; character.alive = false; },
    });

    const row = await columnsOf(database, characterId);
    expect(row).toMatchObject({ worldX: null, worldY: null, worldZ: null, conditions: null });
    expect(row.health).toBe((await relog(database, characterId, true)).character.maxHealth);
    expect(row.health).toBeGreaterThan(0);
  });

  it('o ticket liquida o extrato pendente ANTES de ler a linha: o que o `api` lê já tem os 10 HP', async () => {
    // O caminho real do relogin (`settleProgress` antes de `withOwnedCharacter`): o extrato ainda
    // está no Redis quando o ticket é pedido, e a coluna só tem o que ele tiver liquidado.
    const database = db as NonNullable<typeof db>;
    const { characterId, accountId } = await seedCharacter(database);
    const repository = new DrizzleGameRepository(database.database.db);
    const record = await repository.getCharacterById(characterId);
    if (record === null) throw new Error('personagem não encontrado');
    const initial = initialCharacterOf(record, [], [], undefined, undefined, 0, true);
    const character = characterFromTicket(content, characterId, initial, () => 0);
    const session = createHuntSession({
      id: randomUUID(), content, huntId: TEST_HUNT.id, difficulty: 'cautious', createdAtMs: 0,
    });
    session.enter(character);
    const receipts = new ReceiptStore(redis);
    const host = new SessionHost({
      nodeId: 'world-vitals', contentVersion: content.version, logger, receipts, openWorld: true,
      createSession: () => session,
    });
    await host.prepare(characterId, initial, accountId);
    character.health = 10;
    await host.drainAll();
    expect((await columnsOf(database, characterId)).health).toBeNull();

    await settleCharacterProgress(characterId, {
      database: database.database.db, receipts, logger, progression: content.progression,
    });

    expect((await columnsOf(database, characterId)).health).toBe(10);
    expect((await relog(database, characterId, true)).character.health).toBe(10);
  });
});
