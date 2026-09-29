// O censo do mapa inteiro (#659, fase 0 do `docs/world-map-plan.md`): lê o `otservbr.otbm`
// todo e responde, com número, as perguntas que o formato do mundo em setores precisa antes de
// existir. Não escreve mapa nem toca `content/` — só um relatório.
//
//   pnpm map:census                 # things/maps/otservbr.otbm → things/maps/census.json
//   pnpm map:census --otbm <file> --things <dir> --version <n>
//
// O relatório mora em `things/maps/`, ao lado do OTBM: é dado derivado do mapa da CipSoft, na
// mesma classe de risco (ADR 0008/0025), e nunca é versionado.
//
// A agregação é PURA (`createCensus`): entra tile, sai relatório. O mundo tem dezenas de milhões
// de tiles, então nada guarda o tile em si — só contadores, um bitset de 32×32 por setor (que
// detecta o tile repetido e conta os setores de uma vez) e as listas pequenas (teleportes).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { loadPack } from './import-map.js';
import { readOtbmHeader, readOtbmTiles, readOtbmTownsAndWaypoints, TILE_FLAG } from './otbm.js';
import type { OtbmHeader, OtbmPosition, OtbmTile, OtbmTown, OtbmWaypoint } from './otbm.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** O lado do setor que o plano propõe para o mundo em `things/` (fase 1). */
export const SECTOR_SIZE = 32;
const SECTOR_BITS = (SECTOR_SIZE * SECTOR_SIZE) / 8;

/** Um tile area do OTBM tem 256×256; o gzip do binário é medido por bloco desse tamanho. */
const GZIP_BLOCK = 256;

export interface FloorCensus {
  readonly z: number;
  readonly tiles: number;
  readonly withoutGround: number;
  readonly bbox: { readonly x: readonly [number, number]; readonly y: readonly [number, number] };
  readonly sectors: number;
}

export interface CensusReport {
  readonly header: OtbmHeader;
  readonly tiles: number;
  readonly tileRecords: number;
  readonly duplicates: number;
  readonly floors: readonly FloorCensus[];
  readonly appearances: {
    readonly distinct: number;
    /** `null` quando o pacote de arte não está na máquina. */
    readonly pack: null | {
      readonly version: string;
      readonly missing: number;
      /** Os ids que o pacote não tem, do que mais aparece ao que menos aparece. */
      readonly missingIds: ReadonlyArray<{ readonly id: number; readonly tiles: number }>;
      readonly tilesAffected: number;
    };
  };
  readonly zones: {
    readonly protectionZone: number;
    readonly noPvp: number;
    readonly noLogout: number;
    readonly pvpZone: number;
    readonly houseTiles: number;
    readonly houses: number;
  };
  readonly items: {
    readonly teleports: number;
    /** Destino `(0, 0, 0)`: quem decide para onde vai é o script do servidor, não o mapa. */
    readonly scriptedTeleports: number;
    /** Teleportes com destino gravado que não é um tile do mapa. */
    readonly teleportsToNowhere: ReadonlyArray<{ readonly from: OtbmPosition; readonly to: OtbmPosition }>;
    readonly houseDoors: number;
    readonly withActionId: number;
    readonly withUniqueId: number;
  };
  readonly towns: readonly OtbmTown[];
  readonly waypoints: readonly OtbmWaypoint[];
  readonly size: {
    readonly sectorSize: number;
    readonly sectors: number;
    /** O tile no formato do JSON de recorte de hoje (`formatStackMap`). */
    readonly jsonBytes: number;
    /** `u8 dx, u8 dy, u16 chão, u8 n, n × u16 item (+ u8 contagem)` por tile, mais 2 bytes por setor. */
    readonly binaryBytes: number;
    readonly binaryGzipBytes: number;
  };
}

interface MutableFloor {
  tiles: number;
  withoutGround: number;
  minX: number; maxX: number; minY: number; maxY: number;
}

const sectorKey = (x: number, y: number, z: number): number =>
  // x e y do Tibia cabem em 16 bits; o setor em 11. `z` em 4. Cabe folgado num inteiro seguro.
  (((z * 2048) + Math.floor(y / SECTOR_SIZE)) * 2048) + Math.floor(x / SECTOR_SIZE);

