import { describe, expect, it } from 'vitest';
import type { Combat } from './schemas.js';
import { evaluateSpellPower, spellPowerRange } from './spell-power.js';

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

describe('a fórmula canônica do Canary (#474)', () => {
  // Os coeficientes da Ice Strike (`exori frigo`): min = level/5 + ML×1.403 + 8,
  // max = level/5 + ML×2.203 + 13. O `levelFactor` 0.2 é o `level/5` da referência; o default
  // do schema o preenche no boot, então aqui ele vem explícito como o `sim` o recebe.
  const iceStrike = { levelFactor: 0.2, skillMin: 1.403, skillMax: 2.203, baseMin: 8, baseMax: 13 } as const;

  it('level 50 e ML 40 rendem a faixa da referência: 74~111', () => {
    // min = 10 + 40×1.403 + 8 = 74,12 → 74; max = 10 + 40×2.203 + 13 = 111,12 → 111. O Canary
    // trunca as duas pontas (`static_cast<int32_t>`) antes de sortear — `floor`, não `ceil`.
    // Mutação que mata: usar o `basePower` (45) aqui daria uma faixa de 382~518, não esta.
    expect(evaluateSpellPower(iceStrike, 45, 50, 40, spellPower)).toEqual({ min: 74, max: 111 });
  });

  it('sem fórmula, o caminho é o `basePower` bit a bit (ADR 0031)', () => {
    // A migração é aditiva: a magia que não declara `formula` tem de render o MESMO que a
    // conversão provisória renderia. Mutação que mata: trocar o fallback por uma fórmula.
    const cases: readonly (readonly [number, number, number])[] = [
      [40, 8, 0], [45, 50, 40], [1, 1, 0], [200, 90, 70],
    ];
    for (const [bp, level, skill] of cases) {
      expect(evaluateSpellPower(undefined, bp, level, skill, spellPower))
        .toEqual(spellPowerRange(bp, level, skill, spellPower));
    }
  });

  it('a faixa nunca cai abaixo de 1 e nunca vem invertida', () => {
    // Coeficientes degenerados (skill 0, base 0) não podem zerar a magia nem trocar as pontas.
    expect(evaluateSpellPower(
      { levelFactor: 0.2, skillMin: 0, skillMax: 0, baseMin: 0, baseMax: 0 }, 0, 0, 0, spellPower,
    )).toEqual({ min: 1, max: 1 });
    // Teto menor que o piso é conteúdo torto; o helper garante `max >= min`.
    expect(evaluateSpellPower(
      { levelFactor: 0.2, skillMin: 2, skillMax: 1, baseMin: 0, baseMax: 0 }, 0, 0, 10, spellPower,
    )).toEqual({ min: 20, max: 20 });
  });

  it('o `levelFactor` pode ser sobrescrito pelo conteúdo', () => {
    // O default é 0.2 (testado no schema); o conteúdo que precisa de outro peso o declara.
    expect(evaluateSpellPower(
      { levelFactor: 0.1, skillMin: 0, skillMax: 0, baseMin: 0, baseMax: 0 }, 0, 50, 0, spellPower,
    )).toEqual({ min: 5, max: 5 });
    expect(evaluateSpellPower(
      { levelFactor: 0.2, skillMin: 0, skillMax: 0, baseMin: 0, baseMax: 0 }, 0, 50, 0, spellPower,
    )).toEqual({ min: 10, max: 10 });
  });
});


