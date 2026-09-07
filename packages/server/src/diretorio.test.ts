import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DiretorioDeSessoes } from './diretorio.js';

const URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// A verificação precisa acontecer no TOPO DO MÓDULO, e não em `beforeAll`: o `runIf` do
// describe é avaliado na coleta, quando nenhum hook rodou ainda. Feito no beforeAll, ele
// sempre lê `false` e o arquivo inteiro pula em silêncio — que foi exatamente o que
// aconteceu na primeira versão deste teste.
const redis = new Redis(URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
let disponivel = false;
try {
  await redis.connect();
  await redis.ping();
  disponivel = true;
} catch {
  redis.disconnect();
}

afterAll(async () => {
  if (disponivel) await redis.quit();
});

beforeEach(async () => {
  if (disponivel) await redis.flushdb();
});

// Sem Redis o arquivo pula. No CI o serviço sobe junto, então lá ele roda sempre.
describe.runIf(disponivel)('diretório de sessões', () => {
  it('registra, encontra e libera', async () => {
    const d = new DiretorioDeSessoes(redis);
    await d.registrar('p1', { sessionId: 's1', nodeId: 'n1', tipo: 'hunt' });
    expect(await d.ondeEsta('p1')).toEqual({ sessionId: 's1', nodeId: 'n1', tipo: 'hunt' });
    await d.liberar('p1');
    expect(await d.ondeEsta('p1')).toBeNull();
  });

  it('o lease expira e a sessão fica visível como órfã', async () => {
    // É assim que um nó morto é detectado sem coordenação nenhuma (FUN-28).
    const d = new DiretorioDeSessoes(redis, { leaseMs: 120 });
    await d.registrar('p1', { sessionId: 's1', nodeId: 'n1', tipo: 'hunt' });
    expect(await d.ondeEsta('p1')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    expect(await d.ondeEsta('p1')).toBeNull();
  });

  it('renovar em lote mantém as sessões vivas', async () => {
    const d = new DiretorioDeSessoes(redis, { leaseMs: 300 });
    const ids = ['p1', 'p2', 'p3'];
    for (const id of ids) await d.registrar(id, { sessionId: id, nodeId: 'n1', tipo: 'hunt' });
    await new Promise((r) => setTimeout(r, 150));
    await d.renovar(ids);
    await new Promise((r) => setTimeout(r, 200));
    for (const id of ids) expect(await d.ondeEsta(id)).not.toBeNull();
  });

  it('heartbeat de nó expira sozinho', async () => {
    const d = new DiretorioDeSessoes(redis, { leaseMs: 120 });
    await d.pulsar('n1', { sessoes: 3 });
    expect(await d.noEstaVivo('n1')).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(await d.noEstaVivo('n1')).toBe(false);
  });
});

describe.runIf(disponivel)('limite de 2 personagens ativos por conta', () => {
  it('dez tentativas simultâneas com três personagens resultam em exatamente dois', async () => {
    // O TESTE QUE DEFINE A FUN-15. Verificação otimista passaria aqui e falharia em
    // produção; só a atomicidade do script Lua segura o teto sob concorrência.
    const d = new DiretorioDeSessoes(redis);
    const tentativas = Array.from({ length: 10 }, (_, i) =>
      d.reservarSlot('conta-1', `p${(i % 3) + 1}`),
    );
    const resultados = await Promise.all(tentativas);
    expect(resultados.filter(Boolean).length).toBeGreaterThan(0);
    expect((await d.slotsAtivos('conta-1')).length).toBe(2);
  });

  it('o mesmo personagem reconectando não é recusado por ele mesmo', async () => {
    const d = new DiretorioDeSessoes(redis);
    expect(await d.reservarSlot('c1', 'p1')).toBe(true);
    expect(await d.reservarSlot('c1', 'p1')).toBe(true);
    expect(await d.reservarSlot('c1', 'p1')).toBe(true);
    expect(await d.slotsAtivos('c1')).toEqual(['p1']);
  });

  it('o terceiro personagem é recusado, e passa depois que um sai', async () => {
    const d = new DiretorioDeSessoes(redis);
    expect(await d.reservarSlot('c1', 'p1')).toBe(true);
    expect(await d.reservarSlot('c1', 'p2')).toBe(true);
    expect(await d.reservarSlot('c1', 'p3')).toBe(false);
    await d.liberarSlot('c1', 'p1');
    expect(await d.reservarSlot('c1', 'p3')).toBe(true);
  });

  it('contas diferentes não competem entre si', async () => {
    const d = new DiretorioDeSessoes(redis);
    expect(await d.reservarSlot('c1', 'p1')).toBe(true);
    expect(await d.reservarSlot('c1', 'p2')).toBe(true);
    expect(await d.reservarSlot('c2', 'p3')).toBe(true);
    expect(await d.reservarSlot('c2', 'p4')).toBe(true);
  });

  it('slot de nó morto se liberta sozinho, em vez de virar conta travada', async () => {
    // Sem TTL, um slot vazado é permanente — e o sintoma para o jogador é "não consigo
    // mais logar", que ninguém relaciona com sessão.
    const d = new DiretorioDeSessoes(redis, { leaseMs: 120 });
    await d.reservarSlot('c1', 'p1');
    await d.reservarSlot('c1', 'p2');
    expect(await d.reservarSlot('c1', 'p3')).toBe(false);
    await new Promise((r) => setTimeout(r, 200));
    expect(await d.reservarSlot('c1', 'p3')).toBe(true);
  });

  it('o teto é configurável, para o caso de o produto mudar de ideia', async () => {
    const d = new DiretorioDeSessoes(redis, { tetoDeAtivos: 1 });
    expect(await d.reservarSlot('c1', 'p1')).toBe(true);
    expect(await d.reservarSlot('c1', 'p2')).toBe(false);
  });
});
