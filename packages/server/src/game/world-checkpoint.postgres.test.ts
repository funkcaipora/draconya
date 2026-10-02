import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { CharacterRuntime, Rng, Session, totalXpForLevel } from '@draconya/sim';
import type { CarriedItem, Point, Ruleset } from '@draconya/sim';
import { compileItem, itemSchema } from '@draconya/content';
import { afterAll, describe, expect, it } from 'vitest';
import { accounts, characters, itemInstances, ledger } from '../db/schema.js';
import { createLogger } from '../log.js';
import { ReceiptStore } from '../receipts.js';
import type { SessionReceipt } from '../receipts.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';
import { testContent } from '../testing/content.js';
import { settleCharacterProgress } from '../jobs/ledger.js';
import { SessionHost } from './host.js';
import type { SessionHostOptions } from './host.js';
import { FakeSocket } from './testing.js';

// O checkpoint do mundo (#837, OW-16) do hospedeiro ao ledger, no Postgres de verdade: o `game` grava o
// lote no Redis, o `jobs` o liquida, e é a linha do ledger e a coluna do personagem que se confere. É o
// teste que prende o critério da issue — invariante 10 intacto: o que o personagem rendeu entra UMA vez,
// qualquer que seja a ordem, a falha ou a queda no meio.

// Este arquivo NÃO faz `flushdb` nem varre o Redis inteiro (`writePendingReceipts`): todo personagem e toda
// sessão daqui nasce com UUID, e a liquidação é POR PERSONAGEM (`settleCharacterProgress`, o mesmo
// caminho do ticket). O Redis local desta máquina tem 16 bancos e a infra de teste pede 32 — os índices
// 16 em diante caem no banco 0 em silêncio (ver `testing/redis.ts`) —, e um arquivo que apagasse ou
// varresse o banco inteiro tiraria o extrato pendente de outro que roda ao lado.
const logger = createLogger('silent', 'test');
const { redis, available: redisReady } = await connectTestRedis(28);

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

const content = testContent();
const QUIET = {
  hz: () => 0, onEnter: () => {}, onEvent: () => {}, onCreatureDied: () => {}, onEnd: () => {},
} as const;
const ORIGIN = { x: 32_000, y: 32_100 } as const;
/** O mundo: shard que credita e checkpointa, e sabe a posição absoluta (o que o `WorldRuleset` responde). */
const WORLD: Ruleset = {
  type: 'city', shared: true, ...QUIET, progress: 'checkpointed',
  ...{
    worldPositionOf: (character: CharacterRuntime): Point => ({
      x: ORIGIN.x + character.position.x, y: ORIGIN.y + character.position.y, z: character.position.z,
    }),
  },
};

const item = (id: string, value: number, appearanceId: number, stackable = false) => ({
  ...compileItem(itemSchema.parse({ kind: 'other', weight: 1, id, name: id, value, ...(stackable ? { stackable } : {}) })),
  appearanceId,
});
const itemCatalog = new Map(
  [item('gem', 30, 3), item('stone', 20, 4), item('cheese', 5, 5, true)].map((entry) => [entry.id, entry]),
);

async function seedCharacter(database: NonNullable<typeof db>, level = 8): Promise<{ characterId: string; accountId: string }> {
  const accountId = randomUUID();
  const characterId = randomUUID();
  await database.database.db.insert(accounts).values({
    id: accountId, email: `${accountId}@example.com`, externalAuthId: accountId,
  });
  await database.database.db.insert(characters).values({
    id: characterId, accountId, name: `Mundo ${characterId.slice(0, 8)}`, level,
    xp: totalXpForLevel(level, content.progression),
  });
  return { characterId, accountId };
}

