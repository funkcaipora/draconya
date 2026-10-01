import { buildTilemap } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { TileOccupancy } from './movement.js';
import { Rng } from './rng.js';
import {
  findRelation, levitateDestination, ropeDestination, rollFoods,
} from './utility-spells.js';
import type { CompassDirection } from './utility-spells.js';

const at = (x: number, y: number, z: number) => ({ x, y, z });

describe('findRelation — a bússola do find_person.lua (#623)', () => {
  // 30 tiles: bem fora de "ao lado" (< 5), dentro de "perto" (< 101). A diferença do script é
  // `procurador − alvo`, então o alvo a OESTE tem `dx > 0`.
  const from = at(100, 100, 8);
  const cases: ReadonlyArray<readonly [string, ReturnType<typeof at>, CompassDirection]> = [
    ['leste', at(130, 100, 8), 'east'],
    ['oeste', at(70, 100, 8), 'west'],
    ['norte', at(100, 70, 8), 'north'],
    ['sul', at(100, 130, 8), 'south'],
    ['nordeste', at(130, 70, 8), 'north-east'],
    ['noroeste', at(70, 70, 8), 'north-west'],
    ['sudeste', at(130, 130, 8), 'south-east'],
    ['sudoeste', at(70, 130, 8), 'south-west'],
  ];
  for (const [name, to, direction] of cases) {
    it(`o alvo ao ${name}`, () => {
      expect(findRelation(from, to)).toEqual({ distance: 'close', level: 'same', direction });
    });
  }

  it('os limites dos setores: tan(22,5°) = 0,4142 e tan(67,5°) = 2,4142, comparados com `<` estrito', () => {
    // dx = 100, dy = 41 → tangente 0,41 < 0,4142: ainda LESTE/OESTE. dy = 42 → 0,42: diagonal.
    expect(findRelation(at(100, 100, 8), at(0, 59, 8)).direction).toBe('west');
    expect(findRelation(at(100, 100, 8), at(0, 58, 8)).direction).toBe('north-west');
    // dx = 41, dy = 100 → tangente 2,439 > 2,4142: NORTE. dx = 42 → 2,38: diagonal.
    expect(findRelation(at(100, 100, 8), at(59, 0, 8)).direction).toBe('north');
    expect(findRelation(at(100, 100, 8), at(58, 0, 8)).direction).toBe('north-west');
  });

  it('as faixas de distância pelo MAIOR eixo: ao lado < 5, perto < 101, longe < 275, muito longe', () => {
    const far = (distance: number) => findRelation(at(1000, 1000, 8), at(1000 + distance, 1000, 8)).distance;
    expect(far(4)).toBe('beside');
    expect(far(5)).toBe('close');
    expect(far(100)).toBe('close');
    expect(far(101)).toBe('far');
    expect(far(274)).toBe('far');
    expect(far(275)).toBe('very-far');
    // O maior eixo, não a soma nem a euclidiana: 4 e 4 continuam "ao lado".
    expect(findRelation(at(0, 0, 8), at(4, 4, 8)).distance).toBe('beside');
  });

  it('"ao lado" não leva direção (o Canary só a acrescenta depois da faixa)', () => {
    expect(findRelation(at(10, 10, 8), at(12, 10, 8))).toEqual({ distance: 'beside', level: 'same' });
  });

  it('o andar: `z` MENOR do alvo é "higher" (acima), MAIOR é "lower" (abaixo)', () => {
    expect(findRelation(at(10, 10, 8), at(10, 10, 7)).level).toBe('higher');
    expect(findRelation(at(10, 10, 8), at(10, 10, 9)).level).toBe('lower');
    expect(findRelation(at(10, 10, 8), at(10, 10, 8)).level).toBe('same');
  });

  it('o mesmo (x, y) em outro andar é "ao lado" — o "abaixo de você" do Canary', () => {
    expect(findRelation(at(10, 10, 8), at(10, 10, 9))).toEqual({ distance: 'beside', level: 'lower' });
  });
});

// --- o mapa de teste do Levitate e do Magic Rope -------------------------------------------

/** Um mapa de dois andares, 7×5. `floors` é o que cada andar desenha, de cima para baixo. */
function worldOf(floors: Readonly<Record<number, readonly string[]>>, floorChanges: readonly object[] = []) {
  const map = buildTilemap({
    id: 'utility', z: Math.max(...Object.keys(floors).map(Number)),
    floors: Object.fromEntries(Object.entries(floors).map(([z, grid]) => [z, { grid: [...grid] }])),
    floorChanges: floorChanges as never,
  });
  return new TileOccupancy(map);
}

