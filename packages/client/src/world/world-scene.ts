// A cena do mundo inteiro (#661, fase 2 do `docs/world-map-plan.md`): o mesmo contrato `Scene`
// dos recortes (`scene.ts`), mas a pilha vem dos setores de `things/<versão>/world/`
// (ADR 0047), buscados sob demanda. O pintor não sabe de onde o tile veio.
//
// `tileAt` num setor que ainda não chegou devolve `null` e PEDE o setor; quando ele chega, a
// `revision` sobe, e o viewport — que põe a revisão na chave de repintura — repinta. Nada de
// callback para o viewport: ele já olha a chave a cada quadro (ADR 0007).
//
// Puro quanto ao Pixi: o `fetch` entra por parâmetro, para o teste não precisar de rede.

import type { Scene, TileStack } from './scene.js';
import { decodeSector, isWorldIndex, SECTOR_SIZE, sectorOf, sectorPath, stacksOf } from './sector.js';
import type { Sector, WorldIndex } from './sector.js';

/** Quantos setores ficam na memória. A tela usa poucas dezenas por andar; o resto é cache. */
export const DEFAULT_SECTOR_BUDGET = 512;

/** Quantos pedidos de setor voam ao mesmo tempo. */
const MAX_IN_FLIGHT = 12;

export interface WorldScene extends Scene {
  /** Sobe a cada setor que chega ou sai: vai na chave de repintura do viewport. */
  revision(): number;
  /** Quantos setores estão na memória agora. */
  loadedSectors(): number;
  /** Quantos estão pedidos e ainda não chegaram. */
  pendingSectors(): number;
  /** O setor existe no mundo? Fora dele não há o que pedir. */
  hasSector(z: number, sx: number, sy: number): boolean;
  /**
   * As flags de zona e a casa do tile (#664), quando o setor já chegou — `null` sem nenhuma das
   * duas. Não pede setor: quem desenha a camada lê o que o pintor já trouxe.
   */
  metaAt(x: number, y: number, z: number): TileMeta | null;
}

export interface TileMeta {
  /** `TILE_FLAGS` do OTBM: PZ (1), no-pvp (4), no-logout (8), pvp (16). */
  readonly flags: number;
  readonly houseId?: number;
}

export interface WorldSceneOptions {
  /** Busca os bytes de `sectorPath(...)`; `null` quando não há (404, rede fora). */
  readonly fetchSector: (path: string) => Promise<Uint8Array | null>;
  readonly budget?: number;
}

type Slot = { state: 'loading' } | { state: 'ready'; stacks: Map<number, TileStack>; meta: Map<number, TileMeta> } | { state: 'missing' };

function metaOf(sector: Sector): Map<number, TileMeta> {
  const meta = new Map<number, TileMeta>();
  for (const tile of sector.tiles) {
    if (tile.flags === 0 && tile.houseId === undefined) continue;
    meta.set(tile.y * SECTOR_SIZE + tile.x, tile.houseId === undefined ? { flags: tile.flags } : { flags: tile.flags, houseId: tile.houseId });
  }
  return meta;
}

export function createWorldScene(index: WorldIndex, options: WorldSceneOptions): WorldScene {
  const budget = options.budget ?? DEFAULT_SECTOR_BUDGET;
  const known = new Set<string>();
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const floor of index.floors) {
    for (const [sx, sy] of floor.sectors) known.add(sectorPath(floor.z, sx, sy));
    minX = Math.min(minX, floor.bbox.x[0]); maxX = Math.max(maxX, floor.bbox.x[1]);
    minY = Math.min(minY, floor.bbox.y[0]); maxY = Math.max(maxY, floor.bbox.y[1]);
  }
  const floors = index.floors.map((floor) => floor.z).sort((a, b) => a - b);
  /** Em ordem de uso: o primeiro é o que ninguém pede há mais tempo. */
  const slots = new Map<string, Slot>();
  const queue: string[] = [];
  let inFlight = 0;
  let revision = 0;
  let ready = 0;

  const touch = (key: string, slot: Slot): void => {
    slots.delete(key);
    slots.set(key, slot);
  };

  const evict = (): void => {
    if (ready <= budget) return;
    for (const [key, slot] of slots) {
      if (ready <= budget) break;
      if (slot.state !== 'ready') continue;
      slots.delete(key);
      ready -= 1;
      revision += 1;
    }
  };

  const pump = (): void => {
    while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
      const key = queue.pop() as string;
      if (slots.get(key)?.state !== 'loading') continue;
      inFlight += 1;
      void options.fetchSector(key).then((bytes) => {
        let slot: Slot = { state: 'missing' };
        if (bytes !== null) {
          try {
            const sector = decodeSector(bytes);
            slot = { state: 'ready', stacks: stacksOf(sector), meta: metaOf(sector) };
          } catch {
            slot = { state: 'missing' };
          }
        }
        // O setor pode ter sido despejado enquanto voava: só entra se ainda é esperado.
        if (slots.get(key)?.state === 'loading') {
          touch(key, slot);
          if (slot.state === 'ready') ready += 1;
          revision += 1;
          evict();
        }
      }, () => {
        if (slots.get(key)?.state === 'loading') touch(key, { state: 'missing' });
      }).finally(() => {
        inFlight -= 1;
        pump();
      });
    }
  };

  const request = (key: string): void => {
    slots.set(key, { state: 'loading' });
    // O último pedido sai primeiro: é o que a câmera está olhando agora.
    queue.push(key);
    pump();
  };

  return {
    id: `world:${index.version}:${index.source.sha256.slice(0, 12)}`,
    width: maxX + 1,
    height: maxY + 1,
    floors,
    defaultZ: 7,
    tileAt(x, y, z) {
      if (x < 0 || y < 0) return null;
      const { sx, sy } = sectorOf(x, y);
      const key = sectorPath(z, sx, sy);
      if (!known.has(key)) return null;
      const slot = slots.get(key);
      if (slot === undefined) { request(key); return null; }
      if (slot.state !== 'ready') return null;
      touch(key, slot);
      return slot.stacks.get((y % SECTOR_SIZE) * SECTOR_SIZE + (x % SECTOR_SIZE)) ?? null;
    },
    revision: () => revision,
    loadedSectors: () => ready,
    pendingSectors: () => [...slots.values()].filter((slot) => slot.state === 'loading').length,
    hasSector: (z, sx, sy) => known.has(sectorPath(z, sx, sy)),
    metaAt(x, y, z) {
      if (x < 0 || y < 0) return null;
      const { sx, sy } = sectorOf(x, y);
      const slot = slots.get(sectorPath(z, sx, sy));
      if (slot === undefined || slot.state !== 'ready') return null;
      return slot.meta.get((y % SECTOR_SIZE) * SECTOR_SIZE + (x % SECTOR_SIZE)) ?? null;
    },
  };
}

/** Busca o índice do mundo em `<baseUrl>/world/index.json`; `null` quando não há. */
export async function loadWorldIndex(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<WorldIndex | null> {
  try {
    const response = await fetchFn(`${baseUrl}/world/index.json`);
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isWorldIndex(data) ? data : null;
  } catch {
    return null;
  }
}

/** O `fetchSector` de verdade, sob `<baseUrl>/world/`. */
export function sectorFetcher(baseUrl: string, fetchFn: typeof fetch = fetch): (path: string) => Promise<Uint8Array | null> {
  return async (path) => {
    try {
      const response = await fetchFn(`${baseUrl}/world/${path}`);
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      return null;
    }
  };
}
