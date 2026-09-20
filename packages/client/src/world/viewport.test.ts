// O harness de teste do viewport (issue #381) e os cenários da cena espacial por andar (#385).
//
// A #381 prendeu os SEIS comportamentos de então (camadas, criatura, parede/arco, repintura por
// janela, grade de reserva, elevação) para que as issues seguintes do M23 provassem que mudaram
// só o que disseram. A #385 troca os cinco containers por `floorsRoot` → `ground`/`scene`/`top`
// por andar (ADR 0034), põe parede, objeto alto e criatura no MESMO `scene` com `zIndex`
// espacial, e é o que a seção 11 desta issue prende. A #382 (janela de render) e a #383
// (prefetch contínuo) seguem nos blocos próprios.
//
// O mock abaixo troca todo `import` do pacote real de renderização, no gráfico de módulos
// inteiro — inclusive dentro de `viewport.ts` e `world/textures.ts` —, pelo falso em
// `testing/pixi-fake.ts`; o Vitest o iça (hoisted) para antes de qualquer import deste arquivo.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => import('./testing/pixi-fake.js'));

import { Container, drawOrder, Graphics, Sprite, Texture } from './testing/pixi-fake.js';
import { SyntheticArt, type SyntheticCatalog } from './testing/art.js';
import { mountTestViewport, resetWorld, sceneOf, testClock } from './testing/harness.js';
import { prefetchTiles, renderTiles, visibleTiles, viewFor, zoomFor } from './camera.js';
import { CREATURE_SLOT, sceneZIndex } from './depth.js';
import { veilTint } from './floors.js';
import type { Scene, TileStack } from './scene.js';

/** O catálogo mínimo dos testes — ver a seção 11 das specs #381 e #385. */
const GRASS = 100;
const ROOF = 101;
const WALL = 102;
const ARCH = 106;
const CRATE = 103;
const RAT = 21;
const DOG = 22;
/** O outfit COM `shift` (8, 8) e o mesmo em 64×64: o walking tile e o deslocamento (#386). */
const SHIFTED = 23;
const BIG_SHIFTED = 24;

const CATALOG: SyntheticCatalog = {
  [GRASS]: { kind: 'object' },
  [ROOF]: { kind: 'object' },
  [WALL]: { kind: 'object', flags: { bottom: true, unpass: true }, size: { width: 2, height: 2 } },
  [ARCH]: { kind: 'object', flags: { top: true } },
  [CRATE]: { kind: 'object', flags: { elevation: 8 } },
  [RAT]: { kind: 'outfit' },
  [DOG]: { kind: 'outfit' },
  [SHIFTED]: { kind: 'outfit', displacement: { x: 8, y: 8 } },
  [BIG_SHIFTED]: { kind: 'outfit', displacement: { x: 8, y: 8 }, size: { width: 2, height: 2 } },
};

beforeEach(resetWorld);

/** O sprite de um container cuja textura é o bitmap `resource`, ou `undefined`. */
function spriteWith(container: Container, resource: unknown): Sprite | undefined {
  return container.children.find(
    (child) => 'texture' in child && (child as Sprite).texture.source.resource === resource,
  ) as Sprite | undefined;
}

/** O índice de desenho de um sprite no container, pela ordem do Pixi (`zIndex` estável). */
function indexIn(container: Container, sprite: Sprite): number {
  return drawOrder(container).indexOf(sprite);
}

/** Um campo de chão em todos os tiles dos andares, mais os tiles `extra`. */
function fieldScene(
  width: number, height: number, floors: readonly number[], extra: Readonly<Record<string, TileStack>> = {},
): Scene {
  const tiles: Record<string, TileStack> = {};
  for (const z of floors) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) tiles[`${x},${y},${z}`] = { ground: GRASS, items: [] };
    }
  }
  Object.assign(tiles, extra);
  return sceneOf({ width, height, floors, tiles });
}

