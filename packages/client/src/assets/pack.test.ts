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
  { type: 'sprite', file: 'grande.bmp.lzma', spritetype: 3, firstspriteid: 300, lastspriteid: 335 },
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
    // Um objeto grande: o primeiro sprite mora na folha de `spritetype` 3 (64×64), e a
    // `objectSize` tem que sair em TILES — `{2, 2}`, não `{64, 64}`.
    appearance({ id: 358, frameGroups: [frameGroup({ spriteIds: [300] })] }),
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
  // Um efeito de três fases com durações DIFERENTES, e mínimo diferente do máximo: é o que
  // separa "leu o mínimo de cada fase" de "leu o máximo" e de "leu a primeira três vezes".
  effect: [
    appearance({
      id: 12,
      frameGroups: [frameGroup({
        spriteIds: [200, 201, 202], phases: [[100, 200], [150, 300], [250, 400]],
      })],
    }),
    appearance({ id: 13, frameGroups: [frameGroup({ spriteIds: [205] })] }),
    // E um efeito de UMA fase só, com duração: é diferente de "sem animação" (o 13, sem
    // `phases`), e a diferença é o que um `length <= 1` no lugar de `=== 0` apagaria.
    appearance({
      id: 14, frameGroups: [frameGroup({ spriteIds: [206], phases: [[500, 500]] })],
    }),
  ],
  // Um projétil com o padrão 3×3 do pacote real: ids 210..218, indexados por `y × 3 + x`.
  missile: [
    appearance({
      id: 5,
      frameGroups: [frameGroup({ patternWidth: 3, patternHeight: 3, spriteIds: ids(210, 9) })],
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

  it('`objectSize` sai em TILES, pela folha em que mora o PRIMEIRO sprite (M23, D3)', async () => {
    // A dimensão é a RESERVA da classificação de camada: um objeto passável sem flag que mede
    // mais de um tile transborda para o vizinho e precisa de ordem espacial. Ela vem da
    // geometria que o catálogo já declara por `spritetype` — 0 é 32×32, 3 é 64×64 —, então é
    // síncrona e não baixa folha nenhuma.
    // Mutação que mata: devolver pixels (`{64, 64}`), ou procurar a folha errada por `<` no
    // lugar de `<=` na faixa; ou id desconhecido lançando em vez de `{1, 1}`.
    const { pack, baixadas } = await build();
    expect(pack.objectSize(358)).toEqual({ width: 2, height: 2 });
    expect(pack.objectSize(357)).toEqual({ width: 1, height: 1 });
    expect(pack.objectSize(99_999)).toEqual({ width: 1, height: 1 });
    expect(baixadas).toEqual(['catalog-content.json', 'app.dat']);
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

  it('`effect` anda pela FASE, e só por ela (FUN-106)', async () => {
    // Efeito não tem direção nem addon: o padrão é todo zero e o que escolhe o quadro é a
    // fase. Mutação que mata: `phase: 0` fixo na chamada de `#frame`.
    const { pack } = await build();
    expect(idOf(await pack.effect(12, 0))).toBe(200);
    expect(idOf(await pack.effect(12, 1))).toBe(201);
    expect(idOf(await pack.effect(12, 2))).toBe(202);
    // Fase além do fim dá a volta, como no outfit: o viewport nunca pede, mas não pode explodir.
    expect(idOf(await pack.effect(12, 3))).toBe(200);
  });

  it('`effectPhases` é a duração MÍNIMA de cada fase, na ordem (FUN-106)', async () => {
    // Mutação que mata: `durationMaxMs` no lugar de `durationMinMs` — daria [200, 300, 400].
    const { pack } = await build();
    expect(pack.effectPhases(12)).toEqual([100, 150, 250]);
  });

  it('`effectPhases` é vazio para efeito sem animação e para id que não existe', async () => {
    // O viewport decide o que fazer com um efeito sem tempo; o pacote só diz que não tem.
    const { pack } = await build();
    expect(pack.effectPhases(13)).toEqual([]);
    expect(pack.effectPhases(99_999)).toEqual([]);
  });

  it('`effectPhases` de um efeito de UMA fase é essa fase, não vazio', async () => {
    // Uma fase com duração é uma linha do tempo de verdade: o efeito toca 500 ms e acaba.
    // Devolver vazio aqui mandaria o viewport para a linha de reserva (300 ms), e o efeito
    // acabaria antes da hora sem nada acusar — o teste de três fases não distingue "vazio
    // só para zero fases" de "vazio para uma fase ou menos".
    // Mutação que mata: `group.phases.length <= 1 ? [] : …` em `effectPhases`.
    const { pack } = await build();
    expect(pack.effectPhases(14)).toEqual([500]);
  });

  it('`missile` escolhe a célula do 3×3 pela DIREÇÃO do voo (FUN-106)', async () => {
    // A coluna é o sentido horizontal (0 oeste, 1 nenhum, 2 leste) e a linha é o vertical
    // (0 norte, 1 nenhum, 2 sul), como o cliente do Tibia guarda. Os ids da fixture são
    // `210 + y × 3 + x`. Mutação que mata: trocar x por y na chamada de `#frame` — leste
    // (1, 0) daria 217 em vez de 215.
    const { pack } = await build();
    expect(idOf(await pack.missile(5, 1, 0))).toBe(215); // leste: (2, 1)
    expect(idOf(await pack.missile(5, 0, 1))).toBe(217); // sul: (1, 2)
    expect(idOf(await pack.missile(5, -1, 0))).toBe(213); // oeste: (0, 1)
    expect(idOf(await pack.missile(5, 0, -1))).toBe(211); // norte: (1, 0)
    expect(idOf(await pack.missile(5, 1, 1))).toBe(218); // sudeste: (2, 2)
    expect(idOf(await pack.missile(5, -1, -1))).toBe(210); // noroeste: (0, 0)
    expect(idOf(await pack.missile(5, 0, 0))).toBe(214); // parado: o meio
  });

  it('`missile` escolhe pelo OCTANTE, não pelo sinal: (3, 1) é quase horizontal e sai de leste', async () => {
    // O pacote tem oito direções, uma a cada 45°. Um tiro de (3, 1) está a 18°, e o quadro
    // dele é o de leste — pelo sinal sairia o de sudeste, torto em relação ao voo. É a regra
    // de `Position::getDirectionFromPosition` do OTClient: o eixo maior manda quando é mais
    // que o dobro do menor; senão é diagonal. E a distância continua não importando: três
    // tiles a leste e um são o MESMO bitmap.
    // Mutação que mata: voltar ao sinal (`{ x: side(dx), y: side(dy) }` sem os dois `if`) —
    // (3, 1) daria 218 e (1, 3) daria 218 também.
    const { pack } = await build();
    expect(await pack.missile(5, 3, 0)).toBe(await pack.missile(5, 1, 0));
    expect(idOf(await pack.missile(5, 3, 1))).toBe(215); // leste: (2, 1)
    expect(idOf(await pack.missile(5, 1, 3))).toBe(217); // sul: (1, 2)
    expect(idOf(await pack.missile(5, 2, 2))).toBe(218); // sudeste: (2, 2)
    // Na fronteira, (2, 1) ainda é diagonal: `>`, não `>=` — 26° está mais perto de 45° do que
    // de 0°. Mutação que mata: `ax >= 2 * ay`.
    expect(idOf(await pack.missile(5, 2, 1))).toBe(218);
    expect(idOf(await pack.missile(5, -3, 1))).toBe(213); // oeste: (0, 1)
    expect(idOf(await pack.missile(5, 1, -3))).toBe(211); // norte: (1, 0)
  });

  it('devolve null para aparência que não existe', async () => {
    // Conteúdo apontando arte que saiu do pacote. Uma criatura sem sprite é melhor que uma
    // tela que não abre.
    const { pack } = await build();
    expect(await pack.object(99_999)).toBeNull();
    expect(await pack.outfit(99_999, 'north', 0)).toBeNull();
    expect(await pack.outfit(99_999, 'north', 0, false, COLORS)).toBeNull();
    expect(await pack.effect(99_999, 0)).toBeNull();
    expect(await pack.missile(99_999, 1, 0)).toBeNull();
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

describe('warmOutfit (FUN-112)', () => {
  it('pede todos os quadros do outfit: a folha é baixada UMA vez, e depois todo quadro vem do cache', async () => {
    // O rato era um quadrado por seis a dez segundos na primeira entrada: cada folha só
    // decodificava quando o primeiro quadro dela era desenhado. Mutação que mata: aquecer
    // só o grupo parado (o quadro andando abaixo voltaria a pedir folha), ou só a base de um
    // outfit de duas camadas.
    const decode = vi.fn(async () => sheetWith());
    const { pack, baixadas } = await build({ decode });
    const downloads = () => baixadas.filter((name) => name === 'folha.bmp.lzma').length;
    // Dezesseis quadros do rato numa folha só: a folha desce UMA vez (a cache deduplica o voo).
    await pack.warmOutfit(21);
    expect(downloads()).toBe(1);
    expect(decode).toHaveBeenCalledTimes(1);

    // Parado e andando, todas as direções: nada disto volta à rede nem ao decoder.
    for (const direction of DIRECTIONS) {
      expect(await pack.outfit(21, direction, 0, false)).not.toBeNull();
      expect(await pack.outfit(21, direction, 2, true)).not.toBeNull();
    }
    expect(downloads()).toBe(1);
    expect(decode).toHaveBeenCalledTimes(1);

    // O outfit de DUAS camadas aquece base E template. O quadro pintado passa por `pixels()`,
    // que volta à folha — no navegador, à cópia decodificada no IndexedDB (FUN-19), que é o
    // que o aquecimento enche; aqui, sem IndexedDB, à rede. O que se prende é que o
    // aquecimento pediu a folha do 128 (que é a mesma do fixture) e não lançou.
    await pack.warmOutfit(128);
    expect(downloads()).toBeGreaterThanOrEqual(2);
    expect(await pack.outfit(128, 'south', 0, false, COLORS)).not.toBeNull();
  });

  it('aquece a BASE e o TEMPLATE de um outfit de duas camadas — um bitmap por quadro por camada', async () => {
    // O template é o que o compositor multiplica pela cor; aquecer só a base deixaria metade
    // das folhas do jogador para a primeira pintura. Contado em bitmaps criados, porque é o
    // único lado observável sem IndexedDB. Mutação que mata: `const layers = [LAYER_BASE]`.
    let created = 0;
    const fetched = vi.fn(async (url: string | URL | Request) => {
      const name = String(url).split('/').pop() ?? '';
      if (name === 'catalog-content.json') return new Response(JSON.stringify(CATALOG));
      if (name === 'app.dat') return new Response(DAT.buffer as ArrayBuffer);
      return new Response(new ArrayBuffer(8));
    }) as unknown as typeof globalThis.fetch;
    const pack = await AssetPack.load({
      baseUrl: 'https://exemplo/things/1332', fetch: fetched,
      loader: { decode: async () => sheetWith() },
      createBitmap: async (p, w, h) => { created += 1; return new FakeBitmap(w, h, p); },
    });
    // O 21 tem uma camada: 4 parado + 4 × 3 andando = 16 quadros, 16 bitmaps.
    await pack.warmOutfit(21);
    expect(created).toBe(16);
    // O 128 tem duas: (4 parado + 4 × 2 andando) × 2 camadas = 24 bitmaps a mais.
    await pack.warmOutfit(128);
    expect(created).toBe(16 + 24);
  });

  it('outfit que o pacote não tem não pede nada', async () => {
    const { pack, baixadas } = await build();
    await pack.warmOutfit(9_999);
    expect(baixadas).toEqual(['catalog-content.json', 'app.dat']);
  });

  it('folha que não abre não derruba o aquecimento', async () => {
    const { pack } = await build({ decode: async () => { throw new Error('LZMA corrompido'); } });
    await expect(pack.warmOutfit(21)).resolves.toBeUndefined();
  });
});
