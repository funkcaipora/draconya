import { describe, expect, it } from 'vitest';
import {
  charmPointsAvailable, charmSlotsFor, echoesAvailable, echoesEarned, nextTierCost,
} from './charms-progress.js';
import type { CharmCatalogueEntry } from './charms-progress.js';

const WOUND: CharmCatalogueEntry = {
  id: 'wound', name: 'Wound', category: 'major', type: 'offensive', damageType: 'physical',
  percent: 5, chance: [5, 10, 11], points: [240, 360, 1200],
};
const SCAVENGE: CharmCatalogueEntry = {
  id: 'scavenge', name: 'Scavenge', category: 'minor', type: 'passive',
  chance: [60, 90, 120], points: [100, 150, 225],
};

describe('charmSlotsFor (ADR 0053 d.4)', () => {
  it('2 Free, 6 Premium', () => {
    expect(charmSlotsFor(false)).toBe(2);
    expect(charmSlotsFor(true)).toBe(6);
  });
});

describe('charmPointsAvailable', () => {
  it('soma charmsPoints de todo monstro com a ficha completa, menos o gasto', () => {
    const counts = { rat: 500 };
    const entries = { rat: { toKill: 500, firstUnlock: 25, secondUnlock: 250, charmsPoints: 15 } };
    expect(charmPointsAvailable(counts, entries, 0)).toBe(15);
    expect(charmPointsAvailable(counts, entries, 10)).toBe(5);
  });
});

describe('echoesEarned/echoesAvailable', () => {
  it('soma 25t²+25t+50 por tier MAJOR atravessado (t=0,1,2)', () => {
    // Wound (major) no tier 2 atravessou t=0 (50) e t=1 (100) = 150.
    expect(echoesEarned({ wound: 2 }, [WOUND, SCAVENGE])).toBe(150);
    expect(echoesAvailable({ wound: 2 }, [WOUND, SCAVENGE], 50)).toBe(100);
  });

  it('charm minor no registro não rende echo', () => {
    expect(echoesEarned({ scavenge: 2 }, [WOUND, SCAVENGE])).toBe(0);
  });

  it('sem tiers, zero echoes', () => {
    expect(echoesEarned({}, [WOUND, SCAVENGE])).toBe(0);
  });
});

describe('nextTierCost', () => {
  it('devolve o custo do tier atual (0-indexado)', () => {
    expect(nextTierCost(WOUND, 0)).toBe(240);
    expect(nextTierCost(WOUND, 1)).toBe(360);
    expect(nextTierCost(WOUND, 2)).toBe(1200);
  });

  it('null no tier máximo (3)', () => {
    expect(nextTierCost(WOUND, 3)).toBeNull();
  });
});
