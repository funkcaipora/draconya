// Anexa o ticket do líder à hunt da party de dragões (#527) — o que faltava para
// `pnpm dev:dragon-party --start` de fato criar a sessão no `game`, e não só emitir tickets que
// ninguém usa.
//
// Fala o PROTOCOLO, como o cliente de carga (`load/session.ts`, FUN-45): abre o WebSocket com a
// `wsUrl` que `/api/party/:id/start` devolveu, manda `session-attach` e espera o
// `session-state` — a MESMA sequência que `net/connection.ts` do cliente faz ao reanexar. A
// diferença para o cliente de carga é o propósito: aqui o objetivo não é medir nada, é só criar
// a sessão e confirmar que ela é uma hunt antes de soltar o socket — a hunt continua rodando no
// servidor sem ninguém olhando (idle-first, ADR 0027), e quem quiser acompanhar abre o navegador
// como o líder depois.

import { decodeS2C, encodeC2S } from '@draconya/protocol';
import type { S2CMessage } from '@draconya/protocol';

/** O pedaço do WebSocket que isto usa — estreito de propósito, como `SocketLike` do cliente. */
export interface AttachSocketLike {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: Uint8Array): void;
  close(): void;
}

export interface AttachPartyTicketOptions {
  /** Quanto esperar pelo primeiro `session-state` antes de desistir. Padrão: 10 s. */
  readonly timeoutMs?: number;
  /** Injetável para teste — o padrão é o `WebSocket` global do Node 24. */
  readonly openSocket?: (url: string) => AttachSocketLike;
}

export interface AttachedSession {
  /** `sessionType` do `session-state` recebido — confirma que a sessão é mesmo `'hunt'`. */
  readonly sessionType: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Abre o socket, anexa e espera o primeiro `session-state` — nunca `pong` nem qualquer outra
 * mensagem, porque é o `session-state` que confirma que a sessão existe e que tipo ela é. Fecha
 * o socket sozinho ao resolver ou falhar: não é modo `--attach` do jogador, é só o empurrão que
 * falta para `game` criar a hunt (`SessionHost#prepare`, o primeiro ticket cria a sessão com os
 * N membros — ver `packages/server/src/game/host.ts`).
 *
 * Rejeita se o `session-state` não chegar dentro do prazo, se o socket falhar antes de abrir, ou
 * se fechar sem nunca ter recebido nada — os três jeitos de "não deu para confirmar".
 */
export function attachPartyTicket(
  wsUrl: string,
  options: AttachPartyTicketOptions = {},
): Promise<AttachedSession> {
  const openSocket = options.openSocket
    ?? ((url: string) => new WebSocket(url) as unknown as AttachSocketLike);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<AttachedSession>((resolve, reject) => {
    const socket = openSocket(wsUrl);
    socket.binaryType = 'arraybuffer';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(
        `dragon-party: sem session-state em ${timeoutMs} ms (ticket vencido, ou o \`game\` não respondeu)`,
      )));
    }, timeoutMs);

    socket.onopen = () => {
      socket.send(encodeC2S({ type: 'session-attach' }));
    };

    socket.onmessage = (event) => {
      const data = event.data;
      if (!(data instanceof ArrayBuffer)) return;
      const decoded = decodeS2C(new Uint8Array(data));
      if (decoded === null) return;
      const state = decoded.find((message: S2CMessage) => message.type === 'session-state');
      if (state === undefined || state.type !== 'session-state') return;
      finish(() => resolve({ sessionType: state.sessionType }));
    };

    socket.onerror = (event) => {
      finish(() => reject(new Error(`dragon-party: erro no socket de anexação: ${String(event)}`)));
    };

    socket.onclose = () => {
      finish(() => reject(new Error(
        'dragon-party: o socket fechou antes do session-state (ticket recusado, ou o nó recusou a party — '
          + 'veja o log do `game`)',
      )));
    };
  });
}
