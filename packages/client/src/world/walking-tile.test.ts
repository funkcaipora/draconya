// A tabela do walking tile (#386, §11): a que tile a criatura pertence em cada instante do passo.
//
// Todos os casos rodam sem pacote de arte: é aritmética pura, e é isso que o OTClient prescreve
// em números (ADR 0019). `TILE = 32`; o displacement usual dos outfits é `(8, 8)`.

import { describe, expect, it } from 'vitest';
import { TILE } from './camera.js';
import { NO_DISPLACEMENT, walkingTile, type Displacement } from './walking-tile.js';

interface Coord { readonly x: number; readonly y: number }

const SHIFT: Displacement = { x: 8, y: 8 };

/** A posição interpolada de `from` a `to` num progresso `p`, como `interpolate` a dá. */
function at(from: Coord, to: Coord, p: number, displacement: Displacement = SHIFT): {
  position: Coord; logical: Coord; displacement: Displacement;
} {
  return {
    position: { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p },
    logical: { x: to.x, y: to.y },
    displacement,
  };
}

/** A sequência da tabela: os cinco instantes de captura 0 / 0,25 / 0,5 / 0,75 / 1. */
const SAMPLES = [0, 0.25, 0.5, 0.75, 1] as const;

function walk(from: Coord, to: Coord, p: number, displacement: Displacement = SHIFT): Coord {
  return walkingTile(at(from, to, p, displacement));
}

describe('walkingTile (#386)', () => {
  it('RF-01: leste troca aos 50 % — origem, origem, destino, destino, destino', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 1, y: 0 };
    expect(SAMPLES.map((p) => walk(from, to, p))).toEqual([
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 },
    ]);
  });

  it('RF-01: sul troca aos 50 % no eixo `y`, com a mesma regra do `x`', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 0, y: 1 };
    expect(SAMPLES.map((p) => walk(from, to, p))).toEqual([
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 1 },
    ]);
  });

  it('RF-01: norte troca aos 75 % — origem até 50 %, destino em 75 % e 100 %', () => {
    // A regra SIMÉTRICA (`Math.round`) trocaria aos 50 %: é o defeito que esta issue existe para
    // pegar — quem anda para norte leva o canto ATRÁS do corpo e troca tarde.
    const from = { x: 0, y: 1 };
    const to = { x: 0, y: 0 };
    expect(SAMPLES.map((p) => walk(from, to, p))).toEqual([
      { x: 0, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 },
    ]);
  });

  it('RF-01: oeste troca aos 75 % no eixo `x`', () => {
    const from = { x: 1, y: 0 };
    const to = { x: 0, y: 0 };
    expect(SAMPLES.map((p) => walk(from, to, p))).toEqual([
      { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
    ]);
  });

  it('RF-01: diagonal decide cada eixo por si — SE e NE', () => {
    // Eixos ACOPLADOS (decidir os dois pelo mesmo instante) dariam NE aos 50 % como `(1, 0)`;
    // a resposta é `(1, 1)`: o `x` troca aos 50 %, o `y` aos 75 %.
    expect(SAMPLES.map((p) => walk({ x: 0, y: 0 }, { x: 1, y: 1 }, p))).toEqual([
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 },
    ]);
    expect(SAMPLES.map((p) => walk({ x: 0, y: 1 }, { x: 1, y: 0 }, p))).toEqual([
      { x: 0, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 0 },
    ]);
  });

  it('RF-01: sem displacement, leste troca no primeiro pixel e norte só no último', () => {
    // `TILE` em vez de `TILE − 1` no canto faria leste trocar só em `p = 1`; displacement
    // SOMADO em vez de subtraído inverteria o sentido. Mutação que mata: `+ displacement`.
    const from = { x: 0, y: 0 };
    const to = { x: 1, y: 0 };
    expect(walk(from, to, 1 / TILE, NO_DISPLACEMENT)).toEqual({ x: 1, y: 0 });

    const north = { from: { x: 0, y: 1 }, to: { x: 0, y: 0 } };
    expect(walk(north.from, north.to, 31 / TILE, NO_DISPLACEMENT)).toEqual({ x: 0, y: 1 });
    expect(walk(north.from, north.to, 1, NO_DISPLACEMENT)).toEqual({ x: 0, y: 0 });
  });

  it('RF-08: parada devolve o tile lógico, para qualquer displacement', () => {
    // A fórmula aplicada ao eixo parado com 40 devolveria `x − 1`: "parada é do próprio tile"
    // é a propriedade que este caso prende. Mutação que mata: tirar o `if (position === logical)`.
    for (const displacement of [SHIFT, { x: 40, y: 40 }]) {
      expect(walkingTile({
        position: { x: 3, y: 5 }, logical: { x: 3, y: 5 }, displacement,
      })).toEqual({ x: 3, y: 5 });
    }
  });

  it('RF-07: o resultado nunca sai do 3×3 em volta do lógico — displacement 40 incluso', () => {
    // Sem o `min/max` de `axis`, o canto em `−9` daria o tile `−1`, a dois de distância do
    // lógico — é o defeito que o clamp pega (DT-03). Mutação que mata: remover o `Math.min`/
    // `Math.max` de `axis`.
    const from = { x: 0, y: 0 };
    const to = { x: 1, y: 0 };
    const displacement = { x: 40, y: 40 };
    for (let step = 0; step <= TILE; step++) {
      const tile = walk(from, to, step / TILE, displacement);
      expect(Math.abs(tile.x - to.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(tile.y - to.y)).toBeLessThanOrEqual(1);
    }
    // A `p = 0` é `(0, 0)`, não `(−1, 0)`.
    expect(walk(from, to, 0, displacement)).toEqual({ x: 0, y: 0 });
  });
});