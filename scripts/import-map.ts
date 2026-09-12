// O importador de mapa real (FUN-118, ADR 0025): recorta uma região e uma faixa de andares do
// `otservbr.otbm` e escreve os DOIS produtos que a decisão pede, um por consumidor.
//
//   pnpm map:import --id thais --x 32275..32458 --y 32153..32291 --z 4..7 --entry 32369,32241,7
//   pnpm map:import --id rat-cellars --x 32120..32270 --y 31990..32140 --z 8 --keep-from 32200,32070,8
//   pnpm map:import --check      # regenera em memória cada mapa importado e compara (pnpm check)
//
//   packages/content/data/maps/<id>.json   geometria para o SERVIDOR: bloqueio e velocidade de
//                                          chão por andar, escadas, entrada, `source`. Versionado.
//   things/<versão>/maps/<id>.json         a pilha de aparências por tile, para o CLIENTE, servida
//                                          por `/things/` como as folhas. Nunca versionado.
//
// O bloqueio deriva das flags do pacote UMA vez, aqui: `#` se o chão ou qualquer item tem
// `unpass`; tile sem chão mas com item existe e é decidido pelos itens (é o degrau de escada);
// tile sem chão e sem item fica fora do mapa. O `sim` nunca vê flag — vê `#` e `.`.
//
// Um mesmo tile pode vir duas vezes do arquivo (o editor fecha e reabre o bloco): o ÚLTIMO
// vence, e o relatório conta. `TILE_FLAGS` (PZ, no-logout) são ignorados — a Cidade inteira já
// é PZ por construção (ADR 0004). As escadas NÃO são derivadas: o importador lista os candidatos
// pelo nome da aparência, e quem autora `floorChanges` é um humano, no JSON do mapa.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { NO_FLAGS, readAppearances } from '../packages/client/src/assets/appearances.js';
import type { AppearanceCatalogue, AppearanceFlags } from '../packages/client/src/assets/appearances.js';
import { readCatalog } from '../packages/client/src/assets/catalog.js';
import { Reader, WIRE_LENGTH, WIRE_VARINT } from '../packages/client/src/assets/protobuf.js';
import { DEFAULT_GROUND_SPEED } from '../packages/content/src/map.js';
import { tilemapSchema } from '../packages/content/src/schemas.js';
import type { TilemapInput } from '../packages/content/src/schemas.js';
import { readOtbmTiles } from './otbm.js';
import type { OtbmTile, Region } from './otbm.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAPS_DIR = join(ROOT, 'packages', 'content', 'data', 'maps');

/** Um tile depois do recorte, em coordenadas do MAPA REAL. */
export interface RegionTile {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ground: number | null;
  readonly items: ReadonlyArray<{ readonly id: number; readonly count?: number }>;
}

export interface ImportOptions {
  readonly id: string;
  readonly region: Region;
  /** As flags de um objeto do pacote; `null` quando o id não existe nele. */
  readonly flagsOf: (appearanceId: number) => AppearanceFlags | null;
  /** Nome do objeto no pacote, só para o relatório de candidatos a escada. */
  readonly nameOf?: (appearanceId: number) => string | undefined;
  /** Onde se nasce, em coordenadas do mapa real. */
  readonly entryPoint?: { readonly x: number; readonly y: number; readonly z: number };
  /** Mantém só a componente andável (4 vizinhos) que contém este tile, mais a borda de um tile. */
  readonly keepFrom?: { readonly x: number; readonly y: number; readonly z: number };
  /** O andar padrão do mapa. Ausente: o da entrada, ou o menor da faixa. */
  readonly defaultZ?: number;
  readonly source: { readonly file: string; readonly sha256: string };
  /** Versão do pacote de arte, para o arquivo do cliente. */
  readonly version: string;
  /** Segue com ids que o pacote não tem (viram andáveis e são reportados). Padrão: erro. */
  readonly allowUnknown?: boolean;
}

