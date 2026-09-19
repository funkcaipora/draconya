// O Pixi falso: a superfície que `viewport.ts` e `textures.ts` usam, e nada além (issue #381).
//
// Grava o que recebe para o teste afirmar DECISÕES — em que container um sprite caiu, o
// `zIndex`, a textura, as operações do `Graphics` — sem GPU e sem DOM. `vi.mock('pixi.js', ()
// => import('./pixi-fake.js'))` fica em cada arquivo de teste; este arquivo não importa
// `vitest` nem `pixi.js`: é checado pelo tsconfig de navegador do cliente (ver
// `packages/client/AGENTS.md`, "Armadilhas conhecidas").
//
// O critério de cada classe é "o que `viewport.ts` e `textures.ts` chamam", não "o que o Pixi
// tem" — ver a issue #381, seção "Estado atual do código".

/**
 * Ordem de CRIAÇÃO dos containers — nunca muda com `addChild`/`setChildIndex`. Só o harness lê
 * `Container.seq` (issue #381, achado 2): desde #385 os sprites de criatura e de objeto dividem
 * o `scene` do andar, então a posição de um sprite no array de filhos não é "a ordem em que
 * nasceu" — e é essa ordem que `syncCreatureSprites` (`harness.ts`) precisa para casar sprite
 * novo com id novo.
 */
let nextSeq = 0;

export class Container {
  readonly children: Container[] = [];
  readonly seq = nextSeq++;
  parent: Container | null = null;
  x = 0;
  y = 0;
  alpha = 1;
  visible = true;
  tint = 0xffffff;
  zIndex = 0;
  sortableChildren = false;
  label = '';
  roundPixels = false;
  destroyed = false;
  readonly scale = {
    x: 1,
    y: 1,
    set: (value: number): void => { this.scale.x = value; this.scale.y = value; },
  };

  addChild<T extends Container>(...items: T[]): T {
    for (const item of items) {
      item.parent?.removeChild(item);
      item.parent = this;
      this.children.push(item);
    }
    return items[0] as T;
  }

  removeChild(child: Container): void {
    const at = this.children.indexOf(child);
    if (at >= 0) {
      this.children.splice(at, 1);
      child.parent = null;
    }
  }

  /** Como o Pixi: devolve os filhos removidos, todos desligados do pai. */
  removeChildren(): Container[] {
    const removed = [...this.children];
    for (const child of removed) child.parent = null;
    this.children.length = 0;
    return removed;
  }

  /**
   * Como o Pixi real (`childrenHelperMixin`): valida o índice contra o tamanho ATUAL, e então
   * exige que `child` já seja filho deste container — lança, e não adota, quando não é. Sem
   * isso um sprite de OUTRO container seria puxado para cá em silêncio (`removeChild` é no-op
   * fora daqui) e ficaria em dois `children` ao mesmo tempo — o defeito que a issue #381
   * (achado 1) achou: `reorder` (`viewport.ts`) chamando `setChildIndex` num sprite errado não
   * acusaria nada.
   */
  setChildIndex(child: Container, index: number): void {
    if (index < 0 || index >= this.children.length) {
      throw new Error(`setChildIndex: índice ${index} fora dos limites (${this.children.length})`);
    }
    const at = this.children.indexOf(child);
    if (at < 0) {
      throw new Error('setChildIndex: o filho precisa pertencer a este container');
    }
    if (at === index) return;
    this.children.splice(at, 1);
    this.children.splice(index, 0, child);
  }

  destroy(options?: boolean | { children?: boolean }): void {
    this.destroyed = true;
    this.parent?.removeChild(this);
    const deep = options === true || (typeof options === 'object' && options.children === true);
    if (deep) for (const child of [...this.children]) child.destroy(options);
  }
}

export class Texture {
  static readonly WHITE: Texture = new Texture(null, 1, 1);

  /** O bitmap de origem — é como o teste liga uma textura ao pedido que a criou. */
  readonly source: { scaleMode: 'linear' | 'nearest'; readonly resource: unknown };
  destroyed = false;

  constructor(resource: unknown, readonly width: number, readonly height: number) {
    this.source = { scaleMode: 'linear', resource };
  }

  /**
   * `Texture.from(bitmap)`: as dimensões vêm do bitmap, como no Pixi. É `instanceof Texture` —
   * `viewport.ts` e `textures.ts` conferem isso antes de desenhar.
   */
  static from(bitmap: { readonly width: number; readonly height: number }): Texture {
    return new Texture(bitmap, bitmap.width, bitmap.height);
  }