const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#######'];

describe('levitateDestination — as regras do levitate.lua sobre o mapa (#623)', () => {
  // Andar 8 (em cima): (3,2) é parede — o "vazio" de quem levita para cima —, e (4,2) é o pouso.
  const UPPER = ['#######', '#.....#', '#..#..#', '#.....#', '#######'];

  it('up: a sonda de CIMA vazia e o tile da frente um andar acima com chão → o pouso', () => {
    const world = worldOf({ 8: UPPER, 9: ROOM });
    expect(levitateDestination(world, at(3, 2, 9), 'east', 'up')).toEqual(at(4, 2, 8));
  });

  it('up: a direção que o personagem ENCARA decide o pouso (`FORWARD`)', () => {
    const world = worldOf({ 8: UPPER, 9: ROOM });
    expect(levitateDestination(world, at(3, 2, 9), 'west', 'up')).toEqual(at(2, 2, 8));
    expect(levitateDestination(world, at(3, 2, 9), 'north', 'up')).toEqual(at(3, 1, 8));
    expect(levitateDestination(world, at(3, 2, 9), 'south', 'up')).toEqual(at(3, 3, 8));
  });

  it('up: a sonda com CHÃO (livre no andar de cima) recusa', () => {
    const world = worldOf({ 8: ROOM, 9: ROOM });
    expect(levitateDestination(world, at(3, 2, 9), 'east', 'up')).toBeNull();
  });

  it('up: o pouso em parede (sem chão), fora do mapa ou em andar que o mapa não tem recusa', () => {
    // Sonda (3,2,8) vazia E pouso (4,2,8) também parede: só o destino recusa.
    const walled = worldOf({ 8: ['#######', '#.....#', '#..##.#', '#.....#', '#######'], 9: ROOM });
    expect(levitateDestination(walled, at(3, 2, 9), 'east', 'up')).toBeNull();
    // Pouso fora do mapa: a borda leste (x = 7) não existe.
    const edge = worldOf({ 8: UPPER, 9: ROOM });
    expect(levitateDestination(edge, at(6, 2, 9), 'east', 'up')).toBeNull();
    // Sem andar acima no mapa: o tile de cima "não existe" (vazio), mas o pouso também não.
    const single = worldOf({ 9: ROOM });
    expect(levitateDestination(single, at(3, 2, 9), 'east', 'up')).toBeNull();
  });

  it('up: o pouso com ESCADA (`TILESTATE_FLOORCHANGE`) recusa', () => {
    const world = worldOf({ 8: UPPER, 9: ROOM }, [{ from: at(4, 2, 8), to: at(4, 2, 9) }]);
    expect(levitateDestination(world, at(3, 2, 9), 'east', 'up')).toBeNull();
  });

  it('up: o pouso OCUPADO recusa (tile é exclusivo — o `IGNOREBLOCKCREATURE` do Canary não vale aqui)', () => {
    const world = worldOf({ 8: UPPER, 9: ROOM });
    world.occupy(4, 2, 8);
    expect(levitateDestination(world, at(3, 2, 9), 'east', 'up')).toBeNull();
  });

  it('down: a sonda da FRENTE (mesmo andar) vazia e o pouso um andar abaixo com chão', () => {
    // Andar 9: (4,2) é parede — o vazio da frente; andar 10: (4,2) é chão livre.
    const world = worldOf({ 9: ['#######', '#.....#', '#..#..#', '#.....#', '#######'], 10: ROOM });
    expect(levitateDestination(world, at(3, 2, 9), 'east', 'down')).toBeNull(); // (4,2,9) é chão
    expect(levitateDestination(world, at(2, 2, 9), 'east', 'down')).toEqual(at(3, 2, 10)); // (3,2,9) é parede
  });

  it('down: com chão na frente, recusa', () => {
    const world = worldOf({ 9: ROOM, 10: ROOM });
    expect(levitateDestination(world, at(3, 2, 9), 'east', 'down')).toBeNull();
  });

  it('a fronteira de andar: up recusa em z=8, down recusa em z=7 — sem olhar o mapa', () => {
    const open = worldOf({ 7: ['#######', '#.....#', '#..#..#', '#.....#', '#######'], 8: ROOM });
    expect(levitateDestination(open, at(3, 2, 8), 'east', 'up')).toBeNull();
    const surface = worldOf({ 7: ['#######', '#..#..#', '#..#..#', '#.....#', '#######'], 8: ROOM });
    expect(levitateDestination(surface, at(2, 2, 7), 'east', 'down')).toBeNull();
    // Um andar acima da fronteira funciona: o mesmo mapa a partir do z=9.
    const deep = worldOf({ 8: ['#######', '#.....#', '#..#..#', '#.....#', '#######'], 9: ROOM });
    expect(levitateDestination(deep, at(3, 2, 9), 'east', 'up')).toEqual(at(4, 2, 8));
  });
});

