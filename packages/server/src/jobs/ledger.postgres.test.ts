import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { createHuntSession, levelForXp } from '@draconya/sim';
import type { Progression } from '@draconya/content';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { accounts, characters, itemInstances, ledger } from '../db/schema.js';
import { createLogger } from '../log.js';
import { ReceiptStore, type SessionReceipt } from '../receipts.js';
import { DrizzleGameRepository } from '../db/repository.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { testContent, TEST_HUNT } from '../testing/content.js';
import { SessionHost } from '../game/host.js';
import { createCitySessionFactory } from '../game/sessions.js';
import {
  countLedgerRows, creditOf, settleCharacterProgress, writePendingReceipts,
} from './ledger.js';

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
       itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
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

const progression: Progression = {
  id: 'baseline', startingHealth: 150, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  satchelInitialSlots: 10, containerRow: 5,
  startingSpeed: 300, speedPerLevel: 0, regen: { healthPerSecond: 1, manaPerSecond: 1 },
  startingKit: [],
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
};

/**
 * O `stamina_updated_at` da linha, em milissegundos.
 *
 * Existe para o teste de stamina não cruzar relógios (FUN-101): tudo que ele compara passa a
 * vir do mesmo lugar que a guarda compara.
 */
const staminaUpdatedAt = async (
  database: NonNullable<typeof db>, characterId: string,
): Promise<number> => {
  const [row] = await database.database.db
    .select({ at: characters.staminaUpdatedAt })
    .from(characters)
    .where(eq(characters.id, characterId));
  if (row === undefined) throw new Error('personagem não encontrado');
  return row.at.getTime();
};

const characterRow = async (
  database: NonNullable<typeof db>, characterId: string,
): Promise<{
  xp: number; gold: number; level: number; staminaMs: number; skills: unknown; bestiary: unknown;
  vocation: string | null;
}> => {
  const [row] = await database.database.db
    .select({
      xp: characters.xp, gold: characters.gold, level: characters.level,
      skills: characters.skills,
      bestiary: characters.bestiary,
      vocation: characters.vocation,
      staminaMs: characters.staminaMs,
    })
    .from(characters)
    .where(eq(characters.id, characterId));
  return row as {
    xp: number; gold: number; level: number; staminaMs: number; skills: unknown; bestiary: unknown;
    vocation: string | null;
  };
};

describe('credit of a receipt', () => {
  it('is gained minus spent', () => {
    expect(creditOf(receiptOf('s', 'c') as SessionReceipt)).toBe(380);
  });

  it('adds the purchased total back, so the session row carries the net WITHOUT the purchases (#419)', () => {
    // As compras têm linha própria com o valor. Sem somá-las de volta aqui, a linha do extrato
    // contaria o gasto duas vezes; somando todas as linhas da sessão, o total continua
    // `goldGained - goldSpent`.
    const receipt = {
      ...receiptOf('s', 'c'),
      purchases: [
        { seq: 1, characterId: 'c', itemId: 'health-potion', quantity: 1, unitPrice: 45, total: 45 },
        { seq: 2, characterId: 'c', itemId: 'mana-potion', quantity: 1, unitPrice: 45, total: 45 },
      ],
    } as unknown as SessionReceipt;
    expect(creditOf(receipt)).toBe(380 + 90);
  });
});

