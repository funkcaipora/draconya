import { describe, expect, it, vi } from 'vitest';
import { outfitColor } from './outfit.js';
import { AssetPack, DIRECTIONS } from './pack.js';
import { spriteBytes } from './sprites.js';
import type { Sprite } from './sprites.js';

/**
 * O pacote inteiro, servido de um objeto em memória.
 *
 * `AssetPack` é a COSTURA entre quatro peças que já têm teste próprio; o que sobra para provar
 * aqui é a costura em si — que o índice guia a folha certa, que a direção vira coluna, e que a
 * fase escolhe o grupo de quadros ANDANDO em vez do parado.
 */
class FakeBitmap implements Sprite {
  closed = false;
  constructor(
    readonly width: number, readonly height: number, readonly pixels: Uint8ClampedArray,
  ) {}
  close(): void { this.closed = true; }
}

/** Um `.dat` de mentira precisa ser protobuf de verdade — o leitor é o real. */
import {
  appearance, appearances as encodeAppearances, frameGroup,
} from './testing.js';

const CATALOG = [
  { type: 'appearances', file: 'app.dat' },
  { type: 'sprite', file: 'folha.bmp.lzma', spritetype: 0, firstspriteid: 1, lastspriteid: 288 },
];

/** Uma faixa de ids consecutivos, para escrever `frameGroup` de 96 quadros sem digitá-los. */
const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

/**
 * Uma criatura com 4 direções paradas e 4 direções × 3 fases andando; um chão com padrão
 * 4×2; e um outfit com a forma do OUTFIT DO JOGADOR no pacote real (id 128 no 1332): quatro
 * direções, três linhas de addon, duas de montaria e duas camadas — é essa forma que a
 * fórmula curta do índice errava.
 */
const DAT = encodeAppearances({
  object: [
    appearance({ id: 357, frameGroups: [frameGroup({ spriteIds: [10] })] }),
    // 4×2 e não 4×4 como a grama real: largura e altura DIFERENTES, para um teste poder
    // distinguir "trocou os dois" de "acertou".
    appearance({
      id: 355,
      frameGroups: [frameGroup({ patternWidth: 4, patternHeight: 2, spriteIds: ids(60, 8) })],
    }),
  ],
  outfit: [
    appearance({
      id: 21,
      frameGroups: [
        frameGroup({ patternWidth: 4, spriteIds: [20, 21, 22, 23] }),
        frameGroup({
          patternWidth: 4, spriteIds: [30, 31, 32, 33, 40, 41, 42, 43, 50, 51, 52, 53],
          phases: [[100, 100], [100, 100], [100, 100]],
        }),
      ],
    }),
    appearance({
      id: 128,
      frameGroups: [
        frameGroup({
          patternWidth: 4, patternHeight: 3, patternDepth: 2, layers: 2, spriteIds: ids(100, 48),
        }),
        frameGroup({
          patternWidth: 4, patternHeight: 3, patternDepth: 2, layers: 2, spriteIds: ids(150, 96),
          phases: [[100, 100], [100, 100]],
        }),
      ],
    }),
  ],
});

type Rgba = readonly [r: number, g: number, b: number, a: number];
type Decode = (file: ArrayBuffer) => Promise<{ width: number; height: number; pixels: Uint8ClampedArray }>;

/**
 * A folha de fixture: 384×768, 288 células de 32×32, e cada célula leva o PRÓPRIO id de
 * sprite nos canais R e G. É o que torna o quadro devolvido conferível — `idOf` lê de volta
 * qual sprite o pacote escolheu, e o teste afirma o id, não só "veio algo".
 *
 * `fills` troca o conteúdo de células escolhidas, para o teste de cor ter uma base e um
 * template de verdade.
 */
const sheetWith = (fills: Readonly<Record<number, Rgba>> = {}) => {
  const width = 384;
  const height = 768;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let id = 1; id <= 288; id++) {
    const [r, g, b, a] = fills[id] ?? [id % 256, Math.floor(id / 256), 0, 255];
    const column = (id - 1) % 12;
    const row = Math.floor((id - 1) / 12);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const at = ((row * 32 + y) * width + column * 32 + x) * 4;
        pixels[at] = r; pixels[at + 1] = g; pixels[at + 2] = b; pixels[at + 3] = a;
      }
    }
  }
  return { width, height, pixels };
};

