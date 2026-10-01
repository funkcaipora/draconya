// A Boosted Creature do dia (#615, ADR 0054 decisão 7): `WorldDailyStore.ensureDay` sorteia
// UMA vez por dia — o `INSERT … ON CONFLICT (day) DO NOTHING` é a idempotência —, escreve
// Postgres e Redis, e uma segunda chamada no mesmo dia lê a mesma linha de volta em vez de
// sortear de novo. Índice de Redis 10 (livre desde o ADR 0048 retirar a Caixa de Loot) —
// registrado em `testing/redis.ts`.

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { worldDaily } from './db/schema.js';
import { connectTestDatabase, type TestDatabase } from './testing/database.js';
import { connectTestRedis } from './testing/redis.js';
import { readCachedBoostedMonsterId, WorldDailyStore } from './world-daily.js';

const { redis, available: redisReady } = await connectTestRedis(10);

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

describe.runIf(ready)('WorldDailyStore.ensureDay (#615)', () => {
  it('sorteia na primeira chamada, e grava Postgres e Redis', async () => {
    const store = new WorldDailyStore(redis, db!.database.db);
    const boostedMonsterId = await store.ensureDay('2026-09-28', () => 'dragon');
    expect(boostedMonsterId).toBe('dragon');

    const [row] = await db!.database.db
      .select({ boostedMonsterId: worldDaily.boostedMonsterId })
      .from(worldDaily).where(eq(worldDaily.day, '2026-09-28'));
    expect(row?.boostedMonsterId).toBe('dragon');

    expect(await readCachedBoostedMonsterId(redis)).toBe('dragon');
  });

  it('idempotente no mesmo dia: a segunda chamada NÃO sorteia de novo', async () => {
    const store = new WorldDailyStore(redis, db!.database.db);
    const first = await store.ensureDay('2026-09-28', () => 'dragon');
    // Um candidato DIFERENTE — se a segunda chamada sorteasse de novo, o resultado mudaria.
    const second = await store.ensureDay('2026-09-28', () => 'dragon-lord');
    expect(first).toBe('dragon');
    expect(second).toBe('dragon');

    const rows = await db!.database.db
      .select({ boostedMonsterId: worldDaily.boostedMonsterId })
      .from(worldDaily).where(eq(worldDaily.day, '2026-09-28'));
    // Uma linha só — o `ON CONFLICT DO NOTHING` recusou a segunda tentativa de inserir.
    expect(rows).toHaveLength(1);
    expect(await readCachedBoostedMonsterId(redis)).toBe('dragon');
  });

  it('dias diferentes sorteiam separadamente', async () => {
    const store = new WorldDailyStore(redis, db!.database.db);
    const day1 = await store.ensureDay('2026-09-28', () => 'dragon');
    const day2 = await store.ensureDay('2026-09-29', () => 'dragon-lord');
    expect(day1).toBe('dragon');
    expect(day2).toBe('dragon-lord');
    // O cache reflete o ÚLTIMO `ensureDay` chamado — é o `jobs` quem decide a ordem no
    // ciclo real, e o dia mais recente é o que a `api` deve servir.
    expect(await readCachedBoostedMonsterId(redis)).toBe('dragon-lord');
  });
});
