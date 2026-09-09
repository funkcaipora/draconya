import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, characters } from '../db/schema.js';
import { createLogger } from '../log.js';
import { ReceiptStore, type SessionReceipt } from '../receipts.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { countLedgerRows, creditOf, writePendingReceipts } from './ledger.js';

const logger = createLogger('silent', 'test');
const { redis, available: redisReady } = await connectTestRedis(5);

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

const receiptOf = (sessionId: string, characterId: string, overrides = {}): Omit<
  SessionReceipt, 'endedAtMs'
> => ({
  sessionId,
  characterId,
  accountId: 'a1',
  reason: 'drain',
  seq: 1,
  aggregates: {
    durationMs: 600_000, xpGained: 900, goldGained: 500, goldSpent: 120, kills: 12, deaths: 0,
  },
  notableEvents: [{ atMs: 1_000, type: 'level-up' }],
  ...overrides,
});

async function seedCharacter(database: NonNullable<typeof db>): Promise<string> {
  const accountId = randomUUID();
  const characterId = randomUUID();
  await database.database.db.insert(accounts).values({
    id: accountId, email: `${accountId}@example.com`, externalAuthId: accountId,
  });
  await database.database.db.insert(characters).values({
    id: characterId, accountId, name: `Extrato ${characterId.slice(0, 8)}`,
  });
  return characterId;
}

describe('credit of a receipt', () => {
  it('is gained minus spent', () => {
    expect(creditOf(receiptOf('s', 'c') as SessionReceipt)).toBe(380);
  });
});

describe.runIf(ready)('receipts to the ledger', () => {
  it('writes the receipt and clears it from Redis', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    await receipts.save(receiptOf(sessionId, characterId));

    const result = await writePendingReceipts({
      database: database.database.db, receipts, logger,
    });

    expect(result).toEqual({ written: 1, failed: 0 });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
    expect(await receipts.pending()).toEqual([]);
  });

  it('never credits twice, even if the same receipt is written again', async () => {
    // É O TESTE DO INVARIANTE 10. O par grava-depois-apaga só é seguro porque reinserir é
    // operação nula: morrer entre inserir e apagar tem que custar uma tentativa repetida, e
    // não um crédito dobrado no extrato de alguém.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();

    await receipts.save(receiptOf(sessionId, characterId));
    await writePendingReceipts({ database: database.database.db, receipts, logger });
    // Exatamente o que acontece quando o processo morre depois do insert: o extrato volta.
    await receipts.save(receiptOf(sessionId, characterId));
    const second = await writePendingReceipts({
      database: database.database.db, receipts, logger,
    });

    expect(second.written).toBe(1);
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
  });

  it('keeps the receipt when the write fails, instead of losing the credit', async () => {
    // Personagem inexistente viola a chave estrangeira. Perder o crédito em silêncio é o
    // defeito que este caminho existe para não ter.
    const database = db as NonNullable<typeof db>;
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    await receipts.save(receiptOf(sessionId, randomUUID()));

    const result = await writePendingReceipts({
      database: database.database.db, receipts, logger,
    });

    expect(result).toEqual({ written: 0, failed: 1 });
    expect(await receipts.pending()).toHaveLength(1);
  });
});
