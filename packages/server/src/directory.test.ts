import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionDirectory } from './directory.js';

const URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// A verificação precisa acontecer no TOPO DO MÓDULO, e não em `beforeAll`: o `runIf` do
// describe é avaliado na coleta, quando nenhum hook rodou ainda. Feito no beforeAll, ele
// sempre lê `false` e o arquivo inteiro pula em silêncio — que foi exatamente o que
// aconteceu na primeira versão deste teste.
const redis = new Redis(URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
let available = false;
try {
  await redis.connect();
  await redis.ping();
  available = true;
} catch {
  redis.disconnect();
}

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

// Sem Redis o arquivo pula. No CI o serviço sobe junto, então lá ele roda sempre.
describe.runIf(available)('session directory', () => {
  it('registers, looks up, and releases a session', async () => {
    const directory = new SessionDirectory(redis);
    await directory.register('p1', { sessionId: 's1', nodeId: 'n1', type: 'hunt' });
    expect(await directory.lookup('p1')).toEqual({ sessionId: 's1', nodeId: 'n1', type: 'hunt' });
    await directory.release('p1');
    expect(await directory.lookup('p1')).toBeNull();
  });

  it.each([
    ['hunt', 'hunt'],
    ['cidade', 'city'],
    ['treino', 'training'],
  ])('reads legacy session type %s as %s without losing the session', async (legacyType, type) => {
    const directory = new SessionDirectory(redis);
    await redis.set(
      'char:p1:session',
      // A chave antiga é dado de compatibilidade; novas escritas usam `type`.
      JSON.stringify({ sessionId: 's1', nodeId: 'n1', ['tipo']: legacyType }),
      'PX',
      1_000,
    );

    expect(await directory.lookup('p1')).toEqual({ sessionId: 's1', nodeId: 'n1', type });
  });

  it('expires a lease and exposes the session as orphaned', async () => {
    // É assim que um nó morto é detectado sem coordenação nenhuma (FUN-28).
    const directory = new SessionDirectory(redis, { leaseMs: 120 });
    await directory.register('p1', { sessionId: 's1', nodeId: 'n1', type: 'hunt' });
    expect(await directory.lookup('p1')).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await directory.lookup('p1')).toBeNull();
  });

  it('renews sessions in a batch', async () => {
    const directory = new SessionDirectory(redis, { leaseMs: 300 });
    const ids = ['p1', 'p2', 'p3'];
    for (const id of ids) {
      await directory.register(id, { sessionId: id, nodeId: 'n1', type: 'hunt' });
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    await directory.renew(ids);
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const id of ids) expect(await directory.lookup(id)).not.toBeNull();
  });

  it('expires a node heartbeat', async () => {
    const directory = new SessionDirectory(redis, { leaseMs: 120 });
    await directory.heartbeat('n1', { sessions: 3 });
    expect(await directory.isNodeAlive('n1')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await directory.isNodeAlive('n1')).toBe(false);
  });
});

describe.runIf(available)('two active characters per account limit', () => {
  it('allows exactly two characters across ten simultaneous attempts', async () => {
    // O TESTE QUE DEFINE A FUN-15. Verificação otimista passaria aqui e falharia em
    // produção; só a atomicidade do script Lua segura o teto sob concorrência.
    const directory = new SessionDirectory(redis);
    const attempts = Array.from({ length: 10 }, (_, index) =>
      directory.reserveSlot('account-1', `p${(index % 3) + 1}`),
    );
    const results = await Promise.all(attempts);
    expect(results.filter(Boolean).length).toBeGreaterThan(0);
    expect((await directory.activeSlots('account-1')).length).toBe(2);
  });

  it('allows the same character to reconnect', async () => {
    const directory = new SessionDirectory(redis);
    expect(await directory.reserveSlot('a1', 'p1')).toBe(true);
    expect(await directory.reserveSlot('a1', 'p1')).toBe(true);
    expect(await directory.reserveSlot('a1', 'p1')).toBe(true);
    expect(await directory.activeSlots('a1')).toEqual(['p1']);
  });

  it('rejects a third character until a slot is released', async () => {
    const directory = new SessionDirectory(redis);
    expect(await directory.reserveSlot('a1', 'p1')).toBe(true);
    expect(await directory.reserveSlot('a1', 'p2')).toBe(true);
    expect(await directory.reserveSlot('a1', 'p3')).toBe(false);
    await directory.releaseSlot('a1', 'p1');
    expect(await directory.reserveSlot('a1', 'p3')).toBe(true);
  });

  it('keeps different accounts independent', async () => {
    const directory = new SessionDirectory(redis);
    expect(await directory.reserveSlot('a1', 'p1')).toBe(true);
    expect(await directory.reserveSlot('a1', 'p2')).toBe(true);
    expect(await directory.reserveSlot('a2', 'p3')).toBe(true);
    expect(await directory.reserveSlot('a2', 'p4')).toBe(true);
  });

  it('releases slots from dead nodes through expiration', async () => {
    // Sem TTL, um slot vazado é permanente — e o sintoma para o jogador é "não consigo
    // mais logar", que ninguém relaciona com sessão.
    const directory = new SessionDirectory(redis, { leaseMs: 120 });
    await directory.reserveSlot('a1', 'p1');
    await directory.reserveSlot('a1', 'p2');
    expect(await directory.reserveSlot('a1', 'p3')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await directory.reserveSlot('a1', 'p3')).toBe(true);
  });

  it('supports a configurable active character limit', async () => {
    const directory = new SessionDirectory(redis, { activeLimit: 1 });
    expect(await directory.reserveSlot('a1', 'p1')).toBe(true);
    expect(await directory.reserveSlot('a1', 'p2')).toBe(false);
  });
});
