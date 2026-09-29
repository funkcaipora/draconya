import { describe, expect, it } from 'vitest';
import { PartyState } from './types.js';

describe('PartyState (#359)', () => {
  const minimalParty = {
    leaderId: 'leader-1',
    mode: 'split' as const,
    members: [
      {
        characterId: 'c-1',
        name: 'Leader',
        alive: true,
        healthPercent: 100,
      },
    ],
  };

  it('parses successfully without shareCosts and splitLoot', () => {
    const parsed = PartyState.parse(minimalParty);
    expect(parsed.leaderId).toBe('leader-1');
    expect(parsed.mode).toBe('split');
    expect(parsed.shareCosts).toBeUndefined();
    expect(parsed.splitLoot).toBeUndefined();
  });

  it('parses successfully with shareCosts and splitLoot', () => {
    const parsed = PartyState.parse({
      ...minimalParty,
      mode: 'split',
      shareCosts: true,
      splitLoot: false,
    });
    expect(parsed.shareCosts).toBe(true);
    expect(parsed.splitLoot).toBe(false);

    const parsedShared = PartyState.parse({
      ...minimalParty,
      mode: 'shared',
      shareCosts: false,
      splitLoot: true,
    });
    expect(parsedShared.shareCosts).toBe(false);
    expect(parsedShared.splitLoot).toBe(true);
  });

  it('rejects invalid boolean types for shareCosts and splitLoot', () => {
    expect(() => PartyState.parse({ ...minimalParty, shareCosts: 'yes' })).toThrow();
    expect(() => PartyState.parse({ ...minimalParty, splitLoot: 1 })).toThrow();
  });
});
