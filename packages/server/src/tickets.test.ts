import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionDirectory } from './directory.js';
import { TicketService } from './tickets.js';
import type { InitialCharacter } from './tickets.js';
import { LONG_MS, SHORT_MS } from './testing/deadlines.js';
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

  it('carries server-authoritative character progress in the claim', async () => {
    const { directory, tickets } = build();
    await directory.heartbeat('n1', NODE);

    const issued = await tickets.issue('a1', 'p1', { level: 17, xp: 93_000 });
    if (!issued.ok) throw new Error('expected a ticket');

    expect(await tickets.consume(issued.value.ticket, 'n1')).toEqual({
      accountId: 'a1',
      characterId: 'p1',
      nodeId: 'n1',
      initialCharacter: { level: 17, xp: 93_000 },
    });
  });

  it('carries the character gold, and drops a value it cannot trust (FUN-77)', async () => {
    // O saldo tem de vir do banco pelo mesmo caminho que level e XP (invariante 4). E um valor
    // corrompido no claim vira AUSENTE, não zero implícito: a sessão entra com zero de qualquer
    // forma, mas quem lê o ticket consegue distinguir "não veio" de "veio como 0".
    const { directory, tickets } = build();
    await directory.heartbeat('n1', NODE);

    const bom = await tickets.issue('a1', 'p1', { level: 1, xp: 0, gold: 4_200 });
    if (!bom.ok) throw new Error('expected a ticket');
    expect(await tickets.consume(bom.value.ticket, 'n1')).toMatchObject({
      initialCharacter: { level: 1, xp: 0, gold: 4_200 },
    });

    const ruim = await tickets.issue(
      'a1', 'p1', { level: 1, xp: 0, gold: -5 } as unknown as InitialCharacter,
    );
    if (!ruim.ok) throw new Error('expected a ticket');
    expect(await tickets.consume(ruim.value.ticket, 'n1')).toEqual({
      accountId: 'a1', characterId: 'p1', nodeId: 'n1',
      initialCharacter: { level: 1, xp: 0 },
    });
  });

  it('carries the outfit colours, and drops a set it cannot trust (FUN-104)', async () => {
    // As cores vão pelo ticket como o nome: dado do personagem que só a apresentação lê. E um
    // valor corrompido — índice fora da paleta, peça faltando — vira AUSENTE, nunca ticket
    // recusado: a linha do banco é `jsonb` sem CHECK, e cor não pode trancar ninguém fora.
    const { directory, tickets } = build();
    await directory.heartbeat('n1', NODE);

    const colors = { head: 78, body: 69, legs: 58, feet: 76 };
    const bom = await tickets.issue('a1', 'p1', { level: 1, xp: 0, outfitColors: colors });
    if (!bom.ok) throw new Error('expected a ticket');
    expect(await tickets.consume(bom.value.ticket, 'n1')).toEqual({
      accountId: 'a1', characterId: 'p1', nodeId: 'n1',
      initialCharacter: { level: 1, xp: 0, outfitColors: colors },
    });

    for (const ruim of [
      { head: 133, body: 69, legs: 58, feet: 76 },
      { head: 78, body: 69, legs: 58 },
      { head: 'red', body: 69, legs: 58, feet: 76 },
      'azul',
    ]) {
      const issued = await tickets.issue(
        'a1', 'p1', { level: 1, xp: 0, outfitColors: ruim } as unknown as InitialCharacter,
      );
      if (!issued.ok) throw new Error('expected a ticket');
      expect(await tickets.consume(issued.value.ticket, 'n1')).toEqual({
        accountId: 'a1', characterId: 'p1', nodeId: 'n1',
        initialCharacter: { level: 1, xp: 0 },
      });
    }
  });

  it('carries the bestiary, and drops a map it cannot trust (FUN-113)', async () => {
    // Os abates entram na sessão pelo ticket porque o bônus dos marcos escala a XP DURANTE a
    // hunt (DT-01) — um personagem que entrasse em `{}` perderia o marco que já cruzou. E um
    // valor torto vira AUSENTE, nunca ticket recusado: a linha é `jsonb` sem CHECK, e uma
    // contagem corrompida não pode trancar ninguém fora do jogo. Mutação que mata: aceitar
    // qualquer objeto (o array e o `-1` passariam), ou recusar o mapa vazio.
    const { directory, tickets } = build();
    await directory.heartbeat('n1', NODE);

    const counts = { rat: 10_000, bat: 3 };
    const bom = await tickets.issue('a1', 'p1', { level: 1, xp: 0, bestiary: counts });
    if (!bom.ok) throw new Error('expected a ticket');
    expect(await tickets.consume(bom.value.ticket, 'n1')).toEqual({
      accountId: 'a1', characterId: 'p1', nodeId: 'n1',
      initialCharacter: { level: 1, xp: 0, bestiary: counts },
    });

    // O mapa VAZIO é válido: é o personagem que nunca abateu nada, e ele tem que atravessar
    // igual — distinguir "não veio" de "veio vazio" é do tipo, não do parse.
    const vazio = await tickets.issue('a1', 'p1', { level: 1, xp: 0, bestiary: {} });
    if (!vazio.ok) throw new Error('expected a ticket');
    expect(await tickets.consume(vazio.value.ticket, 'n1')).toMatchObject({
      initialCharacter: { level: 1, xp: 0, bestiary: {} },
    });

    for (const ruim of [
      { rat: -1 },
      { rat: 1.5 },
      { rat: '10' },
      { rat: Number.MAX_SAFE_INTEGER + 1 },
      { '': 4 },
      [10, 20],
      'muitos',
      null,
    ]) {
      const issued = await tickets.issue(
        'a1', 'p1', { level: 1, xp: 0, bestiary: ruim } as unknown as InitialCharacter,
      );
      if (!issued.ok) throw new Error('expected a ticket');
      expect(await tickets.consume(issued.value.ticket, 'n1'), JSON.stringify(ruim)).toEqual({
        accountId: 'a1', characterId: 'p1', nodeId: 'n1',
        initialCharacter: { level: 1, xp: 0 },
      });
    }
  });

  it('expires in seconds', async () => {
    const { directory, tickets } = build({ ttlMs: SHORT_MS });
    await directory.heartbeat('n1', NODE);

    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');
    // O claim expira por `PX` no Redis, e nenhum relógio injetado alcança isso (FUN-62). O que
    // é nosso é o prazo — afirmado — e o consumo depois dele, provado apagando o claim.
    const ttl = await redis.pttl(`ticket:${issued.value.ticket}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SHORT_MS);
    await redis.del(`ticket:${issued.value.ticket}`);

    expect(await tickets.consume(issued.value.ticket, 'n1')).toBeNull();
  });

  it('refuses a ticket presented to a node other than the one it was issued for', async () => {
    const { directory, tickets } = build();
    await directory.heartbeat('n1', NODE);

    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');

    expect(await tickets.consume(issued.value.ticket, 'n2')).toBeNull();
    expect(await tickets.consume(issued.value.ticket, 'n1')).not.toBeNull();
  });

  it('refuses a ticket after its active reservation was removed', async () => {
    const { directory, tickets } = build();
    await directory.heartbeat('n1', NODE);
    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');

    await directory.releaseSlot('a1', 'p1');
    expect(await tickets.consume(issued.value.ticket, 'n1')).toBeNull();
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

  it('routes to a live node when the session node stopped answering', async () => {
    // RETOMADA (FUN-28). O registro de um nó que parou de bater é um ponteiro para lugar
    // nenhum; recusar aqui — como era antes — deixava o personagem inalcançável até o lease
    // expirar sozinho, e depois de um `kill -9` isso é meio minuto de "não consigo entrar".
    //
    // Duas cópias continuam impossíveis: a tomada do registro é atômica e condicionada à
    // AUSÊNCIA do batimento do nó antigo (ver directory.test.ts).
    const { directory, tickets } = build();
    await directory.heartbeat('n2', { sessions: 0, url: 'ws://n2:7171' });
    await directory.register('p1', { sessionId: 's1', nodeId: 'dead', type: 'hunt' });

    const issued = await tickets.issue('a1', 'p1');
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.value.nodeId).toBe('n2');
  });

  it('refuses when the session node died and there is nowhere to move it', async () => {
    // Sem nó vivo não há retomada possível. Emitir ticket para um endereço que não existe
    // faria o cliente tentar, falhar e recomeçar em laço, sem nada dizendo o porquê.
    const { directory, tickets } = build();
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
    const { directory, tickets } = build({ ttlMs: SHORT_MS, graceMs: SHORT_MS, now: () => now });
    await directory.heartbeat('n1', NODE);

    await tickets.issue('a1', 'p1');
    expect(await directory.activeSlots('a1')).toEqual(['p1']);

    now += 10_000;
    expect(await tickets.sweepAbandoned()).toBe(1);
    expect(await directory.activeSlots('a1')).toEqual([]);
  });

  it('keeps the slot of a ticket that became a session', async () => {
    let now = 1_000_000;
    const { directory, tickets } = build({ ttlMs: SHORT_MS, graceMs: SHORT_MS, now: () => now });
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
    const { directory, tickets } = build({ ttlMs: SHORT_MS, graceMs: SHORT_MS, now: () => now });
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
    const { directory, tickets } = build({ ttlMs: SHORT_MS, graceMs: SHORT_MS, now: () => now });
    await directory.heartbeat('n1', NODE);

    await tickets.issue('a1', 'p1');
    expect(await tickets.sweepAbandoned()).toBe(0);
    expect(await directory.activeSlots('a1')).toEqual(['p1']);
  });

  it('reserves the active slot through the ticket grace period', async () => {
    // Já foi uma espera de relógio com folga alargada duas vezes (FUN-62). O que se afirma
    // é que a reserva SOBREVIVE ao ticket pela carência — e isso é um prazo gravado, não um
    // prazo esperado: o claim tem o TTL do ticket, o slot tem o da carência, e apagar o claim
    // é exatamente o que a expiração dele faria.
    const directory = new SessionDirectory(redis, { leaseMs: SHORT_MS });
    const tickets = new TicketService(redis, directory, { ttlMs: SHORT_MS, graceMs: LONG_MS });
    await directory.heartbeat('n1', NODE);

    const issued = await tickets.issue('a1', 'p1');
    if (!issued.ok) throw new Error('expected a ticket');
    expect(await redis.pttl(`ticket:${issued.value.ticket}`)).toBeLessThanOrEqual(SHORT_MS);
    expect(await redis.pttl('account:a1:active')).toBeGreaterThan(SHORT_MS);
    await redis.del(`ticket:${issued.value.ticket}`);

    expect(await directory.activeSlots('a1')).toEqual(['p1']);
  });

  it('does not sweep a reservation reissued after the due list was read', async () => {
    // Quem decide se a reserva está VENCIDA é o relógio injetado, que o teste controla; quem
    // decide se ela ainda EXISTE é o `PX` do Redis, que ninguém controla. A carência só
    // precisa ser maior que o tempo que o teste leva — milissegundos —, e cinco segundos é
    // folga, não espera: nada aqui dorme (FUN-62).
    let now = 1_000_000;
    const { directory, tickets } = build({ ttlMs: SHORT_MS, graceMs: SHORT_MS, now: () => now });
    await directory.heartbeat('n1', NODE);
    await tickets.issue('a1', 'p1');
    now += 60_000;

    const original = redis.zrangebyscore.bind(redis);
    const mutableRedis = redis as typeof redis & {
      zrangebyscore: typeof redis.zrangebyscore;
    };
    mutableRedis.zrangebyscore = (async (...args: Parameters<typeof redis.zrangebyscore>) => {
      const due = await original(...args);
      await tickets.issue('a1', 'p1');
      return due;
    }) as typeof redis.zrangebyscore;
    try {
      expect(await tickets.sweepAbandoned()).toBe(0);
      expect(await directory.activeSlots('a1')).toEqual(['p1']);
    } finally {
      mutableRedis.zrangebyscore = original;
    }
  });

  it('rejects an empty or unknown ticket', async () => {
    const { tickets } = build();
    expect(await tickets.consume('', 'n1')).toBeNull();
    expect(await tickets.consume('nope', 'n1')).toBeNull();
  });
});
