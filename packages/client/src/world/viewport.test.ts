// O harness de teste do viewport (issue #381): prende os SEIS comportamentos de hoje, mais
// `drawOrder`, para que as issues seguintes do M16 (que reescrevem camadas, ordem de desenho,
// prefetch e andares) provem que mudaram só o que disseram que mudariam. Os testes (8) e (9)
// são a rede de segurança da rodada 1 de revisão desta issue: (8) prende que o harness casa
// sprite↔id certo mesmo quando `reorder` embaralha `creatures.children` no mesmo quadro do
// nascimento (achado 2), e (9) cobre a entrega com latência da arte sintética (achado 5).
//
// O mock abaixo troca todo `import` do pacote real de renderização, no gráfico de módulos
// inteiro — inclusive dentro de `viewport.ts` e `world/textures.ts` —, pelo falso em
// `testing/pixi-fake.ts`; o Vitest o iça (hoisted) para antes de qualquer import deste arquivo.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => import('./testing/pixi-fake.js'));

import { Container, drawOrder, Graphics, Texture } from './testing/pixi-fake.js';
import { SyntheticArt, type SyntheticCatalog } from './testing/art.js';
import { mountTestViewport, resetWorld, sceneOf, testClock } from './testing/harness.js';
import { visibleTiles, viewFor } from './camera.js';

/** O catálogo mínimo dos testes desta issue — ver a seção 11 da spec (#381). */
const GRASS = 100;
const WALL = 102;
const ARCH = 106;
const CRATE = 103;
const RAT = 21;
const DOG = 22;

const CATALOG: SyntheticCatalog = {
  [GRASS]: { kind: 'object' },
  [WALL]: { kind: 'object', flags: { bottom: true, unpass: true }, size: { width: 2, height: 2 } },
  [ARCH]: { kind: 'object', flags: { top: true } },
  [CRATE]: { kind: 'object', flags: { elevation: 8 } },
  [RAT]: { kind: 'outfit' },
  [DOG]: { kind: 'outfit' },
};

beforeEach(resetWorld);

describe('viewport (issue #381)', () => {
  it('(1) monta os cinco containers de hoje, na ordem terrain/creatures/above/effects/overlay, e um único callback de quadro', async () => {
    const scene = sceneOf({ width: 4, height: 4, floors: [7] });
    const viewport = await mountTestViewport({ scene });

    expect(viewport.app.ticker.callbacks.length).toBe(1);
    expect(viewport.stage.children.length).toBe(5);
    // `layers()` (harness.ts) destrutura `stage.children` NESSA ordem — comparar com ela mesma
    // é tautológico (achado 3 da issue #381) e passaria com os cinco containers em qualquer
    // posição. A asserção estrutural que distingue de fato `terrain` dos outros quatro:
    // `groundFallback` (viewport.ts) é o PRIMEIRO filho SÓ de `terrain`.
    const [terrain, creatures, above, effects, overlay] = viewport.stage.children;
    expect(terrain?.children[0]).toBeInstanceOf(Graphics);
    for (const layer of [creatures, above, effects, overlay]) expect(layer?.children).toHaveLength(0);
    const layers = viewport.layers();
    expect(layers.terrain).toBe(terrain);
    expect(layers.overlay).toBe(overlay);
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
    // O passo muda o facing de `south` para `east` no início — e CONTINUA `east` depois que o
    // passo vence: `facingOf` (facing.ts) lê só a direção do ÚLTIMO passo, inclusive parada, e
    // nunca volta a `south` sozinho. O que muda em `t = 1` (`elapsed >= durationMs`, já "parado"
    // em `walkFrame`) é `moving`: a chave de textura vai de `outfit:21:east:w:0` para
    // `outfit:21:east:s:0` — uma chave NOVA, e o primeiro quadro que a pede desenha o retângulo
    // enquanto ela não chega (regra de sempre). Tickar duas vezes no MESMO instante deixa a
    // textura chegar sem mexer no `lift` (`t` é o mesmo nas duas), para cada leitura usar a
    // MESMA fórmula — senão a transição retângulo→textura, e não a elevação, explicaria a
    // diferença.
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

  it('(8) duas criaturas nascem no mesmo quadro em posições que o `reorder` inverte: cada sprite fica com o id certo', async () => {
    const clock = testClock();
    const art = new SyntheticArt(CATALOG, { now: clock.now });
    const scene = sceneOf({
      width: 20, height: 20, floors: [7], fill: { 7: { ground: GRASS, items: [] } },
    });
    const viewport = await mountTestViewport({ scene, art, clock });

    // id 1 nasce PRIMEIRO (ordem de `world.creatures`) mas fica mais ao SUL (y maior); id 2
    // nasce DEPOIS mas fica mais ao NORTE. `paintCreatures` cria os sprites na ordem de
    // nascimento e só DEPOIS chama `reorder` (viewport.ts), que ordena `creatures.children`
    // por posição de tela (`compareDrawOrder`: y, depois x) — no MESMO quadro. Isso põe o
    // sprite de id 2 ANTES do de id 1 em `creatures.children`, o oposto da ordem de criação
    // (issue #381, achado 2: casar pela posição no array, e não pela ordem de criação, casava
    // o sprite errado com cada id, sem lançar).
    viewport.spawnSelf(1, { x: 10, y: 12, z: 7 }, RAT);
    viewport.spawn(2, { x: 10, y: 10, z: 7 }, DOG);
    await viewport.tick(0);
    await viewport.tick(16);

    const layers = viewport.layers();
    const one = viewport.creatureSprite(1);
    const two = viewport.creatureSprite(2);
    expect(one).toBeDefined();
    expect(two).toBeDefined();
    expect(one).not.toBe(two);
    // A prova de que `reorder` de fato inverteu a ordem: id 2 está ANTES de id 1 no array.
    expect(layers.creatures.children.indexOf(two as Container))
      .toBeLessThan(layers.creatures.children.indexOf(one as Container));
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
