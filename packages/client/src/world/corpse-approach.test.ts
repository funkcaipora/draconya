// A decisão pura de quando mandar `open-corpse` (#722, ADR 0048 d.4 — ajuste do DT-01).

import { describe, expect, it } from 'vitest';
import { CORPSE_APPROACH_TIMEOUT_MS, decideCorpseApproach } from './corpse-approach.js';
import type { PendingCorpseOpen } from './corpse-approach.js';

const pending: PendingCorpseOpen = {
  groundItemId: 7, position: { x: 10, y: 10, z: 7 }, requestedAtMs: 1_000,
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
    const late = pending.requestedAtMs + CORPSE_APPROACH_TIMEOUT_MS + 1;
    expect(decideCorpseApproach(pending, { x: 10, y: 10, z: 7 }, true, late)).toBe('cancel');
  });

  it('ainda espera exatamente no limite do prazo', () => {
    const atLimit = pending.requestedAtMs + CORPSE_APPROACH_TIMEOUT_MS;
    expect(decideCorpseApproach(pending, { x: 0, y: 0, z: 7 }, true, atLimit)).toBe('wait');
  });
});