/** O binário proposto de um tile, para medir tamanho e compressão. */
function encodeTile(tile: OtbmTile): number[] {
  const bytes = [tile.x % SECTOR_SIZE, tile.y % SECTOR_SIZE, (tile.ground ?? 0) & 0xff, (tile.ground ?? 0) >>> 8, tile.items.length];
  for (const item of tile.items) {
    bytes.push(item.id & 0xff, item.id >>> 8);
    if (item.count !== undefined && item.count > 1) bytes.push(item.count);
  }
  return bytes;
}

/** O tile como `formatStackMap` o escreveria, com coordenada local ao setor. */
function jsonLength(tile: OtbmTile): number {
  const items = tile.items.map((item) => (item.count === undefined || item.count <= 1 ? item.id : [item.id, item.count]));
  // `,\n` entre tiles.
  return JSON.stringify([tile.x % SECTOR_SIZE, tile.y % SECTOR_SIZE, tile.z, tile.ground ?? 0, items]).length + 2;
}

export interface Census {
  add(tile: OtbmTile): void;
  finish(input: {
    readonly header: OtbmHeader;
    readonly towns: readonly OtbmTown[];
    readonly waypoints: readonly OtbmWaypoint[];
    /** O catálogo do pacote de arte, quando ele está na máquina. */
    readonly pack?: { readonly version: string; readonly has: (id: number) => boolean };
  }): CensusReport;
}