/** Qual sprite o pacote escolheu, lido de volta do quadro. `-1` para "nenhum". */
const idOf = (sprite: Sprite | null): number => sprite instanceof FakeBitmap
  ? (sprite.pixels[0] ?? 0) + 256 * (sprite.pixels[1] ?? 0)
  : -1;

/** O primeiro pixel de um quadro, para conferir pintura. */
const firstPixel = (sprite: Sprite | null): number[] => sprite instanceof FakeBitmap
  ? [...sprite.pixels.subarray(0, 4)]
  : [];

const build = async (over: Partial<{
  decode: Decode;
  onEvict: (key: number | string, sprite: Sprite) => void;
}> = {}) => {
  const baixadas: string[] = [];
  const fetched = vi.fn(async (url: string | URL | Request) => {
    const name = String(url).split('/').pop() ?? '';
    baixadas.push(name);
    if (name === 'catalog-content.json') return new Response(JSON.stringify(CATALOG));
    if (name === 'app.dat') return new Response(DAT.buffer as ArrayBuffer);
    if (name.endsWith('.bmp.lzma')) return new Response(new ArrayBuffer(8));
    return new Response('', { status: 404 });
  }) as unknown as typeof globalThis.fetch;

  const pack = await AssetPack.load({
    baseUrl: 'https://exemplo/things/1332',
    fetch: fetched,
    loader: { decode: over.decode ?? (async () => sheetWith()) },
    createBitmap: async (p, w, h) => new FakeBitmap(w, h, p),
    ...(over.onEvict === undefined ? {} : { onEvict: over.onEvict }),
  });
  return { pack, baixadas };
};

/** Corpo 94 é vermelho PURO (255, 0, 0): multiplicar por ele zera G e B e preserva R. */
const COLORS = { head: 0, body: 94, legs: 0, feet: 0 };

