import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionDirectory } from './directory.js';
import { connectTestRedis } from './testing/redis.js';

// A verificação precisa acontecer no TOPO DO MÓDULO, e não em `beforeAll`: o `runIf` do
// describe é avaliado na coleta, quando nenhum hook rodou ainda. Feito no beforeAll, ele
// sempre lê `false` e o arquivo inteiro pula em silêncio — que foi exatamente o que
// aconteceu na primeira versão deste teste.
const { redis, available } = await connectTestRedis(1);

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
    // Testar que a chave EXPIRA é testar o Redis (FUN-62). O que é nosso é ter mandado o
    // prazo certo — afirmado —, e o que a ausência do lease significa — provada apagando na
    // mão, que é o que a expiração faz, sem esperar por ela.
    const ttl = await redis.pttl('char:p1:session');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
    await redis.del('char:p1:session');
    expect(await directory.lookup('p1')).toBeNull();
  });

  it('renews sessions in a batch', async () => {
    const directory = new SessionDirectory(redis, { leaseMs: 10_000 });
    const ids = ['p1', 'p2', 'p3'];
    for (const id of ids) {
      await directory.register(id, { sessionId: id, nodeId: 'n1', type: 'hunt' });
      await redis.pexpire(`char:${id}:session`, 2_000);
    }
    await directory.renew(ids);
    for (const id of ids) {
      expect(await redis.pttl(`char:${id}:session`)).toBeGreaterThan(5_000);
      expect(await directory.lookup(id)).not.toBeNull();
    }
  });

  it('registers an authenticated session only while its active reservation exists', async () => {
    const directory = new SessionDirectory(redis, { leaseMs: 300 });
    const location = { sessionId: 's1', nodeId: 'n1', type: 'city' };

    expect(await directory.register('p1', location, 'a1')).toBe(false);
    expect(await directory.lookup('p1')).toBeNull();

    await directory.reserveSlot('a1', 'p1');
    expect(await directory.register('p1', location, 'a1')).toBe(true);
    expect(await directory.lookup('p1')).toEqual(location);
  });

  it('renews the active slot together with the owned session lease', async () => {
    const directory = new SessionDirectory(redis, { leaseMs: 10_000 });
    await directory.reserveSlot('a1', 'p1');
    await directory.register('p1', { sessionId: 's1', nodeId: 'n1', type: 'hunt' }, 'a1');

    await redis.pexpire('char:p1:session', 2_000);
    await redis.pexpire('account:a1:active', 2_000);
    await directory.renew([{ accountId: 'a1', characterId: 'p1' }]);
    expect(await redis.pttl('char:p1:session')).toBeGreaterThan(5_000);
    expect(await redis.pttl('account:a1:active')).toBeGreaterThan(5_000);
    expect(await directory.lookup('p1')).not.toBeNull();
    expect(await directory.activeSlots('a1')).toEqual(['p1']);
  });

  it('expires a node heartbeat', async () => {
    const directory = new SessionDirectory(redis, { leaseMs: 120 });
    await directory.heartbeat('n1', { sessions: 3, url: 'ws://n1:7171' });
    expect(await directory.isNodeAlive('n1')).toBe(true);
    const ttl = await redis.pttl('node:n1:heartbeat');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
    await redis.del('node:n1:heartbeat');
    expect(await directory.isNodeAlive('n1')).toBe(false);
  });
});