/** Um mundo hospedado com a loja de extratos no Redis de verdade, e os heróis que o teste pedir. */
function hostedWorld(options: Partial<SessionHostOptions> = {}) {
  /** O que cada personagem traz do ticket na mochila: o que um login anterior deixou no banco. */
  const carrying = new Map<string, readonly CarriedItem[]>();
  const session = new Session({
    id: `world-${randomUUID()}`, contentVersion: content.version, ruleset: WORLD, rng: Rng.fromSeed('w'), createdAtMs: 0,
  });
  const receipts = new ReceiptStore(redis);
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, receipts, itemCatalog, openWorld: true,
    ...options,
    createSession: (characterId) => {
      session.enter(new CharacterRuntime({
        id: characterId, position: { x: 94, y: 88, z: 7 }, health: 100, maxHealth: 100, mana: 20, maxMana: 20,
        level: 8, xp: totalXpForLevel(8, content.progression), gold: 0, goldDelta: 0, alive: true, cooldowns: {},
        townId: 'thais',
        ...(carrying.has(characterId) ? { inventory: { backpack: [...(carrying.get(characterId) ?? [])], equipped: {} } } : {}),
      }));
      return session;
    },
  });
  const enter = async (ids: { characterId: string; accountId: string }, brought: readonly CarriedItem[] = []) => {
    if (brought.length > 0) carrying.set(ids.characterId, brought);
    await host.prepare(ids.characterId, { level: 8, xp: 0, townId: 'thais', durableVersion: 0 }, ids.accountId);
    const viewer = host.attach(new FakeSocket(), ids.characterId);
    host.flush();
    const hero = session.participants.find((participant) => participant.id === ids.characterId) as CharacterRuntime;
    hero.capacity = 1_000;
    return { viewer, hero };
  };
  return { host, session, receipts, enter };
}

const lootGold = (session: Session, hero: CharacterRuntime, amount: number) => {
  hero.goldDelta += amount;
  session.credit(hero.id, 'goldGained', amount);
};
const give = (hero: CharacterRuntime, instanceId: string, itemId: 'gem' | 'stone' | 'cheese', quantity = 1) => {
  const added = hero.inventory.add(
    { instanceId, itemId, quantity }, itemCatalog, hero, { backpackSlots: 0, satchelSlots: 0, row: 1 },
  );
  expect(added.ok).toBe(true);
};
/** A quantidade de cada instância do personagem no banco — a linha de `item_instance`, não o ledger. */
const stacksOf = async (database: NonNullable<typeof db>, characterId: string) => {
  const rows = await database.database.db
    .select({ id: itemInstances.id, quantity: itemInstances.quantity })
    .from(itemInstances).where(eq(itemInstances.ownerCharacterId, characterId));
  return new Map(rows.map((row) => [row.id, row.quantity]));
};

