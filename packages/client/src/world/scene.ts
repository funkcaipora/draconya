// A cena: de onde o viewport lê a pilha de cada tile (FUN-121).
//
// São DUAS origens e UM contrato. O mapa importado (ADR 0025) chega como a pilha por tile que
// o importador escreveu em `things/<versão>/maps/<id>.json` — ids de aparência, nada mais — e
// o mapa autorado à mão (a grade `#`/`.` de `content`, com o par chão/parede de
// `appearances.maps`) vira uma pilha SINTÉTICA pelo mesmo contrato: `[chão]` no tile livre,
// `[peça de parede]` no bloqueado. O pintor não sabe de qual das duas veio o tile — um caminho
// de desenho, duas origens — e é isso que impede o cliente de manter dois pintores que
// divergem no primeiro detalhe.
//
// Puro: sem Pixi, sem `world`. O `fetch` entra por parâmetro para o teste não precisar de rede.

import { isBlocked, wallSetOf, type Tilemap, type WallSet } from '@draconya/content';
import { wallPiece, wallsOf } from './walls.js';

/** De que um mapa autorado à mão é feito, pela tabela de aparências (FUN-94, `appearances.maps`). */
export interface MapTiles {
  readonly floor: number;
  /**
   * UMA peça — a mesma em todo tile bloqueado — ou as quatro, escolhidas pela vizinhança
   * (FUN-105). É o campo como está na tabela; `sceneFromTilemap` o normaliza com `wallSetOf`.
   */
  readonly wall: number | WallSet;
}

/** Um item da pilha: o id de aparência e, quando empilhável, a contagem. */
export interface StackedItem {
  readonly id: number;
  readonly count?: number;
}

/** A pilha de um tile: o chão (0 = sem chão) e os itens, do mais antigo ao mais recente. */
export interface TileStack {
  readonly ground: number;
  readonly items: readonly StackedItem[];
}

/**
 * O arquivo `things/<versão>/maps/<id>.json`, como o importador o escreve
 * (`scripts/import-map.ts`, FUN-118): coordenadas LOCAIS ao recorte, e cada tile numa linha
 * `[x, y, z, chão, [item | [item, contagem]…]]`.
 */
export interface StackMap {
  readonly id: string;
  readonly version: string;
  readonly width: number;
  readonly height: number;
  readonly floors: readonly number[];
  readonly tiles: ReadonlyArray<
    readonly [number, number, number, number, ReadonlyArray<number | readonly [number, number]>]
  >;
}

export interface Scene {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Os andares presentes, do mais alto (menor `z`) ao mais fundo. */
  readonly floors: readonly number[];
  /** O andar em que a câmera fica sem `selfId`: o mais fundo — a superfície, ou o único. */
  readonly defaultZ: number;
  /** A pilha do tile, ou `null` fora do mapa e onde não há tile nenhum. */
  tileAt(x: number, y: number, z: number): TileStack | null;
}

const EMPTY: readonly StackedItem[] = [];

/** A cena de um mapa importado: um índice por andar, e o resto é leitura. */
export function sceneFromStack(stack: StackMap): Scene {
  const byFloor = new Map<number, Map<number, TileStack>>();
  for (const [x, y, z, ground, raw] of stack.tiles) {
    let floor = byFloor.get(z);
    if (floor === undefined) {
      floor = new Map();
      byFloor.set(z, floor);
    }
    const items = raw.length === 0
      ? EMPTY
      : raw.map((entry) => (typeof entry === 'number' ? { id: entry } : { id: entry[0], count: entry[1] }));
    floor.set(y * stack.width + x, { ground, items });
  }
  const floors = [...stack.floors].sort((a, b) => a - b);
  return {
    id: stack.id,
    width: stack.width,
    height: stack.height,
    floors,
    defaultZ: floors.length === 0 ? 7 : (floors[floors.length - 1] as number),
    tileAt(x, y, z) {
      if (x < 0 || y < 0 || x >= stack.width || y >= stack.height) return null;
      return byFloor.get(z)?.get(y * stack.width + x) ?? null;
    },
  };
}

/**
 * A cena de um mapa autorado à mão: a grade vira pilha sintética. Tile livre é `[chão]`; tile
 * bloqueado é `[peça]`, com a peça escolhida pela vizinhança (FUN-105) — a tabela de
 * `appearances.maps` continua sendo a única fonte dos ids, e o pintor não ganha um caso especial.
 */
export function sceneFromTilemap(map: Tilemap, tiles: MapTiles): Scene {
  const pieces: WallSet = wallSetOf(tiles.wall);
  const walls = wallsOf(map);
  return {
    id: map.id,
    width: map.width,
    height: map.height,
    floors: [map.z],
    defaultZ: map.z,
    tileAt(x, y, z) {
      if (z !== map.z || x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
      if (isBlocked(map, x, y, z)) return { ground: 0, items: [{ id: pieces[wallPiece(walls, x, y)] }] };
      return { ground: tiles.floor, items: EMPTY };
    },
  };
}

/**
 * Busca a pilha de um mapa importado em `<baseUrl>/maps/<mapId>.json` — o mesmo caminho das
 * folhas, servido pelo nginx do volume `things` em produção e pelo Vite em desenvolvimento.
 *
 * `null` quando não há: 404, rede fora, JSON que não é uma pilha. A cena ausente não derruba a
 * tela — o viewport desenha a grade lisa de reserva, como faz sem pacote de arte. O arquivo é
 * pequeno (Thais: 156 KB comprimido) e o servidor o manda com `Cache-Control` longo; guardá-lo
 * no IndexedDB seria um segundo cache para o que o HTTP já guarda.
 */
export async function loadStackMap(
  baseUrl: string, mapId: string, fetchFn: typeof fetch = fetch,
): Promise<StackMap | null> {
  try {
    const response = await fetchFn(`${baseUrl}/maps/${encodeURIComponent(mapId)}.json`);
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isStackMap(data) && data.id === mapId ? data : null;
  } catch {
    return null;
  }
}

function isStackMap(data: unknown): data is StackMap {
  if (typeof data !== 'object' || data === null) return false;
  const map = data as Record<string, unknown>;
  return typeof map['id'] === 'string'
    && typeof map['width'] === 'number' && typeof map['height'] === 'number'
    && Array.isArray(map['floors']) && Array.isArray(map['tiles']);
}