describe('viewport (issue #381, adaptado a #385)', () => {
  it('(1) monta `floorsRoot`/`effects`/`overlay` e um único callback de quadro; o andar nasce no primeiro quadro', async () => {
    const scene = sceneOf({ width: 4, height: 4, floors: [7] });
    const viewport = await mountTestViewport({ scene });

    expect(viewport.app.ticker.callbacks.length).toBe(1);
    expect(viewport.stage.children.length).toBe(3);
    expect(viewport.layers().floorsRoot).toBe(viewport.stage.children[0]);
    expect(viewport.layers().overlay).toBe(viewport.stage.children[2]);

    viewport.spawnSelf(1, { x: 2, y: 2, z: 7 }, 0);
    await viewport.tick(0);

    const layers = viewport.floorLayers(7);
    expect(layers.fallback).toBeInstanceOf(Graphics);
    expect(layers.ground.children[0]).toBe(layers.fallback);
    expect(layers.scene.sortableChildren).toBe(true);
    expect(layers.top.sortableChildren).toBe(false);
  });

  it('(2) a criatura vira sprite no `scene` do andar dela, com a textura do pacote', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = sceneOf({ width: 20, height: 20, floors: [7] });
    const viewport = await mountTestViewport({ scene, art, clock });

    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    const sprite = viewport.creatureSprite(1);
    expect(sprite).toBeDefined();
    expect(sprite?.parent).toBe(viewport.floorLayers(7).scene);
    expect(sprite?.texture.source.resource).toBe(art.bitmapOf('outfit:21:south:s:0'));
  });

  it('(3) parede vira `scene`, arco vira `top` — nenhum arco no `scene`', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = sceneOf({
      width: 20,
      height: 20,
      floors: [7],
      fill: { 7: { ground: GRASS, items: [] } },
      tiles: { '12,10,7': { ground: GRASS, items: [{ id: WALL }, { id: ARCH }] } },
    });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, RAT);

    await viewport.tick(0);
    await viewport.tick(16);

    const layers = viewport.floorLayers(7);
    expect(spriteWith(layers.scene, art.bitmapOf('object:102:0:0'))).toBeDefined();
    expect(spriteWith(layers.top, art.bitmapOf('object:106:0:0'))).toBeDefined();
    expect(spriteWith(layers.scene, art.bitmapOf('object:106:0:0'))).toBeUndefined();
  });

  it('(4) o terreno só repinta quando a janela muda de tile, não a cada quadro', async () => {
    const scene = sceneOf({
      width: 20, height: 20, floors: [7], fill: { 7: { ground: GRASS, items: [] } },
    });
    const viewport = await mountTestViewport({ scene });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);

    for (let i = 0; i < 10; i++) await viewport.tick(i * 16);
    expect(viewport.placeholderClears()).toBe(1);

    viewport.step(1, { x: 10, y: 10, z: 7 }, { x: 11, y: 10, z: 7 }, 200, 400);
    await viewport.tick(200);
    await viewport.tick(600);
    expect(viewport.placeholderClears()).toBe(2);
  });

  it('(5) sem pacote, o retângulo de reserva cobre a janela inteira de `renderTiles` (M23/#382)', async () => {
    const scene = sceneOf({
      width: 40, height: 40, floors: [7], fill: { 7: { ground: GRASS, items: [] } },
    });
    const viewport = await mountTestViewport({ scene });
    viewport.spawnSelf(1, { x: 20, y: 20, z: 7 }, 0);

    await viewport.tick(0);

    const window = renderTiles({ x: 20, y: 20, z: 7 }, viewFor(576, 448, 1));
    const expected = (window.maxX - window.minX + 1) * (window.maxY - window.minY + 1);
    const rects = viewport.placeholderOps().filter((op) => op.kind === 'rect');
    expect(rects.length).toBe(expected);
  });

  it('(6) a elevação do tile interpola ao longo do passo, e o sprite continua no `scene`', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = sceneOf({
      width: 20,
      height: 20,
      floors: [7],
      fill: { 7: { ground: GRASS, items: [] } },
      tiles: { '11,10,7': { ground: GRASS, items: [{ id: CRATE }] } },
    });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, RAT);

    await viewport.tick(0); // repinta e preenche `elevations`

    viewport.step(1, { x: 10, y: 10, z: 7 }, { x: 11, y: 10, z: 7 }, 1000, 400);
    // O passo muda o facing de `south` para `east` no início — e CONTINUA `east` depois que o
    // passo vence. Tickar duas vezes no MESMO instante deixa a textura chegar sem mexer no
    // `lift` (`t` é o mesmo nas duas), para cada leitura usar a MESMA fórmula.
    const render = async (atMs: number): Promise<void> => {
      await viewport.tick(atMs);
      await viewport.tick(atMs);
    };

    await render(1000);
    const y0 = viewport.creatureSprite(1)?.y as number;

    await render(1200);
    expect(viewport.creatureSprite(1)?.y).toBe(y0 - 4);

    await render(1400);
    expect(viewport.creatureSprite(1)?.y).toBe(y0 - 8);
    expect(viewport.creatureSprite(1)?.parent).toBe(viewport.floorLayers(7).scene);
  });

  it('(7) `drawOrder`: por zIndex quando `sortableChildren`, estável no empate; senão, inserção', () => {
    const container = new Container();
    const a = new Container();
    const b = new Container();
    const c = new Container();
    const d = new Container();
    a.zIndex = 2;
    b.zIndex = 0;
    c.zIndex = 1;
    d.zIndex = 1;
    container.addChild(a, b, c, d);

    expect(drawOrder(container)).toEqual([a, b, c, d]); // sem sortableChildren: ordem de inserção

    container.sortableChildren = true;
    expect(drawOrder(container)).toEqual([b, c, d, a]); // por zIndex; c antes de d — estável no empate
  });

  it('(8) duas criaturas nascem no mesmo quadro: cada sprite fica com o id certo', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = sceneOf({
      width: 20, height: 20, floors: [7], fill: { 7: { ground: GRASS, items: [] } },
    });
    const viewport = await mountTestViewport({ scene, art, clock });

    viewport.spawnSelf(1, { x: 10, y: 12, z: 7 }, RAT);
    viewport.spawn(2, { x: 10, y: 10, z: 7 }, DOG);
    await viewport.tick(0);
    await viewport.tick(16);

    const one = viewport.creatureSprite(1);
    const two = viewport.creatureSprite(2);
    expect(one).toBeDefined();
    expect(two).toBeDefined();
    expect(one).not.toBe(two);
    expect(one?.texture.source.resource).toBe(art.bitmapOf('outfit:21:south:s:0'));
    expect(two?.texture.source.resource).toBe(art.bitmapOf('outfit:22:south:s:0'));
  });

  it('(9) arte com latência: retângulo até o prazo, textura no primeiro quadro que o atinge', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now, latencyMs: 100 });
    const scene = sceneOf({
      width: 20, height: 20, floors: [7], fill: { 7: { ground: GRASS, items: [] } },
    });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, RAT);

    await viewport.tick(0); // o pedido sai NESTE quadro — `art.requests` já tem a chave
    expect(art.requests.some((r) => r.key === 'outfit:21:south:s:0' && r.at === 0)).toBe(true);
    expect(viewport.creatureSprite(1)?.texture).toBe(Texture.WHITE);

    await viewport.tick(50);
    expect(viewport.creatureSprite(1)?.texture).toBe(Texture.WHITE);

    await viewport.tick(99);
    expect(viewport.creatureSprite(1)?.texture).toBe(Texture.WHITE);

    // `at (0) + latencyMs (100) <= nowMs`: o PRIMEIRO quadro que atinge o prazo, não "mais um".
    await viewport.tick(100);
    expect(viewport.creatureSprite(1)?.texture.source.resource).toBe(art.bitmapOf('outfit:21:south:s:0'));
  });
});

/**
 * A cena espacial por andar (issue #385, seção 11): parede, objeto alto e criatura no MESMO
 * `scene`, ordenados por `sceneZIndex` (`world/depth.ts`); andar de baixo anexado antes e sob
 * véu; culling pela janela de render; reparentação na troca de andar.
 */