const rowOf = async (database: NonNullable<typeof db>, characterId: string) => {
  const [row] = await database.database.db
    .select({
      gold: characters.gold, xp: characters.xp, health: characters.health, mana: characters.mana,
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

describe.runIf(ready)('o checkpoint do mundo chega ao ledger exatamente uma vez (#837, OW-16)', () => {
  /** O `jobs` liquidando o que ESTE personagem deixou no Redis — o caminho que o ticket usa. */
  const sweep = (database: NonNullable<typeof db>, receipts: ReceiptStore, characterId: string, openWorld = false) =>
    settleCharacterProgress(characterId, {
      database: database.database.db, receipts, logger, progression: content.progression,
      ...(openWorld ? { openWorld: true } : {}),
    });

  it('100 de loot e 50 de venda, dois checkpoints e um logout: o ledger soma exatamente 150', async () => {
    const database = db as NonNullable<typeof db>;
    const ids = await seedCharacter(database);
    const world = hostedWorld();
    const { viewer, hero } = await world.enter(ids);

    lootGold(world.session, hero, 100);
    await world.host.checkpointWorlds();
    give(hero, 'g1', 'gem');
    give(hero, 's1', 'stone');
    world.host.handle(viewer, { type: 'sell-items', instanceIds: ['g1', 's1'] });
    world.host.flush();
    await world.host.checkpointWorlds();
    await world.host.release(ids.characterId, 1000, 'logout');

    expect(await sweep(database, world.receipts, ids.characterId)).toEqual({ written: 3, failed: 0 });

    const rows = await ledgerOf(database, ids.characterId);
    expect(rows.map((row) => row.type)).toEqual(['session-checkpoint', 'session-checkpoint', 'session-manual-exit']);
    expect(rows.map((row) => row.delta)).toEqual([100, 50, 0]);
    expect(rows.reduce((total, row) => total + row.delta, 0)).toBe(150);
    // `(session_id, seq)` único por linha (invariante 10): três extratos, três chaves.
    expect(new Set(rows.map((row) => `${row.sessionId}:${row.seq}`)).size).toBe(3);
    // E a coluna é a projeção do ledger: o mesmo 150.
    expect(await rowOf(database, ids.characterId)).toMatchObject({ gold: 150 });
  });

  it('o lote leva a posição, a cidade, a vida e a mana do personagem para as colunas, em ordem de versão', async () => {
    const database = db as NonNullable<typeof db>;
    const ids = await seedCharacter(database);
    const world = hostedWorld();
    const { hero } = await world.enter(ids);

    hero.position = { x: 94, y: 97, z: 7 };
    hero.health = 70;
    hero.mana = 5;
    await world.host.checkpointWorlds();
    hero.position = { x: 95, y: 97, z: 7 };
    hero.health = 85;
    await world.host.checkpointWorlds();

    expect(await sweep(database, world.receipts, ids.characterId)).toEqual({ written: 2, failed: 0 });
    expect(await rowOf(database, ids.characterId)).toMatchObject({
      worldX: ORIGIN.x + 95, worldY: ORIGIN.y + 97, worldZ: 7, townId: 'thais', health: 85, mana: 5, durableVersion: 2,
    });
  });

  it('a queda entre dois lotes devolve o ÚLTIMO LOTE INTEIRO: todo mundo, ao mesmo instante', async () => {
    // O lote 1 pousa. O lote 2 é o que o nó nunca chegou a executar (a conexão caiu antes do `EXEC`):
    // `exec` rejeita e nada dele chega ao Redis. O `jobs` liquida o que existe — e o que existe é o
    // lote 1 de TODOS, e nada do 2 de nenhum.
    const database = db as NonNullable<typeof db>;
    const first = await seedCharacter(database);
    const second = await seedCharacter(database);
    let dying = false;
    const real = new ReceiptStore(redis);
    const world = hostedWorld({
      receipts: {
        save: (receipt: Omit<SessionReceipt, 'endedAtMs'>) => real.save(receipt),
        saveBatch: async (batch: readonly Omit<SessionReceipt, 'endedAtMs'>[]) => {
          if (dying) throw new Error('connection lost');
          await real.saveBatch(batch);
        },
      } as unknown as ReceiptStore,
    });
    const a = await world.enter(first);
    const b = await world.enter(second);

    // Lote 1: A rendeu 100 de gold e 40 de XP e andou; B andou e perdeu vida.
    lootGold(world.session, a.hero, 100);
    world.session.credit(first.characterId, 'xpGained', 40);
    a.hero.position = { x: 96, y: 88, z: 7 };
    b.hero.position = { x: 94, y: 90, z: 7 };
    b.hero.health = 60;
    await world.host.checkpointWorlds();

    // Lote 2: o mundo andou mais — e o nó cai antes de gravá-lo.
    dying = true;
    lootGold(world.session, a.hero, 25);
    a.hero.position = { x: 99, y: 88, z: 7 };
    b.hero.health = 30;
    await world.host.checkpointWorlds();

    expect(await sweep(database, real, first.characterId)).toEqual({ written: 1, failed: 0 });
    expect(await sweep(database, real, second.characterId)).toEqual({ written: 1, failed: 0 });
    expect(await rowOf(database, first.characterId)).toMatchObject({
      gold: 100, xp: totalXpForLevel(8, content.progression) + 40, worldX: ORIGIN.x + 96, worldY: ORIGIN.y + 88,
      durableVersion: 1,
    });
    expect(await rowOf(database, second.characterId)).toMatchObject({
      health: 60, worldX: ORIGIN.x + 94, worldY: ORIGIN.y + 90, durableVersion: 1,
    });
    expect((await ledgerOf(database, first.characterId)).reduce((total, row) => total + row.delta, 0)).toBe(100);
  });

  it('o lote que falhou volta no seguinte: a queda do Redis não perde um centavo, e o ledger conta uma vez', async () => {
    const database = db as NonNullable<typeof db>;
    const ids = await seedCharacter(database);
    let down = true;
    const real = new ReceiptStore(redis);
    const world = hostedWorld({
      receipts: {
        save: (receipt: Omit<SessionReceipt, 'endedAtMs'>) => real.save(receipt),
        saveBatch: async (batch: readonly Omit<SessionReceipt, 'endedAtMs'>[]) => {
          if (down) throw new Error('Redis unavailable');
          await real.saveBatch(batch);
        },
      } as unknown as ReceiptStore,
    });
    const { hero } = await world.enter(ids);
    lootGold(world.session, hero, 100);

    await world.host.checkpointWorlds(); // o Redis está fora: o extrato fica em memória
    expect(await real.pendingFor(ids.characterId)).toEqual([]);
    lootGold(world.session, hero, 30);
    down = false;
    await world.host.checkpointWorlds(); // volta: o extrato atrasado vai na frente, o novo atrás
    await world.host.release(ids.characterId, 1000, 'logout');

    expect(await sweep(database, real, ids.characterId)).toEqual({ written: 3, failed: 0 });
    const rows = await ledgerOf(database, ids.characterId);
    expect(rows.map((row) => row.delta)).toEqual([100, 30, 0]);
    expect(await rowOf(database, ids.characterId)).toMatchObject({ gold: 130 });
  });

  it('a resposta perdida: o lote gravou no Redis e o `game` achou que falhou — repetir não credita duas vezes', async () => {
    const database = db as NonNullable<typeof db>;
    const ids = await seedCharacter(database);
    let loseAcknowledgement = true;
    const real = new ReceiptStore(redis);
    const world = hostedWorld({
      receipts: {
        save: (receipt: Omit<SessionReceipt, 'endedAtMs'>) => real.save(receipt),
        saveBatch: async (batch: readonly Omit<SessionReceipt, 'endedAtMs'>[]) => {
          await real.saveBatch(batch); // chegou
          if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('response lost'); }
        },
      } as unknown as ReceiptStore,
    });
    const { hero } = await world.enter(ids);
    lootGold(world.session, hero, 100);

    await world.host.checkpointWorlds(); // gravou, mas o `game` não sabe
    await world.host.checkpointWorlds(); // repete o mesmo extrato: a mesma chave, o mesmo `seq`

    expect(await real.pendingFor(ids.characterId)).toHaveLength(1);
    expect(await sweep(database, real, ids.characterId)).toEqual({ written: 1, failed: 0 });
    expect((await ledgerOf(database, ids.characterId)).map((row) => row.delta)).toEqual([100]);
    expect(await rowOf(database, ids.characterId)).toMatchObject({ gold: 100 });
  });

  // Os três valem com a flag do `jobs` desligada (todo extrato é linha de ledger) E ligada (#838: o checkpoint sem
  // valor novo é só estado, sem linha de ledger) — a quantidade é estado absoluto sob a versão nos dois caminhos.
  describe.each([[false], [true]])('o inventário do mundo no banco, com OPEN_WORLD do `jobs` %s', (openWorld) => {
    it('a pilha que nasceu na sessão guarda a quantidade de AGORA: pegar, checkpoint, pegar de novo, comer, sair', async () => {
      // O `acquired` é cumulativo e o ledger não toca a linha que já existe: o caso que o prefixo da sessão
      // cria — todo item que o personagem pega no mundo leva o mesmo prefixo, e a pilha mantém o id ao
      // empilhar. Sem `quantities`, o banco ficaria com 1 e o personagem perderia 2 queijos no login.
      const database = db as NonNullable<typeof db>;
      const ids = await seedCharacter(database);
      const world = hostedWorld();
      const { hero } = await world.enter(ids);
      const stack = `${world.session.id}:p1:0`;

      give(hero, stack, 'cheese', 1);
      await world.host.checkpointWorlds();
      give(hero, stack, 'cheese', 2); // empilha: a mesma instância, agora com 3
      await world.host.checkpointWorlds();
      expect(await sweep(database, world.receipts, ids.characterId, openWorld)).toMatchObject({ written: 2, failed: 0 });
      expect(await stacksOf(database, ids.characterId)).toEqual(new Map([[stack, 3]]));

      hero.inventory.consumeOne(stack); // comeu uma — o `sim` não reporta isto
      await world.host.release(ids.characterId, 1000, 'logout');
      expect(await sweep(database, world.receipts, ids.characterId, openWorld)).toMatchObject({ written: 1, failed: 0 });

      expect(await stacksOf(database, ids.characterId)).toEqual(new Map([[stack, 2]]));
      // Com a flag ligada o segundo checkpoint (a mesma pilha, só mais gorda) é estado puro: sem linha de ledger.
      expect((await ledgerOf(database, ids.characterId)).length).toBe(openWorld ? 2 : 3);
    });

    it('comer a última unidade apaga a linha: o item não volta no login seguinte', async () => {
      const database = db as NonNullable<typeof db>;
      const ids = await seedCharacter(database);
      const world = hostedWorld();
      const { hero } = await world.enter(ids);
      const stack = `${world.session.id}:p1:0`;

      give(hero, stack, 'cheese', 1);
      await world.host.checkpointWorlds();
      await sweep(database, world.receipts, ids.characterId, openWorld);
      expect(await stacksOf(database, ids.characterId)).toEqual(new Map([[stack, 1]]));

      hero.inventory.consumeOne(stack);
      await world.host.checkpointWorlds(); // o checkpoint, e não só o logout, leva a remoção
      await sweep(database, world.receipts, ids.characterId, openWorld);
      expect(await stacksOf(database, ids.characterId)).toEqual(new Map());

      // E o `acquired` cumulativo que ainda vem na saída não a ressuscita.
      await world.host.release(ids.characterId, 1000, 'logout');
      await sweep(database, world.receipts, ids.characterId, openWorld);
      expect(await stacksOf(database, ids.characterId)).toEqual(new Map());
    });

    it('a pilha de um login anterior também: o que se come do mundo desce no banco, e a última some', async () => {
      // O prefixo da sessão só alcança o que ELA criou; o queijo que veio da hunt de ontem tem outro id e
      // não está no `acquired` — e é o mais comum de se comer.
      const database = db as NonNullable<typeof db>;
      const ids = await seedCharacter(database);
      const yesterday = `hunt-ontem:${randomUUID()}:0`;
      const last = `hunt-ontem:${randomUUID()}:1`;
      await database.database.db.insert(itemInstances).values([
        { id: yesterday, itemId: 'cheese', ownerCharacterId: ids.characterId, origin: 'loot', quantity: 5 },
        { id: last, itemId: 'cheese', ownerCharacterId: ids.characterId, origin: 'loot', quantity: 1 },
      ]);
      const world = hostedWorld();
      const { hero } = await world.enter(ids, [
        { instanceId: yesterday, itemId: 'cheese', quantity: 5 }, { instanceId: last, itemId: 'cheese', quantity: 1 },
      ]);

      hero.inventory.consumeOne(yesterday);
      await world.host.checkpointWorlds(); // só a quantidade mudou: estado puro com a flag ligada
      hero.inventory.consumeOne(yesterday);
      hero.inventory.consumeOne(last);
      await world.host.release(ids.characterId, 1000, 'logout');
      expect(await sweep(database, world.receipts, ids.characterId, openWorld)).toMatchObject({ written: 2, failed: 0 });

      expect(await stacksOf(database, ids.characterId)).toEqual(new Map([[yesterday, 3]]));
    });
  });

  it('o personagem parado na PZ não escreve nada: nem Redis, nem ledger', async () => {
    const database = db as NonNullable<typeof db>;
    const ids = await seedCharacter(database);
    const world = hostedWorld();
    await world.enter(ids);

    await world.host.checkpointWorlds();
    await world.host.checkpointWorlds();

    expect(await world.receipts.pendingFor(ids.characterId)).toEqual([]);
    expect(await sweep(database, world.receipts, ids.characterId)).toEqual({ written: 0, failed: 0 });
    expect(await ledgerOf(database, ids.characterId)).toEqual([]);
  });
});
