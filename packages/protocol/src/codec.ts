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
  CLIENTE_PARA_SERVIDOR, OPCODE_PARA_NOME_C2S, OPCODE_PARA_NOME_S2C, SERVIDOR_PARA_CLIENTE,
} from './mensagens.js';
import { ESQUEMAS_C2S, ESQUEMAS_S2C } from './tipos.js';
import type { MensagemC2S, MensagemS2C } from './tipos.js';

const SEMENTE = 0x4853_5254;
const FLAG_COMPRIMIDO = 1;
const FLAG_LOTE = 2;
/** Abaixo disso, deflate gasta CPU e costuma aumentar o tamanho. */
const LIMIAR_DE_COMPRESSAO = 8 * 1024;

const codificadorDeTexto = new TextEncoder();
const decodificadorDeTexto = new TextDecoder();

/** XOR com xorshift32; é involução, então serve para embaralhar e desembaralhar. */
function embaralhar(buf: Uint8Array, chave: number): void {
  let r = (chave ^ SEMENTE) >>> 0;
  if (r === 0) r = SEMENTE;
  for (let i = 0; i < buf.length; i++) {
    if ((i & 3) === 0) {
      r ^= r << 13; r >>>= 0;
      r ^= r >>> 17;
      r ^= r << 5;  r >>>= 0;
    }
    buf[i] = (buf[i] as number) ^ ((r >>> ((i & 3) << 3)) & 255);
  }
}

function montarFrame(opcode: number, props: unknown, permitirCompressao: boolean): Uint8Array {
  let corpo = codificadorDeTexto.encode(JSON.stringify([opcode, props]));
  let flags = 0;
  if (permitirCompressao && corpo.length >= LIMIAR_DE_COMPRESSAO) {
    corpo = deflateSync(corpo, { level: 3 });
    flags |= FLAG_COMPRIMIDO;
  }
  const chave = (Math.random() * 0x1_0000_0000) >>> 0;
  const frame = new Uint8Array(5 + corpo.length);
  frame[0] = chave & 255;
  frame[1] = (chave >>> 8) & 255;
  frame[2] = (chave >>> 16) & 255;
  frame[3] = (chave >>> 24) & 255;
  frame[4] = flags;
  frame.set(corpo, 5);
  embaralhar(frame.subarray(4), chave);
  return frame;
}

function abrirFrame(entrada: ArrayBuffer | Uint8Array): { flags: number; corpo: Uint8Array } | null {
  const bytes = entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
  if (bytes.length < 5) return null;
  const chave =
    ((bytes[0] as number) | ((bytes[1] as number) << 8) |
     ((bytes[2] as number) << 16) | ((bytes[3] as number) << 24)) >>> 0;
  const restante = new Uint8Array(bytes.subarray(4));
  embaralhar(restante, chave);
  return { flags: restante[0] as number, corpo: restante.subarray(1) };
}

/** Divide o corpo de um lote: [tamanho uint32 LE][frame]... */
function dividirLote(corpo: Uint8Array): Uint8Array[] | null {
  const frames: Uint8Array[] = [];
  let i = 0;
  while (i < corpo.length) {
    if (i + 4 > corpo.length) return null;
    const tamanho =
      ((corpo[i] as number) | ((corpo[i + 1] as number) << 8) |
       ((corpo[i + 2] as number) << 16) | ((corpo[i + 3] as number) << 24)) >>> 0;
    i += 4;
    if (i + tamanho > corpo.length) return null;
    frames.push(corpo.subarray(i, i + tamanho));
    i += tamanho;
  }
  return frames;
}

function lerUm<M>(
  entrada: ArrayBuffer | Uint8Array,
  tabela: ReadonlyMap<number, string>,
  esquemas: Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }>,
): M | null {
  const aberto = abrirFrame(entrada);
  if (!aberto) return null;
  if ((aberto.flags & ~FLAG_COMPRIMIDO) !== 0) return null;

  let corpo = aberto.corpo;
  if ((aberto.flags & FLAG_COMPRIMIDO) !== 0) {
    try { corpo = inflateSync(corpo); } catch { return null; }
  }

  let cru: unknown;
  try { cru = JSON.parse(decodificadorDeTexto.decode(corpo)); } catch { return null; }
  if (!Array.isArray(cru) || cru.length !== 2) return null;

  const [opcode, props] = cru as [unknown, unknown];
  if (typeof opcode !== 'number') return null;
  const nome = tabela.get(opcode);
  if (nome === undefined) return null;

  const esquema = esquemas[nome];
  if (!esquema) return null;
  const validado = esquema.safeParse(props);
  if (!validado.success) return null;

  return { ...(validado.data as object), type: nome } as M;
}

function lerFrame<M>(
  entrada: ArrayBuffer | Uint8Array,
  tabela: ReadonlyMap<number, string>,
  esquemas: Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }>,
): M[] | null {
  const aberto = abrirFrame(entrada);
  if (!aberto) return null;

  if ((aberto.flags & FLAG_LOTE) === 0) {
    const uma = lerUm<M>(entrada, tabela, esquemas);
    return uma ? [uma] : null;
  }
  if (aberto.flags !== FLAG_LOTE) return null;

  const partes = dividirLote(aberto.corpo);
  if (!partes) return null;
  const mensagens: M[] = [];
  for (const parte of partes) {
    const uma = lerUm<M>(parte, tabela, esquemas);
    if (uma) mensagens.push(uma);
  }
  return mensagens;
}

// --- API pública -----------------------------------------------------------------------

export function codificarC2S(msg: MensagemC2S): Uint8Array {
  const { type, ...props } = msg;
  return montarFrame(CLIENTE_PARA_SERVIDOR[type], props, true);
}

export function codificarS2C(msg: MensagemS2C): Uint8Array {
  const { type, ...props } = msg;
  return montarFrame(SERVIDOR_PARA_CLIENTE[type], props, true);
}

/** Lê o que o servidor recebe. Devolve null — nunca lança — para entrada inválida. */
export function decodificarC2S(entrada: ArrayBuffer | Uint8Array): MensagemC2S[] | null {
  return lerFrame<MensagemC2S>(entrada, OPCODE_PARA_NOME_C2S, ESQUEMAS_C2S);
}

/** Lê o que o cliente recebe. */
export function decodificarS2C(entrada: ArrayBuffer | Uint8Array): MensagemS2C[] | null {
  return lerFrame<MensagemS2C>(entrada, OPCODE_PARA_NOME_S2C, ESQUEMAS_S2C);
}

/**
 * Empacota vários frames num só. É o que sustenta a projeção de 0,5–1,5 KB/s por jogador:
 * o `game` acumula a saída de um tick e manda um frame, não um `send` por evento.
 */
export function empacotarLote(frames: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const f of frames) total += 4 + f.length;
  const corpo = new Uint8Array(total);
  let i = 0;
  for (const f of frames) {
    corpo[i] = f.length & 255;
    corpo[i + 1] = (f.length >>> 8) & 255;
    corpo[i + 2] = (f.length >>> 16) & 255;
    corpo[i + 3] = (f.length >>> 24) & 255;
    i += 4;
    corpo.set(f, i);
    i += f.length;
  }
  const chave = (Math.random() * 0x1_0000_0000) >>> 0;
  const frame = new Uint8Array(5 + corpo.length);
  frame[0] = chave & 255;
  frame[1] = (chave >>> 8) & 255;
  frame[2] = (chave >>> 16) & 255;
  frame[3] = (chave >>> 24) & 255;
  frame[4] = FLAG_LOTE;
  frame.set(corpo, 5);
  embaralhar(frame.subarray(4), chave);
  return frame;
}
