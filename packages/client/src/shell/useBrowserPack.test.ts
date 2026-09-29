import { describe, expect, it } from 'vitest';
import { createEvictionHub } from './useBrowserPack.js';
import type { Sprite } from '../assets/sprites.js';

const bitmap = (): Sprite => ({ width: 32, height: 32, close() {} });

describe('createEvictionHub (FUN-108)', () => {
  it('entrega cada despejo a TODOS os inscritos', () => {
    // Dois livros de textura vivos ao mesmo tempo é o que o StrictMode produz por um instante.
    // Mutação que mata: guardar só o último inscrito (uma variável no lugar do `Set`).
    const hub = createEvictionHub();
    const first: Sprite[] = [];
    const second: Sprite[] = [];
    hub.subscribe((b) => { first.push(b); });
    hub.subscribe((b) => { second.push(b); });
    const gone = bitmap();
    hub.notify(gone);
    expect(first).toEqual([gone]);
    expect(second).toEqual([gone]);
  });

  it('desinscrever é definitivo: o livro que morreu não recebe mais nada', () => {
    // Um `forget` num livro destruído não quebra, mas é o sinal de que a inscrição vaza — e o
    // vazamento é do closure do livro inteiro, com as texturas. Mutação que mata: devolver
    // uma função vazia em `subscribe`.
    const hub = createEvictionHub();
    const seen: Sprite[] = [];
    const unsubscribe = hub.subscribe((b) => { seen.push(b); });
    hub.notify(bitmap());
    unsubscribe();
    hub.notify(bitmap());
    expect(seen).toHaveLength(1);
  });

  it('sem inscritos, avisar não é erro', () => {
    // O pacote despeja antes de o viewport montar, ou depois de ele desmontar.
    expect(() => { createEvictionHub().notify(bitmap()); }).not.toThrow();
  });
});
