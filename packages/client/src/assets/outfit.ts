// Colorização de outfit: quatro canais sobre a paleta fixa (FUN-20).
//
// Um outfit tem a camada BASE e uma camada TEMPLATE em que cada cor marca uma região do corpo.
// A regra vem de `src/client/creature.cpp` de `opentibiabr/otclient` (MIT): amarelo é cabeça,
// vermelho é corpo, verde é pernas, azul é pés — e a composição é MULTIPLICAÇÃO sobre a base.
// Lemos de lá o formato e a fórmula, não o código.
//
// É isto que viabiliza a personalização do §7.4. Sem ele, todo personagem da mesma vocação
// fica idêntico.

import { BitmapBudget } from './bitmap-budget.js';
import type { Sprite } from './bitmap-budget.js';

/**
 * A paleta tem 19 passos de matiz × 7 valores de saturação/intensidade = **133 cores**.
 *
 * Não é uma tabela: é uma fórmula, e por isso não mora em `content/`. Guardar 133 tuplas RGB
 * seria guardar o resultado de uma conta que cabe em trinta linhas — e a primeira vez que
 * alguém mexesse numa delas à mão, a paleta divergiria da do pacote sem nada acusar.
 */
export const HUE_STEPS = 19;
export const SHADE_STEPS = 7;
export const OUTFIT_COLORS = HUE_STEPS * SHADE_STEPS;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Saturação e intensidade de cada uma das sete faixas. */
const SHADES: readonly (readonly [saturation: number, intensity: number])[] = [
  [0.25, 1.00], [0.25, 0.75], [0.50, 0.75], [0.667, 0.75],
  [1.00, 1.00], [1.00, 0.75], [1.00, 0.50],
];

/**
 * A cor de um índice de paleta.
 *
 * **Índice inválido cai no 0, nunca lança** — é o que a issue pede, e a razão é de jogo: cor
 * errada é defeito visual, personagem invisível é bug de jogo. Um índice fora da faixa vem de
 * conteúdo velho ou de um jogador mexendo no request, e nenhum dos dois pode apagar alguém
 * da tela.
 */
export function outfitColor(index: number): Rgb {
  const color = Number.isInteger(index) && index > 0 && index < OUTFIT_COLORS ? index : 0;

  // Múltiplo do número de matizes é a rampa de CINZA — a coluna sem cor da paleta.
  if (color % HUE_STEPS === 0) {
    const level = Math.trunc((1 - color / OUTFIT_COLORS) * 255);
    return { r: level, g: level, b: level };
  }

  // Dividido por 18 e não por 19: é assim no pacote, e o efeito é a última matiz fechar o
  // círculo em 1,0 em vez de parar antes dele.
  const hue = (color % HUE_STEPS) / (HUE_STEPS - 1);
  const [saturation, intensity] = SHADES[Math.trunc(color / HUE_STEPS)] ?? [1, 1];

  const low = intensity * (1 - saturation);
  // **Preso em 5, e não `trunc(hue * 6)` solto.** A última matiz de cada faixa cai em `hue`
  // exatamente 1,0, e ali `trunc` daria 6: um sexto sextante que no original não existe — lá
  // a última faixa é a CONTINUAÇÃO da quinta, com a rampa em `6·h − 5 = 1`, não em zero.
  //
  // Sem isto, sete das 133 cores saem erradas: as de matiz vermelho puro viram magenta. Foi
  // o que a conferência contra a transliteração literal pegou, e nenhum teste de "a paleta
  // tem 133 cores" pegaria.
  const sextant = Math.min(5, Math.trunc(hue * 6));
  const rise = (intensity - low) * (hue * 6 - sextant);

  const [r, g, b] = ((): readonly [number, number, number] => {
    switch (sextant) {
      case 0: return [intensity, low + rise, low];
      case 1: return [intensity - rise, intensity, low];
      case 2: return [low, intensity, low + rise];
      case 3: return [low, intensity - rise, intensity];
      case 4: return [low + rise, low, intensity];
      // O sexto sextante e o ponto exato em 1,0, que cai fora dos cinco de cima.
      default: return [intensity, low, intensity - rise];
    }
  })();

  return { r: Math.trunc(r * 255), g: Math.trunc(g * 255), b: Math.trunc(b * 255) };
}

export interface OutfitColors {
  readonly head: number;
  readonly body: number;
  readonly legs: number;
  readonly feet: number;
}

/** As quatro máscaras do template, na ordem em que o pacote as pinta. */
const MASKS = [
  { r: 255, g: 255, b: 0, of: (colors: OutfitColors) => colors.head },
  { r: 255, g: 0, b: 0, of: (colors: OutfitColors) => colors.body },
  { r: 0, g: 255, b: 0, of: (colors: OutfitColors) => colors.legs },
  { r: 0, g: 0, b: 255, of: (colors: OutfitColors) => colors.feet },
] as const;