/** O que vai para `things/<versão>/maps/<id>.json`. Coordenadas LOCAIS ao recorte. */
export interface StackMap {
  readonly id: string;
  readonly version: string;
  readonly source: TilemapInput['source'];
  readonly width: number;
  readonly height: number;
  readonly floors: readonly number[];
  /** `[x, y, z, chão (0 = sem chão), [item | [item, contagem]…]]`. */
  readonly tiles: ReadonlyArray<readonly [number, number, number, number, ReadonlyArray<number | readonly [number, number]>]>;
}

export interface ImportReport {
  readonly tilesRead: number;
  readonly conflicts: number;
  readonly dropped: number;
  readonly perFloor: ReadonlyArray<{ readonly z: number; readonly tiles: number; readonly blocked: number; readonly walkable: number }>;
  readonly distinctIds: number;
  readonly unknownIds: readonly number[];
  readonly flaggedTiles: number;
  readonly stairCandidates: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number; readonly id: number; readonly name: string }>;
  readonly region: Region;
}

export interface ImportResult {
  readonly content: TilemapInput;
  readonly stack: StackMap;
  readonly report: ImportReport;
}

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Acumula os tiles por coordenada; o último vence. Devolve também quantas vezes venceu. */
export function collectTiles(tiles: Iterable<OtbmTile>): { tiles: Map<string, RegionTile>; conflicts: number; read: number } {
  const map = new Map<string, RegionTile>();
  let conflicts = 0;
  let read = 0;
  for (const tile of tiles) {
    read += 1;
    const k = key(tile.x, tile.y, tile.z);
    if (map.has(k)) conflicts += 1;
    map.set(k, { x: tile.x, y: tile.y, z: tile.z, ground: tile.ground, items: tile.items });
  }
  return { tiles: map, conflicts, read };
}

/** Um tile existe quando tem chão OU item. Fora disso é vazio — fora do mapa. */
const exists = (tile: RegionTile): boolean => tile.ground !== null || tile.items.length > 0;

/**
 * Bloqueado quando o chão ou qualquer item da pilha tem `unpass`. Tile sem chão e com item é
 * decidido pelos itens — o degrau de escada é assim. Id desconhecido não bloqueia, e é
 * reportado.
 */
function blockedOf(tile: RegionTile, flagsOf: ImportOptions['flagsOf'], unknown: Set<number>): boolean {
  const ids = tile.ground === null ? [] : [tile.ground];
  for (const item of tile.items) ids.push(item.id);
  let blocked = false;
  for (const id of ids) {
    const flags = flagsOf(id);
    if (flags === null) { unknown.add(id); continue; }
    if (flags.unpass) blocked = true;
  }
  return blocked;
}

