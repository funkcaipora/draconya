import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { totalXpForLevel } from '@draconya/sim';
import type { ConditionState, LearnedSpellsState, SessionSnapshot } from '@draconya/sim';
import { afterAll, describe, expect, it } from 'vitest';
import { accounts, characterStorages, characters, itemInstances, ledger } from '../db/schema.js';
import { createLogger } from '../log.js';
import { ReceiptStore } from '../receipts.js';
import type { SessionReceipt } from '../receipts.js';
import { settleSnapshotAsReceipt } from '../snapshot-settlement.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { testContent } from '../testing/content.js';
import { settleCharacterProgress, writePendingReceipts } from './ledger.js';
import type { LedgerSweepOptions } from './ledger.js';
import { JobsMetrics } from './metrics.js';
import { createJobsCycle } from './scheduler.js';

// A liquidação do checkpoint do mundo no `jobs` (#838, OW-17, ADR 0060 d.10.d-e), no Postgres de
// verdade: o CHECKPOINT (`reason: 'checkpoint'`) SEM valor movido é aplicado só como estado absoluto,
// guardado por `characters.durable_version`, e não cria linha de ledger. O extrato COM valor, o de fim de
// sessão e o de saída seguem o caminho de hoje, e a flag `OPEN_WORLD` desligada deixa tudo como era.

const logger = createLogger('silent', 'test');
const { redis, available: redisReady } = await connectTestRedis(27);

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

// **Este arquivo NÃO faz `flushdb` e varre só os PRÓPRIOS personagens** (`onlyMine`). O Redis local de
// desenvolvimento tem 16 bancos (o CI sobe 32, ver `testing/redis.ts`): todo índice a partir de 16 cai
// em silêncio no banco 0, que então é de vários arquivos ao mesmo tempo. `writePendingReceipts` varre
// o keyspace inteiro, e o extrato SEM ledger é removido mesmo quando o personagem não existe neste
// banco — um arquivo vizinho (a `party-v2-exit`, por exemplo) perderia extrato no meio do teste.
const mine = new Set<string>();

/** O `ReceiptStore` visto só pelos extratos dos personagens que ESTE arquivo criou. */
const onlyMine = (store: ReceiptStore): ReceiptStore => ({
  pending: async () => (await store.pending()).filter((receipt) => mine.has(receipt.characterId)),
  pendingFor: (characterId: string, limit?: number) => store.pendingFor(characterId, limit),
  remove: (...args: Parameters<ReceiptStore['remove']>) => store.remove(...args),
}) as unknown as ReceiptStore;

/** As chaves de extrato que sobraram para este personagem — o que a varredura devia ter apagado. */
const leftFor = (characterId: string): Promise<string[]> => redis.keys(`receipt:*:${characterId}:*`);

const content = testContent();
const STREET = { x: 32369, y: 32250, z: 7 };
const DEPOT = { x: 32360, y: 32232, z: 7 };
const TEMPLE = { x: 32369, y: 32241, z: 7 };

const NOTHING = {
  durationMs: 60_000, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0,
  itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0, damageDealt: 0, healingDone: 0,
};

/** Um extrato de checkpoint: sem valor movido, com a posição e os vitais. */
const checkpointOf = (
  sessionId: string, characterId: string, seq: number, overrides: Partial<SessionReceipt> = {},
): Omit<SessionReceipt, 'endedAtMs'> => ({
  sessionId, characterId, accountId: 'a1', reason: 'checkpoint', seq, durableVersion: seq,
  aggregates: NOTHING, notableEvents: [],
  worldPosition: STREET, townId: 'thais', health: 100, mana: 20,
  ...overrides,
});

const withValue = (gold: number): Pick<SessionReceipt, 'aggregates'> => ({
  aggregates: { ...NOTHING, goldGained: gold, xpGained: 0 },
});

/** O personagem nasce no nível 5, com gold: o que a linha sem valor NÃO pode tocar. */
async function seedCharacter(database: NonNullable<typeof db>): Promise<string> {
  const accountId = randomUUID();
  const characterId = randomUUID();
  await database.database.db.insert(accounts).values({
    id: accountId, email: `${accountId}@example.com`, externalAuthId: accountId,
  });
  await database.database.db.insert(characters).values({
    id: characterId, accountId, name: `Check ${characterId.slice(0, 8)}`, level: 5, gold: 700,
    xp: totalXpForLevel(5, content.progression),
  });
  mine.add(characterId);
  return characterId;
}

