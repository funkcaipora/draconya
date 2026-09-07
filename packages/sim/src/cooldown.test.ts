import { describe, expect, it } from 'vitest';
import { Cooldowns, MAX_CATCH_UP } from './cooldown.js';

describe('event-triggered action', () => {
  it('remains unavailable for the duration and becomes ready afterwards', () => {
    const cd = new Cooldowns();
    expect(cd.isReady('heal', 0)).toBe(true);
    cd.start('heal', 0, 1000);
    expect(cd.isReady('heal', 999)).toBe(false);
    expect(cd.remainingMs('heal', 400)).toBe(600);
    expect(cd.isReady('heal', 1000)).toBe(true);
  });

  it('uses an absolute timestamp across snapshots and delayed restoration', () => {
    const cd = new Cooldowns();
    cd.start('heal', 5000, 1000);
    const resumed = Cooldowns.fromState(cd.getState());
    expect(resumed.isReady('heal', 5500)).toBe(false);
    expect(resumed.isReady('heal', 60_000)).toBe(true);
  });
});

describe('periodic action', () => {
  const count = (stepMs: number, totalMs: number, intervalMs: number): number => {
    const cd = new Cooldowns();
    let total = 0;
    for (let t = 0; t < totalMs; t += stepMs) total += cd.timesThatFit('attack', stepMs, intervalMs);
    return total;
  };

  it('keeps the total independent of the step size', () => {
    // Sem isto, a hunt desanexada renderia menos que a anexada, e o resultado passaria a
    // depender de haver alguém olhando (invariante 3).
    const expected = count(100, 60_000, 350);
    expect(count(1000, 60_000, 350)).toBe(expected);
    expect(count(500, 60_000, 350)).toBe(expected);
    expect(count(50, 60_000, 350)).toBe(expected);
  });

  it('supports intervals that do not divide the step', () => {
    const expected = count(100, 30_000, 333);
    expect(count(1000, 30_000, 333)).toBe(expected);
  });

  it('matches the expected effective rate', () => {
    // 60 s com intervalo de 350 ms: ~171 aplicações, mais a primeira que já vem pronta.
    expect(count(100, 60_000, 350)).toBe(Math.floor(60_000 / 350) + 1);
  });

  it('starts ready', () => {
    expect(new Cooldowns().timesThatFit('attack', 0, 1000)).toBe(1);
  });

  it('caps long intervals without accumulating debt', () => {
    // Retomada depois de horas (FUN-28) não pode virar rajada.
    const cd = new Cooldowns();
    cd.timesThatFit('attack', 0, 1000);
    expect(cd.timesThatFit('attack', 3_600_000, 1000)).toBe(MAX_CATCH_UP);
    expect(cd.timesThatFit('attack', 1000, 1000)).toBe(1);
  });

  it('preserves accumulated time across snapshots', () => {
    const cd = new Cooldowns();
    cd.timesThatFit('attack', 900, 350);
    const resumed = Cooldowns.fromState(cd.getState());
    expect(resumed.timesThatFit('attack', 100, 350)).toBe(cd.timesThatFit('attack', 100, 350));
  });

  it('rejects invalid arguments explicitly', () => {
    expect(() => new Cooldowns().timesThatFit('x', 100, 0)).toThrow();
    expect(() => new Cooldowns().timesThatFit('x', -1, 100)).toThrow();
  });
});
