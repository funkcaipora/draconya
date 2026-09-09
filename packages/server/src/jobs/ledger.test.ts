import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { levelForXp } from '@draconya/sim';
import type { Progression } from '@draconya/content';
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

describe.runIf(ready)('a progressão volta para o personagem (FUN-54)', () => {
  const progression: Progression = {
    id: 'baseline', startingHealth: 150, startingMana: 0, startingCapacity: 400,
    healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
    stepDurationMs: 500, regen: { healthPerSecond: 1, manaPerSecond: 1 },
    xp: { base: 20, exponent: 2 },
    deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
  };

  const characterRow = async (
    database: NonNullable<typeof db>, characterId: string,
  ): Promise<{ xp: number; gold: number; level: number; staminaMs: number }> => {
    const [row] = await database.database.db
      .select({
        xp: characters.xp, gold: characters.gold, level: characters.level,
        staminaMs: characters.staminaMs,
      })
      .from(characters)
      .where(eq(characters.id, characterId));
    return row as { xp: number; gold: number; level: number; staminaMs: number };
  };

  it('grava XP, gold e o level derivado', async () => {
    // Sem isto, toda a progressão de uma hunt some na próxima conexão — e o snapshot em
    // Redis mascara o sintoma até um logout, que é o pior formato para um bug de progressão.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save(receiptOf(randomUUID(), characterId));

    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    const row = await characterRow(database, characterId);
    expect(row.xp).toBe(900);
    expect(row.gold).toBe(380);
    // Derivado, nunca copiado do extrato: 900 de XP cai no level 6 com esta curva.
    expect(row.level).toBe(levelForXp(900, progression));
  });

  it('NÃO credita duas vezes quando o mesmo extrato volta', async () => {
    // O par grava-depois-apaga só é seguro porque reinserir é operação nula. A progressão
    // pendura na MESMA chave: se a linha de ledger não entrou, o personagem não é tocado.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();

    await receipts.save(receiptOf(sessionId, characterId));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    await receipts.save(receiptOf(sessionId, characterId));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await characterRow(database, characterId)).xp).toBe(900);
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
  });

  it('aplica DELTA, então dois extratos diferentes somam', async () => {
    // Escrever o estado final não seria idempotente, e dois extratos processados fora de
    // ordem se sobrescreveriam. Delta soma na ordem que vier.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    await receipts.save(receiptOf(randomUUID(), characterId));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    await receipts.save(receiptOf(randomUUID(), characterId, { seq: 2 }));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await characterRow(database, characterId)).xp).toBe(1800);
  });

  it('a penalidade de morte chega como XP negativa, e não deixa a XP negativa', async () => {
    // O `xpGained` do extrato é LÍQUIDO: a penalidade da FUN-37 já entrou nele como número
    // negativo. XP negativa no banco é um estado impossível que dá erro estranho em todo
    // lugar que a lê depois, então o piso é do banco, não confiança em quem chama.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save(receiptOf(randomUUID(), characterId, {
      reason: 'death',
      aggregates: {
        durationMs: 1000, xpGained: -5000, goldGained: 0, goldSpent: 0, kills: 0, deaths: 1,
      },
    }));

    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    const row = await characterRow(database, characterId);
    expect(row.xp).toBe(0);
    expect(row.level).toBe(1);
  });

  it('grava a stamina gasta, mas um extrato ATRASADO não devolve stamina', async () => {
    // Stamina é valor absoluto, não soma — e por isso vem com guarda de instante. Sem ela,
    // um extrato antigo processado fora de ordem devolveria stamina já gasta.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const agora = Date.now();

    await receipts.save(receiptOf(randomUUID(), characterId, {
      staminaMs: 10_000, staminaUpdatedAtMs: agora,
    }));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    expect((await characterRow(database, characterId)).staminaMs).toBe(10_000);

    await receipts.save(receiptOf(randomUUID(), characterId, {
      seq: 2, staminaMs: 86_400_000, staminaUpdatedAtMs: agora - 60_000,
    }));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await characterRow(database, characterId)).staminaMs).toBe(10_000);
  });

  it('sem curva de XP, credita o ledger e deixa o level como está', async () => {
    // É o `jobs` montado sem conteúdo. Creditar gold e XP sem derivar level é degradação
    // aceitável; recusar o extrato inteiro seria perder o crédito.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save(receiptOf(randomUUID(), characterId));

    await writePendingReceipts({ database: database.database.db, receipts, logger });

    const row = await characterRow(database, characterId);
    expect(row.xp).toBe(900);
    expect(row.level).toBe(1);
  });
});
