import { describe, expect, it } from 'vitest';
import { createFpsMeter } from './fps.js';

describe('createFpsMeter', () => {
  it('returns zero before the first valid frame', () => {
    expect(createFpsMeter().read()).toBe(0);
  });

  it('reports a stable sixty FPS cadence', () => {
    const meter = createFpsMeter();
    for (let frame = 0; frame < 10; frame++) meter.record(1_000 / 60);

    expect(meter.read()).toBe(60);
  });

  it('uses a moving window instead of averaging every frame since startup', () => {
    const meter = createFpsMeter(5);
    for (let frame = 0; frame < 5; frame++) meter.record(1_000 / 60);
    expect(meter.read()).toBe(60);

    for (let frame = 0; frame < 5; frame++) meter.record(1_000 / 30);
    expect(meter.read()).toBe(30);
  });

  it('ignores invalid deltas without contaminating the average', () => {
    const meter = createFpsMeter();
    meter.record(1_000 / 60);
    meter.record(0);
    meter.record(-5);
    meter.record(Number.NaN);
    meter.record(Number.POSITIVE_INFINITY);
    meter.record(1_000 / 60);

    expect(meter.read()).toBe(60);
  });
});
