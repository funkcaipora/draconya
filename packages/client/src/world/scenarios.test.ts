// Os dez cenários de regressão visual do M23 (issue #389, PRD §39, CA-01 a CA-08).
//
// O PRD pede dez cenários de baseline de PIXELS, e o pacote de arte não está em CI nem nesta
// máquina (`things/` é ignorado). O que dá para prender é a DECISÃO do renderer: em que camada
// cada coisa caiu, com que `zIndex`, com que alpha, quando cada textura foi pedida. Cada
// `describe` tem o nome exato do PRD e prende uma decisão, nunca só "não lançou". O roteiro
// manual com sprites reais — o critério de aceite humano do milestone — vive em
// `packages/client/AGENTS.md`, "Como testar".
//
// **Ajuste orquestrado sobre a spec.** A spec de #389 supõe a ordem `y · M + x` (por linha) em
// dois pontos: o passo que "cruza" uma parede horizontal/vertical, e a aritmética de
// 1200 ms/2000 ms do cenário 01. A ordem entregue por #385 é a anti-diagonal
// `spatialOrder(x, y) = (x + y) · ROW_MULTIPLIER + x` (`depth.ts`, ADR 0033), em que um passo
// de um tile NÃO troca a ordem contra uma parede de outra linha. Onde a spec era impossível, o
// cenário prende a decisão REAL: o walking tile (a troca de `zIndex` no instante do passo, que
// é o que o `zIndex` espacial decide), e a coluna do campo tem id por `x` — como os testes de
// #382/#383 — para os 1200 ms de overscan e 2000 ms de prefetch serem exatamente a antecedência.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => import('./testing/pixi-fake.js'));

import { drawOrder, type Sprite } from './testing/pixi-fake.js';
import { SyntheticArt, type SyntheticAppearance, type SyntheticCatalog } from './testing/art.js';
import { mountTestViewport, resetWorld, sceneOf, testClock, type SceneSpec } from './testing/harness.js';
import { renderTiles, viewFor, visibleTiles, type Viewport } from './camera.js';
import { CREATURE_SLOT, sceneZIndex } from './depth.js';
import type { Scene, TileStack } from './scene.js';
import { visibleFloors } from './visibility.js';

// Os ids da spec (§6). GRASS/ROOF são chão; WALL é parede; COLUMN/TREE são `scene` por flag;
// PARCEL eleva; HUMAN é o outfit com `displacement` (8, 8), que é o que faz o walking tile
// trocar no meio do passo (#386).
const GRASS = 100;
const WALL = 200;
const COLUMN = 201;
const TREE = 202;
const PARCEL = 203;
const ROOF = 300;
const HUMAN = 128;
// A coluna do campo vira id (1000 + x no 7, 2000 + x no 8), como em #382/#383: é o que deixa
// "que coluna foi pedida/aquecida" ser asserção direta.
const COLUMN_BASE = 1000;
const UNDERGROUND_BASE = 2000;
const MAX_COLUMNS = 60;

const CATALOG: SyntheticCatalog = {
  [GRASS]: { kind: 'object', flags: { bankWaypoints: 100 }, pattern: { width: 4, height: 4 } },
  [WALL]: { kind: 'object', flags: { bottom: true, unpass: true, unsight: true }, size: { width: 2, height: 2 } },
  [COLUMN]: { kind: 'object', flags: { unpass: true }, size: { width: 2, height: 2 } },
  [TREE]: { kind: 'object', flags: { unpass: true, unsight: true }, size: { width: 2, height: 2 } },
  [PARCEL]: { kind: 'object', flags: { elevation: 8 } },
  [ROOF]: { kind: 'object', flags: { bankWaypoints: 100 } },
  [HUMAN]: { kind: 'outfit', frames: { idle: 1, walking: 8 }, size: { width: 2, height: 2 }, displacement: { x: 8, y: 8 } },
};

beforeEach(resetWorld);

