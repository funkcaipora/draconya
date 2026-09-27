// O importador de mapa real (FUN-118, ADR 0025): recorta uma região e uma faixa de andares do
// `otservbr.otbm` e escreve os DOIS produtos que a decisão pede, um por consumidor.
//
//   pnpm map:import --id thais --x 32275..32458 --y 32153..32291 --z 4..7 --entry 32369,32241,7
//   pnpm map:import --id rat-cellars --x 32022..32139 --y 32168..32247 --z 8
//   pnpm map:import --check      # regenera em memória cada mapa importado e compara (pnpm check)
//
//   packages/content/data/maps/<id>.json   geometria para o SERVIDOR: bloqueio e velocidade de
//                                          chão por andar, escadas, entrada, `source`. Versionado.
//   things/<versão>/maps/<id>.json         a pilha de aparências por tile, para o CLIENTE, servida
//                                          por `/things/` como as folhas. Nunca versionado.
//
// O bloqueio deriva das flags do pacote UMA vez, aqui: `#` se o chão ou qualquer item tem
// `unpass`; tile sem chão mas com item existe e é decidido pelos itens (é o degrau de escada);
// tile sem chão e sem item fica fora do mapa. O `sim` nunca vê flag — vê `#` e `.`.
//
// Um mesmo tile pode vir duas vezes do arquivo (o editor fecha e reabre o bloco): o ÚLTIMO
// vence, e o relatório conta. `TILE_FLAGS` (PZ, no-logout) são ignorados — a Cidade inteira já
// é PZ por construção (ADR 0004). As escadas NÃO são derivadas: o importador lista os candidatos
// pelo nome da aparência, e quem autora `floorChanges` é um humano, no JSON do mapa.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { NO_FLAGS, readAppearances } from '../packages/client/src/assets/appearances.js';
import type { AppearanceCatalogue, AppearanceFlags } from '../packages/client/src/assets/appearances.js';
import { readCatalog } from '../packages/client/src/assets/catalog.js';
import { Reader, WIRE_LENGTH, WIRE_VARINT } from '../packages/client/src/assets/protobuf.js';
import { DEFAULT_GROUND_SPEED } from '../packages/content/src/map.js';
import { tilemapSchema } from '../packages/content/src/schemas.js';
import type { TilemapInput } from '../packages/content/src/schemas.js';
import { readOtbmTiles } from './otbm.js';
import type { OtbmItem, OtbmTile, Region } from './otbm.js';
import { buildSceneryIndex, classifyByAttributes } from './scenery.js';
import type { CanaryTables, ClassifiedFeature, SceneryIndex } from './scenery.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAPS_DIR = join(ROOT, 'packages', 'content', 'data', 'maps');
const SCENERY_TABLES_PATH = join(ROOT, 'packages', 'content', 'data', 'scenery', 'canary-tables.json');
const GENERATED_SCENERY_PATH = join(ROOT, 'packages', 'content', 'data', 'appearances', 'generated', 'scenery.json');

/**
 * Um tile depois do recorte, em coordenadas do MAPA REAL.
 *
 * `items` guarda o `OtbmItem` INTEIRO — não só `{ id, count? }` — porque `aid`/`uid`/`text`
 * (#727, ADR 0050 d.1) moram nele, e é a partir daqui que o cenário usável é classificado.
 */
export interface RegionTile {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly ground: number | null;
  readonly items: readonly OtbmItem[];
}

export interface ImportOptions {
  readonly id: string;
  readonly region: Region;
  /** As flags de um objeto do pacote; `null` quando o id não existe nele. */
  readonly flagsOf: (appearanceId: number) => AppearanceFlags | null;
  /**
   * Nome do objeto no pacote, para o relatório de candidatos a escada. Os nomes do pacote
   * 13.x são os do mercado/cyclopedia (7.183 objetos, nenhum "stairs"), então o critério que
   * vale de verdade é o geométrico: tile andável SEM chão — o degrau é um item que se pisa.
   */
  readonly nameOf?: (appearanceId: number) => string | undefined;
  /** Onde se nasce, em coordenadas do mapa real. */
  readonly entryPoint?: { readonly x: number; readonly y: number; readonly z: number };
  /** Mantém só a componente andável (4 vizinhos) que contém este tile, mais a borda de um tile. */
  readonly keepFrom?: { readonly x: number; readonly y: number; readonly z: number };
  /** O andar padrão do mapa. Ausente: o da entrada, ou o menor da faixa. */
  readonly defaultZ?: number;
  readonly source: { readonly file: string; readonly sha256: string };
  /** Versão do pacote de arte, para o arquivo do cliente. */
  readonly version: string;
  /** Segue com ids que o pacote não tem (viram andáveis e são reportados). Padrão: erro. */
  readonly allowUnknown?: boolean;
  /**
   * O cenário usável (#727, ADR 0050 d.1) — porta, capim, stone pile, rope spot, ladder,
   * alavanca, baú, placa. Ausente é o mapa sem classificação nenhuma (o comportamento de
   * sempre): `--check` e os testes que não falam de cenário continuam idênticos.
   */
  readonly sceneryIndex?: SceneryIndex;
}

/** O que vai para `things/<versão>/maps/<id>.json`. Coordenadas LOCAIS ao recorte. */
export interface StackMap {
  readonly id: string;
  readonly version: string;
  readonly source: TilemapInput['source'];
  readonly width: number;
  readonly height: number;
  readonly floors: readonly number[];
  /** `[x, y, z, chão (0 = sem chão), [item | [item, contagem]…]]`. */
  readonly tiles: ReadonlyArray<readonly [number, number, number, number, ReadonlyArray<number | readonly [number, number]>]>;
}

