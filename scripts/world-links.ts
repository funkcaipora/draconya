// As ligações do mundo (#663, fase 4 do `docs/world-map-plan.md`): para onde cada escada, rampa,
// buraco, escada de mão, ponto de corda e teleporte leva, derivado do mapa inteiro — o "trabalho
// futuro" que a emenda #519 do ADR 0025 deixou. Escreve `things/<versão>/world/links.json`.
//
//   pnpm map:links              # depois de pnpm map:world
//   pnpm map:links --check
//
// De onde vem cada coisa (só números e fatos do Canary, nunca código — ADR 0019/0038):
//   - `floorchange` e `type` por id: `$CANARY_DIR/data/items/items.xml`;
//   - a regra de pouso da escada: `Tile::queryDestination` (`src/items/tile.cpp`), a mesma que a
//     emenda #519 aplicou à mão — descer olha as flags do tile de POUSO, subir as do tile de PARTIDA;
//   - escada de mão (`type="ladder"`) e ponto de corda (`ropeSpots` do `data/global.lua`): sobem um
//     andar e vão um tile ao sul, ou ao primeiro vizinho andável (`Position:moveUpstairs`);
//   - teleporte: o destino gravado no item, no OTBM (#659). Destino `(0,0,0)` é de script, e fica fora;
//   - andável é "tem chão e nenhum item com `unpass`", pelo `appearances.dat` (#662).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readAppearances } from '../packages/client/src/assets/appearances.js';
import { decodeSector, isWorldIndex, SECTOR_SIZE, sectorPath } from '../packages/client/src/world/sector.js';
import type { SectorTile, WorldIndex } from '../packages/client/src/world/sector.js';
import { readOtbmTiles } from './otbm.js';
import { findAppearances } from './world-minimap.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** As flags de troca de andar do Canary, como bits. */
export const FLOOR = {
  down: 1 << 0, north: 1 << 1, south: 1 << 2, east: 1 << 3, west: 1 << 4, southAlt: 1 << 5, eastAlt: 1 << 6,
} as const;
const FLOOR_BY_NAME: Readonly<Record<string, number>> = {
  down: FLOOR.down, north: FLOOR.north, south: FLOOR.south, east: FLOOR.east, west: FLOOR.west,
  southalt: FLOOR.southAlt, eastalt: FLOOR.eastAlt,
};
const DIRECTIONAL = FLOOR.north | FLOOR.south | FLOOR.east | FLOOR.west | FLOOR.southAlt | FLOOR.eastAlt;

export type LinkKind = 'stairs' | 'ladder' | 'rope' | 'teleport';
export type Point = readonly [number, number, number];

export interface WorldLinks {
  readonly format: 'draconya-links/1';
  readonly source: { readonly file: string; readonly sha256: string };
  /** `[de, para, tipo]`, ordenado por origem. */
  readonly links: ReadonlyArray<readonly [Point, Point, LinkKind]>;
  /** `[x, y, z, id]` de cada porta. */
  readonly doors: ReadonlyArray<readonly [number, number, number, number]>;
}

export interface ItemFacts {
  readonly floorchange?: number;
  readonly type?: string;
}

/** `items.xml` → fatos por id. Lê `id` ou `fromid`/`toid`, e só `floorchange` e `type`. */
export function parseItemsXml(xml: string): Map<number, ItemFacts> {
  const facts = new Map<number, ItemFacts>();
  const itemPattern = /<item\s([^>]*?)(\/>|>([\s\S]*?)<\/item>)/g;
  for (const match of xml.matchAll(itemPattern)) {
    const head = match[1] ?? '';
    const body = match[3] ?? '';
    const floorName = /key="floorchange"\s+value="([a-z]+)"/.exec(body)?.[1];
    const type = /key="type"\s+value="([a-z]+)"/.exec(body)?.[1];
    const floorchange = floorName === undefined ? undefined : FLOOR_BY_NAME[floorName];
    if (floorchange === undefined && type === undefined) continue;
    const id = /\bid="(\d+)"/.exec(head)?.[1];
    const from = /\bfromid="(\d+)"/.exec(head)?.[1];
    const to = /\btoid="(\d+)"/.exec(head)?.[1];
    const ids: number[] = [];
    if (id !== undefined) ids.push(Number(id));
    else if (from !== undefined && to !== undefined) for (let i = Number(from); i <= Number(to); i += 1) ids.push(i);
    const fact: { floorchange?: number; type?: string } = {};
    if (floorchange !== undefined) fact.floorchange = floorchange;
    if (type !== undefined) fact.type = type;
    for (const i of ids) facts.set(i, fact);
  }
  return facts;
}

