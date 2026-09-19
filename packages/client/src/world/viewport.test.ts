// O harness de teste do viewport (issue #381): prende os SEIS comportamentos de hoje, mais
// `drawOrder`, para que as issues seguintes do M23 (que reescrevem camadas, ordem de desenho,
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
import { renderTiles, prefetchTiles, visibleTiles, viewFor, zoomFor } from './camera.js';
import type { Scene, TileStack } from './scene.js';

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
    for (const layer of [creatures, above, effects]) expect(layer?.children).toHaveLength(0);
    // O `overlay` deixou de nascer vazio com a seleção de alvo (#428): o `targetFrame` é um
    // `Graphics` criado junto com ele. O que a asserção prova é que os três containers do meio
    // nascem vazios e que `terrain` tem o `groundFallback` como primeiro filho.
    expect(overlay?.children[0]).toBeInstanceOf(Graphics);
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

  it('(5) sem pacote, o retângulo de reserva cobre a janela inteira de `renderTiles` (M23/#382: era `visibleTiles`)', async () => {
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

/**
 * A janela de RENDER (issue #382, §11 da spec): o viewport passa a pintar e aquecer
 * `renderTiles`, não `visibleTiles`. Um mapa 40×40 com `groundAt(x, y) = 100 + x` deixa a
 * coluna virar id — é como o teste lê "que coluna já foi pedida" sem precisar inspecionar
 * `objectTexture`. `mountTestViewport({ width: 128, height: 96 })` dá zoom 1 e vista 4×3
 * (`zoomFor`/`viewFor`), o mínimo em que a diferença entre janela visível e de render é grande
 * o bastante para não empatar com arredondamento.
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
    const window = { visible: visibleTiles({ x: 10, y: 10, z: 7 }, view) };
    expect(window.visible).toEqual({ minX: 8, minY: 9, maxX: 12, maxY: 11 });
    const groundSprites = viewport.layers().terrain.children
      .filter((child) => 'texture' in child && child.visible);
    expect(groundSprites).toHaveLength(99);
  });

  it('RF-03: parado exatamente no meio de um passo (câmera inteira), a janela de render some 3 tiles de cada lado sem a coluna parcial', async () => {
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
    const groundSprites = viewport.layers().terrain.children
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

    // Achado 4 da rodada 1 de revisão (#382): sem isto, um `paintTerrain` que já pintasse uma
    // janela maior (margem 4, por exemplo) passaria igual — só a metade "pedida antes de
    // entrar na visível" era provada. Em (10, 10) a janela de render vai só até `maxX = 15`
    // (5..15, ver RF-03 acima); a coluna 116 (x = 16) ainda não foi pedida.
    expect(art.requests.some((r) => r.key === 'object:116:0:0')).toBe(false);

    // Um passo de (10, 10) para (11, 10): a nova janela de render tem `maxX = 16` (id 116),
    // mas a visível só chega a `maxX = 13` — a coluna 16 ainda não apareceria na tela de hoje.
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
    const requestsFor116 = art.requests.filter((r) => r.key === 'object:116:0:0');
    expect(requestsFor116).toHaveLength(1);
  });

  // Achado 3 da rodada 1 de revisão (#382): os dois cenários RF-03 ficam inteiros dentro do
  // mapa 40×40 quando o alvo está em (10, 10) — a filtragem por `Scene.tileAt` (RF-07, §11)
  // nunca é exercitada. Perto do canto a janela de render extrapola o mapa dos dois lados.
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

    // Janela de render em (2, 2), vista 4×3: x −3..7, y −2..6 (mesma conta de `tileWindow` das
    // outras RF-03) — metade cai fora do mapa 40×40. `Scene.tileAt` devolve `null` fora
    // (scene.ts), e só os tiles DENTRO do mapa viram sprite: x 0..7 (8 colunas) × y 0..6
    // (7 linhas) = 56, e não os 11×9 = 99 de um alvo longe da borda (RF-03 acima) — a
    // diferença só aparece se a filtragem estiver acontecendo de fato.
    const renderWindow = renderTiles({ x: 2, y: 2, z: 7 }, view);
    expect(renderWindow).toEqual({
      minX: -3, minY: -2, maxX: 7, maxY: 6,
    });
    const groundSprites = viewport.layers().terrain.children
      .filter((child) => 'texture' in child && child.visible);
    expect(groundSprites).toHaveLength(56);
  });
});

/**
 * O prefetch contínuo (issue #383, §11): a janela de prefetch tem margem `PREFETCH_TILES` (5),
 * dois tiles além da de render (3). O chão é `1000 + x` no andar 7 e `2000 + x` no andar 6, num
 * mapa 80×40 com os dois andares — a coluna vira id, então "que coluna foi pedida" é uma
 * asserção direta sobre `SyntheticArt.warmedObjects`. A vista inteira (`viewFor(1024, 768, 2)`
 * = 16×12) faz `minX` e `maxX` avançarem juntos: um passo = uma coluna que entra.
 *
 * O alvo fica em (20, 18): a janela de prefetch (x 7..33, y 7..35) cabe INTEIRA no mapa, então
 * `idsIn` vê exatamente `{1000 + x}` para toda coluna da janela — sem o recorte de `tileAt`
 * na borda embaralhar a contagem.
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

  it('5a. trocar de andar refaz a janela inteira, nos dois andares de floorsBelow', async () => {
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