describe.runIf(ready)('receipts to the ledger', () => {
  it('retries a lost receipt acknowledgement after settlement without crediting twice (#267)', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const [owner] = await database.database.db.select({ accountId: characters.accountId })
      .from(characters).where(eq(characters.id, characterId));
    if (owner === undefined) throw new Error('Missing test character');
    const receipts = new ReceiptStore(redis);
    const persist = receipts.save.bind(receipts);
    const save = vi.spyOn(receipts, 'save').mockImplementationOnce(async (receipt) => {
      await persist(receipt);
      // A escrita aconteceu, mas o game não recebeu a confirmação.
      throw new Error('Receipt acknowledgement lost');
    });
    const content = testContent();
    const sessionId = randomUUID();
    const session = createHuntSession({
      id: sessionId, content, huntId: TEST_HUNT.id, difficulty: 'cautious', createdAtMs: 0,
    });
    const character = createCitySessionFactory(content)(characterId).participants[0];
    if (character === undefined) throw new Error('Missing test runtime');
    session.enter(character);
    session.credit(characterId, 'goldGained', 50);
    session.credit(characterId, 'xpGained', 20);
    const host = new SessionHost({
      nodeId: 'receipt-retry-test', contentVersion: content.version, logger, receipts,
      createSession: () => session,
    });
    await host.prepare(characterId, undefined, owner.accountId);
    const sweep = { database: database.database.db, receipts, logger, progression };

    expect(await host.drainAll()).toBe(0);
    expect(host.sessionFor(characterId)).toBe(session);
    expect(await receipts.pendingFor(characterId)).toHaveLength(1);
    // O jobs pode liquidar ANTES de o game repetir a tentativa, removendo o extrato do Redis.
    expect(await writePendingReceipts(sweep)).toEqual({ written: 1, failed: 0 });
    expect(await characterRow(database, characterId)).toMatchObject({ gold: 50, xp: 20 });
    expect(await receipts.pendingFor(characterId)).toEqual([]);

    expect(await host.drainAll()).toBe(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toEqual(save.mock.calls[0]?.[0]);
    expect(await receipts.pendingFor(characterId)).toHaveLength(1);
    expect(await writePendingReceipts(sweep)).toEqual({ written: 1, failed: 0 });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
    expect(await characterRow(database, characterId)).toMatchObject({ gold: 50, xp: 20 });
    expect(await receipts.pendingFor(characterId)).toEqual([]);
    expect(host.sessionFor(characterId)).toBeUndefined();
  });

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

  it('writes one ledger row per party member of the same session, and never twice (#194, ADR 0027)', async () => {
    // Dois extratos com o MESMO `session_id` e `seq` 1 e 2: duas linhas, uma por membro; o
    // reprocessamento bate na chave única e não duplica nenhuma das duas.
    const database = db as NonNullable<typeof db>;
    const a = await seedCharacter(database);
    const b = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    await receipts.save(receiptOf(sessionId, a, { seq: 1 }));
    await receipts.save(receiptOf(sessionId, b, { seq: 2 }));

    const first = await writePendingReceipts({ database: database.database.db, receipts, logger });
    expect(first).toEqual({ written: 2, failed: 0 });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(2);
    expect(await receipts.pending()).toEqual([]);

    await receipts.save(receiptOf(sessionId, a, { seq: 1 }));
    await receipts.save(receiptOf(sessionId, b, { seq: 2 }));
    await writePendingReceipts({ database: database.database.db, receipts, logger });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(2);
    // E cada um recebeu o SEU crédito: o gold do extrato vai para a linha do dono do extrato.
    expect((await characterRow(database, a)).gold).toBe((await characterRow(database, b)).gold);
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
       itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
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
    // **O instante sai da PRÓPRIA LINHA, nunca de `Date.now()`** (FUN-101). A guarda compara
    // `receipt.staminaUpdatedAtMs` com `characters.stamina_updated_at`, que nasce de
    // `defaultNow()` — relógio do POSTGRES. `Date.now()` é o relógio deste processo, e os dois
    // não são o mesmo: medido nesta máquina, o Postgres está ~35 ms à frente. Com o insert
    // voltando em menos que isso, `Date.now()` fica ATRÁS da linha recém-criada e a guarda
    // recusa a primeira escrita — reprovando um teste que não fala de relógio nenhum.
    const nascido = await staminaUpdatedAt(database, characterId);

    await receipts.save(receiptOf(randomUUID(), characterId, {
      staminaMs: 10_000, staminaUpdatedAtMs: nascido,
    }));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    expect((await characterRow(database, characterId)).staminaMs).toBe(10_000);

    await receipts.save(receiptOf(randomUUID(), characterId, {
      seq: 2, staminaMs: 86_400_000, staminaUpdatedAtMs: nascido - 60_000,
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

describe.runIf(ready)('a coluna `gold` bate com o ledger (FUN-57)', () => {
  /**
   * O gold do personagem é PROJEÇÃO: a verdade é a soma do ledger (invariante 10), e a coluna
   * existe para não somar linhas a cada leitura. Projeção que ninguém confere é projeção que
   * diverge, e o sintoma chega como "meu gold está errado" — sem nada no log, e sem ninguém
   * conseguindo dizer qual dos dois números mentiu.
   *
   * O que reconstrói a coluna NÃO é `SUM(delta)`, e a diferença é o valor deste teste: o
   * crédito tem PISO DE ZERO (`Math.max(0, ...)` em `applyProgress`). Uma sessão que gasta mais
   * do que o personagem tinha grava o delta negativo cheio no ledger e trunca a coluna em zero.
   * A projeção é a soma DOBRADA no piso, linha a linha, na ordem em que entraram.
   */
  const foldLedger = async (
    database: NonNullable<typeof db>, characterId: string,
  ): Promise<number> => {
    const rows = await database.database.db
      .select({ delta: ledger.delta })
      .from(ledger)
      .where(eq(ledger.characterId, characterId))
      .orderBy(asc(ledger.createdAt), asc(ledger.seq));
    // Começa em zero, que é o default da coluna: criar personagem não é movimentação de valor
    // e por isso não tem linha de ledger. Se um dia alguém nascer com gold, este zero é a
    // primeira coisa que precisa mudar — e este teste é quem avisa.
    return rows.reduce((acc, row) => Math.max(0, acc + row.delta), 0);
  };

  it('depois de três extratos, a coluna é exatamente a soma dobrada no piso', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    // Três sessões com saldos diferentes, incluindo uma NEGATIVA — gastou mais do que ganhou,
    // que é a hunt em que o supply custou mais que o loot. Sem uma negativa no meio, o teste
    // não distinguiria soma de soma-com-piso, e passaria dos dois jeitos.
    for (const [gained, spent] of [[500, 120], [200, 900], [1_000, 50]]) {
      await receipts.save(receiptOf(randomUUID(), characterId, {
        aggregates: {
          durationMs: 1_000, xpGained: 0, goldGained: gained, goldSpent: spent,
          kills: 0, deaths: 0, itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
        },
      }));
      // Um extrato por varredura: a ordem entre eles é o que o piso torna significativo.
      await writePendingReceipts({
        database: database.database.db, receipts, logger, progression,
      });
    }

    const row = await characterRow(database, characterId);
    expect(row.gold).toBe(await foldLedger(database, characterId));
    // E o número, escrito à mão, para o teste não passar com os dois lados quebrados juntos:
    // 380, depois 380−700 truncado em 0, depois 950.
    expect(row.gold).toBe(950);
  });

  it('o piso é a ÚNICA divergência: sem ele, coluna e soma crua seriam a mesma coisa', async () => {
    // Um personagem que nunca passou do piso. Aqui `SUM(delta)` basta, e é isso que diz que a
    // diferença do teste acima vem do piso e não de uma escrita perdida.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    for (const [gained, spent] of [[500, 120], [300, 80]]) {
      await receipts.save(receiptOf(randomUUID(), characterId, {
        aggregates: {
          durationMs: 1_000, xpGained: 0, goldGained: gained, goldSpent: spent,
          kills: 0, deaths: 0, itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
        },
      }));
      await writePendingReceipts({
        database: database.database.db, receipts, logger, progression,
      });
    }

    const rows = await database.database.db
      .select({ delta: ledger.delta })
      .from(ledger)
      .where(eq(ledger.characterId, characterId));
    const cru = rows.reduce((acc, row) => acc + row.delta, 0);

    expect((await characterRow(database, characterId)).gold).toBe(cru);
    expect(cru).toBe(600);
  });

  it('gold escrito na coluna SEM linha de ledger é detectável', async () => {
    // A classe de defeito que este bloco existe para pegar: um caminho novo que credita o
    // personagem e esquece o ledger. Aqui ele é simulado com um UPDATE cru, porque nenhum
    // caminho do código faz isso hoje — e a conferência precisa reprovar no dia em que fizer.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save(receiptOf(randomUUID(), characterId));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    expect((await characterRow(database, characterId)).gold)
      .toBe(await foldLedger(database, characterId));

    await database.database.db
      .update(characters)
      .set({ gold: 999_999 })
      .where(eq(characters.id, characterId));

    expect((await characterRow(database, characterId)).gold)
      .not.toBe(await foldLedger(database, characterId));
  });

  it('com compras por lote, cada uma tem linha própria e a coluna continua batendo (#419)', async () => {
    // O que este teste prende: (a) uma linha `purchase` por compra, com `(session_id, seq)`;
    // (b) a linha do extrato leva o líquido SEM as compras, e a soma do ledger continua
    // `goldGained - goldSpent`; (c) retry do mesmo extrato não duplica; (d) a coluna
    // `characters.gold` é a projeção dobrada no piso.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const aggs = (goldGained: number, goldSpent: number) => ({
      durationMs: 1_000, xpGained: 0, goldGained, goldSpent,
      kills: 0, deaths: 0, itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
    });

    await receipts.save(receiptOf(randomUUID(), characterId, {
      aggregates: aggs(500, 0),
    }));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    const sessionId = randomUUID();
    const purchases = [
      { seq: 1, characterId, itemId: 'health-potion', quantity: 1, unitPrice: 45, total: 45 },
      { seq: 2, characterId, itemId: 'mana-potion', quantity: 1, unitPrice: 45, total: 45 },
    ];
    const purchased = receiptOf(sessionId, characterId, {
      seq: 3, purchases, aggregates: aggs(0, 90),
    });
    await receipts.save(purchased);
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    const rows = await database.database.db
      .select({ type: ledger.type, seq: ledger.seq, delta: ledger.delta })
      .from(ledger)
      .where(eq(ledger.sessionId, sessionId))
      .orderBy(asc(ledger.seq));
    expect(rows.map((row) => [row.type, row.seq, row.delta])).toEqual([
      ['purchase', 1, -45],
      ['purchase', 2, -45],
      ['session-drain', 3, 0],
    ]);
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(3);
    expect((await characterRow(database, characterId)).gold).toBe(410);
    expect((await characterRow(database, characterId)).gold)
      .toBe(await foldLedger(database, characterId));

    // Retry do MESMO extrato: a chave única recusa cada linha e nada muda.
    await receipts.save(purchased);
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(3);
    expect((await characterRow(database, characterId)).gold).toBe(410);
  });
});

describe.runIf(ready)('liquidação de um personagem só (FUN-56)', () => {
  it('settles the character it was asked about and leaves the queue alone', async () => {
    // A emissão de ticket não pode pagar pela fila inteira: com cinco mil sessões de pé, o
    // trabalho de um login seria proporcional a quantas ACABARAM de encerrar.
    const database = db as NonNullable<typeof db>;
    const mine = await seedCharacter(database);
    const theirs = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save(receiptOf(randomUUID(), mine));
    await receipts.save(receiptOf(randomUUID(), theirs));

    const result = await settleCharacterProgress(mine, {
      database: database.database.db, receipts, logger, progression,
    });

    expect(result).toEqual({ written: 1, failed: 0 });
    expect((await characterRow(database, mine)).xp).toBe(900);
    expect((await characterRow(database, theirs)).xp).toBe(0);
    expect(await receipts.pendingFor(theirs)).toHaveLength(1);
  });

  it('is the same path as the sweep, so meeting it credits once', async () => {
    // O `jobs` e a emissão de ticket processam o mesmo extrato ao mesmo tempo o tempo todo.
    // O segundo a chegar bate na chave única, não aplica nada, e apaga um extrato já pago.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    await receipts.save(receiptOf(sessionId, characterId));

    await settleCharacterProgress(characterId, {
      database: database.database.db, receipts, logger, progression,
    });
    await receipts.save(receiptOf(sessionId, characterId));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await characterRow(database, characterId)).xp).toBe(900);
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
  });

  it('reports the failure instead of reporting success it did not have', async () => {
    // É o sinal que a rota de ticket usa para RECUSAR a entrada (FUN-56): emitir ticket em
    // cima de uma linha que o servidor sabe estar desatualizada é o defeito que ela existe
    // para não ter.
    const database = db as NonNullable<typeof db>;
    const orphan = randomUUID();
    const receipts = new ReceiptStore(redis);
    await receipts.save(receiptOf(randomUUID(), orphan));

    const result = await settleCharacterProgress(orphan, {
      database: database.database.db, receipts, logger, progression,
    });

    expect(result).toEqual({ written: 0, failed: 1 });
    expect(await receipts.pendingFor(orphan)).toHaveLength(1);
  });
});

describe.runIf(ready)('as skills chegam ao Postgres pelo extrato (FUN-75)', () => {
  it('grava o que o personagem praticou na hunt', async () => {
    // O critério da issue em uma linha: skill que sobe pelo uso e não chega ao banco é skill
    // que zera no próximo logout, e o snapshot em Redis mascara o sintoma até lá.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      skills: { melee: { level: 14, points: 3 } },
    });

    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await characterRow(database, characterId)).skills)
      .toEqual({ melee: { level: 14, points: 3 } });
  });

  it('um extrato ANTIGO não rebaixa uma skill que já subiu', async () => {
    // Skill é monotônica, e é isso que torna o `max` a fusão certa — não uma escolha
    // conservadora. É a preocupação da guarda de instante da stamina, resolvida sem instante
    // nenhum porque a grandeza não desce.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      skills: { melee: { level: 20, points: 0 }, magic: { level: 5, points: 10 } },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      skills: { melee: { level: 12, points: 0 } },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await characterRow(database, characterId)).skills).toEqual({
      melee: { level: 20, points: 0 },
      magic: { level: 5, points: 10 },
    });
  });

  it('extrato SEM skills não apaga as que já estavam lá', async () => {
    // É o extrato de uma sessão de Cidade, ou de um nó antigo durante deploy em rolagem.
    // Gravar `{}` por cima apagaria progressão que ninguém pediu para apagar.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      skills: { melee: { level: 15, points: 1 } },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    await receipts.save(receiptOf(randomUUID(), characterId));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await characterRow(database, characterId)).skills)
      .toEqual({ melee: { level: 15, points: 1 } });
  });
});