export interface ImportReport {
  readonly tilesRead: number;
  readonly conflicts: number;
  readonly dropped: number;
  readonly perFloor: ReadonlyArray<{ readonly z: number; readonly tiles: number; readonly blocked: number; readonly walkable: number }>;
  readonly distinctIds: number;
  readonly unknownIds: readonly number[];
  readonly stairCandidates: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number; readonly id: number; readonly name?: string }>;
  readonly region: Region;
  /** Quantos interativos por `kind` (#727) — o número que o relatório e o PR citam. */
  readonly interactablesByKind: ReadonlyMap<string, number>;
}

export interface ImportResult {
  readonly content: TilemapInput;
  readonly stack: StackMap;
  readonly report: ImportReport;
  /**
   * `appearances.scenery` deste mapa (#727, ADR 0050 d.1): as entradas ESTÁTICAS do
   * `sceneryIndex` (porta, capim, pile, rope spot, ladder, alavanca — sempre as mesmas,
   * independente do mapa) mais as OBSERVADAS neste recorte (baú, placa, teleporte). Ausente
   * quando `options.sceneryIndex` não foi passado.
   */
  readonly sceneryAppearances?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Acumula os tiles por coordenada; o último vence. Devolve também quantas vezes venceu. */
export function collectTiles(tiles: Iterable<OtbmTile>): { tiles: Map<string, RegionTile>; conflicts: number; read: number } {
  const map = new Map<string, RegionTile>();
  let conflicts = 0;
  let read = 0;
  for (const tile of tiles) {
    read += 1;
    const k = key(tile.x, tile.y, tile.z);
    if (map.has(k)) conflicts += 1;
    map.set(k, { x: tile.x, y: tile.y, z: tile.z, ground: tile.ground, items: tile.items });
  }
  return { tiles: map, conflicts, read };
}

/** Um tile existe quando tem chão OU item. Fora disso é vazio — fora do mapa. */
const exists = (tile: RegionTile): boolean => tile.ground !== null || tile.items.length > 0;

/**
 * Bloqueado quando o chão ou qualquer item da pilha tem `unpass`. Tile sem chão e com item é
 * decidido pelos itens — o degrau de escada é assim. Id desconhecido não bloqueia, e é
 * reportado.
 *
 * Um cenário CLASSIFICADO (#727, ADR 0050 d.1) — pela tabela do Canary (`sceneryIndex`) ou por
 * `aid`/`uid`/`text` (baú, placa, teleporte) — é EXCLUÍDO deste cálculo: o tile de uma porta
 * comum fechada não vira mais `#` na grade, quem sabe se dá para pisar ali agora é o interativo
 * (o `TileOverrides` da #728), nunca a grade estática. Sem isto, uma porta trancada de Thais
 * seria `#` para sempre, e o bot nunca chegaria perto dela para o dia em que a #728 souber
 * destrancar.
 */
function blockedOf(
  tile: RegionTile, flagsOf: ImportOptions['flagsOf'], unknown: Set<number>, sceneryIndex?: SceneryIndex,
): boolean {
  let blocked = false;
  const consider = (id: number, item: OtbmItem | null): void => {
    const classified = item === null
      ? sceneryIndex?.classifyGround(id)
      : (sceneryIndex?.classifyItem(item) ?? classifyByAttributes(item));
    if (classified != null) return;
    const flags = flagsOf(id);
    if (flags === null) { unknown.add(id); return; }
    if (flags.unpass) blocked = true;
  };
  if (tile.ground !== null) consider(tile.ground, null);
  for (const item of tile.items) consider(item.id, item);
  return blocked;
}

/**
 * Bloqueia LINHA DE VISÃO (#553) quando o chão ou qualquer item da pilha tem `unsight` — a
 * flag do pacote 13.x que o TFS/Canary chamam de `CONST_PROP_BLOCKPROJECTILE`. Espelha
 * `blockedOf` (`unpass`), com a MESMA regra de id desconhecido: não bloqueia, e é reportado
 * pelo `unknown` compartilhado — o chamador já varre os mesmos ids uma vez para `blockedOf`.
 * Bloqueio de PASSO e bloqueio de VISTA são flags independentes: um tile pode ter uma sem a
 * outra, e por isso esta função nunca reaproveita o resultado de `blockedOf`.
 */
function blocksSightOf(tile: RegionTile, flagsOf: ImportOptions['flagsOf'], unknown: Set<number>): boolean {
  const ids = tile.ground === null ? [] : [tile.ground];
  for (const item of tile.items) ids.push(item.id);
  let blocksSight = false;
  for (const id of ids) {
    const flags = flagsOf(id);
    if (flags === null) { unknown.add(id); continue; }
    if (flags.unsight) blocksSight = true;
  }
  return blocksSight;
}

/** Componente andável (4 vizinhos) a partir do tile-semente, no andar dele. */
function walkableComponent(
  tiles: Map<string, RegionTile>, blocked: Map<string, boolean>, seed: { x: number; y: number; z: number },
): Set<string> {
  const seen = new Set<string>();
  // A semente pode cair numa parede — um centro de spawn, uma coordenada de wiki. Aceitamos o
  // andável mais próximo até três tiles, do mais perto para o mais longe, em ordem fixa.
  let origin: { x: number; y: number; z: number } | null = null;
  for (let radius = 0; radius <= 3 && origin === null; radius++) {
    for (let dy = -radius; dy <= radius && origin === null; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const k = key(seed.x + dx, seed.y + dy, seed.z);
        if (tiles.has(k) && blocked.get(k) !== true) { origin = { x: seed.x + dx, y: seed.y + dy, z: seed.z }; break; }
      }
    }
  }
  if (origin === null) {
    throw new Error(`--keep-from (${seed.x},${seed.y},${seed.z}) não tem tile andável a até 3 tiles`);
  }
  const start = key(origin.x, origin.y, origin.z);
  const queue = [origin];
  seen.add(start);
  while (queue.length > 0) {
    const at = queue.shift() as { x: number; y: number; z: number };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = { x: at.x + dx, y: at.y + dy, z: at.z };
      const k = key(next.x, next.y, next.z);
      if (seen.has(k) || !tiles.has(k) || blocked.get(k) === true) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return seen;
}

const PALETTE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const STAIR_NAME = /stair|ladder|ramp|hole|rope spot|trapdoor|sewer grate/i;

export function importRegion(source: Iterable<OtbmTile>, options: ImportOptions): ImportResult {
  const collected = collectTiles(source);
  const blocked = new Map<string, boolean>();
  const blocksSight = new Map<string, boolean>();
  let dropped = 0;
  for (const [k, tile] of collected.tiles) {
    if (!exists(tile)) { collected.tiles.delete(k); dropped += 1; continue; }
    blocked.set(k, blockedOf(tile, options.flagsOf, new Set(), options.sceneryIndex));
    blocksSight.set(k, blocksSightOf(tile, options.flagsOf, new Set()));
  }

  // Recorte à componente: fica a componente andável mais a borda de um tile (paredes, decoração).
  //
  // A componente é do ANDAR da semente — o importador não sabe onde as escadas levam, porque
  // `floorChanges` é autorado depois. Os outros andares ficam com o que cai na caixa que a
  // componente ocupa: é o teto e o subsolo do lugar recortado, e é o que o cliente desenha
  // embaixo do andar do jogador.
  let kept: Set<string> | null = null;
  if (options.keepFrom !== undefined) {
    const component = walkableComponent(collected.tiles, blocked, options.keepFrom);
    kept = new Set(component);
    for (const k of component) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) kept.add(key(x + dx, y + dy, z));
      }
    }
    const box = { x: [Infinity, -Infinity], y: [Infinity, -Infinity] };
    for (const k of kept) {
      const [x, y] = k.split(',').map(Number) as [number, number, number];
      box.x = [Math.min(box.x[0] as number, x), Math.max(box.x[1] as number, x)];
      box.y = [Math.min(box.y[0] as number, y), Math.max(box.y[1] as number, y)];
    }
    for (const [k, tile] of [...collected.tiles]) {
      const stays = tile.z === options.keepFrom.z
        ? kept.has(k)
        : tile.x >= (box.x[0] as number) && tile.x <= (box.x[1] as number)
          && tile.y >= (box.y[0] as number) && tile.y <= (box.y[1] as number);
      if (!stays) { collected.tiles.delete(k); dropped += 1; }
    }
  }

  // Os ids desconhecidos são os do que FICOU: um id de outra versão numa sala que o recorte
  // descartou não é problema do mapa escrito, e não deveria obrigar ninguém a --allow-unknown.
  const unknown = new Set<number>();
  for (const tile of collected.tiles.values()) blockedOf(tile, options.flagsOf, unknown, options.sceneryIndex);
  if (unknown.size > 0 && !options.allowUnknown) {
    throw new Error(
      `${unknown.size} ids do mapa não existem no pacote (${[...unknown].slice(0, 10).join(', ')}…); `
        + 'o recorte tem arte de outra versão — confira THINGS_VERSION, ou passe --allow-unknown',
    );
  }

  // A caixa final: a região pedida, ou a caixa dos tiles que ficaram depois do recorte.
  let region = options.region;
  if (kept !== null) {
    const xs = [...collected.tiles.values()].map((t) => t.x);
    const ys = [...collected.tiles.values()].map((t) => t.y);
    const zs = [...collected.tiles.values()].map((t) => t.z);
    region = {
      x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)],
      z: [Math.min(...zs), Math.max(...zs)],
    };
  }
  const width = region.x[1] - region.x[0] + 1;
  const height = region.y[1] - region.y[0] + 1;
  const floorsPresent = [...new Set([...collected.tiles.values()].map((t) => t.z))].sort((a, b) => a - b);
  if (floorsPresent.length === 0) throw new Error('a região não tem tile nenhum');

  // A paleta de velocidades: um caractere por valor distinto, em ordem crescente, para o
  // arquivo ser legível — `a` é sempre o chão mais rápido do mapa.
  const speeds = new Set<number>();
  const speedOf = (tile: RegionTile): number => {
    if (tile.ground === null) return DEFAULT_GROUND_SPEED;
    const waypoints = options.flagsOf(tile.ground)?.bankWaypoints;
    return waypoints === undefined || waypoints === 0 ? DEFAULT_GROUND_SPEED : waypoints;
  };
  for (const [k, tile] of collected.tiles) if (blocked.get(k) !== true) speeds.add(speedOf(tile));
  const speedList = [...speeds].sort((a, b) => a - b);
  if (speedList.length > PALETTE.length) throw new Error(`${speedList.length} velocidades de chão distintas — a paleta tem ${PALETTE.length}`);
  const speedPalette: Record<string, number> = {};
  const charOf = new Map<number, string>();
  speedList.forEach((speed, index) => {
    const char = PALETTE[index] as string;
    speedPalette[char] = speed;
    charOf.set(speed, char);
  });

  const floors: Record<string, { grid: string[]; speed: string[]; sight: string[] }> = {};
  const perFloor: Array<{ z: number; tiles: number; blocked: number; walkable: number }> = [];
  for (const z of floorsPresent) {
    const grid: string[] = [];
    const speedRows: string[] = [];
    const sightRows: string[] = [];
    let count = 0;
    let blockedCount = 0;
    for (let y = region.y[0]; y <= region.y[1]; y++) {
      let row = '';
      let speedRow = '';
      let sightRow = '';
      for (let x = region.x[0]; x <= region.x[1]; x++) {
        const k = key(x, y, z);
        const tile = collected.tiles.get(k);
        if (tile === undefined) { row += '#'; speedRow += ' '; sightRow += '#'; continue; }
        count += 1;
        // Bloqueio de visão (#553) é flag INDEPENDENTE do bloqueio de passo: um tile fora do
        // mapa desenhado (sem tile nenhum) bloqueia os dois — nada existe ali para ver através
        // —, mas dentro do mapa a grade `sight` segue `blocksSight`, nunca `blocked`.
        sightRow += blocksSight.get(k) === true ? '#' : '.';
        if (blocked.get(k) === true) { row += '#'; speedRow += ' '; blockedCount += 1; continue; }
        row += '.';
        speedRow += charOf.get(speedOf(tile)) ?? ' ';
      }
      grid.push(row);
      speedRows.push(speedRow);
      sightRows.push(sightRow);
    }
    floors[String(z)] = { grid, speed: speedRows, sight: sightRows };
    perFloor.push({ z, tiles: count, blocked: blockedCount, walkable: count - blockedCount });
  }

  const ids = new Set<number>();
  const stackTiles: Array<[number, number, number, number, Array<number | [number, number]>]> = [];
  const sortedTiles = [...collected.tiles.values()].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  const stairCandidates: Array<{ x: number; y: number; z: number; id: number; name?: string }> = [];
  const interactables: NonNullable<TilemapInput['interactables']> = [];
  // O que `appearances.scenery` ganha por OBSERVAÇÃO (baú, placa, teleporte) — as tabelas do
  // Canary já fecham porta/capim/pile/rope spot/ladder/alavanca dos dois lados, sem depender de
  // qual mapa foi importado; isto aqui só existe quando o OTBM carrega o id.
  const observedAppearances: Record<string, Record<string, number>> = {};
  for (const tile of sortedTiles) {
    if (tile.ground !== null) ids.add(tile.ground);
    for (const item of tile.items) ids.add(item.id);
    const items = tile.items.map((item) =>
      (item.count === undefined || item.count <= 1 ? item.id : [item.id, item.count] as [number, number]));
    stackTiles.push([tile.x - region.x[0], tile.y - region.y[0], tile.z, tile.ground ?? 0, items]);
    // Candidato a escada: tile andável sem chão (o item É o degrau), ou item cujo nome no
    // pacote diga escada — o segundo caso quase não acontece no 13.x, mas custa nada.
    const local = { x: tile.x - region.x[0], y: tile.y - region.y[0], z: tile.z };
    const walkable = blocked.get(key(tile.x, tile.y, tile.z)) !== true;
    if (walkable && tile.ground === null && tile.items[0] !== undefined) {
      const id = tile.items[0].id;
      const name = options.nameOf?.(id);
      stairCandidates.push(name === undefined ? { ...local, id } : { ...local, id, name });
    } else if (options.nameOf !== undefined) {
      for (const id of [tile.ground, ...tile.items.map((i) => i.id)]) {
        if (id === null) continue;
        const name = options.nameOf(id);
        if (name !== undefined && STAIR_NAME.test(name)) stairCandidates.push({ ...local, id, name });
      }
    }

    // Cenário usável (#727, ADR 0050 d.1): o chão classifica rope spot; cada item classifica por
    // tabela do Canary primeiro, e por `aid`/`uid`/`text` quando nenhuma tabela casa.
    const index = options.sceneryIndex;
    if (index !== undefined) {
      if (tile.ground !== null) {
        const feature = index.classifyGround(tile.ground);
        if (feature !== null) interactables.push(interactableOf(local, feature, null));
      }
      for (const item of tile.items) {
        const feature = index.classifyItem(item) ?? classifyByAttributes(item);
        if (feature === null) continue;
        interactables.push(interactableOf(local, feature, item));
        if (feature.kind === 'chest' || feature.kind === 'sign' || feature.kind === 'teleport') {
          observedAppearances[feature.appearanceKey] = { default: item.id };
        }
      }
    }
  }

  const defaultZ = options.defaultZ ?? options.entryPoint?.z ?? (floorsPresent[floorsPresent.length - 1] as number);
  if (!floorsPresent.includes(defaultZ)) throw new Error(`o andar padrão ${defaultZ} não tem tile nenhum na região`);
  const entry = options.entryPoint === undefined
    ? undefined
    : { x: options.entryPoint.x - region.x[0], y: options.entryPoint.y - region.y[0], z: options.entryPoint.z };
  if (entry !== undefined) {
    const k = key(options.entryPoint?.x ?? 0, options.entryPoint?.y ?? 0, entry.z);
    if (!collected.tiles.has(k) || blocked.get(k) === true) {
      throw new Error(`--entry (${options.entryPoint?.x},${options.entryPoint?.y},${entry.z}) não é um tile andável do recorte`);
    }
  }

  const sourceField = {
    file: options.source.file, sha256: options.source.sha256,
    region: { x: [region.x[0], region.x[1]] as [number, number], y: [region.y[0], region.y[1]] as [number, number], z: [region.z[0], region.z[1]] as [number, number] },
  };
  const content: TilemapInput = {
    id: options.id,
    z: defaultZ,
    floors,
    speedPalette,
    ...(entry === undefined ? {} : { entryPoint: entry }),
    floorChanges: [],
    interactables,
    source: sourceField,
  };
  tilemapSchema.parse(content);

  const interactablesByKind = new Map<string, number>();
  for (const interactable of interactables) {
    interactablesByKind.set(interactable.kind, (interactablesByKind.get(interactable.kind) ?? 0) + 1);
  }

  // Só as `appearanceKey` REALMENTE usadas por este mapa (#727) — nunca a tabela do Canary
  // inteira. `staticAppearances` tem centenas de portas que o Tibia inteiro usa; a maioria não
  // está nos quatro recortes do Draconya, e a maioria também não existe no INVENTÁRIO do pacote
  // (`packs/tibia-1332.json` é uma sombra de Thais/Rat Cellars/Rotworm Caves/Dragon Lair, não do
  // jogo inteiro — ADR 0025 d.9/FUN-21). Gerar a tabela toda faria `packProblems` reprovar ids
  // que nenhum mapa importado usa, e o boot cairia por causa de porta que não existe aqui.
  const usedAppearanceKeys = new Set(interactables.map((i) => i.appearanceKey));
  const sceneryAppearances: Record<string, Record<string, number>> = {};
  if (options.sceneryIndex !== undefined) {
    for (const key of usedAppearanceKeys) {
      const states = options.sceneryIndex.staticAppearances[key];
      if (states !== undefined) sceneryAppearances[key] = states;
    }
    Object.assign(sceneryAppearances, observedAppearances);
  }

  return {
    content,
    stack: { id: options.id, version: options.version, source: sourceField, width, height, floors: floorsPresent, tiles: stackTiles },
    report: {
      tilesRead: collected.read, conflicts: collected.conflicts, dropped, perFloor,
      distinctIds: ids.size, unknownIds: [...unknown].sort((a, b) => a - b),
      stairCandidates, region, interactablesByKind,
    },
    ...(options.sceneryIndex === undefined ? {} : { sceneryAppearances }),
  };
}