/** `ropeSpots = { … }` e `specialRopeSpots = { … }` do `global.lua`. */
export function parseRopeSpots(lua: string): { ground: Set<number>; special: Set<number> } {
  const list = (name: string): Set<number> => {
    const body = new RegExp(`^${name}\\s*=\\s*\\{([^}]*)\\}`, 'm').exec(lua)?.[1] ?? '';
    return new Set(body.split(',').map((part) => Number(part.trim())).filter((n) => Number.isInteger(n) && n > 0));
  };
  return { ground: list('ropeSpots'), special: list('specialRopeSpots') };
}

/** O mundo como as ligações o consultam: a pilha de um tile, ou `null`. */
export type TileLookup = (x: number, y: number, z: number) => SectorTile | null;

/** Os vizinhos na ordem do `moveUpstairs`: sul primeiro; no laço, sul vira oeste. */
const UPSTAIRS_ORDER: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, 0], [-1, 0], [-1, 0], [-1, 1], [1, 1], [-1, -1], [1, -1],
];

export function deriveLinks(input: {
  readonly tiles: Iterable<readonly [number, number, number, SectorTile]>;
  readonly lookup: TileLookup;
  readonly items: Map<number, ItemFacts>;
  readonly rope: { ground: Set<number>; special: Set<number> };
  readonly unpass: (id: number) => boolean;
  readonly teleports: Iterable<readonly [Point, Point]>;
}): { links: Array<[Point, Point, LinkKind]>; doors: Array<[number, number, number, number]> } {
  const { lookup, items, rope, unpass } = input;
  const flagsOf = (tile: SectorTile | null): number => {
    if (tile === null) return 0;
    let flags = items.get(tile.ground)?.floorchange ?? 0;
    for (const item of tile.items) flags |= items.get(item.id)?.floorchange ?? 0;
    return flags;
  };
  const flagsAt = (x: number, y: number, z: number): number => flagsOf(lookup(x, y, z));
  const walkable = (x: number, y: number, z: number): boolean => {
    const tile = lookup(x, y, z);
    if (tile === null || tile.ground === 0 || unpass(tile.ground)) return false;
    return !tile.items.some((item) => unpass(item.id));
  };
  const upstairs = (x: number, y: number, z: number): Point | null => {
    const dz = z - 1;
    if (dz < 0) return null;
    if (walkable(x, y + 1, dz)) return [x, y + 1, dz];
    for (const [dx, dy] of UPSTAIRS_ORDER) if (walkable(x + dx, y + dy, dz)) return [x + dx, y + dy, dz];
    // Nenhum vizinho andável: o Canary leva ao sul assim mesmo. Sem tile lá, não há para onde ir.
    return lookup(x, y + 1, dz) === null ? null : [x, y + 1, dz];
  };

  const links: Array<[Point, Point, LinkKind]> = [];
  const doors: Array<[number, number, number, number]> = [];
  for (const [x, y, z, tile] of input.tiles) {
    const flags = flagsOf(tile);
    if ((flags & FLOOR.down) !== 0) {
      let dx = x; let dy = y; const dz = z + 1;
      if ((flagsAt(x, y - 1, dz) & FLOOR.southAlt) !== 0) dy -= 2;
      else if ((flagsAt(x - 1, y, dz) & FLOOR.eastAlt) !== 0) dx -= 2;
      else if (lookup(x, y, dz) !== null) {
        const below = flagsAt(x, y, dz);
        if ((below & FLOOR.north) !== 0) dy += 1;
        if ((below & FLOOR.south) !== 0) dy -= 1;
        if ((below & FLOOR.southAlt) !== 0) dy -= 2;
        if ((below & FLOOR.east) !== 0) dx -= 1;
        if ((below & FLOOR.eastAlt) !== 0) dx -= 2;
        if ((below & FLOOR.west) !== 0) dx += 1;
      }
      if (lookup(dx, dy, dz) !== null) links.push([[x, y, z], [dx, dy, dz], 'stairs']);
    } else if ((flags & DIRECTIONAL) !== 0 && z > 0) {
      let dx = x; let dy = y; const dz = z - 1;
      if ((flags & FLOOR.north) !== 0) dy -= 1;
      if ((flags & FLOOR.south) !== 0) dy += 1;
      if ((flags & FLOOR.east) !== 0) dx += 1;
      if ((flags & FLOOR.west) !== 0) dx -= 1;
      if ((flags & FLOOR.southAlt) !== 0) dy += 2;
      if ((flags & FLOOR.eastAlt) !== 0) dx += 2;
      if (lookup(dx, dy, dz) !== null) links.push([[x, y, z], [dx, dy, dz], 'stairs']);
    }
    const isLadder = tile.items.some((item) => items.get(item.id)?.type === 'ladder');
    const isRope = (tile.ground > 0 && rope.ground.has(tile.ground)) || tile.items.some((item) => rope.special.has(item.id));
    if (isLadder || isRope) {
      const to = upstairs(x, y, z);
      if (to !== null) links.push([[x, y, z], to, isLadder ? 'ladder' : 'rope']);
    }
    for (const item of tile.items) if (items.get(item.id)?.type === 'door') doors.push([x, y, z, item.id]);
  }
  for (const [from, to] of input.teleports) {
    if (to[0] === 0 && to[1] === 0 && to[2] === 0) continue;
    if (lookup(to[0], to[1], to[2]) === null) continue;
    links.push([from, to, 'teleport']);
  }
  const order = (a: Point, b: Point): number => a[2] - b[2] || a[1] - b[1] || a[0] - b[0];
  links.sort((a, b) => order(a[0], b[0]) || a[2].localeCompare(b[2]) || order(a[1], b[1]));
  doors.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0] || a[3] - b[3]);
  return { links, doors };
}