describe.runIf(ready)('a vocação chega ao Postgres pelo extrato, UMA vez (#154, ADR 0026 decisão 1)', () => {
  it('grava a escolha; um segundo extrato com outra vocação não sobrescreve; sem o campo não toca', async () => {
    // `coalesce`: a coluna só sai de `null` uma vez. Mutação que mata: trocar o `coalesce` por
    // atribuição direta — o `druid` do segundo extrato passaria por cima do `knight`.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).vocation).toBeNull();
    const receipts = new ReceiptStore(redis);

    await receipts.save({ ...receiptOf(randomUUID(), characterId) });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).vocation).toBeNull();

    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, vocation: 'knight' });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).vocation).toBe('knight');

    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3, vocation: 'druid' });
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 4 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).vocation).toBe('knight');
  });

  it('a arma de vocação vira instância com a proveniência dela, e o loot continua loot', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    await receipts.save({
      ...receiptOf(sessionId, characterId),
      vocation: 'knight',
      acquired: [
        { instanceId: `${sessionId}:${characterId}:vocation`, itemId: 'steel-axe', quantity: 1, origin: 'vocation-choice' },
        { instanceId: `${sessionId}:0`, itemId: 'spike-sword', quantity: 1 },
      ],
      equipment: { hand: `${sessionId}:${characterId}:vocation` },
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    const rows = await database.database.db
      .select({ id: itemInstances.id, origin: itemInstances.origin, slot: itemInstances.equippedSlot })
      .from(itemInstances)
      .where(eq(itemInstances.ownerCharacterId, characterId))
      .orderBy(asc(itemInstances.id));
    expect(rows.find((row) => row.id.endsWith(':vocation'))).toMatchObject({ origin: 'vocation-choice', slot: 'hand' });
    expect(rows.find((row) => row.id === `${sessionId}:0`)).toMatchObject({ origin: 'loot', slot: null });
  });
});