// ---- fixtures -------------------------------------------------------------------------------

/** Um campo aberto `w × h` no andar 7, com chão GRASS em todo tile; `extra` sobrepõe tiles. */
function field(width: number, height: number, extra: Readonly<Record<string, TileStack>> = {}): Scene {
  return sceneOf({
    width, height, floors: [7],
    fill: { 7: { ground: GRASS, items: [] } },
    tiles: extra,
  });
}

/** Uma parede (`id`, uma peça por tile) sobre um campo, nos tiles dados. */
function withObjects(
  width: number, height: number, id: number, coords: ReadonlyArray<readonly [number, number]>,
): Scene {
  const extra: Record<string, TileStack> = {};
  for (const [x, y] of coords) extra[`${x},${y},7`] = { ground: GRASS, items: [{ id }] };
  return field(width, height, extra);
}

/** O chão do campo por COLUNA (`base + x`), sem GRASS: a coluna é o id que o teste lê. */
function columnField(width: number, height: number, base = COLUMN_BASE): Scene {
  const tiles: Record<string, TileStack> = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) tiles[`${x},${y},7`] = { ground: base + x, items: [] };
  }
  return sceneOf({ width, height, floors: [7], tiles });
}

/** O catálogo do campo por coluna, com os dois andares de 08. */
function columnCatalog(): SyntheticCatalog {
  const catalog: Record<number, SyntheticAppearance> = {};
  for (let x = 0; x < MAX_COLUMNS; x++) {
    catalog[COLUMN_BASE + x] = { kind: 'object', flags: { bankWaypoints: 100 } };
    catalog[UNDERGROUND_BASE + x] = { kind: 'object', flags: { bankWaypoints: 100 } };
  }
  return { ...CATALOG, ...catalog };
}

/** A cena de 08: os andares 7 (base 1000) e 8 (base 2000), chão por coluna. */
function twoFloorField(width: number, height: number): Scene {
  const tiles: Record<string, TileStack> = {};
  for (const [z, base] of [[7, COLUMN_BASE], [8, UNDERGROUND_BASE]] as const) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) tiles[`${x},${y},${z}`] = { ground: base + x, items: [] };
    }
  }
  return sceneOf({ width, height, floors: [7, 8], tiles });
}

// ---- leitura das decisões do renderer -------------------------------------------------------

/** O sprite do objeto que o renderer pôs no tile `(mx, my)` do `scene` (`zIndex` espacial). */
function objectAt(
  view: Awaited<ReturnType<typeof mountTestViewport>>, z: number, mx: number, my: number,
  slot = 0,
): Sprite | undefined {
  return view.objectSprites(z).find((sprite) => sprite.zIndex === sceneZIndex(mx, my, slot));
}

/** O índice de desenho (ordem do Pixi) de um sprite no `scene` do andar. */
function indexIn(
  view: Awaited<ReturnType<typeof mountTestViewport>>, z: number, sprite: Sprite,
): number {
  return drawOrder(view.floorLayers(z).scene).indexOf(sprite);
}

/** `true` quando a criatura desenha DEPOIS (por cima) do objeto do tile `(mx, my)`. */
function creatureInFront(
  view: Awaited<ReturnType<typeof mountTestViewport>>, id: number, mx: number, my: number, z: number,
): boolean {
  const creature = view.creatureSprite(id) as Sprite;
  const object = objectAt(view, z, mx, my) as Sprite;
  return indexIn(view, z, creature) > indexIn(view, z, object);
}

/** Os instantes 0/25/50/75/100 % de um passo. */
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;

/** Um `Graphics` de reserva tem retângulo de placeholder dentro da janela VISÍVEL? */
function rectInsideVisible(
  view: Awaited<ReturnType<typeof mountTestViewport>>, center: { x: number; y: number; z: number },
  window: Viewport,
): boolean {
  const render = renderTiles(center, window);
  const visible = visibleTiles(center, window);
  return view.placeholderOps().some((op) => {
    if (op.kind !== 'rect') return false;
    const mx = render.minX + op.x / 32;
    const my = render.minY + op.y / 32;
    return mx >= visible.minX && mx <= visible.maxX && my >= visible.minY && my <= visible.maxY;
  });
}

