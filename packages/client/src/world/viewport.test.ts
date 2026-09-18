// O harness de teste do viewport (issue #381): prende os SEIS comportamentos de hoje, mais
// `drawOrder`, para que as issues seguintes do M16 (que reescrevem camadas, ordem de desenho,
// prefetch e andares) provem que mudaram só o que disseram que mudariam.
//
// O mock abaixo troca todo `import` do pacote real de renderização, no gráfico de módulos
// inteiro — inclusive dentro de `viewport.ts` e `world/textures.ts` —, pelo falso em
// `testing/pixi-fake.ts`; o Vitest o iça (hoisted) para antes de qualquer import deste arquivo.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => import('./testing/pixi-fake.js'));

import { Container, drawOrder, Texture } from './testing/pixi-fake.js';
import { SyntheticArt, type SyntheticCatalog } from './testing/art.js';
import { mountTestViewport, resetWorld, sceneOf, testClock } from './testing/harness.js';
import { visibleTiles, viewFor } from './camera.js';

/** O catálogo mínimo dos testes desta issue — ver a seção 11 da spec (#381). */
const GRASS = 100;
const WALL = 102;
const ARCH = 106;
const CRATE = 103;
const RAT = 21;

const CATALOG: SyntheticCatalog = {
  [GRASS]: { kind: 'object' },
  [WALL]: { kind: 'object', flags: { bottom: true, unpass: true }, size: { width: 2, height: 2 } },
  [ARCH]: { kind: 'object', flags: { top: true } },
  [CRATE]: { kind: 'object', flags: { elevation: 8 } },
  [RAT]: { kind: 'outfit' },
};

beforeEach(resetWorld);

describe('viewport (issue #381)', () => {
  it('(1) monta os cinco containers de hoje e um único callback de quadro', async () => {
    const scene = sceneOf({ width: 4, height: 4, floors: [7] });
    const viewport = await mountTestViewport({ scene });

    expect(viewport.app.ticker.callbacks.length).toBe(1);
    expect(viewport.stage.children.length).toBe(5);
    const layers = viewport.layers();
    expect(viewport.stage.children).toEqual([
      layers.terrain, layers.creatures, layers.above, layers.effects, layers.overlay,
    ]);
  });

  it('(2) a criatura vira sprite em `creatures`, com a textura do pacote', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = sceneOf({ width: 20, height: 20, floors: [7] });
    const viewport = await mountTestViewport({ scene, art, clock });

    viewport.spawnSelf(1, { x: 10, y: 10, z: 7 }, RAT);
    await viewport.tick(0);
    await viewport.tick(16);

    const sprite = viewport.creatureSprite(1);
    expect(sprite).toBeDefined();
    expect(sprite?.parent).toBe(viewport.layers().creatures);
    expect(sprite?.texture.source.resource).toBe(art.bitmapOf('outfit:21:south:s:0'));
  });

  it('(3) parede vira `terrain`, arco vira `above` — nenhum arco em `terrain`', async () => {
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

    const layers = viewport.layers();
    const wallSprite = layers.terrain.children.find(
      (child) => 'texture' in child && (child as { texture: Texture }).texture.source.resource === art.bitmapOf('object:102:0:0'),
    );
    const archSprite = layers.above.children.find(
      (child) => 'texture' in child && (child as { texture: Texture }).texture.source.resource === art.bitmapOf('object:106:0:0'),
    );
    expect(wallSprite).toBeDefined();
    expect(archSprite).toBeDefined();
    const archInTerrain = layers.terrain.children.some(
      (child) => 'texture' in child && (child as { texture: Texture }).texture.source.resource === art.bitmapOf('object:106:0:0'),
    );
    expect(archInTerrain).toBe(false);
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

  it('(5) sem pacote, o retângulo de reserva cobre a janela inteira de `visibleTiles`', async () => {
    const scene = sceneOf({
      width: 40, height: 40, floors: [7], fill: { 7: { ground: GRASS, items: [] } },
    });
    const viewport = await mountTestViewport({ scene });
    viewport.spawnSelf(1, { x: 20, y: 20, z: 7 }, 0);

    await viewport.tick(0);

    const window = visibleTiles({ x: 20, y: 20, z: 7 }, viewFor(576, 448, 1));
    const expected = (window.maxX - window.minX + 1) * (window.maxY - window.minY + 1);
    const rects = viewport.placeholderOps().filter((op) => op.kind === 'rect');
    expect(rects.length).toBe(expected);
  });

  it('(6) a elevação do tile interpola ao longo do passo, e não pula 24px', async () => {
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
    // O passo muda o facing de `south` para `east` (início) e volta a `south` quando o passo
    // vence (`t = 1`, `elapsed >= durationMs` já é "parado" em `walkFrame`): cada uma dessas
    // duas bordas pede uma chave de textura NOVA, e o primeiro quadro que a pede desenha o
    // retângulo enquanto ela não chega (regra de sempre). Tickar duas vezes no MESMO instante
    // deixa a textura chegar sem mexer no `lift` (`t` é o mesmo nas duas), para cada leitura
    // usar a MESMA fórmula — senão a transição retângulo→textura, e não a elevação, explicaria
    // a diferença.
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
});