describe.runIf(ready)('o Bestiário chega ao Postgres pelo extrato (FUN-113)', () => {
  it('grava os abates da hunt, e a coluna nasce nula', async () => {
    // O critério da issue em uma linha: ticket → runtime → extrato → ledger → linha. Abate que
    // não chega ao banco é abate que some no próximo logout, e o marco 10 000 nunca chegaria.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).bestiary).toBeNull();
    const receipts = new ReceiptStore(redis);
    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      bestiary: { rat: 12 },
    });

    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await characterRow(database, characterId)).bestiary).toEqual({ rat: 12 });
  });

  it('um extrato ANTIGO não rebaixa um contador que já subiu, e um monstro novo entra', async () => {
    // Abate nunca desce, e é isso que torna o `max` a fusão certa (DT-02) — a preocupação da
    // guarda de instante da stamina, resolvida sem instante nenhum. Mutação que mata: gravar
    // o extrato por cima (`rat` cairia para 5), ou fundir só as chaves que já existiam (o
    // `bat` sumiria).
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      bestiary: { rat: 9 },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      bestiary: { rat: 5, bat: 2 },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await characterRow(database, characterId)).bestiary).toEqual({ rat: 9, bat: 2 });
  });

  it('extrato SEM Bestiário não apaga os abates que já estavam lá', async () => {
    // É o extrato de uma sessão de Cidade, ou de um nó antigo durante deploy em rolagem.
    // Gravar `{}` — ou `null` — por cima apagaria progressão que ninguém pediu para apagar.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      bestiary: { rat: 15 },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    await receipts.save(receiptOf(randomUUID(), characterId));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await characterRow(database, characterId)).bestiary).toEqual({ rat: 15 });
  });
});

