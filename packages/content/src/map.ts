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
  /**
   * As mesmas escadas de `floorChanges`, agrupadas pelo ANDAR de origem (#527, follow de membro
   * através de andar). `floorChanges` é indexado pela chave codificada do tile — útil para "há
   * escada NESTE tile?", inútil para "quais escadas SAEM deste andar?", que exigiria decodificar
   * a chave. Esta é a segunda forma do MESMO dado, não uma fonte nova.
   */
  readonly floorChangesByFloor: ReadonlyMap<number, readonly FloorChange[]>;
  readonly source?: TilemapData['source'];
}

/** Uma escada: `from` está no andar de origem, `to` pode estar em qualquer outro (FUN-119). */
export interface FloorChange {
  readonly from: Point;
  readonly to: Point;
}

export interface SpawnPoint {
  readonly routeIndex: number;
  readonly radius: number;
  readonly at: Point;
  /** O monstro deste ponto (#519). Ausente é o sorteio de composição de sempre. */
  readonly monsterId?: string;
  /** O `spawntime` deste ponto, em ms (#519). Ausente cai no `respawnDelayMs` da dificuldade. */
  readonly respawnDelayMs?: number;
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
  const floorChangesByFloor = new Map<number, FloorChange[]>();
  for (const change of data.floorChanges ?? []) {
    floorChanges.set(tileKey(change.from.x, change.from.y, change.from.z), change.to);
    const byFloor = floorChangesByFloor.get(change.from.z);
    if (byFloor === undefined) floorChangesByFloor.set(change.from.z, [change]);
    else byFloor.push(change);
  }

  return {
    id: data.id, width, height, z: data.z, blocked: base.blocked, floors, floorChanges,
    floorChangesByFloor,
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

/**
 * A escada que começa uma travessia de `fromZ` até `targetZ` (#527, follow de membro através de
 * andar): o tile, NO ANDAR `fromZ`, onde pisar leva um hop mais perto de `targetZ`. `null` quando
 * já se está lá, ou quando não existe sequência de escadas conectando os dois andares.
 *
 * Busca em LARGURA sobre o grafo de andares — nunca A* nem Dijkstra (ADR 0009 vale para o mesmo
 * espírito aqui): o grafo de uma hunt tem poucas escadas ao todo (a Darashia Dragon Lair tem
 * quatro, duas por par de andares), e toda aresta vale o mesmo hop — não há custo de travessia
 * diferente entre uma escada e outra. Devolve o PRIMEIRO salto: quem chama dá `greedyStep` até
 * esse tile, e pisar nele já leva ao próximo andar sozinho (`move`, `movement.ts`) — o resto do
 * caminho se resolve reavaliando esta função do andar novo, no vencimento seguinte.
 */
export function floorChangeToward(map: Tilemap, fromZ: number, targetZ: number): Point | null {
  if (fromZ === targetZ) return null;
  const visited = new Set<number>([fromZ]);
  // Cada entrada da fila guarda o PRIMEIRO salto do caminho, não o andar de onde ela partiu —
  // é o que faz a resposta ser "por onde eu saio agora", em qualquer profundidade do grafo.
  const queue: Array<{ readonly z: number; readonly first: Point }> = [];
  for (const change of map.floorChangesByFloor.get(fromZ) ?? []) {
    if (change.to.z === targetZ) return change.from;
    if (visited.has(change.to.z)) continue;
    visited.add(change.to.z);
    queue.push({ z: change.to.z, first: change.from });
  }
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i] as { readonly z: number; readonly first: Point };
    for (const change of map.floorChangesByFloor.get(current.z) ?? []) {
      if (change.to.z === targetZ) return current.first;
      if (visited.has(change.to.z)) continue;
      visited.add(change.to.z);
      queue.push({ z: change.to.z, first: current.first });
    }
  }
  return null;
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
      // A posição EXATA (#519) prevalece quando declarada — é o caso do Canary, cujo spawn
      // raramente cai em cima da rota; sem ela, o tile do `routeIndex` continua sendo a posição,
      // como sempre foi.
      at: s.at ?? (data.tiles[s.routeIndex] as Point),
      ...(s.monsterId === undefined ? {} : { monsterId: s.monsterId }),
      ...(s.respawnDelayMs === undefined ? {} : { respawnDelayMs: s.respawnDelayMs }),
    })),
  };
}

