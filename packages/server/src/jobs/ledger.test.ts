import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { levelForXp } from '@draconya/sim';
import type { Progression } from '@draconya/content';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { accounts, characters, itemInstances } from '../db/schema.js';
import { createLogger } from '../log.js';
import { ReceiptStore, type SessionReceipt } from '../receipts.js';
import { DrizzleGameRepository } from '../db/repository.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
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
  stepDurationMs: 500, regen: { healthPerSecond: 1, manaPerSecond: 1 },
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
};

const characterRow = async (
  database: NonNullable<typeof db>, characterId: string,
): Promise<{ xp: number; gold: number; level: number; staminaMs: number; skills: unknown }> => {
  const [row] = await database.database.db
    .select({
      xp: characters.xp, gold: characters.gold, level: characters.level,
      skills: characters.skills,
      staminaMs: characters.staminaMs,
    })
    .from(characters)
    .where(eq(characters.id, characterId));
  return row as { xp: number; gold: number; level: number; staminaMs: number; skills: unknown };
};

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
