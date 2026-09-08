import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionDirectory } from './directory.js';
import { TicketService } from './tickets.js';
import { connectTestRedis } from './testing/redis.js';

// A checagem fica no topo do módulo, e não em `beforeAll`: `describe.runIf` é avaliado na
// coleta, quando nenhum hook rodou. Ver o comentário longo em directory.test.ts. O banco 2
// é deste arquivo — ver testing/redis.ts para por que cada arquivo tem o seu.
const { redis, available } = await connectTestRedis(2);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

const NODE = { sessions: 0, url: 'ws://n1:7171' } as const;

describe.runIf(available)('session ticket', () => {
  function build(options: { ttlMs?: number; graceMs?: number; now?: () => number } = {}) {
    const directory = new SessionDirectory(redis);
    return { directory, tickets: new TicketService(redis, directory, options) };
  }

  it('authenticates once and fails on the second attempt', async () => {
    const { directory, tickets } = build();
    await directory.heartbeat('n1', NODE);

    const issued = await tickets.issue('a1', 'p1');
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    expect(await tickets.consume(issued.value.ticket, 'n1')).toEqual({
      accountId: 'a1', characterId: 'p1', nodeId: 'n1',
    });
    // O segundo uso é o ataque que o GETDEL fecha: dois sockets com o mesmo ticket seriam
    // duas sessões do mesmo personagem.
    expect(await tickets.consume(issued.value.ticket, 'n1')).toBeNull();
  });

  it('expires in seconds', async () => {
    const { directory, tickets } = build({ ttlMs: 120 });
    await directory.heartbeat('n1', NODE);

    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await tickets.consume(issued.value.ticket, 'n1')).toBeNull();
  });

  it('refuses a ticket presented to a node other than the one it was issued for', async () => {
    const { directory, tickets } = build();
    await directory.heartbeat('n1', NODE);

    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');

    expect(await tickets.consume(issued.value.ticket, 'n2')).toBeNull();
  });

  it('sends a reconnection back to the node that already hosts the session', async () => {
    const { directory, tickets } = build();
    await directory.heartbeat('n1', { sessions: 40, url: 'ws://n1:7171' });
    await directory.heartbeat('n2', { sessions: 0, url: 'ws://n2:7171' });
    await directory.register('p1', { sessionId: 's1', nodeId: 'n1', type: 'hunt' });

    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');

    // n2 está vazio e seria a escolha óbvia por carga. Mandar para lá criaria a segunda
    // sessão do mesmo personagem — o invariante 8 vale mais que o balanceamento.
    expect(issued.value.nodeId).toBe('n1');
    expect(issued.value.wsUrl).toContain('n1:7171');
  });

  it('refuses when the session exists but its node stopped answering', async () => {
    const { directory, tickets } = build();
    await directory.heartbeat('n2', { sessions: 0, url: 'ws://n2:7171' });
    await directory.register('p1', { sessionId: 's1', nodeId: 'dead', type: 'hunt' });

    expect(await tickets.issue('a1', 'p1')).toEqual({
      ok: false, reason: 'session-node-unavailable',
    });
  });

  it('refuses when no game node is beating', async () => {
    const { tickets } = build();
    expect(await tickets.issue('a1', 'p1')).toEqual({ ok: false, reason: 'no-node-available' });
  });

  it('refuses a third active character on the same account', async () => {
    const { directory, tickets } = build();
    await directory.heartbeat('n1', NODE);

    expect((await tickets.issue('a1', 'p1')).ok).toBe(true);
    expect((await tickets.issue('a1', 'p2')).ok).toBe(true);
    expect(await tickets.issue('a1', 'p3')).toEqual({ ok: false, reason: 'active-limit' });
  });

  it('picks the least loaded node', async () => {
    const { directory, tickets } = build();
    await directory.heartbeat('n1', { sessions: 120, url: 'ws://n1:7171' });
    await directory.heartbeat('n2', { sessions: 7, url: 'ws://n2:7171' });

    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');
    expect(issued.value.nodeId).toBe('n2');
  });

  it('carries the ticket in the wsUrl without losing the node address', async () => {
    const { directory, tickets } = build();
    await directory.heartbeat('n1', NODE);

    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');

    const url = new URL(issued.value.wsUrl);
    expect(url.protocol).toBe('ws:');
    expect(url.host).toBe('n1:7171');
    expect(url.searchParams.get('ticket')).toBe(issued.value.ticket);
  });

  it('gives the slot back when the connection never arrives', async () => {
    // Abandonar o ticket é o caso comum: o jogador fecha a aba entre pedir e conectar.
    // Sem a varredura ele fica com um dos dois slots preso, e o sintoma é "não consigo
    // logar meu outro personagem".
    let now = 1_000_000;
    const { directory, tickets } = build({ ttlMs: 50, graceMs: 50, now: () => now });
    await directory.heartbeat('n1', NODE);

    await tickets.issue('a1', 'p1');
    expect(await directory.activeSlots('a1')).toEqual(['p1']);

    now += 10_000;
    expect(await tickets.sweepAbandoned()).toBe(1);
    expect(await directory.activeSlots('a1')).toEqual([]);
  });

  it('keeps the slot of a ticket that became a session', async () => {
    let now = 1_000_000;
    const { directory, tickets } = build({ ttlMs: 50, graceMs: 50, now: () => now });
    await directory.heartbeat('n1', NODE);

    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');
    await tickets.consume(issued.value.ticket, 'n1');
    await directory.register('p1', { sessionId: 's1', nodeId: 'n1', type: 'hunt' });

    now += 10_000;
    expect(await tickets.sweepAbandoned()).toBe(0);
    expect(await directory.activeSlots('a1')).toEqual(['p1']);
  });

  it('gives the slot back when the ticket was consumed but no session appeared', async () => {
    // Conexão morta no handshake: o ticket foi queimado e nenhuma sessão nasceu. A mesma
    // regra da varredura cobre este caso, sem caminho de limpeza próprio.
    let now = 1_000_000;
    const { directory, tickets } = build({ ttlMs: 50, graceMs: 50, now: () => now });
    await directory.heartbeat('n1', NODE);

    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');
    await tickets.consume(issued.value.ticket, 'n1');

    now += 10_000;
    expect(await tickets.sweepAbandoned()).toBe(1);
    expect(await directory.activeSlots('a1')).toEqual([]);
  });

  it('does not sweep a ticket that is still within its deadline', async () => {
    const now = 1_000_000;
    const { directory, tickets } = build({ ttlMs: 50, graceMs: 50, now: () => now });
    await directory.heartbeat('n1', NODE);

    await tickets.issue('a1', 'p1');
    expect(await tickets.sweepAbandoned()).toBe(0);
    expect(await directory.activeSlots('a1')).toEqual(['p1']);
  });

  it('rejects an empty or unknown ticket', async () => {
    const { tickets } = build();
    expect(await tickets.consume('', 'n1')).toBeNull();
    expect(await tickets.consume('nope', 'n1')).toBeNull();
  });
});
