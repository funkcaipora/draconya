import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { CharacterRuntime, createHuntSession, Inventory, levelForXp } from '@draconya/sim';
import type { BosstiaryState, CharmsState, HazardState, InventoryState, LearnedSpellsState } from '@draconya/sim';
import { NEUTRAL_RATES } from '@draconya/content';
import type { Hazard, Progression, Vocation } from '@draconya/content';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accounts, characterStorages, characters, itemInstances, ledger,
} from '../db/schema.js';
import type { Database } from '../db/client.js';
import { createLogger } from '../log.js';
import { ReceiptStore, type SessionReceipt } from '../receipts.js';
import { DrizzleGameRepository } from '../db/repository.js';
import { initialCharacterOf } from '../api/tickets.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { testContent, TEST_HUNT } from '../testing/content.js';
import { SessionHost } from '../game/host.js';
import { FakeSocket } from '../game/testing.js';
import { createCitySessionFactory } from '../game/sessions.js';
import {
  countLedgerRows, creditOf, groupByCharacter, settleCharacterProgress, STUCK_RECEIPT_AFTER, writePendingReceipts,
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
       damageDealt: 0, healingDone: 0,
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
  startingSpeed: 300, speedPerLevel: 0, regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
  regeneration: { requiresFood: false },
  startingKit: [],
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.56, promotionReduction: 0.3 },
  skillMultipliers: {},
  mitigation: { multiplier: 1.3, primaryShield: 2.05, secondaryShield: 1.25 },
  rates: NEUTRAL_RATES,
  experienceBonusByLevel: [],
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
  xp: number; gold: number; soul: number; level: number; staminaMs: number; skills: unknown; bestiary: unknown;
  ammo: unknown; vocation: string | null; promoted: boolean; supplyStock: unknown; ammunitionStock: unknown;
  charms: unknown; hazard: unknown; bosstiary: unknown; learnedSpells: unknown; familiar: unknown; training: unknown;
  blessings: number;
}> => {
  const [row] = await database.database.db
    .select({
      xp: characters.xp, gold: characters.gold, soul: characters.soul, level: characters.level,
      skills: characters.skills,
      bestiary: characters.bestiary,
      ammo: characters.ammo,
      vocation: characters.vocation,
      promoted: characters.promoted,
      staminaMs: characters.staminaMs,
      supplyStock: characters.supplyStock,
      ammunitionStock: characters.ammunitionStock,
      charms: characters.charms,
      hazard: characters.hazard,
      bosstiary: characters.bosstiary,
      learnedSpells: characters.learnedSpells,
      familiar: characters.familiar,
      training: characters.training,
      blessings: characters.blessings,
    })
    .from(characters)
    .where(eq(characters.id, characterId));
  return row as {
    xp: number; gold: number; soul: number; level: number; staminaMs: number; skills: unknown; bestiary: unknown;
    ammo: unknown; vocation: string | null; promoted: boolean; supplyStock: unknown; ammunitionStock: unknown;
    charms: unknown; hazard: unknown; bosstiary: unknown; learnedSpells: unknown; familiar: unknown; training: unknown;
    blessings: number;
  };
};

describe('credit of a receipt', () => {
  it('is gained minus spent', () => {
    expect(creditOf(receiptOf('s', 'c') as SessionReceipt)).toBe(380);
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
       damageDealt: 0, healingDone: 0,
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
          damageDealt: 0, healingDone: 0,
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
          damageDealt: 0, healingDone: 0,
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

  it('com gasto no uso, a linha do extrato leva o líquido e a coluna continua batendo', async () => {
    // Sem compras por lote (reversão do modelo abstrato): o `goldSpent` já é o total debitado no
    // uso, e a linha do extrato leva o líquido `goldGained - goldSpent`. O que este teste prende:
    // (a) uma linha por extrato, com `(session_id, seq)`; (b) retry não duplica; (c) a coluna
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
    const spent = receiptOf(sessionId, characterId, { seq: 3, aggregates: aggs(100, 90) });
    await receipts.save(spent);
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    const rows = await database.database.db
      .select({ type: ledger.type, seq: ledger.seq, delta: ledger.delta })
      .from(ledger)
      .where(eq(ledger.sessionId, sessionId))
      .orderBy(asc(ledger.seq));
    expect(rows.map((row) => [row.type, row.seq, row.delta])).toEqual([
      ['session-drain', 3, 10],
    ]);
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
    expect((await characterRow(database, characterId)).gold).toBe(510);
    expect((await characterRow(database, characterId)).gold)
      .toBe(await foldLedger(database, characterId));

    // Retry do MESMO extrato: a chave única recusa a linha e nada muda.
    await receipts.save(spent);
    await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
    expect((await characterRow(database, characterId)).gold).toBe(510);
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

  it('skill NÃO é mais monotônica (#569): a penalidade de morte pode gravar um valor MENOR', async () => {
    // Antes do #569, o ledger fundia `skills` pelo MAIOR de cada uma (`Skills.merge`), porque
    // skill só subia. A penalidade de morte passou a tirar tries (a mesma fração que já tira
    // XP), e "fundir pelo maior" reergueria a perda — o personagem voltaria com a skill de
    // ANTES de morrer no próximo login. A correção grava o valor ABSOLUTO da sessão (guardado
    // por instante em `skills_updated_at`, migração 0016), como a stamina já fazia.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    // Sessão 1: o personagem treina e sobe `fist` para o level 20.
    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      skills: { fist: { level: 20, points: 500 } },
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).skills)
      .toEqual({ fist: { level: 20, points: 500 } });

    // Sessão 2 (depois, em tempo real): o personagem MORRE, e a penalidade derruba `fist` para
    // o level 15 — MENOS do que já estava gravado.
    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      reason: 'death',
      skills: { fist: { level: 15, points: 10 } },
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    // O valor da SESSÃO vence — não o máximo. Se o bug do merge ainda estivesse aqui, este
    // `toEqual` reprovaria com `{ fist: { level: 20, points: 500 } }` (o level 20 "ressuscitado").
    expect((await characterRow(database, characterId)).skills)
      .toEqual({ fist: { level: 15, points: 10 } });
  });

  it('extrato de sessão mais ANTIGA não sobrescreve o de uma mais NOVA, mesmo chegando depois', async () => {
    // A proteção contra ordem trocou de forma (não é mais "quem tem o valor maior") mas
    // continua existindo: a guarda agora é por INSTANTE (`endedAtMs`, o relógio de quando a
    // sessão terminou), como a da stamina. Duas `ReceiptStore` com relógio controlado simulam
    // a sessão mais nova sendo PROCESSADA primeiro e a mais antiga chegando depois.
    // Os dois relógios são deslocados a partir de AGORA (não literais pequenos): a guarda
    // compara contra `skills_updated_at`, que a linha do personagem nasce com `defaultNow()`
    // — um literal como `1_000` estaria sempre no PASSADO da criação da linha, e o teste
    // reprovaria por um motivo que não é o que ele quer provar.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const base = Date.now();
    const newer = new ReceiptStore(redis, { now: () => base + 2_000 });
    const older = new ReceiptStore(redis, { now: () => base + 1_000 });

    await newer.save({
      ...receiptOf(randomUUID(), characterId),
      skills: { fist: { level: 20, points: 0 } },
    });
    await writePendingReceipts({ database: database.database.db, receipts: newer, logger, progression });

    await older.save({
      ...receiptOf(randomUUID(), characterId),
      skills: { fist: { level: 12, points: 0 } },
    });
    await writePendingReceipts({ database: database.database.db, receipts: older, logger, progression });

    expect((await characterRow(database, characterId)).skills)
      .toEqual({ fist: { level: 20, points: 0 } });
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

describe.runIf(ready)('a munição escolhida chega ao Postgres pelo extrato (#152)', () => {
  it('grava a escolha, a última escrita vence, e o extrato sem o campo não toca na coluna', async () => {
    // Preferência, não progresso: o extrato mais novo diz o que o jogador escolheu por último,
    // e um extrato de Cidade (sem o campo) não pode apagar a escolha que a hunt gravou.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).ammo).toBeNull();
    const receipts = new ReceiptStore(redis);
    await receipts.save({ ...receiptOf(randomUUID(), characterId), ammo: { arrow: 'sniper-arrow' } });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).ammo).toEqual({ arrow: 'sniper-arrow' });

    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, ammo: { arrow: 'onyx-arrow' } });
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).ammo).toEqual({ arrow: 'onyx-arrow' });
  });
});

describe.runIf(ready)('a economia de Charms chega ao Postgres pelo extrato (M39-02, #602, ADR 0052 d.1)', () => {
  it('grava o registro, cresce a cada extrato, e o extrato sem o campo não toca na coluna', async () => {
    // ABSOLUTA como `ammo` — NÃO fundida pelo maior como o Bestiário: não há aqui um contador
    // externo monotônico a fundir, é o estado final da sessão dona.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).charms).toBeNull();
    const receipts = new ReceiptStore(redis);
    const first: CharmsState = {
      pointsSpent: 240, echoesSpent: 0, tiers: { wound: 1 }, assignments: { wound: 'rat' }, version: 1,
    };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), charms: first });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).charms).toEqual(first);

    const second: CharmsState = {
      pointsSpent: 240 + 360, echoesSpent: 50, tiers: { wound: 2 }, assignments: { wound: 'rat' }, version: 1,
    };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, charms: second });
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    // O extrato SEM o campo (seq 3, uma sessão de Cidade que não mexeu em Charm) não apaga o
    // que o extrato anterior gravou.
    expect((await characterRow(database, characterId)).charms).toEqual(second);
  });
});

describe.runIf(ready)('o Bosstiary chega ao Postgres pelo extrato (#629, ADR 0052 d.1)', () => {
  it('nasce nulo, funde pelo MAIOR de cada boss e dos pontos, e o extrato sem o campo não toca na coluna', async () => {
    // Como o Bestiário — e ao contrário dos Charms: abate e ponto de boss só sobem, então um
    // extrato ANTIGO processado fora de ordem não pode rebaixar o que um mais novo já gravou.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).bosstiary).toBeNull();
    const receipts = new ReceiptStore(redis);

    const newer: BosstiaryState = { kills: { '639': 5, '1811': 2 }, points: 100, version: 1 };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), bosstiary: newer });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).bosstiary).toEqual(newer);

    // Um extrato mais velho (menos abates de um boss, um boss a mais) chega depois: fica o maior
    // de cada um, e o boss novo entra.
    const older: BosstiaryState = { kills: { '639': 3, '100': 1 }, points: 40, version: 1 };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, bosstiary: older });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).bosstiary)
      .toEqual({ kills: { '639': 5, '1811': 2, '100': 1 }, points: 100, version: 1 });

    // Extrato de Cidade (sem o campo) não apaga nada.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).bosstiary)
      .toEqual({ kills: { '639': 5, '1811': 2, '100': 1 }, points: 100, version: 1 });
  });
});

