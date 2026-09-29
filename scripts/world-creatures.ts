// As criaturas do mundo (#665, fase 5 do `docs/world-map-plan.md`): cada NPC e cada ponto de spawn
// de monstro do Canary, com o outfit de quem nasce ali, em `things/<versão>/world/creatures/`
// — para o explorador desenhá-los parados no lugar. Só dado (ADR 0019/0038):
//
//   - onde: `data-otservbr-global/world/otservbr-{npc,monster}.xml` (centro + deslocamento,
//     `spawntime`, raio do bloco);
//   - quem: o `outfit` de `data-otservbr-global/{npc,monster}/**/*.lua` (`lookType` e as quatro
//     cores e os addons), casado pelo NOME, sem diferenciar maiúsculas. `lookTypeEx` (criatura
//     desenhada como item) fica com `lookType` 0 — o explorador desenha o retângulo de reserva.
//
//   pnpm map:creatures
//   pnpm map:creatures --check
//
// Saída: `creatures/types.json` (um tipo por nome) e um arquivo por bloco de 256×256 tiles e andar,
// `creatures/<z>/<bx>-<by>.json` com `[x, y, tipo, spawntime]`, mais `creatures/index.json`.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CREATURE_BLOCK, creatureBlockPath } from '../packages/client/src/world/world-creatures.js';
import type { CreatureIndex, CreatureType } from '../packages/client/src/world/world-creatures.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Nome e outfit de um `.lua` de NPC ou monstro; `null` quando o arquivo não declara criatura. */
export function parseCreatureLua(lua: string, kind: 'npc' | 'monster'): Omit<CreatureType, 'kind'> | null {
  const name = kind === 'npc'
    ? /internalNpcName\s*=\s*"([^"]+)"/.exec(lua)?.[1] ?? /createNpcType\(\s*"([^"]+)"/.exec(lua)?.[1]
    : /createMonsterType\(\s*"([^"]+)"/.exec(lua)?.[1];
  if (name === undefined) return null;
  const block = /outfit\s*=\s*\{([^}]*)\}/.exec(lua)?.[1] ?? '';
  const field = (key: string): number => Number(new RegExp(`\\b${key}\\s*=\\s*(\\d+)`).exec(block)?.[1] ?? 0);
  return {
    name, lookType: field('lookType'), head: field('lookHead'), body: field('lookBody'),
    legs: field('lookLegs'), feet: field('lookFeet'), addons: field('lookAddons'),
  };
}