describe('AssetPack (FUN-23)', () => {
  it('baixa o índice e as aparências, e NÃO baixa folha nenhuma na entrada', async () => {
    // São milhares de folhas e uma tela usa dezenas. Baixar tudo na entrada trocaria "o jogo
    // abre devagar" por "o jogo não abre".
    const { baixadas } = await build();
    expect(baixadas).toEqual(['catalog-content.json', 'app.dat']);
  });

  it('baixa a folha só quando um quadro dela é pedido', async () => {
    const { pack, baixadas } = await build();
    await pack.object(357);
    expect(baixadas).toContain('folha.bmp.lzma');
  });

  it('a DIREÇÃO vira coluna no vetor plano', async () => {
    // A ordem das direções é do PACOTE, não nossa: trocá-la faz o personagem andar de costas,
    // e o defeito só aparece na tela.
    const { pack } = await build();
    for (const direction of DIRECTIONS) {
      expect(await pack.outfit(21, direction, 0)).not.toBeNull();
    }
    expect(DIRECTIONS).toEqual(['north', 'east', 'south', 'west']);
  });

  it('`moving` escolhe o grupo ANDANDO, e a fase 0 dele é um quadro de verdade', async () => {
    // Pedir sempre o grupo parado dá um monstro que desliza sem mexer as patas. E usar
    // "fase 0" como sinônimo de parado — a primeira versão fazia isso — perdia o primeiro
    // quadro do ciclo: oito fases viravam "parado + sete andando", com soluço a cada passo.
    const { pack } = await build();
    const parado = await pack.outfit(21, 'north', 0, false);
    const andandoFase0 = await pack.outfit(21, 'north', 0, true);
    const andandoFase1 = await pack.outfit(21, 'north', 1, true);
    expect(parado).not.toBeNull();
    expect(andandoFase0).not.toBeNull();
    // Três quadros DIFERENTES: parado, andando-0 e andando-1.
    expect(new Set([parado, andandoFase0, andandoFase1]).size).toBe(3);
  });

  it('o índice usa a fórmula COMPLETA: addon e montaria entram antes da fase', async () => {
    // `((((fase × prof + z) × alt + y) × larg + x) × camadas) + camada`, do `appearances.proto`
    // (opentibiabr/otclient, MIT). A conta curta — `(fase × larg + x) × camadas` — só bate
    // quando altura e profundidade são 1, e o outfit do jogador tem 3 linhas de addon e 2 de
    // montaria: a "fase 1" dela caía no addon da fase 0, e o passo animava a roupa errada.
    // Mutação que mata: voltar a `(phase * patternWidth + x) * layers` — dá 150 + 8 = 158.
    const { pack } = await build();
    const perFrame = 4 * 3 * 2 * 2;
    const norteFase1 = await pack.outfit(128, 'north', 1, true);
    expect(idOf(norteFase1)).toBe(150 + perFrame);
    // E a direção continua sendo x, dentro da fase: leste é duas camadas adiante.
    expect(idOf(await pack.outfit(128, 'east', 1, true))).toBe(150 + perFrame + 2);
  });

  it('`object` escolhe o quadro pela POSIÇÃO do tile: x % largura, y % altura', async () => {
    // O chão tem um padrão de variações e o cliente escolhe a de cada tile pela posição —
    // é isso que faz a grama não parecer um azulejo repetido. O padrão da fixture é 4×2 com
    // ids 60..67, indexado por `y × 4 + x`.
    // Mutação que mata: trocar x por y no índice (dá 64 para (1,0)), ou ignorar a posição.
    const { pack } = await build();
    expect(idOf(await pack.object(355, 0, 0))).toBe(60);
    expect(idOf(await pack.object(355, 1, 0))).toBe(61);
    expect(idOf(await pack.object(355, 0, 1))).toBe(64);
    expect(idOf(await pack.object(355, 3, 1))).toBe(67);
    // Fora do padrão, dá a volta: x = 5 num padrão de 4 é a coluna 1, e y = 3 num de 2 é a
    // linha 1 — o MESMO bitmap, não uma cópia dele.
    expect(await pack.object(355, 5, 0)).toBe(await pack.object(355, 1, 0));
    expect(await pack.object(355, 0, 3)).toBe(await pack.object(355, 0, 1));
    // Sem posição é (0, 0): objeto que não é chão continua funcionando como antes.
    expect(idOf(await pack.object(357))).toBe(10);
  });

  it('`objectPattern` diz as dimensões do padrão, e {1, 1} para o que não existe', async () => {
    // É a chave de cache do viewport: um mapa inteiro de grama 4×4 são dezesseis pedidos, não
    // um por tile. Para id inexistente, {1, 1} — toda posição cai no mesmo `null`.
    // Mutação que mata: devolver `patternHeight` como largura (a fixture é 4×2, não quadrada).
    const { pack } = await build();
    expect(pack.objectPattern(355)).toEqual({ width: 4, height: 2 });
    expect(pack.objectPattern(357)).toEqual({ width: 1, height: 1 });
    expect(pack.objectPattern(99_999)).toEqual({ width: 1, height: 1 });
  });

  it('`outfit` com cores sai PINTADO: o vermelho do template multiplica a cor do corpo', async () => {
    // Base (id 100) cinza a 128; template (id 101) vermelho puro, que é a máscara de CORPO.
    // Corpo 94 é (255, 0, 0): o pixel sai (128, 0, 0) — R preservado pela multiplicação, G
    // e B zerados. Substituir daria (255, 0, 0); não pintar daria (128, 128, 128).
    // Mutação que mata: `LAYER_TEMPLATE = 0` (base nas duas camadas), ou trocar base e
    // template na chamada de `colorize`.
    const { pack } = await build({
      decode: async () => sheetWith({ 100: [128, 128, 128, 255], 101: [255, 0, 0, 255] }),
    });
    const tint = outfitColor(COLORS.body);
    expect([tint.r, tint.g, tint.b]).toEqual([255, 0, 0]);
    const pintado = await pack.outfit(128, 'north', 0, false, COLORS);
    expect(firstPixel(pintado)).toEqual([128, 0, 0, 255]);
  });

  it('sem cores, ou com uma camada só, sai a BASE como está', async () => {
    // Monstro não tem cor de jogador, e um outfit de uma camada não tem template: nos dois
    // casos o quadro é o da folha, direto do fatiador — o MESMO bitmap que sem cores, não
    // uma composição que por acaso ficou igual.
    // Mutação que mata: `group.layers >= 1` no lugar de `>= 2` em `outfit`.
    const { pack } = await build({
      decode: async () => sheetWith({ 100: [128, 128, 128, 255], 101: [255, 0, 0, 255] }),
    });
    expect(firstPixel(await pack.outfit(128, 'north', 0))).toEqual([128, 128, 128, 255]);
    const semCores = await pack.outfit(21, 'north', 0);
    expect(idOf(semCores)).toBe(20);
    expect(await pack.outfit(21, 'north', 0, false, COLORS)).toBe(semCores);
  });

  it('parado fase 0 e andando fase 0 com as mesmas cores NÃO colidem no cache', async () => {
    // Os dois grupos têm uma fase 0, na mesma direção, com as mesmas quatro cores. Se o grupo
    // não entra na chave da composição, o segundo pedido recebe o bitmap do primeiro — e o
    // personagem congela no primeiro quadro de cada passo, sem erro em lugar nenhum.
    // Mutação que mata: passar sempre `0` como grupo para `#composer.get`.
    const { pack } = await build();
    const parado = await pack.outfit(128, 'north', 0, false, COLORS);
    const andando = await pack.outfit(128, 'north', 0, true, COLORS);
    expect(parado).not.toBeNull();
    expect(parado).not.toBe(andando);
    // E cada um foi composto sobre a base do PRÓPRIO grupo: 100 parado, 150 andando.
    expect(idOf(parado)).toBe(100);
    expect(idOf(andando)).toBe(150);
  });

  it('com cores, direção e fase chegam ao compositor — não só o grupo', async () => {
    // O viewport pede TODA criatura com cores, então para o outfit do jogador o caminho
    // pintado é o único que o jogo exercita. Os testes acima só pedem `north` na fase 0, e
    // uma mutação que passasse direção 0 ou fase 0 ao compositor passava em todos: o
    // jogador olhando para leste sairia desenhado de costas, e o passo congelaria no
    // primeiro quadro. Mutação que mata: `0` no lugar de `DIRECTIONS.indexOf(direction)` ou
    // de `phase` na chamada de `#composer.get`, ou os mesmos zeros dentro de `#layersOf`.
    const { pack } = await build();
    const perFrame = 4 * 3 * 2 * 2;
    expect(idOf(await pack.outfit(128, 'east', 0, false, COLORS))).toBe(100 + 2);
    expect(idOf(await pack.outfit(128, 'south', 0, false, COLORS))).toBe(100 + 4);
    expect(idOf(await pack.outfit(128, 'north', 1, true, COLORS))).toBe(150 + perFrame);
    expect(idOf(await pack.outfit(128, 'west', 1, true, COLORS))).toBe(150 + perFrame + 6);
  });

  it('a composição é guardada pelo quadro RESOLVIDO, não pela fase crua', async () => {
    // `indexOf` dá a volta na fase (`% frames`) e na direção; se a chave do compositor não
    // der a mesma volta, três pedidos que caem no mesmo quadro viram três composições e
    // três entradas no orçamento — o caminho cru colapsa as três num bitmap só.
    // Mutação que mata: passar `phase` cru (sem `% frames`) para `#composer.get`.
    const { pack } = await build();
    const fase0 = await pack.outfit(128, 'north', 0, true, COLORS);
    const fase2 = await pack.outfit(128, 'north', 2, true, COLORS);
    expect(fase2).toBe(fase0);
    expect(pack.bytes).toBe(spriteBytes(32, 32));
  });

  it('clear() fecha as composições também, e `bytes` as conta', async () => {
    // Esquecer o compositor no `clear()` vaza só os personagens — o vazamento que ninguém
    // acha, porque o chão sumiu direito. Os pixels crus das camadas NÃO entram no orçamento;
    // o que ocupa memória de GPU é o bitmap composto.
    // Mutação que mata: tirar `this.#composer.clear()` de `clear()`, ou `#composer.bytes`
    // de `bytes`.
    const { pack } = await build();
    // Primeiro um quadro cru, depois um pintado: `bytes` tem que somar os DOIS orçamentos.
    // Só o pintado não distinguiria "soma" de "só o compositor" — os pixels crus que a
    // composição lê não entram no orçamento do fatiador.
    const cru = await pack.object(357);
    expect(pack.bytes).toBe(spriteBytes(32, 32));
    const pintado = await pack.outfit(128, 'north', 0, false, COLORS);
    expect(pack.bytes).toBe(2 * spriteBytes(32, 32));
    pack.clear();
    expect((cru as FakeBitmap).closed).toBe(true);
    expect((pintado as FakeBitmap).closed).toBe(true);
    expect(pack.bytes).toBe(0);
  });

  it('avisa por onEvict também pelas composições, com o bitmap ainda vivo', async () => {
    // O viewport constrói `Texture` sobre o composto exatamente como sobre um quadro da
    // folha; sem o aviso, a textura fica sobre um bitmap fechado e desenha lixo.
    // Mutação que mata: não repassar `onEvict` ao `OutfitComposer`.
    const avisos: Array<{ key: number | string; closedAtNotice: boolean }> = [];
    const { pack } = await build({
      onEvict: (key, sprite) => { avisos.push({ key, closedAtNotice: (sprite as FakeBitmap).closed }); },
    });
    await pack.outfit(128, 'north', 0, false, COLORS);
    pack.clear();
    expect(avisos).toHaveLength(1);
    expect(typeof avisos[0]?.key).toBe('string');
    expect(avisos[0]?.closedAtNotice).toBe(false);
  });

  it('framesOf diz em quantas fases dividir o passo', async () => {
    // Sem isto o viewport não tem como mapear o progresso do passo em quadro; o `% frames`
    // dentro da caixa acontece tarde demais.
    const { pack } = await build();
    expect(pack.framesOf(21, true)).toBe(3);
    expect(pack.framesOf(21, false)).toBe(1);
    expect(pack.framesOf(99_999, true)).toBe(1);
  });

  it('avisa por onEvict ANTES de fechar o bitmap despejado', async () => {
    // O viewport constrói Texture sobre o bitmap; se ele fecha sem aviso, a textura vira
    // inválida por baixo e desenha lixo. O aviso tem que chegar com o bitmap ainda vivo.
    const avisos: Array<{ id: number | string; closedAtNotice: boolean }> = [];
    const fetched = (async (url: string | URL | Request) => {
      const name = String(url).split('/').pop() ?? '';
      if (name === 'catalog-content.json') return new Response(JSON.stringify(CATALOG));
      if (name === 'app.dat') return new Response(DAT.buffer as ArrayBuffer);
      return new Response(new ArrayBuffer(8));
    }) as unknown as typeof fetch;
    const pack = await AssetPack.load({
      baseUrl: 'https://exemplo/things/1332', fetch: fetched,
      // Cabe UM quadro de 32×32: o segundo despeja o primeiro.
      maxBytes: 32 * 32 * 4,
      loader: { decode: async () => sheetWith() },
      createBitmap: async (p, w, h) => new FakeBitmap(w, h, p),
      onEvict: (id, sprite) => { avisos.push({ id, closedAtNotice: (sprite as FakeBitmap).closed }); },
    });
    await pack.outfit(21, 'north', 0, false);
    await pack.outfit(21, 'east', 0, false);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.closedAtNotice).toBe(false);
  });

  it('devolve null para aparência que não existe', async () => {
    // Conteúdo apontando arte que saiu do pacote. Uma criatura sem sprite é melhor que uma
    // tela que não abre.
    const { pack } = await build();
    expect(await pack.object(99_999)).toBeNull();
    expect(await pack.outfit(99_999, 'north', 0)).toBeNull();
    expect(await pack.outfit(99_999, 'north', 0, false, COLORS)).toBeNull();
  });

  it('recusa índice que o servidor não entregou', async () => {
    const fetched = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(AssetPack.load({
      baseUrl: 'https://exemplo/things/1332', fetch: fetched,
      loader: { decode: async () => ({ width: 1, height: 1, pixels: new Uint8ClampedArray(4) }) },
      createBitmap: async (p) => new FakeBitmap(1, 1, p),
    })).rejects.toThrow(/catalog-content\.json respondeu 500/);
  });
});