  destroy(_destroySource?: boolean): void { this.destroyed = true; }
}

export class Sprite extends Container {
  texture: Texture;
  width: number;
  height: number;
  readonly anchor = {
    x: 0,
    y: 0,
    set: (x: number, y = x): void => { this.anchor.x = x; this.anchor.y = y; },
  };

  constructor(texture: Texture = Texture.WHITE) {
    super();
    this.texture = texture;
    this.width = texture.width;
    this.height = texture.height;
  }
}

export class Graphics extends Container {
  /** As operações desde o último `clear()`. */
  ops: GraphicsOp[] = [];
  /** Quantas vezes `clear()` rodou — o viewport limpa uma vez por repintura do terreno. */
  clears = 0;

  clear(): this {
    this.ops = [];
    this.clears += 1;
    return this;
  }

  rect(x: number, y: number, width: number, height: number): this {
    this.ops.push({ kind: 'rect', x, y, width, height });
    return this;
  }

  fill(color: number): this {
    this.ops.push({ kind: 'fill', color });
    return this;
  }

  stroke(options: { width: number; color: number; alignment?: number }): this {
    this.ops.push({ kind: 'stroke', width: options.width, color: options.color });
    return this;
  }
}

export class Text extends Container {
  text: string;
  readonly style: { fill: number; fontFamily?: string; fontSize?: number; fontWeight?: string };
  readonly resolution: number;
  readonly anchor: { x: number; y: number };

  constructor(options: {
    text: string;
    style: Text['style'];
    resolution?: number;
    roundPixels?: boolean;
    anchor?: { x: number; y: number };
  }) {
    super();
    this.text = options.text;
    this.style = { ...options.style };
    this.resolution = options.resolution ?? 1;
    this.anchor = { ...(options.anchor ?? { x: 0, y: 0 }) };
  }
}

export class Application {
  readonly stage = new Container();
  readonly screen = { width: 0, height: 0 };
  readonly canvas = {};
  readonly ticker = {
    /** O medidor de FPS (`world/fps.ts`) lê isto a cada quadro; 16 ms por padrão (~60 Hz). */
    deltaMS: 16,
    callbacks: [] as Array<() => void>,
    add: (callback: () => void): void => { this.ticker.callbacks.push(callback); },
  };

  readonly renderer = {
    listeners: new Map<string, Array<(...args: number[]) => void>>(),
    on: (event: string, handler: (...args: number[]) => void): void => {
      const list = this.renderer.listeners.get(event) ?? [];
      list.push(handler);
      this.renderer.listeners.set(event, list);
    },
    /** O harness chama isto em `resize(w, h)`. */
    emit: (event: string, ...args: number[]): void => {
      for (const handler of this.renderer.listeners.get(event) ?? []) handler(...args);
    },
  };

  destroyed = false;

  constructor() { last = this; }

  /** `resizeTo` é lido como o Pixi lê: `clientWidth`/`clientHeight` do elemento. */
  async init(options: { resizeTo?: { clientWidth: number; clientHeight: number } }): Promise<void> {
    this.screen.width = options.resizeTo?.clientWidth ?? 0;
    this.screen.height = options.resizeTo?.clientHeight ?? 0;
  }

  destroy(_removeView?: boolean, options?: { children?: boolean }): void {
    this.destroyed = true;
    if (options?.children === true) this.stage.destroy({ children: true });
  }
}

let last: Application | null = null;

/** A última `Application` construída — é como o harness chega ao `stage` que `mountViewport` não devolve. */
export function lastApplication(): Application | null { return last; }

export type GraphicsOp =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'fill'; readonly color: number }
  | { readonly kind: 'stroke'; readonly width: number; readonly color: number };

/**
 * Os filhos na ordem em que o Pixi os DESENHARIA: por `zIndex` (estável) quando
 * `sortableChildren`, senão a ordem de inserção.
 */
export function drawOrder(container: Container): readonly Container[] {
  if (!container.sortableChildren) return [...container.children];
  // `Array.prototype.sort` é estável desde ES2019: mesmo `zIndex` mantém a ordem de inserção,
  // como o Pixi.
  return [...container.children].sort((a, b) => a.zIndex - b.zIndex);
}
