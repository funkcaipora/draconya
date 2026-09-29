// O mundo inteiro em setores (#660, fase 1 do `docs/world-map-plan.md`): lê o `otservbr.otbm`
// todo e escreve cada setor de 32×32 tiles de cada andar em
// `things/<versão>/world/<z>/<sx>-<sy>.bin`, mais o índice `world/index.json`. É o que o
// explorador (#661) busca sob demanda — um arquivo por setor, nunca o mundo de uma vez.
//
//   pnpm map:world              # escreve things/<versão>/world/
//   pnpm map:world --check      # regenera em memória e compara byte a byte com o disco
//
// Nada disto é versionado: é dado derivado do mapa da CipSoft, na classe do ADR 0008/0025, e
// mora no volume `things` ao lado das folhas. Não precisa do pacote de arte — o setor guarda ids,
// e bloqueio e flags de aparência são do cliente, que tem o pacote.
//
// O arquivo tem 18 milhões de tiles e não cabem como objeto. Os tiles chegam agrupados por tile
// area, mas o arquivo real tem 1,2 milhão deles, pequenos, e o mesmo setor aparece em vários —
// codificar a cada troca de bloco recodificava cada setor dezenas de vezes (90 s). Os setores em
// montagem ficam numa janela LRU; só o que sai dela é codificado. Se um setor já codificado
// reaparece depois, ele é decodificado, fundido — o último vence, contado, como no ADR 0025 d.9
// — e codificado de novo: o resultado não depende do tamanho da janela, só o tempo.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  decodeSector, encodeSector, SECTOR_SIZE, sectorPath,
} from '../packages/client/src/world/sector.js';
import type { SectorTile, WorldIndex } from '../packages/client/src/world/sector.js';
import { readOtbmTiles } from './otbm.js';
import type { OtbmTile } from './otbm.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface WorldBuild {
  /** Bytes de cada setor, pela chave `sectorPath` (`<z>/<sx>-<sy>.bin`). */
  readonly sectors: Map<string, Uint8Array>;
  readonly index: WorldIndex;
  readonly tiles: number;
  readonly duplicates: number;
}

/** Quantos setores ficam em montagem antes de os mais antigos serem codificados. */
const OPEN_SECTORS = 4096;

const keyOf = (z: number, sx: number, sy: number): string => sectorPath(z, sx, sy);

/** O tile do OTBM como o setor o guarda: coordenada local, `0` para sem chão, flags num byte. */
function toSectorTile(tile: OtbmTile): SectorTile {
  const out: { -readonly [K in keyof SectorTile]: SectorTile[K] } = {
    x: tile.x % SECTOR_SIZE,
    y: tile.y % SECTOR_SIZE,
    ground: tile.ground ?? 0,
    items: tile.items.map((item) => (item.count !== undefined && item.count > 1 ? { id: item.id, count: item.count } : { id: item.id })),
    flags: tile.flags & 0xff,
  };
  if (tile.houseId !== undefined) out.houseId = tile.houseId;
  return out;
}

export function buildWorld(
  tiles: Iterable<OtbmTile>,
  meta: { readonly version: string; readonly source: WorldIndex['source'] },
): WorldBuild {
  const sectors = new Map<string, Uint8Array>();
  /** Os setores do tile area de agora, célula → tile. */
  type Pending = { z: number; sx: number; sy: number; cells: Map<number, SectorTile> };
  /** Em ordem de último toque: o primeiro é o que está parado há mais tempo. */
  const open = new Map<string, Pending>();
  let count = 0;
  let duplicates = 0;

  const flush = (limit: number): void => {
    for (const [key, pending] of open) {
      if (open.size <= limit) break;
      open.delete(key);
      const before = sectors.get(key);
      if (before !== undefined) {
        // O bloco reapareceu: o que já estava fica, e o que chegou agora vence na mesma célula.
        for (const tile of decodeSector(before).tiles) {
          const cell = tile.y * SECTOR_SIZE + tile.x;
          if (pending.cells.has(cell)) duplicates += 1;
          else pending.cells.set(cell, tile);
        }
      }
      sectors.set(key, encodeSector({ sx: pending.sx, sy: pending.sy, z: pending.z, tiles: [...pending.cells.values()] }));
    }
  };

  for (const tile of tiles) {
    const sx = Math.floor(tile.x / SECTOR_SIZE);
    const sy = Math.floor(tile.y / SECTOR_SIZE);
    const key = keyOf(tile.z, sx, sy);
    let pending = open.get(key);
    if (pending === undefined) {
      pending = { z: tile.z, sx, sy, cells: new Map() };
      open.set(key, pending);
      if (open.size > OPEN_SECTORS) flush(OPEN_SECTORS / 2);
    } else if (count % 64 === 0) {
      // Reinserir move para o fim (mais recente). A cada 64 tiles basta: o setor que recebe
      // tile continua quente, e mexer no Map a cada tile custaria o que a janela economiza.
      open.delete(key);
      open.set(key, pending);
    }
    const local = toSectorTile(tile);
    const cell = local.y * SECTOR_SIZE + local.x;
    if (pending.cells.has(cell)) duplicates += 1;
    pending.cells.set(cell, local);
    count += 1;
  }
  flush(0);

  const perFloor = new Map<number, Array<[number, number]>>();
  for (const key of sectors.keys()) {
    const match = /^(\d+)\/(\d+)-(\d+)\.bin$/.exec(key);
    if (match === null) continue;
    const z = Number(match[1]);
    let list = perFloor.get(z);
    if (list === undefined) { list = []; perFloor.set(z, list); }
    list.push([Number(match[2]), Number(match[3])]);
  }
  const floors = [...perFloor.entries()].sort(([a], [b]) => a - b).map(([z, list]) => {
    list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const xs = list.map(([sx]) => sx);
    const ys = list.map(([, sy]) => sy);
    return {
      z,
      bbox: {
        x: [Math.min(...xs) * SECTOR_SIZE, (Math.max(...xs) + 1) * SECTOR_SIZE - 1] as const,
        y: [Math.min(...ys) * SECTOR_SIZE, (Math.max(...ys) + 1) * SECTOR_SIZE - 1] as const,
      },
      sectors: list,
    };
  });

  return {
    sectors,
    index: { format: 'draconya-world/1', version: meta.version, source: meta.source, sectorSize: SECTOR_SIZE, floors },
    tiles: count - duplicates,
    duplicates,
  };
}