/** Os pontos de um XML de spawn: `[x, y, z, nome, spawntime]`. */
export function parseSpawnXml(xml: string, tag: 'npc' | 'monster'): Array<[number, number, number, string, number]> {
  const out: Array<[number, number, number, string, number]> = [];
  const group = new RegExp(`<${tag}\\s+centerx="(\\d+)"\\s+centery="(\\d+)"\\s+centerz="(\\d+)"[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const member = new RegExp(`<${tag}\\s+([^>]*?)/>`, 'g');
  for (const match of xml.matchAll(group)) {
    const cx = Number(match[1]); const cy = Number(match[2]); const cz = Number(match[3]);
    for (const child of (match[4] ?? '').matchAll(member)) {
      const attrs = new Map<string, string>();
      for (const attr of (child[1] ?? '').matchAll(/(\w+)="([^"]*)"/g)) attrs.set(attr[1] as string, attr[2] as string);
      const name = attrs.get('name');
      if (name === undefined) continue;
      out.push([cx + Number(attrs.get('x') ?? 0), cy + Number(attrs.get('y') ?? 0), Number(attrs.get('z') ?? cz), name, Number(attrs.get('spawntime') ?? 0)]);
    }
  }
  return out;
}

function* luaFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* luaFiles(path);
    else if (entry.endsWith('.lua')) yield path;
  }
}

export interface CreatureBuild {
  readonly types: CreatureType[];
  readonly blocks: Map<string, Array<[number, number, number, number]>>;
  readonly index: CreatureIndex;
  /** Nomes de spawn sem `.lua` correspondente — desenhados sem outfit. */
  readonly unknown: string[];
}

export function buildCreatures(
  definitions: Iterable<CreatureType>,
  spawns: Iterable<readonly [number, number, number, string, number, 'npc' | 'monster']>,
): CreatureBuild {
  const byName = new Map<string, CreatureType>();
  for (const type of definitions) {
    const key = `${type.kind}:${type.name.toLowerCase()}`;
    if (!byName.has(key)) byName.set(key, type);
  }
  const types: CreatureType[] = [];
  const typeIndex = new Map<string, number>();
  const unknown = new Set<string>();
  const blocks = new Map<string, Array<[number, number, number, number]>>();
  for (const [x, y, z, name, spawntime, kind] of spawns) {
    const key = `${kind}:${name.toLowerCase()}`;
    let index = typeIndex.get(key);
    if (index === undefined) {
      // "Buddel (Helheim)" e "A Dead Bureaucrat (2)" são o mesmo NPC em outro lugar: sem `.lua`
      // com o nome inteiro, vale o do nome sem o sufixo entre parênteses.
      const known = byName.get(key) ?? byName.get(`${kind}:${name.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase()}`);
      if (known === undefined) unknown.add(`${kind} ${name}`);
      index = types.length;
      types.push(known ?? { name, kind, lookType: 0, head: 0, body: 0, legs: 0, feet: 0, addons: 0 });
      typeIndex.set(key, index);
    }
    const path = creatureBlockPath(z, Math.floor(x / CREATURE_BLOCK), Math.floor(y / CREATURE_BLOCK));
    let list = blocks.get(path);
    if (list === undefined) { list = []; blocks.set(path, list); }
    list.push([x, y, index, spawntime]);
  }
  for (const list of blocks.values()) list.sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
  const floors = new Map<number, Array<[number, number]>>();
  for (const path of [...blocks.keys()].sort()) {
    const match = /^(\d+)\/(\d+)-(\d+)\.json$/.exec(path);
    if (match === null) continue;
    const z = Number(match[1]);
    let list = floors.get(z);
    if (list === undefined) { list = []; floors.set(z, list); }
    list.push([Number(match[2]), Number(match[3])]);
  }
  return {
    types, blocks, unknown: [...unknown].sort(),
    index: {
      format: 'draconya-creatures/1', block: CREATURE_BLOCK,
      floors: [...floors.entries()].sort(([a], [b]) => a - b).map(([z, list]) => ({ z, blocks: list.sort((a, b) => a[1] - b[1] || a[0] - b[0]) })),
    },
  };
}

const rows = (list: readonly unknown[]): string => list.map((row) => `  ${JSON.stringify(row)}`).join(',\n');

export function formatCreatureFiles(build: CreatureBuild): Map<string, string> {
  const files = new Map<string, string>();
  files.set('types.json', `[\n${rows(build.types)}\n]\n`);
  files.set('index.json', `${JSON.stringify(build.index)}\n`);
  for (const [path, list] of build.blocks) files.set(path, `[\n${rows(list)}\n]\n`);
  return files;
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
  const pack = join(canaryDir, 'data-otservbr-global');
  const outDir = join(thingsDir, version, 'world', 'creatures');
  const skip = (message: string): void => {
    if (values.check) { console.log(`creatures: ${message} — pulado`); process.exit(0); }
    console.error(message);
    process.exit(1);
  };
  if (!existsSync(join(pack, 'world', 'otservbr-monster.xml'))) skip(`Canary não encontrado em ${canaryDir} (CANARY_DIR)`);
  if (values.check && !existsSync(join(outDir, 'index.json'))) skip(`${outDir} não foi gerado nesta máquina`);

  const definitions: CreatureType[] = [];
  for (const kind of ['npc', 'monster'] as const) {
    for (const path of luaFiles(join(pack, kind))) {
      const parsed = parseCreatureLua(readFileSync(path, 'utf8'), kind);
      if (parsed !== null) definitions.push({ ...parsed, kind });
    }
  }
  const spawns: Array<readonly [number, number, number, string, number, 'npc' | 'monster']> = [];
  for (const kind of ['npc', 'monster'] as const) {
    for (const [x, y, z, name, spawntime] of parseSpawnXml(readFileSync(join(pack, 'world', `otservbr-${kind}.xml`), 'utf8'), kind)) {
      spawns.push([x, y, z, name, spawntime, kind]);
    }
  }
  const build = buildCreatures(definitions, spawns);
  const files = formatCreatureFiles(build);

  if (values.check) {
    const stale = [...files].filter(([path, text]) => !existsSync(join(outDir, path)) || readFileSync(join(outDir, path), 'utf8') !== text);
    if (stale.length === 0) { console.log(`creatures: ${spawns.length} criaturas em ${build.blocks.size} blocos conferem`); process.exit(0); }
    console.error(`creatures: DESATUALIZADO — ${stale.length} arquivos; rode pnpm map:creatures`);
    process.exit(1);
  }
  for (const [path, text] of files) {
    mkdirSync(dirname(join(outDir, path)), { recursive: true });
    writeFileSync(join(outDir, path), text);
  }
  const npcs = spawns.filter((s) => s[5] === 'npc').length;
  console.log(`criaturas escritas: ${npcs} NPCs e ${spawns.length - npcs} spawns de monstro, ${build.types.length} tipos, ${build.blocks.size} blocos`);
  console.log(`  sem .lua (desenhados sem outfit): ${build.unknown.length}${build.unknown.length > 0 ? ` — ${build.unknown.slice(0, 10).join(', ')}` : ''}`);
  console.log(`  escrito: ${outDir}`);
}
