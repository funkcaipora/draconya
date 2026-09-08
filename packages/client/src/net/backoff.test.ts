import { describe, expect, it } from 'vitest';
import { BACKOFF_MAX_MS, backoffDelayMs } from './backoff.js';

describe('backoff', () => {
  it('grows exponentially up to a ceiling', () => {
    const ceilings = [0, 1, 2, 3, 20].map((n) => backoffDelayMs(n, () => 1));
    expect(ceilings.slice(0, 4)).toEqual([500, 1_000, 2_000, 4_000]);
    // Sem teto, uma queda longa leva a espera a horas e o jogador acha que morreu.
    expect(ceilings[4]).toBe(BACKOFF_MAX_MS);
  });

  it('spreads clients across the whole window', () => {
    // Sem jitter, a queda de um nó faz todos os clientes voltarem no mesmo instante e
    // derrubarem o nó de novo — agora com a carga concentrada num milissegundo.
    const samples = [0, 0.25, 0.5, 0.75, 1].map((r) => backoffDelayMs(3, () => r));
    expect(samples).toEqual([0, 1_000, 2_000, 3_000, 4_000]);
    expect(new Set(samples).size).toBe(5);
  });

  it('never returns a negative wait for a nonsense attempt', () => {
    expect(backoffDelayMs(-5, () => 1)).toBe(500);
  });
});
