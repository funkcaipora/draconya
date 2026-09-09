// Uma sessão sintética: HTTP para entrar, WebSocket para jogar (FUN-45).
//
// **Fala o PROTOCOLO, não o DOM.** Sem navegador headless: não dá para subir cinco mil
// Chromes, e mesmo que desse não é isso que se quer medir — o que interessa é o custo do
// servidor, e um navegador por sessão mediria o custo do navegador.
//
// Dois modos, e o segundo é o que valida a arquitetura:
//
//   anexado     mantém o socket, recebe deltas, mede bytes e latência
//   desanexado  entra na hunt, FECHA o socket, e some — a simulação continua sem ninguém
//
// O modo desanexado é o modo PADRÃO do jogo, não um caso extremo: é a hunt AFK.

import { randomUUID } from 'node:crypto';
import { decodeS2C, encodeC2S } from '@draconya/protocol';

export type LoadMode = 'attached' | 'detached';

export interface SessionOptions {
  readonly apiUrl: string;
  readonly mode: LoadMode;
  readonly huntId: string;
  readonly difficulty: string;
  /** Intervalo entre pings, em ms. Zero desliga — só o modo anexado usa. */
  readonly pingIntervalMs: number;
}

export interface SessionSample {
  /** Tempo de login até o `welcome`: o que o jogador espera para entrar. */
  readonly joinMs: number;
  readonly bytes: number;
  readonly frames: number;
  readonly messages: number;
  /** Latências de ida e volta medidas por `ping`/`pong`, em ms. */
  readonly latencies: number[];
  readonly failed: string | null;
}

/** Uma sessão viva. `close` é o que o modo desanexado NÃO chama antes da hora. */
export interface SyntheticSession {
  readonly sample: () => SessionSample;
  readonly close: () => void;
}

async function postJson(url: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:5173',
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

/**
 * Abre uma sessão do zero: conta, personagem, ticket, socket, hunt.
 *
 * Conta nova por sessão de propósito. Reaproveitar uma conta esbarraria no teto de dois
 * personagens ativos (FUN-15) na terceira sessão — e o teste mediria o limite, não a carga.
 */
export async function openSession(options: SessionOptions): Promise<SyntheticSession> {
  const startedAt = performance.now();
  const latencies: number[] = [];
  let bytes = 0;
  let frames = 0;
  let messages = 0;
  let failed: string | null = null;
  let socket: WebSocket | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let joinMs = 0;

  const sample = (): SessionSample => ({
    joinMs, bytes, frames, messages, latencies: [...latencies], failed,
  });
  const close = (): void => {
    if (pingTimer !== null) clearInterval(pingTimer);
    pingTimer = null;
    socket?.close();
    socket = null;
  };

  try {
    const login = await postJson(`${options.apiUrl}/api/auth/dev-login`, {
      email: `load-${randomUUID()}@example.com`,
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (cookie === undefined) throw new Error(`login failed: ${login.status}`);

    const created = await postJson(`${options.apiUrl}/api/characters`, {
      // Só letras: o nome é validado contra pontuação e dígitos (FUN-11).
      name: `Load ${randomUUID().replace(/[^a-f]/g, '').slice(0, 10) || 'aaaa'}`,
    }, cookie);
    if (!created.ok) throw new Error(`character failed: ${created.status}`);
    const character = await created.json() as { id: string };

    const issued = await postJson(
      `${options.apiUrl}/api/tickets`, { characterId: character.id }, cookie,
    );
    if (!issued.ok) throw new Error(`ticket failed: ${issued.status}`);
    const ticket = await issued.json() as { wsUrl: string };

    socket = new WebSocket(ticket.wsUrl);
    socket.binaryType = 'arraybuffer';
    const live = socket;

    live.addEventListener('message', (event) => {
      const frame = new Uint8Array(event.data as ArrayBuffer);
      frames += 1;
      bytes += frame.byteLength;
      // Decodifica de verdade, em vez de casar o `pong` por tamanho de frame. Adivinhar pelo
      // tamanho é mais barato e quebra em silêncio no dia em que a mensagem muda — e um
      // cliente de carga que mede errado sem avisar é pior que um que mede devagar. Se a
      // decodificação virar o gargalo, ela aparece no relatório como CPU do cliente.
      const decoded = decodeS2C(frame) ?? [];
      messages += decoded.length;
      for (const message of decoded) {
        // `t` é o instante que ESTA sessão mandou no `ping`: a volta inteira é a latência.
        if (message.type === 'pong') latencies.push(performance.now() - message.t);
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket timeout')), 15_000);
      live.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      live.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('handshake rejected'));
      }, { once: true });
    });
    joinMs = performance.now() - startedAt;

    live.send(encodeC2S({
      type: 'enter-hunt', huntId: options.huntId, difficulty: options.difficulty,
    }));

    if (options.mode === 'detached') {
      // ENTRA e SOME. A sessão continua rodando no servidor sem ninguém olhando, que é o
      // modo padrão do jogo — e o único que valida a projeção de custo.
      close();
      return { sample, close };
    }

    if (options.pingIntervalMs > 0) {
      pingTimer = setInterval(() => {
        live.send(encodeC2S({ type: 'ping', t: performance.now() }));
      }, options.pingIntervalMs);
      pingTimer.unref();
    }
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error);
    close();
  }

  return { sample, close };
}