describe('viewport: cena espacial por andar (issue #385)', () => {
  it('RF-01: parede e criatura moram no MESMO `scene` do andar', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7], { '12,10,7': { ground: GRASS, items: [{ id: WALL }] } });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    const layers = viewport.floorLayers(7);
    const wall = spriteWith(layers.scene, art.bitmapOf('object:102:0:0'));
    const creature = viewport.creatureSprite(1);
    expect(wall).toBeDefined();
    expect(creature).toBeDefined();
    expect(wall?.parent).toBe(layers.scene);
    expect(creature?.parent).toBe(layers.scene);
  });

  it('RF-02: criatura ao norte da parede vem antes; ao sul, depois', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7], { '10,10,7': { ground: GRASS, items: [{ id: WALL }] } });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 9, z: 7 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    const layers = viewport.floorLayers(7);
    const wall = spriteWith(layers.scene, art.bitmapOf('object:102:0:0')) as Sprite;
    const creature = viewport.creatureSprite(1) as Sprite;
    expect(indexIn(layers.scene, creature)).toBeLessThan(indexIn(layers.scene, wall));

    viewport.moveSelfTo({ x: 10, y: 11, z: 7 });
    await viewport.tick(32);
    expect(indexIn(layers.scene, creature)).toBeGreaterThan(indexIn(layers.scene, wall));
  });

  it('RF-03: no mesmo tile, o item de `scene` vem antes da criatura', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7], { '10,10,7': { ground: GRASS, items: [{ id: WALL }] } });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    const layers = viewport.floorLayers(7);
    const wall = spriteWith(layers.scene, art.bitmapOf('object:102:0:0')) as Sprite;
    const creature = viewport.creatureSprite(1) as Sprite;
    expect(wall.zIndex).toBeLessThan(creature.zIndex);
    expect(creature.zIndex).toBe(sceneZIndex(10, 10, CREATURE_SLOT));
  });

  it('RF-04: mesma linha, leste depois de oeste, e a ordem não pisca entre quadros', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7]);
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 3, y: 5, z: 7 }, RAT);
    viewport.spawn(2, { x: 7, y: 5, z: 7 }, DOG);
    await viewport.tick(0);
    await viewport.tick(16);

    const layers = viewport.floorLayers(7);
    const one = viewport.creatureSprite(1) as Sprite;
    const two = viewport.creatureSprite(2) as Sprite;
    expect(indexIn(layers.scene, one)).toBeLessThan(indexIn(layers.scene, two));

    const before = drawOrder(layers.scene).map((child) => child.seq);
    await viewport.tick(32);
    await viewport.tick(48);
    await viewport.tick(64);
    expect(drawOrder(layers.scene).map((child) => child.seq)).toEqual(before);
  });

  it('RF-05: andar de baixo anexado antes e sob véu; `top` depois do `scene` do mesmo andar', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [6, 7]);
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 6, z: 6 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    const children = viewport.layers().floorsRoot.children;
    const floor7 = viewport.floorLayers(7);
    const floor6 = viewport.floorLayers(6);
    expect(children[0]).toBe(floor7.root);
    expect(children[1]).toBe(floor6.root);
    expect(floor7.root.children[0]).toBe(floor7.ground);
    expect(floor7.root.children[1]).toBe(floor7.scene);
    expect(floor7.root.children[2]).toBe(floor7.top);
    expect(floor6.root.children.indexOf(floor6.top)).toBeGreaterThan(floor6.root.children.indexOf(floor6.scene));

    const ground7 = floor7.ground.children.filter(
      (child) => 'texture' in child && child.visible,
    ) as Sprite[];
    expect(ground7.length).toBeGreaterThan(0);
    expect(ground7[0]?.tint).toBe(veilTint(1));
  });

  it('RF-05: o `top` do andar é anexado depois do `scene` — o arco cobre quem passa', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7], { '12,10,7': { ground: GRASS, items: [{ id: WALL }, { id: ARCH }] } });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    const children = viewport.floorLayers(7).root.children;
    const layers = viewport.floorLayers(7);
    expect(children.indexOf(layers.top)).toBeGreaterThan(children.indexOf(layers.scene));
    expect(spriteWith(layers.top, art.bitmapOf('object:106:0:0'))).toBeDefined();
  });

  it('RF-06: fora da janela de render a criatura fica invisível e volta sem destruir o sprite', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(40, 40, [7]);
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 5, y: 5, z: 7 }, RAT);
    viewport.spawn(2, { x: 40, y: 40, z: 7 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    const sprite = viewport.creatureSprite(2) as Sprite;
    expect(sprite.visible).toBe(false);
    const count = viewport.creatureCount();

    viewport.step(2, { x: 40, y: 40, z: 7 }, { x: 6, y: 5, z: 7 }, 16, 0);
    await viewport.tick(32);

    expect(viewport.creatureSprite(2)).toBe(sprite);
    expect(sprite.visible).toBe(true);
    expect(viewport.creatureCount()).toBe(count);
  });

  it('RF-07: trocar de andar reparenta a criatura para o `scene` do andar novo, mesmo Sprite', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [6, 7]);
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 6, z: 6 }, RAT);
    viewport.spawn(2, { x: 10, y: 7, z: 7 }, DOG);
    await viewport.tick(0);
    await viewport.tick(16);

    const sprite = viewport.creatureSprite(2) as Sprite;
    expect(sprite.parent).toBe(viewport.floorLayers(7).scene);

    viewport.step(2, { x: 10, y: 7, z: 7 }, { x: 10, y: 6, z: 6 }, 32, 0);
    await viewport.tick(48);

    expect(viewport.creatureSprite(2)).toBe(sprite);
    expect(sprite.parent).toBe(viewport.floorLayers(6).scene);
  });

  it('RF-08: sem pacote, o `fallback` do andar recebe a grade e o `scene` fica sem placeholders', async () => {
    const scene = fieldScene(20, 20, [7]);
    const viewport = await mountTestViewport({ scene });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);
    await viewport.tick(0);

    const layers = viewport.floorLayers(7);
    const window = renderTiles({ x: 10, y: 10, z: 7 }, viewFor(576, 448, 1));
    // Um `rect` por tile DENTRO do mapa pintado na janela de render (a grade lisa da janela
    // inteira é só o caso `scene === null`); fora do mapa `tileAt` devolve `null` e não pinta.
    const inMap = (Math.min(window.maxX, 19) - Math.max(window.minX, 0) + 1)
      * (Math.min(window.maxY, 19) - Math.max(window.minY, 0) + 1);
    const rects = layers.fallback.ops.filter((op) => op.kind === 'rect');
    expect(rects.length).toBe(inMap);
    // Nenhum placeholder de chão vazou para o `scene`: o único filho é o sprite da criatura.
    expect(layers.scene.children).toEqual([viewport.creatureSprite(1)]);
  });

  it('RF-08: parede em voo num tile sem chão é um Sprite branco no `scene`, no zIndex dela', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now, latencyMs: 100 });
    const scene = sceneOf({
      width: 20,
      height: 20,
      floors: [7],
      tiles: { '12,10,7': { ground: 0, items: [{ id: WALL }] } },
    });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, RAT);
    await viewport.tick(0);

    const layers = viewport.floorLayers(7);
    const placeholder = layers.scene.children.find(
      (child) => child.zIndex === sceneZIndex(12, 10, 0),
    ) as Sprite | undefined;
    expect(placeholder).toBeDefined();
    expect(placeholder?.texture).toBe(Texture.WHITE);

    await viewport.tick(100);
    expect(spriteWith(layers.scene, art.bitmapOf('object:102:0:0'))).toBe(placeholder);
  });
});

/**
 * O walking tile e o displacement de outfit (issue #386, §11): a ordem da criatura na
 * `spatialScene` passa a ser a do tile que contém o canto inferior direito do corpo, decidido
 * pelo OTClient — troca aos 50 % para leste/sul e aos 75 % para norte/oeste —, e o sprite é
 * desenhado `−displacement`, enquanto barra e nome ficam no tile.
 *
 * **Correção orquestrada sobre a spec:** a spec comparava o `zIndex` a `spatialOrder(x, y)`.
 * Desde #385 a cena usa `sceneZIndex(x, y, slot)`; a criatura é o slot `CREATURE_SLOT` do tile,
 * então as asserções usam `sceneZIndex(..., CREATURE_SLOT)`. Onde a spec prendia a ordem contra
 * uma parede, a parede fica no mesmo eixo de comparação do `spatialOrder` real (anti-diagonal
 * `x + y`, e `x` dentro dela), não no `y · R + x` que a spec supunha.
 */
