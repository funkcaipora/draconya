import { describe, expect, it, vi } from 'vitest';
import { readCatalog } from './catalog.js';
import { cutOut, SpriteCache, spriteBytes } from './sprites.js';
import type { SheetPixels, Sprite } from './sprites.js';

/**
 * Um `ImageBitmap` de mentira que sabe dizer se foi fechado.
 *
 * `close()` é o que este arquivo mais verifica, e não por capricho: `ImageBitmap` segura
 * memória de GPU que o coletor não recolhe. Um cache que respeita o teto e não fecha vaza
 * exatamente igual a um que não tem teto — e o sintoma é o navegador ficando lento, não o jogo.
 */
class FakeBitmap implements Sprite {
  closed = false;
  constructor(readonly width: number, readonly height: number) {}
  close(): void { this.closed = true; }
}

const catalog = (...over: readonly Record<string, unknown>[]) => readCatalog([
  { type: 'appearances', file: 'a.dat' },
  ...(over.length > 0 ? over : [{
    type: 'sprite', file: 'folha-a.bmp.lzma',
    spritetype: 0, firstspriteid: 100, lastspriteid: 243,
  }]),
]);

/** Uma folha 384×384 em que cada pixel guarda a própria coluna, para o recorte ser conferível. */
const sheetPixels = (width = 384, height = 384): SheetPixels => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      pixels[at] = x % 256;
      pixels[at + 1] = y % 256;
      pixels[at + 2] = 0;
      pixels[at + 3] = 255;
    }
  }
  return { width, height, pixels };
};

