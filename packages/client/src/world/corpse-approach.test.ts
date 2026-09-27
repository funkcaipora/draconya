// A decisão pura de quando mandar `open-corpse` (#722, ADR 0048 d.4 — ajuste do DT-01).

import { describe, expect, it } from 'vitest';
import {
  CORPSE_APPROACH_BASE_TIMEOUT_MS, CORPSE_APPROACH_PER_TILE_MS, corpseApproachDeadline,
  decideCorpseApproach,
} from './corpse-approach.js';
import type { PendingCorpseOpen } from './corpse-approach.js';

const pending: PendingCorpseOpen = {
  groundItemId: 7, position: { x: 10, y: 10, z: 7 }, deadlineMs: 1_000 + CORPSE_APPROACH_BASE_TIMEOUT_MS,
};

describe('decideCorpseApproach (#722)', () => {
  it('manda quando o personagem já está a 1 tile (as oito direções) ou no mesmo tile', () => {
    const adjacent = [
      { x: 10, y: 10, z: 7 }, { x: 9, y: 9, z: 7 }, { x: 11, y: 11, z: 7 },
      { x: 9, y: 11, z: 7 }, { x: 11, y: 9, z: 7 }, { x: 10, y: 9, z: 7 }, { x: 10, y: 11, z: 7 },
    ];
    for (const position of adjacent) {
      expect(decideCorpseApproach(pending, position, true, 1_500)).toBe('send');
    }
  });

  it('espera quando o personagem está a 2+ tiles', () => {
    expect(decideCorpseApproach(pending, { x: 8, y: 10, z: 7 }, true, 1_500)).toBe('wait');
    expect(decideCorpseApproach(pending, { x: 12, y: 12, z: 7 }, true, 1_500)).toBe('wait');
  });

  it('espera quando não há posição própria ainda (world.selfId sem criatura)', () => {
    expect(decideCorpseApproach(pending, null, true, 1_500)).toBe('wait');
  });

  it('espera quando o andar diverge, mesmo perto em x/y — a escada não é a mesma posição', () => {
    expect(decideCorpseApproach(pending, { x: 10, y: 10, z: 6 }, true, 1_500)).toBe('wait');
  });

  it('cancela quando o cadáver já não existe mais', () => {
    expect(decideCorpseApproach(pending, { x: 10, y: 10, z: 7 }, false, 1_500)).toBe('cancel');
  });

  it('cancela depois do prazo, mesmo perto — o jogador não chegou a tempo', () => {
    expect(decideCorpseApproach(pending, { x: 10, y: 10, z: 7 }, true, pending.deadlineMs + 1))
      .toBe('cancel');
  });

  it('ainda espera exatamente no limite do prazo', () => {
    expect(decideCorpseApproach(pending, { x: 0, y: 0, z: 7 }, true, pending.deadlineMs)).toBe('wait');
  });
});

describe('corpseApproachDeadline (#763)', () => {
  // Achado de QA ao vivo: um `walk-to` para um cadáver a onze tiles, com dragões no caminho
  // (Darashia Dragon Lair), levava bem mais que dez segundos para chegar — e o prazo FIXO de
  // antes expirava o pedido antes do personagem sequer terminar de andar.
  it('é só a base sem posição própria conhecida', () => {
    expect(corpseApproachDeadline(null, { x: 10, y: 10, z: 7 }, 1_000))
      .toBe(1_000 + CORPSE_APPROACH_BASE_TIMEOUT_MS);
  });

  it('cresce um segundo por tile de distância no instante do pedido', () => {
    const deadline = corpseApproachDeadline({ x: 0, y: 0, z: 7 }, { x: 11, y: 0, z: 7 }, 1_000);
    expect(deadline).toBe(1_000 + CORPSE_APPROACH_BASE_TIMEOUT_MS + 11 * CORPSE_APPROACH_PER_TILE_MS);
  });

  it('a distância é Chebyshev — diagonal conta como um tile, não dois', () => {
    const deadline = corpseApproachDeadline({ x: 0, y: 0, z: 7 }, { x: 5, y: 5, z: 7 }, 1_000);
    expect(deadline).toBe(1_000 + CORPSE_APPROACH_BASE_TIMEOUT_MS + 5 * CORPSE_APPROACH_PER_TILE_MS);
  });

  it('andar diferente é tratado como distância zero — a escada resolve o resto', () => {
    expect(corpseApproachDeadline({ x: 0, y: 0, z: 6 }, { x: 20, y: 20, z: 7 }, 1_000))
      .toBe(1_000 + CORPSE_APPROACH_BASE_TIMEOUT_MS);
  });
});