describe('viewport: walking tile e displacement de outfit (issue #386)', () => {
  it('RF-02: norte troca de ordem aos 75 % — a criatura passa de frente para trás da parede', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    // A parede fica a nordeste do destino, no MESMO `x + y` dele e um `x` à frente: com a
    // anti-diagonal real, é o que faz a criatura cruzar a ordem ao CHEGAR no destino.
    const scene = fieldScene(20, 20, [7], { '2,0,7': { ground: GRASS, items: [{ id: WALL }] } });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 1, y: 1, z: 7 }, SHIFTED);
    viewport.step(1, { x: 1, y: 2, z: 7 }, { x: 1, y: 1, z: 7 }, 1000, 400);
    await viewport.tick(1000);
    await viewport.tick(1000); // a textura da parede chega neste segundo quadro

    const layers = viewport.floorLayers(7);
    const wall = spriteWith(layers.scene, art.bitmapOf('object:102:0:0')) as Sprite;
    const orderAt = async (atMs: number): Promise<{ creature: number; wall: number }> => {
      await viewport.tick(atMs);
      const creature = viewport.creatureSprite(1) as Sprite;
      return { creature: creature.zIndex, wall: wall.zIndex };
    };

    // A origem do passo é o tile de baixo (1, 2); o destino (1, 1) chega só aos 75 %.
    for (const p of [0, 0.25, 0.5]) {
      const at = await orderAt(1000 + p * 400);
      expect(at.creature).toBeGreaterThan(at.wall);
    }
    for (const p of [0.75, 1]) {
      const at = await orderAt(1000 + p * 400);
      expect(at.creature).toBeLessThan(at.wall);
    }
    expect(viewport.creatureSprite(1)?.zIndex).toBe(sceneZIndex(1, 1, CREATURE_SLOT));
  });

  it('RF-02: sul troca aos 50 % — o inverso', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7], { '2,0,7': { ground: GRASS, items: [{ id: WALL }] } });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 1, y: 2, z: 7 }, SHIFTED);
    viewport.step(1, { x: 1, y: 1, z: 7 }, { x: 1, y: 2, z: 7 }, 1000, 400);
    await viewport.tick(1000);
    await viewport.tick(1000);

    const layers = viewport.floorLayers(7);
    const wall = spriteWith(layers.scene, art.bitmapOf('object:102:0:0')) as Sprite;
    const orderAt = async (atMs: number): Promise<{ creature: number; wall: number }> => {
      await viewport.tick(atMs);
      const creature = viewport.creatureSprite(1) as Sprite;
      return { creature: creature.zIndex, wall: wall.zIndex };
    };

    for (const p of [0, 0.25]) {
      const at = await orderAt(1000 + p * 400);
      expect(at.creature).toBeLessThan(at.wall);
    }
    for (const p of [0.5, 0.75, 1]) {
      const at = await orderAt(1000 + p * 400);
      expect(at.creature).toBeGreaterThan(at.wall);
    }
  });

  it('RF-02: leste troca aos 50 %, e uma parede ao sul fica sempre à frente', async () => {
    // A nota da §7: com a anti-diagonal, um passo para leste NÃO cruza uma parede de outra
    // linha — o que o `x` do walking tile decide é a ordem contra a MESMA linha. O teste prende
    // o `zIndex` ao tile (não à posição fracionária) e a parede ao sul sempre à frente.
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7], { '1,2,7': { ground: GRASS, items: [{ id: WALL }] } });
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 1, y: 1, z: 7 }, SHIFTED);
    viewport.step(1, { x: 0, y: 1, z: 7 }, { x: 1, y: 1, z: 7 }, 1000, 400);
    await viewport.tick(1000);
    await viewport.tick(1000);

    const layers = viewport.floorLayers(7);
    const wall = spriteWith(layers.scene, art.bitmapOf('object:102:0:0')) as Sprite;
    const orderAt = async (atMs: number): Promise<{ creature: number; wall: number }> => {
      await viewport.tick(atMs);
      const creature = viewport.creatureSprite(1) as Sprite;
      return { creature: creature.zIndex, wall: wall.zIndex };
    };

    const early = await orderAt(1000);
    expect(early.creature).toBe(sceneZIndex(0, 1, CREATURE_SLOT));
    expect(early.creature).toBeLessThan(early.wall);
    await orderAt(1100);
    expect((viewport.creatureSprite(1) as Sprite).zIndex).toBe(sceneZIndex(0, 1, CREATURE_SLOT));
    const late = await orderAt(1200);
    expect(late.creature).toBe(sceneZIndex(1, 1, CREATURE_SLOT));
    expect(late.creature).toBeLessThan(late.wall);
    await orderAt(1400);
    expect(late.creature).toBeLessThan(late.wall);
  });

  it('RF-02/DT-05: o `zIndex` é escrito UMA vez por troca, não a cada quadro', async () => {
    // Contar atribuições ao longo de 20 quadros de um passo: a inicial e a troca, exatamente 2.
    // `zIndex` por quadro marcaria `sortDirty` 20 vezes. Mutação que mata: tirar o `Map` que
    // compara a ordem (`walkingTiles`) e escrever sempre.
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7]);
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 1, y: 2, z: 7 }, SHIFTED);
    viewport.step(1, { x: 1, y: 1, z: 7 }, { x: 1, y: 2, z: 7 }, 1000, 400);

    await viewport.tick(1000); // nasce o sprite e o `zIndex` inicial é escrito
    const sprite = viewport.creatureSprite(1) as Sprite;
    for (let i = 1; i <= 20; i++) await viewport.tick(1000 + i * 20);

    expect(sprite.zIndexWrites).toBe(2);
  });

  it('RF-04: o sprite é desenhado `displacement` px acima e à esquerda da âncora', async () => {
    // Duas criaturas no MESMO tile: a de outfit com shift fica 8 px acima e à esquerda da que
    // não tem. Mutação que mata: `+ displacement` (sinal trocado), ou esquecer o `y`.
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7]);
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 1, y: 1, z: 7 }, SHIFTED);
    viewport.spawn(2, { x: 1, y: 1, z: 7 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    const shifted = viewport.creatureSprite(1) as Sprite;
    const plain = viewport.creatureSprite(2) as Sprite;
    expect(shifted.x).toBe(plain.x - 8);
    expect(shifted.y).toBe(plain.y - 8);
  });

  it('RF-05: barra e nome continuam no tile — o displacement NÃO vaza para o overlay', async () => {
    // `paintOverlay` recebe o `lifted` SEM displacement: um quadro de 64 px já obriga a barra a
    // não ancorar no sprite, e o shift só agravaria. Mutação que mata: passar `lifted − disp`.
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7]);
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 1, y: 1, z: 7 }, SHIFTED);
    viewport.spawn(2, { x: 1, y: 1, z: 7 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    // `overlay.children[0]` é o `targetFrame` da seleção de alvo (#428); os pares barra/nome
    // das criaturas começam depois dele.
    const overlay = viewport.layers().overlay.children.slice(1);
    const bar1 = overlay[0] as Container;
    const label1 = overlay[1] as Container;
    const bar2 = overlay[2] as Container;
    const label2 = overlay[3] as Container;
    expect(bar1.x).toBe(bar2.x);
    expect(bar1.y).toBe(bar2.y);
    expect(label1.x).toBe(label2.x);
    expect(label1.y).toBe(label2.y);
  });

  it('RF-06/DT-04: um quadro 64×64 produz a MESMA sequência de walking tile do 32×32', async () => {
    // Não há parâmetro de tamanho: a âncora inferior direita torna o canto independente do
    // quadro. Mutação que mata: somar/subtrair `texture.height` no walking tile.
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(20, 20, [7]);
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 1, y: 1, z: 7 }, SHIFTED);
    viewport.spawn(2, { x: 5, y: 1, z: 7 }, BIG_SHIFTED);
    viewport.step(1, { x: 1, y: 2, z: 7 }, { x: 1, y: 1, z: 7 }, 1000, 400);
    viewport.step(2, { x: 5, y: 2, z: 7 }, { x: 5, y: 1, z: 7 }, 1000, 400);
    await viewport.tick(1000);
    await viewport.tick(1000);

    const sequence = async (id: number): Promise<number[]> => {
      const values: number[] = [];
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        await viewport.tick(1000 + p * 400);
        values.push((viewport.creatureSprite(id) as Sprite).zIndex);
      }
      return values;
    };
    const small = await sequence(1);
    const big = await sequence(2);
    // Cada um com o PRÓPRIO tile: a forma da transição (origem até 50 %, destino depois) é a
    // mesma; o tamanho do quadro não entrou na conta.
    expect(small).toEqual([
      sceneZIndex(1, 2, CREATURE_SLOT), sceneZIndex(1, 2, CREATURE_SLOT),
      sceneZIndex(1, 2, CREATURE_SLOT), sceneZIndex(1, 1, CREATURE_SLOT),
      sceneZIndex(1, 1, CREATURE_SLOT),
    ]);
    expect(big).toEqual([
      sceneZIndex(5, 2, CREATURE_SLOT), sceneZIndex(5, 2, CREATURE_SLOT),
      sceneZIndex(5, 2, CREATURE_SLOT), sceneZIndex(5, 1, CREATURE_SLOT),
      sceneZIndex(5, 1, CREATURE_SLOT),
    ]);
  });

  it('sem pacote, o walking tile vale igual e o retângulo fica no tile', async () => {
    // `pack === null` é `NO_DISPLACEMENT`; a regra do walking tile não depende de arte, e o
    // retângulo de degradação representa o TILE, nunca o corpo deslocado (DT-06).
    const clock = testClock();
    const scene = fieldScene(20, 20, [7]);
    const viewport = await mountTestViewport({ scene, clock });
    viewport.spawnSelf(1, { x: 1, y: 2, z: 7 }, 0);
    viewport.step(1, { x: 1, y: 2, z: 7 }, { x: 1, y: 1, z: 7 }, 1000, 400);

    const sequence: number[] = [];
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      await viewport.tick(1000 + p * 400);
      sequence.push((viewport.creatureSprite(1) as Sprite).zIndex);
    }
    // Sem displacement, norte troca só no ÚLTIMO pixel (31/32): origem até 75 %, destino em 1.
    expect(sequence).toEqual([
      sceneZIndex(1, 2, CREATURE_SLOT), sceneZIndex(1, 2, CREATURE_SLOT),
      sceneZIndex(1, 2, CREATURE_SLOT), sceneZIndex(1, 2, CREATURE_SLOT),
      sceneZIndex(1, 1, CREATURE_SLOT),
    ]);
    const sprite = viewport.creatureSprite(1) as Sprite;
    expect(sprite.texture).toBe(Texture.WHITE);
    expect(sprite.width).toBe(26);
  });
});