/** O índice como vai para o disco: um andar por bloco, os setores numa linha só. */
export function formatWorldIndex(index: WorldIndex): string {
  const floors = index.floors.map((floor) => `    ${JSON.stringify(floor)}`);
  const head = JSON.stringify({ format: index.format, version: index.version, source: index.source, sectorSize: index.sectorSize });
  return `${head.slice(0, -1)},"floors":[\n${floors.join(',\n')}\n]}\n`;
}

export interface WorldCheck {
  readonly missing: string[];
  readonly stale: string[];
  readonly extra: string[];
  readonly indexStale: boolean;
}

/** `--check`: o que está em `worldDir` confere com o que o OTBM gera agora? */
export function checkWorld(build: WorldBuild, worldDir: string): WorldCheck {
  const missing: string[] = [];
  const stale: string[] = [];
  for (const [key, bytes] of build.sectors) {
    const path = join(worldDir, key);
    if (!existsSync(path)) { missing.push(key); continue; }
    if (!Buffer.from(readFileSync(path)).equals(Buffer.from(bytes))) stale.push(key);
  }
  const extra: string[] = [];
  for (const entry of existsSync(worldDir) ? readdirSync(worldDir, { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    for (const file of readdirSync(join(worldDir, entry.name))) {
      const key = `${entry.name}/${file}`;
      if (!build.sectors.has(key)) extra.push(key);
    }
  }
  const indexPath = join(worldDir, 'index.json');
  const indexStale = !existsSync(indexPath) || readFileSync(indexPath, 'utf8') !== formatWorldIndex(build.index);
  return { missing, stale, extra, indexStale };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: { otbm: { type: 'string' }, things: { type: 'string' }, version: { type: 'string' }, check: { type: 'boolean' } },
    strict: true,
  });
  const thingsDir = resolve(ROOT, values.things ?? process.env.THINGS_DIR ?? 'things');
  const version = values.version ?? process.env.THINGS_VERSION ?? '1332';
  const otbmFile = values.otbm ?? 'otservbr.otbm';
  const otbmPath = resolve(thingsDir, 'maps', otbmFile);
  const worldDir = join(thingsDir, version, 'world');

  if (!existsSync(otbmPath)) {
    const message = `${otbmPath} não existe — rode pnpm map:fetch`;
    if (values.check) { console.log(`world: ${message}; pulado`); process.exit(0); }
    console.error(message);
    process.exit(1);
  }
  if (values.check && !existsSync(join(worldDir, 'index.json'))) {
    console.log(`world: ${worldDir} não foi gerado nesta máquina — pulado (rode pnpm map:world)`);
    process.exit(0);
  }

  const started = performance.now();
  const bytes = new Uint8Array(readFileSync(otbmPath));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const build = buildWorld(readOtbmTiles(bytes, { x: [0, 65535], y: [0, 65535], z: [0, 15] }), {
    version, source: { file: otbmFile, sha256 },
  });
  const seconds = Math.round((performance.now() - started) / 1000);
  let total = 0;
  for (const sector of build.sectors.values()) total += sector.length;

  if (values.check) {
    const outcome = checkWorld(build, worldDir);
    const problems = outcome.missing.length + outcome.stale.length + outcome.extra.length + (outcome.indexStale ? 1 : 0);
    if (problems === 0) {
      console.log(`world: ${build.sectors.size} setores conferem com o OTBM (${seconds} s)`);
      process.exit(0);
    }
    console.error(`world: DESATUALIZADO — ${outcome.missing.length} faltando, ${outcome.stale.length} diferentes, ${outcome.extra.length} sobrando${outcome.indexStale ? ', índice diferente' : ''}; rode pnpm map:world`);
    for (const key of [...outcome.missing, ...outcome.stale, ...outcome.extra].slice(0, 10)) console.error(`  ${key}`);
    process.exit(1);
  }

  for (const [key, sector] of build.sectors) {
    const path = join(worldDir, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, sector);
  }
  // Setor que existia e não existe mais (OTBM trocado) ficaria órfão no disco: o `--check` o
  // reporta como sobrando, e quem regera limpa a pasta.
  writeFileSync(join(worldDir, 'index.json'), formatWorldIndex(build.index));
  console.log(`mundo escrito em ${seconds} s: ${build.tiles} tiles (${build.duplicates} repetidos), ${build.sectors.size} setores, ${(total / 1024 / 1024).toFixed(1)} MB`);
  for (const floor of build.index.floors) console.log(`  z${floor.z}: ${floor.sectors.length} setores`);
  console.log(`  escrito: ${worldDir}`);
}