describe.runIf(ready)('o equipamento é liquidado pelo extrato (FUN-82)', () => {
  const seedItems = async (
    database: NonNullable<typeof db>, characterId: string, ids: readonly string[],
  ) => {
    const repository = new DrizzleGameRepository(database.database.db);
    const created = [];
    for (const itemId of ids) {
      created.push(await repository.createItemInstance({
        itemId, ownerCharacterId: characterId, origin: 'loot',
      }));
    }
    return created;
  };
  const slotsOf = async (database: NonNullable<typeof db>, characterId: string) => {
    const rows = await database.database.db
      .select({ id: itemInstances.id, slot: itemInstances.equippedSlot })
      .from(itemInstances)
      .where(eq(itemInstances.ownerCharacterId, characterId));
    return new Map(rows.map((row) => [row.id, row.slot]));
  };

  it('veste o que a sessão registrou', async () => {
    // A sessão NUNCA escreve `item_instance` — ela registra onde as coisas ficaram, e o `jobs`
    // aplica na mesma transação da linha de ledger (invariante 10).
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const [espada] = await seedItems(database, characterId, ['spike-sword']);
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      equipment: { hand: (espada as { id: string }).id },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await slotsOf(database, characterId)).get((espada as { id: string }).id))
      .toBe('hand');
  });

  it('troca no mesmo slot: a antiga sai antes de a nova entrar', async () => {
    // O índice único do banco recusa duas peças no mesmo slot. Trocar A por B esbarraria nele
    // se B entrasse antes de A sair — por isso a liquidação desequipa primeiro, e por isso ela
    // é uma transação com dois passos em vez de um `update` por linha.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const [a, b] = await seedItems(database, characterId, ['spike-sword', 'spike-sword']);
    const idA = (a as { id: string }).id;
    const idB = (b as { id: string }).id;
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(randomUUID(), characterId), equipment: { hand: idA },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    await receipts.save({
      ...receiptOf(randomUUID(), characterId), equipment: { hand: idB },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    const slots = await slotsOf(database, characterId);
    expect(slots.get(idA)).toBeNull();
    expect(slots.get(idB)).toBe('hand');
  });

  it('o que sai do layout volta para a MOCHILA', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const [espada] = await seedItems(database, characterId, ['spike-sword']);
    const id = (espada as { id: string }).id;
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(randomUUID(), characterId), equipment: { hand: id },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    // Desequipou durante a sessão seguinte: o layout chega vazio.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), equipment: {} });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await slotsOf(database, characterId)).get(id)).toBeNull();
  });

  it('extrato SEM equipamento não mexe no que estava vestido', async () => {
    // É o extrato de uma sessão de Cidade, ou de um nó antigo durante deploy em rolagem.
    // Limpar por omissão desequiparia o personagem sem ninguém ter pedido.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const [espada] = await seedItems(database, characterId, ['spike-sword']);
    const id = (espada as { id: string }).id;
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(randomUUID(), characterId), equipment: { hand: id },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    await receipts.save(receiptOf(randomUUID(), characterId));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await slotsOf(database, characterId)).get(id)).toBe('hand');
  });

  it('um extrato NÃO move item de outra pessoa', async () => {
    // Escopado por dono: a consulta que decide o que existe é a das instâncias DESTE
    // personagem, então um id alheio no layout simplesmente não encontra nada.
    const database = db as NonNullable<typeof db>;
    const meu = await seedCharacter(database);
    const alheio = await seedCharacter(database);
    const [dele] = await seedItems(database, alheio, ['spike-sword']);
    const id = (dele as { id: string }).id;
    const receipts = new ReceiptStore(redis);

    await receipts.save({ ...receiptOf(randomUUID(), meu), equipment: { hand: id } });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect((await slotsOf(database, alheio)).get(id)).toBeNull();
  });
});

