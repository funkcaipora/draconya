import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ReceiptStore, type SessionReceipt } from './receipts.js';
import { connectTestRedis } from './testing/redis.js';

const { redis, available } = await connectTestRedis(8);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

const receiptOf = (
  sessionId: string, characterId: string, overrides: Partial<SessionReceipt> = {},
): Omit<SessionReceipt, 'endedAtMs'> => ({
  sessionId,
  characterId,
  accountId: 'a1',
  reason: 'drain',
  seq: 1,
  aggregates: {
    durationMs: 60_000, xpGained: 400, goldGained: 90, goldSpent: 10, kills: 4, deaths: 0,
       itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
  },
  notableEvents: [],
  ...overrides,
});

describe.runIf(available)('pending receipts of one character (FUN-56)', () => {
  it('answers with that character alone, not the whole queue', async () => {
    // É a razão de o índice existir: quem emite ticket precisa saber se AQUELE personagem
    // tem crédito esperando, e varrer o keyspace inteiro a cada login não é resposta.
    const store = new ReceiptStore(redis);
    const mine = randomUUID();
    const theirs = randomUUID();
    await store.save(receiptOf(randomUUID(), mine));
    await store.save(receiptOf(randomUUID(), mine, { seq: 2 }));
    await store.save(receiptOf(randomUUID(), theirs));

    const found = await store.pendingFor(mine);

    expect(found).toHaveLength(2);
    expect(found.every((receipt) => receipt.characterId === mine)).toBe(true);
    expect(await store.pending()).toHaveLength(3);
  });

  it('has nothing to say about a character that never played', async () => {
    expect(await new ReceiptStore(redis).pendingFor(randomUUID())).toEqual([]);
  });

  it('stops answering once the receipt is credited', async () => {
    // `remove` apaga os dois lados. Deixar o índice para trás faria o extrato já creditado
    // voltar como pendente na próxima emissão de ticket.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await store.save(receiptOf(sessionId, characterId));

    await store.remove(sessionId, characterId);

    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await redis.smembers(`receipts:char:${characterId}`)).toEqual([]);
  });

  it('drops an index entry whose receipt is gone, instead of returning a phantom', async () => {
    // Acontece de dois jeitos: o extrato expirou pelo TTL, ou um `remove` morreu entre
    // apagar o extrato e limpar o índice. Sem a limpeza na leitura, o conjunto de um
    // personagem que joga todo dia cresce para sempre.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await store.save(receiptOf(sessionId, characterId));
    await redis.del(`receipt:${sessionId}:${characterId}`);

    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await redis.smembers(`receipts:char:${characterId}`)).toEqual([]);
  });

  it('ignores a receipt written before the index existed, and lets the sweep have it', async () => {
    // Degradação de deploy em rolagem: um nó `game` antigo grava só `receipt:{sessionId}`.
    // Aquele personagem volta a esperar a varredura — o comportamento de antes desta issue,
    // que é o pior aceitável — mas o crédito NÃO se perde.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const sessionId = randomUUID();
    await redis.set(
      `receipt:${sessionId}`,
      JSON.stringify({ ...receiptOf(sessionId, characterId), endedAtMs: 1 }),
    );

    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await store.pending()).toHaveLength(1);
  });

  it('stops at a ceiling, because this runs on the path of an HTTP request', async () => {
    // Cada extrato custa uma transação no Postgres. Encostar no teto significa que a
    // varredura está parada há um bom tempo, e nesse mundo o certo é o login continuar
    // rápido e o resto sair no próximo — não a emissão de ticket virar o `jobs` de fato.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    for (let seq = 1; seq <= 4; seq += 1) {
      await store.save(receiptOf(randomUUID(), characterId, { seq }));
    }

    expect(await store.pendingFor(characterId, 2)).toHaveLength(2);
    expect(await store.pendingFor(characterId)).toHaveLength(4);
  });

  it('carries the bestiary through Redis and back, and a receipt without one stays without (FUN-113)', async () => {
    // `parseReceipt` é lista de PERMISSÃO: campo que não entra nela some no caminho de volta
    // sem erro nenhum — foi o que aconteceu com as skills na primeira vez. Este teste é o que
    // pega a mesma omissão para o Bestiário: gravado com o mapa, lido com o mapa, absoluto.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    const counts = { rat: 10_000, bat: 3 };
    await store.save(receiptOf(randomUUID(), characterId, { bestiary: counts }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.bestiary).toEqual(counts);
    // Sem o campo, sem a chave: o ledger distingue "não veio" (não toca na coluna) de "veio
    // vazio", e uma chave `undefined` colapsaria os dois.
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('bestiary');
  });

  it('carries the ammo selection through Redis and back, and a receipt without one stays without (#152)', async () => {
    // A mesma lista de PERMISSÃO, o mesmo defeito a pegar: a escolha gravada tem de voltar
    // inteira, e o extrato sem ela não pode ganhar a chave — o ledger não toca na coluna.
    const store = new ReceiptStore(redis);
    const characterId = randomUUID();
    await store.save(receiptOf(randomUUID(), characterId, { ammo: { arrow: 'sniper-arrow' } }));
    await store.save(receiptOf(randomUUID(), characterId, { seq: 2 }));

    const found = await store.pendingFor(characterId);

    expect(found.find((receipt) => receipt.seq === 1)?.ammo).toEqual({ arrow: 'sniper-arrow' });
    expect(found.find((receipt) => receipt.seq === 2)).not.toHaveProperty('ammo');
  });

  it('keeps the index out of the sweep, which scans by key prefix', async () => {
    // `receipts:char:` e `receipt:` são prefixos distintos DE PROPÓSITO. Nomear o índice
    // `receipt:char:{id}` o poria dentro do `MATCH` da varredura, e um SET no lugar de um
    // extrato sai do `MGET` como nada — a varredura pararia de ver um extrato por ciclo sem
    // nenhum erro em lugar nenhum.
    const store = new ReceiptStore(redis);
    await store.save(receiptOf(randomUUID(), randomUUID()));

    const keys = await redis.keys('receipt:*');

    expect(keys).toHaveLength(1);
    expect(await store.pending()).toHaveLength(1);
  });
});