/**
 * A janela de RENDER (issue #382, §11 da spec): o viewport passa a pintar e aquecer
 * `renderTiles`, não `visibleTiles`. Um mapa 40×40 com `groundAt(x, y) = 100 + x` deixa a
 * coluna virar id — é como o teste lê "que coluna já foi pedida". `mountTestViewport({ width:
 * 128, height: 96 })` dá zoom 1 e vista 4×3, o mínimo em que a diferença entre janela visível
 * e de render é grande o bastante para não empatar com arredondamento.
 */
describe('viewport pinta a janela de render (issue #382)', () => {
  const view = { widthTiles: 4, heightTiles: 3 };

  /** Um chão de 40×40, id = 100 + x — a coluna vira id, para o teste ler "que coluna pediu". */
  function groundMap(): Record<string, { ground: number; items: never[] }> {
    const tiles: Record<string, { ground: number; items: never[] }> = {};
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) tiles[`${x},${y},7`] = { ground: 100 + x, items: [] };
    }
    return tiles;
  }

  function groundCatalog(): SyntheticCatalog {
    const catalog: Record<number, { kind: 'object' }> = {};
    for (let x = 0; x < 40; x++) catalog[100 + x] = { kind: 'object' };
    return catalog;
  }

  it('RF-03: o chão pintado cobre a janela de RENDER, três tiles além de cada borda visível', async () => {
    const clock = testClock();
    const art = new SyntheticArt(groundCatalog(), { now: clock.now });
    const scene = sceneOf({ width: 40, height: 40, floors: [7], tiles: groundMap() });
    const viewport = await mountTestViewport({
      scene, art, clock, width: 128, height: 96,
    });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);

    await viewport.tick(0); // dispara os pedidos; texturas ainda não resolveram (DT-07)
    await viewport.tick(16); // `book.version` subiu — repinta com as texturas já prontas

    // Vista 4×3 fracionária em (10, 10): visível cobre 8..12 (x) × 9..11 (y); render soma 3 de
    // cada lado — 5..15 (11 colunas) × 6..14 (9 linhas) = 99, todos dentro do mapa 40×40.
    expect(visibleTiles({ x: 10, y: 10, z: 7 }, view)).toEqual({ minX: 8, minY: 9, maxX: 12, maxY: 11 });
    const groundSprites = viewport.floorLayers(7).ground.children
      .filter((child) => 'texture' in child && child.visible);
    expect(groundSprites).toHaveLength(99);
  });

  it('RF-03: parado no meio de um passo (câmera inteira), a janela de render some 3 tiles de cada lado', async () => {
    const clock = testClock();
    const art = new SyntheticArt(groundCatalog(), { now: clock.now });
    const scene = sceneOf({ width: 40, height: 40, floors: [7], tiles: groundMap() });
    const viewport = await mountTestViewport({
      scene, art, clock, width: 128, height: 96,
    });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);
    viewport.moveSelfTo({ x: 10.5, y: 10, z: 7 });

    await viewport.tick(0);
    await viewport.tick(16);

    // origin.x = 9.0 (inteiro): a vista visível cobre exatamente 9..12 (4 colunas, sem parcial);
    // a de render soma 3 de cada lado: 6..15 (10 colunas) × 6..14 (9 linhas) = 90.
    expect(visibleTiles({ x: 10.5, y: 10, z: 7 }, view)).toEqual({
      minX: 9, minY: 9, maxX: 12, maxY: 11,
    });
    const groundSprites = viewport.floorLayers(7).ground.children
      .filter((child) => 'texture' in child && child.visible);
    expect(groundSprites).toHaveLength(90);
  });

  it('RF-04: a coluna que entra na janela de RENDER é pedida ao livro antes de entrar na visível', async () => {
    const clock = testClock();
    const art = new SyntheticArt(groundCatalog(), { now: clock.now });
    const scene = sceneOf({ width: 40, height: 40, floors: [7], tiles: groundMap() });
    const viewport = await mountTestViewport({
      scene, art, clock, width: 128, height: 96,
    });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);
    await viewport.tick(0);
    await viewport.tick(16);
    const repaintsBefore = viewport.placeholderClears();

    // Em (10, 10) a janela de render vai só até `maxX = 15`; a coluna 116 (x = 16) ainda não foi
    // pedida.
    expect(art.requests.some((r) => r.key === 'object:116:0:0')).toBe(false);

    // Um passo de (10, 10) para (11, 10): a nova janela de render tem `maxX = 16` (id 116), mas
    // a visível só chega a `maxX = 13` — a coluna 16 ainda não apareceria na tela de hoje.
    viewport.step(1, { x: 10, y: 10, z: 7 }, { x: 11, y: 10, z: 7 }, 1000, 400);
    await viewport.tick(1400); // `elapsed (400) >= durationMs (400)`: o passo já venceu
    await viewport.tick(1400);

    expect(viewport.placeholderClears()).toBeGreaterThan(repaintsBefore);
    expect(visibleTiles({ x: 11, y: 10, z: 7 }, view).maxX).toBe(13);
    expect(art.requests.some((r) => r.key === 'object:116:0:0')).toBe(true);

    // Mais três passos, até (14, 10): agora `visibleTiles` CONTÉM `x = 16` — e o pedido pela
    // coluna 116 não se repete, porque o livro já tinha a textura em cache.
    viewport.moveSelfTo({ x: 14, y: 10, z: 7 });
    await viewport.tick(2000);
    await viewport.tick(2000);

    expect(visibleTiles({ x: 14, y: 10, z: 7 }, view).maxX).toBeGreaterThanOrEqual(16);
    expect(art.requests.filter((r) => r.key === 'object:116:0:0')).toHaveLength(1);
  });

  it('RF-07: perto do canto do mapa, o chão pintado conta só os tiles DENTRO do mapa', async () => {
    const clock = testClock();
    const art = new SyntheticArt(groundCatalog(), { now: clock.now });
    const scene = sceneOf({ width: 40, height: 40, floors: [7], tiles: groundMap() });
    const viewport = await mountTestViewport({
      scene, art, clock, width: 128, height: 96,
    });
    viewport.spawnSelf(1, { x: 2, y: 2, z: 7 }, 0);

    await viewport.tick(0);
    await viewport.tick(16);

    // Janela de render em (2, 2), vista 4×3: x −3..7, y −2..6 — metade cai fora do mapa 40×40.
    expect(renderTiles({ x: 2, y: 2, z: 7 }, view)).toEqual({ minX: -3, minY: -2, maxX: 7, maxY: 6 });
    const groundSprites = viewport.floorLayers(7).ground.children
      .filter((child) => 'texture' in child && child.visible);
    expect(groundSprites).toHaveLength(56);
  });
});