describe.runIf(available)('two active characters per account limit', () => {
  it('rejects a second node trying to overwrite a live character session', async () => {
    const directory = new SessionDirectory(redis);
    // O batimento é o que torna `n1` VIVO, e a partir da FUN-28 é essa a diferença que
    // decide: registro de nó vivo é intocável; registro de nó morto pode ser tomado, senão o
    // personagem fica inalcançável até o lease expirar. Sem esta linha o teste descrevia um
    // nó que não batia, ou seja, exatamente o caso oposto ao que o nome dele promete.
    await directory.heartbeat('n1', { sessions: 1, url: 'ws://n1:7171' });
    await directory.reserveSlot('a1', 'p1');
    const original = { sessionId: 's1', nodeId: 'n1', type: 'city' };
    const competing = { sessionId: 's2', nodeId: 'n2', type: 'city' };
    expect(await directory.register('p1', original, 'a1')).toBe(true);
    expect(await directory.register('p1', competing, 'a1')).toBe(false);
    expect(await directory.lookup('p1')).toEqual(original);
    expect(await directory.register('p1', original, 'a1')).toBe(true);
  });
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
    // O slot tem prazo — afirmado — e, sem ele, o terceiro entra. Apagar é o que a expiração
    // faz; esperá-la é testar o Redis.
    const ttl = await redis.pttl('account:a1:active');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
    await redis.del('account:a1:active');
    expect(await directory.reserveSlot('a1', 'p3')).toBe(true);
  });

  it('supports a configurable active character limit', async () => {
    const directory = new SessionDirectory(redis, { activeLimit: 1 });
    expect(await directory.reserveSlot('a1', 'p1')).toBe(true);
    expect(await directory.reserveSlot('a1', 'p2')).toBe(false);
  });

  it('refuses to take over a session while the owning node still beats', async () => {
    // Duas cópias da mesma sessão é PIOR que uma perdida: dobra loot e XP. Um nó que ainda
    // bate pode estar só numa pausa de GC — e essa é a diferença entre pausa e morte.
    const directory = new SessionDirectory(redis);
    await directory.heartbeat('n1', { sessions: 1, url: 'ws://n1:7171' });
    await directory.reserveSlot('a1', 'p1');
    await directory.register('p1', { sessionId: 's1', nodeId: 'n1', type: 'city' }, 'a1');

    const taken = await directory.register(
      'p1', { sessionId: 's1', nodeId: 'n2', type: 'city' }, 'a1',
    );

    expect(taken).toBe(false);
    expect((await directory.lookup('p1'))?.nodeId).toBe('n1');
  });

  it('takes over a session whose node stopped beating', async () => {
    // O registro do nó morto é um ponteiro para lugar nenhum. Insistir nele deixaria o
    // personagem inalcançável até o lease expirar — o que travava a retomada após kill -9.
    const directory = new SessionDirectory(redis);
    await directory.reserveSlot('a1', 'p1');
    await directory.register('p1', { sessionId: 's1', nodeId: 'morto', type: 'city' }, 'a1');
    // Sem batimento de `morto`: é assim que um nó que caiu se parece.

    const taken = await directory.register(
      'p1', { sessionId: 's1', nodeId: 'n2', type: 'city' }, 'a1',
    );

    expect(taken).toBe(true);
    expect((await directory.lookup('p1'))?.nodeId).toBe('n2');
  });

  it('refuses a take-over without the account reservation', async () => {
    // O slot é a autorização. Sem ele, qualquer nó poderia adotar qualquer personagem.
    const directory = new SessionDirectory(redis);
    await directory.reserveSlot('a1', 'p1');
    await directory.register('p1', { sessionId: 's1', nodeId: 'morto', type: 'city' }, 'a1');
    await directory.releaseSlot('a1', 'p1');

    expect(await directory.register(
      'p1', { sessionId: 's1', nodeId: 'n2', type: 'city' }, 'a1',
    )).toBe(false);
  });

  it('succeeds a session with another one on the same node (FUN-38)', async () => {
    // A transição Hunt → Cidade da morte. O `register` recusaria: ele existe para dois nós
    // não brigarem pelo mesmo personagem, e aqui o registro que existe é o nosso.
    const directory = new SessionDirectory(redis);
    await directory.reserveSlot('a1', 'p1');
    await directory.register('p1', { sessionId: 'hunt', nodeId: 'n1', type: 'hunt' }, 'a1');

    const moved = await directory.succeed(
      'p1', 'a1',
      { sessionId: 'hunt', nodeId: 'n1', type: 'hunt' },
      { sessionId: 'city', nodeId: 'n1', type: 'city' },
    );

    expect(moved).toBe(true);
    expect(await directory.lookup('p1'))
      .toEqual({ sessionId: 'city', nodeId: 'n1', type: 'city' });
  });

  it('refuses to succeed a registration that changed hands', async () => {
    // Escrever por cima de um dono que já não somos produziria duas cópias da mesma sessão —
    // e isso dobra XP e loot, que é pior que uma sessão perdida.
    const directory = new SessionDirectory(redis);
    await directory.reserveSlot('a1', 'p1');
    await directory.register('p1', { sessionId: 'outra', nodeId: 'n2', type: 'hunt' }, 'a1');

    const moved = await directory.succeed(
      'p1', 'a1',
      { sessionId: 'hunt', nodeId: 'n1', type: 'hunt' },
      { sessionId: 'city', nodeId: 'n1', type: 'city' },
    );

    expect(moved).toBe(false);
    expect((await directory.lookup('p1'))?.sessionId).toBe('outra');
  });

  it('refuses to succeed without the account reservation', async () => {
    // O slot é a autorização, aqui como em todo o resto do diretório.
    const directory = new SessionDirectory(redis);
    await directory.reserveSlot('a1', 'p1');
    await directory.register('p1', { sessionId: 'hunt', nodeId: 'n1', type: 'hunt' }, 'a1');
    await directory.releaseSlot('a1', 'p1');

    expect(await directory.succeed(
      'p1', 'a1',
      { sessionId: 'hunt', nodeId: 'n1', type: 'hunt' },
      { sessionId: 'city', nodeId: 'n1', type: 'city' },
    )).toBe(false);
  });

  it('responde "em jogo" numa ida só, com sessão OU com slot (FUN-53)', async () => {
    // Esta pergunta é feita com uma transação do Postgres ABERTA, segurando a linha do
    // personagem. Cada viagem extra ao Redis é tempo de linha travada, e numa lentidão do
    // Redis isso vira pool esgotado e toda rota que toca o banco parando de responder.
    const directory = new SessionDirectory(redis);

    expect(await directory.isActive('a1', 'p1')).toBe(false);

    // Só o slot reservado, ainda sem sessão: é o ticket emitido e não usado.
    await directory.reserveSlot('a1', 'p1');
    expect(await directory.isActive('a1', 'p1')).toBe(true);

    // Só a sessão, sem o slot da conta: é o caminho sem conta do host local.
    const directoryDois = new SessionDirectory(redis);
    await directoryDois.register('p2', { sessionId: 's2', nodeId: 'n1', type: 'hunt' });
    expect(await directoryDois.isActive('a2', 'p2')).toBe(true);
  });

  it('personagem de OUTRA conta não conta como ativo nesta', async () => {
    // O slot é por conta. Confundir as duas deixaria uma conta impedir a exclusão de um
    // personagem da outra.
    const directory = new SessionDirectory(redis);
    await directory.reserveSlot('a1', 'p1');
    expect(await directory.isActive('a2', 'p1')).toBe(false);
  });

  it('lists alive nodes with the URL each one published', async () => {
    const directory = new SessionDirectory(redis);
    await directory.heartbeat('n1', { sessions: 3, url: 'ws://n1:7171' });
    await directory.heartbeat('n2', { sessions: 9, url: 'ws://n2:7171' });

    const nodes = await directory.aliveNodes();
    expect(nodes.map((node) => node.nodeId).sort()).toEqual(['n1', 'n2']);
    expect(await directory.node('n2')).toEqual({ nodeId: 'n2', sessions: 9, url: 'ws://n2:7171' });
  });

  it('discards a heartbeat without a URL instead of returning an unreachable node', async () => {
    // Batimento de antes da migração. Rotear para ele produziria uma wsUrl vazia, e o
    // sintoma chegaria no cliente como "não conecta", longe da causa.
    const directory = new SessionDirectory(redis);
    await redis.set('node:n1:heartbeat', JSON.stringify({ sessions: 1 }), 'PX', 5_000);

    expect(await directory.isNodeAlive('n1')).toBe(true);
    expect(await directory.node('n1')).toBeNull();
    expect(await directory.aliveNodes()).toEqual([]);
  });
});
