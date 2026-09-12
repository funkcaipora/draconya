// Leitor de OTBM — o formato de mapa do Remere's Map Editor e dos servidores OpenTibia
// (FUN-118, ADR 0025). PURO: entra `Uint8Array`, saem tiles; quem lê disco é `import-map.ts`.
//
// O formato foi lido de documentação pública (OTMapGen, MIT) e conferido contra o
// `otservbr.otbm` real do Canary v3.6.1 — nenhum código GPL foi copiado (ADR 0019). O que
// interessa aqui cabe numa gramática curta:
//
//   arquivo   := 00 00 00 00 nó(raiz)
//   nó        := FE tipo payload nó* FF          (FD escapa o byte seguinte, em qualquer lugar)
//   raiz      := u32 versão, u16 largura, u16 altura, u32 major, u32 minor
//   map data  := atributos (u8 tipo, u16 tamanho, bytes)… — descrição e arquivos externos
//   tile area := u16 x, u16 y, u8 z            — a base; cada tile filho é um offset de 0–255
//   tile      := u8 dx, u8 dy, atributos*      (house tile: + u32 houseId antes dos atributos)
//   item      := u16 id, atributos*, item*     (container tem itens filhos)
//
// Os atributos de tile e item NÃO têm tamanho genérico: cada tipo diz o seu. É por isso que um
// atributo desconhecido ali é fatal — não há como saber quantos bytes pular — enquanto em map
// data (que traz `u16 tamanho`) é só pular. E os ids de item são os de CLIENTE: o Canary
// extinguiu o `items.otb` (PR #204), então o número gravado é o do `appearances.dat`.
//
// O leitor é ITERATIVO, com uma pilha explícita: o arquivo real tem 1,2 milhão de tile areas e
// dezenas de milhões de tiles, e um parser recursivo que aloca um objeto por nó estoura a pilha
// ou o coletor. Só os tiles dentro da região pedida viram objeto; o resto é atravessado byte a
// byte sem alocar nada.

const NODE_START = 0xfe;
const NODE_END = 0xff;
const ESCAPE = 0xfd;

/** Tipos de nó, pelos números do formato. */
export const NODE = {
  root: 0x00,
  mapData: 0x02,
  tileArea: 0x04,
  tile: 0x05,
  item: 0x06,
  towns: 0x0c,
  town: 0x0d,
  houseTile: 0x0e,
  waypoints: 0x0f,
  waypoint: 0x10,
} as const;

/** Atributos de tile e item, com o tamanho FIXO de cada um em bytes; string é `u16 tamanho`. */
const ATTRIBUTE_SIZE: Readonly<Record<number, number | 'string'>> = {
  0x01: 'string', // description
  0x02: 'string', // ext file
  0x03: 4, // tile flags (u32 bitmask: protection zone, no-pvp, no-logout, pvp zone)
  0x04: 2, // action id
  0x05: 2, // unique id
  0x06: 'string', // text
  0x07: 'string', // desc
  0x08: 5, // teleport destination (u16 x, u16 y, u8 z)
  0x09: 2, // ITEM — o chão, embutido no tile
  0x0a: 2, // depot id
  0x0b: 'string', // ext spawn file
  0x0c: 1, // rune charges (u8; o de 2 bytes é 0x16, "charges" — são atributos diferentes)
  0x0d: 'string', // ext house file
  0x0e: 1, // house door id
  0x0f: 1, // COUNT
  0x10: 4, // duration
  0x11: 1, // decaying state
  0x12: 4, // written date
  0x13: 'string', // written by
  0x14: 4, // sleeper guid
  0x15: 4, // sleep start
  0x16: 2, // charges
};

const ATTR_TILE_FLAGS = 0x03;
const ATTR_ITEM = 0x09;
const ATTR_COUNT = 0x0f;

export interface OtbmHeader {
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly itemsMajorVersion: number;
  readonly itemsMinorVersion: number;
}

export interface OtbmItem {
  readonly id: number;
  /** Só quando o item é empilhável e o arquivo gravou a contagem. */
  readonly count?: number;
}

export interface OtbmTile {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** `null` quando o tile não tem chão — acontece, e o tile continua existindo (ADR 0025). */
  readonly ground: number | null;
  /** Na ordem do arquivo, do mais antigo (base) ao mais recente (topo). Containers achatam. */
  readonly items: readonly OtbmItem[];
  readonly flags: number;
  readonly houseId?: number;
}

