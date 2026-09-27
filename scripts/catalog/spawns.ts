// scripts/catalog/spawns.ts — importador de spawns do Canary por recorte de mapa (#582): lê
// `data-otservbr-global/world/otservbr-monster.xml`, filtra pelos pontos que caem dentro da
// REGIÃO e da FAIXA DE ANDARES do mapa já importado (a mesma `source.region` que `pnpm
// map:import` gravou), resolve o nome do monstro do Canary para o `monsterId` do catálogo local,
// e REGENERA os `spawnPoints` da rota já traçada — os tiles do laço não mudam, só os pontos de
// spawn. Mora ao lado dos outros leitores do Canary (`import.ts`, `monsters.ts`) — ADR 0038
// decisão 1 — e reusa `xml.ts` (o leitor XML genérico) e `env.ts` (`CANARY_DIR`).
//
//   CANARY_DIR=/caminho/para/canary pnpm catalog:spawns --map darashia-dragon-lair
//   pnpm catalog:spawns --map darashia-dragon-lair --check
//
// Sem o Canary nesta máquina, `--check` AVISA e PULA (exit 0) — o mesmo comportamento que
// `pnpm catalog:import --check` e `pnpm map:import --check` já têm (ADR 0038 decisão 4).
//
// Um monstro que o Canary cita e o catálogo local (`packages/content/data/monsters/**`) ainda
// não tem (#580 — a promoção do catálogo gerado ainda não chegou a `data/`) é RELATADO, nunca
// fatal: a issue #582 é explícita — "spawn de monstro desconhecido deve ser relatado, não
// quebrar". Este script não cria hunt nova (#587): ele só regenera `spawnPoints` de uma rota que
// `pnpm route:trace` já escreveu.
//
// O formato do XML (verificado em `things/sources/canary`, GPL — só números e regras, ADR 0019):
// um `<monster centerx centery centerz radius>` por ZONA, com filhos `<monster name x y z
// spawntime weight?>`. O `z` do FILHO é escrito no arquivo mas NUNCA lido pelo motor:
// `SpawnsMonster::loadFromXML` (`src/creatures/monsters/spawns/spawn_monster.cpp:90-96`) monta a
// posição com `centerPos.z`, e o `z` do filho é sempre igual ao do centro (conferido nas 187081
// linhas do arquivo real) — um campo vestigial. `weight` (mesmo arquivo, linhas 90-96) é como
// dois `<monster>` do mesmo `<spawn>` caem exatamente na mesma posição: pontos assim viram
// `spawnPoints[i].monsters` (#582); nenhum ocorre no recorte da Darashia Dragon Lair, mas o
// mecanismo existe no Canary e o importador precisa reconhecê-lo sem quebrar.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { routeSchema, tilemapSchema } from '../../packages/content/src/schemas.js';
import { anchorSpawnPoints, formatRoute } from '../trace-route.js';
import type { SpawnRequest, TracedRoute } from '../trace-route.js';
import type { Region } from '../otbm.js';
import { repoRootFrom, resolveCanaryDir } from './env.js';
import { attr, attrNumber, attrNumberOptional, childrenOf, parseXml } from './xml.js';
import type { XmlElement } from './xml.js';

const ROOT = repoRootFrom(import.meta.url);
const MAPS_DIR = join(ROOT, 'packages', 'content', 'data', 'maps');
const ROUTES_DIR = join(ROOT, 'packages', 'content', 'data', 'routes');
const MONSTERS_DIR = join(ROOT, 'packages', 'content', 'data', 'monsters');

/** Um `<monster>` do XML, já em coordenadas ABSOLUTAS do mapa real (ver nota do cabeçalho). */
export interface CanarySpawnPoint {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly spawnTimeSec: number;
  readonly weight: number;
}

/**
 * Lê a árvore de `otservbr-monster.xml` (raiz `<monsters>`, uma zona `<monster
 * centerx centery centerz radius>` por filho direto, cada uma com seus próprios `<monster name x
 * y z spawntime weight?>`) e devolve cada ponto já em coordenada ABSOLUTA — `centerz`, nunca o
 * `z` do filho, que o motor do Canary ignora (ver nota do cabeçalho).
 */
export function extractCanarySpawns(root: XmlElement): readonly CanarySpawnPoint[] {
  const points: CanarySpawnPoint[] = [];
  for (const zone of childrenOf(root, 'monster')) {
    const centerX = attrNumber(zone, 'centerx');
    const centerY = attrNumber(zone, 'centery');
    const centerZ = attrNumber(zone, 'centerz');
    for (const child of childrenOf(zone, 'monster')) {
      points.push({
        name: attr(child, 'name'),
        x: centerX + attrNumber(child, 'x'),
        y: centerY + attrNumber(child, 'y'),
        z: centerZ,
        spawnTimeSec: attrNumber(child, 'spawntime'),
        weight: attrNumberOptional(child, 'weight') ?? 1,
      });
    }
  }
  return points;
}