// ---- 01 -------------------------------------------------------------------------------------

/**
 * CA-01 — campo aberto: a textura de um tile é pedida ao livro três tiles (1200 ms) antes de o
 * tile entrar na tela, e aquecida ao pacote cinco tiles (2000 ms) antes; depois do primeiro
 * segundo nenhum retângulo de reserva aparece na área VISÍVEL. Reprova: overscan menor que 3,
 * prefetch menor que 5, ou placeholder na área visível.
 */
describe('01-walk-open-field', () => {
  it('pede a coluna 3 passos antes da visível, aquece 5 antes, e não deixa placeholder visível', async () => {
    const clock = testClock();
    const window = viewFor(128, 96, 1); // vista 4×3, zoom 1
    const art = new SyntheticArt(columnCatalog(), { now: clock.now, latencyMs: 800 });
    const view = await mountTestViewport({
      scene: columnField(MAX_COLUMNS, 20), art, clock, width: 128, height: 96,
    });
    view.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);

    await view.tick(0);
    expect(rectInsideVisible(view, { x: 10, y: 10, z: 7 }, window)).toBe(true); // ainda sem arte

    for (let n = 1; n <= 30; n++) {
      view.step(1, { x: 9 + n, y: 10, z: 7 }, { x: 10 + n, y: 10, z: 7 }, (n - 1) * 400, 400);
      await view.tick(n * 400);
      const center = { x: 10 + n, y: 10, z: 7 };

      if (n >= 3) expect(rectInsideVisible(view, center, window)).toBe(false);

      if (n >= 5) {
        const column = 12 + n;               // a coluna que ENTRA na janela visível neste passo
        const id = COLUMN_BASE + column;
        const request = art.requests.find((r) => r.key === `object:${id}:0:0`);
        expect(request).toBeDefined();
        expect(request?.at).toBeLessThanOrEqual(n * 400 - 1200);
        // O aquecimento daquela coluna saiu no passo `n - 5` (índice do call).
        expect(art.warmedObjects[n - 5]).toContain(id);
      }
    }
  });

  it('com latência infinita só pede — não espera o quadro chegar para andar', async () => {
    const clock = testClock();
    const art = new SyntheticArt(columnCatalog(), { now: clock.now, latencyMs: 1_000_000 });
    const view = await mountTestViewport({ scene: columnField(MAX_COLUMNS, 20), art, clock });
    view.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);

    await view.tick(0);
    view.moveSelfTo({ x: 11, y: 10, z: 7 });
    await view.tick(400);

    expect(art.requests.some((r) => r.key === 'object:1011:0:0')).toBe(true);
    expect(art.warmedObjects.length).toBeGreaterThanOrEqual(2);
  });
});

// ---- 02 -------------------------------------------------------------------------------------

/**
 * CA-02 — parede horizontal: a criatura ao NORTE da parede desenha antes dela; ao SUL, depois.
 * O passo que cruza a abertura troca o `zIndex` da criatura no instante do walking tile — 75 %
 * para o norte. Reprova: ordem que só muda no fim do passo, ou troca no instante errado.
 */
