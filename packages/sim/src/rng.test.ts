import { describe, expect, it } from 'vitest';
import { Rng } from './rng.js';

describe('Rng', () => {
  it('mesma semente produz a mesma sequência', () => {
    const a = Rng.deSemente('sessao-1');
    const b = Rng.deSemente('sessao-1');
    const seqA = Array.from({ length: 100 }, () => a.proximo());
    const seqB = Array.from({ length: 100 }, () => b.proximo());
    expect(seqA).toEqual(seqB);
  });

  it('sementes diferentes divergem', () => {
    const a = Rng.deSemente('sessao-1');
    const b = Rng.deSemente('sessao-2');
    expect(a.proximo()).not.toBe(b.proximo());
  });

  it('retomar do estado continua a mesma sequência', () => {
    // É o caso da FUN-28: sessão volta do snapshot e o loot precisa seguir igual.
    const original = Rng.deSemente('sessao-1');
    for (let i = 0; i < 37; i++) original.proximo();
    const retomado = new Rng(original.estado());
    const esperado = Array.from({ length: 20 }, () => original.proximo());
    const obtido = Array.from({ length: 20 }, () => retomado.proximo());
    expect(obtido).toEqual(esperado);
  });

  it('estado todo-zero não trava o gerador', () => {
    const rng = new Rng({ a: 0, b: 0, c: 0, d: 0 });
    const valores = new Set(Array.from({ length: 10 }, () => rng.proximo()));
    expect(valores.size).toBeGreaterThan(1);
  });

  it('fracao fica em [0, 1)', () => {
    const rng = Rng.deSemente('x');
    for (let i = 0; i < 1000; i++) {
      const f = rng.fracao();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('inteiro respeita os extremos, inclusive', () => {
    const rng = Rng.deSemente('y');
    const vistos = new Set<number>();
    for (let i = 0; i < 2000; i++) vistos.add(rng.inteiro(1, 6));
    expect([...vistos].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('intervalo invertido é erro, não silêncio', () => {
    expect(() => Rng.deSemente('z').inteiro(5, 1)).toThrow();
  });
});
