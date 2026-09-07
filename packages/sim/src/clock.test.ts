import { describe, expect, it } from 'vitest';
import { TestClock } from './clock.js';

describe('TestClock', () => {
  it('advances only when instructed', () => {
    const clock = new TestClock(1000);
    expect(clock.nowMs()).toBe(1000);
    clock.advance(500);
    expect(clock.nowMs()).toBe(1500);
  });

  it('simulates hours without waiting hours', () => {
    // É o que torna o critério de saída da Fase 1 (FUN-44) testável no CI.
    const clock = new TestClock();
    clock.advance(6 * 60 * 60 * 1000);
    expect(clock.nowMs()).toBe(21_600_000);
  });

  it('does not move backwards', () => {
    expect(() => new TestClock().advance(-1)).toThrow();
  });
});
