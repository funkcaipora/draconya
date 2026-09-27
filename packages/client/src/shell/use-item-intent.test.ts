import { describe, expect, it } from 'vitest';
import { isUsable, useIntent } from './use-item-intent.js';

describe('useIntent (#726, ADR 0049 decisão 3)', () => {
  it('monta `use-item` com a mesma ref e seq, sem alvo', () => {
    expect(useIntent({ instanceId: 'i1' }, 3)).toEqual({ type: 'use-item', ref: { instanceId: 'i1' }, seq: 3 });
    expect(useIntent({ supplyId: 'health-potion' }, 7))
      .toEqual({ type: 'use-item', ref: { supplyId: 'health-potion' }, seq: 7 });
  });
});

describe('isUsable (#726)', () => {
  it('só `consumable` pode ser usado pelo menu', () => {
    expect(isUsable('consumable')).toBe(true);
    expect(isUsable('weapon')).toBe(false);
    expect(isUsable('armor')).toBe(false);
    expect(isUsable(undefined)).toBe(false);
  });
});
