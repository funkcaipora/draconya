// Codec de frame binário.
//
//   frame := [ chave uint32 LE ][ flags uint8 ][ corpo ]
//   flags:  bit 0 = corpo comprimido (deflate)   bit 1 = lote
//   corpo := JSON([ opcode, props ])
//
// Tudo a partir do byte 4 passa por um xorshift keyed na chave aleatória do próprio frame.
// Isto é OFUSCAÇÃO, não criptografia: atrapalha ferramenta genérica de sniffing e não é, em
// nenhuma hipótese, controle de segurança. A autoridade continua sendo o servidor.

import { deflateSync, inflateSync } from 'fflate';
import {
  CLIENT_TO_SERVER, OPCODE_TO_NAME_C2S, OPCODE_TO_NAME_S2C, SERVER_TO_CLIENT,
} from './messages.js';
import { C2S_SCHEMAS, S2C_SCHEMAS } from './types.js';
import type { C2SMessage, S2CMessage } from './types.js';

const SEED = 0x4853_5254;
const COMPRESSED_FLAG = 1;
const BATCH_FLAG = 2;
/** Abaixo disso, deflate gasta CPU e costuma aumentar o tamanho. */
const COMPRESSION_THRESHOLD = 8 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** XOR com xorshift32; é involução, então serve para embaralhar e desembaralhar. */
function scramble(buf: Uint8Array, key: number): void {
  let r = (key ^ SEED) >>> 0;
  if (r === 0) r = SEED;
  for (let i = 0; i < buf.length; i++) {
    if ((i & 3) === 0) {
      r ^= r << 13; r >>>= 0;
      r ^= r >>> 17;
      r ^= r << 5;  r >>>= 0;
    }
    buf[i] = (buf[i] as number) ^ ((r >>> ((i & 3) << 3)) & 255);
  }
}

/**
 * Um frame é sempre `Uint8Array<ArrayBuffer>` — nasce de `new Uint8Array(n)`, nunca de uma
 * view sobre `SharedArrayBuffer`. Dizer isso no tipo é o que deixa o frame ir direto para
 * `WebSocket.send`, cujo `BufferSource` passou a exigir um `ArrayBuffer` de verdade
 * (TypeScript 6). O tipo só descreve o que já era; nenhum byte muda.
 */
type Frame = Uint8Array<ArrayBuffer>;

function buildFrame(opcode: number, props: unknown, allowCompression: boolean): Frame {
  let body = textEncoder.encode(JSON.stringify([opcode, props]));
  let flags = 0;
  if (allowCompression && body.length >= COMPRESSION_THRESHOLD) {
    body = deflateSync(body, { level: 3 });
    flags |= COMPRESSED_FLAG;
  }
  const key = (Math.random() * 0x1_0000_0000) >>> 0;
  const frame = new Uint8Array(5 + body.length);
  frame[0] = key & 255;
  frame[1] = (key >>> 8) & 255;
  frame[2] = (key >>> 16) & 255;
  frame[3] = (key >>> 24) & 255;
  frame[4] = flags;
  frame.set(body, 5);
  scramble(frame.subarray(4), key);
  return frame;
}

function openFrame(input: ArrayBuffer | Uint8Array): { flags: number; body: Uint8Array } | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 5) return null;
  const key =
    ((bytes[0] as number) | ((bytes[1] as number) << 8) |
     ((bytes[2] as number) << 16) | ((bytes[3] as number) << 24)) >>> 0;
  const remainder = new Uint8Array(bytes.subarray(4));
  scramble(remainder, key);
  return { flags: remainder[0] as number, body: remainder.subarray(1) };
}

/** Divide o corpo de um lote: [tamanho uint32 LE][frame]... */
function splitBatch(body: Uint8Array): Uint8Array[] | null {
  const frames: Uint8Array[] = [];
  let i = 0;
  while (i < body.length) {
    if (i + 4 > body.length) return null;
    const size =
      ((body[i] as number) | ((body[i + 1] as number) << 8) |
       ((body[i + 2] as number) << 16) | ((body[i + 3] as number) << 24)) >>> 0;
    i += 4;
    if (i + size > body.length) return null;
    frames.push(body.subarray(i, i + size));
    i += size;
  }
  return frames;
}

