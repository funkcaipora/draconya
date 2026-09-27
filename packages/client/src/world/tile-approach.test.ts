import { describe, expect, it } from 'vitest';
import {
  TILE_APPROACH_BASE_TIMEOUT_MS, TILE_APPROACH_PER_TILE_MS, decideTileApproach, tileApproachDeadline,
} from './tile-approach.js';
import type { PendingTileUse } from './tile-approach.js';

// A decisão de usar um tile sozinho quando o personagem chega perto (#729, ADR 0050 d.7). PURA:
// sem React, sem timer, sem `net/`.

function pending(over: Partial<PendingTileUse> = {}): PendingTileUse {
  return { position: { x: 4, y: 2, z: 7 }, deadlineMs: TILE_APPROACH_BASE_TIMEOUT_MS, ...over };
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
    expect(decideTileApproach(pending(), null, TILE_APPROACH_BASE_TIMEOUT_MS + 1)).toBe('cancel');
  });

  it('o prazo vence ANTES de conferir alcance — desistir tem prioridade sobre mandar', () => {
    expect(decideTileApproach(pending(), { x: 4, y: 2, z: 7 }, TILE_APPROACH_BASE_TIMEOUT_MS + 1))
      .toBe('cancel');
  });
});

describe('tileApproachDeadline (#763)', () => {
  it('é só a base sem posição própria conhecida', () => {
    expect(tileApproachDeadline(null, { x: 10, y: 10, z: 7 }, 1_000))
      .toBe(1_000 + TILE_APPROACH_BASE_TIMEOUT_MS);
  });

  it('cresce um segundo por tile de distância no instante do pedido', () => {
    // 11 tiles de distância — o cenário do QA ao vivo na Darashia Dragon Lair.
    const deadline = tileApproachDeadline({ x: 0, y: 0, z: 7 }, { x: 11, y: 0, z: 7 }, 1_000);
    expect(deadline).toBe(1_000 + TILE_APPROACH_BASE_TIMEOUT_MS + 11 * TILE_APPROACH_PER_TILE_MS);
  });

  it('andar diferente é tratado como distância zero — a escada resolve o resto', () => {
    expect(tileApproachDeadline({ x: 0, y: 0, z: 6 }, { x: 20, y: 20, z: 7 }, 1_000))
      .toBe(1_000 + TILE_APPROACH_BASE_TIMEOUT_MS);
  });
});
