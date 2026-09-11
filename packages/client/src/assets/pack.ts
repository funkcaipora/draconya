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
import type { AppearanceCatalogue, FrameGroup } from './appearances.js';
import { SheetCache, sheetKey } from './cache.js';
import type { SheetStore } from './cache.js';
import { readCatalog } from './catalog.js';
import type { Catalog } from './catalog.js';
import { OutfitComposer } from './outfit.js';
import type { OutfitColors } from './outfit.js';
import { SheetLoader } from './sheet-loader.js';
import { SpriteCache } from './sprites.js';
import type { Sprite } from './sprites.js';

/** Quantos bytes de GPU os quadros podem ocupar. 64 MB dá folga para uma tela cheia. */
const SPRITE_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * Quantos bytes as composições de outfit podem ocupar, à parte dos quadros.
 *
 * Separado porque a vida útil é outra: um quadro de chão serve a tela inteira, uma
 * composição serve UM personagem com aquelas quatro cores. Uma hunt com party tem meia dúzia
 * deles, e 16 MB são mil quadros de 64×64 — o teto existe para o vazamento, não para o uso.
 */
const OUTFIT_BUDGET_BYTES = 16 * 1024 * 1024;

/** A camada do desenho e a do template de cor, na ordem em que o pacote as guarda. */
const LAYER_BASE = 0;
const LAYER_TEMPLATE = 1;

/**
 * As quatro direções, na ordem em que o pacote as guarda dentro de `patternWidth`.
 *
 * **A ordem é do PACOTE, não nossa.** Trocá-la faz o personagem andar de costas, e o defeito
 * só aparece na tela — nenhum teste de unidade percebe.
 */
export const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Uma célula do padrão 3×3 de um projétil: coluna e linha. */
export interface MissileCell {
  readonly x: 0 | 1 | 2;
  readonly y: 0 | 1 | 2;
}

/**
 * Em que célula do padrão 3×3 de um projétil um voo de `(dx, dy)` cai (FUN-106).
 *
 * **O padrão do projétil é a direção do voo, e é assim que o cliente do Tibia o guarda:** a
 * coluna é o sentido horizontal (0 oeste, 1 nenhum, 2 leste) e a linha é o vertical (0 norte,
 * 1 nenhum, 2 sul). A célula do meio, `(1, 1)`, é o projétil parado — nunca desenhada num voo
 * de verdade.
 *
 * **A escolha é pelo OCTANTE, não pelo sinal de cada eixo.** O pacote tem oito direções, uma a
 * cada 45°, e um tiro de `(3, 1)` está a 18° — quase horizontal — então o quadro dele é o de
 * leste, não o da diagonal: pelo sinal ele sairia com o sprite de sudeste, torto em relação
 * ao voo, e é assim que o sinal erra em todo tiro que não é reto nem exatamente diagonal. A
 * regra é a de `Position::getDirectionFromPosition` do OTClient (`opentibiabr/otclient`, MIT;
 * lemos de lá a regra, não o código): o eixo maior manda quando o menor é pequeno perto dele,
 * e senão é diagonal. O corte aqui é `|dx| > 2|dy|` — inteiro, sem trigonometria; o do
 * OTClient é tan(22,5°) ≈ 0,414 ≈ 1/2,414, e os dois só divergem em tiros como `(7, 3)`, a
 * 23°, que lá cai na diagonal. É a escolha de um quadro, não geometria do voo: o projétil
 * anda a mesma reta nos dois.
 */
export function missileCell(dx: number, dy: number): MissileCell {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > 2 * ay) return { x: side(dx), y: 1 };
  if (ay > 2 * ax) return { x: 1, y: side(dy) };
  return { x: side(dx), y: side(dy) };
}