/** Componente andável (4 vizinhos) a partir do tile-semente, no andar dele. */
function walkableComponent(
  tiles: Map<string, RegionTile>, blocked: Map<string, boolean>, seed: { x: number; y: number; z: number },
): Set<string> {
  const seen = new Set<string>();
  const start = key(seed.x, seed.y, seed.z);
  if (!tiles.has(start) || blocked.get(start) === true) {
    throw new Error(`--keep-from (${seed.x},${seed.y},${seed.z}) não é um tile andável do recorte`);
  }
  const queue = [seed];
  seen.add(start);
  while (queue.length > 0) {
    const at = queue.shift() as { x: number; y: number; z: number };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = { x: at.x + dx, y: at.y + dy, z: at.z };
      const k = key(next.x, next.y, next.z);
      if (seen.has(k) || !tiles.has(k) || blocked.get(k) === true) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return seen;
}

const PALETTE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const STAIR_NAME = /stair|ladder|ramp|hole|rope spot|trapdoor|sewer grate/i;

export function importRegion(source: Iterable<OtbmTile>, options: ImportOptions): ImportResult {
  const collected = collectTiles(source);
  const unknown = new Set<number>();
  const blocked = new Map<string, boolean>();
  let dropped = 0;
  for (const [k, tile] of collected.tiles) {
    if (!exists(tile)) { collected.tiles.delete(k); dropped += 1; continue; }
    blocked.set(k, blockedOf(tile, options.flagsOf, unknown));
  }
  if (unknown.size > 0 && !options.allowUnknown) {
    throw new Error(
      `${unknown.size} ids do mapa não existem no pacote (${[...unknown].slice(0, 10).join(', ')}…); `
        + 'o recorte tem arte de outra versão — confira THINGS_VERSION, ou passe --allow-unknown',
    );
  }

  // Recorte à componente: fica a componente andável mais a borda de um tile (paredes, decoração).
  let kept: Set<string> | null = null;
  if (options.keepFrom !== undefined) {
    const component = walkableComponent(collected.tiles, blocked, options.keepFrom);
    kept = new Set(component);
    for (const k of component) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) kept.add(key(x + dx, y + dy, z));
      }
    }
    for (const k of [...collected.tiles.keys()]) {
      if (!kept.has(k)) { collected.tiles.delete(k); dropped += 1; }
    }
  }

  // A caixa final: a região pedida, ou a caixa dos tiles que ficaram depois do recorte.
  let region = options.region;
  if (kept !== null) {
    const xs = [...collected.tiles.values()].map((t) => t.x);
    const ys = [...collected.tiles.values()].map((t) => t.y);
    const zs = [...collected.tiles.values()].map((t) => t.z);
    region = {
      x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)],
      z: [Math.min(...zs), Math.max(...zs)],
    };
  }
  const width = region.x[1] - region.x[0] + 1;
  const height = region.y[1] - region.y[0] + 1;
  const floorsPresent = [...new Set([...collected.tiles.values()].map((t) => t.z))].sort((a, b) => a - b);
  if (floorsPresent.length === 0) throw new Error('a região não tem tile nenhum');

  // A paleta de velocidades: um caractere por valor distinto, em ordem crescente, para o
  // arquivo ser legível — `a` é sempre o chão mais rápido do mapa.
  const speeds = new Set<number>();
  const speedOf = (tile: RegionTile): number => {
    if (tile.ground === null) return DEFAULT_GROUND_SPEED;
    const waypoints = options.flagsOf(tile.ground)?.bankWaypoints;
    return waypoints === undefined || waypoints === 0 ? DEFAULT_GROUND_SPEED : waypoints;
  };
  for (const [k, tile] of collected.tiles) if (blocked.get(k) !== true) speeds.add(speedOf(tile));
  const speedList = [...speeds].sort((a, b) => a - b);
  if (speedList.length > PALETTE.length) throw new Error(`${speedList.length} velocidades de chão distintas — a paleta tem ${PALETTE.length}`);
  const speedPalette: Record<string, number> = {};
  const charOf = new Map<number, string>();
  speedList.forEach((speed, index) => {
    const char = PALETTE[index] as string;
    speedPalette[char] = speed;
    charOf.set(speed, char);
  });

  const floors: Record<string, { grid: string[]; speed: string[] }> = {};
  const perFloor: Array<{ z: number; tiles: number; blocked: number; walkable: number }> = [];
  for (const z of floorsPresent) {
    const grid: string[] = [];
    const speedRows: string[] = [];
    let count = 0;
    let blockedCount = 0;
    for (let y = region.y[0]; y <= region.y[1]; y++) {
      let row = '';
      let speedRow = '';
      for (let x = region.x[0]; x <= region.x[1]; x++) {
        const k = key(x, y, z);
        const tile = collected.tiles.get(k);
        if (tile === undefined) { row += '#'; speedRow += ' '; continue; }
        count += 1;
        if (blocked.get(k) === true) { row += '#'; speedRow += ' '; blockedCount += 1; continue; }
        row += '.';
        speedRow += charOf.get(speedOf(tile)) ?? ' ';
      }
      grid.push(row);
      speedRows.push(speedRow);
    }
    floors[String(z)] = { grid, speed: speedRows };
    perFloor.push({ z, tiles: count, blocked: blockedCount, walkable: count - blockedCount });
  }

  const ids = new Set<number>();
  const stackTiles: Array<[number, number, number, number, Array<number | [number, number]>]> = [];
  const sortedTiles = [...collected.tiles.values()].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  const stairCandidates: ImportReport['stairCandidates'] = [];
  for (const tile of sortedTiles) {
    if (tile.ground !== null) ids.add(tile.ground);
    for (const item of tile.items) ids.add(item.id);
    const items = tile.items.map((item) =>
      (item.count === undefined || item.count <= 1 ? item.id : [item.id, item.count] as [number, number]));
    stackTiles.push([tile.x - region.x[0], tile.y - region.y[0], tile.z, tile.ground ?? 0, items]);
    if (options.nameOf !== undefined) {
      for (const id of [tile.ground, ...tile.items.map((i) => i.id)]) {
        if (id === null) continue;
        const name = options.nameOf(id);
        if (name !== undefined && STAIR_NAME.test(name)) {
          stairCandidates.push({ x: tile.x - region.x[0], y: tile.y - region.y[0], z: tile.z, id, name });
        }
      }
    }
  }

  const defaultZ = options.defaultZ ?? options.entryPoint?.z ?? (floorsPresent[floorsPresent.length - 1] as number);
  if (!floorsPresent.includes(defaultZ)) throw new Error(`o andar padrão ${defaultZ} não tem tile nenhum na região`);
  const entry = options.entryPoint === undefined
    ? undefined
    : { x: options.entryPoint.x - region.x[0], y: options.entryPoint.y - region.y[0], z: options.entryPoint.z };
  if (entry !== undefined) {
    const k = key(options.entryPoint?.x ?? 0, options.entryPoint?.y ?? 0, entry.z);
    if (!collected.tiles.has(k) || blocked.get(k) === true) {
      throw new Error(`--entry (${options.entryPoint?.x},${options.entryPoint?.y},${entry.z}) não é um tile andável do recorte`);
    }
  }

  const sourceField = {
    file: options.source.file, sha256: options.source.sha256,
    region: { x: [region.x[0], region.x[1]] as [number, number], y: [region.y[0], region.y[1]] as [number, number], z: [region.z[0], region.z[1]] as [number, number] },
  };
  const content: TilemapInput = {
    id: options.id,
    z: defaultZ,
    floors,
    speedPalette,
    ...(entry === undefined ? {} : { entryPoint: entry }),
    floorChanges: [],
    source: sourceField,
  };
  tilemapSchema.parse(content);

  const flaggedTiles = 0;
  return {
    content,
    stack: { id: options.id, version: options.version, source: sourceField, width, height, floors: floorsPresent, tiles: stackTiles },
    report: {
      tilesRead: collected.read, conflicts: collected.conflicts, dropped, perFloor,
      distinctIds: ids.size, unknownIds: [...unknown].sort((a, b) => a - b), flaggedTiles,
      stairCandidates, region,
    },
  };
}

