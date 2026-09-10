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
// deduplicação testáveis sem navegador.

import { positionInSheet, sheetFor } from './catalog.js';
import type { Catalog } from './catalog.js';

/**
 * O mínimo de `ImageBitmap` que este módulo usa. `ImageBitmap` satisfaz isto por estrutura.
 *
 * `close()` está aqui porque é obrigatório, não porque é conveniente: `ImageBitmap` segura
 * memória de GPU que o coletor não recolhe sozinho.
 */
export interface Sprite {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** Uma folha já descomprimida, como `sheet.ts` a devolve. */
export interface SheetPixels {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

export interface SpriteCacheOptions {
  /**
   * Orçamento em BYTES, nunca em contagem de quadros.
   *
   * Um 64×64 ocupa quatro vezes um 32×32. Contar itens faria o teto real de memória variar
   * por um fator de quatro conforme o que estivesse em cena — e o estouro chegaria numa hunt
   * cheia de monstros grandes, que é justamente quando não se pode engasgar.
   */
  readonly maxBytes: number;
  /** Como a folha chega. Normalmente: baixar, tentar o cache da FUN-19, decodificar no worker. */
  readonly loadSheet: (file: string) => Promise<SheetPixels>;
  /** `createImageBitmap` do navegador, ou o que o teste puser no lugar. */
  readonly createBitmap: (
    pixels: Uint8ClampedArray, width: number, height: number,
  ) => Promise<Sprite>;
  readonly now?: () => number;
}

interface Entry {
  readonly sprite: Sprite;
  readonly bytes: number;
  usedAtMs: number;
}

/** Quantos bytes de GPU um quadro ocupa. RGBA, quatro bytes por pixel. */
export function spriteBytes(width: number, height: number): number {
  return width * height * 4;
}

export class SpriteCache {
  readonly #catalog: Catalog;
  readonly #options: SpriteCacheOptions;
  readonly #now: () => number;
  readonly #entries = new Map<number, Entry>();
  /** Pedidos EM VOO, por id. Dez pedidos do mesmo quadro criam um bitmap, não dez. */
  readonly #inFlight = new Map<number, Promise<Sprite | null>>();
  /** Folhas em voo, por arquivo. Dez quadros da mesma folha a decodificam uma vez. */
  readonly #sheets = new Map<string, Promise<SheetPixels>>();
  #bytes = 0;

  constructor(catalog: Catalog, options: SpriteCacheOptions) {
    if (options.maxBytes <= 0) throw new Error('sprites: maxBytes precisa ser positivo');
    this.#catalog = catalog;
    this.#options = options;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Quanto o cache está segurando, em bytes. Existe para o teste poder afirmar o teto. */
  get bytes(): number { return this.#bytes; }

  /**
   * O quadro de um id, ou `null` quando nenhuma folha o cobre.
   *
   * `null` e não exceção: id órfão é conteúdo desatualizado apontando para arte que saiu do
   * pacote, e uma criatura sem sprite é melhor que uma tela que não abre.
   */
  async get(spriteId: number): Promise<Sprite | null> {
    const cached = this.#entries.get(spriteId);
    if (cached !== undefined) {
      cached.usedAtMs = this.#now();
      return cached.sprite;
    }

    const flying = this.#inFlight.get(spriteId);
    if (flying !== undefined) return flying;

    const promise = this.#slice(spriteId).finally(() => { this.#inFlight.delete(spriteId); });
    this.#inFlight.set(spriteId, promise);
    return promise;
  }

  /** Fecha tudo. Sem isto, trocar de mapa vaza a memória de GPU da tela anterior. */
  clear(): void {
    for (const entry of this.#entries.values()) entry.sprite.close();
    this.#entries.clear();
    this.#bytes = 0;
  }

  async #slice(spriteId: number): Promise<Sprite | null> {
    const sheet = sheetFor(this.#catalog, spriteId);
    if (sheet === null) return null;
    const at = positionInSheet(sheet, spriteId);
    if (at === null) return null;

    const pixels = await this.#sheetPixels(sheet.file);
    const frame = cutOut(pixels, at.x, at.y, sheet.width, sheet.height);
    if (frame === null) return null;

    const sprite = await this.#options.createBitmap(frame, sheet.width, sheet.height);
    this.#store(spriteId, sprite, spriteBytes(sheet.width, sheet.height));
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

  #store(spriteId: number, sprite: Sprite, bytes: number): void {
    // Quadro maior que o orçamento inteiro nunca caberia, e guardá-lo despejaria tudo para
    // depois ser despejado ele mesmo. Entregue sem entrar no cache: quem pediu recebe.
    if (bytes > this.#options.maxBytes) return;
    this.#evictFor(bytes);
    this.#entries.set(spriteId, { sprite, bytes, usedAtMs: this.#now() });
    this.#bytes += bytes;
  }

  #evictFor(incoming: number): void {
    if (this.#bytes + incoming <= this.#options.maxBytes) return;
    const oldest = [...this.#entries.entries()].sort((a, b) => a[1].usedAtMs - b[1].usedAtMs);
    for (const [id, entry] of oldest) {
      if (this.#bytes + incoming <= this.#options.maxBytes) return;
      // **`close()` é obrigatório, não higiene.** `ImageBitmap` segura memória de GPU que o
      // coletor não recolhe: sem isto o cache respeita o teto de contagem e vaza mesmo assim,
      // até a aba morrer — e o sintoma é o navegador ficando lento, não o jogo.
      entry.sprite.close();
      this.#entries.delete(id);
      this.#bytes -= entry.bytes;
    }
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
