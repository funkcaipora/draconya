import { describe, expect, it } from 'vitest';
import { compactPerformance, performanceRate } from './party-performance-format.js';

describe('party-performance-format (#431)', () => {
  it('compacta o total como o kit: "135.7k", "1.2M", e inteiro abaixo de mil', () => {
    // Mutação que mata: usar separador de milhar pt-BR ("135.700") — a linha do kit não o tem.
    expect(compactPerformance(135_700)).toBe('135.7k');
    expect(compactPerformance(20_200)).toBe('20.2k');
    expect(compactPerformance(1_200_000)).toBe('1.2M');
    expect(compactPerformance(999)).toBe('999');
    expect(compactPerformance(0)).toBe('0');
  });

  it('a taxa (DPS/HPS) sai em inteiro', () => {
    expect(performanceRate(200 / 60)).toBe('3');
    expect(performanceRate(12)).toBe('12');
    expect(performanceRate(107.4)).toBe('107');
  });
});