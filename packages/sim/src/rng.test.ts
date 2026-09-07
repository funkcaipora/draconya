import { describe, expect, it } from 'vitest';
import { Rng } from './rng.js';

describe('Rng', () => {
  it('the same seed produces the same sequence', () => {
    const a = Rng.fromSeed('session-1');
    const b = Rng.fromSeed('session-1');
    const sequenceA = Array.from({ length: 100 }, () => a.next());
    const sequenceB = Array.from({ length: 100 }, () => b.next());
    expect(sequenceA).toEqual(sequenceB);
  });

  it('different seeds diverge', () => {
    const a = Rng.fromSeed('session-1');
    const b = Rng.fromSeed('session-2');
    expect(a.next()).not.toBe(b.next());
  });

  it('resuming from state continues the same sequence', () => {
    // É o caso da FUN-28: sessão volta do snapshot e o loot precisa seguir igual.
    const original = Rng.fromSeed('session-1');
    for (let i = 0; i < 37; i++) original.next();
    const resumed = new Rng(original.getState());
    const expected = Array.from({ length: 20 }, () => original.next());
    const actual = Array.from({ length: 20 }, () => resumed.next());
    expect(actual).toEqual(expected);
  });

  it('an all-zero state does not lock the generator', () => {
    const rng = new Rng({ a: 0, b: 0, c: 0, d: 0 });
    const values = new Set(Array.from({ length: 10 }, () => rng.next()));
    expect(values.size).toBeGreaterThan(1);
  });

  it('fraction stays in [0, 1)', () => {
    const rng = Rng.fromSeed('x');
    for (let i = 0; i < 1000; i++) {
      const f = rng.fraction();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('integer includes both endpoints', () => {
    const rng = Rng.fromSeed('y');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.integer(1, 6));
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('an inverted range is an error', () => {
    expect(() => Rng.fromSeed('z').integer(5, 1)).toThrow();
  });
});