/**
 * Pinta a base usando o template como máscara.
 *
 * **Multiplicação, e não substituição.** A base já traz o sombreado do desenho; substituir a
 * cor apagaria isso e devolveria um boneco chapado. Multiplicar preserva o claro e o escuro
 * do original e só troca o matiz — que é o que "recolorir" significa aqui.
 *
 * Pixel do template que não bate com nenhuma máscara fica como está na base: é pele, cabelo e
 * contorno, que não são personalizáveis.
 */
export function colorize(
  base: Uint8ClampedArray, template: Uint8ClampedArray, colors: OutfitColors,
): Uint8ClampedArray {
  if (base.length !== template.length) {
    throw new Error('outfit: a camada template tem tamanho diferente da base');
  }
  const out = new Uint8ClampedArray(base);
  for (let at = 0; at < base.length; at += 4) {
    const mask = MASKS.find((candidate) => candidate.r === template[at]
      && candidate.g === template[at + 1]
      && candidate.b === template[at + 2]
      // Template transparente não pinta nada. Sem isto, um quadro cujo fundo é (0,0,0,0)
      // casaria com nenhuma máscara por acaso — mas (255,0,0,0) casaria com "corpo".
      && (template[at + 3] ?? 0) > 0);
    if (mask === undefined) continue;
    const tint = outfitColor(mask.of(colors));
    out[at] = ((base[at] ?? 0) * tint.r) / 255;
    out[at + 1] = ((base[at + 1] ?? 0) * tint.g) / 255;
    out[at + 2] = ((base[at + 2] ?? 0) * tint.b) / 255;
  }
  return out;
}

/** Uma chave por combinação. A cor sozinha não basta: cada direção e fase é um bitmap. */
export function outfitKey(
  outfitId: number, colors: OutfitColors, direction: number, phase: number,
): string {
  return `${outfitId}:${colors.head},${colors.body},${colors.legs},${colors.feet}:${direction}:${phase}`;
}

export interface OutfitComposerOptions {
  readonly maxBytes: number;
  /** A base e o template daquele quadro, já recortados da folha (FUN-18). */
  readonly layersOf: (
    outfitId: number, direction: number, phase: number,
  ) => Promise<{ base: Uint8ClampedArray; template: Uint8ClampedArray;
    width: number; height: number } | null>;
  readonly createBitmap: (
    pixels: Uint8ClampedArray, width: number, height: number,
  ) => Promise<Sprite>;
  readonly now?: () => number;
}

/**
 * Compõe uma vez e reaproveita.
 *
 * **Recolorir a cada quadro é o caminho fácil e o erro caro.** Numa hunt com party são dezenas
 * de composições por segundo, todas idênticas — o mesmo outfit, as mesmas quatro cores, a
 * mesma direção. Compor é varrer os pixels do quadro inteiro; fazer isso sessenta vezes por
 * segundo por personagem é gastar CPU produzindo a imagem que já estava pronta.
 */
export class OutfitComposer {
  readonly #options: OutfitComposerOptions;
  readonly #budget: BitmapBudget<string>;
  readonly #inFlight = new Map<string, Promise<Sprite | null>>();

  constructor(options: OutfitComposerOptions) {
    this.#options = options;
    this.#budget = new BitmapBudget(options.maxBytes, options.now ?? (() => Date.now()));
  }

  get bytes(): number { return this.#budget.bytes; }

  async get(
    outfitId: number, colors: OutfitColors, direction: number, phase: number,
  ): Promise<Sprite | null> {
    const key = outfitKey(outfitId, colors, direction, phase);
    const cached = this.#budget.get(key);
    if (cached !== undefined) return cached;

    const flying = this.#inFlight.get(key);
    if (flying !== undefined) return flying;

    const promise = this.#compose(key, outfitId, colors, direction, phase)
      .finally(() => { this.#inFlight.delete(key); });
    this.#inFlight.set(key, promise);
    return promise;
  }

  clear(): void { this.#budget.clear(); }

  async #compose(
    key: string, outfitId: number, colors: OutfitColors, direction: number, phase: number,
  ): Promise<Sprite | null> {
    const layers = await this.#options.layersOf(outfitId, direction, phase);
    if (layers === null) return null;
    const painted = colorize(layers.base, layers.template, colors);
    const sprite = await this.#options.createBitmap(painted, layers.width, layers.height);
    this.#budget.put(key, sprite);
    return sprite;
  }
}
