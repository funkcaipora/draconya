import { describe, expect, it, vi } from 'vitest';
import { BitmapBudget, spriteBytes } from './bitmap-budget.js';
import type { Sprite } from './bitmap-budget.js';
import {
  colorize, OUTFIT_COLORS, OutfitComposer, outfitColor, outfitKey,
} from './outfit.js';

class FakeBitmap implements Sprite {
  closed = false;
  constructor(readonly width: number, readonly height: number) {}
  close(): void { this.closed = true; }
}

/**
 * As 133 cores, geradas por uma TRANSLITERAÇÃO LITERAL de `Outfit::getColor` do
 * `opentibiabr/otclient` (MIT) — em Python, sem refatorar nada, e depois coladas aqui.
 *
 * **É a única coisa que prova que a fórmula em `outfit.ts` está certa.** Ela é um refactor da
 * original — sextantes em vez de cinco `if` encadeados —, e refactor de fórmula é onde erro de
 * borda mora. Este teste pegou um: sete cores de matiz vermelho puro saíam MAGENTA, porque a
 * última faixa do original é a continuação da quinta e não um sexto sextante. Nenhum teste de
 * "a paleta tem 133 cores" pegaria isso.
 */
const REFERENCE: readonly (readonly [number, number, number])[] = [
  [255,255,255], [255,212,191], [255,233,191], [255,255,191], [233,255,191], [212,255,191],
  [191,255,191], [191,255,212], [191,255,233], [191,255,255], [191,233,255], [191,212,255],
  [191,191,255], [212,191,255], [233,191,255], [255,191,255], [255,191,233], [255,191,212],
  [255,191,191], [218,218,218], [191,159,143], [191,175,143], [191,191,143], [175,191,143],
  [159,191,143], [143,191,143], [143,191,159], [143,191,175], [143,191,191], [143,175,191],
  [143,159,191], [143,143,191], [159,143,191], [175,143,191], [191,143,191], [191,143,175],
  [191,143,159], [191,143,143], [182,182,182], [191,127,95], [191,159,95], [191,191,95],
  [159,191,95], [127,191,95], [95,191,95], [95,191,127], [95,191,159], [95,191,191],
  [95,159,191], [95,127,191], [95,95,191], [127,95,191], [159,95,191], [191,95,191],
  [191,95,159], [191,95,127], [191,95,95], [145,145,145], [191,106,63], [191,148,63],
  [191,191,63], [148,191,63], [106,191,63], [63,191,63], [63,191,106], [63,191,148],
  [63,191,191], [63,148,191], [63,106,191], [63,63,191], [106,63,191], [148,63,191],
  [191,63,191], [191,63,148], [191,63,106], [191,63,63], [109,109,109], [255,85,0], [255,170,0],
  [255,255,0], [170,255,0], [84,255,0], [0,255,0], [0,255,85], [0,255,169], [0,255,255],
  [0,169,255], [0,84,255], [0,0,255], [84,0,255], [170,0,255], [255,0,255], [255,0,170],
  [255,0,85], [255,0,0], [72,72,72], [191,63,0], [191,127,0], [191,191,0], [127,191,0],
  [63,191,0], [0,191,0], [0,191,63], [0,191,127], [0,191,191], [0,127,191], [0,63,191],
  [0,0,191], [63,0,191], [127,0,191], [191,0,191], [191,0,127], [191,0,63], [191,0,0],
  [36,36,36], [127,42,0], [127,85,0], [127,127,0], [85,127,0], [42,127,0], [0,127,0],
  [0,127,42], [0,127,84], [0,127,127], [0,84,127], [0,42,127], [0,0,127], [42,0,127],
  [85,0,127], [127,0,127], [127,0,85], [127,0,42], [127,0,0],
];

