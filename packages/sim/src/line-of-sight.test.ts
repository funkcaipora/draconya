import { buildTilemap } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { isSightClear } from './line-of-sight.js';

// Uma sala 7×7 com uma coluna de decoração no meio (linha 3, de x=2 a x=4) que bloqueia VISÃO
// sem bloquear PASSO — `sight` marca `#` onde `grid` não marca, exatamente o caso de uma peça
// de decoração com `unsight` sem `unpass` (RF-08 da spec).
//
//     0 1 2 3 4 5 6
//   0 # # # # # # #
//   1 # . . . . . #
//   2 # . . . . . #
//   3 # . # # # . #   <- bloqueia visão (grid livre, sight bloqueado)
//   4 # . . . . . #
//   5 # . . . . . #
//   6 # # # # # # #
const withSight = buildTilemap({
  id: 'sala-visao', z: 7,
  floors: {
    7: {
      grid: [
        '#######',
        '#.....#',
        '#.....#',
        '#.....#',
        '#.....#',
        '#.....#',
        '#######',
      ],
      sight: [
        '#######',
        '#.....#',
        '#.....#',
        '#.###.#',
        '#.....#',
        '#.....#',
        '#######',
      ],
    },
  },
});

// Mesmo formato, sem a camada `sight` — o caso de todo mapa hoje (RF-02).
const withoutSight = buildTilemap({
  id: 'sala-sem-camada', z: 7,
  floors: { 7: { grid: ['#######', '#.....#', '#.....#', '#.....#', '#######'] } },
});

describe('isSightClear', () => {
  it('é livre entre tiles adjacentes, mesmo com obstáculo colado', () => {
    expect(isSightClear(withSight, { x: 1, y: 3, z: 7 }, { x: 2, y: 3, z: 7 })).toBe(true);
  });

  it('é livre na origem e no destino (mesmo tile)', () => {
    expect(isSightClear(withSight, { x: 1, y: 1, z: 7 }, { x: 1, y: 1, z: 7 })).toBe(true);
  });

  it('vetor horizontal sem obstáculo', () => {
    expect(isSightClear(withSight, { x: 1, y: 1, z: 7 }, { x: 5, y: 1, z: 7 })).toBe(true);
  });

  it('vetor vertical sem obstáculo', () => {
    expect(isSightClear(withSight, { x: 1, y: 1, z: 7 }, { x: 1, y: 5, z: 7 })).toBe(true);
  });

  it('vetor diagonal sem obstáculo (fora da linha da coluna, y=3)', () => {
    expect(isSightClear(withSight, { x: 1, y: 4, z: 7 }, { x: 5, y: 5, z: 7 })).toBe(true);
  });

  it('vetor horizontal com obstáculo NO MEIO do trajeto é bloqueado', () => {
    expect(isSightClear(withSight, { x: 1, y: 3, z: 7 }, { x: 5, y: 3, z: 7 })).toBe(false);
  });

  it('vetor vertical atravessando a coluna (x=3) é bloqueado', () => {
    expect(isSightClear(withSight, { x: 3, y: 1, z: 7 }, { x: 3, y: 5, z: 7 })).toBe(false);
  });

  it('vetor vertical fora da coluna (x=1) não é afetado por ela', () => {
    expect(isSightClear(withSight, { x: 1, y: 1, z: 7 }, { x: 1, y: 5, z: 7 })).toBe(true);
  });

  it('a origem em cima de um tile que bloqueia não bloqueia a própria linha', () => {
    // (2,3) bloqueia visão; atirar A PARTIR dele, por uma linha sem NENHUM tile bloqueado no
    // meio, não deve se auto-bloquear.
    expect(isSightClear(withSight, { x: 2, y: 3, z: 7 }, { x: 2, y: 1, z: 7 })).toBe(true);
  });

  it('o destino em cima de um tile que bloqueia não bloqueia a própria linha', () => {
    expect(isSightClear(withSight, { x: 2, y: 1, z: 7 }, { x: 2, y: 3, z: 7 })).toBe(true);
  });

  it('andar diferente é sempre bloqueado, mesmo com (x,y) idênticos', () => {
    expect(isSightClear(withSight, { x: 1, y: 1, z: 7 }, { x: 1, y: 1, z: 8 })).toBe(false);
  });

  it('mapa sem a camada `sight` neste andar é sempre livre (RF-02)', () => {
    expect(isSightClear(withoutSight, { x: 1, y: 1, z: 7 }, { x: 5, y: 1, z: 7 })).toBe(true);
  });
});
