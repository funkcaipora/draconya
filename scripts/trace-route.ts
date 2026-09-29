// Traça a rota de uma hunt sobre a grade de um mapa (FUN-123, #519): recebe pontos de passagem e
// devolve o laço de tiles adjacentes que os liga, por busca em largura na grade — o único
// lugar do repositório em que há pathfinding, e é uma ferramenta, nunca o `sim` (§14.4: a rota é
// fixa e predeterminada; quem a autora é um humano, com isto na mão).
//
//   pnpm route:trace --id rat-cellars --map rat-cellars --z 8 \
//     --via 46,51 41,45 44,39 ... --spawn 44,39,2 --spawn 47,36,2 ...
//
//   # multiandar (#519): --via aceita x,y,z (z ausente é o `--z` do topo); --spawn aceita
//   # x,y,radius (como sempre) OU x,y,z,radius[,monsterId] quando o ponto declara o andar e/ou
//   # o monstro exato do Canary, em vez da composição sorteada:
//   pnpm route:trace --id darashia-dragon-lair --map darashia-dragon-lair \
//     --via 27,6,10 ... 38,71,11 ... 39,75,12 ... \
//     --spawn 27,4,10,1,dragon --spawn 38,73,11,1,dragon-lord ...
//
// A rota sai em `packages/content/data/routes/<id>.json`: os tiles do laço, fechado de volta ao
// primeiro ponto, e os pontos de spawn ancorados no ÍNDICE da rota mais próximo de cada tile
// pedido (como `routeSchema` quer — ancorar no índice mantém rota e spawn juntos). A busca é
// pelos quatro vizinhos: o `buildRoute` aceita diagonal, mas a diagonal custa três passos e a
// rota do bot não deve pagá-los em cada esquina.
//
// **Escada é um estado a mais na busca, não uma parede** (#519). `move()` do `sim` resolve
// sozinho quem pisa no tile de uma escada — o mesmo mecanismo que `movement.ts` já usa: pisar em
// `(x, y)` registrado em `floorChanges`, vindo do andar de ORIGEM, pousa no destino dela, que
// pode não ser adjacente ao degrau (ADR 0025: "descer uma escada desloca um tile"). O BFS
// espelha isso: de um tile adjacente ao degrau, o vizinho "andar para o degrau" na verdade leva
// ao POUSO — o degrau nunca é um estado em que se fica, porque `move()` nunca deixa ninguém
// parado nele. O tile GRAVADO nesse passo da rota é o do degrau (é o argumento que `move()`
// precisa receber para reconhecer a escada); o estado do qual a busca CONTINUA é o pouso.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildTilemap, floorChangeAt, isBlocked, tilemapSchema } from '../packages/content/src/index.js';
import type { Point, Tilemap } from '../packages/content/src/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Um ponto de passagem. `z` ausente é o andar AMBIENTE da chamada (o `--z`/`z` do topo). */
export interface Waypoint { readonly x: number; readonly y: number; readonly z?: number }
export interface SpawnRequest extends Waypoint {
  readonly radius: number;
  /** O monstro deste ponto (#519) — ausente é a composição sorteada, como sempre. */
  readonly monsterId?: string;
  /** O `spawntime` DESTE ponto, em ms (#519) — ausente cai no `respawnDelayMs` da dificuldade. */
  readonly respawnDelayMs?: number;
}

export interface TracedRoute {
  readonly id: string;
  readonly mapId: string;
  readonly tiles: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }>;
  readonly spawnPoints: ReadonlyArray<{
    readonly routeIndex: number;
    readonly radius: number;
    readonly at?: { readonly x: number; readonly y: number; readonly z: number };
    readonly monsterId?: string;
    readonly respawnDelayMs?: number;
  }>;
}

const CARDINALS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Chave de estado (x, y, z) para o BFS — `Map` por string, sem colisão entre andares. */
const stateKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/**
 * O caminho mais curto a pé de `from` a `to`, sem os dois extremos repetidos — TRAVESSA andares
 * quando a grade tem `floorChanges` no caminho (#519). `from`/`to` sem `z` usam o andar ambiente
 * `z`, como sempre — é o que preserva toda chamada de andar único, bit a bit.
 *
 * Devolve os tiles REALMENTE pisados no sentido de `move()`: o tile do degrau (o argumento que
 * faz `move()` reconhecer a escada), nunca o pouso dela como um tile à parte — o pouso é de onde
 * a busca CONTINUA, não um passo extra.
 */
