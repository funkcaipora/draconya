import { describe, expect, it, vi } from 'vitest';
import { AssetPack, DIRECTIONS } from './pack.js';
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
  constructor(readonly width: number, readonly height: number) {}
  close(): void { this.closed = true; }
}

/** Um `.dat` de mentira precisa ser protobuf de verdade — o leitor é o real. */
import {
  appearance, appearances as encodeAppearances, frameGroup,
} from './testing.js';

const CATALOG = [
  { type: 'appearances', file: 'app.dat' },
  { type: 'sprite', file: 'folha.bmp.lzma', spritetype: 0, firstspriteid: 1, lastspriteid: 144 },
];

/** Uma criatura com 4 direções paradas e 4 direções × 3 fases andando. */
const DAT = encodeAppearances({
  object: [appearance({ id: 357, frameGroups: [frameGroup({ spriteIds: [10] })] })],
  outfit: [appearance({
    id: 21,
    frameGroups: [
      frameGroup({ patternWidth: 4, spriteIds: [20, 21, 22, 23] }),
      frameGroup({
        patternWidth: 4, spriteIds: [30, 31, 32, 33, 40, 41, 42, 43, 50, 51, 52, 53],
        phases: [[100, 100], [100, 100], [100, 100]],
      }),
    ],
  })],
});

type Decode = (file: ArrayBuffer) => Promise<{ width: number; height: number; pixels: Uint8ClampedArray }>;

const build = async (over: Partial<{ decode: Decode }> = {}) => {
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
    loader: { decode: over.decode ?? (async () => ({
      width: 384, height: 384, pixels: new Uint8ClampedArray(384 * 384 * 4),
    })) },
    createBitmap: async (_p, w, h) => new FakeBitmap(w, h),
  });
  return { pack, baixadas };
};

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

  it('fase 0 usa o grupo PARADO; fase > 0 usa o grupo ANDANDO', async () => {
    // Pedir sempre o grupo 0 dá um monstro que desliza pelo chão sem mexer as patas — o
    // defeito clássico de ligar sprite antes de ligar `frameGroups`.
    const decode = vi.fn(async () => ({
      width: 384, height: 384, pixels: new Uint8ClampedArray(384 * 384 * 4),
    }));
    const { pack } = await build({ decode });
    const parado = await pack.outfit(21, 'north', 0);
    const andando = await pack.outfit(21, 'north', 1);
    expect(parado).not.toBeNull();
    expect(andando).not.toBeNull();
    // Quadros diferentes, e não o mesmo bitmap servido duas vezes.
    expect(parado).not.toBe(andando);
  });

  it('devolve null para aparência que não existe', async () => {
    // Conteúdo apontando arte que saiu do pacote. Uma criatura sem sprite é melhor que uma
    // tela que não abre.
    const { pack } = await build();
    expect(await pack.object(99_999)).toBeNull();
    expect(await pack.outfit(99_999, 'north', 0)).toBeNull();
  });

  it('recusa índice que o servidor não entregou', async () => {
    const fetched = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(AssetPack.load({
      baseUrl: 'https://exemplo/things/1332', fetch: fetched,
      loader: { decode: async () => ({ width: 1, height: 1, pixels: new Uint8ClampedArray(4) }) },
      createBitmap: async () => new FakeBitmap(1, 1),
    })).rejects.toThrow(/catalog-content\.json respondeu 500/);
  });
});