const inRegion = (p: CanarySpawnPoint, region: Region): boolean =>
  p.x >= region.x[0] && p.x <= region.x[1]
  && p.y >= region.y[0] && p.y <= region.y[1]
  && p.z >= region.z[0] && p.z <= region.z[1];

// `spawn_monster.cpp:26-27,387-392`: piso e teto do `spawntime` convertido para ms.
const MIN_RESPAWN_MS = 1000;
const MAX_RESPAWN_MS = 86_400_000;

/** `spawntime` (segundos) → ms, com o mesmo piso/teto do Canary. */
export function respawnDelayMsOf(spawnTimeSec: number): number {
  const ms = spawnTimeSec * 1000;
  if (ms < MIN_RESPAWN_MS) return MIN_RESPAWN_MS;
  if (ms > MAX_RESPAWN_MS) return MAX_RESPAWN_MS;
  return ms;
}

/** Slug kebab-case do nome do Canary — a mesma convenção do catálogo gerado (ADR 0038). */
export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Lê `id` de todo `.json` de `packages/content/data/monsters/**` — hand-authored (objeto) e,
 * quando existir, o catálogo gerado (`generated/`, array por arquivo — #580). */
export function loadMonsterIds(monstersDir: string): ReadonlySet<string> {
  const ids = new Set<string>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.json')) continue;
      const parsed: unknown = JSON.parse(readFileSync(full, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item !== null && typeof item === 'object' && 'id' in item && typeof (item as { id: unknown }).id === 'string') {
          ids.add((item as { id: string }).id);
        }
      }
    }
  };
  walk(monstersDir);
  return ids;
}

export interface ImportedSpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly respawnDelayMs: number;
  readonly monsterId?: string;
  readonly monsters?: ReadonlyArray<{ readonly monsterId: string; readonly weight: number }>;
}

export interface UnknownSpawn {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SpawnImportReport {
  readonly pointsRead: number;
  readonly pointsInRegion: number;
  /** Pontos com mais de um monstro na MESMA posição — viram `monsters`, não `monsterId`. */
  readonly grouped: number;
  readonly written: readonly ImportedSpawnPoint[];
  readonly unknown: readonly UnknownSpawn[];
}

/**
 * Filtra pela região+andares, agrupa por posição exata (o caso `weight`, #582), resolve nome →
 * `monsterId` e separa quem o catálogo não conhece — RELATADO, nunca fatal (#580/#582): o
 * ponto sem monstro conhecido é descartado do resultado, não escrito com um id fantasma que
 * derrubaria o boot do `buildContent`.
 */
export function importCanarySpawns(
  points: readonly CanarySpawnPoint[], region: Region, monsterIds: ReadonlySet<string>, radius: number,
): SpawnImportReport {
  const inBox = points.filter((p) => inRegion(p, region));

  const groups = new Map<string, CanarySpawnPoint[]>();
  for (const p of inBox) {
    const key = `${p.x},${p.y},${p.z}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [p]);
    else list.push(p);
  }

  const written: ImportedSpawnPoint[] = [];
  const unknown: UnknownSpawn[] = [];
  let grouped = 0;
  for (const group of groups.values()) {
    const resolved = group
      .map((p) => ({ p, monsterId: slugify(p.name) }))
      .filter(({ p, monsterId }) => {
        if (monsterIds.has(monsterId)) return true;
        unknown.push({ name: p.name, x: p.x, y: p.y, z: p.z });
        return false;
      });
    if (resolved.length === 0) continue;
    const first = resolved[0] as { p: CanarySpawnPoint; monsterId: string };
    const local = { x: first.p.x - region.x[0], y: first.p.y - region.y[0], z: first.p.z };
    const respawnDelayMs = respawnDelayMsOf(first.p.spawnTimeSec);
    if (resolved.length === 1) {
      written.push({ ...local, radius, respawnDelayMs, monsterId: first.monsterId });
    } else {
      grouped += 1;
      written.push({
        ...local, radius, respawnDelayMs,
        monsters: resolved.map(({ p, monsterId }) => ({ monsterId, weight: p.weight })),
      });
    }
  }
  written.sort((a, b) => (a.z - b.z) || (a.y - b.y) || (a.x - b.x));

  return { pointsRead: points.length, pointsInRegion: inBox.length, grouped, written, unknown };
}

/** `ImportedSpawnPoint` → `SpawnRequest` do `trace-route.ts`, para `anchorSpawnPoints`. */
function toSpawnRequests(points: readonly ImportedSpawnPoint[]): readonly SpawnRequest[] {
  return points.map((p) => ({
    x: p.x, y: p.y, z: p.z, radius: p.radius,
    ...(p.monsterId === undefined ? {} : { monsterId: p.monsterId }),
    ...(p.monsters === undefined ? {} : { monsters: p.monsters }),
    respawnDelayMs: p.respawnDelayMs,
  }));
}

function usage(): string {
  return 'Usage: pnpm catalog:spawns --map <id> [--source <otservbr-monster.xml>] [--radius <n>] [--check]';
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      map: { type: 'string' }, source: { type: 'string' }, radius: { type: 'string' },
      check: { type: 'boolean' }, 'canary-dir': { type: 'string' },
    },
    strict: true,
  });
  if (values.map === undefined) {
    console.error(usage());
    process.exit(2);
  }

  const mapPath = join(MAPS_DIR, `${values.map}.json`);
  if (!existsSync(mapPath)) {
    console.error(`mapa não encontrado: ${mapPath}`);
    process.exit(1);
  }
  const map = tilemapSchema.parse(JSON.parse(readFileSync(mapPath, 'utf8')));
  if (map.source === undefined) {
    console.error(`"${values.map}" não tem \`source\` — não foi importado do OTBM (pnpm map:import), sem região para filtrar`);
    process.exit(1);
  }
  const region = map.source.region;