const columnsOf = async (database: NonNullable<typeof db>, characterId: string) => {
  const [row] = await database.database.db
    .select({
      worldX: characters.worldX, worldY: characters.worldY, worldZ: characters.worldZ,
      townId: characters.townId, health: characters.health, mana: characters.mana,
      conditions: characters.conditions, durableVersion: characters.durableVersion,
      xp: characters.xp, gold: characters.gold, level: characters.level, soul: characters.soul,
      learnedSpells: characters.learnedSpells, vocation: characters.vocation,
    })
    .from(characters).where(eq(characters.id, characterId));
  if (row === undefined) throw new Error('personagem não encontrado');
  return row;
};

const ledgerOf = async (database: NonNullable<typeof db>, characterId: string) =>
  database.database.db.select().from(ledger).where(eq(ledger.characterId, characterId));

const sweepOf = (
  database: NonNullable<typeof db>, receipts: ReceiptStore, openWorld = true,
): LedgerSweepOptions => ({
  database: database.database.db, receipts: onlyMine(receipts), logger, progression: content.progression,
  ...(openWorld ? { openWorld: true } : {}),
});

const haste: ConditionState = { key: 'haste', expiresAtMs: 6_500, speedPercent: 30 };

describe.runIf(ready)('o checkpoint é liquidado como estado absoluto, sem linha de ledger (#838, OW-17)', () => {
  it('uma linha só de posição: aplica a posição e os vitais, e NENHUMA linha de ledger', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const before = await columnsOf(database, characterId);

    await receipts.save(checkpointOf(randomUUID(), characterId, 1, { health: 10, mana: 3, conditions: [haste] }));
    const result = await writePendingReceipts(sweepOf(database, receipts));

    expect(result).toEqual({ written: 1, failed: 0, stateOnly: 1 });
    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: STREET.x, worldY: STREET.y, worldZ: STREET.z, townId: 'thais', health: 10, mana: 3,
      conditions: [haste], durableVersion: 1,
    });
    // Mutação que mata: inserir a linha antes do `if (withoutLedger)`.
    expect(await ledgerOf(database, characterId)).toEqual([]);
    // A conta do jogador é intocada: sem delta, sem `level` rederivado.
    expect(await columnsOf(database, characterId)).toMatchObject({ xp: before.xp, gold: 700, level: 5 });
    // O extrato saiu do Redis, como o de sempre: nada fica para o próximo ciclo.
    expect(await leftFor(characterId)).toEqual([]);
    expect(await receipts.pendingFor(characterId)).toEqual([]);
  });

  it('reprocessar a MESMA linha é nulo: a versão já está na coluna, e nada é escrito de novo', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const first = checkpointOf(sessionId, characterId, 1, { health: 10 });

    await receipts.save(first);
    await writePendingReceipts(sweepOf(database, receipts));
    // A coluna passa a valer outra coisa — e a mesma linha volta ao Redis, como numa queda entre
    // gravar a coluna e apagar o extrato. Se o reprocesso a aplicasse de novo, a vida voltaria a 10.
    await database.database.db.update(characters).set({ health: 99 }).where(eq(characters.id, characterId));
    await receipts.save(first);
    const again = await writePendingReceipts(sweepOf(database, receipts));

    // Liquidado e removido (não fica preso no Redis), mas sem escrever.
    expect(again).toEqual({ written: 1, failed: 0, stateOnly: 1 });
    expect(await columnsOf(database, characterId)).toMatchObject({ health: 99, durableVersion: 1 });
    expect(await ledgerOf(database, characterId)).toEqual([]);
    expect(await leftFor(characterId)).toEqual([]);
  });

  it('uma linha de posição MAIS ANTIGA que a aplicada é ignorada — mesmo gravada depois', async () => {
    // O relógio de gravação do v1 é MAIOR: a guarda de instante de skills e stamina o deixaria
    // passar, e só a versão o barra. Mutação que mata: trocar `absolute` por `true`.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const base = Date.now();
    const newer = new ReceiptStore(redis, { now: () => base + 1_000 });
    const older = new ReceiptStore(redis, { now: () => base + 9_000 });
    const sessionId = randomUUID();

    await newer.save(checkpointOf(sessionId, characterId, 2, { worldPosition: DEPOT, health: 80, mana: 12 }));
    await writePendingReceipts(sweepOf(database, newer));
    await older.save(checkpointOf(sessionId, characterId, 1, {
      worldPosition: STREET, health: 5, mana: 0, conditions: [haste],
    }));
    const late = await writePendingReceipts(sweepOf(database, older));

    expect(late).toEqual({ written: 1, failed: 0, stateOnly: 1 });
    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: DEPOT.x, worldY: DEPOT.y, worldZ: DEPOT.z, health: 80, mana: 12, conditions: null,
      durableVersion: 2,
    });
    expect(await ledgerOf(database, characterId)).toEqual([]);
    expect(await leftFor(characterId)).toEqual([]);
  });

  it('a linha mais antiga ainda funde o monotônico, como no caminho com ledger — só não escreve absoluto', async () => {
    // Magia aprendida é a UNIÃO e vocação é `coalesce`: aplicar de novo não custa nada, e descartar
    // seria a única diferença entre os dois caminhos.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const newer: LearnedSpellsState = { spellIds: ['wound-cleansing'], version: 1 };
    const older: LearnedSpellsState = { spellIds: ['wound-cleansing', 'berserk'], version: 1 };

    await receipts.save(checkpointOf(sessionId, characterId, 2, { soul: 40, learnedSpells: newer }));
    await writePendingReceipts(sweepOf(database, receipts));
    await receipts.save(checkpointOf(sessionId, characterId, 1, {
      soul: 99, learnedSpells: older, vocation: 'knight', health: 1,
    }));
    await writePendingReceipts(sweepOf(database, receipts));

    expect(await columnsOf(database, characterId)).toMatchObject({
      soul: 40, health: 100, durableVersion: 2, vocation: 'knight',
      learnedSpells: { spellIds: expect.arrayContaining(['wound-cleansing', 'berserk']) },
    });
    expect(await ledgerOf(database, characterId)).toEqual([]);
  });

  it('o estado absoluto INTEIRO viaja na linha sem valor, não só o mundo: alma, munição e storages', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await database.database.db.insert(characterStorages).values([
      { id: randomUUID(), characterId, storageKey: 'quest:a', value: 1 },
      { id: randomUUID(), characterId, storageKey: 'quest:old', value: 4 },
    ]);

    await receipts.save(checkpointOf(randomUUID(), characterId, 1, {
      soul: 12, ammo: { arrow: 'sniper-arrow' }, storages: { 'quest:a': 2, 'quest:b': 7 },
    }));
    await writePendingReceipts(sweepOf(database, receipts));

    expect((await columnsOf(database, characterId)).soul).toBe(12);
    const stored = await database.database.db
      .select({ key: characterStorages.storageKey, value: characterStorages.value })
      .from(characterStorages).where(eq(characterStorages.characterId, characterId));
    expect(new Map(stored.map((row) => [row.key, row.value]))).toEqual(new Map([['quest:a', 2], ['quest:b', 7]]));
    expect(await ledgerOf(database, characterId)).toEqual([]);
  });

  it('a linha COM valor segue o caminho de hoje: 100 de loot + 50 de venda, dois checkpoints e um logout somam 150', async () => {
    // O portão do plano §4 (um canal de gold), do lado do `jobs`: o ledger só cresce onde valor se
    // moveu, e a conta fecha. v1 (+100), v2 (nada), v3 (+50), v4 (logout, nada). O logout NÃO é
    // checkpoint: leva a linha de ledger dele (delta zero), como a de toda saída.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();

    await receipts.save(checkpointOf(sessionId, characterId, 1, { ...withValue(100), worldPosition: STREET }));
    await receipts.save(checkpointOf(sessionId, characterId, 2, { worldPosition: DEPOT }));
    await receipts.save(checkpointOf(sessionId, characterId, 3, { ...withValue(50), worldPosition: STREET }));
    await receipts.save(checkpointOf(sessionId, characterId, 4, { reason: 'manual-exit', worldPosition: TEMPLE }));
    const result = await writePendingReceipts(sweepOf(database, receipts));

    expect(result).toEqual({ written: 4, failed: 0, stateOnly: 1 });
    const rows = await ledgerOf(database, characterId);
    expect(rows.map((row) => row.seq).sort()).toEqual([1, 3, 4]);
    expect(rows.map((row) => row.type).sort()).toEqual(['session-checkpoint', 'session-checkpoint', 'session-manual-exit']);
    expect(rows.reduce((sum, row) => sum + row.delta, 0)).toBe(150);
    // A coluna `gold` é projeção do ledger: 700 do começo + o que ele registra.
    expect((await columnsOf(database, characterId)).gold).toBe(850);
    // E o estado absoluto é o do último, o logout.
    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: TEMPLE.x, worldY: TEMPLE.y, worldZ: TEMPLE.z, durableVersion: 4,
    });
  });

  it('uma linha com valor atrasada ainda credita o delta e não desfaz o estado — o invariante 10 intacto', async () => {
    // v2 (sem valor) aplicada, depois chega o v1 COM gold: o delta entra (a chave única decide), e a
    // posição continua a do v2. Reenviar o v1 não duplica.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();

    await receipts.save(checkpointOf(sessionId, characterId, 2, { worldPosition: DEPOT }));
    await writePendingReceipts(sweepOf(database, receipts));
    const valued = checkpointOf(sessionId, characterId, 1, { ...withValue(100), worldPosition: STREET });
    await receipts.save(valued);
    await writePendingReceipts(sweepOf(database, receipts));
    await receipts.save(valued);
    await writePendingReceipts(sweepOf(database, receipts));

    expect(await ledgerOf(database, characterId)).toHaveLength(1);
    expect(await columnsOf(database, characterId)).toMatchObject({
      gold: 800, worldX: DEPOT.x, worldY: DEPOT.y, durableVersion: 2,
    });
  });

  it('a liquidação do ticket encontra as linhas do lote em ordem de versão: gravadas 3, 1, 2, vale a 3', async () => {
    // `pendingFor` é o índice por versão, e o ticket liquida pelo mesmo caminho da varredura
    // (FUN-56, ADR 0024). O v2 do meio tem valor: o lote mistura as duas formas.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();

    await receipts.save(checkpointOf(sessionId, characterId, 3, { worldPosition: TEMPLE, health: 30 }));
    await receipts.save(checkpointOf(sessionId, characterId, 1, { worldPosition: STREET, health: 10 }));
    await receipts.save(checkpointOf(sessionId, characterId, 2, { ...withValue(40), worldPosition: DEPOT, health: 20 }));
    expect((await receipts.pendingFor(characterId)).map((receipt) => receipt.durableVersion)).toEqual([1, 2, 3]);

    const result = await settleCharacterProgress(characterId, sweepOf(database, receipts));

    expect(result).toEqual({ written: 3, failed: 0, stateOnly: 2 });
    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: TEMPLE.x, worldY: TEMPLE.y, health: 30, durableVersion: 3, gold: 740,
    });
    expect(await ledgerOf(database, characterId)).toHaveLength(1);
    expect(await leftFor(characterId)).toEqual([]);
  });

  it('o `jobs` e o ticket liquidando a mesma linha ao mesmo tempo: sem erro, sem escrita dobrada', async () => {
    // ADR 0024: os dois caminhos se cruzam. Sem ledger a chave única não decide mais, e é a trava
    // de linha mais a versão que serializam — o segundo encontra a versão já na coluna.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save(checkpointOf(randomUUID(), characterId, 1, { health: 10 }));

    const [sweep, ticket] = await Promise.all([
      writePendingReceipts(sweepOf(database, receipts)),
      settleCharacterProgress(characterId, sweepOf(database, receipts)),
    ]);

    expect(sweep.failed + ticket.failed).toBe(0);
    expect(await columnsOf(database, characterId)).toMatchObject({ health: 10, durableVersion: 1 });
    expect(await ledgerOf(database, characterId)).toEqual([]);
    expect(await leftFor(characterId)).toEqual([]);
  });

  // O `acquired` do emissor (`acquiredBy`, `game/host.ts`) é CUMULATIVO: lista todo item da sessão que
  // ainda está na mochila, com o mesmo id de loot (`${sessionId}:bag:N`), em TODO checkpoint. O extrato
  // abaixo tem essa forma — não um `acquired` que só existe no primeiro.
  const sword = (sessionId: string) => ({ instanceId: `${sessionId}:bag:1`, itemId: 'spike-sword', quantity: 1 });
  const shield = (sessionId: string) => ({ instanceId: `${sessionId}:bag:2`, itemId: 'plate-shield', quantity: 1 });
  const itemsOf = async (database: NonNullable<typeof db>, characterId: string) =>
    (await database.database.db.select({ id: itemInstances.id }).from(itemInstances)
      .where(eq(itemInstances.ownerCharacterId, characterId))).map((row) => row.id).sort();

  it('o `acquired` CUMULATIVO não prende o personagem no ledger: a espada de t0 repetida a cada checkpoint não é valor', async () => {
    // Quem lootou uma vez leva o item em todo checkpoint seguinte. O primeiro, que traz o item NOVO, é
    // a linha de ledger; os seguintes, que só o repetem, são estado absoluto — senão o teto de 288 mil
    // linhas por dia seria o caso típico de todo personagem que já pegou alguma coisa.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();

    await receipts.save(checkpointOf(sessionId, characterId, 1, { acquired: [sword(sessionId)], worldPosition: STREET }));
    const first = await writePendingReceipts(sweepOf(database, receipts));
    await receipts.save(checkpointOf(sessionId, characterId, 2, { acquired: [sword(sessionId)], worldPosition: DEPOT }));
    await receipts.save(checkpointOf(sessionId, characterId, 3, { acquired: [sword(sessionId)], worldPosition: TEMPLE }));
    const repeated = await writePendingReceipts(sweepOf(database, receipts));

    // O item NOVO é valor: uma linha de ledger (delta zero, mas é o registro de que o item nasceu).
    expect(first).toEqual({ written: 1, failed: 0 });
    expect(await itemsOf(database, characterId)).toEqual([`${sessionId}:bag:1`]);
    // O repetido NÃO: nenhuma linha nova, o estado absoluto do último, e o extrato saiu do Redis.
    expect(repeated).toEqual({ written: 2, failed: 0, stateOnly: 2 });
    expect(await ledgerOf(database, characterId)).toHaveLength(1);
    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: TEMPLE.x, worldY: TEMPLE.y, durableVersion: 3, gold: 700,
    });
    expect(await itemsOf(database, characterId)).toEqual([`${sessionId}:bag:1`]);
    expect(await leftFor(characterId)).toEqual([]);
  });

  it('um item NOVO ao lado do que já existia volta ao ledger, e só o novo é inserido', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();

    await receipts.save(checkpointOf(sessionId, characterId, 1, { acquired: [sword(sessionId)] }));
    await writePendingReceipts(sweepOf(database, receipts));
    await receipts.save(checkpointOf(sessionId, characterId, 2, { acquired: [sword(sessionId), shield(sessionId)] }));
    const result = await writePendingReceipts(sweepOf(database, receipts));

    expect(result).toEqual({ written: 1, failed: 0 });
    expect(await ledgerOf(database, characterId)).toHaveLength(2);
    expect(await itemsOf(database, characterId)).toEqual([`${sessionId}:bag:1`, `${sessionId}:bag:2`]);
  });

  it('o item de OUTRO dono com o mesmo id não conta como "já tido": o extrato segue o caminho do ledger', async () => {
    // A conferência é por dono, como o resto do arquivo. (Os ids levam o prefixo da sessão e não se
    // repetem entre personagens — o caso é a defesa, não o fluxo.)
    const database = db as NonNullable<typeof db>;
    const owner = await seedCharacter(database);
    const other = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    await database.database.db.insert(itemInstances).values({
      id: sword(sessionId).instanceId, itemId: 'spike-sword', ownerCharacterId: owner, quantity: 1, origin: 'loot',
    });

    await receipts.save(checkpointOf(sessionId, other, 1, { acquired: [sword(sessionId)] }));
    const result = await writePendingReceipts(sweepOf(database, receipts));

    expect(result).toEqual({ written: 1, failed: 0 });
    expect(await ledgerOf(database, other)).toHaveLength(1);
  });

  it('só o CHECKPOINT pula o ledger: o fim de sessão e a saída sem valor ainda têm a linha deles', async () => {
    // A linha de ledger do extrato final é o que a liquidação de um snapshot irrestaurável encontra
    // para não aplicar de novo. Mutação que mata: tirar `receipt.reason === CHECKPOINT_REASON`.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();

    await receipts.save(checkpointOf(sessionId, characterId, 1, { reason: 'manual-exit', health: 10 }));
    await receipts.save(checkpointOf(sessionId, characterId, 2, { reason: 'completed', health: 20 }));
    const result = await writePendingReceipts(sweepOf(database, receipts));

    expect(result).toEqual({ written: 2, failed: 0 });
    expect((await ledgerOf(database, characterId)).map((row) => row.type).sort())
      .toEqual(['session-completed', 'session-manual-exit']);
    expect(await columnsOf(database, characterId)).toMatchObject({ health: 20, durableVersion: 2 });
  });

  it('o extrato que o snapshot irrestaurável rederiva NÃO desfaz o final da sessão que já liquidou', async () => {
    // Uma hunt sem valor termina: o hospedeiro grava o extrato final R1 (seq 4, versão 5) e o `jobs` o
    // aplica. O `release` seguinte cai, e o snapshot (ledgerSeq 3) sobrevive. No login seguinte ele é
    // irrestaurável, e `settleSnapshotAsReceipt` reemite o MESMO `seq = ledgerSeq + 1` com uma versão
    // NOVA e o estado de alguns segundos antes. A chave `(session_id, seq)` do ledger, que o extrato
    // final deixou, é o que o reconhece. Sem a linha, ele passaria na guarda de versão (6 > 5) e
    // sobrescreveria a vida e a posição de R1 com as do snapshot.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const snapshot: SessionSnapshot = {
      formatVersion: 2, contentVersion: 'v-test', id: sessionId, type: 'hunt', createdAtMs: 0, logicalNowMs: 5_000,
      schedule: { events: [], nextSeq: 0 }, rng: { a: 1, b: 2, c: 3, d: 4 } as never,
      participants: [{
        id: characterId, position: { x: 0, y: 0, z: 7 }, health: 40, maxHealth: 100, mana: 5, maxMana: 20,
        level: 5, xp: totalXpForLevel(5, content.progression), goldDelta: 0, alive: true, cooldowns: {},
        townId: 'thais', worldPosition: { x: STREET.x, y: STREET.y, z: STREET.z },
      }],
      aggregates: NOTHING, notableEvents: [], ledgerSeq: 3, endedReason: null,
    };

    await receipts.save(checkpointOf(sessionId, characterId, 4, {
      reason: 'manual-exit', durableVersion: 5, worldPosition: TEMPLE, health: 10, mana: 2,
    }));
    await writePendingReceipts(sweepOf(database, receipts));
    await settleSnapshotAsReceipt(snapshot, {
      characterId, accountId: 'a1', receipts, durableVersion: 6, openWorld: true,
    });
    expect((await receipts.pendingFor(characterId)).map((receipt) => [receipt.seq, receipt.durableVersion])).toEqual([[4, 6]]);
    const twin = await writePendingReceipts(sweepOf(database, receipts));

    expect(twin).toEqual({ written: 1, failed: 0 });
    expect(await ledgerOf(database, characterId)).toHaveLength(1);
    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: TEMPLE.x, worldY: TEMPLE.y, health: 10, mana: 2, durableVersion: 5,
    });
    expect(await leftFor(characterId)).toEqual([]);
  });

  it('com a flag DESLIGADA nada muda: a linha sem valor ainda grava a linha de ledger', async () => {
    // O default. O resultado é o de antes, sem `stateOnly`, e a linha de ledger tem delta zero.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    await receipts.save(checkpointOf(randomUUID(), characterId, 1, { health: 10 }));

    const result = await writePendingReceipts(sweepOf(database, receipts, false));

    expect(result).toEqual({ written: 1, failed: 0 });
    const rows = await ledgerOf(database, characterId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 0, type: 'session-checkpoint', seq: 1 });
    expect(await columnsOf(database, characterId)).toMatchObject({ health: 10, durableVersion: 1, level: 5 });
  });

  it('um extrato SEM versão segue o caminho de antes mesmo sem valor: a chave única é a única idempotência dele', async () => {
    // Nó `game` anterior (deploy em rolagem). Sem versão não há guarda, então a linha de ledger é o
    // que impede o reprocesso de reaplicar — e é o que este teste prende.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const unversioned = { ...checkpointOf(sessionId, characterId, 1, { soul: 5 }) } as Omit<SessionReceipt, 'endedAtMs'>;
    delete (unversioned as { durableVersion?: number }).durableVersion;

    await receipts.save(unversioned);
    const first = await writePendingReceipts(sweepOf(database, receipts));
    await receipts.save(unversioned);
    await writePendingReceipts(sweepOf(database, receipts));

    expect(first).toEqual({ written: 1, failed: 0 });
    expect(await ledgerOf(database, characterId)).toHaveLength(1);
    expect(await columnsOf(database, characterId)).toMatchObject({ soul: 5, durableVersion: 0 });
  });

  it('a morte é valor: a linha de quem morreu segue o caminho do ledger, com a posição do templo', async () => {
    // `deaths` é um dos cinco zeros que definem "sem valor". A morte leva a vida cheia, a posição
    // nula e nenhuma condição (`player.cpp:4226-4252`) — e ainda assim tem linha de ledger.
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);

    await receipts.save(checkpointOf(randomUUID(), characterId, 1, {
      reason: 'death', aggregates: { ...NOTHING, deaths: 1 },
      worldPosition: null, health: 150, mana: 30, conditions: [],
    }));
    const result = await writePendingReceipts(sweepOf(database, receipts));

    expect(result).toEqual({ written: 1, failed: 0 });
    expect(await ledgerOf(database, characterId)).toHaveLength(1);
    expect(await columnsOf(database, characterId)).toMatchObject({
      worldX: null, worldY: null, worldZ: null, health: 150, mana: 30, conditions: null,
    });
  });
});

