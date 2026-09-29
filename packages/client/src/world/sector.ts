// O setor do mundo (#660, fase 1 do `docs/world-map-plan.md`): 32×32 tiles de UM andar, a
// unidade em que o mapa inteiro do Tibia é escrito em `things/<versão>/world/` e buscado sob
// demanda pelo explorador. O importador (`scripts/world-map.ts`) escreve; o cliente lê. Um
// codec só, puro, para os dois lados não divergirem sobre um byte.
//
// O censo (#659) mediu o que decide o formato: 17,97 M tiles, 29 425 setores, 97 MB num binário
// de u16 por id — e o gzip só tirava 11 %. Os ids repetem muito dentro de um setor (grama,
// parede, borda), então cada setor leva uma PALETA dos ids que usa e o tile guarda o índice: u8
// quando a paleta cabe em 256, u16 quando não.
//
//   'DWS1'  u16 sx  u16 sy  u8 z
//   u16 paleta  paleta × u16 id            (crescente)
//   u16 tiles   tiles × tile               (por célula crescente)
//   tile := u16 cabeça, [chão], u8 n, n × item, [n × u8 contagem], [u8 flags], [u32 casa]
//   cabeça := célula (y × 32 + x, 10 bits) | 1<<10 chão | 1<<11 contagens | 1<<12 flags | 1<<13 casa
//
// A pilha é a MESMA informação do JSON de recorte (`scene.ts`, `StackMap`) mais as flags de zona
// e a casa do tile, que a fase 4 desenha.

import type { StackedItem, TileStack } from './scene.js';

export const SECTOR_SIZE = 32;
const MAGIC = [0x44, 0x57, 0x53, 0x31]; // 'DWS1'
const CELL_MASK = 0x3ff;
const HAS_GROUND = 1 << 10;
const HAS_COUNTS = 1 << 11;
const HAS_FLAGS = 1 << 12;
const HAS_HOUSE = 1 << 13;

/** Um tile do setor, em coordenada LOCAL (0–31). */
export interface SectorTile {
  readonly x: number;
  readonly y: number;
  /** 0 = sem chão. */
  readonly ground: number;
  readonly items: readonly StackedItem[];
  /** `TILE_FLAGS` do OTBM (PZ, no-pvp, no-logout, pvp zone); 0 quando nenhuma. */
  readonly flags: number;
  readonly houseId?: number;
}

export interface Sector {
  readonly sx: number;
  readonly sy: number;
  readonly z: number;
  /** Por célula crescente, sem repetição. */
  readonly tiles: readonly SectorTile[];
}

export class SectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectorError';
  }
}

/** O caminho do setor sob `world/`, igual para quem escreve e quem busca. */
export function sectorPath(z: number, sx: number, sy: number): string {
  return `${z}/${sx}-${sy}.bin`;
}

export function sectorOf(x: number, y: number): { sx: number; sy: number } {
  return { sx: Math.floor(x / SECTOR_SIZE), sy: Math.floor(y / SECTOR_SIZE) };
}

export function encodeSector(sector: Sector): Uint8Array {
  const ids = new Set<number>();
  for (const tile of sector.tiles) {
    if (tile.ground > 0) ids.add(tile.ground);
    for (const item of tile.items) ids.add(item.id);
  }
  const palette = [...ids].sort((a, b) => a - b);
  if (palette.length > 0xffff) throw new SectorError('paleta maior que 65 535 ids');
  const index = new Map(palette.map((id, i) => [id, i]));
  const wide = palette.length > 256;

  const out: number[] = [...MAGIC];
  const u8 = (v: number): void => { out.push(v & 0xff); };
  const u16 = (v: number): void => { out.push(v & 0xff, (v >>> 8) & 0xff); };
  const u32 = (v: number): void => { u16(v & 0xffff); u16(v >>> 16); };
  const ref = (id: number): void => { const i = index.get(id) as number; if (wide) u16(i); else u8(i); };

  u16(sector.sx);
  u16(sector.sy);
  u8(sector.z);
  u16(palette.length);
  for (const id of palette) u16(id);
  const tiles = [...sector.tiles].sort((a, b) => (a.y * SECTOR_SIZE + a.x) - (b.y * SECTOR_SIZE + b.x));
  u16(tiles.length);
  let previous = -1;
  for (const tile of tiles) {
    if (tile.x < 0 || tile.y < 0 || tile.x >= SECTOR_SIZE || tile.y >= SECTOR_SIZE) {
      throw new SectorError(`tile fora do setor: (${tile.x}, ${tile.y})`);
    }
    const cell = tile.y * SECTOR_SIZE + tile.x;
    if (cell === previous) throw new SectorError(`tile repetido: (${tile.x}, ${tile.y})`);
    previous = cell;
    if (tile.items.length > 255) throw new SectorError(`pilha com mais de 255 itens em (${tile.x}, ${tile.y})`);
    const counts = tile.items.some((item) => item.count !== undefined && item.count > 1);
    let head = cell;
    if (tile.ground > 0) head |= HAS_GROUND;
    if (counts) head |= HAS_COUNTS;
    if (tile.flags !== 0) head |= HAS_FLAGS;
    if (tile.houseId !== undefined) head |= HAS_HOUSE;
    u16(head);
    if (tile.ground > 0) ref(tile.ground);
    u8(tile.items.length);
    for (const item of tile.items) ref(item.id);
    if (counts) for (const item of tile.items) u8(item.count !== undefined && item.count > 1 ? item.count : 0);
    if (tile.flags !== 0) u8(tile.flags);
    if (tile.houseId !== undefined) u32(tile.houseId);
  }
  return Uint8Array.from(out);
}