describe.runIf(ready)('as magias aprendidas chegam ao Postgres pelo extrato (#624, ADR 0058, ADR 0052 d.1)', () => {
  it('nasce nulo (personagem novo), grava o registro, cresce a cada extrato, e o extrato sem o campo não toca na coluna', async () => {
    // O registro só CRESCE, e o ledger o FUNDE pela união (ADR 0058, Emenda, ponto 6) — ao contrário
    // de `charms`, que é última-escrita-vence. Este caso é o caminho feliz; a ordem trocada e a
    // base desconhecida têm teste próprio abaixo.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).learnedSpells).toBeNull();
    const receipts = new ReceiptStore(redis);
    const first: LearnedSpellsState = { spellIds: ['wound-cleansing'], version: 1 };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), learnedSpells: first });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).learnedSpells).toEqual(first);

    const second: LearnedSpellsState = { spellIds: ['wound-cleansing', 'berserk'], version: 1 };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, learnedSpells: second });
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    // O extrato SEM o campo (seq 3, um nó anterior a esta issue) não apaga o que o anterior gravou.
    expect((await characterRow(database, characterId)).learnedSpells).toEqual(second);
  });

  it('extratos fora de ordem: o antigo chegando DEPOIS do novo não derruba a magia já paga', async () => {
    // O `SCAN` de `pending()` não ordena. A ida da Cidade para a hunt grava um extrato durável
    // com `[wound-cleansing]`; na hunt o jogador compra o Berserk e o extrato final leva os dois,
    // com os 2 500 já em `goldSpent`. Se a varredura atrasa, os dois ficam pendentes juntos.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    await database.database.db.update(characters).set({ gold: 10_000 }).where(eq(characters.id, characterId));
    const receipts = new ReceiptStore(redis);
    const sweep = () => writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    const spent = (goldSpent: number) => ({
      aggregates: { ...receiptOf('x', characterId).aggregates, goldGained: 0, goldSpent },
    });
    const city = {
      ...receiptOf(randomUUID(), characterId, spent(0)),
      seq: 1,
      learnedSpells: { spellIds: ['wound-cleansing'], version: 1 } satisfies LearnedSpellsState,
    };
    const hunt = {
      ...receiptOf(randomUUID(), characterId, spent(2_500)),
      seq: 2,
      learnedSpells: { spellIds: ['wound-cleansing', 'berserk'], version: 1 } satisfies LearnedSpellsState,
    };

    // O mais NOVO primeiro, o mais antigo depois — a ordem que quebrava a última-escrita-vence.
    await receipts.save(hunt);
    await sweep();
    await receipts.save(city);
    await sweep();

    const row = await characterRow(database, characterId);
    expect(row.learnedSpells).toEqual({ spellIds: ['wound-cleansing', 'berserk'], version: 1 });
    // O gold é delta: os 2 500 ficaram debitados UMA vez, e agora a magia que eles pagaram ficou.
    expect(row.gold).toBe(10_000 - 2_500);
  });

  it('extrato de base desconhecida (só a compra) não apaga a concessão da migração (ADR 0014)', async () => {
    // Uma sessão retomada de um snapshot anterior à #624 não sabe o registro; ao comprar UMA magia
    // o extrato leva `[berserk]`. A linha já tem as magias que a migração 0024 concedeu.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const granted: LearnedSpellsState = { spellIds: ['wound-cleansing', 'brutal-strike'], version: 1 };
    await database.database.db.update(characters).set({ learnedSpells: granted }).where(eq(characters.id, characterId));
    const receipts = new ReceiptStore(redis);
    await receipts.save({
      ...receiptOf(randomUUID(), characterId), learnedSpells: { spellIds: ['berserk'], version: 1 },
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    expect((await characterRow(database, characterId)).learnedSpells)
      .toEqual({ spellIds: ['wound-cleansing', 'brutal-strike', 'berserk'], version: 1 });
  });

  it('uma linha torta (que o ticket já trataria como ausente) não derruba o extrato nem vira o registro', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    await database.database.db.update(characters)
      .set({ learnedSpells: { spellIds: 'not-a-list' } }).where(eq(characters.id, characterId));
    const receipts = new ReceiptStore(redis);
    await receipts.save({
      ...receiptOf(randomUUID(), characterId), learnedSpells: { spellIds: ['berserk'], version: 1 },
    });
    const result = await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    expect(result).toEqual({ written: 1, failed: 0 });
    expect((await characterRow(database, characterId)).learnedSpells)
      .toEqual({ spellIds: ['berserk'], version: 1 });
  });

  it('o gold da compra e o registro entram no MESMO extrato: um retry não cobra duas vezes (invariante 10)', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    await database.database.db.update(characters).set({ gold: 10_000 }).where(eq(characters.id, characterId));
    const before = (await characterRow(database, characterId)).gold;
    expect(before).toBe(10_000);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const purchase = {
      ...receiptOf(sessionId, characterId),
      aggregates: { ...receiptOf(sessionId, characterId).aggregates, goldGained: 0, goldSpent: 2_500 },
      learnedSpells: { spellIds: ['berserk'], version: 1 },
    } satisfies Omit<SessionReceipt, 'endedAtMs'>;
    // O MESMO `(session_id, seq)` duas vezes — o retry que o ledger existe para não duplicar.
    await receipts.save(purchase);
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    await receipts.save(purchase);
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    const row = await characterRow(database, characterId);
    expect(row.gold).toBe(before - 2_500);
    expect(row.learnedSpells).toEqual({ spellIds: ['berserk'], version: 1 });
  });
});

describe.runIf(ready)('o familiar chega ao Postgres pelo extrato (M38-02, #599, ADR 0057 d.3)', () => {
  it('grava os carimbos, a última escrita vence — inclusive DESCENDO —, e o extrato sem o campo não toca na coluna', async () => {
    // ABSOLUTO como `charms`, e NUNCA fundido pelo maior: o `summonUntilMs` DESCE quando o familiar
    // morre (`FamiliarDeath` zera a recriação). É a segunda gravação abaixo que prova isso — com
    // um `GREATEST` no ledger, o familiar morto voltaria na próxima entrada.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).familiar).toBeNull();
    const receipts = new ReceiptStore(redis);
    const first = { version: 1, summonUntilMs: 1_790_000_900_000, cooldownUntilMs: 1_790_001_800_000 };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), familiar: first });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).familiar).toEqual(first);

    // O familiar morreu: o tempo que sobrava cai para o instante da morte, o cooldown segue.
    const second = { ...first, summonUntilMs: 1_790_000_100_000 };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, familiar: second });
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    // O extrato SEM o campo (seq 3, uma sessão que não mexeu no familiar) não apaga o gravado.
    expect((await characterRow(database, characterId)).familiar).toEqual(second);
  });
});

describe.runIf(ready)('o registro do Treino chega ao Postgres pelo extrato (#631, ADR 0059 d.3, ADR 0052 d.1)', () => {
  it('grava o registro, a última escrita vence — o banco DESCE quando a `api` o gasta —, e o extrato sem o campo não toca na coluna', async () => {
    // ABSOLUTO como `charms`, NUNCA fundido pelo maior: o banco de offline training sobe por tempo
    // de hunt e DESCE quando a `api` o gasta, e é a segunda gravação abaixo (menor que a primeira)
    // que prova a régua — fundir pelo maior ressuscitaria o tempo já gasto.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).training).toBeNull();
    const receipts = new ReceiptStore(redis);
    const first = { offlineBankMs: 7_200_000, offlineSkill: 'sword', version: 1 };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), training: first });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).training).toEqual(first);

    const spent = { offlineBankMs: 3_600_000, offlineSkill: null, version: 1 };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, training: spent });
    // Extrato de sessão que não mexeu no Treino (um nó anterior, ou o de Cidade sem o campo).
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).training).toEqual(spent);
  });
});