describe.runIf(ready)('a posição dos itens nos containers é liquidada pelo extrato (#160)', () => {
  const placesOf = async (database: NonNullable<typeof db>, characterId: string) => {
    const rows = await database.database.db
      .select({ id: itemInstances.id, container: itemInstances.container, slotIndex: itemInstances.slotIndex })
      .from(itemInstances)
      .where(eq(itemInstances.ownerCharacterId, characterId));
    return new Map(rows.map((row) => [row.id, [row.container, row.slotIndex]]));
  };
  const seed = async (database: NonNullable<typeof db>, characterId: string, n: number) => {
    const repository = new DrizzleGameRepository(database.database.db);
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      ids.push((await repository.createItemInstance({ itemId: 'rock', ownerCharacterId: characterId, origin: 'loot' })).id);
    }
    return ids;
  };

  it('grava container e índice; o extrato SEM layout não toca; um id alheio não move nada', async () => {
    // Mutação que mata: tirar `applyLayout` do `applyProgression`, ou escopar sem o dono.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const other = await seedCharacter(database);
    const [a, b] = await seed(database, characterId, 2) as [string, string];
    const [alien] = await seed(database, other, 1) as [string];
    expect((await placesOf(database, characterId)).get(a)).toEqual([null, null]);
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      layout: { [a]: { container: 'backpack', index: 3 }, [b]: { container: 'satchel', index: 0 }, [alien]: { container: 'backpack', index: 9 } },
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await placesOf(database, characterId)).get(a)).toEqual(['backpack', 3]);
    expect((await placesOf(database, characterId)).get(b)).toEqual(['satchel', 0]);
    expect((await placesOf(database, other)).get(alien)).toEqual([null, null]);

    // Sem `layout`: nada muda. Com um layout que omite `b` (foi equipado): a posição sai.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await placesOf(database, characterId)).get(a)).toEqual(['backpack', 3]);
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3, layout: { [a]: { container: 'backpack', index: 0 } } });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await placesOf(database, characterId)).get(a)).toEqual(['backpack', 0]);
    expect((await placesOf(database, characterId)).get(b)).toEqual([null, null]);
  });
});