/**
 * Valida a rota contra o mapa. As checagens existem porque cada uma falha de um jeito que
 * ninguém liga à causa:
 *
 *  - tile fora do mapa ou em parede: o personagem fica preso e a hunt "não rende";
 *  - passo não adjacente, nem escada, nem em outro andar por conta própria: o personagem
 *    teleporta, e o cliente desenha um salto;
 *  - laço aberto: ele chega ao fim da rota e PARA. Ninguém percebe até alguém reclamar que
 *    a hunt travou — e o §14.4 é explícito que a rota forma um laço.
 *
 * **Hunt multiandar (#519):** um tile pode SER uma escada — `move()` já resolve isso sozinho, e
 * proibir era o que impedia a primeira rota de três andares. O que se confere é diferente do
 * passo comum: pisar no tile `(x, y)` da escada, vindo do andar de ORIGEM dela, pousa no destino
 * registrado em `floorChanges` — não em `(x, y)` — e é ESSA posição, não o tile autorado, que
 * conta como "onde o personagem está" para julgar o passo seguinte. `at` abaixo é essa posição
 * EFETIVA; ela só diverge do tile autorado durante uma travessia de escada.
 */
export function validateRoute(data: RouteData, map: Tilemap): string[] {
  const problems: string[] = [];

  data.tiles.forEach((tile, i) => {
    if (isBlocked(map, tile.x, tile.y, tile.z)) {
      problems.push(`tile ${i} (${tile.x},${tile.y},${tile.z}) está fora do mapa ou em parede`);
    }
  });

  let at: Point = data.tiles[0] as Point;
  for (let i = 0; i < data.tiles.length; i++) {
    const proximo = data.tiles[(i + 1) % data.tiles.length] as Point;
    const dx = Math.abs(proximo.x - at.x);
    const dy = Math.abs(proximo.y - at.y);
    // Um tile de distância, em QUALQUER direção — a mesma régua do passo comum; o `z` de
    // `proximo` não entra aqui, porque quem decide se há troca de andar é o mapa, não o autor.
    const umPasso = dx <= 1 && dy <= 1 && dx + dy > 0;
    const troca = umPasso ? floorChangeAt(map, proximo.x, proximo.y, at.z) : null;
    if (troca !== null) {
      if (proximo.z !== at.z) {
        problems.push(
          `tile ${i + 1} (${proximo.x},${proximo.y},${proximo.z}) é o degrau de uma escada que ` +
            `sai do andar ${at.z} — o andar dele devia ser ${at.z} (o de ORIGEM), não ${proximo.z}`,
        );
      }
      // O passo pousa no destino registrado da escada, nunca no tile pedido — é para ONDE o
      // próximo trecho da rota precisa continuar adjacente.
      at = troca;
      continue;
    }
    if (umPasso && proximo.z === at.z) {
      at = proximo;
      continue;
    }
    const ehFechamento = i === data.tiles.length - 1;
    problems.push(
      ehFechamento
        ? `a rota não fecha o laço: o último tile (${at.x},${at.y},${at.z}) não é adjacente ` +
          `nem escada até o primeiro (${proximo.x},${proximo.y},${proximo.z})`
        : `passo ${i}→${i + 1} não é adjacente nem escada: (${at.x},${at.y},${at.z}) para ` +
          `(${proximo.x},${proximo.y},${proximo.z})`,
    );
    at = proximo; // segue com o valor autorado, para não propagar um erro em cascata
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