export function decodeSector(bytes: Uint8Array): Sector {
  let at = 0;
  const need = (n: number): void => {
    if (at + n > bytes.length) throw new SectorError('setor truncado');
  };
  const u8 = (): number => { need(1); return bytes[at++] as number; };
  const u16 = (): number => { need(2); const v = (bytes[at] as number) | ((bytes[at + 1] as number) << 8); at += 2; return v; };
  const u32 = (): number => (u16() | (u16() << 16)) >>> 0;
  for (const byte of MAGIC) if (u8() !== byte) throw new SectorError('não é um setor: cabeçalho esperado é DWS1');

  const sx = u16();
  const sy = u16();
  const z = u8();
  const palette: number[] = [];
  const size = u16();
  for (let i = 0; i < size; i += 1) palette.push(u16());
  const wide = palette.length > 256;
  const ref = (): number => {
    const id = palette[wide ? u16() : u8()];
    if (id === undefined) throw new SectorError('índice fora da paleta');
    return id;
  };

  const count = u16();
  const tiles: SectorTile[] = [];
  for (let i = 0; i < count; i += 1) {
    const head = u16();
    const cell = head & CELL_MASK;
    const ground = (head & HAS_GROUND) !== 0 ? ref() : 0;
    const n = u8();
    const ids: number[] = [];
    for (let k = 0; k < n; k += 1) ids.push(ref());
    const counts: number[] = [];
    if ((head & HAS_COUNTS) !== 0) for (let k = 0; k < n; k += 1) counts.push(u8());
    const items: StackedItem[] = ids.map((id, k) => {
      const c = counts[k];
      return c !== undefined && c > 1 ? { id, count: c } : { id };
    });
    const flags = (head & HAS_FLAGS) !== 0 ? u8() : 0;
    const tile: { -readonly [K in keyof SectorTile]: SectorTile[K] } = {
      x: cell % SECTOR_SIZE, y: Math.floor(cell / SECTOR_SIZE), ground, items, flags,
    };
    if ((head & HAS_HOUSE) !== 0) tile.houseId = u32();
    tiles.push(tile);
  }
  if (at !== bytes.length) throw new SectorError('bytes sobrando depois do último tile');
  return { sx, sy, z, tiles };
}

/** A pilha de cada tile do setor, por célula — o que `Scene.tileAt` devolve. */
export function stacksOf(sector: Sector): Map<number, TileStack> {
  const stacks = new Map<number, TileStack>();
  for (const tile of sector.tiles) stacks.set(tile.y * SECTOR_SIZE + tile.x, { ground: tile.ground, items: tile.items });
  return stacks;
}

/** O índice do mundo: `things/<versão>/world/index.json`. */
export interface WorldIndex {
  readonly format: 'draconya-world/1';
  readonly version: string;
  readonly source: { readonly file: string; readonly sha256: string };
  readonly sectorSize: number;
  readonly floors: ReadonlyArray<{
    readonly z: number;
    readonly bbox: { readonly x: readonly [number, number]; readonly y: readonly [number, number] };
    /** `[sx, sy]` de cada setor que existe, em ordem crescente de `sy`, depois `sx`. */
    readonly sectors: ReadonlyArray<readonly [number, number]>;
  }>;
}

export function isWorldIndex(data: unknown): data is WorldIndex {
  if (typeof data !== 'object' || data === null) return false;
  const index = data as Record<string, unknown>;
  return index['format'] === 'draconya-world/1' && index['sectorSize'] === SECTOR_SIZE && Array.isArray(index['floors']);
}