/**
 * Monta a entrada de `interactables[]` (#727, ADR 0050 d.1) a partir da classificação. `item` é
 * `null` para um interativo classificado pelo CHÃO (só rope spot) — chão não carrega `aid`/`uid`/
 * `text`/teleporte, então os campos opcionais ficam ausentes.
 */
function interactableOf(
  at: { x: number; y: number; z: number }, feature: ClassifiedFeature, item: OtbmItem | null,
): NonNullable<TilemapInput['interactables']>[number] {
  const requires = feature.requiresTool === undefined ? undefined : { tool: feature.requiresTool };
  return {
    at,
    kind: feature.kind,
    initialState: feature.initialState,
    appearanceKey: feature.appearanceKey,
    ...(item?.actionId === undefined ? {} : { aid: item.actionId }),
    ...(item?.uniqueId === undefined ? {} : { uid: item.uniqueId }),
    ...(item?.text === undefined ? {} : { text: item.text }),
    ...(requires === undefined ? {} : { requires }),
    ...(feature.revertMs === undefined ? {} : { revertMs: feature.revertMs }),
    ...(item?.teleportDestination === undefined ? {} : {
      target: { x: item.teleportDestination.x, y: item.teleportDestination.y, z: item.teleportDestination.z },
    }),
  };
}