/**
 * O JSON do mapa de conteúdo, com uma linha por linha da grade — é o que torna o diff legível
 * quando alguém autora uma escada ou muda a entrada.
 */
export function formatContentMap(map: TilemapInput): string {
  const lines: string[] = ['{', `  "id": ${JSON.stringify(map.id)},`, `  "z": ${map.z},`];
  if (map.entryPoint !== undefined) lines.push(`  "entryPoint": ${JSON.stringify(map.entryPoint)},`);
  lines.push(`  "floorChanges": ${JSON.stringify(map.floorChanges ?? [])},`);
  lines.push(`  "speedPalette": ${JSON.stringify(map.speedPalette ?? {})},`);
  lines.push('  "floors": {');
  const entries = Object.entries(map.floors ?? {});
  entries.forEach(([z, floor], index) => {
    lines.push(`    "${z}": {`);
    lines.push('      "grid": [');
    floor.grid.forEach((row, i) => lines.push(`        ${JSON.stringify(row)}${i === floor.grid.length - 1 ? '' : ','}`));
    lines.push(floor.speed === undefined ? '      ]' : '      ],');
    if (floor.speed !== undefined) {
      lines.push('      "speed": [');
      floor.speed.forEach((row, i) => lines.push(`        ${JSON.stringify(row)}${i === floor.speed!.length - 1 ? '' : ','}`));
      lines.push('      ]');
    }
    lines.push(`    }${index === entries.length - 1 ? '' : ','}`);
  });
  lines.push('  },');
  lines.push(`  "source": ${JSON.stringify(map.source)}`);
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** O JSON do cliente: um tile por linha, compacto — são dezenas de milhares. */
export function formatStackMap(stack: StackMap): string {
  const head = JSON.stringify({ id: stack.id, version: stack.version, source: stack.source, width: stack.width, height: stack.height, floors: stack.floors });
  const tiles = stack.tiles.map((tile) => JSON.stringify(tile));
  return `${head.slice(0, -1)},"tiles":[\n${tiles.join(',\n')}\n]}\n`;
}

/**
 * Só os nomes dos objetos, para o relatório de escadas. É a única leitura do campo 4 do
 * `appearances.dat` em todo o repositório — o leitor do cliente o pula de propósito.
 */
export function readObjectNames(bytes: Uint8Array): Map<number, string> {
  const names = new Map<number, string>();
  const decoder = new TextDecoder();
  const reader = new Reader(bytes);
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field !== 1 || wire !== WIRE_LENGTH) { reader.skip(wire); continue; }
    const appearance = reader.slice();
    let id = 0;
    let name: string | undefined;
    while (!appearance.done) {
      const inner = appearance.tag();
      if (inner.field === 1 && inner.wire === WIRE_VARINT) { id = appearance.varint(); continue; }
      if (inner.field === 4 && inner.wire === WIRE_LENGTH) { name = decoder.decode(appearance.bytes()); continue; }
      appearance.skip(inner.wire);
    }
    if (id !== 0 && name !== undefined) names.set(id, name);
  }
  return names;
}

