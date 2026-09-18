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

/** Os cinco containers de HOJE, na ordem de `stage.children`. */
export interface Layers {
  readonly terrain: Container;
  readonly creatures: Container;
  readonly above: Container;
  readonly effects: Container;
  readonly overlay: Container;
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
  /** O sprite de uma criatura, ou `undefined` antes do primeiro `tick` que a viu. */
  creatureSprite(id: number): Sprite | undefined;
  /** As operações do `Graphics` de reserva (primeiro filho de `terrain`) desde o último `clear()`. */
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
  if (options.scene !== undefined) handle.setScene(options.scene);

  const known = new Map<number, Sprite>();
  const layers = (): Layers => {
    const [terrain, creatures, above, effects, overlay] = app.stage.children;
    if (overlay === undefined) throw new Error('harness: o stage não tem os cinco containers de hoje');
    return {
      terrain: terrain as Container,
      creatures: creatures as Container,
      above: above as Container,
      effects: effects as Container,
      overlay,
    };
  };
  const placeholder = (): Graphics => layers().terrain.children[0] as Graphics;

  /**
   * Casa sprite com id SEM tocar no viewport: `paintCreatures` cria os sprites que faltam na
   * ordem de `world.creatures` (Map, ordem de inserção), os põe em `creatures` (`viewport.ts`)
   * e SÓ DEPOIS chama `reorder`, que reordena `creatures.children` por posição de TELA — no
   * mesmo quadro em que a criatura nasceu. Casar pela posição do filho no array (a ordem depois
   * do `reorder`) casa errado sempre que duas criaturas nascem no mesmo quadro em posições que
   * não empatam com a ordem de `world.creatures` (issue #381, achado 2 — reproduzido: duas
   * criaturas na mesma janela saem com o sprite trocado, sem lançar). `Container.seq`
   * (`pixi-fake.ts`) é a ordem de CRIAÇÃO, que `reorder` não toca — casar por ela é o que
   * sobrevive ao reorder do próprio quadro.
   */
  const syncCreatureSprites = (): void => {
    for (const [id, sprite] of known) if (sprite.destroyed) known.delete(id);
    const seen = new Set(known.values());
    const fresh = (layers().creatures.children.filter((child) => !seen.has(child as Sprite)) as Sprite[])
      .sort((a, b) => a.seq - b.seq);
    const newIds = [...world.creatures.keys()].filter((id) => !known.has(id));
    if (fresh.length !== newIds.length) {
      throw new Error(`harness: ${fresh.length} sprites novos para ${newIds.length} criaturas novas`);
    }
    newIds.forEach((id, index) => known.set(id, fresh[index] as Sprite));
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
      for (const callback of app.ticker.callbacks) callback();
      await flushMicrotasks(); // os pedidos disparados NESTE quadro (arte imediata) chegam ao livro para o PRÓXIMO
      syncCreatureSprites();
    },
    resize(w, h) {
      app.screen.width = w;
      app.screen.height = h;
      app.renderer.emit('resize', w, h);
    },
    layers,
    creatureSprite: (id) => known.get(id),
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