export function formatLinks(links: WorldLinks): string {
  const rows = links.links.map((link) => `  ${JSON.stringify(link)}`);
  const doors = links.doors.map((door) => `  ${JSON.stringify(door)}`);
  return `{"format":${JSON.stringify(links.format)},"source":${JSON.stringify(links.source)},"links":[\n${rows.join(',\n')}\n],"doors":[\n${doors.join(',\n')}\n]}\n`;
}

/** Um leitor de tiles sobre os setores em disco, com um cache pequeno de setores decodificados. */
export function sectorLookup(worldDir: string, budget = 512): TileLookup {
  const cache = new Map<string, Map<number, SectorTile> | null>();
  return (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || z > 15) return null;
    const sx = Math.floor(x / SECTOR_SIZE);
    const sy = Math.floor(y / SECTOR_SIZE);
    const key = sectorPath(z, sx, sy);
    let cells = cache.get(key);
    if (cells === undefined) {
      const path = join(worldDir, key);
      cells = existsSync(path)
        ? new Map(decodeSector(new Uint8Array(readFileSync(path))).tiles.map((t) => [t.y * SECTOR_SIZE + t.x, t]))
        : null;
      cache.set(key, cells);
      if (cache.size > budget) cache.delete(cache.keys().next().value as string);
    }
    return cells?.get((y % SECTOR_SIZE) * SECTOR_SIZE + (x % SECTOR_SIZE)) ?? null;
  };
}