function readMessage<M>(
  input: ArrayBuffer | Uint8Array,
  table: ReadonlyMap<number, string>,
  schemas: Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }>,
): M | null {
  const opened = openFrame(input);
  if (!opened) return null;
  if ((opened.flags & ~COMPRESSED_FLAG) !== 0) return null;

  let body = opened.body;
  if ((opened.flags & COMPRESSED_FLAG) !== 0) {
    try { body = inflateSync(body); } catch { return null; }
  }

  let raw: unknown;
  try { raw = JSON.parse(textDecoder.decode(body)); } catch { return null; }
  if (!Array.isArray(raw) || raw.length !== 2) return null;

  const [opcode, props] = raw as [unknown, unknown];
  if (typeof opcode !== 'number') return null;
  const name = table.get(opcode);
  if (name === undefined) return null;

  const schema = schemas[name];
  if (!schema) return null;
  const validated = schema.safeParse(props);
  if (!validated.success) return null;

  return { ...(validated.data as object), type: name } as M;
}

function readFrame<M>(
  input: ArrayBuffer | Uint8Array,
  table: ReadonlyMap<number, string>,
  schemas: Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }>,
): M[] | null {
  const opened = openFrame(input);
  if (!opened) return null;

  if ((opened.flags & BATCH_FLAG) === 0) {
    const one = readMessage<M>(input, table, schemas);
    return one ? [one] : null;
  }
  if (opened.flags !== BATCH_FLAG) return null;

  const parts = splitBatch(opened.body);
  if (!parts) return null;
  const messages: M[] = [];
  for (const part of parts) {
    const one = readMessage<M>(part, table, schemas);
    if (one) messages.push(one);
  }
  return messages;
}

// --- API pública -----------------------------------------------------------------------

export function encodeC2S(msg: C2SMessage): Frame {
  const { type, ...props } = msg;
  return buildFrame(CLIENT_TO_SERVER[type], props, true);
}

export function encodeS2C(msg: S2CMessage): Frame {
  const { type, ...props } = msg;
  return buildFrame(SERVER_TO_CLIENT[type], props, true);
}

/** Lê o que o servidor recebe. Devolve null — nunca lança — para entrada inválida. */
export function decodeC2S(input: ArrayBuffer | Uint8Array): C2SMessage[] | null {
  return readFrame<C2SMessage>(input, OPCODE_TO_NAME_C2S, C2S_SCHEMAS);
}

/** Lê o que o cliente recebe. */
export function decodeS2C(input: ArrayBuffer | Uint8Array): S2CMessage[] | null {
  return readFrame<S2CMessage>(input, OPCODE_TO_NAME_S2C, S2C_SCHEMAS);
}

/**
 * Empacota vários frames num só. É o que sustenta a projeção de 0,5–1,5 KB/s por jogador:
 * o `game` acumula a saída de um tick e manda um frame, não um `send` por evento.
 */
export function packBatch(frames: readonly Uint8Array[]): Frame {
  let total = 0;
  for (const f of frames) total += 4 + f.length;
  const body = new Uint8Array(total);
  let i = 0;
  for (const f of frames) {
    body[i] = f.length & 255;
    body[i + 1] = (f.length >>> 8) & 255;
    body[i + 2] = (f.length >>> 16) & 255;
    body[i + 3] = (f.length >>> 24) & 255;
    i += 4;
    body.set(f, i);
    i += f.length;
  }
  const key = (Math.random() * 0x1_0000_0000) >>> 0;
  const frame = new Uint8Array(5 + body.length);
  frame[0] = key & 255;
  frame[1] = (key >>> 8) & 255;
  frame[2] = (key >>> 16) & 255;
  frame[3] = (key >>> 24) & 255;
  frame[4] = BATCH_FLAG;
  frame.set(body, 5);
  scramble(frame.subarray(4), key);
  return frame;
}
