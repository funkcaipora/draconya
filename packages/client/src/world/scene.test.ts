import { buildTilemap } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { loadStackMap, sceneFromStack, sceneFromTilemap } from './scene.js';
import type { StackMap } from './scene.js';

const stack: StackMap = {
  id: 'porao', version: '1332', width: 3, height: 2, floors: [7, 6],
  tiles: [
    [0, 0, 7, 410, []],
    [1, 0, 7, 410, [1294, [3031, 4]]],
    [2, 1, 7, 0, [1947]],
    [1, 0, 6, 408, []],
  ],
};

describe('sceneFromStack (FUN-121)', () => {
  it('indexa por andar e devolve a pilha na ordem do arquivo, com a contagem', () => {
    const scene = sceneFromStack(stack);
    expect(scene.tileAt(1, 0, 7)).toEqual({ ground: 410, items: [{ id: 1294 }, { id: 3031, count: 4 }] });
    expect(scene.tileAt(2, 1, 7)).toEqual({ ground: 0, items: [{ id: 1947 }] });
    expect(scene.tileAt(1, 0, 6)).toEqual({ ground: 408, items: [] });
  });

  it('fora do mapa, andar ausente e tile inexistente são null — nunca um tile vazio', () => {
    const scene = sceneFromStack(stack);
    expect(scene.tileAt(-1, 0, 7)).toBeNull();
    expect(scene.tileAt(3, 0, 7)).toBeNull();
    expect(scene.tileAt(0, 0, 5)).toBeNull();
    expect(scene.tileAt(2, 0, 7)).toBeNull();
  });

  it('os andares saem crescentes e o padrão é o mais fundo', () => {
    // Thais é 4..7 e a câmera sem `selfId` fica na superfície; o bueiro é só o 8.
    expect(sceneFromStack(stack).floors).toEqual([6, 7]);
    expect(sceneFromStack(stack).defaultZ).toBe(7);
    expect(sceneFromStack({ ...stack, floors: [8], tiles: [] }).defaultZ).toBe(8);
  });
});

describe('sceneFromTilemap (FUN-121)', () => {
  //   0 1 2 3
  // 0 # # # #
  // 1 # . . #
  // 2 # # # #
  const map = buildTilemap({ id: 'sala', z: 7, grid: ['####', '#..#', '####'] });
  const scene = sceneFromTilemap(map, { floor: 355, wall: { vertical: 1, horizontal: 2, corner: 3, pole: 4 } });

  it('tile livre é [chão]; tile bloqueado é [peça pela vizinhança]', () => {
    expect(scene.tileAt(1, 1, 7)).toEqual({ ground: 355, items: [] });
    // Canto de cima-esquerda é POSTE; o de baixo-direita é CANTO (FUN-105).
    expect(scene.tileAt(0, 0, 7)).toEqual({ ground: 0, items: [{ id: 4 }] });
    expect(scene.tileAt(3, 2, 7)).toEqual({ ground: 0, items: [{ id: 3 }] });
  });

  it('um id só vira as quatro peças iguais, e só existe o andar do mapa', () => {
    const plain = sceneFromTilemap(map, { floor: 355, wall: 9 });
    expect(plain.tileAt(0, 0, 7)).toEqual({ ground: 0, items: [{ id: 9 }] });
    expect(plain.tileAt(1, 1, 6)).toBeNull();
    expect(plain.floors).toEqual([7]);
  });
});

describe('loadStackMap (FUN-121)', () => {
  const responding = (status: number, body: unknown) => (async () => ({
    ok: status === 200, status, json: async () => body,
  })) as unknown as typeof fetch;

  it('busca <base>/maps/<id>.json e devolve a pilha', async () => {
    const calls: string[] = [];
    const fetched = (async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => stack };
    }) as unknown as typeof fetch;
    await expect(loadStackMap('/things/1332', 'porao', fetched)).resolves.toEqual(stack);
    expect(calls).toEqual(['/things/1332/maps/porao.json']);
  });

  it('mapa ausente, rede fora ou JSON que não é pilha degradam para null, sem lançar', async () => {
    await expect(loadStackMap('/things/1332', 'porao', responding(404, {}))).resolves.toBeNull();
    await expect(loadStackMap('/things/1332', 'porao', responding(200, { id: 'porao' }))).resolves.toBeNull();
    await expect(loadStackMap('/things/1332', 'outro', responding(200, stack))).resolves.toBeNull();
    const failing = (async () => { throw new Error('rede'); }) as unknown as typeof fetch;
    await expect(loadStackMap('/things/1332', 'porao', failing)).resolves.toBeNull();
  });
});
