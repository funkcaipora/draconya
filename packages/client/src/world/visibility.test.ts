// A regra de quais andares a tela mostra (M23, D7), sem Pixi e sem harness — a cena é um
// `Record<'x,y,z', TileStack>` e as flags uma tabela de ids. Os casos são a seção 11 da spec
// #387, mais os que migraram de `floors.test.ts` (a lista de andares, que era a regra antiga).

import { describe, expect, it } from 'vitest';
import { NO_FLAGS, type AppearanceFlags } from '../assets/appearances.js';
import type { Point } from '../state/world.js';
import type { TileStack } from './scene.js';
import {
  firstVisibleFloor, floorAlpha, lastVisibleFloor, limitsFloorsView, lookPossible,
  paintedFirstFloor, visibleFloors, type FloorFade, type FloorView, type VisibilityInfo,
} from './visibility.js';

const FLOOR = 1;
const ROOF = 2;
const WALL = 3;
const FENCE = 4;
const ARCH = 5;
const SKYLIGHT = 6;
const CRATE = 7;

const FLAGS: Readonly<Record<number, AppearanceFlags>> = {
  [FLOOR]: { ...NO_FLAGS, bankWaypoints: 0 },
  [ROOF]: { ...NO_FLAGS, bankWaypoints: 0 },
  [WALL]: { ...NO_FLAGS, bottom: true, unpass: true, unsight: true },
  [FENCE]: { ...NO_FLAGS, bottom: true, unpass: true },
  [ARCH]: { ...NO_FLAGS, top: true },
  [SKYLIGHT]: { ...NO_FLAGS, bankWaypoints: 0, dontHide: true },
  [CRATE]: { ...NO_FLAGS },
};

const info: VisibilityInfo = { flagsOf: (id) => FLAGS[id] ?? NO_FLAGS };

const P: Point = { x: 10, y: 10, z: 7 };
const at = (x: number, y: number, z: number): Point => ({ x, y, z });

/** Um `FloorView` sobre um `Record<'x,y,z', TileStack>`: `tileAt` devolve a entrada ou `null`. */
function view(): {
  set(x: number, y: number, z: number, stack: TileStack): void;
  field(z: number, x0: number, y0: number, x1: number, y1: number): void;
  floor: FloorView;
} {
  const tiles: Record<string, TileStack> = {};
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  return {
    set(x, y, z, stack) { tiles[key(x, y, z)] = stack; },
    field(z, x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) tiles[key(x, y, z)] = { ground: FLOOR, items: [] };
      }
    },
    floor: { tileAt: (x, y, z) => tiles[key(x, y, z)] ?? null },
  };
}

