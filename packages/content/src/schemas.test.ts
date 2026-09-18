import { describe, expect, it } from 'vitest';
import { huntSchema } from './schemas.js';

describe('huntSchema (#360)', () => {
  const validHunt = {
    id: 'rat-cellars',
    name: 'Rat Cellars',
    recommendedLevel: 1,
    mapId: 'rat-cellars',
    routeId: 'rat-cellars',
    difficulties: {
      cautious: {
        monsterCount: 2,
        composition: [{ monsterId: 'rat', weight: 1 }],
        respawnDelayMs: 30_000,
      },
    },
  };

  it('valida hunt válida sem exitDelayMs (opcional)', () => {
    const parsed = huntSchema.parse(validHunt);
    expect(parsed.exitDelayMs).toBeUndefined();
    expect(huntSchema.parse(parsed)).toEqual(parsed);
  });

  it('valida roundtrip de hunt com exitDelayMs positivo inteiro', () => {
    const raw = { ...validHunt, exitDelayMs: 5_000 };
    const parsed = huntSchema.parse(raw);
    expect(parsed.exitDelayMs).toBe(5_000);
    expect(huntSchema.parse(parsed)).toEqual(parsed);
  });

  it('rejeita exitDelayMs zero, negativo ou não inteiro', () => {
    expect(() => huntSchema.parse({ ...validHunt, exitDelayMs: 0 })).toThrow();
    expect(() => huntSchema.parse({ ...validHunt, exitDelayMs: -100 })).toThrow();
    expect(() => huntSchema.parse({ ...validHunt, exitDelayMs: 5.5 })).toThrow();
  });
});
