import { describe, expect, it } from 'vitest';
import {
  CANARY_DIRECTION, FLEE_DIRECTIONS, NO_FLEE_INDEX, fleePath, initialFleeIndex, isStuck, stepFrom,
} from './fear.js';
import type { FleeMap } from './fear.js';
import { Rng } from './rng.js';

/** Um campo aberto: nenhum tile barra nada. */
const openField: FleeMap = { walkable: () => true, harmfulField: () => false, sightClear: () => true };

/** O mesmo campo, com tiles que não aceitam passo (parede, criatura) e tiles com campo de dano. */
function field(over: {
  blocked?: readonly (readonly [number, number])[];
  harmful?: readonly (readonly [number, number])[];
  sight?: FleeMap['sightClear'];
} = {}): FleeMap {
  const has = (list: readonly (readonly [number, number])[] | undefined, x: number, y: number): boolean =>
    (list ?? []).some(([bx, by]) => bx === x && by === y);
  return {
    walkable: (x, y) => !has(over.blocked, x, y),
    harmfulField: (x, y) => has(over.harmful, x, y),
    sightClear: over.sight ?? (() => true),
  };
}

const NAME = ['N', 'E', 'S', 'W', 'SW', 'SE', 'NW', 'NE'];
const letters = (path: readonly number[]): string => path.map((d) => NAME[d]).join('');

describe('stepFrom — getNextPosition do Canary', () => {
  it('cada direção do enum desloca como `src/utils/tools.cpp:581`', () => {
    const from = { x: 10, y: 10 };
    expect(stepFrom(from, CANARY_DIRECTION.north)).toEqual({ x: 10, y: 9 });
    expect(stepFrom(from, CANARY_DIRECTION.east)).toEqual({ x: 11, y: 10 });
    expect(stepFrom(from, CANARY_DIRECTION.south)).toEqual({ x: 10, y: 11 });
    expect(stepFrom(from, CANARY_DIRECTION.west)).toEqual({ x: 9, y: 10 });
    expect(stepFrom(from, CANARY_DIRECTION.southwest)).toEqual({ x: 9, y: 11 });
    expect(stepFrom(from, CANARY_DIRECTION.southeast)).toEqual({ x: 11, y: 11 });
    expect(stepFrom(from, CANARY_DIRECTION.northwest)).toEqual({ x: 9, y: 9 });
    expect(stepFrom(from, CANARY_DIRECTION.northeast)).toEqual({ x: 11, y: 9 });
  });

  it('um valor fora do enum não anda', () => {
    expect(stepFrom({ x: 3, y: 4 }, 42)).toEqual({ x: 3, y: 4 });
  });
});