describe.runIf(ready)('o Hazard chega ao Postgres pelo extrato (M44-14, #632, ADR 0052 d.1)', () => {
  it('nasce nulo, a última escrita vence (inclusive para BAIXO), e o extrato sem o campo não toca na coluna', async () => {
    // ABSOLUTO como `charms`: a escolha do nível desce e sobe por vontade do jogador, então fundir
    // pelo maior ressuscitaria um nível que ele já tinha trocado.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).hazard).toBeNull();
    const receipts = new ReceiptStore(redis);
    const first: HazardState = { maxLevel: { gardens: 5 }, currentLevel: { gardens: 5 }, version: 1 };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), hazard: first });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).hazard).toEqual(first);

    const second: HazardState = { maxLevel: { gardens: 5 }, currentLevel: { gardens: 2 }, version: 1 };
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, hazard: second });
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    // Desceu de 5 para 2, e o extrato SEM o campo (seq 3) não apaga o que o anterior gravou.
    expect((await characterRow(database, characterId)).hazard).toEqual(second);
  });

  it('o extrato SÓ de hazard e o de estado da Cidade não se sobrescrevem: todos os pendentes chegam ao ledger, na ordem do seq', async () => {
    // Antes do #823 o `ReceiptStore` guardava um extrato por `(sessionId, characterId)`, e o de hazard
    // ia num fluxo próprio (`<sessionId>:hazard`) para nunca sobrescrever o extrato de estado da
    // Cidade (que carrega valor que só sai uma vez: o gold de uma compra). Agora a chave leva o `seq`:
    // as três escolhas de hazard NÃO se apagam mais (cada uma é uma linha do ledger), e o fluxo próprio
    // sobrou como separação, não como proteção.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    await database.database.db.update(characters).set({ gold: 10_000 }).where(eq(characters.id, characterId));
    const receipts = new ReceiptStore(redis);
    const city = randomUUID();
    const zero = {
      durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0, itemsLooted: 0,
      suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0, damageDealt: 0, healingDone: 0,
    };
    const choice = (seq: number, level: number) => ({
      ...receiptOf(`${city}:hazard`, characterId), seq, aggregates: zero, notableEvents: [],
      hazard: { maxLevel: { gardens: 3 }, currentLevel: { gardens: level }, version: 1 } satisfies HazardState,
    });
    // Três escolhas seguidas: cada uma é um extrato próprio (a chave leva o `seq`), na ordem em que saíram.
    await receipts.save(choice(2, 2));
    await receipts.save(choice(3, 3));
    await receipts.save(choice(4, 1));
    // E o extrato de estado do logout, com a compra, na chave do personagem.
    await receipts.save({
      ...receiptOf(city, characterId), seq: 5, aggregates: { ...zero, goldSpent: 2_500 }, notableEvents: [],
      blessings: 1, hazard: { maxLevel: { gardens: 3 }, currentLevel: { gardens: 1 }, version: 1 },
    });

    expect(await receipts.pendingFor(characterId)).toHaveLength(4);
    expect(await writePendingReceipts({ database: database.database.db, receipts, logger, progression }))
      .toEqual({ written: 4, failed: 0 });

    expect(await characterRow(database, characterId)).toMatchObject({
      gold: 7_500, blessings: 1, hazard: { currentLevel: { gardens: 1 } },
    });
    expect(await countLedgerRows(database.database.db, city)).toBe(1);
    expect(await countLedgerRows(database.database.db, `${city}:hazard`)).toBe(3);
    expect(await receipts.pendingFor(characterId)).toEqual([]);
  });

  it('ponta a ponta: uma compra pendente e várias escolhas de hazard na Cidade — o gold e o registro chegam inteiros (host → Redis → ledger)', async () => {
    // O defeito que o review do #897 achou: cada `set-hazard-level` gravava o extrato de estado inteiro
    // na MESMA chave do `ReceiptStore`, e o segundo apagava o primeiro — e com ele o débito da compra.
    // Desde o #823 a chave leva o `seq` e nada se apaga: as duas escolhas, mais o logout, chegam as três.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const [owner] = await database.database.db.select({ accountId: characters.accountId })
      .from(characters).where(eq(characters.id, characterId));
    if (owner === undefined) throw new Error('Missing test character');
    await database.database.db.update(characters).set({ gold: 10_000 }).where(eq(characters.id, characterId));
    const receipts = new ReceiptStore(redis);
    const content = testContent();
    const hazard: Hazard = {
      id: 'baseline', criticalIntervalMs: 2000, criticalChance: 750, criticalMultiplier: 25,
      damageMultiplier: 200, defenseMultiplier: 0, dodgeMultiplier: 85, expBonusMultiplier: 2,
      lootBonusMultiplier: 2, podDropMultiplier: 87, plunderSpawnMultiplier: 25,
      zones: {
        gardens: {
          name: 'Gnomprona Gardens', minLevel: 1, maxLevel: 12,
          crit: true, dodge: true, damageBoost: true, defenseBoost: true,
        },
      },
    };
    const zone = hazard.zones['gardens'] as Hazard['zones'][string];
    const host = new SessionHost({
      nodeId: 'hazard-e2e', contentVersion: content.version, logger, receipts, hazard,
      createSession: createCitySessionFactory(content),
    });
    await host.prepare(characterId, undefined, owner.accountId);
    const hero = host.sessionFor(characterId)?.participants[0] as CharacterRuntime;
    for (let level = 1; level < 3; level += 1) { // o teto desbloqueado: 3
      hero.hazard.select('gardens', zone, level);
      hero.hazard.levelUp('gardens', zone);
    }
    const viewer = host.attach(new FakeSocket(), characterId);
    host.flush();

    // Uma compra feita na praça (o que `buy-blessing` deixa): 2 500 debitados e a bênção marcada,
    // ainda não liquidados — só o extrato de estado do logout os leva.
    hero.goldDelta = -2_500;
    hero.blessings = 1;
    host.handle(viewer, { type: 'set-fight-mode', mode: 'defense' }); // suja o personagem, como a compra
    host.handle(viewer, { type: 'set-hazard-level', zoneId: 'gardens', level: 2 });
    host.handle(viewer, { type: 'set-hazard-level', zoneId: 'gardens', level: 3 });
    host.handle(viewer, { type: 'set-hazard-level', zoneId: 'gardens', level: 2 });
    // 3 → 2 (a primeira escolha, 2, é a que já estava, e não grava): duas escolhas, dois extratos.
    await vi.waitFor(async () => { expect(await receipts.pendingFor(characterId)).toHaveLength(2); });
    // Antes da varredura (que roda a cada 10 s): o logout grava o extrato de estado.
    await host.release(characterId, 1_000, 'logout');
    expect(await receipts.pendingFor(characterId)).toHaveLength(3);

    expect(await writePendingReceipts({ database: database.database.db, receipts, logger, progression }))
      .toEqual({ written: 3, failed: 0 });
    expect(await characterRow(database, characterId)).toMatchObject({
      gold: 7_500, blessings: 1,
      hazard: { maxLevel: { gardens: 3 }, currentLevel: { gardens: 2 } },
    });
  });
});

describe.runIf(ready)('pontos de alma chegam ao Postgres pelo extrato (#593)', () => {
  it('nasce zero, a última escrita vence, e o extrato sem o campo não toca na coluna', async () => {
    // Como a munição: ABSOLUTO, última-escrita-vence — NUNCA fundido por máximo. Diferente da
    // munição, aqui o valor pode DESCER de verdade (gasto de conjuração), e é exatamente esse
    // caso que a segunda gravação abaixo prova: 30 depois de 80 teria "voltado" se o ledger
    // fundisse pelo maior, como faz com skill e Bestiário.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).soul).toBe(0);

    const receipts = new ReceiptStore(redis);
    await receipts.save({ ...receiptOf(randomUUID(), characterId), soul: 80 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).soul).toBe(80);

    // Gasto em conjuração: o extrato seguinte leva um número MENOR, e a coluna precisa DESCER
    // com ele — a régua oposta da de skill/Bestiário, que nunca aceitam um valor menor.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, soul: 65 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).soul).toBe(65);

    // Extrato de Cidade (sem o campo) não toca na coluna — o personagem não escolheu vocação
    // nem lançou nada ali, e `65` continua sendo o último valor de verdade.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).soul).toBe(65);
  });

  it('ida e volta: chooseVocation enche a alma → sessão encerra → extrato (parseReceipt) → ledger → banco', async () => {
    // Prova a issue #593 ponta a ponta: `CharacterRuntime.chooseVocation` (o `sim`) enche a
    // alma pela primeira vez, a sessão emite o extrato de verdade (`session.end`), o extrato
    // passa pelo Redis — serializado e reconstruído por `parseReceipt`, a lista de PERMISSÃO —,
    // o `jobs` credita, e o valor bate no Postgres.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const vocation: Vocation = {
      id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25,
      spellSkill: 'magic', startingKit: [], skillMultipliers: {},
      meleeDamageMultiplier: 1, distDamageMultiplier: 1, soulMax: 100, soulGainTicksMs: 120_000,
    };

    const sessionId = randomUUID();
    const content = testContent();
    const session = createHuntSession({
      id: sessionId, huntId: TEST_HUNT.id, difficulty: 'cautious', content, createdAtMs: 0,
    });
    const character = new CharacterRuntime({
      id: characterId, position: { x: 1, y: 1, z: 7 },
      health: 100, maxHealth: 100, mana: 0, maxMana: 0,
      level: 8, xp: 0, vocationId: null,
      staminaMs: null, staminaUpdatedAtMs: 0,
      gold: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(character);

    const result = character.chooseVocation(vocation, null, {
      catalog: content.items, vocationLevel: 8, instanceId: `${sessionId}:${characterId}:vocation`,
      rules: { backpackSlots: 0, satchelSlots: 0, row: 1 },
    });
    expect(result.ok).toBe(true);
    expect(character.soul).toBe(100);

    const [receipt] = session.end('manual-exit');
    if (receipt === undefined) throw new Error('a sessão não emitiu extrato');

    const receipts = new ReceiptStore(redis);
    await receipts.save({
      sessionId, characterId, accountId: 'a1', reason: receipt.reason, seq: receipt.seq,
      aggregates: receipt.aggregates, notableEvents: receipt.notableEvents, soul: character.soul,
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).soul).toBe(100);
  });
});

describe.runIf(ready)('as sete bênçãos chegam ao Postgres pelo extrato, e a morte nunca ressuscita pelo merge (#570)', () => {
  it('nasce zero, a última escrita vence, e o extrato sem o campo não toca na coluna', async () => {
    // Como a alma (#593): ABSOLUTO, última-escrita-vence — NUNCA fundido por máximo. A morte
    // consome TODAS as bênçãos de uma vez (`character.blessings = 0`), e é exatamente esse caso
    // que a segunda gravação prova: 0 depois de 127 tem que PERSISTIR — se o ledger fundisse
    // pelo maior, como faz com skill/Bestiário, a bênção consumida ressuscitaria no Postgres.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).blessings).toBe(0);

    const receipts = new ReceiptStore(redis);
    // 0b1111111 = 127: as sete bênçãos, todos os bits ligados.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), blessings: 127 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).blessings).toBe(127);

    // A morte: o extrato seguinte leva ZERO, e a coluna precisa DESCER com ele.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, blessings: 0 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).blessings).toBe(0);

    // Extrato de Cidade sem o campo (nada mudou ali) não toca na coluna.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).blessings).toBe(0);
  });

  it('compra na Cidade: uma bênção só sobe a coluna, e o extrato seguinte não a derruba', async () => {
    // O caminho de COMPRA (`#requestBuyBlessing`, host.ts): sobe de 0 para uma bênção, e o
    // extrato seguinte sem mudança nenhuma preserva o valor — última-escrita-vence não é
    // "sempre reescreve", é "quando o extrato TEM o campo".
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save({ ...receiptOf(randomUUID(), characterId), blessings: 0b0000001 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).blessings).toBe(1);

    // Comprou uma segunda bênção: o bitmask sobe para 0b0000011.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, blessings: 0b0000011 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).blessings).toBe(0b0000011);
  });
});

describe.runIf(ready)('a postura de luta atravessa o banco: extrato → coluna → ticket → sessão (#550, M30-03)', () => {
  const fightModeOf = async (database: NonNullable<typeof db>, characterId: string): Promise<string> => {
    const [row] = await database.database.db
      .select({ fightMode: characters.fightMode }).from(characters).where(eq(characters.id, characterId));
    if (row === undefined) throw new Error('personagem não encontrado');
    return row.fightMode;
  };

  it('todo personagem nasce na ofensiva — o `FIGHTMODE_ATTACK` do Canary, o que ele já vivia', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect(await fightModeOf(database, characterId)).toBe('attack');
    const repository = new DrizzleGameRepository(database.database.db);
    expect((await repository.getCharacterById(characterId))?.fightMode).toBe('attack');
  });

  it('a última escrita vence, em qualquer direção — e o extrato sem o campo não toca na coluna', async () => {
    // ABSOLUTA, como as bênçãos: não há ordem entre os três modos, então NADA de fusão por
    // máximo. Mutação que mata: `greatest`/`coalesce` no ledger — a defensiva não voltaria à
    // ofensiva, ou a primeira escrita ficaria para sempre.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const flush = () => writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    await receipts.save({ ...receiptOf(randomUUID(), characterId), fightMode: 'defense' });
    await flush();
    expect(await fightModeOf(database, characterId)).toBe('defense');

    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, fightMode: 'balanced' });
    await flush();
    expect(await fightModeOf(database, characterId)).toBe('balanced');

    // De volta à ofensiva: o `attack` também É uma escolha e persiste (não é "ausente").
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3, fightMode: 'attack' });
    await flush();
    expect(await fightModeOf(database, characterId)).toBe('attack');

    // Extrato de Cidade sem o campo (nada mudou ali, ou nó anterior à issue): nenhuma escrita.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 4, fightMode: 'defense' });
    await flush();
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 5 });
    await flush();
    expect(await fightModeOf(database, characterId)).toBe('defense');
  });

  it('volta pelo ticket: a coluna vira `initialCharacter.fightMode`, que o `CharacterRuntime` lê', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save({ ...receiptOf(randomUUID(), characterId), fightMode: 'balanced' });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    const repository = new DrizzleGameRepository(database.database.db);
    const character = await repository.getCharacterById(characterId);
    if (character === null) throw new Error('the seeded character is missing');
    const initial = initialCharacterOf(character, await repository.listItemInstances(characterId));
    expect(initial.fightMode).toBe('balanced');
    const runtime = createCitySessionFactory(testContent())(characterId, initial).participants[0];
    expect(runtime?.fightMode).toBe('balanced');
  });

  it('o banco recusa um modo fora dos três — o CHECK vale mesmo se um caminho novo de escrita esquecer', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    await expect(database.database.db.update(characters)
      .set({ fightMode: 'aggressive' }).where(eq(characters.id, characterId)))
      .rejects.toThrow();
    expect(await fightModeOf(database, characterId)).toBe('attack');
  });

  it('uma sessão de verdade que teve a postura trocada a grava ponta a ponta (host → extrato → ledger)', async () => {
    // O contrato isolado está acima; este é o caminho real — `CharacterRuntime` → `#receiptFor` →
    // `receipts.save` → o MESMO `writePendingReceipts` — sem simular o extrato à mão.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const [owner] = await database.database.db.select({ accountId: characters.accountId })
      .from(characters).where(eq(characters.id, characterId));
    if (owner === undefined) throw new Error('Missing test character');
    const receipts = new ReceiptStore(redis);
    const content = testContent();
    const session = createHuntSession({
      id: randomUUID(), content, huntId: TEST_HUNT.id, difficulty: 'cautious', createdAtMs: 0,
    });
    const character = createCitySessionFactory(content)(characterId).participants[0];
    if (character === undefined) throw new Error('Missing test runtime');
    session.enter(character);
    const host = new SessionHost({
      nodeId: 'fight-mode-test', contentVersion: content.version, logger, receipts,
      createSession: () => session,
    });
    await host.prepare(characterId, undefined, owner.accountId);
    character.setFightMode('defense');

    expect(await host.drainAll()).toBe(1);
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    expect(await fightModeOf(database, characterId)).toBe('defense');
  });
});