describe('a paleta de outfit (FUN-20)', () => {
  it('as 133 cores batem com a transliteração literal do original', () => {
    const mine = Array.from({ length: OUTFIT_COLORS }, (_, index) => {
      const color = outfitColor(index);
      return [color.r, color.g, color.b];
    });
    expect(mine).toEqual(REFERENCE.map((color) => [...color]));
  });

  it('a coluna sem matiz é a rampa de cinza', () => {
    // Múltiplo de 19: a paleta tem uma coluna de cinzas, do branco ao quase preto.
    for (let index = 0; index < OUTFIT_COLORS; index += 19) {
      const color = outfitColor(index);
      expect(color.r).toBe(color.g);
      expect(color.g).toBe(color.b);
    }
    expect(outfitColor(0)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('índice inválido cai no 0, e NUNCA lança', () => {
    // Cor errada é defeito visual; personagem invisível é bug de jogo. Um índice fora da faixa
    // vem de conteúdo velho ou de alguém mexendo no request, e nenhum dos dois pode apagar
    // alguém da tela.
    const branco = { r: 255, g: 255, b: 255 };
    for (const invalido of [-1, 133, 9_999, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(outfitColor(invalido)).toEqual(branco);
    }
  });
});

describe('colorize (FUN-20)', () => {
  /** Um pixel de base e um de template, lado a lado, em RGBA. */
  const pixels = (...values: readonly (readonly [number, number, number, number])[]) =>
    new Uint8ClampedArray(values.flat());

  const colors = { head: 94, body: 40, legs: 60, feet: 80 };

  it('cada máscara pinta a região dela, e só ela', () => {
    // Amarelo é cabeça, vermelho é corpo, verde é pernas, azul é pés — a ordem vem de
    // `creature.cpp`. Trocar duas faria o jogador pintar a calça e ver o chapéu mudar.
    const base = pixels([255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]);
    const template = pixels([255, 255, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]);
    const painted = colorize(base, template, colors);

    const head = outfitColor(colors.head);
    const body = outfitColor(colors.body);
    expect([painted[0], painted[1], painted[2]]).toEqual([head.r, head.g, head.b]);
    expect([painted[4], painted[5], painted[6]]).toEqual([body.r, body.g, body.b]);
  });

  it('MULTIPLICA, e não substitui — o sombreado da base sobrevive', () => {
    // Substituir a cor devolveria um boneco chapado. Multiplicar preserva claro e escuro do
    // desenho e só troca o matiz, que é o que "recolorir" significa aqui.
    const meio = pixels([128, 128, 128, 255]);
    const template = pixels([255, 0, 0, 255]);
    const painted = colorize(meio, template, { ...colors, body: 0 });
    // Cor 0 é branco puro: multiplicar por ela preserva o cinza da base, em vez de apagá-lo.
    expect([painted[0], painted[1], painted[2]]).toEqual([128, 128, 128]);
  });

  it('pixel fora das quatro máscaras fica INTOCADO', () => {
    // É pele, cabelo e contorno — que não são personalizáveis. Pintá-los daria um personagem
    // com a cara da cor da camisa.
    const base = pixels([200, 100, 50, 255]);
    const template = pixels([123, 45, 67, 255]);
    expect([...colorize(base, template, colors)]).toEqual([200, 100, 50, 255]);
  });

  it('template TRANSPARENTE não pinta nada', () => {
    // O fundo do quadro é (r,g,b,0). Sem olhar o alfa, um fundo (255,0,0,0) casaria com
    // "corpo" e pintaria o vazio ao redor do personagem.
    const base = pixels([200, 100, 50, 255]);
    const template = pixels([255, 0, 0, 0]);
    expect([...colorize(base, template, colors)]).toEqual([200, 100, 50, 255]);
  });

  it('recusa template de tamanho diferente da base', () => {
    // Quadros de tamanhos diferentes significam recorte errado em algum lugar; seguir leria
    // além do fim de um dos dois e pintaria lixo.
    expect(() => colorize(pixels([1, 1, 1, 1]), new Uint8ClampedArray(8), colors))
      .toThrow(/tamanho diferente/);
  });

  it('o alfa da base atravessa sem ser multiplicado', () => {
    // Multiplicar o alfa pela cor apagaria a silhueta: uma cor escura deixaria o personagem
    // semitransparente, que não é o que recolorir faz.
    const base = pixels([255, 255, 255, 200]);
    const template = pixels([255, 0, 0, 255]);
    expect(colorize(base, template, { ...colors, body: 132 })[3]).toBe(200);
  });
});

describe('outfitKey (FUN-20)', () => {
  it('distingue por outfit, por CADA cor, por direção e por fase', () => {
    // A issue pedia chave por `(outfitId, cores)` — mas um bitmap é de UM quadro. Sem direção
    // e fase na chave, o personagem andaria sempre com o mesmo desenho, olhando para o norte.
    const base = { head: 1, body: 2, legs: 3, feet: 4 };
    const chaves = new Set([
      outfitKey(1, base, 0, 0),
      outfitKey(2, base, 0, 0),
      outfitKey(1, { ...base, head: 9 }, 0, 0),
      outfitKey(1, { ...base, body: 9 }, 0, 0),
      outfitKey(1, { ...base, legs: 9 }, 0, 0),
      outfitKey(1, { ...base, feet: 9 }, 0, 0),
      outfitKey(1, base, 1, 0),
      outfitKey(1, base, 0, 1),
    ]);
    expect(chaves.size).toBe(8);
  });
});

describe('OutfitComposer (FUN-20)', () => {
  const layers = (width = 2, height = 2) => ({
    base: new Uint8ClampedArray(width * height * 4).fill(255),
    template: new Uint8ClampedArray(width * height * 4).fill(0),
    width, height,
  });

  const build = (over: Partial<{ maxBytes: number; now: () => number }> = {}) => {
    const created: FakeBitmap[] = [];
    const layersOf = vi.fn(async () => layers());
    const composer = new OutfitComposer({
      maxBytes: over.maxBytes ?? 1_000_000,
      layersOf,
      createBitmap: async (_p, w, h) => { const b = new FakeBitmap(w, h); created.push(b); return b; },
      ...(over.now === undefined ? {} : { now: over.now }),
    });
    return { composer, created, layersOf };
  };

  const colors = { head: 1, body: 2, legs: 3, feet: 4 };

  it('compõe UMA vez para a mesma combinação', () => {
    // Recolorir a cada quadro é o caminho fácil e o erro caro: numa hunt com party são dezenas
    // de composições por segundo, todas idênticas.
    return (async () => {
      const { composer, created } = build();
      await composer.get(1, colors, 0, 0);
      await composer.get(1, colors, 0, 0);
      expect(created).toHaveLength(1);
    })();
  });

  it('dez pedidos SIMULTÂNEOS da mesma combinação compõem uma vez', async () => {
    const { composer, created } = build();
    await Promise.all(Array.from({ length: 10 }, async () => composer.get(1, colors, 0, 0)));
    expect(created).toHaveLength(1);
  });

  it('cor diferente é composição diferente', async () => {
    const { composer, created } = build();
    await composer.get(1, colors, 0, 0);
    await composer.get(1, { ...colors, head: 99 }, 0, 0);
    expect(created).toHaveLength(2);
  });

  it('despeja por bytes e FECHA o despejado', async () => {
    let clock = 0;
    const { composer, created } = build({ maxBytes: spriteBytes(2, 2) * 2, now: () => clock });
    clock = 1; await composer.get(1, colors, 0, 0);
    clock = 2; await composer.get(1, colors, 1, 0);
    clock = 3; await composer.get(1, colors, 2, 0);
    expect(created[0]?.closed).toBe(true);
    expect(composer.bytes).toBe(spriteBytes(2, 2) * 2);
  });

  it('devolve null quando o quadro não existe, sem estourar', async () => {
    const composer = new OutfitComposer({
      maxBytes: 1_000, layersOf: async () => null,
      createBitmap: async () => new FakeBitmap(1, 1),
    });
    expect(await composer.get(1, colors, 0, 0)).toBeNull();
  });

  it('clear() fecha tudo', async () => {
    const { composer, created } = build();
    await composer.get(1, colors, 0, 0);
    composer.clear();
    expect(created[0]?.closed).toBe(true);
    expect(composer.bytes).toBe(0);
  });
});

describe('BitmapBudget (FUN-18, FUN-20)', () => {
  it('recusa orçamento não positivo', () => {
    expect(() => new BitmapBudget(0)).toThrow(/precisa ser positivo/);
  });

  it('bitmap maior que o orçamento inteiro não entra', () => {
    // Guardá-lo despejaria tudo para depois ser despejado ele mesmo.
    const budget = new BitmapBudget<string>(10);
    budget.put('grande', new FakeBitmap(64, 64));
    expect(budget.bytes).toBe(0);
    expect(budget.get('grande')).toBeUndefined();
  });
});