describe('initialFleeIndex — as cinco regiões de `getFleeDirection` (condition.cpp:2223)', () => {
  const rng = (): Rng => Rng.fromSeed('fear-regions');
  const from = { x: 20, y: 20 };
  /** A criatura em (20,20) e o lançador deslocado por `(-dx, -dy)` — o offset da criatura é (dx, dy). */
  const at = (offsetX: number, offsetY: number): number =>
    initialFleeIndex(openField, from, { x: from.x - offsetX, y: from.y - offsetY }, rng());

  it('offset x ≥ 1 e y ≤ 0: mesma linha foge para 2 (E), acima do lançador foge para 0 (N)', () => {
    expect(at(3, 0)).toBe(2);
    expect(at(3, -2)).toBe(0);
    expect(at(1, -1)).toBe(0);
  });

  it('offset x ≥ 0 e y ≥ 1: mesma coluna foge para 4 (S), senão para 2 (E)', () => {
    expect(at(0, 3)).toBe(4);
    expect(at(2, 3)).toBe(2);
    expect(at(1, 1)).toBe(2);
  });

  it('offset x ≤ -1 e y ≥ 0: mesma linha foge para 6 (W), abaixo do lançador foge para 4 (S)', () => {
    expect(at(-3, 0)).toBe(6);
    expect(at(-3, 2)).toBe(4);
  });

  it('offset x ≤ 0 e y ≤ -1: mesma coluna foge para 0 (N), senão para 6 (W)', () => {
    expect(at(0, -3)).toBe(0);
    expect(at(-2, -3)).toBe(6);
  });

  it('as cinco regiões cobrem o plano inteiro: todo offset não nulo dá um índice de 0 a 7, sem sorteio', () => {
    const counted = { integerCalls: 0 };
    class CountingRng extends Rng {
      override integer(min: number, max: number): number {
        counted.integerCalls += 1;
        return super.integer(min, max);
      }
    }
    const counting = new CountingRng(Rng.fromSeed('fear-plane').getState());
    for (let dx = -4; dx <= 4; dx += 1) {
      for (let dy = -4; dy <= 4; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const index = initialFleeIndex(openField, from, { x: from.x - dx, y: from.y - dy }, counting);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(FLEE_DIRECTIONS.length);
      }
    }
    // Só o tile do próprio lançador sorteia — todo o resto é determinístico dado o offset.
    expect(counted.integerCalls).toBe(0);
  });

  it('no MESMO tile do lançador sorteia com o Rng da sessão e grava o VALOR do enum como índice', () => {
    // O Canary embaralha as oito direções e grava `static_cast<uint8_t>(*it)` — o valor do enum
    // (N=0, E=1, S=2, W=3, SW=4, SE=5, NW=6, NE=7) — em `fleeIndx`, que depois indexa
    // `m_directionsVector`. Os oito valores possíveis são justamente 0..7.
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed += 1) {
      const index = initialFleeIndex(openField, from, from, Rng.fromSeed(`same-tile-${String(seed)}`));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(7);
      seen.add(index);
    }
    // Uniforme: com 200 sementes as oito direções aparecem.
    expect(seen.size).toBe(8);
    // Determinístico por semente: a mesma semente sorteia a mesma direção.
    expect(initialFleeIndex(openField, from, from, Rng.fromSeed('same-tile-7')))
      .toBe(initialFleeIndex(openField, from, from, Rng.fromSeed('same-tile-7')));
  });

  it('o sorteio só escolhe entre vizinhos que aceitam o passo, e sem nenhum devolve `NO_FLEE_INDEX`', () => {
    // Só o leste (enum 1) está livre.
    const onlyEast = field({
      blocked: [[20, 19], [20, 21], [19, 20], [19, 21], [21, 21], [19, 19], [21, 19]],
    });
    for (let seed = 0; seed < 20; seed += 1) {
      expect(initialFleeIndex(onlyEast, from, from, Rng.fromSeed(`east-${String(seed)}`))).toBe(1);
    }
    const walled = field({
      blocked: [[20, 19], [20, 21], [19, 20], [21, 20], [19, 21], [21, 21], [19, 19], [21, 19]],
    });
    expect(initialFleeIndex(walled, from, from, rng())).toBe(NO_FLEE_INDEX);
  });

  it('campo de dano no vizinho também tira a direção do sorteio (`canWalkTo`)', () => {
    const fire = field({
      blocked: [[20, 19], [20, 21], [19, 20], [19, 21], [21, 21], [19, 19]],
      harmful: [[21, 19]], // o único vizinho "livre" tem um campo de dano
    });
    // O leste (21,20) é o único que resta livre e SEM campo.
    expect(initialFleeIndex(fire, from, from, rng())).toBe(1);
  });
});

describe('fleePath — `getFleePath` (condition.cpp:2299), num campo aberto', () => {
  const from = { x: 20, y: 20 };

  it('índice 0 (N): foge para o norte, sete passos — o limite da caixa de busca', () => {
    // O ponto sintético fica 15 tiles ao SUL (`y += wsize`) e a busca escolhe o nó mais distante
    // dele que a caixa de sete tiles alcança: a fuga é reta para o norte.
    const result = fleePath(openField, from, 0);
    expect(result.ok).toBe(true);
    expect(letters(result.path)).toBe('NNNNNNN');
    expect(result.index).toBe(0);
  });

  it('índice 2 (E): foge para o leste', () => {
    expect(letters(fleePath(openField, from, 2).path)).toBe('EEEEEEE');
  });

  it('índice 6 (W): foge para o oeste', () => {
    expect(letters(fleePath(openField, from, 6).path)).toBe('WWWWWWW');
  });

  it('as esquisitices do Canary ficam: o índice 4 (S) soma +y como o N, e foge para o NORTE', () => {
    // `DIRECTION_SOUTH: futurePos.y += wsize` — o mesmo deslocamento do `NORTH`. A região "o
    // lançador está a noroeste" escolhe o índice 4 querendo fugir para o sul, e o Canary foge
    // para o norte. O comportamento observado é o da fonte.
    expect(letters(fleePath(openField, from, 4).path)).toBe('NNNNNNN');
  });

  it('os diagonais do norte (NE, NW) miram o MESMO ponto e fogem para o oeste', () => {
    // `NORTHEAST` e `NORTHWEST` somam (+w, -w): o ponto fica a nordeste, e o nó mais distante
    // dele que a caixa alcança está a oeste.
    expect(letters(fleePath(openField, from, 1).path)).toBe('WWWWWWW');
    expect(letters(fleePath(openField, from, 7).path)).toBe('WWWWWWW');
  });

  it('SE e SW (3 e 5) também não fogem para onde o nome diz', () => {
    expect(letters(fleePath(openField, from, 3).path)).toBe('EEEEEEE');
    expect(letters(fleePath(openField, from, 5).path)).toBe('WWWWWWW');
  });

  it('o caminho nunca passa de sete passos e nunca sai da caixa de sete tiles', () => {
    for (let index = 0; index < 8; index += 1) {
      const { path } = fleePath(openField, from, index);
      expect(path.length).toBeLessThanOrEqual(7);
      let cursor = { ...from };
      for (const direction of path) {
        cursor = stepFrom(cursor, direction);
        expect(Math.abs(cursor.x - from.x)).toBeLessThanOrEqual(7);
        expect(Math.abs(cursor.y - from.y)).toBeLessThanOrEqual(7);
      }
    }
  });

  it('a mesma entrada dá SEMPRE o mesmo caminho (determinismo)', () => {
    const a = fleePath(field({ blocked: [[20, 15], [21, 15], [19, 15]] }), from, 0);
    const b = fleePath(field({ blocked: [[20, 15], [21, 15], [19, 15]] }), from, 0);
    expect(a).toEqual(b);
  });
});

