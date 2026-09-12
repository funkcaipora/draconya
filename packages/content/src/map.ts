// Tilemap e rota em memória. PURO — a leitura de disco continua em `./load.ts`.
//
// Desde a FUN-119 (ADR 0025) o mapa tem ANDARES: cada um com o bitmap de bloqueio e, quando
// importado, a velocidade de chão por tile; e `floorChanges` liga um tile a outro andar.

import type { Point, RouteData, TilemapData, TilemapInput } from './schemas.js';

/**
 * Velocidade de chão de um tile sem velocidade declarada — o valor que o TFS usa quando o
 * chão não diz (§10.1 da referência). Vale para todo mapa autorado à mão (sem camada
 * `speed`) e para o tile bloqueado, que ninguém pisa.
 */
export const DEFAULT_GROUND_SPEED = 150;

export interface Floor {
  readonly z: number;
  /**
   * Um byte por tile, indexado por `y * width + x`.
   *
   * Array plano, e não array de objetos, porque isto é consultado a cada passo de cada
   * monstro de cada instância — é a estrutura mais quente do motor. `Uint8Array` mantém tudo
   * contíguo e a consulta em O(1) sem alocação nenhuma.
   */
  readonly blocked: Uint8Array;
  /** Velocidade de chão por tile, ou `null` quando o mapa não declara (todo tile é o padrão). */
  readonly speed: Uint16Array | null;
}

export interface Tilemap {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** O andar padrão — o único de um mapa de grade única; o do `entryPoint` sem `z`. */
  readonly z: number;
  /** O bitmap do andar padrão. É `floors.get(z).blocked`; existe pelos leitores de um andar. */
  readonly blocked: Uint8Array;
  readonly floors: ReadonlyMap<number, Floor>;
  /** Ver `tilemapSchema.entryPoint`. Ausente: este mapa não é lugar de nascer. */
  readonly entryPoint?: Point;
  /** Escadas: chave de tile (`tileKey`) → destino. */
  readonly floorChanges: ReadonlyMap<number, Point>;
  readonly source?: TilemapData['source'];
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

/**
 * Chave numérica de um tile com andar. Só é chamada com coordenada dentro do mapa; `x` e `y`
 * cabem em cinco dígitos e `z` em dois, e o produto fica longe de 2^53.
 */
export const tileKey = (x: number, y: number, z: number): number =>
  ((z + 16) * 100_000 + x) * 100_000 + y;

/**
 * Monta os andares. Lança em conteúdo que o schema não consegue recusar sozinho — caractere
 * de velocidade fora da paleta, `floors` vazio —, e é `buildContent` quem transforma isso em
 * problema de boot.
 */
export function buildTilemap(data: TilemapInput): Tilemap {
  const floorData: Array<[number, { grid: readonly string[]; speed?: readonly string[] | undefined }]> = [];
  if (data.grid !== undefined) floorData.push([data.z, { grid: data.grid }]);
  for (const [z, floor] of Object.entries(data.floors ?? {})) floorData.push([Number(z), floor]);
  if (floorData.length === 0) throw new Error(`mapa "${data.id}" não tem andar nenhum`);

  const height = Math.max(...floorData.map(([, floor]) => floor.grid.length));
  const width = Math.max(...floorData.flatMap(([, floor]) => floor.grid.map((row) => row.length)));

  const floors = new Map<number, Floor>();
  for (const [z, floor] of floorData) {
    const blocked = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = floor.grid[y] ?? '';
      for (let x = 0; x < width; x++) {
        // Linha mais curta que a largura conta como bloqueada no resto: fora do mapa desenhado
        // não é chão livre. Andar mais baixo que o outro, idem.
        if (row[x] === undefined || row[x] === '#') blocked[y * width + x] = 1;
      }
    }
    let speed: Uint16Array | null = null;
    if (floor.speed !== undefined) {
      speed = new Uint16Array(width * height).fill(DEFAULT_GROUND_SPEED);
      const palette = data.speedPalette ?? {};
      for (let y = 0; y < height; y++) {
        const row = floor.speed[y] ?? '';
        for (let x = 0; x < width; x++) {
          const char = row[x];
          if (char === undefined || char === ' ' || blocked[y * width + x] === 1) continue;
          const value = palette[char];
          if (value === undefined) {
            throw new Error(
              `mapa "${data.id}", andar ${z}: velocidade "${char}" em (${x},${y}) não está em speedPalette`,
            );
          }
          speed[y * width + x] = value;
        }
      }
    }
    floors.set(z, { z, blocked, speed });
  }

