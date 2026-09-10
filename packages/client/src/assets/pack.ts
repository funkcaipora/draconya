// O pacote de assets, montado (FUN-23).
//
// É a costura entre as quatro peças que já existem e nunca tinham se falado: o índice
// (`catalog.ts`), o registro de aparências (`appearances.ts`), a descompressão em worker
// (`sheet-loader.ts`) e o fatiador com orçamento (`sprites.ts`). Nada de novo acontece aqui —
// o que este arquivo faz é responder a única pergunta que o viewport tem:
//
//     "me dá o quadro desta aparência, nesta direção, nesta fase"
//
// **Carrega uma vez e não guarda o buffer.** O `.dat` tem alguns MB; depois de virar catálogo
// ele não serve para mais nada, e segurá-lo é memória parada pelo tempo que a aba viver.

import { readAppearances } from './appearances.js';
import type { Appearance, AppearanceCatalogue } from './appearances.js';
import { SheetCache, sheetKey } from './cache.js';
import type { SheetStore } from './cache.js';
import { readCatalog } from './catalog.js';
import type { Catalog } from './catalog.js';
import { SheetLoader } from './sheet-loader.js';
import { SpriteCache } from './sprites.js';
import type { Sprite } from './sprites.js';

/** Quantos bytes de GPU os quadros podem ocupar. 64 MB dá folga para uma tela cheia. */
const SPRITE_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * As quatro direções, na ordem em que o pacote as guarda dentro de `patternWidth`.
 *
 * **A ordem é do PACOTE, não nossa.** Trocá-la faz o personagem andar de costas, e o defeito
 * só aparece na tela — nenhum teste de unidade percebe.
 */
export const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface PackOptions {
  /** Onde o pacote está servido, com a versão no caminho. Ver `VITE_THINGS_URL`. */
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly loader: Pick<SheetLoader, 'decode'>;
  readonly createBitmap: (
    pixels: Uint8ClampedArray, width: number, height: number,
  ) => Promise<Sprite>;
  /** O cache persistente da FUN-19. Ausente é degradação: paga-se o LZMA toda sessão. */
  readonly store?: SheetStore;
  readonly maxBytes?: number;
}

export class AssetPack {
  readonly #catalog: Catalog;
  readonly #appearances: AppearanceCatalogue;
  readonly #sprites: SpriteCache;

  private constructor(catalog: Catalog, appearances: AppearanceCatalogue, sprites: SpriteCache) {
    this.#catalog = catalog;
    this.#appearances = appearances;
    this.#sprites = sprites;
  }

  /**
   * Baixa o índice e as aparências, e monta o pipeline.
   *
   * A folha só é baixada quando um quadro dela é pedido — são milhares, e uma tela usa
   * dezenas. Baixar tudo na entrada trocaria "o jogo abre devagar" por "o jogo não abre".
   */
  static async load(options: PackOptions): Promise<AssetPack> {
    const get = options.fetch ?? globalThis.fetch.bind(globalThis);
    const base = options.baseUrl.replace(/\/+$/, '');

    const indexResponse = await get(`${base}/catalog-content.json`);
    if (!indexResponse.ok) {
      throw new Error(`pacote: catalog-content.json respondeu ${indexResponse.status}`);
    }
    const catalog = readCatalog(await indexResponse.json());

    const datResponse = await get(`${base}/${catalog.appearancesFile}`);
    if (!datResponse.ok) {
      throw new Error(`pacote: ${catalog.appearancesFile} respondeu ${datResponse.status}`);
    }
    const dat: ArrayBuffer = await datResponse.arrayBuffer();
    const appearances = readAppearances(new Uint8Array(dat));

    const cache = options.store === undefined
      ? null
      : new SheetCache(options.store, { maxBytes: 256 * 1024 * 1024 });
    // A versão está no CAMINHO do pacote, e é ela que entra na chave do cache persistente:
    // duas versões podem trazer folhas de mesmo nome com conteúdo diferente (FUN-19).
    const version = base.slice(base.lastIndexOf('/') + 1);

    const sprites = new SpriteCache(catalog, {
      maxBytes: options.maxBytes ?? SPRITE_BUDGET_BYTES,
      createBitmap: options.createBitmap,
      loadSheet: async (file) => {
        const key = sheetKey(version, file);
        const cached = await cache?.get(key);
        if (cached != null) return cached;

        const response = await get(`${base}/${file}`);
        if (!response.ok) throw new Error(`pacote: folha ${file} respondeu ${response.status}`);
        const compressed: ArrayBuffer = await response.arrayBuffer();
        const decoded = await options.loader.decode(compressed);
        // Sem `await`: guardar é atalho da PRÓXIMA vez, e esperar por ele atrasaria esta.
        void cache?.put(key, decoded);
        return decoded;
      },
    });

    return new AssetPack(catalog, appearances, sprites);
  }

  /** Quantos bytes de quadro estão em memória. Para o teste poder afirmar o teto. */
  get bytes(): number { return this.#sprites.bytes; }

  /** O catálogo cru, para quem precisar percorrer folhas — ferramenta, não jogo. */
  get catalog(): Catalog { return this.#catalog; }

  /**
   * O quadro de um objeto — chão, parede, item. Um só: objeto de mapa não anda.
   */
  async object(appearanceId: number): Promise<Sprite | null> {
    return this.#frame(this.#appearances.object.get(appearanceId), 0, 0, 0);
  }

  /**
   * O quadro de uma criatura, na direção e na fase pedidas.
   *
   * **Dois grupos de quadros, e a escolha entre eles é o que faz a criatura ANDAR.** O grupo 0
   * é parado (uma fase), o 1 é andando (várias). Pedir sempre o 0 dá um monstro que desliza
   * pelo chão sem mexer as patas — que é o defeito clássico de quem liga sprite antes de ligar
   * `frameGroups`.
   */
  async outfit(outfitId: number, direction: Direction, phase: number): Promise<Sprite | null> {
    const appearance = this.#appearances.outfit.get(outfitId);
    const walking = appearance?.frameGroups[1];
    const group = walking === undefined || phase === 0 ? 0 : 1;
    return this.#frame(appearance, group, DIRECTIONS.indexOf(direction), phase);
  }

  /**
   * O id de sprite dentro de um `frameGroup`.
   *
   * O vetor é plano e indexado por `((fase × profundidade + z) × altura + y) × largura + x`,
   * vezes as camadas. Aqui só usamos direção (x) e fase — profundidade e camada são addon e
   * montaria, que o MVP não tem.
   */
  async #frame(
    appearance: Appearance | undefined, groupIndex: number, x: number, phase: number,
  ): Promise<Sprite | null> {
    const group = appearance?.frameGroups[groupIndex] ?? appearance?.frameGroups[0];
    if (group === undefined || group.spriteIds.length === 0) return null;

    // O resto da divisão, e não um erro: uma criatura com menos direções do que pedimos existe
    // (efeito, missile), e recusar deixaria buraco na tela onde cabia o primeiro quadro.
    const column = group.patternWidth === 0 ? 0 : x % group.patternWidth;
    const frames = group.phases.length === 0
      ? 1
      : group.spriteIds.length / (group.patternWidth * group.patternHeight * group.patternDepth
        * group.layers);
    const step = frames <= 1 ? 0 : phase % Math.floor(frames);
    const index = (step * group.patternWidth + column) * group.layers;

    const spriteId = group.spriteIds[index] ?? group.spriteIds[0];
    return spriteId === undefined ? null : this.#sprites.get(spriteId);
  }
}