/** O sentido de um eixo: 0 negativo (oeste/norte), 2 positivo (leste/sul), 1 parado. */
function side(delta: number): 0 | 1 | 2 {
  if (delta > 0) return 2;
  if (delta < 0) return 0;
  return 1;
}

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
  /**
   * Avisa que um bitmap vai ser fechado. O viewport constrói `Texture` sobre ele, e uma
   * textura cuja fonte fechou é textura inválida — ver `BitmapBudgetOptions.onEvict`.
   *
   * A chave é o id de sprite para um quadro da folha, e a chave de composição
   * (`outfitKey`) para um outfit pintado — o viewport encontra a textura pelo PRÓPRIO
   * bitmap e ignora as duas; ela está aqui para quem depura saber qual bitmap morreu.
   */
  readonly onEvict?: (key: number | string, sprite: Sprite) => void;
}

/**
 * Quantas fases um grupo de quadros tem. UMA conta, usada por `indexOf` e por `framesOf`:
 * duplicada, ela diverge no primeiro outfit com `layers > 1`.
 */
function framesIn(group: FrameGroup): number {
  if (group.phases.length === 0) return 1;
  const perFrame = group.patternWidth * group.patternHeight * group.patternDepth * group.layers;
  return perFrame === 0 ? 1 : Math.max(1, Math.floor(group.spriteIds.length / perFrame));
}

/** Onde um quadro está dentro de um `frameGroup`, em cada um dos eixos do padrão. */
interface FrameAt {
  /** Direção, para criatura; coluna do padrão de chão, para objeto. */
  readonly x: number;
  /** Addon, para criatura; linha do padrão de chão, para objeto. */
  readonly y: number;
  /** Montaria. Sempre 0 por enquanto: o MVP não tem. */
  readonly z: number;
  readonly phase: number;
  /** `LAYER_BASE` é o desenho; `LAYER_TEMPLATE` é a máscara de cor, quando `layers >= 2`. */
  readonly layer: number;
}

/**
 * O resto da divisão, e não um erro: uma criatura com menos direções do que pedimos existe
 * (efeito, missile), e recusar deixaria buraco na tela onde cabia o primeiro quadro. O zero
 * é um pacote que declara o campo explicitamente como 0 — `% 0` daria `NaN`.
 */
function wrap(value: number, size: number): number {
  return size <= 1 ? 0 : value % size;
}

/**
 * A posição de um quadro no vetor plano `spriteIds`.
 *
 * `((((phase × patternDepth + z) × patternHeight + y) × patternWidth + x) × layers) + layer`,
 * do `appearances.proto` de `opentibiabr/otclient` (MIT). **A fórmula inteira, e não só os
 * eixos que hoje usamos.** A primeira versão fazia `(phase × patternWidth + x) × layers`, que
 * só é igual a esta quando `patternHeight` e `patternDepth` são 1 — e o outfit do jogador não
 * é assim: ele tem 3 linhas de addon e 2 de montaria, e a "fase 1" da conta curta caía no
 * quadro do addon da fase 0. Nenhuma fixture de uma linha só pega isso.
 */
function indexOf(group: FrameGroup, at: FrameAt): number {
  const frames = framesIn(group);
  const phase = frames <= 1 ? 0 : at.phase % frames;
  const z = wrap(at.z, group.patternDepth);
  const y = wrap(at.y, group.patternHeight);
  const x = wrap(at.x, group.patternWidth);
  return ((((phase * group.patternDepth + z) * group.patternHeight + y) * group.patternWidth + x)
    * group.layers) + at.layer;
}

export class AssetPack {
  readonly #catalog: Catalog;
  readonly #appearances: AppearanceCatalogue;
  readonly #sprites: SpriteCache;
  readonly #composer: OutfitComposer;