  const base = floors.get(data.z);
  if (base === undefined) {
    throw new Error(`mapa "${data.id}": o andar padrão ${data.z} não está em floors`);
  }

  const floorChanges = new Map<number, Point>();
  for (const change of data.floorChanges ?? []) {
    floorChanges.set(tileKey(change.from.x, change.from.y, change.from.z), change.to);
  }

  return {
    id: data.id, width, height, z: data.z, blocked: base.blocked, floors, floorChanges,
    ...(data.entryPoint === undefined
      ? {}
      : { entryPoint: { x: data.entryPoint.x, y: data.entryPoint.y, z: data.entryPoint.z ?? data.z } }),
    ...(data.source === undefined ? {} : { source: data.source }),
  };
}

/** Bloqueado, fora do mapa, ou num andar que o mapa não tem. `z` ausente é o andar padrão. */
export function isBlocked(map: Tilemap, x: number, y: number, z: number = map.z): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  const floor = map.floors.get(z);
  if (floor === undefined) return true;
  return floor.blocked[y * map.width + x] === 1;
}

/** Velocidade de chão do tile, para `movementDuration`. Fora do mapa é o padrão. */
export function groundSpeed(map: Tilemap, x: number, y: number, z: number = map.z): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return DEFAULT_GROUND_SPEED;
  const floor = map.floors.get(z);
  if (floor === undefined || floor.speed === null) return DEFAULT_GROUND_SPEED;
  return floor.speed[y * map.width + x] ?? DEFAULT_GROUND_SPEED;
}

/** Para onde pisar neste tile leva, ou `null` quando ele é um tile comum. */
export function floorChangeAt(map: Tilemap, x: number, y: number, z: number): Point | null {
  return map.floorChanges.get(tileKey(x, y, z)) ?? null;
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
 * Valida a rota contra o mapa. As checagens existem porque cada uma falha de um jeito que
 * ninguém liga à causa:
 *
 *  - tile fora do mapa ou em parede: o personagem fica preso e a hunt "não rende";
 *  - tile numa escada: o personagem trocaria de andar no meio da rota;
 *  - passo não adjacente, ou em outro andar: o personagem teleporta, e o cliente desenha um
 *    salto;
 *  - laço aberto: ele chega ao fim da rota e PARA. Ninguém percebe até alguém reclamar que
 *    a hunt travou — e o §14.4 é explícito que a rota forma um laço.
 */
export function validateRoute(data: RouteData, map: Tilemap): string[] {
  const problems: string[] = [];

  data.tiles.forEach((tile, i) => {
    if (isBlocked(map, tile.x, tile.y, tile.z)) {
      problems.push(`tile ${i} (${tile.x},${tile.y},${tile.z}) está fora do mapa ou em parede`);
    } else if (floorChangeAt(map, tile.x, tile.y, tile.z) !== null) {
      problems.push(`tile ${i} (${tile.x},${tile.y},${tile.z}) é uma escada — a rota trocaria de andar`);
    }
  });

  for (let i = 0; i < data.tiles.length; i++) {
    const atual = data.tiles[i] as Point;
    const proximo = data.tiles[(i + 1) % data.tiles.length] as Point;
    const dx = Math.abs(proximo.x - atual.x);
    const dy = Math.abs(proximo.y - atual.y);
    const adjacente = dx <= 1 && dy <= 1 && dx + dy > 0 && proximo.z === atual.z;
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
