// As fontes de luz do mundo (#666, fase 5 do `docs/world-map-plan.md`): cada tile cuja pilha tem
// um objeto que ilumina (`AppearanceFlags.lightIntensity`/`lightColor`, campo 23 do
// `appearances.dat`), com o brilho e a cor do objeto mais forte, em blocos de 256 tiles por andar
// — `things/<versão>/world/lights/<z>/<bx>-<by>.json` com `[x, y, brilho, cor]`, mais um índice.
// O explorador desenha a escuridão do andar e abre a luz em volta de cada fonte.
//
//   pnpm map:lights             # depois de pnpm map:world
//   pnpm map:lights --check
//
// O `appearances.dat` é o do pacote, senão o do Canary (`CANARY_DIR`) — só a flag de luz.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readAppearances } from '../packages/client/src/assets/appearances.js';
import { decodeSector, isWorldIndex, SECTOR_SIZE, sectorPath } from '../packages/client/src/world/sector.js';
import type { SectorTile, WorldIndex } from '../packages/client/src/world/sector.js';
import { LIGHT_BLOCK, lightBlockPath } from '../packages/client/src/world/world-lights.js';
import type { LightIndex } from '../packages/client/src/world/world-lights.js';
import { findAppearances } from './world-minimap.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A luz de um tile: a do objeto mais forte da pilha; `null` quando nada ilumina. */
export function tileLight(tile: SectorTile, lightOf: (id: number) => readonly [number, number] | undefined): readonly [number, number] | null {
  let best: readonly [number, number] | null = null;
  for (const id of [tile.ground, ...tile.items.map((item) => item.id)]) {
    if (id === 0) continue;
    const light = lightOf(id);
    if (light !== undefined && (best === null || light[0] > best[0])) best = light;
  }
  return best;
}

export function buildLights(
  index: WorldIndex,
  sector: (z: number, sx: number, sy: number) => readonly SectorTile[] | null,
  lightOf: (id: number) => readonly [number, number] | undefined,
): { files: Map<string, string>; index: LightIndex; count: number } {
  const blocks = new Map<string, Array<[number, number, number, number]>>();
  let count = 0;
  for (const floor of index.floors) {
    for (const [sx, sy] of floor.sectors) {
      for (const tile of sector(floor.z, sx, sy) ?? []) {
        const light = tileLight(tile, lightOf);
        if (light === null) continue;
        const x = sx * SECTOR_SIZE + tile.x;
        const y = sy * SECTOR_SIZE + tile.y;
        const path = lightBlockPath(floor.z, Math.floor(x / LIGHT_BLOCK), Math.floor(y / LIGHT_BLOCK));
        let list = blocks.get(path);
        if (list === undefined) { list = []; blocks.set(path, list); }
        list.push([x, y, light[0], light[1]]);
        count += 1;
      }
    }
  }
  const files = new Map<string, string>();
  const floors = new Map<number, Array<[number, number]>>();
  for (const path of [...blocks.keys()].sort()) {
    const list = (blocks.get(path) as Array<[number, number, number, number]>).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    files.set(path, `${JSON.stringify(list)}\n`);
    const match = /^(\d+)\/(\d+)-(\d+)\.json$/.exec(path) as RegExpExecArray;
    const z = Number(match[1]);
    let floorList = floors.get(z);
    if (floorList === undefined) { floorList = []; floors.set(z, floorList); }
    floorList.push([Number(match[2]), Number(match[3])]);
  }
  const lightIndex: LightIndex = {
    format: 'draconya-lights/1', block: LIGHT_BLOCK,
    floors: [...floors.entries()].sort(([a], [b]) => a - b).map(([z, list]) => ({ z, blocks: list.sort((a, b) => a[1] - b[1] || a[0] - b[0]) })),
  };
  files.set('index.json', `${JSON.stringify(lightIndex)}\n`);
  return { files, index: lightIndex, count };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: { things: { type: 'string' }, version: { type: 'string' }, check: { type: 'boolean' } },
    strict: true,
  });
  const thingsDir = resolve(ROOT, values.things ?? process.env.THINGS_DIR ?? 'things');
  const version = values.version ?? process.env.THINGS_VERSION ?? '1332';
  const canaryDir = resolve(ROOT, process.env.CANARY_DIR ?? join('things', 'sources', 'canary'));
  const worldDir = join(thingsDir, version, 'world');
  const outDir = join(worldDir, 'lights');
  const skip = (message: string): void => {
    if (values.check) { console.log(`lights: ${message} — pulado`); process.exit(0); }
    console.error(message);
    process.exit(1);
  };
  if (!existsSync(join(worldDir, 'index.json'))) skip(`${worldDir} não foi gerado — rode pnpm map:world`);
  if (values.check && !existsSync(join(outDir, 'index.json'))) skip(`${outDir} não foi gerado nesta máquina`);
  const appearancesPath = findAppearances(thingsDir, version, canaryDir);
  if (appearancesPath === null) skip('sem appearances.dat');

  const started = performance.now();
  const index: unknown = JSON.parse(readFileSync(join(worldDir, 'index.json'), 'utf8'));
  if (!isWorldIndex(index)) skip('índice do mundo inválido');
  const catalogue = readAppearances(readFileSync(appearancesPath as string));
  const lightOf = (id: number): readonly [number, number] | undefined => {
    const flags = catalogue.object.get(id)?.flags;
    return flags?.lightIntensity === undefined ? undefined : [flags.lightIntensity, flags.lightColor ?? 215];
  };
  const build = buildLights(index as WorldIndex, (z, sx, sy) => {
    const path = join(worldDir, sectorPath(z, sx, sy));
    return existsSync(path) ? decodeSector(new Uint8Array(readFileSync(path))).tiles : null;
  }, lightOf);
  const seconds = Math.round((performance.now() - started) / 1000);
  if (values.check) {
    const stale = [...build.files].filter(([path, text]) => !existsSync(join(outDir, path)) || readFileSync(join(outDir, path), 'utf8') !== text);
    if (stale.length === 0) { console.log(`lights: ${build.count} fontes conferem (${seconds} s)`); process.exit(0); }
    console.error(`lights: DESATUALIZADO — ${stale.length} arquivos; rode pnpm map:lights`);
    process.exit(1);
  }
  for (const [path, text] of build.files) {
    mkdirSync(dirname(join(outDir, path)), { recursive: true });
    writeFileSync(join(outDir, path), text);
  }
  console.log(`luzes escritas em ${seconds} s: ${build.count} fontes em ${build.files.size - 1} blocos`);
  console.log(`  escrito: ${outDir}`);
}
