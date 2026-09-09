// Tilemap e rota em memória. PURO — a leitura de disco continua em `./load.ts`.

import type { Point, RouteData, TilemapData } from './schemas.js';

export interface Tilemap {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  /**
   * Um byte por tile, indexado por `y * width + x`.
   *
   * Array plano, e não array de objetos, porque isto é consultado a cada passo de cada
   * monstro de cada instância — é a estrutura mais quente do motor. `Uint8Array` mantém tudo
   * contíguo e a consulta em O(1) sem alocação nenhuma.
   */
  readonly blocked: Uint8Array;
  /** Ver `tilemapSchema.entryPoint`. Ausente: este mapa não é lugar de nascer. */
  readonly entryPoint?: { readonly x: number; readonly y: number };
}

export interface SpawnPoint {
  readonly routeIndex: number;
  readonly radius: number;
  readonly at: Point;
}

export interface Route {
  readonly id: string;
  readonly mapId: string;
  readonly tiles: readonly Point[];
  readonly spawnPoints: readonly SpawnPoint[];
}

export function buildTilemap(data: TilemapData): Tilemap {
  const height = data.grid.length;
  const width = Math.max(...data.grid.map((row) => row.length));
  const blocked = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = data.grid[y] ?? '';
    for (let x = 0; x < width; x++) {
      // Linha mais curta que a largura conta como bloqueada no resto: fora do mapa desenhado
      // não é chão livre.
      if (row[x] === undefined || row[x] === '#') blocked[y * width + x] = 1;
    }
  }
  return {
    id: data.id, width, height, z: data.z, blocked,
    ...(data.entryPoint === undefined ? {} : { entryPoint: data.entryPoint }),
  };
}

export function isBlocked(map: Tilemap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return map.blocked[y * map.width + x] === 1;
}

export function buildRoute(data: RouteData, map: Tilemap): Route {
  const problems = validateRoute(data, map);
  if (problems.length > 0) {
    throw new Error(`rota "${data.id}" inválida:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  return {
    id: data.id,
    mapId: data.mapId,
    tiles: data.tiles,
    spawnPoints: data.spawnPoints.map((s) => ({
      routeIndex: s.routeIndex,
      radius: s.radius,
      at: data.tiles[s.routeIndex] as Point,
    })),
  };
}

/**
 * Valida a rota contra o mapa. As três checagens existem porque cada uma falha de um jeito
 * que ninguém liga à causa:
 *
 *  - tile fora do mapa ou em parede: o personagem fica preso e a hunt "não rende";
 *  - passo não adjacente: o personagem teleporta, e o cliente desenha um salto;
 *  - laço aberto: ele chega ao fim da rota e PARA. Ninguém percebe até alguém reclamar que
 *    a hunt travou — e o §14.4 é explícito que a rota forma um laço.
 */
export function validateRoute(data: RouteData, map: Tilemap): string[] {
  const problems: string[] = [];

  data.tiles.forEach((tile, i) => {
    if (isBlocked(map, tile.x, tile.y)) {
      problems.push(`tile ${i} (${tile.x},${tile.y}) está fora do mapa ou em parede`);
    }
  });

  for (let i = 0; i < data.tiles.length; i++) {
    const atual = data.tiles[i] as Point;
    const proximo = data.tiles[(i + 1) % data.tiles.length] as Point;
    const dx = Math.abs(proximo.x - atual.x);
    const dy = Math.abs(proximo.y - atual.y);
    const adjacente = dx <= 1 && dy <= 1 && dx + dy > 0;
    if (!adjacente) {
      const ehFechamento = i === data.tiles.length - 1;
      problems.push(
        ehFechamento
          ? `a rota não fecha o laço: o último tile (${atual.x},${atual.y}) não é adjacente ` +
            `ao primeiro (${proximo.x},${proximo.y})`
          : `passo ${i}→${i + 1} não é adjacente: (${atual.x},${atual.y}) para ` +
            `(${proximo.x},${proximo.y})`,
      );
    }
  }

  for (const spawn of data.spawnPoints) {
    if (spawn.routeIndex >= data.tiles.length) {
      problems.push(
        `ponto de spawn aponta índice ${spawn.routeIndex}, mas a rota tem ` +
          `${data.tiles.length} tiles`,
      );
    }
  }

  return problems;
}