/**
 * O prefetch contínuo (issue #383, §11): a janela de prefetch tem margem `PREFETCH_TILES` (5),
 * dois tiles além da de render (3). O chão é `1000 + x` no andar 7 e `2000 + x` no andar 6, num
 * mapa 80×40 com os dois andares — a coluna vira id, então "que coluna foi pedida" é uma
 * asserção direta sobre `SyntheticArt.warmedObjects`.
 */
describe('viewport: prefetch contínuo (issue #383)', () => {
  const WIDTH = 80;
  const HEIGHT = 40;
  const CENTER = { x: 20, y: 18, z: 7 };
  const VIEW = viewFor(1024, 768, 2); // 16×12, inteira

  /** O chão do andar: `1000 + x` no 7, `2000 + x` no 6 — o andar vira id distinto (cenário 5a). */
  function field(): Record<string, TileStack> {
    const tiles: Record<string, TileStack> = {};
    for (const z of [6, 7]) {
      for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
          tiles[`${x},${y},${z}`] = { ground: (z === 6 ? 2000 : 1000) + x, items: [] };
        }
      }
    }
    return tiles;
  }

  const SCENE = (): Scene => sceneOf({ width: WIDTH, height: HEIGHT, floors: [6, 7], tiles: field() });

  const CATALOG: SyntheticCatalog = { 128: { kind: 'outfit' }, 129: { kind: 'outfit' } };

  /** Monta, põe o self em `center`, entrega cena e pacote, e dá UM quadro (a janela inteira). */
  async function mountWarmed(center = CENTER): Promise<{
    clock: ReturnType<typeof testClock>;
    art: SyntheticArt;
    viewport: Awaited<ReturnType<typeof mountTestViewport>>;
  }> {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const viewport = await mountTestViewport({ clock, width: 1024, height: 768 });
    viewport.spawnSelf(1, center, 0);
    viewport.handle.setPack(art);
    viewport.handle.setScene(SCENE());
    await viewport.tick(0);
    return { clock, art, viewport };
  }

  /** Os ids de chão das colunas de `window` no andar (7 → `1000 + x`, 6 → `2000 + x`). */
  function columnIds(window: { readonly minX: number; readonly maxX: number }, floor: number): Set<number> {
    const ids = new Set<number>();
    for (let x = window.minX; x <= window.maxX; x++) ids.add((floor === 6 ? 2000 : 1000) + x);
    return ids;
  }

  it('1. ao receber a cena, aquece a janela de PREFETCH inteira (não a de render)', async () => {
    const { art } = await mountWarmed();
    const window = prefetchTiles(CENTER, VIEW);

    expect(art.warmedObjects).toHaveLength(1);
    expect(new Set(art.warmedObjects[0])).toEqual(columnIds(window, 7));
  });

  it('2. cada tile cruzado gera UMA chamada só com a coluna que entrou, disjunta das anteriores', async () => {
    const { art, viewport } = await mountWarmed();
    const before = art.warmedObjects.length;
    const initial = prefetchTiles(CENTER, VIEW);

    const union = new Set<number>();
    for (let i = 1; i <= 30; i++) {
      viewport.moveSelfTo({ x: CENTER.x + i, y: CENTER.y, z: 7 });
      await viewport.tick(i * 16);
    }

    const calls = art.warmedObjects.slice(before);
    expect(calls).toHaveLength(30);
    calls.forEach((call, index) => {
      expect(call).toEqual([1000 + initial.maxX + index + 1]);
      for (const id of call) expect(union.has(id)).toBe(false);
      for (const id of call) union.add(id);
    });
  });

  it('3. parado, nenhum warmObjects/warmOutfit — mesmo com o ticker rodando', async () => {
    const { art, viewport } = await mountWarmed();
    const objects = art.warmedObjects.length;
    const outfits = art.warmedOutfits.length;

    for (let i = 1; i <= 120; i++) await viewport.tick(i * 16);

    expect(art.warmedObjects).toHaveLength(objects);
    expect(art.warmedOutfits).toHaveLength(outfits);
  });

  it('4. outfit por proximidade, uma vez por pacote; fora da janela não aquece', async () => {
    const { clock, art, viewport } = await mountWarmed();
    const window = prefetchTiles(CENTER, VIEW);

    viewport.spawn(2, { x: 22, y: 18, z: 7 }, 128); // B, dentro da janela
    await viewport.tick(16);
    expect(art.warmedOutfits).toEqual([128]);

    viewport.spawn(3, { x: 23, y: 18, z: 7 }, 128); // C, mesmo outfit: o `Set` deduplica
    await viewport.tick(32);
    expect(art.warmedOutfits).toEqual([128]);

    // D usa OUTRO outfit de propósito: com 128 o `Set` já o teria deduplicado, e o caso negativo
    // passaria mesmo sem o corte pela janela — o que se quer provar aqui é a POSIÇÃO.
    viewport.spawn(4, { x: window.maxX + 20, y: 18, z: 7 }, 129); // fora da janela
    await viewport.tick(48);
    expect(art.warmedOutfits).toEqual([128]);

    const other = new SyntheticArt(CATALOG, { now: clock.now });
    viewport.handle.setPack(other);
    await viewport.tick(64);
    expect(other.warmedOutfits).toEqual([128]); // pacote novo repete o pedido
  });

  it('5a. trocar de andar refaz a janela inteira, nos dois andares visíveis', async () => {
    const { art, viewport } = await mountWarmed();
    const before = art.warmedObjects.length;

    viewport.moveSelfTo({ x: CENTER.x, y: CENTER.y, z: 6 });
    await viewport.tick(16);

    expect(art.warmedObjects.length).toBe(before + 1);
    const window = prefetchTiles({ ...CENTER, z: 6 }, VIEW);
    const expected = new Set([...columnIds(window, 7), ...columnIds(window, 6)]);
    expect(new Set(art.warmedObjects[before])).toEqual(expected);
  });

  it('5b. resize refaz a janela inteira, sobre a vista nova', async () => {
    const { art, viewport } = await mountWarmed();
    const before = art.warmedObjects.length;

    viewport.resize(640, 480); // sem teto (#415): a vista é o que cabe no canvas (20×15 a zoom 1)
    await viewport.tick(16);

    expect(art.warmedObjects.length).toBe(before + 1);
    const window = prefetchTiles(CENTER, viewFor(640, 480, zoomFor(640, 480)));
    expect(new Set(art.warmedObjects[before])).toEqual(columnIds(window, 7));
  });

  it('6. sem pacote nada é pedido; o pacote que chega depois aquece a janela inteira', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const viewport = await mountTestViewport({ scene: SCENE(), art, clock, width: 1024, height: 768 });
    viewport.spawnSelf(1, CENTER, 0);

    viewport.handle.setPack(null);
    for (let i = 0; i < 10; i++) {
      if (i < 3) viewport.moveSelfTo({ x: CENTER.x + 1 + i, y: CENTER.y, z: 7 });
      await viewport.tick(i * 16);
    }
    expect(art.warmedObjects).toEqual([]);
    expect(art.warmedOutfits).toEqual([]);

    viewport.handle.setPack(art);
    await viewport.tick(1000);

    expect(art.warmedObjects).toHaveLength(1);
    const window = prefetchTiles({ x: CENTER.x + 3, y: CENTER.y, z: 7 }, VIEW);
    expect(new Set(art.warmedObjects[0])).toEqual(columnIds(window, 7));
  });
});