describe('02-walk-next-to-horizontal-wall', () => {
  const WALL_ROW = (): Scene => {
    const coords: Array<readonly [number, number]> = [];
    for (let x = 4; x <= 12; x++) if (x !== 8) coords.push([x, 5]);
    return withObjects(20, 20, WALL, coords);
  };

  it('ao norte da parede, a criatura vem ANTES; ao sul, DEPOIS (em x = 6 e x = 7)', async () => {
    for (const x of [6, 7]) {
      resetWorld();
      const clock = testClock();
      const art = new SyntheticArt(CATALOG, { now: clock.now });
      const view = await mountTestViewport({ scene: WALL_ROW(), art, clock });
      view.spawnSelf(1, { x, y: 4, z: 7 }, HUMAN);
      await view.tick(0);
      await view.tick(16);
      expect(creatureInFront(view, 1, x, 5, 7)).toBe(false); // norte → atrás

      view.moveSelfTo({ x, y: 6, z: 7 });
      await view.tick(32);
      expect(creatureInFront(view, 1, x, 5, 7)).toBe(true);  // sul → na frente
    }
  });

  it('cruzando a abertura para o norte, o walking tile troca aos 75 %', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const view = await mountTestViewport({ scene: WALL_ROW(), art, clock });
    view.spawnSelf(1, { x: 8, y: 6, z: 7 }, HUMAN);
    await view.tick(0);  // a parede em `scene` só nasce quando a textura chega
    await view.tick(16);

    view.step(1, { x: 8, y: 6, z: 7 }, { x: 8, y: 5, z: 7 }, 1000, 400);
    const orders: number[] = [];
    for (const f of FRACTIONS) {
      await view.tick(1000 + f * 400);
      orders.push((view.creatureSprite(1) as Sprite).zIndex);
      // Contra as paredes vizinhas a decisão é estável: à frente da de oeste, atrás da de leste.
      expect(creatureInFront(view, 1, 7, 5, 7)).toBe(true);
      expect(creatureInFront(view, 1, 9, 5, 7)).toBe(false);
    }

    expect(orders.slice(0, 3)).toEqual([
      sceneZIndex(8, 6, CREATURE_SLOT), sceneZIndex(8, 6, CREATURE_SLOT), sceneZIndex(8, 6, CREATURE_SLOT),
    ]);
    expect(orders.slice(3)).toEqual([
      sceneZIndex(8, 5, CREATURE_SLOT), sceneZIndex(8, 5, CREATURE_SLOT),
    ]);
  });
});

// ---- 03 -------------------------------------------------------------------------------------

/**
 * CA-03 — parede vertical: a criatura a OESTE desenha antes da parede; a LESTE, depois. O passo
 * para oeste por uma abertura troca o walking tile aos 75 %. Reprova: idem ao 02, no eixo x.
 */
describe('03-walk-next-to-vertical-wall', () => {
  const WALL_COLUMN = (): Scene => {
    const coords: Array<readonly [number, number]> = [];
    for (let y = 4; y <= 12; y++) if (y !== 8) coords.push([5, y]);
    return withObjects(20, 20, WALL, coords);
  };

  it('a oeste da parede, ANTES; a leste, DEPOIS', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const view = await mountTestViewport({ scene: WALL_COLUMN(), art, clock });

    view.spawnSelf(1, { x: 4, y: 10, z: 7 }, HUMAN);
    await view.tick(0);
    await view.tick(16);
    expect(creatureInFront(view, 1, 5, 10, 7)).toBe(false);

    view.moveSelfTo({ x: 6, y: 10, z: 7 });
    await view.tick(32);
    expect(creatureInFront(view, 1, 5, 10, 7)).toBe(true);
  });

  it('cruzando a abertura para oeste, o walking tile troca aos 75 %', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const view = await mountTestViewport({ scene: WALL_COLUMN(), art, clock });
    view.spawnSelf(1, { x: 6, y: 8, z: 7 }, HUMAN);

    view.step(1, { x: 6, y: 8, z: 7 }, { x: 5, y: 8, z: 7 }, 1000, 400);
    const orders: number[] = [];
    for (const f of FRACTIONS) {
      await view.tick(1000 + f * 400);
      orders.push((view.creatureSprite(1) as Sprite).zIndex);
    }

    expect(orders.slice(0, 3)).toEqual([
      sceneZIndex(6, 8, CREATURE_SLOT), sceneZIndex(6, 8, CREATURE_SLOT), sceneZIndex(6, 8, CREATURE_SLOT),
    ]);
    expect(orders.slice(3)).toEqual([
      sceneZIndex(5, 8, CREATURE_SLOT), sceneZIndex(5, 8, CREATURE_SLOT),
    ]);
  });
});