describe.runIf(ready)('o estoque de supply/munição do loot chega ao Postgres pelo extrato, e drenar até zero PERSISTE (#520, revisão do #536)', () => {
  it('loot (+N) grava a coluna, e uma sessão que esgota o estoque grava {} em vez de deixar a coluna intocada', async () => {
    // O achado [blocker] da revisão: `supplyStock`/`ammunitionStock`, ao contrário de `ammo`
    // (só cresce), É consumido dentro da sessão — `useSupply`/`#strike` fazem `Map.delete`. Se o
    // extrato omitisse a chave quando o Map ficasse vazio (como fazia antes desta correção), o
    // `ledger` leria "sem o campo" e NÃO tocaria a coluna (mesma regra de "extrato de Cidade não
    // apaga escolha de munição", correta para `ammo`, errada aqui) — a Postgres ficaria com o
    // valor ANTIGO, não-vazio, e o próximo login ressuscitaria um estoque já gasto (poção
    // infinita). Este teste prova as duas pontas: o crédito de loot grava a coluna, e drenar até
    // zero grava `{}` — não deixa a linha antiga sobreviver.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).supplyStock).toBeNull();
    expect((await characterRow(database, characterId)).ammunitionStock).toBeNull();
    const receipts = new ReceiptStore(redis);

    // Loot creditado numa sessão: a coluna passa a refletir o Map da sessão.
    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      supplyStock: { 'strong-health-potion': 3 },
      ammunitionStock: { 'burst-arrow': 5 },
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).supplyStock)
      .toEqual({ 'strong-health-potion': 3 });
    expect((await characterRow(database, characterId)).ammunitionStock)
      .toEqual({ 'burst-arrow': 5 });

    // A sessão seguinte gasta as 3 poções e as 5 flechas: o Map fica vazio, e o extrato PRECISA
    // gravar `{}` — não omitir o campo — para a linha do Postgres não ficar com o `{ 'strong-
    // health-potion': 3 }` de antes.
    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      seq: 2,
      supplyStock: {},
      ammunitionStock: {},
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).supplyStock).toEqual({});
    expect((await characterRow(database, characterId)).ammunitionStock).toEqual({});

    // Um extrato de Cidade (sem o campo — o personagem nem entrou em hunt) continua sem tocar a
    // coluna: `{}` gravado acima sobrevive.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).supplyStock).toEqual({});
    expect((await characterRow(database, characterId)).ammunitionStock).toEqual({});
  });

  it('uma sessão de verdade (createHuntSession) que drena o estoque no `useSupply` grava a coluna vazia, ponta a ponta', async () => {
    // O teste acima cobre o contrato do `ledger` isolado; este cobre o caminho real —
    // `CharacterRuntime.getState()` (character.ts) -> `#persistReceipt` (host.ts) -> o mesmo
    // `writePendingReceipts` — sem simular o extrato à mão, para pegar uma regressão em
    // qualquer um dos três elos, não só no `ledger`.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const [owner] = await database.database.db.select({ accountId: characters.accountId })
      .from(characters).where(eq(characters.id, characterId));
    if (owner === undefined) throw new Error('Missing test character');
    const receipts = new ReceiptStore(redis);
    const content = testContent();
    const sessionId = randomUUID();
    const session = createHuntSession({
      id: sessionId, content, huntId: TEST_HUNT.id, difficulty: 'cautious', createdAtMs: 0,
    });
    const character = createCitySessionFactory(content)(characterId).participants[0];
    if (character === undefined) throw new Error('Missing test runtime');
    character.supplyStock.set('strong-health-potion', 1);
    session.enter(character);
    const host = new SessionHost({
      nodeId: 'stock-drain-test', contentVersion: content.version, logger, receipts,
      createSession: () => session,
    });
    await host.prepare(characterId, undefined, owner.accountId);
    expect((await characterRow(database, characterId)).supplyStock).toBeNull();

    // Gasta a única poção — o Map da sessão fica vazio.
    character.supplyStock.delete('strong-health-potion');

    expect(await host.drainAll()).toBe(1);
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    expect((await characterRow(database, characterId)).supplyStock).toEqual({});
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

describe.runIf(ready)('a promoção chega ao Postgres pelo extrato, e nunca desce (#566, ADR 0042 decisão 1)', () => {
  it('grava true; um extrato sem o campo não desliga; um segundo extrato true não muda nada', async () => {
    // `OR`, não `coalesce`: mutação que mata é trocar por atribuição direta com um extrato
    // AUSENTE (nunca acontece de verdade — `promoted` só viaja `true` — mas provaria que a
    // coluna desceria se algum dia um extrato chegasse com `false`).
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    expect((await characterRow(database, characterId)).promoted).toBe(false);
    const receipts = new ReceiptStore(redis);

    await receipts.save({ ...receiptOf(randomUUID(), characterId) });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).promoted).toBe(false);

    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2, promoted: true });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).promoted).toBe(true);

    // Um extrato fora de ordem SEM o campo (a Cidade, quando o personagem só mexeu em
    // equipamento) não pode reverter a promoção já gravada.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3 });
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 4, promoted: true });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await characterRow(database, characterId)).promoted).toBe(true);
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

describe.runIf(ready)('o overlay por instância atravessa o banco (#604, ADR 0046)', () => {
  const imbued = { imbuements: [{ slot: 0, typeId: 'vampirism-basic', remainingMs: 72_000_000 }] };
  const overlayOf = async (database: NonNullable<typeof db>, id: string) => {
    const [row] = await database.database.db
      .select({ overlay: itemInstances.overlay }).from(itemInstances).where(eq(itemInstances.id, id));
    return row?.overlay;
  };

  it('extrato → item_instance.overlay → ticket → Inventory: o mesmo overlay volta', async () => {
    // Mutação que mata: tirar `applyOverlays` do `applyProgression`, esquecer `overlays` na
    // lista de permissão do `ReceiptStore`, ou o ticket não ler a coluna.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const other = await seedCharacter(database);
    const repository = new DrizzleGameRepository(database.database.db);
    const sword = (await repository.createItemInstance({ itemId: 'spike-sword', ownerCharacterId: characterId, origin: 'loot' })).id;
    const rock = (await repository.createItemInstance({ itemId: 'rock', ownerCharacterId: characterId, origin: 'loot' })).id;
    const alien = (await repository.createItemInstance({ itemId: 'rock', ownerCharacterId: other, origin: 'loot' })).id;
    // A linha nasce sem overlay: a migração é aditiva, `null` é "igual à definição".
    expect(await overlayOf(database, sword)).toBeNull();
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(randomUUID(), characterId),
      overlays: { [sword]: imbued, [rock]: null, [alien]: imbued },
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect(await overlayOf(database, sword)).toEqual(imbued);
    expect(await overlayOf(database, rock)).toBeNull();
    // Escopado por dono: o id alheio no extrato não escreve nada.
    expect(await overlayOf(database, alien)).toBeNull();

    // E volta pelo ticket até o `Inventory` do `sim`, igual.
    const character = await repository.getCharacterById(characterId);
    if (character === null) throw new Error('the seeded character is missing');
    const initial = initialCharacterOf(character, await repository.listItemInstances(characterId));
    const inventory = Inventory.fromState(initial.inventory as InventoryState);
    const carried = [...inventory.items()];
    expect(carried.find((item) => item.instanceId === sword)?.overlay).toEqual(imbued);
    expect(carried.find((item) => item.instanceId === rock)).not.toHaveProperty('overlay');

    // Extrato SEM `overlays` (nó anterior, Cidade): nada muda.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect(await overlayOf(database, sword)).toEqual(imbued);

    // `null` apaga: o imbuement venceu na sessão, e a peça volta a ser igual à definição.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 3, overlays: { [sword]: null } });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect(await overlayOf(database, sword)).toBeNull();
  });
});

