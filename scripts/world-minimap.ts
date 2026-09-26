// O minimapa do mundo (#662, fase 3 do `docs/world-map-plan.md`): lê os setores de
// `things/<versão>/world/` (#660) e pinta blocos PNG de 256×256 em seis níveis de zoom, em
// `world/minimap/<nível>/<z>/<bx>-<by>.png`, mais `world/minimap/index.json`. A cor de cada tile
// é a cor de automapa do objeto mais alto da pilha que tem uma — `tileAutomapColor`, o contrato
// que o cliente também conhece.
//
//   pnpm map:minimap            # depois de pnpm map:world
//   pnpm map:minimap --check    # regenera em memória e compara com o disco
//
// A cor vem do `appearances.dat`: o do pacote de arte em `things/<versão>/` quando ele está na
// máquina, senão o do Canary (`$CANARY_DIR/data/items/appearances.dat`, ADR 0038) — o mesmo
// arquivo sem as folhas. Só a flag de automapa é lida; nenhum sprite.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readAppearances } from '../packages/client/src/assets/appearances.js';
import { readCatalog } from '../packages/client/src/assets/catalog.js';
import {
  MINIMAP_BLOCK, MINIMAP_LEVELS, minimapPath, tibiaRgb, tileAutomapColor, tilesPerBlock,
} from '../packages/client/src/world/minimap.js';
import type { MinimapIndex } from '../packages/client/src/world/minimap.js';
import { decodeSector, isWorldIndex, SECTOR_SIZE, sectorPath } from '../packages/client/src/world/sector.js';
import type { Sector, WorldIndex } from '../packages/client/src/world/sector.js';
import { encodePng } from './png.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Um bloco em montagem: um byte de cor (0–215, 0 = vazio) por pixel. */
type Block = Uint8Array;

const blockKey = (z: number, bx: number, by: number): string => `${z}/${bx}-${by}`;

export interface MinimapBuild {
  /** Bytes PNG de cada bloco, pela chave `minimapPath`. */
  readonly files: Map<string, Buffer>;
  readonly index: MinimapIndex;
}

/**
 * Os blocos de todos os níveis a partir dos setores. `sectors` entrega cada setor do índice;
 * `colorOf` é a cor de automapa por id de aparência.
 */
export function buildMinimap(
  index: WorldIndex,
  sectors: (z: number, sx: number, sy: number) => Sector | null,
  colorOf: (id: number) => number | undefined,
): MinimapBuild {
  let level = new Map<string, { z: number; bx: number; by: number; pixels: Block }>();
  for (const floor of index.floors) {
    for (const [sx, sy] of floor.sectors) {
      const sector = sectors(floor.z, sx, sy);
      if (sector === null) continue;
      const x0 = sx * SECTOR_SIZE;
      const y0 = sy * SECTOR_SIZE;
      const bx = Math.floor(x0 / MINIMAP_BLOCK);
      const by = Math.floor(y0 / MINIMAP_BLOCK);
      const key = blockKey(floor.z, bx, by);
      let block = level.get(key);
      if (block === undefined) {
        block = { z: floor.z, bx, by, pixels: new Uint8Array(MINIMAP_BLOCK * MINIMAP_BLOCK) };
        level.set(key, block);
      }
      for (const tile of sector.tiles) {
        const color = tileAutomapColor(tile.ground, tile.items, colorOf);
        if (color === 0) continue;
        const px = (x0 + tile.x) - bx * MINIMAP_BLOCK;
        const py = (y0 + tile.y) - by * MINIMAP_BLOCK;
        block.pixels[py * MINIMAP_BLOCK + px] = color;
      }
    }
  }

  const files = new Map<string, Buffer>();
  const levels: Array<Array<{ z: number; blocks: Array<[number, number]> }>> = [];
  for (let l = 0; l < MINIMAP_LEVELS; l += 1) {
    const perFloor = new Map<number, Array<[number, number]>>();
    for (const block of level.values()) {
      if (!block.pixels.some((c) => c !== 0)) continue;
      files.set(minimapPath(l, block.z, block.bx, block.by), toPng(block.pixels));
      let list = perFloor.get(block.z);
      if (list === undefined) { list = []; perFloor.set(block.z, list); }
      list.push([block.bx, block.by]);
    }
    levels.push([...perFloor.entries()].sort(([a], [b]) => a - b).map(([z, blocks]) => ({
      z, blocks: blocks.sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    })));
    if (l + 1 < MINIMAP_LEVELS) level = shrink(level);
  }
  return { files, index: { format: 'draconya-minimap/1', block: MINIMAP_BLOCK, levels } };
}

/**
 * O nível de cima: cada bloco vira um quadrante do bloco-pai, com 2×2 pixels virando um — o
 * primeiro com cor, na ordem de leitura. Mantém a linha fina de uma parede visível ao afastar,
 * onde uma média a apagaria.
 */
function shrink(level: Map<string, { z: number; bx: number; by: number; pixels: Block }>) {
  const next = new Map<string, { z: number; bx: number; by: number; pixels: Block }>();
  const half = MINIMAP_BLOCK / 2;
  for (const block of level.values()) {
    const bx = Math.floor(block.bx / 2);
    const by = Math.floor(block.by / 2);
    const key = blockKey(block.z, bx, by);
    let parent = next.get(key);
    if (parent === undefined) {
      parent = { z: block.z, bx, by, pixels: new Uint8Array(MINIMAP_BLOCK * MINIMAP_BLOCK) };
      next.set(key, parent);
    }
    const ox = (block.bx - bx * 2) * half;
    const oy = (block.by - by * 2) * half;
    for (let y = 0; y < half; y += 1) {
      for (let x = 0; x < half; x += 1) {
        const i = y * 2 * MINIMAP_BLOCK + x * 2;
        const p = block.pixels;
        const color = (p[i] as number) || (p[i + 1] as number) || (p[i + MINIMAP_BLOCK] as number) || (p[i + MINIMAP_BLOCK + 1] as number);
        if (color !== 0) parent.pixels[(oy + y) * MINIMAP_BLOCK + ox + x] = color;
      }
    }
  }
  return next;
}

