import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '@draconya/sim';
import { SessionDirectory } from './directory.js';
import { SnapshotStore } from './snapshots.js';
import { sweepOrphanedSessions } from './jobs/orphans.js';
import { createLogger } from './log.js';
import { LONG_MS, SHORT_MS } from './testing/deadlines.js';
import { connectTestRedis } from './testing/redis.js';

const { redis, available } = await connectTestRedis(6);
const logger = createLogger('silent', 'test');

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

const snapshotOf = (id: string): SessionSnapshot => ({
  formatVersion: 2,
  contentVersion: 'v1',
  id,
  type: 'city',
  createdAtMs: 0,
  logicalNowMs: 0,
  schedule: { events: [], nextSeq: 0 },
  rng: { a: 1, b: 2, c: 3, d: 4 },
  participants: [],
  aggregates: {
    durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0,
       itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
       damageDealt: 0, healingDone: 0,
  },
  notableEvents: [],
  ledgerSeq: 0,
  endedReason: null,
});

describe.runIf(available)('snapshot store', () => {
  it('round-trips a snapshot', async () => {
    const store = new SnapshotStore(redis);
    await store.save('p1', 'a1', 'n1', snapshotOf('s1'));

    const stored = await store.load('p1');
    expect(stored?.characterId).toBe('p1');
    expect(stored?.accountId).toBe('a1');
    expect(stored?.snapshot.id).toBe('s1');
  });

  it('survives the lease it is meant to outlive', async () => {
    // O lease morre com o nó; o snapshot não. A diferença entre os dois É a definição de
    // sessão órfã, então um TTL curto aqui apagaria justamente a coisa a ser retomada.
    const directory = new SessionDirectory(redis, { leaseMs: SHORT_MS });
    const store = new SnapshotStore(redis, { ttlMs: LONG_MS });
    await directory.reserveSlot('a1', 'p1');
    await directory.register('p1', { sessionId: 's1', nodeId: 'n1', type: 'city' }, 'a1');
    await store.save('p1', 'a1', 'n1', snapshotOf('s1'));

    // Os dois prazos, afirmados: o lease é curto, o snapshot é longo. Depois, o lease é
    // apagado na mão — é o que a expiração faz — e o snapshot precisa continuar lá.
    expect(await redis.pttl('char:p1:session')).toBeLessThanOrEqual(SHORT_MS);
    expect(await redis.pttl('session:p1:snapshot')).toBeGreaterThan(SHORT_MS);
    await redis.del('char:p1:session');

    expect(await directory.lookup('p1')).toBeNull();
    expect(await store.load('p1')).not.toBeNull();
  });

  it('lists stored characters without blocking Redis with KEYS', async () => {
    const store = new SnapshotStore(redis);
    await store.save('p1', 'a1', 'n1', snapshotOf('s1'));
    await store.save('p2', 'a1', 'n1', snapshotOf('s2'));

    expect((await store.storedCharacterIds()).sort()).toEqual(['p1', 'p2']);
  });

  it('refuses a corrupted payload instead of returning half a session', async () => {
    await redis.set('session:p1:snapshot', '{"characterId":"p1"}');
    expect(await new SnapshotStore(redis).load('p1')).toBeNull();
  });
});

describe.runIf(available)('orphan sweep', () => {
  const sweep = (now: number, graceMs = 120_000) => sweepOrphanedSessions({
    directory: new SessionDirectory(redis),
    snapshots: new SnapshotStore(redis),
    logger,
    graceMs,
    now: () => now,
  });

  it('leaves a session alone while its lease is alive', async () => {
    const directory = new SessionDirectory(redis);
    const store = new SnapshotStore(redis, { now: () => 1_000 });
    await directory.reserveSlot('a1', 'p1');
    await directory.register('p1', { sessionId: 's1', nodeId: 'n1', type: 'city' }, 'a1');
    await store.save('p1', 'a1', 'n1', snapshotOf('s1'));

    expect(await sweep(999_999)).toEqual({ examined: 1, orphaned: 0, released: 0 });
    expect(await directory.activeSlots('a1')).toEqual(['p1']);
  });

  it('waits out the grace period before touching an orphan', async () => {
    // O nó pode estar numa pausa de GC ou reiniciando. Devolver o slot cedo demais deixa o
    // jogador entrar com um terceiro personagem enquanto o nó volta com o primeiro.
    const store = new SnapshotStore(redis, { now: () => 1_000 });
    await new SessionDirectory(redis).reserveSlot('a1', 'p1');
    await store.save('p1', 'a1', 'n1', snapshotOf('s1'));

    expect(await sweep(1_000 + 60_000)).toEqual({ examined: 1, orphaned: 1, released: 0 });
    expect(await new SessionDirectory(redis).activeSlots('a1')).toEqual(['p1']);
  });

  it('gives the slot back but KEEPS the snapshot', async () => {
    // §38.4: uma hunt AFK não pode sumir em silêncio. O slot volta para o jogador usar os
    // outros personagens; o progresso continua lá esperando quem vai voltar.
    const directory = new SessionDirectory(redis);
    const store = new SnapshotStore(redis, { now: () => 1_000 });
    await directory.reserveSlot('a1', 'p1');
    await store.save('p1', 'a1', 'n1', snapshotOf('s1'));

    expect(await sweep(1_000 + 200_000)).toEqual({ examined: 1, orphaned: 1, released: 1 });
    expect(await directory.activeSlots('a1')).toEqual([]);
    expect(await store.load('p1')).not.toBeNull();
  });
});