export function createCensus(): Census {
  const floors = new Map<number, MutableFloor>();
  const sectors = new Map<number, Uint8Array>();
  const appearanceTiles = new Map<number, number>();
  const houses = new Set<number>();
  const teleports: Array<{ from: OtbmPosition; to: OtbmPosition }> = [];
  const zones = { protectionZone: 0, noPvp: 0, noLogout: 0, pvpZone: 0, houseTiles: 0 };
  const items = { houseDoors: 0, withActionId: 0, withUniqueId: 0 };
  let tileRecords = 0;
  let duplicates = 0;
  let jsonBytes = 0;
  let binaryBytes = 0;
  let binaryGzipBytes = 0;
  let block: number[] = [];
  let blockKey: number | null = null;

  const flushBlock = (): void => {
    if (block.length > 0) binaryGzipBytes += gzipSync(Uint8Array.from(block)).length;
    block = [];
  };

  return {
    add(tile) {
      tileRecords += 1;
      const key = sectorKey(tile.x, tile.y, tile.z);
      let bits = sectors.get(key);
      if (bits === undefined) { bits = new Uint8Array(SECTOR_BITS); sectors.set(key, bits); }
      const bit = (tile.y % SECTOR_SIZE) * SECTOR_SIZE + (tile.x % SECTOR_SIZE);
      const mask = 1 << (bit & 7);
      const byte = bit >>> 3;
      // O tile repetido conta como conflito e é o último que vence (ADR 0025 d.9); para o censo,
      // basta não contá-lo duas vezes nos totais de tile.
      if (((bits[byte] as number) & mask) !== 0) { duplicates += 1; return; }
      bits[byte] = (bits[byte] as number) | mask;

      let floor = floors.get(tile.z);
      if (floor === undefined) {
        floor = { tiles: 0, withoutGround: 0, minX: tile.x, maxX: tile.x, minY: tile.y, maxY: tile.y };
        floors.set(tile.z, floor);
      }
      floor.tiles += 1;
      if (tile.ground === null) floor.withoutGround += 1;
      floor.minX = Math.min(floor.minX, tile.x);
      floor.maxX = Math.max(floor.maxX, tile.x);
      floor.minY = Math.min(floor.minY, tile.y);
      floor.maxY = Math.max(floor.maxY, tile.y);

      const seen = new Set<number>();
      if (tile.ground !== null) seen.add(tile.ground);
      for (const item of tile.items) seen.add(item.id);
      for (const id of seen) appearanceTiles.set(id, (appearanceTiles.get(id) ?? 0) + 1);

      if ((tile.flags & TILE_FLAG.protectionZone) !== 0) zones.protectionZone += 1;
      if ((tile.flags & TILE_FLAG.noPvp) !== 0) zones.noPvp += 1;
      if ((tile.flags & TILE_FLAG.noLogout) !== 0) zones.noLogout += 1;
      if ((tile.flags & TILE_FLAG.pvpZone) !== 0) zones.pvpZone += 1;
      if (tile.houseId !== undefined) { zones.houseTiles += 1; houses.add(tile.houseId); }

      for (const item of tile.items) {
        if (item.teleportTo !== undefined) teleports.push({ from: { x: tile.x, y: tile.y, z: tile.z }, to: item.teleportTo });
        if (item.houseDoorId !== undefined) items.houseDoors += 1;
        if (item.actionId !== undefined) items.withActionId += 1;
        if (item.uniqueId !== undefined) items.withUniqueId += 1;
      }

      jsonBytes += jsonLength(tile);
      const encoded = encodeTile(tile);
      binaryBytes += encoded.length;
      const nextBlock = (tile.z * 256 + Math.floor(tile.y / GZIP_BLOCK)) * 256 + Math.floor(tile.x / GZIP_BLOCK);
      if (nextBlock !== blockKey) { flushBlock(); blockKey = nextBlock; }
      for (const b of encoded) block.push(b);
    },

    finish({ header, towns, waypoints, pack }) {
      flushBlock();
      const exists = (p: OtbmPosition): boolean => {
        const bits = sectors.get(sectorKey(p.x, p.y, p.z));
        if (bits === undefined) return false;
        const bit = (p.y % SECTOR_SIZE) * SECTOR_SIZE + (p.x % SECTOR_SIZE);
        return ((bits[bit >>> 3] as number) & (1 << (bit & 7))) !== 0;
      };
      const sectorsPerFloor = new Map<number, number>();
      for (const key of sectors.keys()) {
        const z = Math.floor(key / (2048 * 2048));
        sectorsPerFloor.set(z, (sectorsPerFloor.get(z) ?? 0) + 1);
      }
      const floorList: FloorCensus[] = [...floors.entries()].sort(([a], [b]) => a - b).map(([z, f]) => ({
        z, tiles: f.tiles, withoutGround: f.withoutGround,
        bbox: { x: [f.minX, f.maxX], y: [f.minY, f.maxY] }, sectors: sectorsPerFloor.get(z) ?? 0,
      }));
      const tiles = floorList.reduce((sum, f) => sum + f.tiles, 0);

      let packReport: CensusReport['appearances']['pack'] = null;
      if (pack !== undefined) {
        const missingIds = [...appearanceTiles.entries()]
          .filter(([id]) => !pack.has(id))
          .map(([id, count]) => ({ id, tiles: count }))
          .sort((a, b) => b.tiles - a.tiles || a.id - b.id);
        packReport = {
          version: pack.version,
          missing: missingIds.length,
          missingIds,
          tilesAffected: missingIds.reduce((sum, m) => sum + m.tiles, 0),
        };
      }

      return {
        header, tiles, tileRecords, duplicates, floors: floorList,
        appearances: { distinct: appearanceTiles.size, pack: packReport },
        zones: { ...zones, houses: houses.size },
        items: {
          teleports: teleports.length,
          scriptedTeleports: teleports.filter((t) => isScripted(t.to)).length,
          teleportsToNowhere: teleports.filter((t) => !isScripted(t.to) && !exists(t.to)),
          ...items,
        },
        towns: [...towns].sort((a, b) => a.id - b.id),
        waypoints: [...waypoints].sort((a, b) => a.name.localeCompare(b.name)),
        size: {
          sectorSize: SECTOR_SIZE,
          sectors: sectors.size,
          jsonBytes,
          binaryBytes: binaryBytes + sectors.size * 2,
          binaryGzipBytes,
        },
      };
    },
  };
}

const isScripted = (p: OtbmPosition): boolean => p.x === 0 && p.y === 0 && p.z === 0;

