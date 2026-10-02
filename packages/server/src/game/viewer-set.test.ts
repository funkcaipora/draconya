import { describe, expect, it } from 'vitest';
import { Viewer } from './viewer.js';
import { ViewerSet } from './viewer-set.js';
import { FakeSocket } from './testing.js';

const viewer = (characterId: string): Viewer => new Viewer(new FakeSocket(), characterId);

describe('os visualizadores de uma sessão, indexados por personagem (OW-22)', () => {
  it('of() devolve só os visualizadores do personagem, sem varrer os dos outros', () => {
    const set = new ViewerSet();
    const a1 = viewer('a');
    const b = viewer('b');
    const a2 = viewer('a');
    set.add(a1).add(b).add(a2);

    expect([...set.of('a')]).toEqual([a1, a2]);
    expect([...set.of('b')]).toEqual([b]);
    expect(set.countOf('a')).toBe(2);
    expect(set.countOf('b')).toBe(1);
  });

  it('personagem sem visualizador: conjunto vazio e contagem zero, nunca undefined', () => {
    const set = new ViewerSet();
    set.add(viewer('a'));
    expect([...set.of('nobody')]).toEqual([]);
    expect(set.countOf('nobody')).toBe(0);
  });

  it('a iteração é a ordem de anexação, e a de cada personagem é a mesma de filtrar a sessão', () => {
    // O que o hospedeiro fazia antes: `for (v of viewers) if (v.characterId === id)`. A ordem em
    // que as mensagens entram na fila de cada visualizador não pode mudar com o índice.
    const set = new ViewerSet();
    const all = [viewer('a'), viewer('b'), viewer('a'), viewer('c'), viewer('b'), viewer('a')];
    for (const one of all) set.add(one);

    expect([...set]).toEqual(all);
    for (const id of ['a', 'b', 'c']) {
      expect([...set.of(id)]).toEqual(all.filter((one) => one.characterId === id));
    }
  });

  it('size conta abas; characterCount conta personagens', () => {
    const set = new ViewerSet();
    set.add(viewer('a')).add(viewer('a')).add(viewer('b'));
    expect(set.size).toBe(3);
    expect(set.characterCount).toBe(2);
    expect([...set.characterIds()]).toEqual(['a', 'b']);
  });

  it('adicionar o mesmo visualizador duas vezes não duplica nada, como num Set', () => {
    const set = new ViewerSet();
    const one = viewer('a');
    set.add(one).add(one);
    expect(set.size).toBe(1);
    expect(set.countOf('a')).toBe(1);
  });

  it('delete tira dos dois lados, e o índice do personagem some com a última aba dele', () => {
    const set = new ViewerSet();
    const first = viewer('a');
    const second = viewer('a');
    set.add(first).add(second);

    expect(set.delete(first)).toBe(true);
    expect(set.size).toBe(1);
    expect([...set.of('a')]).toEqual([second]);
    expect(set.has(first)).toBe(false);

    expect(set.delete(second)).toBe(true);
    expect(set.size).toBe(0);
    expect(set.countOf('a')).toBe(0);
    expect(set.characterCount).toBe(0);
    expect([...set.characterIds()]).toEqual([]);
  });

  it('delete de quem não está aqui devolve false e não mexe em ninguém', () => {
    const set = new ViewerSet();
    const mine = viewer('a');
    set.add(mine);
    expect(set.delete(viewer('a'))).toBe(false);
    expect(set.size).toBe(1);
    expect(set.countOf('a')).toBe(1);
  });

  it('soltar visualizadores enquanto percorre a sessão inteira é seguro, como num Set', () => {
    // `SessionHost.flush` derruba quem não drena DENTRO do laço, e o `Set` aguenta isso.
    const set = new ViewerSet();
    const all = [viewer('a'), viewer('b'), viewer('a')];
    for (const one of all) set.add(one);

    const seen: Viewer[] = [];
    for (const one of set) {
      seen.push(one);
      set.delete(one);
    }

    expect(seen).toEqual(all);
    expect(set.size).toBe(0);
    expect(set.characterCount).toBe(0);
  });
});