/**
 * A visibilidade de andares (issue #387, seção 11): o andar acima é desenhado até a cobertura,
 * sem véu, e a criatura que está lá aparece; entrar em casa faz o andar sumir numa rampa de
 * `FLOOR_FADE_MS` no alpha do `root` do andar, e sair o traz de volta; o prefetch segue a faixa
 * VISÍVEL (não o andar que está sumindo).
 */
describe('viewport: visibilidade de andares (issue #387)', () => {
  /** A rua toda `GRASS`; um telhado `ROOF` em (5..8, 5..8) do andar 6. */
  function houseScene(): Scene {
    const tiles: Record<string, TileStack> = {};
    for (let y = 5; y <= 8; y++) {
      for (let x = 5; x <= 8; x++) tiles[`${x},${y},6`] = { ground: ROOF, items: [] };
    }
    return sceneOf({
      width: 20, height: 20, floors: [6, 7],
      fill: { 7: { ground: GRASS, items: [] } },
      tiles,
    });
  }

  it('V1: fora da casa o 6 é desenhado sem véu, e a criatura no 6 aparece', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const viewport = await mountTestViewport({ scene: houseScene(), art, clock });
    viewport.spawnSelf(1, { x: 12, y: 12, z: 7 }, RAT);
    viewport.spawn(2, { x: 6, y: 6, z: 6 }, DOG);
    await viewport.tick(0);
    await viewport.tick(16);

    const roof = viewport.floorLayers(6);
    expect(roof.root.visible).toBe(true);
    expect(roof.root.alpha).toBe(1);
    const sprites = [...roof.ground.children, ...roof.scene.children]
      .filter((child) => 'texture' in child) as Sprite[];
    expect(sprites.length).toBeGreaterThan(0);
    for (const sprite of sprites) expect(sprite.tint).toBe(0xffffff);
    expect(viewport.creatureSprite(2)?.visible).toBe(true);
  });

  it('V2: entrar em casa começa a rampa no passo, e o 6 e B somem no fim dela', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const viewport = await mountTestViewport({ scene: houseScene(), art, clock });
    viewport.spawnSelf(1, { x: 12, y: 12, z: 7 }, RAT);
    viewport.spawn(2, { x: 6, y: 6, z: 6 }, DOG);
    await viewport.tick(0);
    await viewport.tick(16);

    const roof = viewport.floorLayers(6).root;
    // A posição LÓGICA é o destino desde o instante do passo: a rampa começa já, com a câmera
    // ainda em (12, 12). Mutação que mata: usar `interpolate` na conta.
    viewport.step(1, { x: 12, y: 12, z: 7 }, { x: 6, y: 6, z: 7 }, 1000, 400);

    await viewport.tick(1000);
    expect(roof.alpha).toBe(1);

    await viewport.tick(1125);
    expect(roof.alpha).toBeCloseTo(0.5);

    await viewport.tick(1250);
    expect(roof.alpha).toBe(0);
    expect(roof.visible).toBe(false);
    // `overlay.children[0]` é o `targetFrame` (#428); barra e nome de B vêm depois dele.
    const overlay = viewport.layers().overlay.children.slice(1);
    expect(viewport.creatureSprite(2)?.visible).toBe(false);
    expect((overlay[2] as Container).visible).toBe(false);
    expect((overlay[3] as Container).visible).toBe(false);
  });

  it('V3: sair de casa traz o 6 de volta numa rampa, e B volta com ele', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const viewport = await mountTestViewport({ scene: houseScene(), art, clock });
    viewport.spawnSelf(1, { x: 12, y: 12, z: 7 }, RAT);
    viewport.spawn(2, { x: 6, y: 6, z: 6 }, DOG);
    await viewport.tick(0);
    await viewport.tick(16);

    const roof = viewport.floorLayers(6).root;
    viewport.moveSelfTo({ x: 6, y: 6, z: 7 });
    await viewport.tick(1000);
    await viewport.tick(1250); // a rampa de entrada terminou; o pool guarda o root do 6
    expect(roof.visible).toBe(false);

    viewport.moveSelfTo({ x: 12, y: 12, z: 7 });
    await viewport.tick(2000);
    expect(viewport.drawnFloors()).toContain(6);
    expect(roof.alpha).toBe(0);

    await viewport.tick(2125);
    expect(roof.alpha).toBeCloseTo(0.5);

    await viewport.tick(2250);
    expect(roof.alpha).toBe(1);
    expect(roof.visible).toBe(true);
    expect(viewport.creatureSprite(2)?.visible).toBe(true);
  });

  it('V4: entrar e sair no meio da rampa nunca tira o alpha de [0, 1]', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const viewport = await mountTestViewport({ scene: houseScene(), art, clock });
    viewport.spawnSelf(1, { x: 12, y: 12, z: 7 }, RAT);
    viewport.spawn(2, { x: 6, y: 6, z: 6 }, DOG);
    await viewport.tick(0);
    await viewport.tick(16);

    const roof6 = viewport.floorLayers(6).root;
    const roof7 = viewport.floorLayers(7).root;
    const bar2 = viewport.layers().overlay.children[2] as Container;
    const check = (): void => {
      for (const alpha of [roof6.alpha, roof7.alpha, bar2.alpha]) {
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
    };

    viewport.moveSelfTo({ x: 6, y: 6, z: 7 });
    for (let t = 3000; t <= 3090; t += 10) {
      await viewport.tick(t);
      check();
    }
    viewport.moveSelfTo({ x: 12, y: 12, z: 7 }); // troca no MEIO da rampa
    for (let t = 3100; t <= 3600; t += 10) {
      await viewport.tick(t);
      check();
    }
  });

  it('V5: criatura no andar de cima é desenhada no `scene` do 6 e ordena como criatura', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const viewport = await mountTestViewport({ scene: houseScene(), art, clock });
    viewport.spawnSelf(1, { x: 12, y: 12, z: 7 }, RAT);
    viewport.spawn(2, { x: 6, y: 6, z: 6 }, DOG);
    await viewport.tick(0);
    await viewport.tick(16);

    viewport.step(2, { x: 6, y: 6, z: 6 }, { x: 7, y: 6, z: 6 }, 0, 400);
    await viewport.tick(200);

    const b = viewport.creatureSprite(2) as Sprite;
    expect(b.visible).toBe(true);
    expect(b.parent).toBe(viewport.floorLayers(6).scene);
    // Andar de cima deslocado um tile para cima/esquerda: o tile de ordem é (6, 5).
    expect(b.zIndex).toBe(sceneZIndex(6, 5, CREATURE_SLOT));
  });

  it('V6: o prefetch aquece a faixa visível, não o andar que acabou de sair', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now, latencyMs: 100 });
    const viewport = await mountTestViewport({ scene: houseScene(), art, clock });
    viewport.spawnSelf(1, { x: 12, y: 12, z: 7 }, RAT);
    await viewport.tick(0);
    expect(art.warmedObjects.some((ids) => ids.includes(ROOF))).toBe(true);

    viewport.step(1, { x: 12, y: 12, z: 7 }, { x: 6, y: 6, z: 7 }, 1000, 400);
    await viewport.tick(1300);
    await viewport.tick(1400); // a câmera pousa em (6, 6) e a janela se acomoda
    const before = art.warmedObjects.length;

    // Um passo DENTRO do telhado (5..8): a janela anda, mas a faixa visível continua só o 7.
    viewport.step(1, { x: 6, y: 6, z: 7 }, { x: 8, y: 8, z: 7 }, 1400, 400);
    await viewport.tick(1800);

    const calls = art.warmedObjects.slice(before);
    expect(calls.length).toBeGreaterThan(0);
    for (const ids of calls) expect(ids).not.toContain(ROOF);
  });

  it('V7: sem cena, um andar só no pool, alpha 1, sem erro em vinte quadros', async () => {
    const viewport = await mountTestViewport({ scene: null });
    viewport.spawnSelf(1, { x: 12, y: 12, z: 7 }, 0);
    viewport.handle.setScene(null);
    for (let i = 0; i < 20; i++) await viewport.tick(i * 16);

    const roots = viewport.layers().floorsRoot.children;
    expect(roots).toHaveLength(1);
    expect(roots[0]?.alpha).toBe(1);
    expect(roots[0]?.visible).toBe(true);
  });
});