  private constructor(
    catalog: Catalog, appearances: AppearanceCatalogue, sprites: SpriteCache,
    options: Pick<PackOptions, 'createBitmap' | 'onEvict'>,
  ) {
    this.#catalog = catalog;
    this.#appearances = appearances;
    this.#sprites = sprites;
    // O MESMO `createBitmap` e o MESMO `onEvict` do fatiador: para o viewport, um bitmap
    // composto e um quadro da folha são a mesma coisa — viram `Texture`, e morrem pelo aviso.
    this.#composer = new OutfitComposer({
      maxBytes: OUTFIT_BUDGET_BYTES,
      createBitmap: options.createBitmap,
      ...(options.onEvict === undefined ? {} : { onEvict: options.onEvict }),
      layersOf: (outfitId, group, direction, phase) => this.#layersOf(
        outfitId, group, direction, phase,
      ),
    });
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
      ...(options.onEvict === undefined ? {} : { onEvict: options.onEvict }),
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

    return new AssetPack(catalog, appearances, sprites, options);
  }

  /**
   * Quantos bytes de bitmap estão em memória — quadros da folha E composições. Para o teste
   * poder afirmar o teto.
   */
  get bytes(): number { return this.#sprites.bytes + this.#composer.bytes; }

  /** O catálogo cru, para quem precisar percorrer folhas — ferramenta, não jogo. */
  get catalog(): Catalog { return this.#catalog; }

  /**
   * O quadro de um objeto — chão, parede, item — na posição `(x, y)` do tile.
   *
   * **A posição escolhe o quadro, e é isso que faz o chão não parecer azulejo.** Um chão do
   * pacote tem um padrão de `patternWidth × patternHeight` variações (a grama é 4×4), e o
   * cliente escolhe a de cada tile por `x % largura, y % altura` — vizinhos ganham desenhos
   * diferentes e o padrão só se repete a cada quatro tiles. Pedir sempre `(0, 0)` desenha o
   * mesmo quadro em todo lugar, e a tela vira um ladrilho.
   */
  async object(appearanceId: number, x = 0, y = 0): Promise<Sprite | null> {
    const group = this.#appearances.object.get(appearanceId)?.frameGroups[0];
    return this.#frame(group, { x, y, z: 0, phase: 0, layer: LAYER_BASE });
  }

  /**
   * As dimensões do padrão de um objeto, para o viewport poder reaproveitar o quadro entre
   * tiles: a chave de cache é `(x % largura, y % altura)`, não o tile — um mapa de 40×40 de
   * grama 4×4 são dezesseis pedidos, não mil e seiscentos. `{1, 1}` quando o objeto não
   * existe, e aí toda posição cai no mesmo quadro (que `object` devolve como `null`).
   */
  objectPattern(appearanceId: number): { width: number; height: number } {
    const group = this.#appearances.object.get(appearanceId)?.frameGroups[0];
    if (group === undefined) return { width: 1, height: 1 };
    return { width: Math.max(1, group.patternWidth), height: Math.max(1, group.patternHeight) };
  }

  /**
   * O quadro de uma criatura, na direção e na fase pedidas.
   *
   * **Dois grupos de quadros, e a escolha entre eles é o que faz a criatura ANDAR.** O grupo 0
   * é parado (uma fase), o 1 é andando (várias). Pedir sempre o 0 dá um monstro que desliza
   * pelo chão sem mexer as patas — que é o defeito clássico de quem liga sprite antes de ligar
   * `frameGroups`.
   *
   * `moving` é ESTADO da criatura, não um número de fase. A primeira versão usava `phase === 0`
   * como sinônimo de "parado", e o custo era o primeiro quadro do ciclo de caminhada nunca ser
   * desenhado — oito fases viravam "parado + sete andando", com um soluço a cada passo.
   *
   * **Com `colors`, o quadro sai PINTADO** — base × template, pelo `OutfitComposer`, que
   * guarda a composição por (outfit, cores, grupo, direção, fase). Sem `colors`, ou quando o
   * outfit tem uma camada só e não há o que pintar, sai a base como está: monstro não tem
   * cor de jogador, e um outfit de uma camada pintado seria a base multiplicada por nada.
   */
  async outfit(
    outfitId: number, direction: Direction, phase: number, moving = false, colors?: OutfitColors,
  ): Promise<Sprite | null> {
    const appearance = this.#appearances.outfit.get(outfitId);
    const groupIndex = moving && appearance?.frameGroups[1] !== undefined ? 1 : 0;
    const group = appearance?.frameGroups[groupIndex];
    if (colors !== undefined && group !== undefined && group.layers >= 2) {
      // **A chave da composição é o quadro RESOLVIDO**, com a mesma volta que `indexOf` dá na
      // fase e na direção. Com a fase crua na chave, três pedidos que caem no mesmo quadro
      // viram três composições e três entradas no orçamento — o caminho cru colapsa as três
      // num bitmap só, e este tem que colapsar igual.
      const frames = framesIn(group);
      const step = frames <= 1 ? 0 : phase % frames;
      const column = wrap(DIRECTIONS.indexOf(direction), group.patternWidth);
      return this.#composer.get(outfitId, colors, groupIndex, column, step);
    }
    return this.#frame(group, {
      x: DIRECTIONS.indexOf(direction), y: 0, z: 0, phase, layer: LAYER_BASE,
    });
  }

  /**
   * AQUECE um outfit (FUN-112): pede todo quadro dele — cada grupo, direção, fase e camada —
   * para as folhas estarem baixadas, decodificadas e no cache antes de a criatura aparecer.
   *
   * Sem isto o rato era um quadrado por seis a dez segundos na primeira entrada numa hunt:
   * o outfit dele espalha doze quadros por onze folhas LZMA, e cada uma só decodificava
   * quando o primeiro quadro dela era desenhado. O `Shell` chama isto na Cidade, para os
   * outfits que o catálogo diz que as hunts têm — tempo em que o jogador está configurando
   * o bot e nada mais pede folha. Só a BASE e o TEMPLATE do padrão sem addon nem montaria: é
   * o que `outfit()` desenha hoje. Outfit desconhecido não pede nada; folha que não abre
   * não derruba o aquecimento — o quadro dela cai no fallback como cairia sem aquecer.
   */
  async warmOutfit(outfitId: number): Promise<void> {
    const appearance = this.#appearances.outfit.get(outfitId);
    if (appearance === undefined) return;
    const requests: Promise<unknown>[] = [];
    for (const group of appearance.frameGroups) {
      const frames = framesIn(group);
      const layers = group.layers >= 2 ? [LAYER_BASE, LAYER_TEMPLATE] : [LAYER_BASE];
      for (let column = 0; column < group.patternWidth; column++) {
        for (let phase = 0; phase < frames; phase++) {
          for (const layer of layers) {
            requests.push(
              this.#frame(group, { x: column, y: 0, z: 0, phase, layer }).catch(() => null),
            );
          }
        }
      }
    }
    await Promise.all(requests);
  }

  /**
   * Em quantas fases o ciclo de caminhada se divide, para o viewport mapear o progresso do
   * passo em quadro. `1` quando a criatura não anima — e aí qualquer fase cai no mesmo quadro.
   */
  framesOf(outfitId: number, moving: boolean): number {
    const appearance = this.#appearances.outfit.get(outfitId);
    const group = moving && appearance?.frameGroups[1] !== undefined
      ? appearance.frameGroups[1]
      : appearance?.frameGroups[0];
    return group === undefined ? 1 : framesIn(group);
  }

  /**
   * O quadro de um EFEITO — a explosão da magia, o sangue do golpe — na fase pedida (FUN-106).
   *
   * Efeito não tem direção nem addon: é o grupo 0 com o padrão em zero, e só a FASE anda.
   * A fase sai de `effectPhases` pelo tempo decorrido, não do relógio de parede — ver
   * `effectPhaseAt` em `world/effects.ts`.
   */
  async effect(effectId: number, phase: number): Promise<Sprite | null> {
    const group = this.#appearances.effect.get(effectId)?.frameGroups[0];
    return this.#frame(group, { x: 0, y: 0, z: 0, phase, layer: LAYER_BASE });
  }

  /**
   * A duração de cada fase de um efeito, em ms, na ordem em que tocam: é a linha do tempo que
   * o viewport percorre para saber que quadro pedir e quando descartar o efeito. Vazio para
   * efeito sem animação e para id que o pacote não tem — e aí o viewport decide o que fazer
   * com um efeito sem tempo (`FALLBACK_EFFECT_PHASES`).
   *
   * **A duração MÍNIMA.** Um efeito de combate tem mínimo e máximo iguais no pacote; onde
   * diferem, a duração variável é para animação AMBIENTE (a tocha que não pisca no compasso
   * da vizinha), e num efeito o mínimo é o lado seguro: ele acaba antes, nunca fica pendurado.
   */
  effectPhases(effectId: number): readonly number[] {
    const group = this.#appearances.effect.get(effectId)?.frameGroups[0];
    if (group === undefined) return [];
    return group.phases.map((phase) => phase.durationMinMs);
  }

  /**
   * O quadro de um PROJÉTIL voando de `dx`, `dy` (FUN-106).
   *
   * O padrão do projétil é 3×3 e a célula é a DIREÇÃO do voo — `missileCell` diz como. O
   * viewport chama com o delta inteiro do tiro (`to - from`), e é o octante dele que escolhe.
   * Projétil não anima: é a fase 0 sempre, e o movimento é o sprite andando pela tela.
   */
  async missile(missileId: number, dx: number, dy: number): Promise<Sprite | null> {
    const group = this.#appearances.missile.get(missileId)?.frameGroups[0];
    const cell = missileCell(dx, dy);
    return this.#frame(group, { x: cell.x, y: cell.y, z: 0, phase: 0, layer: LAYER_BASE });
  }

  /**
   * Fecha todos os bitmaps — quadros da folha e composições. Trocar de mapa sem isto vaza a
   * memória de GPU da tela anterior; e esquecer o compositor aqui vaza só os personagens, que
   * é o vazamento que ninguém acha porque o chão sumiu direito.
   */
  clear(): void {
    this.#sprites.clear();
    this.#composer.clear();
  }

  /** O id de sprite de um quadro, ou `undefined` quando o grupo não tem quadro nenhum. */
  #spriteIdAt(group: FrameGroup | undefined, at: FrameAt): number | undefined {
    if (group === undefined || group.spriteIds.length === 0) return undefined;
    return group.spriteIds[indexOf(group, at)] ?? group.spriteIds[0];
  }

  /** O bitmap de um quadro, pelo fatiador — `null` quando não há quadro ou folha. */
  async #frame(group: FrameGroup | undefined, at: FrameAt): Promise<Sprite | null> {
    const spriteId = this.#spriteIdAt(group, at);
    return spriteId === undefined ? null : this.#sprites.get(spriteId);
  }

  /**
   * A base e o template de um quadro de outfit, em pixels, para o compositor pintar.
   *
   * Pedidos JUNTOS, de propósito: os dois ids são vizinhos no vetor e moram na mesma folha, e
   * `SpriteCache` deduplica a folha em voo — em série, o segundo pedido chegaria depois de o
   * primeiro soltar a folha e a decodificaria de novo.
   */
  async #layersOf(
    outfitId: number, groupIndex: number, direction: number, phase: number,
  ): Promise<{ base: Uint8ClampedArray; template: Uint8ClampedArray;
    width: number; height: number } | null> {
    const group = this.#appearances.outfit.get(outfitId)?.frameGroups[groupIndex];
    if (group === undefined || group.layers < 2) return null;
    const at = { x: direction, y: 0, z: 0, phase };
    const baseId = this.#spriteIdAt(group, { ...at, layer: LAYER_BASE });
    const templateId = this.#spriteIdAt(group, { ...at, layer: LAYER_TEMPLATE });
    if (baseId === undefined || templateId === undefined) return null;

    const [base, template] = await Promise.all([
      this.#sprites.pixels(baseId), this.#sprites.pixels(templateId),
    ]);
    if (base === null || template === null) return null;
    return { base: base.pixels, template: template.pixels, width: base.width, height: base.height };
  }
}
