// O harness de teste do viewport (issue #381): monta `mountViewport` sobre o Pixi falso,
// dirige o laço de quadro por um relógio injetado e expõe as decisões estruturais que os testes
// afirmam — container, sprite, textura, ops do `Graphics` — sem GPU, sem DOM e sem
// `requestAnimationFrame`. Não importa `vitest`: é checado pelo tsconfig de navegador do
// cliente (`packages/client/AGENTS.md`, "Armadilhas conhecidas").
//
// O ponto delicado é `tick`: o `TextureBook` resolve pedidos em `.then` (microtask), então
// "entregar" um bitmap só vira `Texture` DEPOIS de o quadro corrente acabar — ver DT-07 na
// issue #381.

import {
  clearTransients, world, type Creature, type Point,
} from '../../state/world.js';
import { mountViewport, type ViewportHandle } from '../viewport.js';
import { floorsBelow } from '../floors.js';
import type { Scene, TileStack } from '../scene.js';
import {
  lastApplication, type Application, type Container, type Graphics, type GraphicsOp, type Sprite,
} from './pixi-fake.js';
import type { SyntheticArt } from './art.js';

export interface TestClock {
  now(): number;
  set(ms: number): void;
}

/** Um relógio que começa em `startMs` (0 por padrão). */
export function testClock(startMs = 0): TestClock {
  let ms = startMs;
  return {
    now: () => ms,
    set: (next) => { ms = next; },
  };
}

export interface SceneSpec {
  readonly width: number;
  readonly height: number;
  readonly floors: readonly number[];
  /** Pilha por tile, chave `'x,y,z'`. Sobrepõe `fill`. */
  readonly tiles?: Readonly<Record<string, TileStack>>;
  /** Pilha para TODO tile de um andar (chave = z). */
  readonly fill?: Readonly<Record<number, TileStack>>;
}

/** Uma `Scene` sintética: `id: 'synthetic'`, `defaultZ` = maior andar, `tileAt` fora do mapa → `null`. */
export function sceneOf(spec: SceneSpec): Scene {
  const floors = [...spec.floors].sort((a, b) => a - b);
  return {
    id: 'synthetic',
    width: spec.width,
    height: spec.height,
    floors,
    defaultZ: floors[floors.length - 1] ?? 7,
    tileAt(x, y, z) {
      if (x < 0 || y < 0 || x >= spec.width || y >= spec.height) return null;
      return spec.tiles?.[`${x},${y},${z}`] ?? spec.fill?.[z] ?? null;
    },
  };
}

export interface MountOptions {
  readonly scene?: Scene | null;
  /** `null`/ausente = modo retângulo (`pack: null`). */
  readonly art?: SyntheticArt | null;
  /** Tamanho do "elemento" em px. 576×448 por padrão → zoom 1, vista 18×14 (`zoomFor`/`viewFor`). */
  readonly width?: number;
  readonly height?: number;
  /** O relógio; um `testClock()` novo se ausente. Passe o MESMO à `SyntheticArt`. */
  readonly clock?: TestClock;
}

/** A raiz dos andares e os dois containers globais de HOJE, na ordem de `stage.children` (ADR 0033). */
export interface Layers {
  readonly floorsRoot: Container;
  readonly effects: Container;
  readonly overlay: Container;
}

/** As três camadas de UM andar, mais o `Graphics` de reserva (filho 0 de `ground`). */
export interface FloorLayerView {
  readonly ground: Container;
  readonly scene: Container;
  readonly top: Container;
  readonly fallback: Graphics;
}