function* worldTiles(index: WorldIndex, worldDir: string): Generator<readonly [number, number, number, SectorTile]> {
  for (const floor of index.floors) {
    for (const [sx, sy] of floor.sectors) {
      const path = join(worldDir, sectorPath(floor.z, sx, sy));
      if (!existsSync(path)) continue;
      for (const tile of decodeSector(new Uint8Array(readFileSync(path))).tiles) {
        yield [sx * SECTOR_SIZE + tile.x, sy * SECTOR_SIZE + tile.y, floor.z, tile];
      }
    }
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: { things: { type: 'string' }, version: { type: 'string' }, otbm: { type: 'string' }, check: { type: 'boolean' } },
    strict: true,
  });
  const thingsDir = resolve(ROOT, values.things ?? process.env.THINGS_DIR ?? 'things');
  const version = values.version ?? process.env.THINGS_VERSION ?? '1332';
  const canaryDir = resolve(ROOT, process.env.CANARY_DIR ?? join('things', 'sources', 'canary'));
  const worldDir = join(thingsDir, version, 'world');
  const outPath = join(worldDir, 'links.json');
  const otbmFile = values.otbm ?? 'otservbr.otbm';
  const otbmPath = join(thingsDir, 'maps', otbmFile);
  const itemsPath = join(canaryDir, 'data', 'items', 'items.xml');
  const globalPath = join(canaryDir, 'data', 'global.lua');
  const skip = (message: string): void => {
    if (values.check) { console.log(`links: ${message} — pulado`); process.exit(0); }
    console.error(message);
    process.exit(1);
  };
  if (!existsSync(join(worldDir, 'index.json'))) skip(`${worldDir} não foi gerado — rode pnpm map:world`);
  if (values.check && !existsSync(outPath)) skip(`${outPath} não foi gerado nesta máquina`);
  if (!existsSync(otbmPath)) skip(`${otbmPath} não existe — rode pnpm map:fetch`);
  if (!existsSync(itemsPath) || !existsSync(globalPath)) skip(`Canary não encontrado em ${canaryDir} (CANARY_DIR)`);
  const appearancesPath = findAppearances(thingsDir, version, canaryDir);
  if (appearancesPath === null) skip('sem appearances.dat');

  const started = performance.now();
  const index: unknown = JSON.parse(readFileSync(join(worldDir, 'index.json'), 'utf8'));
  if (!isWorldIndex(index)) skip('índice do mundo inválido');
  const catalogue = readAppearances(readFileSync(appearancesPath as string));
  const otbm = new Uint8Array(readFileSync(otbmPath));
  const teleports: Array<readonly [Point, Point]> = [];
  for (const tile of readOtbmTiles(otbm, { x: [0, 65535], y: [0, 65535], z: [0, 15] })) {
    for (const item of tile.items) {
      if (item.teleportTo !== undefined) teleports.push([[tile.x, tile.y, tile.z], [item.teleportTo.x, item.teleportTo.y, item.teleportTo.z]]);
    }
  }
  const derived = deriveLinks({
    tiles: worldTiles(index as WorldIndex, worldDir),
    lookup: sectorLookup(worldDir),
    items: parseItemsXml(readFileSync(itemsPath, 'utf8')),
    rope: parseRopeSpots(readFileSync(globalPath, 'utf8')),
    unpass: (id) => catalogue.object.get(id)?.flags?.unpass ?? false,
    teleports,
  });
  const out = formatLinks({
    format: 'draconya-links/1',
    source: { file: otbmFile, sha256: createHash('sha256').update(otbm).digest('hex') },
    ...derived,
  });
  const seconds = Math.round((performance.now() - started) / 1000);
  if (values.check) {
    if (readFileSync(outPath, 'utf8') === out) { console.log(`links: ${derived.links.length} ligações conferem (${seconds} s)`); process.exit(0); }
    console.error('links: DESATUALIZADO — rode pnpm map:links');
    process.exit(1);
  }
  writeFileSync(outPath, out);
  const count = (kind: LinkKind): number => derived.links.filter((link) => link[2] === kind).length;
  console.log(`ligações escritas em ${seconds} s: ${count('stairs')} escadas/rampas/buracos, ${count('ladder')} escadas de mão, ${count('rope')} cordas, ${count('teleport')} teleportes; ${derived.doors.length} portas`);
  console.log(`  escrito: ${outPath}`);
}
