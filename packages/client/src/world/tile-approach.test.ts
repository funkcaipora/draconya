import { describe, expect, it } from 'vitest';
import { TILE_APPROACH_TIMEOUT_MS, decideTileApproach } from './tile-approach.js';
import type { PendingTileUse } from './tile-approach.js';

// A decisão de usar um tile sozinho quando o personagem chega perto (#729, ADR 0050 d.7). PURA:
// sem React, sem timer, sem `net/`.

function pending(over: Partial<PendingTileUse> = {}): PendingTileUse {
  return { position: { x: 4, y: 2, z: 7 }, requestedAtMs: 0, ...over };
}

describe('decideTileApproach', () => {
  it('manda quando o personagem já está adjacente (distância <= 1, mesmo andar)', () => {
    expect(decideTileApproach(pending(), { x: 4, y: 1, z: 7 }, 1_000)).toBe('send');
    expect(decideTileApproach(pending(), { x: 3, y: 1, z: 7 }, 1_000)).toBe('send'); // diagonal
    expect(decideTileApproach(pending(), { x: 4, y: 2, z: 7 }, 1_000)).toBe('send'); // no tile
  });

  it('espera enquanto o personagem ainda não chegou perto', () => {
    expect(decideTileApproach(pending(), { x: 1, y: 1, z: 7 }, 1_000)).toBe('wait');
  });

  it('espera sem posição própria ainda conhecida', () => {
    expect(decideTileApproach(pending(), null, 1_000)).toBe('wait');
  });

  it('espera num andar diferente, mesmo perto em x/y', () => {
    expect(decideTileApproach(pending(), { x: 4, y: 1, z: 8 }, 1_000)).toBe('wait');
  });

  it('desiste depois do prazo, mesmo sem posição própria', () => {
    expect(decideTileApproach(pending(), null, TILE_APPROACH_TIMEOUT_MS + 1)).toBe('cancel');
  });

  it('o prazo vence ANTES de conferir alcance — desistir tem prioridade sobre mandar', () => {
    expect(decideTileApproach(pending(), { x: 4, y: 2, z: 7 }, TILE_APPROACH_TIMEOUT_MS + 1))
      .toBe('cancel');
  });
});