const build = (options: Partial<{
  maxBytes: number;
  loadSheet: (file: string) => Promise<SheetPixels>;
  createBitmap: (p: Uint8ClampedArray, w: number, h: number) => Promise<Sprite>;
  now: () => number;
  catalog: ReturnType<typeof catalog>;
}> = {}) => {
  const created: FakeBitmap[] = [];
  const cache = new SpriteCache(options.catalog ?? catalog(), {
    maxBytes: options.maxBytes ?? 1_000_000,
    loadSheet: options.loadSheet ?? (async () => sheetPixels()),
    createBitmap: options.createBitmap ?? (async (_p, w, h) => {
      const bitmap = new FakeBitmap(w, h);
      created.push(bitmap);
      return bitmap;
    }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { cache, created };
};

describe('cutOut (FUN-18)', () => {
  it('recorta o quadro na posição certa, linha a linha', () => {
    // O pixel guarda a própria coluna e linha, então o recorte é conferível a olho: o canto
    // superior esquerdo de um quadro em (64, 32) tem que ler (64, 32).
    const frame = cutOut(sheetPixels(), 64, 32, 32, 32);
    expect(frame?.[0]).toBe(64);
    expect(frame?.[1]).toBe(32);
    // E o pixel seguinte na mesma linha avança uma coluna, não uma linha inteira.
    expect(frame?.[4]).toBe(65);
    expect(frame?.[5]).toBe(32);
    // O começo da segunda linha do QUADRO é a linha seguinte da FOLHA, mesma coluna.
    expect(frame?.[32 * 4]).toBe(64);
    expect(frame?.[32 * 4 + 1]).toBe(33);
  });

  it('devolve o tamanho exato do quadro, e não da folha', () => {
    expect(cutOut(sheetPixels(), 0, 0, 64, 64)).toHaveLength(64 * 64 * 4);
  });

  it('devolve null quando o recorte cai fora da folha', () => {
    // Uma folha menor que o índice diz — pacote truncado no download. Recortar assim mesmo
    // leria bytes de outro quadro e desenharia arte errada sem erro nenhum.
    const pequena = sheetPixels(64, 64);
    expect(cutOut(pequena, 32, 32, 64, 64)).toBeNull();
    expect(cutOut(pequena, -1, 0, 32, 32)).toBeNull();
  });
});

describe('SpriteCache (FUN-18)', () => {
  it('resolve um id para o quadro da folha certa', async () => {
    const { cache } = build();
    const sprite = await cache.get(100);
    expect(sprite?.width).toBe(32);
    expect(sprite?.height).toBe(32);
  });

  it('devolve null para id que nenhuma folha cobre', async () => {
    // Conteúdo desatualizado apontando arte que saiu do pacote. Uma criatura sem sprite é
    // melhor que uma tela que não abre.
    expect(await build().cache.get(99)).toBeNull();
  });

  it('serve as quatro geometrias, com as colunas de cada uma', async () => {
    // 32×32 em 12 colunas, 32×64 em 12, 64×32 em 6, 64×64 em 6 (§13.1). Errar a geometria
    // desenha metade de um sprite com metade do vizinho, e o erro só aparece na tela.
    for (const [spritetype, width, height] of [[0, 32, 32], [1, 32, 64], [2, 64, 32], [3, 64, 64]] as const) {
      const { cache } = build({
        catalog: catalog({
          type: 'sprite', file: 'f.bmp.lzma', spritetype,
          firstspriteid: 1, lastspriteid: 36,
        }),
      });
      const sprite = await cache.get(1);
      expect([sprite?.width, sprite?.height]).toEqual([width, height]);
    }
  });

  it('o MESMO id pedido duas vezes cria UM bitmap', async () => {
    const { cache, created } = build();
    await cache.get(100);
    await cache.get(100);
    expect(created).toHaveLength(1);
  });

  it('dez pedidos SIMULTÂNEOS do mesmo quadro criam um bitmap', async () => {
    // Sem deduplicação em voo, uma tela que entra com dez criaturas iguais decodifica dez
    // vezes e cria dez bitmaps — e nove deles vazam, porque só um fica no cache.
    const { cache, created } = build();
    const todos = await Promise.all(Array.from({ length: 10 }, async () => cache.get(100)));
    expect(created).toHaveLength(1);
    expect(new Set(todos).size).toBe(1);
  });

  it('dez quadros da MESMA folha a carregam uma vez', async () => {
    // A folha é o insumo caro: baixar e descomprimir. Dez quadros dela pedidos juntos não
    // podem pagar isso dez vezes.
    const loadSheet = vi.fn(async () => sheetPixels());
    const { cache } = build({ loadSheet });
    await Promise.all([100, 101, 102, 103, 104].map(async (id) => cache.get(id)));
    expect(loadSheet).toHaveBeenCalledTimes(1);
  });

  it('DESPEJA por bytes, e o despejado é FECHADO', async () => {
    // Sem `close()`, o cache respeita o teto e vaza igual — `ImageBitmap` segura memória de
    // GPU que o coletor não recolhe, e o sintoma é o navegador lento, não o jogo.
    let clock = 0;
    const { cache, created } = build({ maxBytes: spriteBytes(32, 32) * 2, now: () => clock });
    clock = 1; await cache.get(100);
    clock = 2; await cache.get(101);
    clock = 3; await cache.get(102);

    expect(created[0]?.closed).toBe(true);
    expect(created[1]?.closed).toBe(false);
    expect(cache.bytes).toBe(spriteBytes(32, 32) * 2);
  });

  it('o orçamento é em BYTES, não em contagem de quadros', async () => {
    // Um 64×64 ocupa QUATRO 32×32. Contar itens faria o teto real variar por um fator de
    // quatro conforme o que estivesse em cena — e o estouro chegaria numa hunt cheia de
    // monstros grandes, que é justamente quando não se pode engasgar.
    const grande = catalog({
      type: 'sprite', file: 'g.bmp.lzma', spritetype: 3, firstspriteid: 1, lastspriteid: 36,
    });
    const { cache } = build({ catalog: grande, maxBytes: spriteBytes(64, 64) * 2 });
    await cache.get(1);
    await cache.get(2);
    await cache.get(3);
    // Três quadros de 64×64 não cabem em dois; se o teto fosse por contagem, caberiam.
    expect(cache.bytes).toBe(spriteBytes(64, 64) * 2);
  });

  it('reler MARCA o uso, e o despejo respeita isso', async () => {
    let clock = 0;
    const { cache, created } = build({ maxBytes: spriteBytes(32, 32) * 2, now: () => clock });
    clock = 1; await cache.get(100);
    clock = 2; await cache.get(101);
    clock = 3; await cache.get(100);
    clock = 4; await cache.get(102);
    // O 100 foi relido e deixou de ser o mais antigo; quem sai é o 101.
    expect(created[0]?.closed).toBe(false);
    expect(created[1]?.closed).toBe(true);
  });

  it('quadro maior que o orçamento inteiro é ENTREGUE, mas não guardado', async () => {
    // Guardá-lo despejaria tudo para depois ser despejado ele mesmo. Quem pediu recebe.
    const { cache } = build({ maxBytes: 10 });
    const sprite = await cache.get(100);
    expect(sprite).not.toBeNull();
    expect(cache.bytes).toBe(0);
  });

  it('clear() FECHA tudo', async () => {
    // Trocar de mapa sem isto vaza a memória de GPU da tela anterior inteira.
    const { cache, created } = build();
    await cache.get(100);
    await cache.get(101);
    cache.clear();
    expect(created.every((bitmap) => bitmap.closed)).toBe(true);
    expect(cache.bytes).toBe(0);
  });

  it('recusa orçamento não positivo na construção', () => {
    expect(() => new SpriteCache(catalog(), {
      maxBytes: 0, loadSheet: async () => sheetPixels(), createBitmap: async () => new FakeBitmap(1, 1),
    })).toThrow(/precisa ser positivo/);
  });

  it('folha menor do que o índice promete devolve null, não arte errada', async () => {
    // Pacote truncado no download: o índice diz que o quadro está em (0, 352), mas a folha
    // acaba antes. Recortar assim mesmo leria bytes de outro lugar.
    const { cache } = build({ loadSheet: async () => sheetPixels(64, 64) });
    expect(await cache.get(200)).toBeNull();
  });
});