describe.runIf(ready)('storages por personagem atravessam o banco (#731, ADR 0050 d.6)', () => {
  const storagesOf = async (database: NonNullable<typeof db>, characterId: string) => {
    const rows = await database.database.db
      .select({ storageKey: characterStorages.storageKey, value: characterStorages.value })
      .from(characterStorages)
      .where(eq(characterStorages.characterId, characterId));
    return new Map(rows.map((row) => [row.storageKey, row.value]));
  };

  it('extrato → character_storage → ticket → CharacterRuntime: o mesmo valor volta', async () => {
    // Mutação que mata: tirar `applyStorages` do `applyProgression`, esquecer `storages` na
    // lista de permissão do `ReceiptStore`, ou o ticket não ler a tabela.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const other = await seedCharacter(database);
    const repository = new DrizzleGameRepository(database.database.db);
    const sessionId = randomUUID();

    // Ninguém setou nada ainda: nenhuma linha.
    expect((await storagesOf(database, characterId)).size).toBe(0);
    const receipts = new ReceiptStore(redis);

    await receipts.save({
      ...receiptOf(sessionId, characterId),
      storages: { 'quest:rat-cellars': 1, 'quest:progress': 0 },
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect(await storagesOf(database, characterId)).toEqual(new Map([
      ['quest:rat-cellars', 1], ['quest:progress', 0],
    ]));
    // Escopado por dono: o personagem alheio não ganha linha nenhuma.
    expect((await storagesOf(database, other)).size).toBe(0);

    // E volta pelo ticket até o `CharacterRuntime` do `sim`, igual.
    const character = await repository.getCharacterById(characterId);
    if (character === null) throw new Error('the seeded character is missing');
    const initial = initialCharacterOf(
      character, await repository.listItemInstances(characterId),
      await repository.listCharacterStorages(characterId),
    );
    expect(initial.storages).toEqual({ 'quest:rat-cellars': 1, 'quest:progress': 0 });

    // Extrato SEM `storages` (nó anterior, Cidade sem interativo tocado): nada muda.
    await receipts.save({ ...receiptOf(randomUUID(), characterId), seq: 2 });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect((await storagesOf(database, characterId)).get('quest:rat-cellars')).toBe(1);

    // O extrato manda o mapa INTEIRO (não um patch): a chave que sai dele some do banco — é
    // como um storage voltar a -1 (nunca setado) se torna real fora da sessão.
    await receipts.save({
      ...receiptOf(randomUUID(), characterId), seq: 3, storages: { 'quest:progress': 0 },
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    const afterDrop = await storagesOf(database, characterId);
    expect(afterDrop.has('quest:rat-cellars')).toBe(false);
    expect(afterDrop.get('quest:progress')).toBe(0);

    // Retry do MESMO extrato (mesmos `sessionId`/`seq`) não duplica linha nem escreve de novo —
    // a `UNIQUE (session_id, seq)` do ledger (invariante 10) faz `writeReceipts` recusar o
    // segundo antes de chegar em `applyStorages`.
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
    await receipts.save({
      ...receiptOf(sessionId, characterId),
      storages: { 'quest:rat-cellars': 1, 'quest:progress': 0 },
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
    expect(await storagesOf(database, characterId)).toEqual(new Map([['quest:progress', 0]]));
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

describe.runIf(ready)('sell-items/discard-item apagam a instância no ledger (#724, ADR 0048 d.8)', () => {
  it('apaga a instância vendida/descartada na MESMA transação da linha de ledger', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const instanceId = `${sessionId}:0`;

    await database.database.db.insert(itemInstances).values({
      id: instanceId, itemId: 'spike-sword', ownerCharacterId: characterId, origin: 'loot',
    });

    await receipts.save({
      ...receiptOf(sessionId, characterId),
      removedInstances: [instanceId],
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    const [row] = await database.database.db
      .select({ id: itemInstances.id })
      .from(itemInstances)
      .where(eq(itemInstances.id, instanceId));
    expect(row).toBeUndefined();
  });

  it('reprocessar o mesmo extrato apaga zero linhas na segunda vez — retry não é erro', async () => {
    // A chave única do ledger (`session_id`, `seq`) já barra o extrato repetido antes de chegar
    // aqui; o `DELETE` escopado por id É idempotente por conta própria, para o caso de uma
    // reconciliação futura reprocessar o mesmo extrato por outro caminho.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const instanceId = `${sessionId}:0`;

    await database.database.db.insert(itemInstances).values({
      id: instanceId, itemId: 'spike-sword', ownerCharacterId: characterId, origin: 'loot',
    });

    await receipts.save({ ...receiptOf(sessionId, characterId), removedInstances: [instanceId] });
    const primeira = await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });
    // O mesmo extrato de novo, com outra chave — a chave única do ledger não é o que este
    // teste prova; o `DELETE` sozinho, contra uma linha que já não existe, não pode falhar.
    await receipts.save({
      ...receiptOf(randomUUID(), characterId), seq: 2, removedInstances: [instanceId],
    });
    const segunda = await writePendingReceipts({
      database: database.database.db, receipts, logger, progression,
    });

    expect(primeira).toEqual({ written: 1, failed: 0 });
    expect(segunda).toEqual({ written: 1, failed: 0 });
  });

  it('não apaga instância de outro personagem, mesmo que o extrato cite o id dela', async () => {
    // Escopado por DONO, como `applyLayout`/`applyEquipment`: um extrato não apaga item de
    // outra conta.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const outroId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const instanceId = `${sessionId}:0`;

    await database.database.db.insert(itemInstances).values({
      id: instanceId, itemId: 'spike-sword', ownerCharacterId: outroId, origin: 'loot',
    });

    await receipts.save({
      ...receiptOf(sessionId, characterId),
      removedInstances: [instanceId],
    });
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    const [row] = await database.database.db
      .select({ id: itemInstances.id })
      .from(itemInstances)
      .where(eq(itemInstances.id, instanceId));
    expect(row?.id).toBe(instanceId);
  });

  it('a MORTE com perda de item (#571): apaga o que caiu, entrega a bag, audita no ledger e não duplica', async () => {
    // O que `HuntRuleset#onCharacterDied` produz quando o bloco `itemLoss` está ligado: as
    // instâncias perdidas em `removedInstances`, a bag nova em `acquired` (origem própria) já
    // vestida em `equipment`, e um evento notável por instância no `ref` da linha de ledger —
    // a trilha de auditoria. Tudo na MESMA transação, atrás de `UNIQUE (session_id, seq)`.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const bag = `${sessionId}:0`;

    await database.database.db.insert(itemInstances).values([
      { id: 'lost:backpack', itemId: 'backpack', ownerCharacterId: characterId, origin: 'starting-kit', equippedSlot: 'back' },
      { id: 'lost:armor', itemId: 'plate', ownerCharacterId: characterId, origin: 'loot', equippedSlot: 'chest' },
      { id: 'lost:inside', itemId: 'spike-sword', ownerCharacterId: characterId, origin: 'loot', container: 'backpack', slotIndex: 0 },
      { id: 'kept:satchel', itemId: 'spike-sword', ownerCharacterId: characterId, origin: 'loot', container: 'satchel', slotIndex: 0 },
    ]);
    const death = {
      ...receiptOf(sessionId, characterId),
      reason: 'death' as const,
      notableEvents: [
        { atMs: 10, type: 'death', detail: characterId },
        { atMs: 10, type: 'item-lost-on-death', detail: `backpack/1/lost:backpack/${characterId}` },
        { atMs: 10, type: 'item-lost-on-death', detail: `spike-sword/1/lost:inside/${characterId}` },
        { atMs: 10, type: 'item-lost-on-death', detail: `plate/1/lost:armor/${characterId}` },
        { atMs: 10, type: 'backpack-replaced', detail: 'bag' },
      ],
      acquired: [{ instanceId: bag, itemId: 'bag', quantity: 1, origin: 'death-replacement' as const }],
      removedInstances: ['lost:backpack', 'lost:inside', 'lost:armor'],
      equipment: { back: bag },
      layout: { 'kept:satchel': { container: 'satchel' as const, index: 0 } },
    };

    await receipts.save(death);
    expect(await writePendingReceipts({ database: database.database.db, receipts, logger, progression }))
      .toEqual({ written: 1, failed: 0 });

    const rows = await database.database.db
      .select({
        id: itemInstances.id, origin: itemInstances.origin, slot: itemInstances.equippedSlot,
      })
      .from(itemInstances)
      .where(eq(itemInstances.ownerCharacterId, characterId))
      .orderBy(asc(itemInstances.id));
    expect(rows).toEqual([
      { id: bag, origin: 'death-replacement', slot: 'back' },
      { id: 'kept:satchel', origin: 'loot', slot: null },
    ]);
    // A auditoria: uma linha de ledger, com um evento `item-lost-on-death` por instância perdida.
    const [row] = await database.database.db.select({ ref: ledger.ref }).from(ledger)
      .where(eq(ledger.sessionId, sessionId));
    const events = (row?.ref as { notableEvents: { type: string; detail?: string }[] }).notableEvents;
    expect(events.filter((event) => event.type === 'item-lost-on-death').map((event) => event.detail))
      .toEqual([
        `backpack/1/lost:backpack/${characterId}`,
        `spike-sword/1/lost:inside/${characterId}`,
        `plate/1/lost:armor/${characterId}`,
      ]);

    // Retry do MESMO extrato (mesmo `(session_id, seq)`): a chave única o torna operação nula —
    // a bag não é inserida de novo e nada mais é apagado.
    await receipts.save(death);
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
    const again = await database.database.db
      .select({ id: itemInstances.id })
      .from(itemInstances)
      .where(eq(itemInstances.ownerCharacterId, characterId));
    expect(again.map((r) => r.id).sort()).toEqual([bag, 'kept:satchel'].sort());
  });

  it('extrato SEM `removedInstances` não toca a tabela', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const instanceId = `${sessionId}:0`;

    await database.database.db.insert(itemInstances).values({
      id: instanceId, itemId: 'spike-sword', ownerCharacterId: characterId, origin: 'loot',
    });

    await receipts.save(receiptOf(sessionId, characterId));
    await writePendingReceipts({ database: database.database.db, receipts, logger, progression });

    const [row] = await database.database.db
      .select({ id: itemInstances.id })
      .from(itemInstances)
      .where(eq(itemInstances.id, instanceId));
    expect(row?.id).toBe(instanceId);
  });
});

// A ordem dos extratos de UM personagem (#823, OW-02, ADR 0060 decisão 10e). Três garantias:
// nenhum extrato apaga outro (a chave leva o `seq`), a liquidação segue a versão (não o `SCAN`),
// e nenhum extrato atrasado desfaz estado mais novo (a guarda de `durable_version`).
describe('a ordem dos extratos de um personagem (#823, OW-02)', () => {
  const orderOf = (...versions: Array<number | undefined>) => versions.map((durableVersion, index) => ({
    characterId: 'c', sessionId: `s${index}`, seq: index, endedAtMs: index, durableVersion,
  }) as unknown as SessionReceipt);

  it('agrupa por personagem e ordena cada grupo pela versão', () => {
    const a = { ...orderOf(3)[0], characterId: 'a', sessionId: 'a3' } as SessionReceipt;
    const b = { ...orderOf(1)[0], characterId: 'b', sessionId: 'b1' } as SessionReceipt;
    const a1 = { ...orderOf(1)[0], characterId: 'a', sessionId: 'a1' } as SessionReceipt;
    const a2 = { ...orderOf(2)[0], characterId: 'a', sessionId: 'a2' } as SessionReceipt;

    const groups = groupByCharacter([a, b, a2, a1]);

    expect(groups.map((group) => group.map((receipt) => receipt.sessionId))).toEqual([
      ['a1', 'a2', 'a3'], ['b1'],
    ]);
  });

  it('põe o extrato SEM versão entre os versionados pelo relógio, nunca à frente de um mais velho', () => {
    // Mutação que mata: deixar os sem versão sempre primeiro. Um nó anterior gravou o de tempo 5,
    // depois do versionado de tempo 2 — e o versionado de tempo 9 é mais novo que os dois.
    const old = { characterId: 'c', sessionId: 'v', seq: 1, endedAtMs: 2, durableVersion: 4 } as SessionReceipt;
    const legacy = { characterId: 'c', sessionId: 'u', seq: 1, endedAtMs: 5 } as SessionReceipt;
    const newest = { characterId: 'c', sessionId: 'n', seq: 1, endedAtMs: 9, durableVersion: 6 } as SessionReceipt;

    const [group] = groupByCharacter([newest, legacy, old]);

    expect(group?.map((receipt) => receipt.sessionId)).toEqual(['v', 'u', 'n']);
  });
});

describe.runIf(ready)('extrato atrasado não desfaz estado mais novo (#823, OW-02, ADR 0060 decisão 10e)', () => {
  const sweepOf = (database: NonNullable<typeof db>, receipts: ReceiptStore) => ({
    database: database.database.db, receipts, logger, progression,
  });
  const versionOf = async (database: NonNullable<typeof db>, characterId: string): Promise<number> => {
    const [row] = await database.database.db
      .select({ version: characters.durableVersion })
      .from(characters)
      .where(eq(characters.id, characterId));
    if (row === undefined) throw new Error('personagem não encontrado');
    return row.version;
  };
  /** Os campos ABSOLUTOS que a guarda protege, como o banco os tem. */
  const absolutesOf = async (database: NonNullable<typeof db>, characterId: string) => {
    const [row] = await database.database.db
      .select({
        blessings: characters.blessings, soul: characters.soul, supplyStock: characters.supplyStock,
        ammunitionStock: characters.ammunitionStock, ammo: characters.ammo, fedMs: characters.fedMs,
        charms: characters.charms, fightMode: characters.fightMode, skills: characters.skills,
        staminaMs: characters.staminaMs,
      })
      .from(characters)
      .where(eq(characters.id, characterId));
    return row;
  };
  const seedSword = async (database: NonNullable<typeof db>, characterId: string): Promise<string> => {
    const created = await new DrizzleGameRepository(database.database.db).createItemInstance({
      itemId: 'spike-sword', ownerCharacterId: characterId, origin: 'loot',
    });
    return created.id;
  };
  const storagesOf = async (database: NonNullable<typeof db>, characterId: string) => {
    const rows = await database.database.db
      .select({ storageKey: characterStorages.storageKey, value: characterStorages.value })
      .from(characterStorages)
      .where(eq(characterStorages.characterId, characterId));
    return new Map(rows.map((row) => [row.storageKey, row.value]));
  };
  const slotOf = async (database: NonNullable<typeof db>, instanceId: string) => {
    const [row] = await database.database.db
      .select({ slot: itemInstances.equippedSlot, container: itemInstances.container, index: itemInstances.slotIndex })
      .from(itemInstances)
      .where(eq(itemInstances.id, instanceId));
    return row;
  };

  it('dois extratos do MESMO par (seq 1 e 2), antes da liquidação: os dois liquidam', async () => {
    // Mutação que mata: a chave do extrato sem o `seq` — o segundo sobrescrevia o primeiro e
    // um dos dois créditos se perdia antes de chegar ao ledger.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    await receipts.save(receiptOf(sessionId, characterId, { seq: 1, durableVersion: 1 }));
    await receipts.save(receiptOf(sessionId, characterId, { seq: 2, durableVersion: 2 }));

    const result = await writePendingReceipts(sweepOf(database, receipts));

    expect(result).toEqual({ written: 2, failed: 0 });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(2);
    // 2 × (500 − 120) de gold e 2 × 900 de XP: nada se perdeu.
    expect(await characterRow(database, characterId)).toMatchObject({ gold: 760, xp: 1_800 });
    expect(await versionOf(database, characterId)).toBe(2);
    expect(await redis.keys('receipt*')).toEqual([]);
  });

  it('versão 2 e DEPOIS a versão 1: o absoluto NÃO volta; o gold e a XP das duas entram', async () => {
    // É o teste de ordem inversa da issue. Mutação que mata: tirar a guarda `absolute` do
    // `applyProgression` — o extrato atrasado devolveria bênçãos, alma, estoque, equipamento,
    // layout, storages, stamina e skills que o mais novo já tinha mudado.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const sword = await seedSword(database, characterId);
    const base = Date.now();
    // O v1 é gravado DEPOIS (relógio maior): a guarda de instante de skills e stamina o deixaria
    // passar — só a versão o barra.
    const newerStore = new ReceiptStore(redis, { now: () => base + 1_000 });
    const olderStore = new ReceiptStore(redis, { now: () => base + 5_000 });
    const sessionId = randomUUID();

    await newerStore.save(receiptOf(sessionId, characterId, {
      seq: 2, durableVersion: 2,
      blessings: 0, soul: 10, supplyStock: { 'health-potion': 1 }, ammunitionStock: {},
      ammo: { arrow: 'plain-arrow' }, fedMs: 100, charms: { pointsSpent: 1, echoesSpent: 0, tiers: {}, assignments: {}, version: 1 },
      fightMode: 'defense', skills: { melee: { level: 30, points: 1 } },
      staminaMs: 5_000, staminaUpdatedAtMs: base + 1_000,
      equipment: { hand: sword }, layout: {},
      storages: { 'quest:a': 2 },
    }));
    await writePendingReceipts(sweepOf(database, newerStore));
    const afterNewest = await absolutesOf(database, characterId);
    expect(afterNewest).toMatchObject({
      blessings: 0, soul: 10, fedMs: 100, fightMode: 'defense', staminaMs: 5_000,
      supplyStock: { 'health-potion': 1 }, ammo: { arrow: 'plain-arrow' }, skills: { melee: { level: 30, points: 1 } },
    });

    await olderStore.save(receiptOf(sessionId, characterId, {
      seq: 1, durableVersion: 1,
      blessings: 0b1111111, soul: 90, supplyStock: { 'health-potion': 40 }, ammunitionStock: { 'plain-arrow': 99 },
      ammo: { arrow: 'sniper-arrow' }, fedMs: 9_000, charms: { pointsSpent: 50, echoesSpent: 9, tiers: {}, assignments: {}, version: 1 },
      fightMode: 'attack', skills: { melee: { level: 10, points: 0 } },
      staminaMs: 1, staminaUpdatedAtMs: base + 5_000,
      equipment: {}, layout: { [sword]: { container: 'backpack', index: 3 } },
      storages: { 'quest:a': 1, 'quest:b': 1 },
    }));
    const late = await writePendingReceipts(sweepOf(database, olderStore));

    expect(late).toEqual({ written: 1, failed: 0 });
    // O estado absoluto é o do extrato MAIS NOVO, inteiro.
    expect(await absolutesOf(database, characterId)).toEqual(afterNewest);
    expect(await slotOf(database, sword)).toMatchObject({ slot: 'hand', container: null, index: null });
    expect(await storagesOf(database, characterId)).toEqual(new Map([['quest:a', 2]]));
    // Mas o valor movido das duas sessões entrou: a guarda é só dos absolutos.
    expect(await characterRow(database, characterId)).toMatchObject({ gold: 760, xp: 1_800 });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(2);
    expect(await versionOf(database, characterId)).toBe(2);
  });

  it('hunt intercalada com dois extratos de estado da Cidade, liquidados na ordem INVERSA: o final é o do mais novo', async () => {
    // Cidade (v1) → hunt (v2) → Cidade (v3): três sessões, três `seq` recomeçando, um personagem.
    // Liquidados do mais novo para o mais velho, um por chamada — o pior caso de uma varredura
    // que entrega fora de ordem. Mutação que mata: tirar a guarda `absolute` do ledger.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const city1 = randomUUID();
    const hunt = randomUUID();
    const city2 = randomUUID();

    for (const [sessionId, durableVersion, blessings, soul] of [
      [city2, 3, 7, 30], [hunt, 2, 3, 20], [city1, 1, 1, 10],
    ] as const) {
      await receipts.save(receiptOf(sessionId, characterId, { seq: 1, durableVersion, blessings, soul }));
      await writePendingReceipts(sweepOf(database, receipts));
    }

    expect(await absolutesOf(database, characterId)).toMatchObject({ blessings: 7, soul: 30 });
    expect(await versionOf(database, characterId)).toBe(3);
    // O valor movido das três sessões entrou: 3 × 380 de gold e 3 × 900 de XP.
    expect(await characterRow(database, characterId)).toMatchObject({ gold: 1_140, xp: 2_700 });
    expect(await redis.keys('receipt*')).toEqual([]);
  });

  it('a varredura liquida o personagem em ordem de VERSÃO, mesmo que o Redis entregue ao contrário', async () => {
    // v1 traz o item (`acquired`) e v2 o vende (`removedInstances`). Na ordem certa ele nasce e
    // morre; na inversa o `DELETE` não acha nada e o `INSERT` o ressuscita — a mesma venda
    // pagaria o gold e devolveria a peça. É o caso em que a guarda de versão NÃO ajuda (item é
    // delta) e só a ordem de liquidação salva. Mutação que mata: tirar `groupByCharacter`.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const instanceId = `${sessionId}:0`;
    await receipts.save(receiptOf(sessionId, characterId, {
      seq: 1, durableVersion: 1, acquired: [{ instanceId, itemId: 'spike-sword', quantity: 1 }],
    }));
    await receipts.save(receiptOf(randomUUID(), characterId, {
      seq: 1, durableVersion: 2, removedInstances: [instanceId],
    }));
    const [first, second] = await receipts.pendingFor(characterId);
    if (first === undefined || second === undefined) throw new Error('faltou extrato');
    const reversed = {
      // O `SCAN` entregaria em qualquer ordem: aqui, a pior — e o índice, que a varredura consulta
      // para completar o grupo do personagem, também.
      pending: async () => [second, first],
      pendingFor: async () => [second, first],
      remove: (...args: Parameters<ReceiptStore['remove']>) => receipts.remove(...args),
    } as unknown as ReceiptStore;

    expect(await writePendingReceipts(sweepOf(database, reversed))).toEqual({ written: 2, failed: 0 });

    const left = await database.database.db
      .select({ id: itemInstances.id })
      .from(itemInstances)
      .where(eq(itemInstances.ownerCharacterId, characterId));
    expect(left).toEqual([]);
    expect(await versionOf(database, characterId)).toBe(2);
  });

  it('o ticket liquida em ordem de versão: gravados 3, 1, 2, o que sobra é o do 3', async () => {
    // `pendingFor` devolve do mais antigo ao mais novo, e a liquidação do ticket é a mesma da
    // varredura (FUN-56). Mutação que mata: o índice voltar a ser um SET.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const instanceId = `${sessionId}:0`;
    await receipts.save(receiptOf(sessionId, characterId, {
      seq: 3, durableVersion: 3, soul: 30, removedInstances: [instanceId],
    }));
    await receipts.save(receiptOf(sessionId, characterId, {
      seq: 1, durableVersion: 1, soul: 10, acquired: [{ instanceId, itemId: 'spike-sword', quantity: 1 }],
    }));
    await receipts.save(receiptOf(sessionId, characterId, { seq: 2, durableVersion: 2, soul: 20 }));

    expect(await settleCharacterProgress(characterId, sweepOf(database, receipts))).toEqual({ written: 3, failed: 0 });

    expect((await absolutesOf(database, characterId))?.soul).toBe(30);
    expect(await versionOf(database, characterId)).toBe(3);
    const left = await database.database.db
      .select({ id: itemInstances.id })
      .from(itemInstances)
      .where(eq(itemInstances.ownerCharacterId, characterId));
    expect(left).toEqual([]);
  });

  it('um extrato gravado na chave ANTIGA ainda liquida, e apaga a chave antiga', async () => {
    // Deploy em rolagem (ADR 0014): um nó `game` anterior gravou `receipt:{sessionId}:{characterId}`
    // com o SET de índice, e outro, mais antigo, `receipt:{sessionId}` sem índice nenhum. O
    // extrato sem versão segue a regra de antes: escreve os absolutos, e não mexe na versão.
    const database = db as NonNullable<typeof db>;
    const withIndex = await seedCharacter(database);
    const withoutIndex = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const indexed = randomUUID();
    const bare = randomUUID();
    await redis.set(`receipt:${indexed}:${withIndex}`, JSON.stringify({
      ...receiptOf(indexed, withIndex, { soul: 55 }), endedAtMs: 1,
    }));
    await redis.sadd(`receipts:char:${withIndex}`, `receipt:${indexed}:${withIndex}`);
    await redis.set(`receipt:${bare}`, JSON.stringify({
      ...receiptOf(bare, withoutIndex, { soul: 66 }), endedAtMs: 1,
    }));

    // O ticket acha o primeiro pelo índice antigo; a varredura acha o segundo.
    expect(await settleCharacterProgress(withIndex, sweepOf(database, receipts))).toEqual({ written: 1, failed: 0 });
    expect(await writePendingReceipts(sweepOf(database, receipts))).toEqual({ written: 1, failed: 0 });

    expect((await absolutesOf(database, withIndex))?.soul).toBe(55);
    expect((await absolutesOf(database, withoutIndex))?.soul).toBe(66);
    expect(await versionOf(database, withIndex)).toBe(0);
    expect(await countLedgerRows(database.database.db, indexed)).toBe(1);
    expect(await countLedgerRows(database.database.db, bare)).toBe(1);
    expect(await redis.keys('receipt*')).toEqual([]);
  });

  it('reprocessar não duplica — e um reprocesso com versão MAIOR também não escreve absoluto', async () => {
    // A `UNIQUE (session_id, seq)` faz o segundo processamento inteiro virar operação nula, e o
    // `return` antes de `applyProgression` é o que impede até a versão de subir.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    await receipts.save(receiptOf(sessionId, characterId, { seq: 1, durableVersion: 1, soul: 10 }));
    await writePendingReceipts(sweepOf(database, receipts));

    await receipts.save(receiptOf(sessionId, characterId, { seq: 1, durableVersion: 9, soul: 99 }));
    const again = await writePendingReceipts(sweepOf(database, receipts));

    expect(again).toEqual({ written: 1, failed: 0 });
    expect(await countLedgerRows(database.database.db, sessionId)).toBe(1);
    expect(await characterRow(database, characterId)).toMatchObject({ gold: 380, xp: 900, soul: 10 });
    expect(await versionOf(database, characterId)).toBe(1);
    expect(await redis.keys('receipt*')).toEqual([]);
  });

  it('extrato SEM versão segue a regra de antes e não mexe na coluna; o atrasado depois dele não o desfaz', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    await database.database.db.update(characters).set({ durableVersion: 5 }).where(eq(characters.id, characterId));
    const receipts = new ReceiptStore(redis);

    await receipts.save(receiptOf(randomUUID(), characterId, { blessings: 3 }));
    await writePendingReceipts(sweepOf(database, receipts));
    expect((await absolutesOf(database, characterId))?.blessings).toBe(3);
    expect(await versionOf(database, characterId)).toBe(5);

    // Versionado e ATRASADO (4 ≤ 5): entra o valor movido, não o absoluto, e a versão não desce.
    await receipts.save(receiptOf(randomUUID(), characterId, { durableVersion: 4, blessings: 127 }));
    await writePendingReceipts(sweepOf(database, receipts));
    expect((await absolutesOf(database, characterId))?.blessings).toBe(3);
    expect(await versionOf(database, characterId)).toBe(5);
    expect(await characterRow(database, characterId)).toMatchObject({ gold: 760, xp: 1_800 });

    // E um mais NOVO (6 > 5) escreve e sobe.
    await receipts.save(receiptOf(randomUUID(), characterId, { durableVersion: 6, blessings: 1 }));
    await writePendingReceipts(sweepOf(database, receipts));
    expect((await absolutesOf(database, characterId))?.blessings).toBe(1);
    expect(await versionOf(database, characterId)).toBe(6);
  });

  it('o que é monotônico por natureza entra mesmo no extrato atrasado: Bestiário, vocação e promoção', async () => {
    // A guarda é dos campos que dependem de ordem. Bestiário (máximo), vocação (`coalesce`) e
    // promoção (`OR`) dão o mesmo resultado em qualquer ordem — e um extrato atrasado que traz a
    // vocação ESCOLHIDA não pode perdê-la só por chegar tarde.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    await receipts.save(receiptOf(randomUUID(), characterId, { durableVersion: 2, bestiary: { rat: 10 } }));
    await writePendingReceipts(sweepOf(database, receipts));
    await receipts.save(receiptOf(randomUUID(), characterId, {
      durableVersion: 1, bestiary: { rat: 5, bat: 3 }, vocation: 'knight', promoted: true,
    }));
    await writePendingReceipts(sweepOf(database, receipts));

    expect(await characterRow(database, characterId)).toMatchObject({
      bestiary: { rat: 10, bat: 3 }, vocation: 'knight', promoted: true,
    });
    expect(await versionOf(database, characterId)).toBe(2);
  });

  it('ponta a ponta: ticket → host → extrato → ledger → coluna → ticket, e a versão só sobe', async () => {
    // O caminho real das três pontas do #823: o `api` monta o ticket com a coluna, o host adota
    // o piso e numera o extrato, o `jobs` o aplica e sobe a coluna, e o ticket seguinte parte
    // dali. Duas sessões do mesmo personagem, em sequência.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const repository = new DrizzleGameRepository(database.database.db);
    const [owner] = await database.database.db.select({ accountId: characters.accountId })
      .from(characters).where(eq(characters.id, characterId));
    if (owner === undefined) throw new Error('Missing test character');
    const receipts = new ReceiptStore(redis);
    const content = testContent();

    const sessionOf = async (fightMode: 'defense' | 'balanced') => {
      const row = await repository.getCharacterById(characterId);
      if (row === null) throw new Error('personagem não encontrado');
      const initial = initialCharacterOf(row, [], [], undefined, undefined, await receipts.highestPendingVersion(characterId));
      const session = createHuntSession({
        id: randomUUID(), content, huntId: TEST_HUNT.id, difficulty: 'cautious', createdAtMs: 0,
      });
      const character = createCitySessionFactory(content)(characterId).participants[0];
      if (character === undefined) throw new Error('Missing test runtime');
      session.enter(character);
      const host = new SessionHost({
        nodeId: 'durable-version-test', contentVersion: content.version, logger, receipts,
        createSession: () => session,
      });
      await host.prepare(characterId, initial, owner.accountId);
      character.setFightMode(fightMode);
      return { host, initial };
    };

    const first = await sessionOf('defense');
    expect(first.initial.durableVersion).toBe(0);
    await first.host.drainAll();
    expect((await receipts.pendingFor(characterId)).map((receipt) => receipt.durableVersion)).toEqual([1]);
    await writePendingReceipts(sweepOf(database, receipts));
    expect(await versionOf(database, characterId)).toBe(1);

    const second = await sessionOf('balanced');
    expect(second.initial.durableVersion).toBe(1);
    await second.host.drainAll();
    expect((await receipts.pendingFor(characterId)).map((receipt) => receipt.durableVersion)).toEqual([2]);
    await writePendingReceipts(sweepOf(database, receipts));
    expect(await versionOf(database, characterId)).toBe(2);
    expect((await absolutesOf(database, characterId))?.fightMode).toBe('balanced');
  });

  it('o ticket começa em max(coluna, maior versão pendente): a sessão nova nunca grava menos que um pendente', async () => {
    // Um teto de liquidação estourado deixa pendentes que a coluna ainda não viu. Mutação que
    // mata: o ticket levar só `characters.durable_version`.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const repository = new DrizzleGameRepository(database.database.db);
    const receipts = new ReceiptStore(redis);
    await receipts.save(receiptOf(randomUUID(), characterId, { durableVersion: 1, soul: 10 }));
    await writePendingReceipts(sweepOf(database, receipts));
    await receipts.save(receiptOf(randomUUID(), characterId, { durableVersion: 4 }));

    const character = await repository.getCharacterById(characterId);
    if (character === null) throw new Error('personagem não encontrado');
    expect(character.durableVersion).toBe(1);
    const initial = initialCharacterOf(character, [], [], undefined, undefined, await receipts.highestPendingVersion(characterId));

    expect(initial.durableVersion).toBe(4);
    // Sem pendência, é a coluna.
    await writePendingReceipts(sweepOf(database, receipts));
    const settled = await repository.getCharacterById(characterId);
    if (settled === null) throw new Error('personagem não encontrado');
    expect(initialCharacterOf(settled, [], [], undefined, undefined, await receipts.highestPendingVersion(characterId)).durableVersion)
      .toBe(4);
  });

  describe('extrato PARCIAL: o mais velho carrega o que o mais novo não leva', () => {
    // O achado: o extrato de hunt (v1) leva skills, stamina, comida, storages e o estoque (inclusive
    // vazio); o de estado da Cidade (v2), na forma que o hospedeiro tinha, não leva NENHUM deles. A
    // guarda de versão descarta o mais velho por inteiro quando o mais novo já foi aplicado — então
    // a ordem de liquidação do personagem é o que impede a perda, e estes testes a fixam.

    /** O banco com as primeiras `failures` transações recusadas, como uma conexão que cai. */
    const failingTransactions = (real: Database, failures: number): Database => {
      let calls = 0;
      return new Proxy(real, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (property !== 'transaction') return typeof value === 'function' ? value.bind(target) : value;
          return (...args: unknown[]) => {
            calls += 1;
            if (calls <= failures) return Promise.reject(new Error('connection reset'));
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    };

    /** A linha como ela estava ANTES da hunt: o que o extrato de hunt muda, e o de estado não sabe. */
    const OLD_SKILLS = { melee: { level: 10, points: 0 } };

    const seedHuntThenCity = async (database: NonNullable<typeof db>, receipts: ReceiptStore) => {
      const characterId = await seedCharacter(database);
      await database.database.db.update(characters).set({
        skills: OLD_SKILLS, staminaMs: 9_000_000, fedMs: 9_000, supplyStock: { 'health-potion': 40 },
        ammunitionStock: { 'plain-arrow': 99 },
      }).where(eq(characters.id, characterId));
      await database.database.db.insert(characterStorages).values({
        id: randomUUID(), characterId, storageKey: 'quest:a', value: 1,
      });
      // O relógio adiante do da linha: as guardas de INSTANTE de skills e stamina deixam o v1 passar,
      // e quem decide é só a ordem de liquidação.
      const at = Date.now() + 60_000;
      const store = new ReceiptStore(redis, { now: () => at });
      await store.save(receiptOf(randomUUID(), characterId, {
        seq: 1, durableVersion: 1,
        skills: { melee: { level: 30, points: 1 } },
        staminaMs: 1_000, staminaUpdatedAtMs: at,
        fedMs: 0,
        storages: { 'quest:a': 2 },
        supplyStock: {}, ammunitionStock: {},
      }));
      // O extrato de estado da Cidade como o hospedeiro o gravava ANTES do #823: parcial.
      await store.save(receiptOf(randomUUID(), characterId, {
        seq: 1, durableVersion: 2, soul: 30, blessings: 3,
      }));
      expect((await receipts.pendingFor(characterId)).map((receipt) => receipt.durableVersion)).toEqual([1, 2]);
      return characterId;
    };

    /** O estado que sobra quando NADA se perdeu: o da hunt, mais o que a Cidade mexeu. */
    const expectNothingLost = async (database: NonNullable<typeof db>, characterId: string) => {
      expect(await absolutesOf(database, characterId)).toMatchObject({
        skills: { melee: { level: 30, points: 1 } }, staminaMs: 1_000, fedMs: 0,
        // O estoque que a hunt ESVAZIOU não ressuscita.
        supplyStock: {}, ammunitionStock: {},
        soul: 30, blessings: 3,
      });
      expect(await storagesOf(database, characterId)).toEqual(new Map([['quest:a', 2]]));
      expect(await versionOf(database, characterId)).toBe(2);
      expect(await characterRow(database, characterId)).toMatchObject({ gold: 760, xp: 1_800 });
    };

    it('o extrato que FALHA segura o mais novo do personagem: o da hunt falha, o da Cidade espera, e nada se perde', async () => {
      // Mutação que mata: o laço de `writeReceipts` voltar a seguir adiante depois de uma falha — a
      // Cidade (v2) liquidaria na frente, e a hunt (v1) chegaria com a guarda fechada: skills, stamina,
      // comida e storages perdidos, e as poções usadas de volta no estoque.
      const database = db as NonNullable<typeof db>;
      const receipts = new ReceiptStore(redis);
      const characterId = await seedHuntThenCity(database, receipts);
      const flaky = { ...sweepOf(database, receipts), database: failingTransactions(database.database.db, 1) };

      expect(await writePendingReceipts(flaky)).toEqual({ written: 0, failed: 1 });
      // O de estado NÃO foi tentado: continua pendente, e a coluna nem se mexeu.
      expect(await versionOf(database, characterId)).toBe(0);
      expect(await receipts.pendingFor(characterId)).toHaveLength(2);

      expect(await writePendingReceipts(sweepOf(database, receipts))).toEqual({ written: 2, failed: 0 });
      await expectNothingLost(database, characterId);
    });

    it('o SCAN que acha SÓ o mais novo (teto de 200) não o liquida na frente do mais velho', async () => {
      // `pending()` corta em 200 pela ordem do `SCAN`: com fila grande o v2 chega sem o v1. A
      // varredura completa o grupo pelo índice. Mutação que mata: liquidar o que o `SCAN` entregou.
      const database = db as NonNullable<typeof db>;
      const receipts = new ReceiptStore(redis);
      const characterId = await seedHuntThenCity(database, receipts);
      const newest = (await receipts.pendingFor(characterId)).find((receipt) => receipt.durableVersion === 2);
      if (newest === undefined) throw new Error('faltou o extrato mais novo');
      const subset = {
        pending: async () => [newest],
        pendingFor: (...args: Parameters<ReceiptStore['pendingFor']>) => receipts.pendingFor(...args),
        remove: (...args: Parameters<ReceiptStore['remove']>) => receipts.remove(...args),
      } as unknown as ReceiptStore;

      expect(await writePendingReceipts(sweepOf(database, subset))).toEqual({ written: 2, failed: 0 });
      await expectNothingLost(database, characterId);
    });

    it('o ticket também segura: a liquidação do personagem para no que falhou e recusa, sem tentar o seguinte', async () => {
      // `/api/tickets` responde 503 `progress-not-settled` e convida o retry — que não pode ser lossy.
      const database = db as NonNullable<typeof db>;
      const receipts = new ReceiptStore(redis);
      const characterId = await seedHuntThenCity(database, receipts);
      const flaky = { ...sweepOf(database, receipts), database: failingTransactions(database.database.db, 1) };

      expect(await settleCharacterProgress(characterId, flaky)).toEqual({ written: 0, failed: 1 });
      expect(await versionOf(database, characterId)).toBe(0);

      expect(await settleCharacterProgress(characterId, sweepOf(database, receipts))).toEqual({ written: 2, failed: 0 });
      await expectNothingLost(database, characterId);
    });

    it('um extrato que NUNCA liquida deixa de segurar o personagem depois de STUCK_RECEIPT_AFTER varreduras', async () => {
      // O dado torto não pode trancar o personagem até o TTL do Redis. Passado o prazo o de estado
      // liquida sem o da hunt — a degradação explícita —, e o da hunt, quando liquida, entra só com
      // os deltas. Mutação que mata: não contar as falhas (o personagem ficaria trancado para sempre)
      // ou contar menos de uma varredura (a ordem se perderia à primeira falha).
      const database = db as NonNullable<typeof db>;
      const receipts = new ReceiptStore(redis);
      const characterId = await seedHuntThenCity(database, receipts);
      const failures = new Map<string, number>();
      const sweep = {
        ...sweepOf(database, receipts),
        database: failingTransactions(database.database.db, STUCK_RECEIPT_AFTER),
        failures,
      };

      for (let cycle = 1; cycle < STUCK_RECEIPT_AFTER; cycle += 1) {
        expect(await writePendingReceipts(sweep)).toEqual({ written: 0, failed: 1 });
        expect(await versionOf(database, characterId)).toBe(0);
        expect([...failures.values()]).toEqual([cycle]);
      }

      // A última tentativa do prazo: o v1 falha de novo e o v2 passa a sua vez.
      expect(await writePendingReceipts(sweep)).toEqual({ written: 1, failed: 1 });
      expect(await versionOf(database, characterId)).toBe(2);
      expect(await absolutesOf(database, characterId)).toMatchObject({ soul: 30, blessings: 3, skills: OLD_SKILLS });

      // O v1 liquida na varredura seguinte (a transação voltou): só os deltas, e o contador some.
      expect(await writePendingReceipts(sweep)).toEqual({ written: 1, failed: 0 });
      expect(failures.size).toBe(0);
      expect(await absolutesOf(database, characterId)).toMatchObject({ skills: OLD_SKILLS, staminaMs: 9_000_000 });
      expect(await characterRow(database, characterId)).toMatchObject({ gold: 760, xp: 1_800 });
      expect(await receipts.pendingFor(characterId)).toEqual([]);
    });

    it('o grupo de um personagem sai em ordem, 50 por varredura: o 51º espera pelo ciclo seguinte', async () => {
      // O índice é cortado pelos MAIS ANTIGOS. O `SCAN` que entrega o mais novo (51) não o liquida
      // na frente do resto — seria um buraco entre as versões, que é o que a completude evita.
      const database = db as NonNullable<typeof db>;
      const characterId = await seedCharacter(database);
      const receipts = new ReceiptStore(redis);
      const sessionId = randomUUID();
      for (let version = 1; version <= 51; version += 1) {
        await receipts.save(receiptOf(sessionId, characterId, { seq: version, durableVersion: version, soul: version }));
      }
      const all = await receipts.pendingFor(characterId, 51);
      const newest = all.at(-1);
      if (newest === undefined) throw new Error('faltou o extrato mais novo');
      const subset = {
        pending: async () => [newest],
        pendingFor: (...args: Parameters<ReceiptStore['pendingFor']>) => receipts.pendingFor(...args),
        remove: (...args: Parameters<ReceiptStore['remove']>) => receipts.remove(...args),
      } as unknown as ReceiptStore;

      expect(await writePendingReceipts(sweepOf(database, subset))).toEqual({ written: 50, failed: 0 });
      expect(await versionOf(database, characterId)).toBe(50);
      expect((await receipts.pendingFor(characterId)).map((receipt) => receipt.durableVersion)).toEqual([51]);

      expect(await writePendingReceipts(sweepOf(database, subset))).toEqual({ written: 1, failed: 0 });
      expect(await versionOf(database, characterId)).toBe(51);
      expect((await absolutesOf(database, characterId))?.soul).toBe(51);
    });
  });
});
