// A arte sintética: um catálogo de aparências de teste que satisfaz `WorldArt` (issue #381).
//
// Entrega bitmaps imediatos ou com latência controlada, e registra tudo o que pediram a ela —
// é o que permite ao teste afirmar "a criatura pediu este quadro" sem tocar em `pixi.js` nem
// em rede. Não importa `vitest`: é checado pelo tsconfig de navegador do cliente.

import { NO_FLAGS, type AppearanceFlags } from '../../assets/appearances.js';
import type { Sprite as Bitmap } from '../../assets/bitmap-budget.js';
import type { Direction } from '../../assets/pack.js';
import type { OutfitColors } from '../../assets/outfit.js';
import type { WorldArt } from '../viewport.js'; // `import type`: não puxa pixi.js

export type SyntheticKind = 'object' | 'outfit' | 'effect' | 'missile';

/** Uma aparência do catálogo sintético. Tudo opcional; o default é o objeto mais simples possível. */
export interface SyntheticAppearance {
  readonly kind: SyntheticKind;
  readonly flags?: Partial<AppearanceFlags>;
  /** Padrão do objeto; `{1,1}` por padrão. */
  readonly pattern?: { readonly width: number; readonly height: number };
  /** Tamanho do quadro em TILES; `{1,1}` por padrão. O bitmap tem `size × 32` px. */
  readonly size?: { readonly width: number; readonly height: number };
  /** Quadros do ciclo (outfit): um número para parado e andando, ou um por estado. 1 por padrão. */
  readonly frames?: number | { readonly idle: number; readonly walking: number };
  /** Durações das fases (efeito), em ms; `[]` por padrão → o viewport usa `FALLBACK_EFFECT_PHASES`. */
  readonly phases?: readonly number[];
}

export type SyntheticCatalog = Readonly<Record<number, SyntheticAppearance>>;

export interface SyntheticArtOptions {
  /** Atraso entre o pedido e a entrega do bitmap. 0 = entrega no mesmo `advance`/microtask. */
  readonly latencyMs?: number;
  /** O relógio com que `requests[].at` é carimbado e `advance` é comparado. */
  readonly now?: () => number;
}

/** Um pedido registrado: a chave (nome desta spec, formato abaixo) e o instante do pedido. */
export interface ArtRequest { readonly key: string; readonly at: number }

const TILE_PX = 32;

export class SyntheticArt implements WorldArt {
  readonly #catalog: SyntheticCatalog;
  readonly #latencyMs: number;
  readonly #now: () => number;
  readonly #bitmaps = new Map<string, Bitmap>();
  readonly #pending: Array<{ due: number; deliver: () => void }> = [];
  readonly requests: ArtRequest[] = [];
  readonly warmedObjects: Array<readonly number[]> = [];
  readonly warmedOutfits: number[] = [];

  constructor(catalog: SyntheticCatalog, options: SyntheticArtOptions = {}) {
    this.#catalog = catalog;
    this.#latencyMs = options.latencyMs ?? 0;
    this.#now = options.now ?? (() => 0);
  }

  // ---- WorldArt ----

  object(appearanceId: number, x = 0, y = 0): Promise<Bitmap | null> {
    return this.#frame('object', appearanceId, `object:${appearanceId}:${x}:${y}`);
  }

  objectPattern(appearanceId: number): { width: number; height: number } {
    return { ...(this.#catalog[appearanceId]?.pattern ?? { width: 1, height: 1 }) };
  }

  objectFlags(appearanceId: number): AppearanceFlags {
    return { ...NO_FLAGS, ...(this.#catalog[appearanceId]?.flags ?? {}) };
  }

  outfit(
    outfitId: number, direction: Direction, phase: number, moving = false, _colors?: OutfitColors,
  ): Promise<Bitmap | null> {
    return this.#frame('outfit', outfitId, `outfit:${outfitId}:${direction}:${moving ? 'w' : 's'}:${phase}`);
  }

  framesOf(outfitId: number, moving: boolean): number {
    const frames = this.#catalog[outfitId]?.frames ?? 1;
    return typeof frames === 'number' ? frames : moving ? frames.walking : frames.idle;
  }

  effect(effectId: number, phase: number): Promise<Bitmap | null> {
    return this.#frame('effect', effectId, `effect:${effectId}:${phase}`);
  }

  effectPhases(effectId: number): readonly number[] {
    return this.#catalog[effectId]?.phases ?? [];
  }

  missile(missileId: number, dx: number, dy: number): Promise<Bitmap | null> {
    return this.#frame('missile', missileId, `missile:${missileId}:${dx}:${dy}`);
  }

  async warmObjects(appearanceIds: Iterable<number>): Promise<void> {
    this.warmedObjects.push([...appearanceIds]);
  }

  async warmOutfit(outfitId: number): Promise<void> {
    this.warmedOutfits.push(outfitId);
  }

  // ---- registro (o que os testes leem) ----

  /** O bitmap entregue (ou a entregar) para uma chave — o MESMO objeto em toda chamada. */
  bitmapOf(key: string): Bitmap | undefined {
    return this.#bitmaps.get(key);
  }

  // ---- entrega ----

  /** Entrega todo pedido cujo `at + latencyMs <= nowMs`. Devolve quantos entregou. */
  advance(nowMs: number): number {
    const due = this.#pending.filter((p) => p.due <= nowMs);
    for (const p of due) {
      this.#pending.splice(this.#pending.indexOf(p), 1);
      p.deliver();
    }
    return due.length;
  }

  /** Entrega tudo o que está pendente, seja qual for o relógio. */
  flush(): number {
    const all = this.#pending.splice(0);
    for (const p of all) p.deliver();
    return all.length;
  }

  /** Um quadro: registra o pedido, cria (uma vez) o bitmap da chave, entrega agora ou no `advance`. */
  #frame(kind: SyntheticKind, id: number, key: string): Promise<Bitmap | null> {
    const at = this.#now();
    this.requests.push({ key, at });
    const entry = this.#catalog[id];
    // Id desconhecido, ou de outro tipo: "não há quadro", como o pacote real.
    if (entry === undefined || entry.kind !== kind) return Promise.resolve(null);
    let bitmap = this.#bitmaps.get(key);
    if (bitmap === undefined) {
      const size = entry.size ?? { width: 1, height: 1 };
      bitmap = { width: size.width * TILE_PX, height: size.height * TILE_PX, close() {} };
      this.#bitmaps.set(key, bitmap);
    }
    const delivered = bitmap;
    if (this.#latencyMs <= 0) return Promise.resolve(delivered);
    return new Promise((resolve) => {
      this.#pending.push({ due: at + this.#latencyMs, deliver: () => resolve(delivered) });
    });
  }
}