describe.runIf(ready)('o ciclo do jobs repassa a flag e conta o que aplicou sem ledger (#838, OW-17)', () => {
  const scrape = (metrics: JobsMetrics): Promise<string> => metrics.registry.metrics();

  const runCycle = async (
    database: NonNullable<typeof db>, receipts: ReceiptStore, metrics: JobsMetrics, openWorld: boolean,
  ): Promise<void> => {
    await createJobsCycle(logger, {
      database: database.database.db, receipts: onlyMine(receipts), progression: content.progression, metrics,
      ...(openWorld ? { openWorld: true } : {}),
    }).run();
  };

  it('com `openWorld`: um extrato com valor e um sem — uma linha de ledger, e o contador separa os dois', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const metrics = new JobsMetrics('j');
    const sessionId = randomUUID();

    await receipts.save(checkpointOf(sessionId, characterId, 1, { ...withValue(100) }));
    await receipts.save(checkpointOf(sessionId, characterId, 2, { worldPosition: DEPOT }));
    await runCycle(database, receipts, metrics, true);

    expect(await ledgerOf(database, characterId)).toHaveLength(1);
    expect(await columnsOf(database, characterId)).toMatchObject({ worldX: DEPOT.x, durableVersion: 2, gold: 800 });
    const text = await scrape(metrics);
    expect(text).toMatch(/draconya_jobs_receipts_written_total\{[^}]*\} 2/);
    expect(text).toMatch(/draconya_jobs_receipts_state_only_total\{[^}]*\} 1/);
  });

  it('sem `openWorld` (o default): as duas viram linha de ledger e o contador sem ledger fica em zero', async () => {
    const database = db as NonNullable<typeof db>;
    const characterId = await seedCharacter(database);
    const receipts = new ReceiptStore(redis);
    const metrics = new JobsMetrics('j');
    const sessionId = randomUUID();

    await receipts.save(checkpointOf(sessionId, characterId, 1, { ...withValue(100) }));
    await receipts.save(checkpointOf(sessionId, characterId, 2, { worldPosition: DEPOT }));
    await runCycle(database, receipts, metrics, false);

    expect(await ledgerOf(database, characterId)).toHaveLength(2);
    const text = await scrape(metrics);
    expect(text).toMatch(/draconya_jobs_receipts_written_total\{[^}]*\} 2/);
    expect(text).toMatch(/draconya_jobs_receipts_state_only_total\{[^}]*\} 0/);
  });
});