/** A região a recortar, em coordenadas do mapa, inclusiva nos dois lados. */
export interface Region {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  readonly z: readonly [number, number];
}

export class OtbmError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} (offset ${offset})`);
    this.name = 'OtbmError';
  }
}

/** Um cursor sobre bytes já DESESCAPADOS de um payload. */
class Payload {
  #at = 0;
  constructor(private readonly bytes: Uint8Array, private readonly offset: number) {}
  get done(): boolean { return this.#at >= this.bytes.length; }
  u8(): number {
    const value = this.bytes[this.#at];
    if (value === undefined) throw new OtbmError('payload truncado', this.offset);
    this.#at += 1;
    return value;
  }
  u16(): number { return this.u8() | (this.u8() << 8); }
  u32(): number { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(count: number): void {
    if (this.#at + count > this.bytes.length) throw new OtbmError('payload truncado', this.offset);
    this.#at += count;
  }
}

/**
 * Lê o payload de um nó a partir de `at` (logo depois do byte de tipo): os bytes até o primeiro
 * `FE`/`FF` não escapado, já desescapados. Devolve também onde o payload acabou.
 */
function readPayload(bytes: Uint8Array, at: number): { payload: Payload; end: number } {
  const out: number[] = [];
  let i = at;
  while (i < bytes.length) {
    const byte = bytes[i] as number;
    if (byte === ESCAPE) {
      const next = bytes[i + 1];
      if (next === undefined) throw new OtbmError('escape no fim do arquivo', i);
      out.push(next);
      i += 2;
      continue;
    }
    if (byte === NODE_START || byte === NODE_END) break;
    out.push(byte);
    i += 1;
  }
  return { payload: new Payload(Uint8Array.from(out), at), end: i };
}

/** Consome os atributos de um tile ou item; devolve o que interessa e para no fim do payload. */
function readAttributes(payload: Payload, offset: number): { flags: number; ground: number | null; count?: number } {
  let flags = 0;
  let ground: number | null = null;
  let count: number | undefined;
  while (!payload.done) {
    const type = payload.u8();
    const size = ATTRIBUTE_SIZE[type];
    if (size === undefined) {
      throw new OtbmError(`atributo desconhecido 0x${type.toString(16)} em tile/item — sem tamanho, não dá para pular`, offset);
    }
    if (size === 'string') { payload.skip(payload.u16()); continue; }
    if (type === ATTR_TILE_FLAGS) { flags = payload.u32(); continue; }
    if (type === ATTR_ITEM) { ground = payload.u16(); continue; }
    if (type === ATTR_COUNT) { count = payload.u8(); continue; }
    payload.skip(size);
  }
  return count === undefined ? { flags, ground } : { flags, ground, count };
}

/** O cabeçalho do arquivo — o nó raiz. */
export function readOtbmHeader(bytes: Uint8Array): OtbmHeader {
  if (bytes.length < 6 || bytes[0] !== 0 || bytes[1] !== 0 || bytes[2] !== 0 || bytes[3] !== 0
    || bytes[4] !== NODE_START || bytes[5] !== NODE.root) {
    throw new OtbmError('não é um OTBM: cabeçalho esperado é 00 00 00 00 FE 00', 0);
  }
  const { payload } = readPayload(bytes, 6);
  return {
    version: payload.u32(),
    width: payload.u16(),
    height: payload.u16(),
    itemsMajorVersion: payload.u32(),
    itemsMinorVersion: payload.u32(),
  };
}

/**
 * Pula um nó inteiro a partir do byte DEPOIS do seu `FE tipo` — respeitando escapes e nós
 * aninhados —, e devolve o índice do byte seguinte ao `FF` que o fecha.
 */
function skipNode(bytes: Uint8Array, at: number): number {
  let depth = 0;
  let i = at;
  while (i < bytes.length) {
    const byte = bytes[i] as number;
    if (byte === ESCAPE) { i += 2; continue; }
    if (byte === NODE_START) { depth += 1; i += 1; continue; }
    if (byte === NODE_END) {
      if (depth === 0) return i + 1;
      depth -= 1;
    }
    i += 1;
  }
  throw new OtbmError('nó sem fechamento', at);
}

/** As frames da pilha de leitura: o que o nó aberto era, e o tile em montagem quando é um. */
interface Frame {
  readonly type: number;
  readonly tile: MutableTile | null;
}

interface MutableTile {
  x: number; y: number; z: number; ground: number | null; items: OtbmItem[]; flags: number;
  houseId?: number;
}

/**
 * Os tiles dentro da região, na ordem do arquivo.
 *
 * Um mesmo tile pode aparecer em mais de um tile area — o editor fecha e reabre o bloco ao
 * salvar —, e este leitor devolve TODOS: quem decide é o importador (ADR 0025: o último vence,
 * contando os conflitos). Aqui não há política, só leitura.
 */
export function* readOtbmTiles(bytes: Uint8Array, region: Region): Generator<OtbmTile> {
  readOtbmHeader(bytes);
  const stack: Frame[] = [];
  let base: { x: number; y: number; z: number } | null = null;
  let i = 4;
  while (i < bytes.length) {
    const byte = bytes[i] as number;
    if (byte === ESCAPE) { i += 2; continue; }
    if (byte === NODE_END) {
      const closed = stack.pop();
      if (closed === undefined) throw new OtbmError('FF sem nó aberto', i);
      if (closed.tile !== null) yield closed.tile;
      i += 1;
      continue;
    }
    if (byte !== NODE_START) { i += 1; continue; }

    const type = bytes[i + 1];
    if (type === undefined) throw new OtbmError('FE no fim do arquivo', i);
    const start = i + 2;

    if (type === NODE.tileArea) {
      const { payload, end } = readPayload(bytes, start);
      const x = payload.u16();
      const y = payload.u16();
      const z = payload.u8();
      const touches = z >= region.z[0] && z <= region.z[1]
        && x <= region.x[1] && x + 255 >= region.x[0]
        && y <= region.y[1] && y + 255 >= region.y[0];
      if (!touches) { i = skipNode(bytes, start); continue; }
      base = { x, y, z };
      stack.push({ type, tile: null });
      i = end;
      continue;
    }

    if (type === NODE.tile || type === NODE.houseTile) {
      if (base === null) throw new OtbmError('tile fora de um tile area', i);
      const { payload, end } = readPayload(bytes, start);
      const x = base.x + payload.u8();
      const y = base.y + payload.u8();
      const z = base.z;
      const inside = x >= region.x[0] && x <= region.x[1] && y >= region.y[0] && y <= region.y[1];
      if (!inside) { i = skipNode(bytes, start); continue; }
      const houseId = type === NODE.houseTile ? payload.u32() : undefined;
      const attributes = readAttributes(payload, start);
      const tile: MutableTile = { x, y, z, ground: attributes.ground, items: [], flags: attributes.flags };
      if (houseId !== undefined) tile.houseId = houseId;
      stack.push({ type, tile });
      i = end;
      continue;
    }

    if (type === NODE.item) {
      const owner = stack.find((frame) => frame.tile !== null)?.tile ?? null;
      const { payload, end } = readPayload(bytes, start);
      const id = payload.u16();
      const attributes = readAttributes(payload, start);
      // Item dentro de item (container) achata na pilha do tile: para desenhar e bloquear, o
      // que importa é o item de fora; o de dentro não existe no mapa. Guardamos só o de fora.
      const parent = stack[stack.length - 1];
      if (owner !== null && parent !== undefined && parent.tile !== null) {
        owner.items.push(attributes.count === undefined ? { id } : { id, count: attributes.count });
      }
      stack.push({ type, tile: null });
      i = end;
      continue;
    }

    // Raiz, map data, towns, waypoints: o payload não interessa; os filhos podem.
    const { end } = readPayload(bytes, start);
    stack.push({ type, tile: null });
    i = end;
  }
  if (stack.length > 0) throw new OtbmError('arquivo terminou com nó aberto', i);
}

/** Codifica bytes com o escape do formato — para fixture e para quem for escrever OTBM. */
export function escapeOtbm(bytes: Iterable<number>): number[] {
  const out: number[] = [];
  for (const byte of bytes) {
    if (byte === ESCAPE || byte === NODE_START || byte === NODE_END) out.push(ESCAPE);
    out.push(byte);
  }
  return out;
}

/** Um nó, para fixture: `FE tipo payload(escapado) filhos FF`. */
export function otbmNode(type: number, payload: Iterable<number>, children: readonly number[][] = []): number[] {
  return [NODE_START, type, ...escapeOtbm(payload), ...children.flat(), NODE_END];
}

export const u8 = (value: number): number[] => [value & 0xff];
export const u16 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
export const u32 = (value: number): number[] => [...u16(value & 0xffff), ...u16(value >>> 16)];