export interface TestViewport {
  readonly handle: ViewportHandle;
  readonly app: Application;
  readonly stage: Container;
  readonly clock: TestClock;
  /** Um quadro em `atMs`: relógio → `art.advance` → microtasks → ticker → microtasks → sincroniza `creatureSprite`. */
  tick(atMs: number): Promise<void>;
  /** Dispara o `renderer.on('resize')` com o novo tamanho. */
  resize(width: number, height: number): void;
  layers(): Layers;
  /** Os andares desenhados agora, do fundo ao topo — a ordem de `floorsRoot.children`. */
  drawnFloors(): number[];
  /** As camadas de UM andar desenhado (a ordem de `floorsRoot.children`). */
  floorLayers(z: number): FloorLayerView;
  /** O sprite de uma criatura, ou `undefined` antes do primeiro `tick` que a viu. */
  creatureSprite(id: number): Sprite | undefined;
  /** Quantos sprites de criatura o harness já casou — constante quando ninguém nasce/morre. */
  creatureCount(): number;
  /** As operações do `Graphics` de reserva do andar do jogador desde o último `clear()`. */
  placeholderOps(): readonly GraphicsOp[];
  /** Quantas vezes o `Graphics` de reserva foi limpo — uma por repintura do terreno. */
  placeholderClears(): number;

  // ---- escrevem no `world` real, como `apply.ts` faria ----
  spawn(id: number, at: Point, appearanceId?: number): Creature;
  /** `spawn` + `world.selfId = id`. */
  spawnSelf(id: number, at: Point, appearanceId?: number): Creature;
  /** `creature.position = to; creature.step = { from, to, startedAtMs: atMs, durationMs, pushed: false }` — o que `apply.ts` faz. */
  step(id: number, from: Point, to: Point, atMs: number, durationMs: number): void;
  /** Teleporta o self (posição direta, `step = null`). */
  moveSelfTo(at: Point): void;
}

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