/**
 * O JSON do mapa de conteúdo, com uma linha por linha da grade — é o que torna o diff legível
 * quando alguém autora uma escada ou muda a entrada.
 */
export function formatContentMap(map: TilemapInput): string {
  const lines: string[] = ['{', `  "id": ${JSON.stringify(map.id)},`, `  "z": ${map.z},`];
  if (map.entryPoint !== undefined) lines.push(`  "entryPoint": ${JSON.stringify(map.entryPoint)},`);
  lines.push(`  "floorChanges": ${JSON.stringify(map.floorChanges ?? [])},`);
  lines.push(`  "speedPalette": ${JSON.stringify(map.speedPalette ?? {})},`);
  lines.push('  "floors": {');
  const entries = Object.entries(map.floors ?? {});
  entries.forEach(([z, floor], index) => {
    lines.push(`    "${z}": {`);
    lines.push('      "grid": [');
    floor.grid.forEach((row, i) => lines.push(`        ${JSON.stringify(row)}${i === floor.grid.length - 1 ? '' : ','}`));
    const hasMore = floor.speed !== undefined || floor.sight !== undefined;
    lines.push(hasMore ? '      ],' : '      ]');
    if (floor.speed !== undefined) {
      const moreAfterSpeed = floor.sight !== undefined;
      lines.push('      "speed": [');
      floor.speed.forEach((row, i) => lines.push(`        ${JSON.stringify(row)}${i === floor.speed!.length - 1 ? '' : ','}`));
      lines.push(moreAfterSpeed ? '      ],' : '      ]');
    }
    if (floor.sight !== undefined) {
      lines.push('      "sight": [');
      floor.sight.forEach((row, i) => lines.push(`        ${JSON.stringify(row)}${i === floor.sight!.length - 1 ? '' : ','}`));
      lines.push('      ]');
    }
    lines.push(`    }${index === entries.length - 1 ? '' : ','}`);
  });
  lines.push('  },');
  // Cenário usável (#727, ADR 0050 d.1). Só entra quando há algo a dizer — mapa sem interativo
  // nenhum (Darashia Dragon Lair) não ganha uma linha vazia que ninguém pediu.
  if (map.interactables !== undefined && map.interactables.length > 0) {
    lines.push(`  "interactables": ${JSON.stringify(map.interactables)},`);
  }
  lines.push(`  "source": ${JSON.stringify(map.source)}`);
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** O JSON do cliente: um tile por linha, compacto — são dezenas de milhares. */
export function formatStackMap(stack: StackMap): string {
  const head = JSON.stringify({ id: stack.id, version: stack.version, source: stack.source, width: stack.width, height: stack.height, floors: stack.floors });
  const tiles = stack.tiles.map((tile) => JSON.stringify(tile));
  return `${head.slice(0, -1)},"tiles":[\n${tiles.join(',\n')}\n]}\n`;
}

/**
 * Só os nomes dos objetos, para o relatório de escadas. É a única leitura do campo 4 do
 * `appearances.dat` em todo o repositório — o leitor do cliente o pula de propósito.
 */
export function readObjectNames(bytes: Uint8Array): Map<number, string> {
  const names = new Map<number, string>();
  const decoder = new TextDecoder();
  const reader = new Reader(bytes);
  while (!reader.done) {
    const { field, wire } = reader.tag();
    if (field !== 1 || wire !== WIRE_LENGTH) { reader.skip(wire); continue; }
    const appearance = reader.slice();
    let id = 0;
    let name: string | undefined;
    while (!appearance.done) {
      const inner = appearance.tag();
      if (inner.field === 1 && inner.wire === WIRE_VARINT) { id = appearance.varint(); continue; }
      if (inner.field === 4 && inner.wire === WIRE_LENGTH) { name = decoder.decode(appearance.bytes()); continue; }
      appearance.skip(inner.wire);
    }
    if (id !== 0 && name !== undefined) names.set(id, name);
  }
  return names;
}

/** As tabelas do Canary transcritas como dado (#727, ADR 0050 d.1) — `data/scenery/canary-tables.json`. */
export function loadCanaryTables(path: string = SCENERY_TABLES_PATH): CanaryTables {
  return JSON.parse(readFileSync(path, 'utf8')) as CanaryTables;
}

/**
 * `appearances/generated/scenery.json` (#727, ADR 0050 d.1) — o formato de `appearancesSchema`,
 * só com a seção `scenery` preenchida. `id`/`pack` existem porque o schema os exige, mas nenhum
 * código lê o `pack` daqui: quem resolve `appearances.pack` continua sendo `baseline.json`
 * (`content.ts` mescla as duas tabelas pela CHAVE, não pelo `pack` declarado).
 */
export function formatGeneratedScenery(
  scenery: Readonly<Record<string, Readonly<Record<string, number>>>>, pack: string,
): string {
  return `${JSON.stringify({ id: 'scenery', pack, scenery }, null, 2)}\n`;
}

/** O pacote de arte em `things/<versão>/`: catálogo de aparências e nomes. */
export function loadPack(thingsDir: string, version: string): { catalogue: AppearanceCatalogue; names: Map<number, string> } {
  const packDir = join(thingsDir, version);
  const catalogPath = join(packDir, 'catalog-content.json');
  if (!existsSync(catalogPath)) throw new Error(`pacote ${version} não está em ${thingsDir}`);
  const catalog = readCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown);
  const bytes = readFileSync(join(packDir, catalog.appearancesFile));
  return { catalogue: readAppearances(bytes), names: readObjectNames(new Uint8Array(bytes)) };
}

