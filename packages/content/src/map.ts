// Tilemap e rota em memória. PURO — a leitura de disco continua em `./load.ts`.
//
// Desde a FUN-119 (ADR 0025) o mapa tem ANDARES: cada um com o bitmap de bloqueio e, quando
// importado, a velocidade de chão por tile, o bloqueio de visão e as zonas (PZ, no-pvp, no-logout,
// arena — #830); e `floorChanges` liga um tile a outro andar.

import type {
  Point, RouteData, TilemapData, TilemapInput, TilemapInteractable,
} from './schemas.js';

/**
 * Velocidade de chão de um tile sem velocidade declarada — o valor que o TFS usa quando o
 * chão não diz (§10.1 da referência). Vale para todo mapa autorado à mão (sem camada
 * `speed`) e para o tile bloqueado, que ninguém pisa.
 */
export const DEFAULT_GROUND_SPEED = 150;

/**
 * Os bits de zona de um tile (#830, OW-09, ADR 0060 d.8) — os MESMOS de `OTBM_ATTR_TILE_FLAGS`
 * (`canary/src/io/io_definitions.hpp:73-76`), e `scripts/import-map.test.ts` prende a igualdade
 * com `TILE_FLAG` do leitor de OTBM. O valor de um tile em `Floor.zones` é a soma destes bits, já
 * NORMALIZADA como o Canary carrega o mapa (`canary/src/io/iomap.cpp:165-177`): `protection`,
 * `noPvp` e `pvpZone` são exclusivos entre si — o primeiro que o arquivo traz vence, nesta
 * ordem —, e `noLogout` soma por cima de qualquer um dos quatro estados (incluindo o normal).
 *
 * A PRECEDÊNCIA de quem consulta é outra coisa e é do `sim` (OW-10): `Tile::getZoneType`
 * (`canary/src/items/tile.hpp:188-199`) lê PZ, depois no-pvp, depois arena, depois no-logout,
 * depois normal. O arquivo guarda os bits; não escolhe um tipo.
 */
export const ZONE_FLAG = {
  protection: 1 << 0,
  noPvp: 1 << 2,
  noLogout: 1 << 3,
  pvpZone: 1 << 4,
} as const;

/**
 * A paleta da camada `zones` — um caractere por valor possível depois da normalização de
 * `ZONE_FLAG`. Letra minúscula é a zona sozinha, maiúscula é a zona MAIS `noLogout`:
 *
 * | char | valor | significado                                   |
 * |------|-------|-----------------------------------------------|
 * | `.`  | 0     | normal                                        |
 * | `p`  | 1     | protect zone (PZ)                             |
 * | `n`  | 4     | no-pvp                                        |
 * | `a`  | 16    | arena (`PVPZONE`) — no-pvp no primeiro corte  |
 * | `l`  | 8     | só no-logout                                  |
 * | `P`  | 9     | PZ + no-logout                                |
 * | `N`  | 12    | no-pvp + no-logout                            |
 * | `A`  | 24    | arena + no-logout                             |
 *
 * `l` é a exceção da regra das maiúsculas: no-logout sozinho não tem zona para maiusculizar.
 * Fixa e documentada aqui, nunca por mapa (como `speedPalette` é): o significado é o do Canary.
 */
export const ZONE_PALETTE: Readonly<Record<string, number>> = {
  '.': 0,
  p: ZONE_FLAG.protection,
  n: ZONE_FLAG.noPvp,
  a: ZONE_FLAG.pvpZone,
  l: ZONE_FLAG.noLogout,
  P: ZONE_FLAG.protection | ZONE_FLAG.noLogout,
  N: ZONE_FLAG.noPvp | ZONE_FLAG.noLogout,
  A: ZONE_FLAG.pvpZone | ZONE_FLAG.noLogout,
};

const ZONE_CHAR_BY_VALUE: ReadonlyMap<number, string> = new Map(
  Object.entries(ZONE_PALETTE).map(([char, value]) => [value, char]),
);

/**
 * O caractere da camada `zones` para um valor já normalizado. Lança em combinação que o Canary
 * nunca produz (dois bits exclusivos juntos, bit desconhecido): quem escreve a camada passa por
 * aqui, e um valor fora da paleta nunca chega ao arquivo.
 */