/** O pacote de arte em `things/<versão>/`: catálogo de aparências e nomes. */
export function loadPack(thingsDir: string, version: string): { catalogue: AppearanceCatalogue; names: Map<number, string> } {
  const packDir = join(thingsDir, version);
  const catalogPath = join(packDir, 'catalog-content.json');
  if (!existsSync(catalogPath)) throw new Error(`pacote ${version} não está em ${thingsDir}`);
  const catalog = readCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown);
  const bytes = readFileSync(join(packDir, catalog.appearancesFile));
  return { catalogue: readAppearances(bytes), names: readObjectNames(new Uint8Array(bytes)) };
}

export function flagsFrom(catalogue: AppearanceCatalogue): ImportOptions['flagsOf'] {
  return (id) => {
    const appearance = catalogue.object.get(id);
    if (appearance === undefined) return null;
    return appearance.flags ?? NO_FLAGS;
  };
}

/** `32275..32458` → `[32275, 32458]`; `8` → `[8, 8]`. */
export function parseRange(text: string): [number, number] {
  const [a, b] = text.split('..').map(Number);
  if (a === undefined || Number.isNaN(a) || (b !== undefined && Number.isNaN(b))) throw new Error(`faixa inválida: ${text}`);
  return [a, b ?? a];
}

export function parsePoint(text: string): { x: number; y: number; z: number } {
  const [x, y, z] = text.split(',').map(Number);
  if (x === undefined || y === undefined || z === undefined || [x, y, z].some(Number.isNaN)) throw new Error(`ponto inválido: ${text}`);
  return { x, y, z };
}

export interface CheckOutcome {
  readonly file: string;
  readonly status: 'fresh' | 'stale' | 'absent' | 'hand-made';
  readonly detail?: string;
}