export function flagsFrom(catalogue: AppearanceCatalogue): ImportOptions['flagsOf'] {
  return (id) => {
    const appearance = catalogue.object.get(id);
    if (appearance === undefined) return null;
    return appearance.flags ?? NO_FLAGS;
  };
}

/** `32275..32458` → `[32275, 32458]`; `8` → `[8, 8]`. */
export function parseRange(text: string): [number, number] {
  const [a, b] = text.split('..').map(Number);
  if (a === undefined || Number.isNaN(a) || (b !== undefined && Number.isNaN(b))) throw new Error(`faixa inválida: ${text}`);
  return [a, b ?? a];
}

export function parsePoint(text: string): { x: number; y: number; z: number } {
  const [x, y, z] = text.split(',').map(Number);
  if (x === undefined || y === undefined || z === undefined || [x, y, z].some(Number.isNaN)) throw new Error(`ponto inválido: ${text}`);
  return { x, y, z };
}

export interface CheckOutcome {
  readonly file: string;
  readonly status: 'fresh' | 'stale' | 'absent' | 'hand-made';
  readonly detail?: string;
}

/**
 * `--check`: para cada mapa versionado com `source`, regenera do OTBM e compara. Sem o OTBM na
 * máquina é `absent` (aviso, como o inventário do pacote); mapa autorado à mão é `hand-made`.
 * A pilha em `things/` não é comparada — ela não é versionada — só conferida presente.
 */