export function shortestPath(
  map: Tilemap, z: number, from: Waypoint, to: Waypoint,
): Array<{ x: number; y: number; z: number }> | null {
  const fromZ = from.z ?? z;
  const toZ = to.z ?? z;
  const startKey = stateKey(from.x, from.y, fromZ);
  const targetKey = stateKey(to.x, to.y, toZ);

  // `prev` guarda, por ESTADO alcançado, de qual estado veio e qual foi o tile GRAVADO no passo
  // — os dois divergem exatamente quando o passo atravessou uma escada.
  const prev = new Map<string, { readonly fromKey: string; readonly point: { x: number; y: number; z: number } }>();
  const queue: Array<{ x: number; y: number; z: number }> = [{ x: from.x, y: from.y, z: fromZ }];
  const seen = new Set<string>([startKey]);

  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as { x: number; y: number; z: number };
    if (stateKey(at.x, at.y, at.z) === targetKey) break;
    for (const [dx, dy] of CARDINALS) {
      const nx = at.x + dx;
      const ny = at.y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (isBlocked(map, nx, ny, at.z)) continue;
      // O tile GRAVADO deste passo é sempre (nx, ny, at.z) — o andar de ORIGEM, o que `move()`
      // espera receber. Se ele é uma escada, o ESTADO para onde a busca continua é o pouso dela.
      const change = floorChangeAt(map, nx, ny, at.z);
      const nextState = change ?? { x: nx, y: ny, z: at.z };
      const nextKey = stateKey(nextState.x, nextState.y, nextState.z);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      prev.set(nextKey, { fromKey: stateKey(at.x, at.y, at.z), point: { x: nx, y: ny, z: at.z } });
      queue.push(nextState);
    }
  }

  if (startKey !== targetKey && !prev.has(targetKey)) return null;

  const path: Array<{ x: number; y: number; z: number }> = [];
  let k = targetKey;
  while (k !== startKey) {
    const entry = prev.get(k);
    if (entry === undefined) return null;
    path.push(entry.point);
    k = entry.fromKey;
  }
  path.reverse();
  return path;
}

/**
 * O laço pelos pontos de passagem, na ordem, fechado de volta ao primeiro. Cada ponto precisa
 * ser andável e alcançável do anterior — um ponto numa parede, ou numa sala sem porta, é erro
 * com o nome do ponto, não uma rota silenciosamente mais curta. Um ponto de passagem NUNCA é o
 * degrau de uma escada (#519): ninguém "para" numa escada, `move()` não deixa — o ponto de
 * passagem é sempre um lugar de fato, e a escada é só o meio do caminho até o próximo.
 */
export function traceRoute(
  map: Tilemap, z: number, id: string, via: readonly Waypoint[], spawns: readonly SpawnRequest[],
): TracedRoute {
  if (via.length < 2) throw new Error('a rota precisa de ao menos dois pontos de passagem');
  const resolvedVia = via.map((point) => ({ x: point.x, y: point.y, z: point.z ?? z }));
  resolvedVia.forEach((point, i) => {
    if (isBlocked(map, point.x, point.y, point.z)) throw new Error(`ponto ${i} (${point.x},${point.y},${point.z}) não é andável`);
    if (floorChangeAt(map, point.x, point.y, point.z) !== null) {
      throw new Error(`ponto ${i} (${point.x},${point.y},${point.z}) é o degrau de uma escada — não é um lugar onde se para`);
    }
  });

  const tiles: Array<{ x: number; y: number; z: number }> = [resolvedVia[0] as { x: number; y: number; z: number }];
  const legs = resolvedVia.map((point, i) => [point, resolvedVia[(i + 1) % resolvedVia.length]] as const);
  for (const [i, [from, to]] of legs.entries()) {
    const path = shortestPath(map, z, from, to as Waypoint);
    if (path === null) throw new Error(`não há caminho a pé do ponto ${i} (${from.x},${from.y},${from.z}) ao seguinte (${to?.x},${to?.y},${to?.z})`);
    tiles.push(...path);
  }
  // O último passo devolve ao primeiro tile: ele é o fecho, não um tile a mais.
  tiles.pop();
  if (tiles.length < 2) throw new Error('a rota ficou com menos de dois tiles');

  const spawnPoints = spawns.map((spawn) => {
    const spawnZ = spawn.z ?? z;
    // Prefere o tile da rota no MESMO andar (#519): sem isso, um ponto de z11 ancoraria no
    // tile mais próximo por (x, y) de OUTRO andar sempre que a caixa se sobrepuser — os três
    // andares da Darashia Dragon Lair compartilham a mesma caixa x/y.
    const sameFloorTiles = tiles.some((t) => t.z === spawnZ);
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, tile] of tiles.entries()) {
      if (sameFloorTiles && tile.z !== spawnZ) continue;
      const distance = Math.abs(tile.x - spawn.x) + Math.abs(tile.y - spawn.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return {
      routeIndex: best,
      radius: spawn.radius,
      // A posição EXATA (#519) é a do Canary, não a do tile ancorado — os dois raramente
      // coincidem.
      at: { x: spawn.x, y: spawn.y, z: spawnZ },
      ...(spawn.monsterId === undefined ? {} : { monsterId: spawn.monsterId }),
      ...(spawn.respawnDelayMs === undefined ? {} : { respawnDelayMs: spawn.respawnDelayMs }),
    };
  }).sort((a, b) => a.routeIndex - b.routeIndex);

  return { id, mapId: map.id, tiles, spawnPoints };
}