export function zoneChar(value: number): string {
  const char = ZONE_CHAR_BY_VALUE.get(value);
  if (char === undefined) throw new Error(`zona ${value} não está em ZONE_PALETTE`);
  return char;
}

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
  /**
   * Bloqueio de LINHA DE VISÃO (#553): `1` bloqueia projétil/vista, `0` é livre. `null` quando
   * o mapa não declara a camada `sight` deste andar — nenhum tile bloqueia visão, o mesmo
   * "sem dado, sem restrição" que `speed` ausente já usa para velocidade de chão. É a camada
   * que `isSightClear` (`packages/sim/src/line-of-sight.ts`) consulta; bloqueio de PASSO
   * (`blocked`, acima) e bloqueio de VISTA são flags independentes do pacote de aparências
   * (`unpass` vs. `unsight`), por isso duas grades separadas, nunca uma derivada da outra.
   */
  readonly blocksSight: Uint8Array | null;
  /**
   * Zonas do tile (#830, OW-09, ADR 0060 d.8): a soma de `ZONE_FLAG`, um byte por tile, indexado
   * por `y * width + x` — os mesmos bits do OTBM. `null` quando o mapa não declara a camada
   * `zones` deste andar: todo tile é normal, o mesmo "sem dado, sem restrição" de `speed` e
   * `blocksSight` ausentes, e nenhuma hunt muda. Só dado: quem decide o que PZ, no-pvp e
   * no-logout proíbem é o `sim` (OW-10, OW-27).
   */
  readonly zones: Uint8Array | null;
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
  /**
   * Cenário usável (#727, ADR 0050 d.1): o que o importador CLASSIFICOU, geometria e estado no
   * instante da importação. O MECANISMO que muda de estado por sessão é `TileOverrides` (#728,
   * `packages/sim/src/tile-overrides.ts`) — este campo é só o conteúdo fixo que o alimenta.
   */
  readonly interactables: readonly TilemapInteractable[];
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
  /** Vários monstros no MESMO ponto, com peso (#582). Exclusivo com `monsterId`. */
  readonly monsters?: ReadonlyArray<{ readonly monsterId: string; readonly weight: number }>;
  /**
   * O `spawntime` deste ponto, em ms (#519) — o Canary é por posição, não por zona. Obrigatório
   * desde o #583 (fim do pull por dificuldade, ADR 0039): não há mais dificuldade para cair
   * como fallback quando o ponto não declara.
   */
  readonly respawnDelayMs: number;
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
  const floorData: Array<[number, {
    grid: readonly string[]; speed?: readonly string[] | undefined; sight?: readonly string[] | undefined;
    zones?: readonly string[] | undefined;
  }]> = [];
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
    let blocksSight: Uint8Array | null = null;
    if (floor.sight !== undefined) {
      blocksSight = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        const row = floor.sight[y] ?? '';
        for (let x = 0; x < width; x++) {
          if (row[x] === '#') blocksSight[y * width + x] = 1;
        }
      }
    }
    let zones: Uint8Array | null = null;
    if (floor.zones !== undefined) {
      zones = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        const row = floor.zones[y] ?? '';
        for (let x = 0; x < width; x++) {
          const char = row[x];
          // Linha mais curta que a largura é normal no resto — o inverso de `grid`, que
          // bloqueia —, porque zona é restrição OPCIONAL e fora do desenhado não há nada a dizer.
          if (char === undefined) continue;
          const value = ZONE_PALETTE[char];
          if (value === undefined) {
            throw new Error(
              `mapa "${data.id}", andar ${z}: zona "${char}" em (${x},${y}) não está em ZONE_PALETTE`,
            );
          }
          zones[y * width + x] = value;
        }
      }
    }
    floors.set(z, { z, blocked, speed, blocksSight, zones });
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
    // `reward.quantity` tem default no schema (#733) — `data` aqui é `TilemapInput` (o formato
    // de ARQUIVO, antes do default aplicado), então um `reward` sem `quantity` precisa do MESMO
    // 1 que `tilemapSchema.parse` aplicaria, ou o tipo de saída (`TilemapInteractable`, pós-
    // default) diverge do que este objeto realmente carrega.
    interactables: (data.interactables ?? []).map((interactable): TilemapInteractable => {
      const { reward, ...rest } = interactable;
      return {
        ...rest,
        ...(reward === undefined ? {} : { reward: { itemId: reward.itemId, quantity: reward.quantity ?? 1 } }),
      };
    }),
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

/**
 * Os bits de zona do tile (`ZONE_FLAG`), ou `0` — normal — quando o mapa não declara a camada
 * `zones` do andar, o andar não existe ou o tile está fora do mapa. `z` ausente é o andar padrão.
 * Fora do mapa é normal e não bloqueado de propósito: bloqueio é de `isBlocked`, e zona é só o
 * que o Canary guardou no tile.
 */
export function zoneFlagsAt(map: Tilemap, x: number, y: number, z: number = map.z): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  const zones = map.floors.get(z)?.zones;
  if (zones === undefined || zones === null) return 0;
  return zones[y * map.width + x] ?? 0;
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
      respawnDelayMs: s.respawnDelayMs,
      ...(s.monsterId === undefined ? {} : { monsterId: s.monsterId }),
      ...(s.monsters === undefined ? {} : { monsters: s.monsters }),
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
