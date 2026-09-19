import { describe, expect, it } from 'vitest';
import type { Combat } from './schemas.js';
import { spellPowerRange } from './spell-power.js';

// Os coeficientes do catálogo real (ADR 0026 decisão 5) — os mesmos que `combat/baseline.json`
// declara e que `casting.test.ts` usava antes desta função migrar para cá (#436, ADR 0033).
const spellPower: Combat['spellPower'] = { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 };

describe('a conversão do Base Power (#155, ADR 0026 decisão 5)', () => {
  it('converts the Base Power by level and skill, integer at both ends', () => {
    // Light Healing (BP 40) no level 8 com magic 0: mid = 40 × 1,48 = 59,2 → [50, 69]. Mutação
    // que mata: trocar `floor`/`ceil` por `round` (dá [50, 68]), ou esquecer o `skillFactor`.
    expect(spellPowerRange(40, 8, 0, spellPower)).toEqual({ min: 50, max: 69 });
    expect(spellPowerRange(40, 8, 10, spellPower)).toEqual({ min: 101, max: 138 });
    // Nunca abaixo de 1, e `min <= max` sempre.
    expect(spellPowerRange(1, 1, 0, { levelFactor: 0, skillFactor: 0, spread: 0.9 })).toEqual({ min: 1, max: 2 });
  });
});