/** O JSON da rota, um tile por linha em grupos de quatro — legível no diff, como o mapa. */
export function formatRoute(route: TracedRoute): string {
  const lines: string[] = [];
  for (let i = 0; i < route.tiles.length; i += 4) {
    lines.push('    ' + route.tiles.slice(i, i + 4).map((t) => `{ "x": ${t.x}, "y": ${t.y}, "z": ${t.z} }`).join(', '));
  }
  const spawns = route.spawnPoints.map((s) => {
    const fields = [`"routeIndex": ${s.routeIndex}`, `"radius": ${s.radius}`];
    if (s.at !== undefined) fields.push(`"at": { "x": ${s.at.x}, "y": ${s.at.y}, "z": ${s.at.z} }`);
    if (s.monsterId !== undefined) fields.push(`"monsterId": ${JSON.stringify(s.monsterId)}`);
    if (s.respawnDelayMs !== undefined) fields.push(`"respawnDelayMs": ${s.respawnDelayMs}`);
    return `    { ${fields.join(', ')} }`;
  }).join(',\n');
  return `{\n  "id": ${JSON.stringify(route.id)},\n  "mapId": ${JSON.stringify(route.mapId)},\n  "tiles": [\n${lines.join(',\n')}\n  ],\n  "spawnPoints": [\n${spawns}\n  ]\n}\n`;
}

/** `x,y` ou `x,y,z` — `z` ausente cai no andar ambiente da chamada. */
function parsePoint(text: string): Waypoint {
  const parts = text.split(',').map(Number);
  const [x, y, z] = parts;
  if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`ponto inválido: ${text}`);
  if (z !== undefined && !Number.isInteger(z)) throw new Error(`ponto inválido: ${text}`);
  return z === undefined ? { x, y } : { x, y, z };
}

/**
 * `x,y[,radius]` (como sempre — o andar é o ambiente) ou `x,y,z,radius[,monsterId]` (#519, o
 * caso do Canary: andar e monstro exatos do ponto). O número de campos decide qual é qual —
 * sem ambiguidade, porque as duas formas nunca têm 4 ou 5 campos ao mesmo tempo.
 */
export function parseSpawn(text: string): SpawnRequest {
  const fields = text.split(',');
  if (fields.length <= 3) {
    const [x, y, radius] = fields.map(Number);
    if (x === undefined || y === undefined || !Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`spawn inválido: ${text}`);
    return { x, y, radius: radius === undefined || !Number.isInteger(radius) ? 3 : radius };
  }
  const [xs, ys, zs, rs, monsterId, respawnMs] = fields;
  const x = Number(xs);
  const y = Number(ys);
  const z = Number(zs);
  const radius = Number(rs);
  if (![x, y, z, radius].every(Number.isInteger)) throw new Error(`spawn inválido: ${text}`);
  const respawnDelayMs = respawnMs === undefined || respawnMs === '' ? undefined : Number(respawnMs);
  if (respawnDelayMs !== undefined && !Number.isInteger(respawnDelayMs)) throw new Error(`spawn inválido: ${text}`);
  return {
    x, y, z, radius,
    ...(monsterId === undefined || monsterId === '' ? {} : { monsterId }),
    ...(respawnDelayMs === undefined ? {} : { respawnDelayMs }),
  };
}

function usage(): string {
  return 'Usage: pnpm route:trace --id <id> --map <mapId> [--z <z>] --via x,y[,z] [x,y[,z]…]'
    + ' [--spawn x,y[,radius] | x,y,z,radius[,monsterId[,respawnDelayMs]]…]';
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
  const floors = [...new Set(route.tiles.map((t) => t.z))].sort((a, b) => a - b);
  if (floors.length > 1) console.log(`  andares: ${floors.join(', ')}`);
}