const MB = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** O resumo legível do relatório, para o stdout. */
export function formatSummary(report: CensusReport): string {
  const lines: string[] = [];
  const { header } = report;
  lines.push(`OTBM v${header.version}, ${header.width}×${header.height}, items ${header.itemsMajorVersion}.${header.itemsMinorVersion}`);
  lines.push(`tiles: ${report.tiles} (registros ${report.tileRecords}, repetidos ${report.duplicates})`);
  for (const f of report.floors) {
    lines.push(`  z${f.z}: ${f.tiles} tiles, ${f.withoutGround} sem chão, ${f.sectors} setores, x ${f.bbox.x[0]}..${f.bbox.x[1]}, y ${f.bbox.y[0]}..${f.bbox.y[1]}`);
  }
  lines.push(`aparências distintas: ${report.appearances.distinct}`);
  const { pack } = report.appearances;
  if (pack === null) lines.push('  pacote de arte ausente — cobertura não medida');
  else {
    lines.push(`  fora do pacote ${pack.version}: ${pack.missing} ids, em ${pack.tilesAffected} tiles`);
    for (const m of pack.missingIds.slice(0, 15)) lines.push(`    ${m.id}: ${m.tiles} tiles`);
  }
  const z = report.zones;
  lines.push(`zonas: PZ ${z.protectionZone}, no-pvp ${z.noPvp}, no-logout ${z.noLogout}, pvp ${z.pvpZone}; casas ${z.houses} em ${z.houseTiles} tiles`);
  const it = report.items;
  lines.push(`itens: teleportes ${it.teleports} (${it.scriptedTeleports} por script, ${it.teleportsToNowhere.length} para tile inexistente), portas de casa ${it.houseDoors}, action id ${it.withActionId}, unique id ${it.withUniqueId}`);
  lines.push(`cidades: ${report.towns.length} — ${report.towns.map((t) => t.name).join(', ')}`);
  lines.push(`waypoints: ${report.waypoints.length}`);
  const s = report.size;
  lines.push(`setores ${s.sectorSize}×${s.sectorSize}: ${s.sectors}; JSON ${MB(s.jsonBytes)}, binário ${MB(s.binaryBytes)}, binário gzip ${MB(s.binaryGzipBytes)}`);
  return lines.join('\n');
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: { otbm: { type: 'string' }, things: { type: 'string' }, version: { type: 'string' } },
    strict: true,
  });
  const thingsDir = resolve(ROOT, values.things ?? process.env.THINGS_DIR ?? 'things');
  const version = values.version ?? process.env.THINGS_VERSION ?? '1332';
  const otbmPath = resolve(thingsDir, 'maps', values.otbm ?? 'otservbr.otbm');
  if (!existsSync(otbmPath)) {
    console.error(`${otbmPath} não existe — rode pnpm map:fetch`);
    process.exit(1);
  }

  let peakRss = 0;
  const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 250);
  const started = performance.now();
  const bytes = new Uint8Array(readFileSync(otbmPath));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const header = readOtbmHeader(bytes);
  const census = createCensus();
  for (const tile of readOtbmTiles(bytes, { x: [0, 65535], y: [0, 65535], z: [0, 15] })) census.add(tile);
  const { towns, waypoints } = readOtbmTownsAndWaypoints(bytes);

  let pack: { version: string; has: (id: number) => boolean } | undefined;
  if (existsSync(join(thingsDir, version, 'catalog-content.json'))) {
    const { catalogue } = loadPack(thingsDir, version);
    pack = { version, has: (id) => catalogue.object.has(id) };
  } else {
    console.warn(`pacote ${version} não está em ${thingsDir} — a cobertura de aparências fica de fora`);
  }
  const report = census.finish({ header, towns, waypoints, ...(pack === undefined ? {} : { pack }) });
  clearInterval(sample);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);

  const out = join(dirname(otbmPath), 'census.json');
  writeFileSync(out, `${JSON.stringify({ source: { file: otbmPath.split('/').pop(), sha256 }, ...report }, null, 2)}\n`);
  console.log(formatSummary(report));
  console.log(`em ${Math.round((performance.now() - started) / 1000)} s, memória de pico ${MB(peakRss)}`);
  console.log(`escrito: ${out}`);
}
