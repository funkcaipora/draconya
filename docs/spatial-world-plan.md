# Mundo espacial — plano de implementação (E14 · Cliente, M23)

**Status:** aprovado em 2026-09-17 — o brief técnico do milestone [M23 · Mundo espacial — overscan, painter order e andares](https://github.com/funkcaipora/draconya/milestone/10); a decisão de arquitetura vai para o ADR do M23 (0034, criado em 385). As nove issues do marco apontam para cá.
**PRD:** `draconya-renderer-tibia-behavior-spec.md` (2026-09-16, do dono do produto; não versionado — a fonte de §18–§39 citados aqui).
**Substitui:** o bullet "Andares" e "A ordem de desenho só é recalculada quando alguém troca de tile" de `packages/client/AGENTS.md`, quando 385 e 387 os reescreverem.

---

## 1. Auditoria

Fonte: `~/Downloads/draconya-renderer-tibia-behavior-spec.md` (o PRD de renderização). Este
plano fixa as decisões que atravessam mais de uma issue — nomes, assinaturas, regras numéricas
— para que nove specs escritas em paralelo não divirjam. Cada issue cita o trecho dele que a
rege.

Auditoria do checkout (2026-09-17, `main` em `3299eb5`; reconferida em `07b3b12`, que só somou
`world/fps.ts` e `ViewportHandle.getFps()` ao viewport), verificada arquivo a arquivo:

- `packages/client/src/world/camera.ts` — `visibleTiles` com margem 1 fixa; `compareDrawOrder`.
- `packages/client/src/world/viewport.ts` (910 linhas) — containers `terrain`, `creatures`,
  `above`, `effects`, `overlay`; `paintTerrain` repinta pela chave da janela; `reorder` por
  assinatura de posições inteiras com `setChildIndex`; `liftOf` já interpola elevação; `warm`
  aquece só a janela inicial.
- `packages/client/src/world/tile-stack.ts` — `DrawLayer = 'ground' | 'top'`; `ObjectInfo` com
  `flagsOf` e `patternOf`.
- `packages/client/src/world/floors.ts` — `floorsBelow`: nunca desenha andar acima do jogador.
- `packages/client/src/world/facing.ts` — `walkFrame` já amarra a fase ao progresso do passo
  (§22 do PRD já atendido; não mexer).
- `packages/client/src/assets/appearances.ts` — flags lidas para TODOS os tipos
  (`readAppearance` não distingue `kind`); `shift` (26), `height` (27) lidos; `dont_hide` (24)
  NÃO lido; `boundingSquare` lido em `FrameGroup`.
- `packages/client/src/assets/pack.ts` — `objectFlags`, `objectPattern`, `warmObjects`,
  `warmOutfit`, `framesOf`; sem `objectSize` nem `outfitDisplacement`.
- `packages/client/src/assets/catalog.ts` — `sheetFor(catalog, spriteId)` devolve a folha com
  `width`/`height` do quadro (32 ou 64) pelo `spritetype`: dimensão do quadro é SÍNCRONA, sem
  textura.
- Não existia `viewport.test.ts` antes desta issue (381). Testes de `world/` rodam em Node
  (`environment: 'node'`); o Pixi nunca era instanciado em teste.
- `things/` NÃO existe nesta máquina: verificação com sprites reais não é possível aqui; o modo
  retângulo (`pack: null`) é o que o navegador local mostra.
- Node: `.node-version` é 24; o shell padrão tem 22. Rodar `source ~/.nvm/nvm.sh && nvm use 24`
  antes de `pnpm check`.
- ADR mais recente antes deste marco: 0032 (o HUD renderizado é o contrato do jogo). O ADR desta
  iniciativa é o **0034**. (O marco nasceu como "M16" e foi renumerado para M23 em 2026-09-18,
  porque a `main` já tinha um M16 — Fidelidade ao kit — e os ADRs 0031 e 0032.)
- Proto real (`opentibiabr/otclient`, `src/protobuf/appearances.proto`, conferido em
  2026-09-17): `dont_hide = 24`, `shift = 26`, `height = 27`, `bounding_square = 7`.

## 2. Ordem, dependências e entrega

Cadeia LINEAR — cada issue nasce da branch da anterior (PR empilhada; a base da PR é a branch
anterior e o GitHub a retarget para `main` quando a anterior é mesclada):

```
381 harness → 382 windows → 383 prefetch → 384 classify → 385 spatial → 386 walking
  → 387 visibility → 388 metrics → 389 scenarios
```

Branch: `<n>-<slug>` (`gh issue develop <n> --base <branch-anterior> --name <n>-<slug>`).
Commit: `<type>(client): <descrição> (#n)`. PR com `Closes #n`, base = branch anterior.
`pnpm check` verde antes da PR. Label `em andamento` ao começar; sai ao abrir a PR.

## 3. D0 — Vocabulário de janelas (`camera.ts`)

```ts
export const RENDER_OVERSCAN_TILES = 3;
export const PREFETCH_TILES = 5;

/** A faixa de tiles que uma câmera em `target` cobre, com `margin` tiles a mais de cada lado. */
export function tileWindow(target: Point, view: Viewport, margin: number): TileWindow {
  const origin = cameraOrigin(target, view);
  return {
    minX: Math.floor(origin.x) - margin,
    minY: Math.floor(origin.y) - margin,
    // O último tile PARCIALMENTE visível: com a borda direita em 19,5 é o tile 19; em 19,0 é o 18.
    maxX: Math.ceil(origin.x + view.widthTiles) - 1 + margin,
    maxY: Math.ceil(origin.y + view.heightTiles) - 1 + margin,
  };
}
export function visibleTiles(target, view)  { return tileWindow(target, view, 0); }
export function renderTiles(target, view)   { return tileWindow(target, view, RENDER_OVERSCAN_TILES); }
export function prefetchTiles(target, view) { return tileWindow(target, view, PREFETCH_TILES); }

/** Os tiles de `next` que não estavam em `previous` (todos, quando `previous` é `null`). */
export function tilesEntering(previous: TileWindow | null, next: TileWindow): Array<{ x: number; y: number }>;
export function sameWindow(a: TileWindow, b: TileWindow): boolean;
```

`visibleTiles` muda de semântica (hoje tem margem 1 e um tile a mais na ponta): é a janela que
o jogador VÊ. `paintTerrain` passa a pintar `renderTiles`. `compareDrawOrder` sai na issue 385.

Propriedade a travar em `camera.test.ts` (é o critério CA-01 em números): numa caminhada de 30
tiles para leste (alvo `x` de 10 a 40, passo de 1), todo tile que entra em `visibleTiles` já
estava em `renderTiles` há ≥ 3 passos e em `prefetchTiles` há ≥ 5. E com a câmera fracionária
(`x = 10.5`) a janela visível não perde a coluna parcial de nenhum dos dois lados.

## 4. D1 — Modelo de camadas (`viewport.ts`)

Por andar desenhado, um `FloorLayers`:

```ts
interface FloorLayers {
  readonly z: number;
  readonly root: Container;        // filho de `floorsRoot`; posição = origem arredondada da janela (o `terrain.x/y` de hoje)
  readonly ground: Container;      // chão, bordas, itens baixos — e o `Graphics` de reserva como PRIMEIRO filho
  readonly scene: Container;       // sortableChildren = true — parede, objeto alto, criatura
  readonly top: Container;         // arcos: acima das criaturas DESTE andar
  readonly placeholder: Graphics;
}
```

Ordem no `stage`: `floorsRoot` (um `root` por andar, do mais fundo ao mais alto, na ordem de
`visibleFloors`) → `effects` → `overlay`. `effects` e `overlay` continuam globais (como hoje).
`FloorLayers` são POOL por `z` (`Map<number, FloorLayers>`): andar fora da faixa fica
`visible = false`, nunca é destruído a cada troca.

Deslocamento de perspectiva: generalizar `below` para `offset = z - floor` (negativo para andar
ACIMA). Tile do mapa `(mx, my)` no andar com `offset` aparece no tile de tela `(mx + offset,
my + offset)` — é o `transformPositionTo2D` do OTClient nos dois sentidos. Véu (`veilTint`,
`shade`) só para `offset > 0`; andar acima sem véu. Coordenadas de `spatialOrder` são as do
MAPA (cada andar tem o próprio `scene`, o offset é uniforme por andar).

Criaturas: sprite no `scene` do andar da POSIÇÃO INTERPOLADA (`interpolate(...).z`); trocar de
andar reparenta. Posição local = `toScreen(sx, sy) − root.position` (o container anda; o sprite
desliza dentro dele). Barra e nome continuam no `overlay`, ancorados ao tile (não ao quadro).

Culling (§30): criatura cujo tile de tela está fora de `renderTiles` → `sprite.visible = false`
(barra e nome também), sem destruir, sem tocar `zIndex`.

Reserva (retângulo): o placeholder do PRIMEIRO objeto da pilha vai para a camada DELE — no
`Graphics` do `ground` quando `objects[0].layer === 'ground'`; como sprite `Texture.WHITE`
32×32 tingido `shade(COLOR_WALL, offset)` no `scene`, com `sceneZIndex(mx, my, 0)`, quando
`objects[0].layer === 'scene'`. Sem pacote todas as flags são `NO_FLAGS` → tudo é `ground` →
comportamento de hoje.

## 5. D2 — Profundidade (`world/depth.ts`, novo, puro)

```ts
/** Maior que a largura útil de qualquer mapa (Thais: 184). */
export const ROW_MULTIPLIER = 10_000;
/** Vagas por tile no zIndex: itens da pilha nas 0..62, criatura na 63 (depois dos itens do MESMO tile, como o OTClient). */
export const SLOTS_PER_TILE = 64;
export const CREATURE_SLOT = SLOTS_PER_TILE - 1;

/** A ordem do pintor: sul cobre norte, e no mesmo `y` o leste cobre o oeste. */
export function spatialOrder(x: number, y: number): number { return y * ROW_MULTIPLIER + x; }

/** O `zIndex` de um sprite do `scene`: a ordem do tile, e dentro dele a vaga. */
export function sceneZIndex(x: number, y: number, slot: number): number {
  return spatialOrder(x, y) * SLOTS_PER_TILE + Math.min(CREATURE_SLOT, Math.max(0, Math.floor(slot)));
}
```

Justificativa a registrar (ADR 0034): a ordem por linha é EQUIVALENTE à ordem diagonal
(`x + y`) do OTClient para qualquer par de tiles vizinhos — que é o único par em que sprites de
64 px se sobrepõem —, e é mais barata. Máximo: `(200·10000 + 200) · 64 ≈ 1,3e8`, inteiro exato.
O Pixi só reordena quando um `zIndex` muda (`sortDirty`), e só os filhos do `scene` da janela
de render — atende RNF-04 sem ordenar o mapa inteiro.

## 6. D3 — Classificação (`tile-stack.ts`)

```ts
export type DrawLayer = 'ground' | 'scene' | 'top';

export interface ObjectInfo {
  flagsOf(appearanceId: number): AppearanceFlags;
  patternOf(appearanceId: number): Pattern;
  /** Tamanho do quadro em TILES por eixo (1 ou 2), pela folha do catálogo — síncrono. `{1,1}` sem pacote ou id desconhecido. */
  sizeOf(appearanceId: number): { readonly width: number; readonly height: number };
}

/** A camada de um ITEM (o chão é sempre `ground`). Flags primeiro; a dimensão só como reserva. */
export function layerOf(flags: AppearanceFlags, size: { width: number; height: number }): DrawLayer {
  if (flags.top) return 'top';
  if (flags.clip) return 'ground';
  if (flags.bottom || flags.unpass || flags.unsight) return 'scene';
  if (size.width > 1 || size.height > 1) return 'scene';
  return 'ground';
}
```

Regra de pilha (a que o OTClient tem de graça ao desenhar o tile inteiro numa passada): dentro de
um tile, a partir do primeiro item classificado `scene`, TODO item seguinte que não seja `top`
também é `scene` — senão o quadro pendurado na parede (`hang`, 32×32, `ground`) seria desenhado
na passada do chão, ATRÁS da parede. `DrawnObject` ganha `sceneSlot?: number` (índice do objeto
entre os `scene` do tile, na ordem de desenho, teto 62) para `sceneZIndex`.

Elevação: `scene` acumula e recebe `lift` como `ground` (é o que o OTClient faz com bottom e
comuns); `top` continua ignorando. `creatureElevation` e `blocked` inalterados.

`AssetPack.objectSize(appearanceId): { width: number; height: number }` (em TILES) — pela
primeira `spriteIds[0]` do `frameGroups[0]` e `sheetFor(catalog, id)`: `width / 32`,
`height / 32`, mínimo 1. `{1,1}` para id desconhecido ou grupo vazio.

## 7. D4 — `WorldArt` e o harness de teste (issue 381)

O viewport passa a receber uma INTERFACE, não a classe:

```ts
// world/viewport.ts
export type WorldArt = Pick<AssetPack,
  'object' | 'objectPattern' | 'objectFlags' | 'outfit' | 'framesOf'
  | 'effect' | 'effectPhases' | 'missile' | 'warmObjects' | 'warmOutfit'>;
// D3 acrescenta 'objectSize'; D7 acrescenta 'outfitDisplacement'.

export interface ViewportOptions {
  readonly pack?: WorldArt | null;
  readonly book?: TextureBook;
  readonly loadScene?: (mapId: string) => Promise<Scene | null>;
  /** O relógio do quadro. `performance.now` por padrão; o teste injeta o dele. */
  readonly now?: () => number;
}
```

`AssetPack` satisfaz `WorldArt` por estrutura; `shell/Viewport.tsx` não muda.

Arquivos do harness (sem `vitest` dentro — o `tsconfig` do cliente os checa com tipos de
navegador; `vi.mock('pixi.js', ...)` fica em cada arquivo de teste):

- `packages/client/src/world/testing/pixi-fake.ts` — `Application` (`init` resolve; `screen`;
  `renderer.on('resize')`; `stage`; `ticker.add`; `canvas`; `destroy`), `Container` (`children`,
  `addChild`, `removeChild`, `setChildIndex`, `x`, `y`, `tint`, `alpha`, `visible`, `zIndex`,
  `sortableChildren`, `scale.set`, `destroy`, `parent`), `Sprite` (`texture`, `width`, `height`,
  `roundPixels`, `anchor`), `Graphics` (encadeável `clear/rect/fill/stroke`, guarda as operações
  em `ops`), `Text` (`text`, `style`, `resolution`, `anchor`), `Texture` (`WHITE`, `from(bitmap)`
  → `{width, height, source: {scaleMode}, destroy()}`). Helper `drawOrder(container)`: os filhos
  na ordem em que o Pixi os desenharia (por `zIndex` estável quando `sortableChildren`).
- `packages/client/src/world/testing/art.ts` — `SyntheticArt implements WorldArt`: catálogo
  `{ [id]: { kind, flags?, pattern?, size? (tiles), frames? } }`; bitmaps `{ width, height,
  close() {} }` (px = tiles × 32); entrega imediata ou adiada (`latencyMs`, resolvida por
  `art.advance(nowMs)`/`art.flush()`); registra `requests` (chave, instante), `warmedObjects`,
  `warmedOutfits`.
- `packages/client/src/world/testing/harness.ts` — `mountTestViewport({ scene, art, width,
  height })` → `{ handle, app, stage, clock: { now, set(ms) }, tick(atMs), resize(w, h),
  layers(), creatureSprite(id), placeholderOps() }`, mais helpers sobre o `world` real
  (`state/world.ts`): `spawn(id, at, appearanceId)`, `step(id, from, to, atMs, durationMs)`,
  `moveSelfTo(...)`. Cena sintética: `sceneOf({ width, height, floors, tiles: Record<'x,y,z', TileStack> })`.
- `packages/client/src/world/viewport.test.ts` — os testes do comportamento DE HOJE (a rede de
  segurança das issues seguintes): monta; criatura vira sprite em `creatures`; parede em
  `terrain`; `top` em `above`; parado, o terreno repinta UMA vez em 10 quadros; sem pacote, o
  placeholder cobre a janela.

## 8. D5 — Prefetch contínuo (issue 383, `viewport.ts`)

Estado: `prefetched: { sceneId: string; floors: string; window: TileWindow; art: WorldArt } | null`
e `warmedOutfits: Set<number>` (zerado ao trocar de pacote). No ticker, a cada quadro:

1. `next = prefetchTiles(center, view)`; `floors = <andares desenhados>` (hoje
   `floorsBelow`; em 387, `visibleFloors`).
2. Se cena, pacote ou lista de andares mudou, ou `prefetched === null`: aquecer TODOS os tiles de
   `next` em todos os `floors`.
3. Senão, se `!sameWindow(prefetched.window, next)`: aquecer só `tilesEntering(prefetched.window, next)`.
4. Outfits: toda criatura cuja posição cai em `next` e cujo `appearanceId` não está em
   `warmedOutfits` → `art.warmOutfit(id)`; marcar.

`warm(next: Scene)` e as chamadas dele em `setScene`, `setPack` e no `.then` do `loadScene`
saem; no lugar, `prefetched = null`. O `resize` também zera (`zoom`/`view` mudam).

Ids a aquecer: `ground > 0` e `items[].id` de `scene.tileAt(x, y, z)` para cada tile e andar.
Custo por passo: altura da janela × andares — dezenas de tiles, nunca a janela inteira.

## 9. D6 — Walking tile (issue 386, `world/walking-tile.ts`, novo, puro)

Regra do `Creature::updateWalkingTile()` do OTClient, em números (lida, não copiada):
a posição LÓGICA da criatura durante o passo é o DESTINO; `walkOffset` é a distância em pixels
até ele; o corpo virtual é um quadrado de 32×32 em `(32 + walkOffset − displacement)` dentro de
uma grade virtual de 3×3 tiles centrada no destino; o walking tile é o tile dessa grade que
contém o CANTO INFERIOR DIREITO desse quadrado.

```ts
export interface WalkingTileInput {
  /** `interpolate(creature, nowMs)`, em tiles fracionários. */
  readonly position: { readonly x: number; readonly y: number };
  /** O tile lógico: `step.to` durante o passo; parada, o próprio tile. */
  readonly logical: { readonly x: number; readonly y: number };
  /** `AppearanceFlagShift` do outfit, em px; `{0,0}` quando o pacote não traz. */
  readonly displacement: { readonly x: number; readonly y: number };
}

export function walkingTile({ position, logical, displacement }: WalkingTileInput): { x: number; y: number } {
  // O passo anda em pixels inteiros na tela (`roundPixels`); o offset também.
  const wx = Math.round((position.x - logical.x) * TILE);
  const wy = Math.round((position.y - logical.y) * TILE);
  const cornerX = TILE + wx - displacement.x + TILE - 1;
  const cornerY = TILE + wy - displacement.y + TILE - 1;
  const dx = Math.min(1, Math.max(-1, Math.floor(cornerX / TILE) - 1));
  const dy = Math.min(1, Math.max(-1, Math.floor(cornerY / TILE) - 1));
  return { x: logical.x + dx, y: logical.y + dy };
}
```

Consequência, com displacement `(8, 8)` e os instantes de captura do PRD (0/25/50/75/100 %):
leste e sul → origem em 0 % e 25 %, destino de 50 % em diante (troca em `t ≥ 9/32`); norte e
oeste → origem até 50 %, destino em 75 % e 100 % (troca em `t ≥ 24/32`). Diagonal: cada eixo
pela própria regra. `spriteSize` NÃO entra: com âncora inferior direita (§18) o canto inferior
direito não depende do tamanho do quadro — e é isso que o OTClient faz.

`AssetPack.outfitDisplacement(outfitId): { x: number; y: number }` — `shiftX/shiftY` das flags
do outfit (`#appearances.outfit.get(id)?.flags`), `{0,0}` sem. Entra em `WorldArt`.

No viewport: `zIndex` da criatura = `sceneZIndex(walking.x, walking.y, CREATURE_SLOT)`; o
sprite é desenhado deslocado `−displacement` (§19; é o `−m_displacement` do `ThingType::draw`);
barra e nome continuam ancorados ao tile. A assinatura `ordered`/`reorder` já saiu na 385.

## 10. D7 — Visibilidade de andares (issue 387, `world/visibility.ts`, novo, puro)

Regra do `MapView::calcFirstVisibleFloor` / `calcLastVisibleFloor` e `Tile::limitsFloorsView`
do OTClient, em números (lida, não copiada):

```ts
export const SEA_FLOOR = SURFACE_FLOOR;         // 7, de floors.ts
export const UNDERGROUND_FLOOR = 8;
export const AWARE_UNDERGROUND_FLOOR_RANGE = 2;
export const MAX_Z = 15;
export const FLOOR_FADE_MS = 250;

export interface FloorView { tileAt(x: number, y: number, z: number): TileStack | null; }   // `Scene` satisfaz
export interface VisibilityInfo { flagsOf(appearanceId: number): AppearanceFlags; }         // `ObjectInfo` satisfaz

/** Nada no tile bloqueia a vista (`unsight`), e há tile. */
export function lookPossible(stack: TileStack | null, info: VisibilityInfo): boolean;

/**
 * O tile limita a vista dos andares acima: a "primeira coisa" dele (o chão; sem chão, o item de
 * menor prioridade — clip, depois bottom, depois top, depois comum) é chão ou `bottom` (com
 * vista livre), ou chão ou `bottom` + `unsight` (sem vista livre) — e não é `dontHide`.
 */
export function limitsFloorsView(stack: TileStack, freeView: boolean, info: VisibilityInfo): boolean;

/**
 * Superfície: começa em 0 (tudo acima visível); subsolo: `max(z − 2, 8)`. Depois, nos 3×3 em
 * volta do jogador — o centro sempre, os ortogonais só com vista livre —, sobe andar a andar
 * enquanto `z ≥ first`: o tile FISICAMENTE acima `(x, y, z−1)` limita com `!lookPossible`, o
 * GEOMETRICAMENTE acima `(x+1, y+1, z−1)` limita com `lookPossible`; o primeiro que limitar põe
 * `first = z + 1`. Resultado preso a `[0, MAX_Z]`.
 */
export function firstVisibleFloor(scene: FloorView, player: Point, info: VisibilityInfo): number;
/** Superfície: 7; subsolo: `min(z + 2, MAX_Z)`. */
export function lastVisibleFloor(playerZ: number): number;
/** Os andares da cena em `[first, last]`, do mais fundo ao mais alto — a ordem de pintura. Substitui `floorsBelow`. */
export function visibleFloors(sceneFloors: readonly number[], first: number, last: number): number[];

export interface FloorFade { readonly first: number; readonly previous: number; readonly since: number; }
/** 1 visível, 0 escondido; entre `previous` e `first` faz a rampa linear de `FLOOR_FADE_MS` a partir de `since`. */
export function floorAlpha(z: number, fade: FloorFade, nowMs: number): number;
```

`(x+1, y+1, z−1)` é o `coveredUp` do OTClient: com o andar de cima desenhado um tile para cima e
para a esquerda (D1), o tile que cobre a posição de tela do jogador é o `(x+1, y+1)` do andar
acima. O jogador para a conta é a posição LÓGICA (`creature.position`, que `apply.ts` já põe no
destino ao receber o passo); o fade suaviza a troca.

`floors.ts` perde `floorsBelow` (os testes migram para `visibility.test.ts`: superfície sem
cobertura → todos os andares ≤ 7; subsolo → `[z−2, z+2] ∩ cena`, nunca a rua). `SURFACE_FLOOR`,
`VEIL_PER_FLOOR`, `veilTint`, `shade` ficam. `AppearanceFlags` ganha `dontHide: boolean`
(campo 24; `NO_FLAGS.dontHide = false`; `FlagsFixture.dontHide` em `assets/testing.ts`).

No viewport: `root.alpha = floorAlpha(...)`; andar com alpha 0 fica `visible = false`; criatura
em andar acima do jogador passa a ser desenhada (hoje `below < 0` esconde), sem véu.

## 11. D8 — Métricas (issue 388)

```ts
export interface ViewportStats {
  readonly renderedTiles: number;     // tiles pintados na última repintura (todos os andares)
  readonly prefetchedIds: number;     // ids acumulados passados a warmObjects desde a montagem
  readonly sceneSprites: number;      // filhos visíveis somados dos `scene` de todos os andares
  readonly textureHits: number;       // TextureBook.get que devolveu Texture
  readonly textureMisses: number;     // TextureBook.get que disparou pedido
  readonly terrainRepaints: number;
  readonly frames: number;
  readonly lastFrameMs: number;       // duração do último ticker, medida com `now()`
}
```

`ViewportHandle.stats(): ViewportStats`; `TextureBook` ganha `hits`/`misses`;
`shell/Viewport.tsx` publica `window.__draconya = { renderStats }` só em `import.meta.env.DEV`.

## 12. D9 — Cenários (issue 389)

`packages/client/src/world/scenarios.test.ts`, um `describe` por cenário com os NOMES do PRD:
`01-walk-open-field` … `10-fast-continuous-walk`, todos sobre o harness (D4) e a arte
sintética com latência. Não são pixels: são as decisões que o renderer tomou (camada, `zIndex`,
alpha, pedidos de textura), que é o que dá para prender em CI sem o pacote de arte. Screenshots
com sprites reais ficam como verificação manual documentada em `packages/client/AGENTS.md`
(quando `things/` existir), e são o critério de aceite humano do milestone.

## 13. O que NÃO muda (para nenhuma issue crescer)

- `facing.ts`/`walkFrame`: a animação já é por progresso do passo (§22, §23 atendidos).
- `liftOf`: a elevação já interpola no passo (§21 atendido); a issue 385 só a preserva e testa.
- `effects`, `overlay`, `paintEffects`, `paintMissiles`, `paintTexts`: fora do escopo.
- `state/world.ts`, `apply.ts`, protocolo, servidor, `sim`, `content`: intocados.
- `walls.ts`: intocado; `walls.test.ts` só ganha o teste de que a peça de parede da cena sintética
  sai como `scene` pelo `drawTile` (issue 384).

## 14. Issues do milestone

| Chave | Título | Issue | Depende de |
|---|---|---|---|
| A | Viewport — harness de teste: Pixi falso, arte sintética e laço de quadro dirigido | [#381](https://github.com/funkcaipora/draconya/issues/381) | — (nasce de `main`) |
| B | Janelas de câmera e overscan (`camera.ts`) | #382 | 381 |
| C | Prefetch contínuo (`viewport.ts`) | #383 | 382 |
| D | Classificação da pilha em três camadas (`tile-stack.ts`) | #384 | 383 |
| E | Mundo espacial: `FloorLayers`, profundidade e painter order | #385 | 384 |
| F | Walking tile e deslocamento de outfit | #386 | 385 |
| G | Visibilidade de andares | #387 | 386 |
| H | Métricas do viewport | #388 | 387 |
| I | Cenários de ponta a ponta | #389 | 388 |

## 15. Invariantes em jogo

| # | Invariante | Como o marco o respeita |
|---|---|---|
| 3 | O resultado da simulação não depende de haver alguém assistindo | O renderer só LÊ `world`; o harness (381) escreve nele o que `apply.ts` escreveria a partir de mensagens do servidor (`spawn`, `step`), nunca resultado inventado pelo desenho |
| 4 | O cliente só manda intenção | Nenhuma issue do marco importa `net/` em `world/` ou em `world/testing/`; o renderer não manda mensagem nenhuma |
| 6 | `content/` nunca contém arte | A arte sintética (381) vive em `packages/client/src/world/testing/`, e os ids continuam ids: `content/` não é tocado por nenhuma issue do marco |
| ADR 0007 (local) | Nenhum `useEffect`/estado React no laço de quadro | `shell/Viewport.tsx` não muda em nenhuma issue do marco; `viewport.ts` continua lendo `world` direto no ticker |

**Referência de domínio (ADR 0019):** as regras numéricas deste plano vêm do OTClient
(`opentibiabr/otclient`, MIT) — lidas, nunca copiadas em código — e do PRD de renderização
citado acima. Nenhuma issue do marco lê ou copia o Remere's Map Editor (GPL) nem qualquer outro
material sob licença incompatível.