describe('fleePath — parede, campo, visão e preso', () => {
  const from = { x: 20, y: 20 };

  it('contorna uma parede à frente: o caminho não pisa em tile barrado e ainda chega longe', () => {
    const wall: [number, number][] = [];
    for (let x = 16; x <= 24; x += 1) wall.push([x, 18]);
    const map = field({ blocked: wall });
    const { ok, path } = fleePath(map, from, 0);
    expect(ok).toBe(true);
    expect(path.length).toBeGreaterThan(0);
    let cursor = { ...from };
    for (const direction of path) {
      cursor = stepFrom(cursor, direction);
      expect(wall.some(([x, y]) => x === cursor.x && y === cursor.y)).toBe(false);
    }
  });

  it('preso (os oito vizinhos barrados): o Canary devolve `false` e nenhum caminho', () => {
    const map = field({
      blocked: [[19, 19], [20, 19], [21, 19], [19, 20], [21, 20], [19, 21], [20, 21], [21, 21]],
    });
    const result = fleePath(map, from, 0);
    expect(isStuck(map, from)).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.path).toEqual([]);
  });

  it('num beco de saída única a fuga cai para a distância menor: o único caminho é o que existe', () => {
    // Só o SUL está livre. O índice 0 mira um ponto 15 tiles ao sul e nenhum nó alcançável está
    // mais longe dele do que o tile de partida (lista vazia com `found` verdadeiro); com 9 e 3
    // idem; com a distância 1 alguns nós da saída ficam mais longe e a busca devolve um caminho
    // — o primeiro passo só pode ser o sul, o único vizinho livre.
    const map = field({
      blocked: [[19, 19], [20, 19], [21, 19], [19, 20], [21, 20], [19, 21], [21, 21]],
    });
    const result = fleePath(map, from, 0);
    expect(result.ok).toBe(true);
    expect(result.path.length).toBeGreaterThan(0);
    expect(result.path[0]).toBe(CANARY_DIRECTION.south);
  });

  it('isStuck: um vizinho livre basta para não estar preso — e o campo de dano NÃO conta como livre', () => {
    const all: [number, number][] = [
      [19, 19], [20, 19], [21, 19], [19, 20], [21, 20], [19, 21], [20, 21], [21, 21],
    ];
    expect(isStuck(field({ blocked: all }), from)).toBe(true);
    expect(isStuck(field({ blocked: all.slice(0, 7) }), from)).toBe(false);
    expect(isStuck(field({ blocked: all.slice(0, 7), harmful: [all[7] as [number, number]] }), from)).toBe(true);
  });

  it('o tile de campo de dano ainda serve de CAMINHO da busca — só o passo o recusa (FLAG_IGNOREFIELDDAMAGE)', () => {
    // A busca de caminho do Canary roda com `FLAG_IGNOREFIELDDAMAGE`: o campo não barra o A*,
    // barra o passo (`internalMoveCreature`, no ruleset).
    const map = field({ harmful: [[20, 19], [20, 18], [20, 17]] });
    expect(letters(fleePath(map, from, 0).path)).toBe('NNNNNNN');
  });

  it('sem visão livre até o ponto sintético nenhum nó acerta, e o índice gira até achar uma direção', () => {
    // Visão só para pontos do lado NORTE (`y <= 20`): o ponto sintético do índice 0 fica ao SUL
    // nos quatro tamanhos, nenhum nó tem visão até ele (`getPathTo` devolve `false`), o índice
    // avança um, e a rodada seguinte — o ponto do índice 1 fica ao norte — acha o caminho.
    const map = field({ sight: (_from, to) => to.y <= 20 });
    const result = fleePath(map, from, 0);
    expect(result.ok).toBe(true);
    expect(result.index).toBe(1);
    expect(result.path.length).toBeGreaterThan(0);
  });
});