describe.runIf(ready)('o item que caiu vira instância pelo extrato (FUN-88)', () => {
  const rowsOf = async (database: NonNullable<typeof db>, characterId: string) =>
    database.database.db
      .select({ id: itemInstances.id, itemId: itemInstances.itemId, origin: itemInstances.origin })
      .from(itemInstances)
      .where(eq(itemInstances.ownerCharacterId, characterId));

  it('insere o que a sessão criou, com a origem certa', async () => {
    // O `sim` NUNCA escreve `item_instance` — ele registra o que caiu, e o `jobs` insere na
    // mesma transação da linha de ledger (invariante 10).
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();

    await receipts.save({
      ...receiptOf(sessionId, characterId),
      acquired: [
        { instanceId: `${sessionId}:0`, itemId: 'spike-sword', quantity: 1 },
        { instanceId: `${sessionId}:1`, itemId: 'arrow', quantity: 20 },
      ],
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    const rows = await rowsOf(database, characterId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.origin === 'loot')).toBe(true);
  });

  it('o mesmo item chegando de novo não duplica NEM faz o extrato falhar', async () => {
    // Duas afirmações, e a segunda é a que importa — a primeira versão deste teste só olhava a
    // contagem de linhas, e passava com ou sem `ON CONFLICT DO NOTHING`: sem ele o `INSERT`
    // estoura, `writePendingReceipts` conta o extrato como FALHO e nada é gravado. A contagem
    // fica em 1 pelos dois caminhos, e o extrato inteiro — gold, XP, skills — se perde no
    // caminho errado.
    //
    // O que distingue os dois é `failed`.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const acquired = [{ instanceId: `${sessionId}:0`, itemId: 'spike-sword', quantity: 1 }];

    await receipts.save({ ...receiptOf(sessionId, characterId), acquired });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    // O mesmo item chegando por outro extrato. Não é o caminho comum — a chave única do ledger
    // já barra o extrato repetido —, mas é o que torna a inserção segura de retentar por conta
    // própria, que é o que uma identidade determinística compra.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, acquired });
    const segunda = await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect(segunda).toEqual({ written: 1, failed: 0 });
    expect(await rowsOf(database, characterId)).toHaveLength(1);
  });

  it('item que caiu E foi equipado na mesma sessão existe antes de o layout apontá-lo', async () => {
    // A ordem dentro da transação importa: o layout de equipamento aponta ids, e um id sem
    // linha não seria vestido por ninguém. Inserir antes é o que torna as duas metades
    // coerentes num extrato só.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const instanceId = `${sessionId}:0`;

    await receipts.save({
      ...receiptOf(sessionId, characterId),
      acquired: [{ instanceId, itemId: 'spike-sword', quantity: 1 }],
      equipment: { hand: instanceId },
    });
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    const [row] = await database.database.db
      .select({ slot: itemInstances.equippedSlot })
      .from(itemInstances)
      .where(eq(itemInstances.id, instanceId));
    expect(row?.slot).toBe('hand');
  });

  it('extrato SEM itens não toca a tabela', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    await receipts.save(receiptOf(randomUUID(), characterId));
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect(await rowsOf(database, characterId)).toHaveLength(0);
  });
});
