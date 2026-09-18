import { describe, expect, it } from 'vitest';
import type { ItemDefinition } from '../state/hud.js';
import { defaultRingSwap, fingerRings, ringSwapSummary } from './ring-swap.js';

const items: ItemDefinition[] = [
  { id: 'sword', name: 'Sword', appearanceId: 1, weight: 10, slot: 'hand', twoHanded: false },
  { id: 'life-ring', name: 'Life Ring', appearanceId: 2, weight: 2, slot: 'finger', twoHanded: false },
  { id: 'energy-ring', name: 'Energy Ring', appearanceId: 3, weight: 2, slot: 'finger', twoHanded: false },
  { id: 'cheese', name: 'Cheese', appearanceId: 4, weight: 1, slot: null, twoHanded: false },
];

describe('ring-swap pure functions', () => {
  describe('fingerRings', () => {
    it('filters only items with slot "finger"', () => {
      const rings = fingerRings(items);
      expect(rings.map((r) => r.id)).toEqual(['life-ring', 'energy-ring']);
    });

    it('returns empty array when no items have slot "finger"', () => {
      expect(fingerRings([])).toEqual([]);
      expect(fingerRings([items[0]!, items[3]!])).toEqual([]);
    });
  });

  describe('defaultRingSwap', () => {
    it('returns default config using the first finger ring when items exist', () => {
      const initial = defaultRingSwap(items);
      expect(initial).toEqual({
        itemId: 'life-ring',
        equipBelow: 50,
        removeAbove: 60,
        manaFloor: 10,
        restorePrevious: true,
      });
    });

    it('returns null when no finger rings exist', () => {
      expect(defaultRingSwap([])).toBeNull();
      expect(defaultRingSwap([items[0]!])).toBeNull();
    });
  });

  describe('ringSwapSummary', () => {
    it('returns neutral string when ring is undefined', () => {
      expect(ringSwapSummary(undefined, items)).toBe('Nenhum anel configurado');
    });

    it('formats summary with item name and thresholds', () => {
      const summary = ringSwapSummary(
        { itemId: 'energy-ring', equipBelow: 45, removeAbove: 75, manaFloor: 15, restorePrevious: true },
        items,
      );
      expect(summary).toBe('Energy Ring · HP < 45 % → ≥ 75 %');
    });

    it('falls back to itemId if item is not found in items list', () => {
      const summary = ringSwapSummary(
        { itemId: 'unknown-ring', equipBelow: 30, removeAbove: 50, manaFloor: 10, restorePrevious: false },
        items,
      );
      expect(summary).toBe('unknown-ring · HP < 30 % → ≥ 50 %');
    });
  });
});
