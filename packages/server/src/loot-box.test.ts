import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LOOT_BOX_TTL_MS, LootBoxStore } from './loot-box.js';
import { SHORT_MS } from './testing/deadlines.js';
import { connectTestRedis } from './testing/redis.js';

// O banco 10 é deste arquivo — ver testing/redis.ts para por que cada um tem o seu.
const { redis, available } = await connectTestRedis(10);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

const item = (instanceId: string, itemId = 'spike-sword') =>
  ({ instanceId, itemId, quantity: 1 });

describe.runIf(available)('Caixa de Loot da Sessão (FUN-88)', () => {
  it('guarda o que sobrou e devolve na mesma ordem', async () => {
    const boxes = new LootBoxStore(redis);
    const sobrou = [item('s1:0'), item('s1:1', 'arrow')];

    await boxes.save('s1', sobrou);

    expect(await boxes.load('s1')).toEqual(sobrou);
  });

  it('o prazo é de 30 minutos, e ele começa AGORA', async () => {
    // O relógio corre a partir do encerramento da sessão (§21.6), e quem sabe que ela encerrou
    // é quem a encerrou — por isso a caixa é escrita no host, não na varredura.
    //
    // O teste afirma o `pttl`, e não espera trinta minutos: teste que dorme não roda no CI, e
    // portanto não roda nunca (FUN-62).
    const boxes = new LootBoxStore(redis);
    await boxes.save('s1', [item('s1:0')]);

    const restante = await boxes.remainingMs('s1');
    expect(restante).toBeGreaterThan(LOOT_BOX_TTL_MS - 5_000);
    expect(restante).toBeLessThanOrEqual(LOOT_BOX_TTL_MS);
  });

  it('caixa VAZIA não cria chave', async () => {
    // Uma caixa vazia é indistinguível de não haver caixa, e criar uma por sessão encerrada
    // encheria o Redis com nada: cinco mil chaves por rodada dizendo "não sobrou item".
    const boxes = new LootBoxStore(redis);
    await boxes.save('s1', []);

    expect(await boxes.remainingMs('s1')).toBeLessThan(0);
    expect(await boxes.load('s1')).toEqual([]);
  });

  it('caixa que não existe devolve lista vazia — como a que expirou', async () => {
    // Expirar precisa ser indistinguível de nunca ter existido: é isso que faz o item sumir
    // de verdade, em vez de virar linha que ninguém consegue ver.
    const boxes = new LootBoxStore(redis);
    expect(await boxes.load('nunca-existiu')).toEqual([]);
  });

  it('caixa ILEGÍVEL devolve vazia em vez de derrubar quem a leu', async () => {
    await redis.set('lootbox:s1', 'isto não é json');
    expect(await new LootBoxStore(redis).load('s1')).toEqual([]);
  });

  it('conta as pendentes, e o zero é OBSERVADO', async () => {
    const boxes = new LootBoxStore(redis);
    expect(await boxes.pending()).toBe(0);

    await boxes.save('s1', [item('s1:0')]);
    await boxes.save('s2', [item('s2:0')]);

    expect(await boxes.pending()).toBe(2);
  });

  it('a contagem não confunde caixa com extrato', async () => {
    // Prefixos distintos de propósito: o `SCAN` de uma varredura não pode pegar a chave da
    // outra. Foi o defeito que a FUN-56 registrou com `receipt:` e `receipts:char:`.
    const boxes = new LootBoxStore(redis);
    await redis.set('receipt:s1', '{}');
    await redis.set('receipts:char:p1', 's1');

    expect(await boxes.pending()).toBe(0);
  });

  it('salvar de novo REINICIA o prazo', async () => {
    // Não é caminho normal — uma sessão encerra uma vez —, mas é o que um retry de drenagem
    // faz. Reiniciar é o certo: o jogador não pode perder tempo de resgate por causa de uma
    // tentativa repetida do servidor.
    const curta = new LootBoxStore(redis, 60_000);
    await curta.save('s1', [item('s1:0')]);
    await redis.pexpire('lootbox:s1', SHORT_MS);

    await curta.save('s1', [item('s1:0')]);

    expect(await curta.remainingMs('s1')).toBeGreaterThan(50_000);
  });
});
