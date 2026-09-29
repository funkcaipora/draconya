// As métricas de desenvolvimento do `TextureBook` (issue #388, §11): `get` que devolve uma
// `Texture` soma `hits`; `get` que dispara um pedido soma `misses`; `null` (não existe) e
// pendente não somam em nenhum. O `pixi.js` é trocado pelo falso, como em `viewport.test.ts`:
// sem ele o teste precisaria de GPU só para instanciar uma `Texture`.

import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => import('./testing/pixi-fake.js'));

import { Texture } from './testing/pixi-fake.js';
import { TextureBook, type TextureRequest } from './textures.js';

const bitmap = { width: 32, height: 32, close(): void {} };

/** Uma entrega imediata: o pedido resolve no mesmo microtask, como o pacote com cache quente. */
const immediate = (value: typeof bitmap | null): TextureRequest => () => Promise.resolve(value);

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('TextureBook: hits e misses (issue #388)', () => {
  it('a primeira chave conta um miss; a segunda chamada com a textura pronta conta um hit', async () => {
    const book = new TextureBook();
    const request = immediate(bitmap);

    expect(book.get('object:100:0:0', request)).toBeUndefined();
    expect(book.misses).toBe(1);
    expect(book.hits).toBe(0);

    await flush();

    const texture = book.get('object:100:0:0', request);
    expect(texture).toBeInstanceOf(Texture);
    expect(book.hits).toBe(1);
    expect(book.misses).toBe(1);
  });

  it('pendente não conta: pedidos concorrentes da mesma chave somam um miss só', async () => {
    const book = new TextureBook();
    const request = immediate(bitmap);

    book.get('object:100:0:0', request);
    book.get('object:100:0:0', request);
    book.get('object:100:0:0', request);

    expect(book.misses).toBe(1);
    expect(book.hits).toBe(0);
  });

  it('chave que resolve `null` conta um miss e, depois, nem hit nem miss', async () => {
    const book = new TextureBook();

    expect(book.get('object:999:0:0', immediate(null))).toBeUndefined();
    expect(book.misses).toBe(1);

    await flush();

    expect(book.get('object:999:0:0', immediate(bitmap))).toBeNull();
    expect(book.hits).toBe(0);
    expect(book.misses).toBe(1);
  });
});
