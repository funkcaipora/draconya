import { describe, expect, it } from 'vitest';
import { IN_FIGHT_WINDOW_MS, isInFight } from './in-fight.js';

describe('isInFight (#625, CONDITION_INFIGHT/pzLocked do Canary)', () => {
  it('never fought (`null`) is never in combat', () => {
    expect(isInFight(0, null)).toBe(false);
    expect(isInFight(1_000_000, null)).toBe(false);
  });

  it('just under the window is still in combat — strict `<`, matching the exit-lock test above', () => {
    expect(isInFight(IN_FIGHT_WINDOW_MS - 1, 0)).toBe(true);
  });

  it('exactly at the window is no longer in combat', () => {
    expect(isInFight(IN_FIGHT_WINDOW_MS, 0)).toBe(false);
  });

  it('past the window is no longer in combat', () => {
    expect(isInFight(IN_FIGHT_WINDOW_MS + 1, 0)).toBe(false);
  });
});