// ---- 04 -------------------------------------------------------------------------------------

/**
 * CA-04 — coluna: um objeto `unpass` de 2×2. Norte e oeste desenham antes; sul e leste, depois.
 * Reprova: ordem por `y` sem o desempate por `x` da anti-diagonal.
 */
describe('04-walk-around-column', () => {
  const scene = (): Scene => withObjects(20, 20, COLUMN, [[5, 5]]);

  it('(5,4) e (4,5) atrás; (5,6) e (6,5) na frente', async () => {
    const behind: Array<readonly [number, number]> = [[5, 4], [4, 5]];
    const front: Array<readonly [number, number]> = [[5, 6], [6, 5]];

    for (const [x, y] of behind) {
      resetWorld();
      const clock = testClock();
      const art = new SyntheticArt(CATALOG, { now: clock.now });
      const view = await mountTestViewport({ scene: scene(), art, clock });
      view.spawnSelf(1, { x, y, z: 7 }, HUMAN);
      await view.tick(0);
      await view.tick(16);
      expect(creatureInFront(view, 1, 5, 5, 7)).toBe(false);
    }
    for (const [x, y] of front) {
      resetWorld();
      const clock = testClock();
      const art = new SyntheticArt(CATALOG, { now: clock.now });
      const view = await mountTestViewport({ scene: scene(), art, clock });
      view.spawnSelf(1, { x, y, z: 7 }, HUMAN);
      await view.tick(0);
      await view.tick(16);
      expect(creatureInFront(view, 1, 5, 5, 7)).toBe(true);
    }
  });
});

// ---- 05 -------------------------------------------------------------------------------------

/**
 * CA-05 — objeto grande (`unsight`, 2×2): a MESMA matriz de ordem da coluna. Reprova:
 * classificar a árvore como `ground` por causa do tamanho, o que a faria sumir atrás da
 * criatura e da própria profundidade.
 */
describe('05-walk-around-large-object', () => {
  const scene = (): Scene => withObjects(20, 20, TREE, [[5, 5]]);

  it('a árvore é `scene` e ordena como a coluna', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const view = await mountTestViewport({ scene: scene(), art, clock });
    view.spawnSelf(1, { x: 5, y: 6, z: 7 }, HUMAN);
    await view.tick(0);
    await view.tick(16);

    expect(objectAt(view, 7, 5, 5)).toBeDefined();
    expect(objectAt(view, 7, 5, 5)?.parent).toBe(view.floorLayers(7).scene); // não é `ground`
    expect(creatureInFront(view, 1, 5, 5, 7)).toBe(true);

    view.moveSelfTo({ x: 4, y: 5, z: 7 });
    await view.tick(32);
    expect(creatureInFront(view, 1, 5, 5, 7)).toBe(false);
  });
});

// ---- 06 / 07 --------------------------------------------------------------------------------

/** A casa de 06/07: telhado ROOF no bloco (8..12, 8..12) do andar 6, sobre o campo de GRASS. */
function houseScene(): Scene {
  const roof: Record<string, TileStack> = {};
  for (let y = 8; y <= 12; y++) {
    for (let x = 8; x <= 12; x++) roof[`${x},${y},6`] = { ground: ROOF, items: [] };
  }
  return sceneOf({
    width: 20, height: 20, floors: [6, 7],
    fill: { 7: { ground: GRASS, items: [] } },
    tiles: roof,
  });
}

