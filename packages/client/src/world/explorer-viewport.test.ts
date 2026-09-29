// O viewport a serviço do explorador do mundo (#661, #665, #666): câmera injetada, cena que
// recebe tiles depois de existir (`revision`), criaturas de outra fonte e objetos animados.
// Decisões do renderer, não pixels — o mesmo harness dos cenários do M23.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => import('./testing/pixi-fake.js'));

import { SyntheticArt } from './testing/art.js';
import { mountTestViewport, resetWorld, sceneOf, testClock } from './testing/harness.js';
import { OBJECT_ANIMATION_TICK_MS } from './viewport.js';
import type { Scene, TileStack } from './scene.js';
import { loopPhaseAt } from './effects.js';

const GRASS = 100;
const WATER = 200;

beforeEach(() => { resetWorld(); });

describe('loopPhaseAt', () => {
  it('roda em laço pelas durações, e objeto sem fases fica na 0', () => {
    expect(loopPhaseAt([], 5000)).toBe(0);
    expect(loopPhaseAt([500], 5000)).toBe(0);
    expect(loopPhaseAt([200, 300], 0)).toBe(0);
    expect(loopPhaseAt([200, 300], 250)).toBe(1);
    expect(loopPhaseAt([200, 300], 520)).toBe(0);
  });
});

describe('objetos animados (#666)', () => {
  const catalog = { [GRASS]: { kind: 'object' as const }, [WATER]: { kind: 'object' as const, phases: [200, 200, 200] } };
  const water: TileStack = { ground: WATER, items: [] };
  const field = () => sceneOf({ width: 20, height: 20, floors: [7], fill: { 7: { ground: GRASS, items: [] } }, tiles: { '10,10,7': water } });

  it('com animateObjects, a água pede a fase do relógio e o terreno repinta no compasso', async () => {
    const clock = testClock();
    const art = new SyntheticArt(catalog, { now: clock.now });
    const view = await mountTestViewport({ scene: field(), art, clock, viewport: { camera: () => ({ x: 10, y: 10, z: 7 }), animateObjects: true } });
    await view.tick(0);
    await view.tick(250);
    await view.tick(450);
    const keys = art.requests.map((r) => r.key).filter((k) => k.startsWith(`object:${WATER}`));
    expect(keys).toEqual([`object:${WATER}:0:0`, `object:${WATER}:0:0:p1`, `object:${WATER}:0:0:p2`]);
    // A grama não tem fases: continua pedindo a chave de sempre, uma vez só.
    expect(art.requests.filter((r) => r.key === `object:${GRASS}:0:0`)).toHaveLength(1);
    expect(OBJECT_ANIMATION_TICK_MS).toBeLessThanOrEqual(200);
  });

  it('sem a opção, a água fica na fase 0 — o jogo não paga pela animação', async () => {
    const clock = testClock();
    const art = new SyntheticArt(catalog, { now: clock.now });
    const view = await mountTestViewport({ scene: field(), art, clock, viewport: { camera: () => ({ x: 10, y: 10, z: 7 }) } });
    await view.tick(0);
    await view.tick(450);
    expect(art.requests.map((r) => r.key).filter((k) => k.startsWith(`object:${WATER}`))).toEqual([`object:${WATER}:0:0`]);
  });
});

describe('câmera, revisão e criaturas injetadas (#661, #665)', () => {
  it('a câmera injetada centra a vista sem personagem, e a revisão repinta o tile que chegou depois', async () => {
    const clock = testClock();
    const art = new SyntheticArt({ [GRASS]: { kind: 'object' } }, { now: clock.now });
    let revision = 0;
    let ready = false;
    const scene: Scene = {
      id: 'late', width: 100, height: 100, floors: [7], defaultZ: 7,
      tileAt: (x, y) => (ready && x === 50 && y === 50 ? { ground: GRASS, items: [] } : null),
      revision: () => revision,
    };
    const view = await mountTestViewport({ scene, art, clock, viewport: { camera: () => ({ x: 50, y: 50, z: 7 }) } });
    await view.tick(0);
    expect(art.requests).toHaveLength(0);
    ready = true;
    revision += 1;
    await view.tick(16);
    expect(art.requests.map((r) => r.key)).toContain(`object:${GRASS}:0:0`);
  });

  it('as criaturas vêm da fonte injetada, não do world', async () => {
    const clock = testClock();
    const view = await mountTestViewport({
      scene: sceneOf({ width: 20, height: 20, floors: [7], fill: { 7: { ground: GRASS, items: [] } } }),
      clock,
      viewport: {
        camera: () => ({ x: 10, y: 10, z: 7 }),
        creatures: () => [{ id: 900, appearanceId: 26, name: 'Rotworm', health: 100, maxHealth: 100, position: { x: 11, y: 10, z: 7 }, step: null }],
      },
    });
    view.spawn(1, { x: 5, y: 5, z: 7 });
    await view.tick(0);
    // O `scene` do andar tem os objetos do mapa e as criaturas; a diferença é quem foi desenhado.
    // Uma só: a da fonte injetada. A do `world`, também dentro da vista, não entra.
    const scene = view.floorLayers(7).scene;
    const creatures = scene.children.length - view.objectSprites(7).length;
    expect(creatures).toBe(1);
  });
});