  const routePath = join(ROUTES_DIR, `${values.map}.json`);
  if (!existsSync(routePath)) {
    console.error(`rota não encontrada: ${routePath} — rode \`pnpm route:trace\` primeiro`);
    process.exit(1);
  }
  const route = routeSchema.parse(JSON.parse(readFileSync(routePath, 'utf8')));

  const canaryDir = values['canary-dir'] === undefined ? resolveCanaryDir(ROOT) : resolve(ROOT, values['canary-dir']);
  const sourcePath = values.source !== undefined
    ? resolve(ROOT, values.source)
    : join(canaryDir, 'data-otservbr-global', 'world', 'otservbr-monster.xml');

  if (!existsSync(sourcePath)) {
    if (values.check) {
      console.log(`routes/${values.map}.json: fonte do Canary não está nesta máquina — pulado (ver CANARY_DIR em scripts/catalog/env.ts, ou --source)`);
      process.exit(0);
    }
    console.error(`${sourcePath} não existe — defina CANARY_DIR ou passe --source`);
    process.exit(1);
  }

  const radius = values.radius === undefined ? 1 : Number(values.radius);
  if (!Number.isInteger(radius) || radius <= 0) {
    console.error(`--radius precisa ser um inteiro positivo, recebi "${values.radius}"`);
    process.exit(2);
  }

  const monsterIds = loadMonsterIds(MONSTERS_DIR);
  const root = parseXml(readFileSync(sourcePath, 'utf8'));
  const points = extractCanarySpawns(root);
  const report = importCanarySpawns(points, region, monsterIds, radius);

  const requests = toSpawnRequests(report.written);
  const spawnPoints = anchorSpawnPoints(route.tiles, map.z, requests);
  const regenerated: TracedRoute = { id: route.id, mapId: route.mapId, tiles: route.tiles, spawnPoints };

  if (values.check) {
    const before = JSON.stringify(route.spawnPoints);
    const after = JSON.stringify(routeSchema.shape.spawnPoints.parse(spawnPoints));
    if (before !== after) {
      console.error(`routes/${values.map}.json: DESATUALIZADO — os spawnPoints regenerados divergem dos versionados`);
      process.exit(1);
    }
    console.log(`routes/${values.map}.json: confere com "${sourcePath}" (${report.written.length} pontos, ${report.unknown.length} desconhecidos)`);
    process.exit(0);
  }

  writeFileSync(routePath, formatRoute(regenerated));

  console.log(`spawns de "${values.map}" ← ${sourcePath}`);
  console.log(`  lidos: ${report.pointsRead}; na região: ${report.pointsInRegion}; agrupados (mais de um monstro no mesmo ponto): ${report.grouped}`);
  console.log(`  escritos: ${report.written.length}; desconhecidos (fora do catálogo local): ${report.unknown.length}`);
  if (report.unknown.length > 0) {
    const byName = new Map<string, number>();
    for (const u of report.unknown) byName.set(u.name, (byName.get(u.name) ?? 0) + 1);
    for (const [name, count] of [...byName.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${name}: ${count}`);
    }
  }
  console.log(`  escrito: ${routePath}`);
}
