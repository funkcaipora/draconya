// Traça a rota de uma hunt sobre a grade de um mapa (FUN-123): recebe pontos de passagem e
// devolve o laço de tiles adjacentes que os liga, por busca em largura na grade — o único
// lugar do repositório em que há pathfinding, e é uma ferramenta, nunca o `sim` (§14.4: a rota é
// fixa e predeterminada; quem a autora é um humano, com isto na mão).
//
//   pnpm route:trace --id rat-cellars --map rat-cellars --z 8 \
//     --via 46,51 41,45 44,39 ... --spawn 44,39,2 --spawn 47,36,2 ...
//
// A rota sai em `packages/content/data/routes/<id>.json`: os tiles do laço, fechado de volta ao
// primeiro ponto, e os pontos de spawn ancorados no ÍNDICE da rota mais próximo de cada tile
// pedido (como `routeSchema` quer — ancorar no índice mantém rota e spawn juntos). A busca é
// pelos quatro vizinhos: o `buildRoute` aceita diagonal, mas a diagonal custa três passos e a
// rota do bot não deve pagá-los em cada esquina.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildTilemap, isBlocked, tilemapSchema } from '../packages/content/src/index.js';
import type { Tilemap } from '../packages/content/src/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface Waypoint { readonly x: number; readonly y: number }
export interface SpawnRequest extends Waypoint { readonly radius: number }

export interface TracedRoute {
  readonly id: string;
  readonly mapId: string;
  readonly tiles: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }>;
  readonly spawnPoints: ReadonlyArray<{ readonly routeIndex: number; readonly radius: number }>;
}

const CARDINALS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** O caminho mais curto a pé de `from` a `to`, sem os dois extremos repetidos; `null` se não há. */
export function shortestPath(map: Tilemap, z: number, from: Waypoint, to: Waypoint): Waypoint[] | null {
  const key = (p: Waypoint): number => p.y * map.width + p.x;
  const prev = new Map<number, number>();
  const queue: Waypoint[] = [from];
  prev.set(key(from), -1);
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as Waypoint;
    if (at.x === to.x && at.y === to.y) break;
    for (const [dx, dy] of CARDINALS) {
      const next = { x: at.x + dx, y: at.y + dy };
      if (next.x < 0 || next.y < 0 || next.x >= map.width || next.y >= map.height) continue;
      if (prev.has(key(next)) || isBlocked(map, next.x, next.y, z)) continue;
      prev.set(key(next), key(at));
      queue.push(next);
    }
  }
  if (!prev.has(key(to))) return null;
  const path: Waypoint[] = [];
  for (let k = key(to); k !== key(from); k = prev.get(k) as number) {
    path.push({ x: k % map.width, y: Math.floor(k / map.width) });
  }
  path.reverse();
  return path;
}

/**
 * O laço pelos pontos de passagem, na ordem, fechado de volta ao primeiro. Cada ponto precisa
 * ser andável e alcançável do anterior — um ponto numa parede, ou numa sala sem porta, é erro
 * com o nome do ponto, não uma rota silenciosamente mais curta.
 */
export function traceRoute(
  map: Tilemap, z: number, id: string, via: readonly Waypoint[], spawns: readonly SpawnRequest[],
): TracedRoute {
  if (via.length < 2) throw new Error('a rota precisa de ao menos dois pontos de passagem');
  for (const [i, point] of via.entries()) {
    if (isBlocked(map, point.x, point.y, z)) throw new Error(`ponto ${i} (${point.x},${point.y}) não é andável`);
  }
  const tiles: Waypoint[] = [via[0] as Waypoint];
  const legs = via.map((point, i) => [point, via[(i + 1) % via.length] as Waypoint] as const);
  for (const [i, [from, to]] of legs.entries()) {
    const path = shortestPath(map, z, from, to);
    if (path === null) throw new Error(`não há caminho a pé do ponto ${i} (${from.x},${from.y}) ao seguinte (${to.x},${to.y})`);
    tiles.push(...path);
  }
  // O último passo devolve ao primeiro tile: ele é o fecho, não um tile a mais.
  tiles.pop();
  if (tiles.length < 2) throw new Error('a rota ficou com menos de dois tiles');

  const spawnPoints = spawns.map((spawn) => {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, tile] of tiles.entries()) {
      const distance = Math.abs(tile.x - spawn.x) + Math.abs(tile.y - spawn.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return { routeIndex: best, radius: spawn.radius };
  }).sort((a, b) => a.routeIndex - b.routeIndex);

  return { id, mapId: map.id, tiles: tiles.map((t) => ({ x: t.x, y: t.y, z })), spawnPoints };
}

/** O JSON da rota, um tile por linha em grupos de quatro — legível no diff, como o mapa. */
export function formatRoute(route: TracedRoute): string {
  const lines: string[] = [];
  for (let i = 0; i < route.tiles.length; i += 4) {
    lines.push('    ' + route.tiles.slice(i, i + 4).map((t) => `{ "x": ${t.x}, "y": ${t.y}, "z": ${t.z} }`).join(', '));
  }
  const spawns = route.spawnPoints.map((s) => `    { "routeIndex": ${s.routeIndex}, "radius": ${s.radius} }`).join(',\n');
  return `{\n  "id": ${JSON.stringify(route.id)},\n  "mapId": ${JSON.stringify(route.mapId)},\n  "tiles": [\n${lines.join(',\n')}\n  ],\n  "spawnPoints": [\n${spawns}\n  ]\n}\n`;
}

function parsePoint(text: string): Waypoint {
  const [x, y] = text.split(',').map(Number);
  if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`ponto inválido: ${text}`);
  return { x, y };
}

function parseSpawn(text: string): SpawnRequest {
  const [x, y, radius] = text.split(',').map(Number);
  if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`spawn inválido: ${text}`);
  return { x, y, radius: radius === undefined || !Number.isInteger(radius) ? 3 : radius };
}

function usage(): string {
  return 'Usage: pnpm route:trace --id <id> --map <mapId> [--z <z>] --via x,y [x,y…] [--spawn x,y[,raio]…]';
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: {
      id: { type: 'string' }, map: { type: 'string' }, z: { type: 'string' },
      via: { type: 'string', multiple: true }, spawn: { type: 'string', multiple: true },
    },
    allowPositionals: true,
  });
  if (values.id === undefined || values.map === undefined || values.via === undefined) {
    console.error(usage());
    process.exit(2);
  }
  const mapPath = join(ROOT, 'packages', 'content', 'data', 'maps', `${values.map}.json`);
  if (!existsSync(mapPath)) {
    console.error(`mapa não encontrado: ${mapPath}`);
    process.exit(2);
  }
  const map = buildTilemap(tilemapSchema.parse(JSON.parse(readFileSync(mapPath, 'utf8'))));
  const z = values.z === undefined ? map.z : Number(values.z);
  // `--via` aceita a lista inteira depois de uma flag só; os posicionais são o resto dela.
  const via = [...values.via, ...positionals].map(parsePoint);
  const spawns = (values.spawn ?? []).map(parseSpawn);
  const route = traceRoute(map, z, values.id, via, spawns);
  const out = join(ROOT, 'packages', 'content', 'data', 'routes', `${values.id}.json`);
  writeFileSync(out, formatRoute(route));
  console.log(`rota "${route.id}": ${route.tiles.length} tiles, ${route.spawnPoints.length} pontos de spawn → ${out}`);
}