describe.runIf(available)('one receipt per party member (#194, ADR 0027)', () => {
  it('keeps two receipts of the same session apart, and removes one without touching the other', async () => {
    // Mutação que mata: a chave antiga `receipt:{sessionId}` — o segundo `save` sobrescreveria
    // o primeiro, e um membro da party perderia a hunt inteira.
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    await store.save(receiptOf(sessionId, 'a', { seq: 1 }));
    await store.save(receiptOf(sessionId, 'b', { seq: 2 }));

    expect((await store.pendingFor('a')).map((r) => [r.characterId, r.seq])).toEqual([['a', 1]]);
    expect((await store.pendingFor('b')).map((r) => [r.characterId, r.seq])).toEqual([['b', 2]]);
    expect(await store.pending()).toHaveLength(2);

    await store.remove(sessionId, 'a');
    expect(await store.pendingFor('a')).toEqual([]);
    expect((await store.pendingFor('b')).map((r) => r.seq)).toEqual([2]);
    expect(await store.pending()).toHaveLength(1);
  });

  it('still reads and removes a receipt written under the old key, with the old index entry', async () => {
    // Deploy em rolagem: um nó anterior ao #194 gravou `receipt:{sessionId}` e o índice com o
    // `sessionId` cru. Precisa ser lido por `pendingFor` E apagado por `remove`.
    const store = new ReceiptStore(redis);
    const sessionId = randomUUID();
    const characterId = randomUUID();
    await redis.set(`receipt:${sessionId}`, JSON.stringify({ ...receiptOf(sessionId, characterId), endedAtMs: 1 }));
    await redis.sadd(`receipts:char:${characterId}`, sessionId);

    expect((await store.pendingFor(characterId)).map((r) => r.sessionId)).toEqual([sessionId]);
    await store.remove(sessionId, characterId);
    expect(await store.pendingFor(characterId)).toEqual([]);
    expect(await redis.exists(`receipt:${sessionId}`)).toBe(0);
  });
});