describe('ropeDestination — a Position:moveUpstairs (#623)', () => {
  // O rope spot está em (3,2,9). O andar de cima é o 8.
  const upper = (rows: readonly string[]) => worldOf({ 8: rows, 9: ROOM });
  const from = at(3, 2, 9);

  it('o tile ao SUL do rope spot, um andar acima, é o pouso preferido', () => {
    expect(ropeDestination(upper(ROOM), from)).toEqual(at(3, 3, 8));
  });

  it('sul fechado: norte, depois leste, oeste, sudoeste, sudeste, noroeste, nordeste', () => {
    const wall = (open: ReadonlyArray<readonly [number, number]>): readonly string[] => {
      const rows = ROOM.map((row) => row.split(''));
      for (const [x, y] of open) (rows[y] as string[])[x] = '#';
      return rows.map((row) => row.join(''));
    };
    // Cada teste fecha os tiles já tentados. Ordem (dx,dy): sul (0,1), N (0,-1), E (1,0), O (-1,0),
    // SO (-1,1), SE (1,1), NO (-1,-1), NE (1,-1) — em volta de (3,2).
    const tried: ReadonlyArray<readonly [number, number]> = [
      [3, 3], [3, 1], [4, 2], [2, 2], [2, 3], [4, 3], [2, 1], [4, 1],
    ];
    const expected = [at(3, 1, 8), at(4, 2, 8), at(2, 2, 8), at(2, 3, 8), at(4, 3, 8), at(2, 1, 8), at(4, 1, 8)];
    for (let i = 0; i < expected.length; i += 1) {
      expect(ropeDestination(upper(wall(tried.slice(0, i + 1))), from), `${String(i + 1)}º fechado`)
        .toEqual(expected[i]);
    }
  });

  it('sem nenhum tile andável em volta, ou sem andar acima: null (sem espaço)', () => {
    const closed = ['#######', '#######', '#######', '#######', '#######'];
    expect(ropeDestination(upper(closed), from)).toBeNull();
    expect(ropeDestination(worldOf({ 9: ROOM }), from)).toBeNull();
  });

  it('um tile que bloqueia projétil (camada sight) não é andável para o pouso da corda', () => {
    // `isWalkable(..., proj=true)` recusa o que bloqueia projétil. Sight `#` em (3,3): o pouso sul
    // cai e o norte assume.
    const map = buildTilemap({
      id: 'utility', z: 9,
      floors: {
        8: { grid: ROOM, sight: ['#######', '#.....#', '#.....#', '#..#..#', '#######'] },
        9: { grid: ROOM },
      },
    });
    expect(ropeDestination(new TileOccupancy(map), from)).toEqual(at(3, 1, 8));
  });
});

describe('rollFoods — a ordem de consumo do Rng do food.lua (#623)', () => {
  /** Um Rng que devolve valores dados, e anota o que foi pedido. */
  function scripted(values: readonly number[]): { rng: Rng; calls: Array<[number, number]> } {
    const calls: Array<[number, number]> = [];
    const queue = [...values];
    const rng = new Rng({ a: 0, b: 0, c: 0, d: 0 });
    rng.integer = (min: number, max: number): number => {
      calls.push([min, max]);
      return queue.shift() ?? min;
    };
    return { rng, calls };
  }
  const foods = ['meat', 'ham', 'grapes', 'red-apple', 'bread', 'roll', 'cheese'];

  it('bônus 0: UM item, um único índice sorteado — [0,1] e depois [0,6]', () => {
    const { rng, calls } = scripted([0, 2]);
    expect(rollFoods(rng, foods)).toEqual(['grapes']);
    expect(calls).toEqual([[0, 1], [0, 6]]);
  });

  it('bônus 1: DOIS itens, o extra sai ANTES do garantido — [0,1], [0,6], [0,6]', () => {
    const { rng, calls } = scripted([1, 4, 6]);
    expect(rollFoods(rng, foods)).toEqual(['bread', 'cheese']);
    expect(calls).toEqual([[0, 1], [0, 6], [0, 6]]);
  });

  it('a lista de UM item sorteia o índice 0 (a fronteira do uniforme)', () => {
    const { rng } = scripted([0, 0]);
    expect(rollFoods(rng, ['meat'])).toEqual(['meat']);
  });
});