/**
 * `--check`: para cada mapa versionado com `source`, regenera do OTBM e compara. Sem o OTBM na
 * máquina é `absent` (aviso, como o inventário do pacote); mapa autorado à mão é `hand-made`.
 * A pilha em `things/` não é comparada — ela não é versionada — só conferida presente.
 */
export function checkMaps(mapsDir: string, thingsDir: string, version: string, otbmDir: string): CheckOutcome[] {
  const files = existsSync(mapsDir) ? readdirSync(mapsDir).filter((name) => name.endsWith('.json')).sort() : [];
  let pack: ReturnType<typeof loadPack> | null = null;
  return files.map((file) => {
    const committed = tilemapSchema.parse(JSON.parse(readFileSync(join(mapsDir, file), 'utf8')));
    if (committed.source === undefined) return { file, status: 'hand-made' };
    const otbmPath = join(otbmDir, committed.source.file);
    if (!existsSync(otbmPath)) return { file, status: 'absent' };
    const bytes = new Uint8Array(readFileSync(otbmPath));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== committed.source.sha256) {
      return { file, status: 'stale', detail: `o OTBM mudou: sha256 ${committed.source.sha256.slice(0, 12)}… no arquivo, ${sha256.slice(0, 12)}… no disco` };
    }
    pack ??= loadPack(thingsDir, version);
    const region = committed.source.region;
    const entry = committed.entryPoint === undefined
      ? undefined
      : { x: committed.entryPoint.x + region.x[0], y: committed.entryPoint.y + region.y[0], z: committed.entryPoint.z ?? committed.z };
    const regenerated = importRegion(readOtbmTiles(bytes, region), {
      id: committed.id, region, flagsOf: flagsFrom(pack.catalogue),
      ...(entry === undefined ? {} : { entryPoint: entry }),
      defaultZ: committed.z, source: { file: committed.source.file, sha256 }, version, allowUnknown: true,
    });
    const before = JSON.stringify({ floors: committed.floors, speedPalette: committed.speedPalette ?? {} });
    const after = JSON.stringify({ floors: regenerated.content.floors, speedPalette: regenerated.content.speedPalette ?? {} });
    if (before !== after) {
      return { file, status: 'stale', detail: 'a geometria regenerada difere da versionada — o recorte foi editado à mão, ou o pacote mudou' };
    }
    const stackPath = join(thingsDir, version, 'maps', `${committed.id}.json`);
    if (!existsSync(stackPath)) return { file, status: 'stale', detail: `${stackPath} não existe — rode pnpm map:import de novo` };
    return { file, status: 'fresh' };
  });
}