/**
 * CA-06 — entrar em casa: fora, o andar 6 é desenhado com alpha 1; assim que a posição LÓGICA
 * entra sob a cobertura, o andar de cima some numa rampa de `FLOOR_FADE_MS` (1 → ~0,5 → 0) e o
 * container fica invisível. A criatura (no andar do jogador) nunca some. Reprova: telhado que
 * não some, some sem rampa, ou criatura escondida.
 *
 * O ponto de entrada é o tile a SUL do bloco: a regra de cobertura do OTClient também olha o
 * tile ortogonal e o `(x + 1, y + 1)` (o telhado desenhado um tile acima/esquerda cobre a
 * posição de tela), então perto da parede o telhado já é "cobertura" antes do bloco.
 */
describe('06-enter-building', () => {
  it('alpha do 6: 1 → ~0,5 → 0 em 250 ms, e a criatura do 7 continua visível', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const view = await mountTestViewport({ scene: houseScene(), art, clock });
    view.spawnSelf(1, { x: 10, y: 14, z: 7 }, HUMAN);
    await view.tick(0);
    await view.tick(16);

    const roof = view.floorLayers(6).root;
    expect(roof.alpha).toBe(1);
    expect(roof.visible).toBe(true);

    view.step(1, { x: 10, y: 14, z: 7 }, { x: 10, y: 13, z: 7 }, 1000, 400);
    await view.tick(1000);
    expect(roof.alpha).toBe(1);

    await view.tick(1125);
    expect(roof.alpha).toBeCloseTo(0.5);

    await view.tick(1250);
    expect(roof.alpha).toBe(0);
    expect(roof.visible).toBe(false);
    expect(view.creatureSprite(1)?.visible).toBe(true);
  });
});

/**
 * CA-07 — sair de casa: a cobertura volta na MESMA rampa (0 → ~0,5 → 1) e o alpha nunca sai de
 * [0, 1]. Reprova: cobertura que não volta.
 */
describe('07-exit-building', () => {
  it('alpha do 6 volta 0 → ~0,5 → 1 em 250 ms, sempre dentro de [0, 1]', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const view = await mountTestViewport({ scene: houseScene(), art, clock });
    view.spawnSelf(1, { x: 10, y: 14, z: 7 }, HUMAN);
    await view.tick(0);
    await view.tick(16);

    const roof = view.floorLayers(6).root;
    view.moveSelfTo({ x: 10, y: 13, z: 7 });
    await view.tick(1000);
    await view.tick(1250);
    expect(roof.alpha).toBe(0);
    expect(roof.visible).toBe(false);

    view.step(1, { x: 10, y: 13, z: 7 }, { x: 10, y: 14, z: 7 }, 2000, 400);
    const alphas: number[] = [];
    for (const t of [2000, 2125, 2250]) {
      await view.tick(t);
      alphas.push(roof.alpha);
      expect(roof.alpha).toBeGreaterThanOrEqual(0);
      expect(roof.alpha).toBeLessThanOrEqual(1);
    }

    expect(alphas[0]).toBe(0);
    expect(alphas[1]).toBeCloseTo(0.5);
    expect(alphas[2]).toBe(1);
    expect(roof.visible).toBe(true);
  });
});

// ---- 08 -------------------------------------------------------------------------------------

/**
 * CA-06/CA-07 no eixo do andar — trocar de andar: `visibleFloors` deixa de desenhar o 7 no
 * subsolo, o sprite reparenta para o `scene` do andar novo e o prefetch aquece os ids do 8.
 * Reprova: sprite preso no andar antigo.
 */
