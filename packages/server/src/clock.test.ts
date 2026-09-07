import { afterEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from './clock.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('systemClock', () => {
  it('stays monotonic when the wall clock changes', () => {
    const wallClock = vi.spyOn(Date, 'now');
    const monotonicClock = vi.spyOn(performance, 'now');
    wallClock.mockReturnValueOnce(1_000_000).mockReturnValueOnce(1);
    monotonicClock.mockReturnValueOnce(500).mockReturnValueOnce(501);

    const clock = systemClock();

    expect(clock.nowMs()).toBe(500);
    expect(clock.nowMs()).toBe(501);
    expect(wallClock).not.toHaveBeenCalled();
  });
});