describe('firstVisibleFloor e lastVisibleFloor (M23, D7)', () => {
  it('campo aberto: first 0, last 7, e a cena inteira pintada do fundo para o topo', () => {
    const open = view();
    open.field(7, 0, 0, 19, 19);

    expect(firstVisibleFloor(open.floor, P, info)).toBe(0);
    expect(lastVisibleFloor(7)).toBe(7);
    expect(visibleFloors([4, 5, 6, 7], 0, 7)).toEqual([7, 6, 5, 4]);
  });

  it('subsolo: dois andares para cada lado, e a rua (7) nunca entra', () => {
    const deep = view();
    deep.field(8, 0, 0, 19, 19);
    expect(firstVisibleFloor(deep.floor, at(10, 10, 8), info)).toBe(8);
    expect(lastVisibleFloor(8)).toBe(10);

    const deeper = view();
    deeper.field(9, 0, 0, 19, 19);
    expect(firstVisibleFloor(deeper.floor, at(10, 10, 9), info)).toBe(8);
    expect(lastVisibleFloor(9)).toBe(11);

    expect(visibleFloors([7, 8, 9, 10, 11], 8, 10)).toEqual([10, 9, 8]);
    expect(visibleFloors([7, 8, 9, 10, 11], 8, 10)).not.toContain(7);
  });

  it('subida e descida: o telhado limita em 7 e some ao subir para o 6', () => {
    const house = view();
    house.field(7, 0, 0, 19, 19);
    house.field(6, 5, 5, 8, 8);

    expect(firstVisibleFloor(house.floor, at(6, 6, 7), info)).toBe(7);
    expect(firstVisibleFloor(house.floor, at(6, 6, 6), info)).toBe(0);
    expect(lastVisibleFloor(6)).toBe(7);
    expect(firstVisibleFloor(house.floor, at(6, 6, 7), info)).toBe(7);
  });

  it('entrar em casa: o tile geometricamente acima e o fisicamente acima limitam', () => {
    const geometrical = view();
    geometrical.set(11, 11, 6, { ground: ROOF, items: [] });
    expect(firstVisibleFloor(geometrical.floor, P, info)).toBe(7);

    const physical = view();
    physical.set(10, 10, 6, { ground: ROOF, items: [] });
    expect(firstVisibleFloor(physical.floor, P, info)).toBe(7);
  });

  it('dontHide não limita: o clarão de telhado deixa ver o andar de cima', () => {
    const geometrical = view();
    geometrical.set(11, 11, 6, { ground: SKYLIGHT, items: [] });
    expect(firstVisibleFloor(geometrical.floor, P, info)).toBe(0);

    const physical = view();
    physical.set(10, 10, 6, { ground: SKYLIGHT, items: [] });
    expect(firstVisibleFloor(physical.floor, P, info)).toBe(0);
  });

  it('parede acima limita; cerca baixa sem vista livre não', () => {
    const wall = view();
    wall.set(10, 10, 7, { ground: FLOOR, items: [] });
    wall.set(10, 10, 6, { ground: 0, items: [{ id: WALL }] });
    expect(firstVisibleFloor(wall.floor, P, info)).toBe(7);

    const fence = view();
    fence.set(10, 10, 7, { ground: FLOOR, items: [] });
    fence.set(10, 10, 6, { ground: 0, items: [{ id: FENCE }] });
    expect(firstVisibleFloor(fence.floor, P, info)).toBe(0);

    const fenceStack: TileStack = { ground: 0, items: [{ id: FENCE }] };
    const wallStack: TileStack = { ground: 0, items: [{ id: WALL }] };
    expect(limitsFloorsView(fenceStack, false, info)).toBe(false);
    expect(limitsFloorsView(fenceStack, true, info)).toBe(true);
    expect(limitsFloorsView(wallStack, false, info)).toBe(true);
    expect(limitsFloorsView({ ground: 0, items: [{ id: ARCH }] }, true, info)).toBe(false);
    expect(limitsFloorsView({ ground: 0, items: [{ id: CRATE }, { id: WALL }] }, false, info)).toBe(true);
  });

  it('vizinho ortogonal só entra com vista livre; a diagonal nunca entra', () => {
    const east = view();
    east.set(11, 10, 7, { ground: FLOOR, items: [] });
    east.set(12, 11, 6, { ground: ROOF, items: [] });
    expect(firstVisibleFloor(east.floor, P, info)).toBe(7);

    const blocked = view();
    blocked.set(11, 10, 7, { ground: FLOOR, items: [{ id: WALL }] });
    blocked.set(12, 11, 6, { ground: ROOF, items: [] });
    expect(firstVisibleFloor(blocked.floor, P, info)).toBe(0);

    const diagonal = view();
    diagonal.set(11, 11, 7, { ground: FLOOR, items: [] });
    diagonal.set(12, 12, 6, { ground: ROOF, items: [] });
    expect(firstVisibleFloor(diagonal.floor, P, info)).toBe(0);
  });

  it('lookPossible: null não tem vista livre, e um item unsight a bloqueia', () => {
    expect(lookPossible(null, info)).toBe(false);
    expect(lookPossible({ ground: FLOOR, items: [] }, info)).toBe(true);
    expect(lookPossible({ ground: FLOOR, items: [{ id: WALL }] }, info)).toBe(false);
  });
});

describe('floorAlpha e paintedFirstFloor (M23, D7)', () => {
  const covering: FloorFade = { first: 7, previous: 0, since: 1000 };
  const uncovering: FloorFade = { first: 0, previous: 7, since: 1000 };

  it('cobrir: o andar que sai esmaece linearmente e para em 0', () => {
    expect(floorAlpha(6, covering, 1000)).toBe(1);
    expect(floorAlpha(6, covering, 1125)).toBeCloseTo(0.5);
    expect(floorAlpha(6, covering, 1250)).toBe(0);
    expect(floorAlpha(6, covering, 2000)).toBe(0);
    expect(floorAlpha(7, covering, 1000)).toBe(1);
    expect(floorAlpha(7, covering, 1125)).toBe(1);
    expect(floorAlpha(5, covering, 1125)).toBeCloseTo(0.5);
  });

  it('descobrir: o andar que entra esmaece linearmente e chega a 1', () => {
    expect(floorAlpha(6, uncovering, 1000)).toBe(0);
    expect(floorAlpha(6, uncovering, 1125)).toBeCloseTo(0.5);
    expect(floorAlpha(6, uncovering, 1250)).toBe(1);
  });

  it('nunca fora de [0, 1], inclusive antes de `since` e num instante distante', () => {
    for (const now of [900, 10 ** 6]) {
      for (const z of [0, 5, 6, 7, 8]) {
        for (const fade of [covering, uncovering]) {
          const alpha = floorAlpha(z, fade, now);
          expect(alpha).toBeGreaterThanOrEqual(0);
          expect(alpha).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('paintedFirstFloor segura o andar que está sumindo até a rampa acabar', () => {
    expect(paintedFirstFloor(covering, 1125)).toBe(0);
    expect(paintedFirstFloor(covering, 1250)).toBe(7);
    expect(paintedFirstFloor(uncovering, 1125)).toBe(0);
    expect(paintedFirstFloor(uncovering, 1250)).toBe(0);
  });
});

describe('visibleFloors (migrado de floors.test.ts, FUN-121)', () => {
  it('filtra a cena pela faixa [first, last], inclusiva nas duas pontas', () => {
    expect(visibleFloors([7], 0, 7)).toEqual([7]);
    expect(visibleFloors([4, 5], 0, 7)).toEqual([5, 4]);
    expect(visibleFloors([8], 8, 10)).toEqual([8]);
    expect(visibleFloors([7, 8, 9], 8, 10)).toEqual([9, 8]);
    expect(visibleFloors([4, 5, 6, 7], 7, 7)).toEqual([7]);
  });
});