describe('08-change-floor', () => {
  it('o 7 sai da faixa visível, a criatura reparenta e o 8 é aquecido', async () => {
    expect(visibleFloors([7, 8], 8, 10)).toEqual([8]);

    const clock = testClock();
    const art = new SyntheticArt(columnCatalog(), { now: clock.now });
    const view = await mountTestViewport({ scene: twoFloorField(20, 20), art, clock });
    view.spawnSelf(1, { x: 5, y: 5, z: 7 }, 0);
    await view.tick(0);
    await view.tick(16);
    expect(view.drawnFloors()).toContain(7);

    view.moveSelfTo({ x: 5, y: 5, z: 8 });
    await view.tick(32);

    expect(view.drawnFloors()).toEqual([8]);
    expect(view.creatureSprite(1)?.parent).toBe(view.floorLayers(8).scene);
    const warm = art.warmedObjects[art.warmedObjects.length - 1] as readonly number[];
    expect(warm.some((id) => id >= UNDERGROUND_BASE)).toBe(true);
    expect(warm.every((id) => id >= UNDERGROUND_BASE)).toBe(true); // nenhum id do andar 7
  });
});

// ---- 09 -------------------------------------------------------------------------------------

/**
 * CA-08 — objeto de elevação: a criatura sobe a elevação do tile INTERPOLADA ao longo do passo
 * (0, −2, −4, −6, −8 px) e o `zIndex` é o mesmo que teria sem o parcel (a elevação não mexe na
 * profundidade). Reprova: salto de 8 px no meio, ou lift mexendo na profundidade.
 */
describe('09-elevation-object', () => {
  async function run(withParcel: boolean): Promise<{ deltas: number[]; orders: number[] }> {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = withObjects(20, 20, PARCEL, withParcel ? [[6, 5]] : []);
    const view = await mountTestViewport({ scene, art, clock });
    view.spawnSelf(1, { x: 5, y: 5, z: 7 }, HUMAN);
    await view.tick(0);
    await view.tick(16);

    view.step(1, { x: 5, y: 5, z: 7 }, { x: 6, y: 5, z: 7 }, 1000, 400);
    const deltas: number[] = [];
    const orders: number[] = [];
    let base = 0;
    for (const f of FRACTIONS) {
      await view.tick(1000 + f * 400);
      const sprite = view.creatureSprite(1) as Sprite;
      if (deltas.length === 0) base = sprite.y;
      deltas.push(sprite.y - base);
      orders.push(sprite.zIndex);
    }
    return { deltas, orders };
  }

  it('sobe 0, −2, −4, −6, −8 px e mantém o mesmo `zIndex` sem o parcel', async () => {
    const lifted = await run(true);
    resetWorld();
    const control = await run(false);

    expect(lifted.deltas).toEqual([0, -2, -4, -6, -8]);
    expect(lifted.orders).toEqual(control.orders);
  });
});

// ---- 10 -------------------------------------------------------------------------------------

/**
 * CA-01..CA-08 em cadência rápida: trinta passos de 150 ms. Cada tile cruzado gera UMA chamada a
 * `warmObjects`, só com a coluna que entrou e disjunta das anteriores; nenhuma textura é pedida
 * duas vezes; o terreno repinta uma vez por passo, não por quadro. Reprova: re-aquecer a janela
 * inteira, pedir textura duas vezes, repintar por quadro.
 */
describe('10-fast-continuous-walk', () => {
  it('31 aquecimentos (1 inicial + 1 por passo), só a coluna nova, sem repetir pedido, 31 repinturas', async () => {
    const clock = testClock();
    const art = new SyntheticArt(columnCatalog(), { now: clock.now });
    const view = await mountTestViewport({
      scene: columnField(MAX_COLUMNS, 20), art, clock, width: 128, height: 96,
    });
    view.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);
    await view.tick(0);

    for (let n = 1; n <= 30; n++) {
      view.step(1, { x: 9 + n, y: 10, z: 7 }, { x: 10 + n, y: 10, z: 7 }, (n - 1) * 150, 150);
      await view.tick(n * 150);
    }

    expect(art.warmedObjects).toHaveLength(31);
    art.warmedObjects.slice(1).forEach((ids, index) => {
      expect(ids).toEqual([COLUMN_BASE + 18 + index]); // a coluna que acabou de entrar
    });

    const keys = art.requests.map((request) => request.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(view.handle.stats().terrainRepaints).toBe(31);
  });
});