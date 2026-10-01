// Os lugares do mundo (#664, fase 4 do `docs/world-map-plan.md`): cidades com templo e waypoints
// do OTBM (#659) e as casas do `otservbr-house.xml` do Canary (nome, entrada, cidade, tamanho),
// em `things/<versão>/world/places.json`, para o "ir para" e a camada de casas do explorador.
//
//   pnpm map:places
//   pnpm map:places --check

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { WorldPlaces } from '../packages/client/src/world/world-places.js';
import { readOtbmTownsAndWaypoints } from './otbm.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `<house name=… houseid=… entryx=… … />` → casas, pela ordem do id. */
export function parseHousesXml(xml: string): WorldPlaces['houses'] {
  const houses: Array<WorldPlaces['houses'][number]> = [];
  for (const match of xml.matchAll(/<house\s([^>]*?)\/?>/g)) {
    const attrs = new Map<string, string>();
    for (const attr of (match[1] ?? '').matchAll(/(\w+)="([^"]*)"/g)) attrs.set(attr[1] as string, attr[2] as string);
    const num = (name: string): number => Number(attrs.get(name) ?? 0);
    const name = attrs.get('name');
    if (name === undefined || !attrs.has('houseid')) continue;
    houses.push({
      id: num('houseid'), name: decodeEntities(name), entry: [num('entryx'), num('entryy'), num('entryz')],
      townId: num('townid'), size: num('size'), guildhall: attrs.get('guildhall') === 'true',
    });
  }
  return houses.sort((a, b) => a.id - b.id);
}

function decodeEntities(text: string): string {
  return text.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export function formatPlaces(places: WorldPlaces): string {
  const block = (rows: readonly unknown[]): string => rows.map((row) => `  ${JSON.stringify(row)}`).join(',\n');
  return `{"format":${JSON.stringify(places.format)},\n"towns":[\n${block(places.towns)}\n],\n"waypoints":[\n${block(places.waypoints)}\n],\n"houses":[\n${block(places.houses)}\n]}\n`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: { things: { type: 'string' }, version: { type: 'string' }, otbm: { type: 'string' }, check: { type: 'boolean' } },
    strict: true,
  });
  const thingsDir = resolve(ROOT, values.things ?? process.env.THINGS_DIR ?? 'things');
  const version = values.version ?? process.env.THINGS_VERSION ?? '1533';
  const canaryDir = resolve(ROOT, process.env.CANARY_DIR ?? join('things', 'sources', 'canary'));
  const worldDir = join(thingsDir, version, 'world');
  const outPath = join(worldDir, 'places.json');
  const otbmPath = join(thingsDir, 'maps', values.otbm ?? 'otservbr.otbm');
  const housesPath = join(canaryDir, 'data-otservbr-global', 'world', 'otservbr-house.xml');
  const skip = (message: string): void => {
    if (values.check) { console.log(`places: ${message} — pulado`); process.exit(0); }
    console.error(message);
    process.exit(1);
  };
  if (!existsSync(join(worldDir, 'index.json'))) skip(`${worldDir} não foi gerado — rode pnpm map:world`);
  if (values.check && !existsSync(outPath)) skip(`${outPath} não foi gerado nesta máquina`);
  if (!existsSync(otbmPath)) skip(`${otbmPath} não existe — rode pnpm map:fetch`);
  if (!existsSync(housesPath)) skip(`${housesPath} não existe (CANARY_DIR)`);

  const { towns, waypoints } = readOtbmTownsAndWaypoints(new Uint8Array(readFileSync(otbmPath)));
  const places: WorldPlaces = {
    format: 'draconya-places/1',
    towns: towns.map((t) => ({ id: t.id, name: t.name, temple: [t.temple.x, t.temple.y, t.temple.z] as const })).sort((a, b) => a.name.localeCompare(b.name)),
    waypoints: waypoints.map((w) => ({ name: w.name, position: [w.position.x, w.position.y, w.position.z] as const })).sort((a, b) => a.name.localeCompare(b.name)),
    houses: parseHousesXml(readFileSync(housesPath, 'utf8')),
  };
  const out = formatPlaces(places);
  if (values.check) {
    if (readFileSync(outPath, 'utf8') === out) { console.log(`places: ${places.towns.length} cidades, ${places.houses.length} casas conferem`); process.exit(0); }
    console.error('places: DESATUALIZADO — rode pnpm map:places');
    process.exit(1);
  }
  writeFileSync(outPath, out);
  console.log(`lugares escritos: ${places.towns.length} cidades, ${places.waypoints.length} waypoints, ${places.houses.length} casas`);
  console.log(`  escrito: ${outPath}`);
}