/**
 * As métricas de desenvolvimento do renderer (issue #388, §11): `ViewportHandle.stats()`
 * fotografa os contadores — tiles pintados na última repintura, ids aquecidos, sprites da cena,
 * acertos/falhas do livro, repinturas, quadros e duração do último ticker. Tudo é leitura sob
 * demanda; o laço não avisa ninguém (ADR 0007).
 */
describe('viewport: métricas de desenvolvimento (issue #388)', () => {
  /** O chão `1000 + x` no andar 7 e `2000 + x` no 6 — a coluna vira id, para M4. */
  function prefetchField(): Scene {
    const tiles: Record<string, TileStack> = {};
    for (const z of [6, 7]) {
      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 80; x++) {
          tiles[`${x},${y},${z}`] = { ground: (z === 6 ? 2000 : 1000) + x, items: [] };
        }
      }
    }
    return sceneOf({ width: 80, height: 40, floors: [6, 7], tiles });
  }

  it('M1 — renderedTiles conta os tiles com pilha da janela de render', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(30, 30, [7]);
    const viewport = await mountTestViewport({ scene, art, clock, width: 128, height: 96 });
    viewport.spawnSelf(1, { x: 10.5, y: 10, z: 7 }, 0);

    await viewport.tick(0);
    await viewport.tick(16);

    const window = renderTiles({ x: 10.5, y: 10, z: 7 }, viewFor(128, 96, 1));
    const expected = (window.maxX - window.minX + 1) * (window.maxY - window.minY + 1);
    expect(expected).toBe(90);
    expect(viewport.handle.stats().renderedTiles).toBe(expected);
  });

  it('M2 — terrainRepaints conta repinturas, não quadros', async () => {
    const scene = fieldScene(20, 20, [7]);
    const viewport = await mountTestViewport({ scene });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);

    for (let i = 0; i < 10; i++) await viewport.tick(i * 16);
    expect(viewport.handle.stats().terrainRepaints).toBe(1);

    viewport.moveSelfTo({ x: 11, y: 10, z: 7 });
    await viewport.tick(200);
    expect(viewport.handle.stats().terrainRepaints).toBe(2);
  });

  it('M3 — miss no primeiro quadro; depois da arte chegar, hit e nenhum miss novo', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now, latencyMs: 100 });
    const scene = fieldScene(20, 20, [7]);
    const viewport = await mountTestViewport({ scene, art, clock });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);

    await viewport.tick(0);
    const first = viewport.handle.stats();
    expect(first.textureHits).toBe(0);
    expect(first.textureMisses).toBe(new Set(art.requests.map((r) => r.key)).size);
    expect(first.textureMisses).toBeGreaterThan(0);

    art.flush();
    await viewport.tick(16);
    const after = viewport.handle.stats();
    expect(after.textureHits).toBeGreaterThan(0);
    expect(after.textureMisses).toBe(first.textureMisses);
  });

  it('M4 — prefetchedIds acumula o tamanho de cada Set passado a warmObjects', async () => {
    const clock = testClock();
    const art = new SyntheticArt({}, { now: clock.now });
    const viewport = await mountTestViewport({ clock, width: 1024, height: 768 });
    viewport.spawnSelf(1, { x: 20, y: 18, z: 7 }, 0);
    viewport.handle.setPack(art);
    viewport.handle.setScene(prefetchField());

    await viewport.tick(0);
    const first = art.warmedObjects[0]?.length ?? 0;
    expect(first).toBeGreaterThan(0);
    expect(viewport.handle.stats().prefetchedIds).toBe(first);

    // Um tile a leste: a janela de prefetch anda uma coluna, e só ela é somada.
    viewport.moveSelfTo({ x: 21, y: 18, z: 7 });
    await viewport.tick(16);
    const second = art.warmedObjects[1]?.length ?? 0;
    expect(second).toBeGreaterThan(0);
    expect(viewport.handle.stats().prefetchedIds).toBe(first + second);
  });

  it('M5 — sceneSprites conta os filhos visíveis dos `scene` dos andares visíveis', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = fieldScene(40, 40, [7], { '15,15,7': { ground: GRASS, items: [{ id: WALL }] } });
    const viewport = await mountTestViewport({ scene, art, clock });
    // Sem self, a câmera fica no centro do mapa (19,5, 19,5); a janela de render cobre x 8..31.
    viewport.spawn(2, { x: 16, y: 15, z: 7 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    expect(viewport.handle.stats().sceneSprites).toBe(2); // parede + criatura

    viewport.step(2, { x: 16, y: 15, z: 7 }, { x: 2, y: 2, z: 7 }, 16, 0);
    await viewport.tick(32);
    expect(viewport.handle.stats().sceneSprites).toBe(1); // só a parede
  });

  it('M6 — lastFrameMs mede o ticker com o `now()` injetado; frames conta os quadros', async () => {
    // Relógio que soma 3 ms a cada leitura: `lastFrameMs` é a diferença entre a primeira e a
    // última chamada do quadro, então nunca é 0 — medir com `performance.now()` daria 0 aqui.
    let ms = 0;
    const clock = {
      now: (): number => (ms += 3),
      set: (next: number): void => { ms = next; },
    };
    const scene = fieldScene(20, 20, [7]);
    const viewport = await mountTestViewport({ scene, clock });
    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, 0);

    await viewport.tick(0);
    await viewport.tick(16);
    await viewport.tick(32);

    const stats = viewport.handle.stats();
    expect(stats.frames).toBe(3);
    expect(stats.lastFrameMs).toBeGreaterThanOrEqual(3);
  });
});

