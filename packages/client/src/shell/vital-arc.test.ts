import { describe, expect, it } from 'vitest';
import { ARC_DASH_OFFSET, ARC_TRACK_DASHARRAY, arcDasharray } from './vital-arc.js';

describe('vital arc geometry (#328, RC-15)', () => {
  it('keeps the rendered kit geometry for empty, half, and full arcs', () => {
    expect(ARC_DASH_OFFSET).toBe(-166.63);
    expect(arcDasharray(0)).toBe('0.00 490.09');
    expect(arcDasharray(0.5)).toBe('78.41 411.67');
    expect(arcDasharray(1)).toBe(ARC_TRACK_DASHARRAY);
  });

  it('clamps progress to the visible segment', () => {
    expect(arcDasharray(-1)).toBe(arcDasharray(0));
    expect(arcDasharray(1.5)).toBe(arcDasharray(1));
  });
});
