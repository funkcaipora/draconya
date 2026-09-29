import { describe, expect, it } from 'vitest';
import { encodeSector, sectorPath } from './sector.js';
import type { WorldIndex } from './sector.js';
import { createWorldScene, loadWorldIndex, sectorFetcher } from './world-scene.js';

const INDEX: WorldIndex = {
  format: 'draconya-world/1', version: '1332', source: { file: 'x.otbm', sha256: 'b'.repeat(64) }, sectorSize: 32,
  floors: [
    { z: 7, bbox: { x: [32000, 32063], y: [32000, 32031] }, sectors: [[1000, 1000], [1001, 1000]] },
    { z: 8, bbox: { x: [32000, 32031], y: [32000, 32031] }, sectors: [[1000, 1000]] },
  ],
};

const bytesOf = (z: number, sx: number, sy: number, ground: number): Uint8Array =>
  encodeSector({ sx, sy, z, tiles: [{ x: 5, y: 6, ground, items: [{ id: ground + 1 }], flags: 0 }] });

/** Um `fetchSector` que só responde quando o teste manda. */
function manualFetch() {
  const pending = new Map<string, (bytes: Uint8Array | null) => void>();
  const asked: string[] = [];
  return {
    asked,
    fetchSector: (path: string) => new Promise<Uint8Array | null>((resolve) => { asked.push(path); pending.set(path, resolve); }),
    answer(path: string, bytes: Uint8Array | null) { pending.get(path)?.(bytes); pending.delete(path); },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createWorldScene', () => {
  it('pede o setor na primeira leitura, devolve null até chegar, e sobe a revisão quando chega', async () => {
    const net = manualFetch();
    const scene = createWorldScene(INDEX, { fetchSector: net.fetchSector });
    expect(scene.floors).toEqual([7, 8]);
    expect(scene.tileAt(32005, 32006, 7)).toBeNull();
    expect(net.asked).toEqual([sectorPath(7, 1000, 1000)]);
    expect(scene.pendingSectors()).toBe(1);
    const before = scene.revision();
    net.answer(sectorPath(7, 1000, 1000), bytesOf(7, 1000, 1000, 400));
    await tick();
    expect(scene.revision()).toBeGreaterThan(before);
    expect(scene.tileAt(32005, 32006, 7)).toEqual({ ground: 400, items: [{ id: 401 }] });
    expect(scene.tileAt(32004, 32006, 7)).toBeNull();
    expect(scene.loadedSectors()).toBe(1);
  });

  it('não pede setor que o índice não tem, nem o mesmo setor duas vezes', () => {
    const net = manualFetch();
    const scene = createWorldScene(INDEX, { fetchSector: net.fetchSector });
    expect(scene.tileAt(40000, 40000, 7)).toBeNull();
    expect(scene.tileAt(32040, 32000, 8)).toBeNull();
    scene.tileAt(32001, 32001, 7);
    scene.tileAt(32002, 32002, 7);
    expect(net.asked).toEqual([sectorPath(7, 1000, 1000)]);
    expect(scene.hasSector(8, 1000, 1000)).toBe(true);
    expect(scene.hasSector(8, 1001, 1000)).toBe(false);
  });

  it('setor que falha fica ausente, sem pedir de novo a cada quadro', async () => {
    const net = manualFetch();
    const scene = createWorldScene(INDEX, { fetchSector: net.fetchSector });
    scene.tileAt(32001, 32001, 7);
    net.answer(sectorPath(7, 1000, 1000), null);
    await tick();
    expect(scene.tileAt(32001, 32001, 7)).toBeNull();
    expect(net.asked).toHaveLength(1);
  });

  it('despeja o setor menos usado quando passa do orçamento', async () => {
    const net = manualFetch();
    const scene = createWorldScene(INDEX, { fetchSector: net.fetchSector, budget: 1 });
    scene.tileAt(32005, 32006, 7);
    net.answer(sectorPath(7, 1000, 1000), bytesOf(7, 1000, 1000, 10));
    await tick();
    scene.tileAt(32037, 32006, 7);
    net.answer(sectorPath(7, 1001, 1000), bytesOf(7, 1001, 1000, 20));
    await tick();
    expect(scene.loadedSectors()).toBe(1);
    expect(scene.tileAt(32037, 32006, 7)).toEqual({ ground: 20, items: [{ id: 21 }] });
    // O primeiro saiu: ler de novo o pede de novo.
    expect(scene.tileAt(32005, 32006, 7)).toBeNull();
    expect(net.asked.filter((p) => p === sectorPath(7, 1000, 1000))).toHaveLength(2);
  });
});

describe('carregadores', () => {
  const fakeFetch = (routes: Record<string, unknown>) => (async (url: string) => {
    const body = routes[url];
    if (body === undefined) return { ok: false } as Response;
    return {
      ok: true,
      json: async () => body,
      arrayBuffer: async () => (body as Uint8Array).buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  it('loadWorldIndex lê o índice e recusa o que não é', async () => {
    expect(await loadWorldIndex('/t', fakeFetch({ '/t/world/index.json': INDEX }))).toEqual(INDEX);
    expect(await loadWorldIndex('/t', fakeFetch({ '/t/world/index.json': { format: 'x' } }))).toBeNull();
    expect(await loadWorldIndex('/t', fakeFetch({}))).toBeNull();
  });

  it('sectorFetcher busca sob world/ e devolve null no 404', async () => {
    const bytes = bytesOf(7, 1000, 1000, 1);
    const fetchSector = sectorFetcher('/t', fakeFetch({ '/t/world/7/1000-1000.bin': bytes }));
    expect(await fetchSector('7/1000-1000.bin')).toEqual(bytes);
    expect(await fetchSector('7/1-1.bin')).toBeNull();
  });
});
