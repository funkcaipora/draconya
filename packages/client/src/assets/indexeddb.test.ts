import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { SheetCache } from './cache.js';
import { IndexedDbSheetStore, openSheetDatabase } from './indexeddb.js';

// `fake-indexeddb` implementa a especificação, então isto exercita o adaptador de VERDADE —
// transação, cursor, `onupgradeneeded`, clone estruturado do `Uint8ClampedArray`. Um duplo
// escrito à mão provaria só que o duplo concorda comigo.

let factory: IDBFactory;

beforeEach(() => { factory = new IDBFactory(); });

const open = async (): Promise<IndexedDbSheetStore> =>
  new IndexedDbSheetStore(await openSheetDatabase(factory));

const sheet = (bytes: number, fill = 1) => ({
  width: 2, height: 2, pixels: new Uint8ClampedArray(bytes).fill(fill), usedAtMs: 1,
});

describe('IndexedDbSheetStore (FUN-19)', () => {
  it('cria o object store no primeiro acesso e guarda uma folha', async () => {
    const store = await open();
    await store.put('a', sheet(8, 7));
    const found = await store.get('a');
    expect(found?.width).toBe(2);
    expect([...found?.pixels ?? []]).toEqual(Array.from({ length: 8 }, () => 7));
  });

  it('os PIXELS atravessam o clone estruturado sem virar objeto comum', async () => {
    // `Uint8ClampedArray` atravessa; um `ImageBitmap` não atravessaria — é por isso que
    // guardamos pixels. Se isto voltasse como `{0:1,1:1,...}`, o bitmap não se recriaria.
    const store = await open();
    await store.put('a', sheet(4));
    expect((await store.get('a'))?.pixels).toBeInstanceOf(Uint8ClampedArray);
  });

  it('devolve undefined para chave que não existe', async () => {
    expect(await (await open()).get('nunca-vista')).toBeUndefined();
  });

  it('sobrescreve pela chave, sem duplicar', async () => {
    const store = await open();
    await store.put('a', sheet(4, 1));
    await store.put('a', sheet(4, 9));
    expect((await store.get('a'))?.pixels[0]).toBe(9);
    expect(await store.entries()).toHaveLength(1);
  });

  it('apaga', async () => {
    const store = await open();
    await store.put('a', sheet(4));
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });

  it('lista chave, tamanho e uso SEM carregar os pixels de tudo', async () => {
    // O tamanho é gravado junto e lido pelo cursor: `getAll` carregaria dezenas de MB de
    // pixels só para responder "quanto ocupa cada uma", no thread principal, a cada despejo.
    const store = await open();
    await store.put('a', { ...sheet(16), usedAtMs: 5 });
    await store.put('b', { ...sheet(32), usedAtMs: 9 });
    const entries = [...await store.entries()].sort((x, y) => x.key.localeCompare(y.key));
    expect(entries).toEqual([
      { key: 'a', bytes: 16, usedAtMs: 5 },
      { key: 'b', bytes: 32, usedAtMs: 9 },
    ]);
  });

  it('SOBREVIVE a fechar e reabrir — é o ponto do cache ser persistente', async () => {
    // O critério de saída do M2 é este: no segundo carregamento, nenhuma folha já vista passa
    // por download nem LZMA. Um cache que não atravessa a sessão não entrega isso.
    const primeira = await open();
    await primeira.put('a', sheet(8, 3));

    const segunda = new IndexedDbSheetStore(await openSheetDatabase(factory));
    expect((await segunda.get('a'))?.pixels[0]).toBe(3);
  });

  it('serve de armazenamento para o SheetCache, com despejo de ponta a ponta', async () => {
    // Política e armazenamento juntos, uma vez. Cada um é testado sozinho; isto é a costura.
    let clock = 0;
    const cache = new SheetCache(await open(), { maxBytes: 24, now: () => clock });
    clock = 1; await cache.put('velha', { width: 2, height: 2, pixels: new Uint8ClampedArray(16) });
    clock = 2; await cache.put('nova', { width: 2, height: 2, pixels: new Uint8ClampedArray(16) });

    expect(await cache.get('velha')).toBeNull();
    expect(await cache.get('nova')).not.toBeNull();
  });
});

describe('openSheetDatabase (FUN-19)', () => {
  it('rejeita quando o navegador recusa abrir', async () => {
    // Aba anônima e armazenamento bloqueado caem aqui. Quem chama trata como "não há cache",
    // nunca como falha do jogo — e é por isso que isto REJEITA em vez de devolver um banco
    // de mentira que falharia depois, mais longe da causa.
    const recusa = {
      open: () => {
        const request = { onerror: null as null | (() => void), error: new Error('recusado') };
        queueMicrotask(() => { request.onerror?.(); });
        return request;
      },
    } as unknown as IDBFactory;
    await expect(openSheetDatabase(recusa)).rejects.toThrow(/recusado/);
  });
});
