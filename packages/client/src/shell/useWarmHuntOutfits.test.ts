import { describe, expect, it } from 'vitest';
import { outfitsToWarm } from './useWarmHuntOutfits.js';

const catalogue = (hunts: Array<{ id: string; outfitIds: number[] }>) => ({
  hunts: hunts.map((hunt) => ({ ...hunt, name: hunt.id, recommendedLevel: 1, difficulties: ['beginner'] })),
  monsters: [],
  bot: {
    vocabularyVersion: 1, advancedFromLevel: 50,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [], supplies: [],
  },
  items: [],
});

describe('outfitsToWarm (FUN-112)', () => {
  it('junta os outfits de todas as hunts, sem repetir', () => {
    // O rato está em todas: pedi-lo uma vez por hunt seria uma folha por hunt.
    expect(outfitsToWarm(catalogue([
      { id: 'rat-cellars', outfitIds: [21] },
      { id: 'rat-attic', outfitIds: [21, 35] },
    ]))).toEqual([21, 35]);
  });

  it('sem catálogo não há o que aquecer', () => {
    expect(outfitsToWarm(null)).toEqual([]);
  });
});