function usage(): string {
  return 'Usage: pnpm map:import --id <id> --x a..b --y a..b --z a..b [--entry x,y,z] [--keep-from x,y,z]'
    + ' [--default-z n] [--otbm <file>] [--things <dir>] [--version <n>] [--allow-unknown] | --check';
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: {
      id: { type: 'string' }, x: { type: 'string' }, y: { type: 'string' }, z: { type: 'string' },
      entry: { type: 'string' }, 'keep-from': { type: 'string' }, 'default-z': { type: 'string' },
      otbm: { type: 'string' }, things: { type: 'string' }, version: { type: 'string' },
      'allow-unknown': { type: 'boolean' }, check: { type: 'boolean' },
    },
    strict: true,
  });
  const thingsDir = resolve(ROOT, values.things ?? process.env.THINGS_DIR ?? 'things');
  const version = values.version ?? process.env.THINGS_VERSION ?? '1332';
  const otbmDir = join(thingsDir, 'maps');

  if (values.check) {
    const outcomes = checkMaps(MAPS_DIR, thingsDir, version, otbmDir);
    let stale = false;
    for (const outcome of outcomes) {
      if (outcome.status === 'fresh') console.log(`maps/${outcome.file}: confere com o OTBM`);
      else if (outcome.status === 'hand-made') console.log(`maps/${outcome.file}: autorado à mão, nada a conferir`);
      else if (outcome.status === 'absent') console.log(`maps/${outcome.file}: OTBM não está nesta máquina — pulado (rode pnpm map:fetch)`);
      else { stale = true; console.error(`maps/${outcome.file}: DESATUALIZADO — ${outcome.detail ?? ''}`); }
    }
    process.exit(stale ? 1 : 0);
  }

  if (values.id === undefined || values.x === undefined || values.y === undefined || values.z === undefined) {
    console.error(usage());
    process.exit(2);
  }
  const otbmFile = values.otbm ?? 'otservbr.otbm';
  const otbmPath = resolve(otbmDir, otbmFile);
  if (!existsSync(otbmPath)) {
    console.error(`${otbmPath} não existe — rode pnpm map:fetch`);
    process.exit(1);
  }
  const bytes = new Uint8Array(readFileSync(otbmPath));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const region: Region = { x: parseRange(values.x), y: parseRange(values.y), z: parseRange(values.z) };
  const pack = loadPack(thingsDir, version);
  const started = performance.now();
  const result = importRegion(readOtbmTiles(bytes, region), {
    id: values.id, region, flagsOf: flagsFrom(pack.catalogue), nameOf: (id) => pack.names.get(id),
    ...(values.entry === undefined ? {} : { entryPoint: parsePoint(values.entry) }),
    ...(values['keep-from'] === undefined ? {} : { keepFrom: parsePoint(values['keep-from']) }),
    ...(values['default-z'] === undefined ? {} : { defaultZ: Number(values['default-z']) }),
    source: { file: otbmFile, sha256 }, version,
    ...(values['allow-unknown'] ? { allowUnknown: true } : {}),
  });

  // Se o mapa já existe com escadas autoradas, elas são preservadas: o importador regenera a
  // geometria, nunca o que um humano escreveu por cima dela.
  const contentPath = join(MAPS_DIR, `${values.id}.json`);
  let content = result.content;
  if (existsSync(contentPath)) {
    const previous = tilemapSchema.safeParse(JSON.parse(readFileSync(contentPath, 'utf8')));
    if (previous.success && previous.data.floorChanges.length > 0) {
      content = { ...content, floorChanges: previous.data.floorChanges };
      console.log(`${previous.data.floorChanges.length} floorChanges preservadas de ${contentPath}`);
    }
  }
  mkdirSync(MAPS_DIR, { recursive: true });
  writeFileSync(contentPath, formatContentMap(content));
  const stackDir = join(thingsDir, version, 'maps');
  mkdirSync(stackDir, { recursive: true });
  const stackPath = join(stackDir, `${values.id}.json`);
  writeFileSync(stackPath, formatStackMap(result.stack));

  const { report } = result;
  console.log(`importado "${values.id}" em ${Math.round(performance.now() - started)} ms`);
  console.log(`  região: x ${report.region.x[0]}..${report.region.x[1]}, y ${report.region.y[0]}..${report.region.y[1]}, z ${report.region.z[0]}..${report.region.z[1]} (${result.stack.width}×${result.stack.height})`);
  console.log(`  tiles lidos: ${report.tilesRead}; conflitos (último venceu): ${report.conflicts}; descartados: ${report.dropped}`);
  for (const floor of report.perFloor) console.log(`  z${floor.z}: ${floor.tiles} tiles, ${floor.walkable} andáveis, ${floor.blocked} bloqueados`);
  console.log(`  aparências distintas: ${report.distinctIds}; desconhecidas no pacote: ${report.unknownIds.length}${report.unknownIds.length > 0 ? ` (${report.unknownIds.slice(0, 20).join(', ')})` : ''}`);
  console.log(`  candidatos a escada (autorar em floorChanges): ${report.stairCandidates.length}`);
  for (const candidate of report.stairCandidates.slice(0, 60)) {
    console.log(`    (${candidate.x},${candidate.y},${candidate.z}) ${candidate.id} ${candidate.name}`);
  }
  console.log(`  escrito: ${contentPath}`);
  console.log(`  escrito: ${stackPath}`);
}