export function checkMaps(
  mapsDir: string, thingsDir: string, version: string, otbmDir: string,
  sceneryTablesPath: string = SCENERY_TABLES_PATH, generatedSceneryPath: string = GENERATED_SCENERY_PATH,
): CheckOutcome[] {
  const files = existsSync(mapsDir) ? readdirSync(mapsDir).filter((name) => name.endsWith('.json')).sort() : [];
  let pack: ReturnType<typeof loadPack> | null = null;
  // As mesmas tabelas do Canary que `pnpm map:import` usa (#727) — sem elas, `--check` compararia
  // `interactables` gerado contra `interactables` gerado sem classificação nenhuma, e todo mapa
  // com cenário sairia "desatualizado" para sempre.
  const sceneryIndex = existsSync(sceneryTablesPath) ? buildSceneryIndex(loadCanaryTables(sceneryTablesPath)) : undefined;
  const generatedScenery: Record<string, Record<string, number>> = existsSync(generatedSceneryPath)
    ? (JSON.parse(readFileSync(generatedSceneryPath, 'utf8')) as { scenery: Record<string, Record<string, number>> }).scenery
    : {};
  return files.map((file) => {
    const committed = tilemapSchema.parse(JSON.parse(readFileSync(join(mapsDir, file), 'utf8')));
    if (committed.source === undefined) return { file, status: 'hand-made' };
    const otbmPath = join(otbmDir, committed.source.file);
    if (!existsSync(otbmPath)) return { file, status: 'absent' };
    const bytes = new Uint8Array(readFileSync(otbmPath));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== committed.source.sha256) {
      return { file, status: 'stale', detail: `o OTBM mudou: sha256 ${committed.source.sha256.slice(0, 12)}… no arquivo, ${sha256.slice(0, 12)}… no disco` };
    }
    pack ??= loadPack(thingsDir, version);
    const region = committed.source.region;
    const entry = committed.entryPoint === undefined
      ? undefined
      : { x: committed.entryPoint.x + region.x[0], y: committed.entryPoint.y + region.y[0], z: committed.entryPoint.z ?? committed.z };
    const regenerated = importRegion(readOtbmTiles(bytes, region), {
      id: committed.id, region, flagsOf: flagsFrom(pack.catalogue),
      ...(entry === undefined ? {} : { entryPoint: entry }),
      defaultZ: committed.z, source: { file: committed.source.file, sha256 }, version, allowUnknown: true,
      ...(sceneryIndex === undefined ? {} : { sceneryIndex }),
    });
    const before = JSON.stringify({ floors: committed.floors, speedPalette: committed.speedPalette ?? {} });
    const after = JSON.stringify({ floors: regenerated.content.floors, speedPalette: regenerated.content.speedPalette ?? {} });
    if (before !== after) {
      return { file, status: 'stale', detail: 'a geometria regenerada difere da versionada — o recorte foi editado à mão, ou o pacote mudou' };
    }
    // Cenário (#727): a mesma ordenação nos dois lados — `interactables` não tem ordem
    // garantida por si só, só a ordem em que o OTBM entrega os tiles.
    const sortKey = (i: (typeof committed.interactables)[number]): string =>
      `${i.at.z}.${i.at.y}.${i.at.x}.${i.kind}`;
    const committedInteractables = JSON.stringify([...committed.interactables].sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
    const regeneratedInteractables = JSON.stringify([...regenerated.content.interactables ?? []].sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
    if (committedInteractables !== regeneratedInteractables) {
      return { file, status: 'stale', detail: 'os interativos (interactables) regenerados diferem dos versionados — rode pnpm map:import de novo' };
    }
    if (regenerated.sceneryAppearances !== undefined) {
      for (const [appearanceKey, states] of Object.entries(regenerated.sceneryAppearances)) {
        const committedStates = generatedScenery[appearanceKey];
        if (JSON.stringify(committedStates) !== JSON.stringify(states)) {
          return {
            file, status: 'stale',
            detail: `appearances/generated/scenery.json não tem "${appearanceKey}" com os estados regenerados — rode pnpm map:import de novo`,
          };
        }
      }
    }
    const stackPath = join(thingsDir, version, 'maps', `${committed.id}.json`);
    if (!existsSync(stackPath)) return { file, status: 'stale', detail: `${stackPath} não existe — rode pnpm map:import de novo` };
    return { file, status: 'fresh' };
  });
}

function usage(): string {
  return 'Usage: pnpm map:import --id <id> --x a..b --y a..b --z a..b [--entry x,y,z] [--keep-from x,y,z]'
    + ' [--default-z n] [--otbm <file>] [--things <dir>] [--version <n>] [--allow-unknown] | --check';
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: {
      id: { type: 'string' }, x: { type: 'string' }, y: { type: 'string' }, z: { type: 'string' },
      entry: { type: 'string' }, 'keep-from': { type: 'string' }, 'default-z': { type: 'string' },
      otbm: { type: 'string' }, things: { type: 'string' }, version: { type: 'string' },
      'allow-unknown': { type: 'boolean' }, check: { type: 'boolean' },
    },
    strict: true,
  });
  const thingsDir = resolve(ROOT, values.things ?? process.env.THINGS_DIR ?? 'things');
  const version = values.version ?? process.env.THINGS_VERSION ?? '1533';
  const otbmDir = join(thingsDir, 'maps');

  if (values.check) {
    const outcomes = checkMaps(MAPS_DIR, thingsDir, version, otbmDir);
    let stale = false;
    for (const outcome of outcomes) {
      if (outcome.status === 'fresh') console.log(`maps/${outcome.file}: confere com o OTBM`);
      else if (outcome.status === 'hand-made') console.log(`maps/${outcome.file}: autorado à mão, nada a conferir`);
      else if (outcome.status === 'absent') console.log(`maps/${outcome.file}: OTBM não está nesta máquina — pulado (rode pnpm map:fetch)`);
      else { stale = true; console.error(`maps/${outcome.file}: DESATUALIZADO — ${outcome.detail ?? ''}`); }
    }
    process.exit(stale ? 1 : 0);
  }

  if (values.id === undefined || values.x === undefined || values.y === undefined || values.z === undefined) {
    console.error(usage());
    process.exit(2);
  }
  const otbmFile = values.otbm ?? 'otservbr.otbm';
  const otbmPath = resolve(otbmDir, otbmFile);
  if (!existsSync(otbmPath)) {
    console.error(`${otbmPath} não existe — rode pnpm map:fetch`);
    process.exit(1);
  }
  const bytes = new Uint8Array(readFileSync(otbmPath));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const region: Region = { x: parseRange(values.x), y: parseRange(values.y), z: parseRange(values.z) };
  const pack = loadPack(thingsDir, version);
  // O cenário usável (#727, ADR 0050 d.1): sem `data/scenery/canary-tables.json` o mapa importa
  // como sempre importava — sem `interactables` nenhum — porque o arquivo é o que existe hoje
  // no repositório, não uma dependência externa que possa faltar.
  const sceneryIndex = existsSync(SCENERY_TABLES_PATH) ? buildSceneryIndex(loadCanaryTables()) : undefined;
  const started = performance.now();
  const result = importRegion(readOtbmTiles(bytes, region), {
    id: values.id, region, flagsOf: flagsFrom(pack.catalogue), nameOf: (id) => pack.names.get(id),
    ...(values.entry === undefined ? {} : { entryPoint: parsePoint(values.entry) }),
    ...(values['keep-from'] === undefined ? {} : { keepFrom: parsePoint(values['keep-from']) }),
    ...(values['default-z'] === undefined ? {} : { defaultZ: Number(values['default-z']) }),
    source: { file: otbmFile, sha256 }, version,
    ...(values['allow-unknown'] ? { allowUnknown: true } : {}),
    ...(sceneryIndex === undefined ? {} : { sceneryIndex }),
  });

  // Se o mapa já existe com escadas autoradas, elas são preservadas: o importador regenera a
  // geometria, nunca o que um humano escreveu por cima dela.
  const contentPath = join(MAPS_DIR, `${values.id}.json`);
  let content = result.content;
  if (existsSync(contentPath)) {
    const previous = tilemapSchema.safeParse(JSON.parse(readFileSync(contentPath, 'utf8')));
    if (previous.success && previous.data.floorChanges.length > 0) {
      content = { ...content, floorChanges: previous.data.floorChanges };
      console.log(`${previous.data.floorChanges.length} floorChanges preservadas de ${contentPath}`);
    }
  }
  mkdirSync(MAPS_DIR, { recursive: true });
  writeFileSync(contentPath, formatContentMap(content));
  const stackDir = join(thingsDir, version, 'maps');
  mkdirSync(stackDir, { recursive: true });
  const stackPath = join(stackDir, `${values.id}.json`);
  writeFileSync(stackPath, formatStackMap(result.stack));

  // `appearances/generated/scenery.json` (#727) é a UNIÃO de todos os mapas importados — cada
  // `pnpm map:import` MESCLA a própria contribuição na tabela do disco, em vez de sobrescrever a
  // dos outros três mapas. Chave repetida (a mesma porta em dois mapas) tem o mesmo par sempre,
  // porque a tabela do Canary é a mesma para os quatro; só diverge se o Canary mudar.
  let scenaryPath: string | undefined;
  if (result.sceneryAppearances !== undefined) {
    const previous = existsSync(GENERATED_SCENERY_PATH)
      ? (JSON.parse(readFileSync(GENERATED_SCENERY_PATH, 'utf8')) as { scenery: Record<string, Record<string, number>> }).scenery
      : {};
    const merged = { ...previous, ...result.sceneryAppearances };
    // O `pack` desta tabela é só documentação (nenhum código o lê — quem resolve
    // `appearances.pack` continua sendo `baseline.json`); ele acompanha o de lá, quando existe.
    const baselinePath = join(ROOT, 'packages', 'content', 'data', 'appearances', 'baseline.json');
    const baselinePack = existsSync(baselinePath)
      ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as { pack?: string }).pack
      : undefined;
    mkdirSync(dirname(GENERATED_SCENERY_PATH), { recursive: true });
    writeFileSync(GENERATED_SCENERY_PATH, formatGeneratedScenery(merged, baselinePack ?? `tibia-${version}`));
    scenaryPath = GENERATED_SCENERY_PATH;
  }

  const { report } = result;
  console.log(`importado "${values.id}" em ${Math.round(performance.now() - started)} ms`);
  console.log(`  região: x ${report.region.x[0]}..${report.region.x[1]}, y ${report.region.y[0]}..${report.region.y[1]}, z ${report.region.z[0]}..${report.region.z[1]} (${result.stack.width}×${result.stack.height})`);
  console.log(`  tiles lidos: ${report.tilesRead}; conflitos (último venceu): ${report.conflicts}; descartados: ${report.dropped}`);
  for (const floor of report.perFloor) console.log(`  z${floor.z}: ${floor.tiles} tiles, ${floor.walkable} andáveis, ${floor.blocked} bloqueados`);
  console.log(`  aparências distintas: ${report.distinctIds}; desconhecidas no pacote: ${report.unknownIds.length}${report.unknownIds.length > 0 ? ` (${report.unknownIds.slice(0, 20).join(', ')})` : ''}`);
  console.log(`  candidatos a escada (autorar em floorChanges): ${report.stairCandidates.length}`);
  for (const candidate of report.stairCandidates.slice(0, 80)) {
    console.log(`    (${candidate.x},${candidate.y},${candidate.z}) ${candidate.id}${candidate.name === undefined ? '' : ` ${candidate.name}`}`);
  }
  if (report.interactablesByKind.size > 0) {
    const summary = [...report.interactablesByKind].map(([kind, n]) => `${kind}: ${n}`).join(', ');
    console.log(`  interativos (#727): ${summary}`);
  }
  console.log(`  escrito: ${contentPath}`);
  console.log(`  escrito: ${stackPath}`);
  if (scenaryPath !== undefined) console.log(`  escrito: ${scenaryPath}`);
}
