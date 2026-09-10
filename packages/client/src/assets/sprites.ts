// Do id de sprite ao quadro desenhável (FUN-18).
//
// O caminho inteiro: id global → folha (pelas faixas do `catalog-content.json`) → posição
// dentro dela (pela geometria do `spritetype`) → recorte RGBA → `ImageBitmap`.
//
// **A folha é insumo, o quadro é o produto.** Nada aqui guarda a folha inteira como bitmap:
// uma folha de 384×384 vira 144 quadros de 32×32, e o jogo desenha uns poucos por vez. Guardar
// a folha gastaria memória de GPU com 143 quadros que ninguém está olhando.
//
// Este módulo não conhece `createImageBitmap` nem `fetch` — os dois entram injetados, pela
// mesma razão de `sheet-loader.ts` não conhecer `Worker`: é o que torna despejo, orçamento e
// deduplicação testáveis sem navegador. O orçamento em si mora em `bitmap-budget.ts`, porque
// o compositor de outfit (FUN-20) precisa exatamente da mesma regra.

import { BitmapBudget, spriteBytes } from './bitmap-budget.js';
import type { Sprite } from './bitmap-budget.js';
import { positionInSheet, sheetFor } from './catalog.js';
import type { Catalog } from './catalog.js';

export { spriteBytes };
export type { Sprite };

/** Uma folha já descomprimida, como `sheet.ts` a devolve. */
export interface SheetPixels {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

export interface SpriteCacheOptions {
  /**
   * Orçamento em BYTES, nunca em contagem de quadros. Ver `bitmap-budget.ts` para o porquê.
   */
  readonly maxBytes: number;
  /** Como a folha chega. Normalmente: baixar, tentar o cache da FUN-19, decodificar no worker. */
  readonly loadSheet: (file: string) => Promise<SheetPixels>;
  /** `createImageBitmap` do navegador, ou o que o teste puser no lugar. */
  readonly createBitmap: (
    pixels: Uint8ClampedArray, width: number, height: number,
  ) => Promise<Sprite>;
  readonly now?: () => number;
  /** Ver `BitmapBudgetOptions.onEvict`: quem construiu textura sobre o bitmap precisa saber. */
  readonly onEvict?: (spriteId: number, sprite: Sprite) => void;
}

export class SpriteCache {
  readonly #catalog: Catalog;
  readonly #options: SpriteCacheOptions;
  readonly #budget: BitmapBudget<number>;
  /** Pedidos EM VOO, por id. Dez pedidos do mesmo quadro criam um bitmap, não dez. */
  readonly #inFlight = new Map<number, Promise<Sprite | null>>();
  /** Folhas em voo, por arquivo. Dez quadros da mesma folha a decodificam uma vez. */
  readonly #sheets = new Map<string, Promise<SheetPixels>>();

  constructor(catalog: Catalog, options: SpriteCacheOptions) {
    this.#catalog = catalog;
    this.#options = options;
    this.#budget = new BitmapBudget(options.maxBytes, {
      now: options.now ?? (() => Date.now()),
      ...(options.onEvict === undefined ? {} : { onEvict: options.onEvict }),
    });
  }

  /** Quanto o cache está segurando, em bytes. Existe para o teste poder afirmar o teto. */
  get bytes(): number { return this.#budget.bytes; }

  /**
   * O quadro de um id, ou `null` quando nenhuma folha o cobre.
   *
   * `null` e não exceção: id órfão é conteúdo desatualizado apontando para arte que saiu do
   * pacote, e uma criatura sem sprite é melhor que uma tela que não abre.
   */
  async get(spriteId: number): Promise<Sprite | null> {
    const cached = this.#budget.get(spriteId);
    if (cached !== undefined) return cached;

    const flying = this.#inFlight.get(spriteId);
    if (flying !== undefined) return flying;

    const promise = this.#slice(spriteId).finally(() => { this.#inFlight.delete(spriteId); });
    this.#inFlight.set(spriteId, promise);
    return promise;
  }

  /** Fecha tudo. Sem isto, trocar de mapa vaza a memória de GPU da tela anterior. */
  clear(): void { this.#budget.clear(); }

  async #slice(spriteId: number): Promise<Sprite | null> {
    const sheet = sheetFor(this.#catalog, spriteId);
    if (sheet === null) return null;
    const at = positionInSheet(sheet, spriteId);
    if (at === null) return null;

    const pixels = await this.#sheetPixels(sheet.file);
    const frame = cutOut(pixels, at.x, at.y, sheet.width, sheet.height);
    if (frame === null) return null;

    const sprite = await this.#options.createBitmap(frame, sheet.width, sheet.height);
    this.#budget.put(spriteId, sprite);
    return sprite;
  }

  /** A folha, com deduplicação: dez quadros dela pedidos juntos a decodificam uma vez. */
  async #sheetPixels(file: string): Promise<SheetPixels> {
    const flying = this.#sheets.get(file);
    if (flying !== undefined) return flying;
    const promise = this.#options.loadSheet(file).finally(() => { this.#sheets.delete(file); });
    this.#sheets.set(file, promise);
    return promise;
  }
}

/**
 * Recorta um quadro da folha. `null` quando o recorte cai fora dela.
 *
 * Fora da classe porque é aritmética pura: dá para conferir olhando, e o teste dela não
 * precisa de cache nenhum.
 */
export function cutOut(
  sheet: SheetPixels, x: number, y: number, width: number, height: number,
): Uint8ClampedArray | null {
  if (x < 0 || y < 0 || x + width > sheet.width || y + height > sheet.height) return null;
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * sheet.width + x) * 4;
    // Copia a LINHA inteira de uma vez. Pixel a pixel são 4.096 iterações por quadro de 32×32,
    // e isto roda para cada quadro novo que entra em cena.
    frame.set(sheet.pixels.subarray(from, from + width * 4), row * width * 4);
  }
  return frame;
}