function toPng(pixels: Block): Buffer {
  const rgba = new Uint8Array(pixels.length * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const color = pixels[i] as number;
    if (color === 0) continue;
    const [r, g, b] = tibiaRgb(color);
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return encodePng(MINIMAP_BLOCK, MINIMAP_BLOCK, rgba);
}

export function formatMinimapIndex(index: MinimapIndex): string {
  const levels = index.levels.map((floors) => `  ${JSON.stringify(floors)}`);
  return `{"format":${JSON.stringify(index.format)},"block":${index.block},"levels":[\n${levels.join(',\n')}\n]}\n`;
}

/** O `appearances.dat` de onde sai a cor: o do pacote, senão o do Canary. `null` quando nenhum. */
export function findAppearances(thingsDir: string, version: string, canaryDir: string): string | null {
  const catalogPath = join(thingsDir, version, 'catalog-content.json');
  if (existsSync(catalogPath)) {
    const catalog = readCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown);
    return join(thingsDir, version, catalog.appearancesFile);
  }
  const canary = join(canaryDir, 'data', 'items', 'appearances.dat');
  return existsSync(canary) ? canary : null;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: { things: { type: 'string' }, version: { type: 'string' }, appearances: { type: 'string' }, check: { type: 'boolean' } },
    strict: true,
  });
  const thingsDir = resolve(ROOT, values.things ?? process.env.THINGS_DIR ?? 'things');
  const version = values.version ?? process.env.THINGS_VERSION ?? '1533';
  const canaryDir = resolve(ROOT, process.env.CANARY_DIR ?? join('things', 'sources', 'canary'));
  const worldDir = join(thingsDir, version, 'world');
  const minimapDir = join(worldDir, 'minimap');
  const skip = (message: string): never => {
    if (values.check) { console.log(`minimap: ${message} — pulado`); process.exit(0); }
    console.error(message);
    process.exit(1);
  };

  const indexPath = join(worldDir, 'index.json');
  if (!existsSync(indexPath)) skip(`${indexPath} não existe — rode pnpm map:world`);
  if (values.check && !existsSync(join(minimapDir, 'index.json'))) skip(`${minimapDir} não foi gerado nesta máquina`);
  const appearancesPath = values.appearances ?? findAppearances(thingsDir, version, canaryDir);
  if (appearancesPath === null) skip(`sem appearances.dat: nem things/${version}/ nem $CANARY_DIR/data/items/`);

  const started = performance.now();
  const index: unknown = JSON.parse(readFileSync(indexPath, 'utf8'));
  if (!isWorldIndex(index)) skip(`${indexPath} não é um índice do mundo`);
  const catalogue = readAppearances(readFileSync(appearancesPath as string));
  const colorOf = (id: number): number | undefined => catalogue.object.get(id)?.flags?.automapColor;
  const build = buildMinimap(index as WorldIndex, (z, sx, sy) => {
    const path = join(worldDir, sectorPath(z, sx, sy));
    return existsSync(path) ? decodeSector(new Uint8Array(readFileSync(path))) : null;
  }, colorOf);
  const seconds = Math.round((performance.now() - started) / 1000);

  if (values.check) {
    const stale: string[] = [];
    for (const [key, png] of build.files) {
      const path = join(minimapDir, key);
      if (!existsSync(path) || !Buffer.from(readFileSync(path)).equals(png)) stale.push(key);
    }
    const onDisk = new Set<string>();
    for (const l of existsSync(minimapDir) ? readdirSync(minimapDir).filter((name) => /^\d+$/.test(name)) : []) {
      for (const z of readdirSync(join(minimapDir, l))) for (const file of readdirSync(join(minimapDir, l, z))) onDisk.add(`${l}/${z}/${file}`);
    }
    const extra = [...onDisk].filter((key) => !build.files.has(key));
    const indexStale = readFileSync(join(minimapDir, 'index.json'), 'utf8') !== formatMinimapIndex(build.index);
    if (stale.length + extra.length === 0 && !indexStale) {
      console.log(`minimap: ${build.files.size} blocos conferem (${seconds} s)`);
      process.exit(0);
    }
    console.error(`minimap: DESATUALIZADO — ${stale.length} diferentes ou faltando, ${extra.length} sobrando${indexStale ? ', índice diferente' : ''}; rode pnpm map:minimap`);
    process.exit(1);
  }

  let bytes = 0;
  for (const [key, png] of build.files) {
    const path = join(minimapDir, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    bytes += png.length;
  }
  writeFileSync(join(minimapDir, 'index.json'), formatMinimapIndex(build.index));
  console.log(`minimapa escrito em ${seconds} s a partir de ${appearancesPath}`);
  build.index.levels.forEach((floors, l) => {
    const count = floors.reduce((sum, floor) => sum + floor.blocks.length, 0);
    console.log(`  nível ${l} (${tilesPerBlock(l)} tiles/bloco): ${count} blocos`);
  });
  console.log(`  ${build.files.size} arquivos, ${(bytes / 1024 / 1024).toFixed(1)} MB em ${minimapDir}`);
}