export async function mountTestViewport(options: MountOptions = {}): Promise<TestViewport> {
  const clock = options.clock ?? testClock();
  const art = options.art ?? null;
  const width = options.width ?? 576;
  const height = options.height ?? 448;
  // O "elemento": o Pixi falso lê `clientWidth`/`clientHeight` no `init`; `appendChild` é o que
  // `mountViewport` chama.
  const parent = {
    clientWidth: width, clientHeight: height, appendChild(): void {},
  } as unknown as HTMLElement;

  const handle = await mountViewport(parent, { pack: art, now: clock.now });
  const app = lastApplication();
  if (app === null) {
    throw new Error(
      "pixi-fake não está ativo: o arquivo de teste precisa de vi.mock('pixi.js', () => import('./testing/pixi-fake.js'))",
    );
  }

  // O harness segue a cena para saber a ordem de `floorsRoot.children` (que é a de `floorsBelow`)
  // sem tocar no viewport. `setScene` é envolvido porque os testes de #383 o chamam direto.
  let currentScene: Scene | null = null;
  const setScene = handle.setScene.bind(handle);
  handle.setScene = (next) => { currentScene = next; setScene(next); };
  if (options.scene !== undefined) handle.setScene(options.scene);

  const known = new Map<number, Sprite>();

  const layers = (): Layers => {
    const [floorsRoot, effects, overlay] = app.stage.children;
    if (overlay === undefined) throw new Error('harness: o stage não tem floorsRoot/effects/overlay');
    return { floorsRoot: floorsRoot as Container, effects: effects as Container, overlay };
  };

  /** O andar do jogador (posição LÓGICA do self; `defaultZ` quando não há self ainda). */
  const playerFloor = (): number => {
    const self = world.selfId === null ? undefined : world.creatures.get(world.selfId);
    return self === undefined ? (currentScene?.defaultZ ?? 0) : Math.round(self.position.z);
  };

  const drawnFloors = (): number[] => {
    const floor = playerFloor();
    return currentScene === null ? [floor] : floorsBelow(currentScene.floors, floor);
  };

  const floorLayers = (z: number): FloorLayerView => {
    const floors = drawnFloors();
    const index = floors.indexOf(z);
    if (index < 0) throw new Error(`harness: andar ${z} não está desenhado (${floors.join(',')})`);
    const [ground, scene, top] = layers().floorsRoot.children.slice(index * 3, index * 3 + 3);
    if (ground === undefined || scene === undefined || top === undefined) {
      throw new Error('harness: floorsRoot não tem as três camadas do andar');
    }
    return { ground, scene, top, fallback: ground.children[0] as Graphics };
  };

  const placeholder = (): Graphics => floorLayers(playerFloor()).fallback;

  /** Os sprites dos `scene` dos andares ANEXADOS — é onde objeto e criatura moram desde #385. */
  const sceneSprites = (): Sprite[] => {
    const result: Sprite[] = [];
    for (const container of layers().floorsRoot.children) {
      if (container.sortableChildren) result.push(...(container.children as Sprite[]));
    }
    return result;
  };

  /**
   * Casa sprite com id SEM tocar no viewport. Desde #385 objeto e criatura dividem o `scene` do
   * andar, e os de objeto nascem antes dos de criatura no mesmo quadro (`paintTerrain` roda
   * antes de `paintCreatures`): entre os sprites criados NESTE quadro (`before` é o retrato de
   * antes do ticker), os últimos `newIds.length` por `seq` são as criaturas. `Container.seq`
   * (`pixi-fake.ts`) é a ordem de CRIAÇÃO.
   */
  const syncCreatureSprites = (before: ReadonlySet<Container>): void => {
    for (const [id, sprite] of known) if (sprite.destroyed) known.delete(id);
    const fresh = sceneSprites().filter((child) => !before.has(child)).sort((a, b) => a.seq - b.seq);
    const newIds = [...world.creatures.keys()].filter((id) => {
      if (known.has(id)) return false;
      const creature = world.creatures.get(id);
      return creature !== undefined && drawnFloors().includes(Math.round(creature.position.z));
    });
    if (fresh.length < newIds.length) {
      throw new Error(`harness: ${fresh.length} sprites novos para ${newIds.length} criaturas novas`);
    }
    const creatureSprites = fresh.slice(fresh.length - newIds.length);
    newIds.forEach((id, index) => known.set(id, creatureSprites[index] as Sprite));
  };

  const spawnCreature = (id: number, at: Point, appearanceId = 0): Creature => {
    const creature: Creature = {
      id, appearanceId, name: `c${id}`, health: 100, maxHealth: 100, position: { ...at }, step: null,
    };
    world.creatures.set(id, creature);
    return creature;
  };

  return {
    handle,
    app,
    stage: app.stage,
    clock,
    async tick(atMs) {
      clock.set(atMs);
      art?.advance(atMs); // resolve as promessas devidas…
      await flushMicrotasks(); // …e deixa o `.then` do TextureBook guardar a Texture ANTES do quadro
      const before = new Set<Container>(sceneSprites());
      for (const callback of app.ticker.callbacks) callback();
      await flushMicrotasks(); // os pedidos disparados NESTE quadro (arte imediata) chegam ao livro para o PRÓXIMO
      syncCreatureSprites(before);
    },
    resize(w, h) {
      app.screen.width = w;
      app.screen.height = h;
      app.renderer.emit('resize', w, h);
    },
    layers,
    drawnFloors,
    floorLayers,
    creatureSprite: (id) => known.get(id),
    creatureCount: () => known.size,
    placeholderOps: () => placeholder().ops,
    placeholderClears: () => placeholder().clears,
    spawn: spawnCreature,
    spawnSelf(id, at, appearanceId = 0) {
      const creature = spawnCreature(id, at, appearanceId);
      world.selfId = id;
      return creature;
    },
    step(id, from, to, atMs, durationMs) {
      const creature = world.creatures.get(id);
      if (creature === undefined) throw new Error(`harness: criatura ${id} não existe`);
      creature.position = { ...to };
      creature.step = { from: { ...from }, to: { ...to }, startedAtMs: atMs, durationMs, pushed: false };
    },
    moveSelfTo(at) {
      const self = world.selfId === null ? undefined : world.creatures.get(world.selfId);
      if (self === undefined) throw new Error('harness: não há self');
      self.position = { ...at };
      self.step = null;
    },
  };
}

/** Zera `world` (criaturas, selfId, mapId, transitórios, itens do chão) — para o `beforeEach`. */
export function resetWorld(): void {
  world.creatures.clear();
  world.groundItems.clear();
  world.groundItemsVersion += 1;
  world.selfId = null;
  world.instanceId = null;
  world.mapId = null;
  world.ambience = 'surface';
  clearTransients();
}
