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

/** Conta e personagem novos, e o cookie que fala por eles. Um por sessão de propósito. */
async function newCharacter(apiUrl: string): Promise<{ cookie: string; characterId: string }> {
  const login = await postJson(`${apiUrl}/api/auth/dev-login`, {
    email: `load-${randomUUID()}@example.com`,
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (cookie === undefined) throw new Error(`login failed: ${login.status}`);
  const created = await postJson(`${apiUrl}/api/characters`, {
    // Só letras: o nome é validado contra pontuação e dígitos (FUN-11).
    name: `Load ${randomUUID().replace(/[^a-f]/g, '').slice(0, 10) || 'aaaa'}`,
  }, cookie);
  if (!created.ok) throw new Error(`character failed: ${created.status}`);
  const character = await created.json() as { id: string };
  return { cookie, characterId: character.id };
}

/**
 * Uma PARTY de `size` sessões (#198): `size` contas e personagens, a formação pelo `api` —
 * criar, convidar, entrar, propor, aprovar, iniciar — e um socket por membro com o ticket de
 * cada um. O líder recebe o dele no `start`; os outros pegam pelo `mine`. No modo desanexado
 * cada socket fecha logo depois de abrir, como o solo: a hunt continua com os N sem ninguém.
 *
 * Uma falha no meio da formação derruba a party inteira em `failed` — o relatório precisa
 * dizer que aquela party não existiu, e não medir `size` solos que nunca caçaram juntos.
 */
export async function openParty(
  options: SessionOptions & { readonly size: number; readonly partyMode: 'split' | 'shared' },
): Promise<SyntheticSession[]> {
  const startedAt = performance.now();
  const members: Array<{ cookie: string; characterId: string }> = [];
  const failure = (message: string): SyntheticSession[] => Array.from({ length: options.size }, () => ({
    sample: () => ({ joinMs: 0, bytes: 0, frames: 0, messages: 0, latencies: [], failed: message }),
    close: () => {},
  }));
  try {
    for (let i = 0; i < options.size; i++) members.push(await newCharacter(options.apiUrl));
    const [leader, ...others] = members;
    if (leader === undefined) return failure('empty party');
    const post = (member: { cookie: string; characterId: string }, path: string, body: Record<string, unknown> = {}) =>
      postJson(`${options.apiUrl}${path}`, { characterId: member.characterId, ...body }, member.cookie);
    const created = await post(leader, '/api/party');
    if (!created.ok) return failure(`party create failed: ${created.status}`);
    const party = await created.json() as { id: string };
    for (const member of others) {
      const invited = await post(leader, `/api/party/${party.id}/invite`, { inviteeId: member.characterId });
      if (!invited.ok) return failure(`party invite failed: ${invited.status}`);
      const joined = await post(member, `/api/party/${party.id}/join`);
      if (!joined.ok) return failure(`party join failed: ${joined.status}`);
    }
    const proposed = await post(leader, `/api/party/${party.id}/propose`, {
      huntId: options.huntId, difficulty: options.difficulty, mode: options.partyMode,
    });
    if (!proposed.ok) return failure(`party propose failed: ${proposed.status}`);
    for (const member of others) {
      const approved = await post(member, `/api/party/${party.id}/approve`);
      if (!approved.ok) return failure(`party approve failed: ${approved.status}`);
    }
    const started = await post(leader, `/api/party/${party.id}/start`);
    if (!started.ok) return failure(`party start failed: ${started.status}`);
    const ticket = (await started.json() as { ticket: { wsUrl: string } | null }).ticket;
    if (ticket === null) return failure('party start without a ticket');

    // O líder primeiro: é o socket dele que cria a hunt com os N.
    const sessions: SyntheticSession[] = [await openWith(options, ticket.wsUrl, startedAt)];
    for (const member of others) {
      const mine = await fetch(`${options.apiUrl}/api/party/mine?characterId=${encodeURIComponent(member.characterId)}`, {
        headers: { origin: 'http://localhost:5173', cookie: member.cookie },
      });
      const body = mine.ok ? await mine.json() as { ticket: { wsUrl: string } | null } : { ticket: null };
      if (body.ticket === null) {
        sessions.push({ sample: () => ({ joinMs: 0, bytes: 0, frames: 0, messages: 0, latencies: [], failed: 'party ticket missing' }), close: () => {} });
        continue;
      }
      sessions.push(await openWith(options, body.ticket.wsUrl, performance.now()));
    }
    return sessions;
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
}

/** Abre o socket com uma `wsUrl` já emitida — o membro da party não passa por `enter-hunt`. */
async function openWith(options: SessionOptions, wsUrl: string, startedAt: number): Promise<SyntheticSession> {
  const latencies: number[] = [];
  let bytes = 0;
  let frames = 0;
  let messages = 0;
  let failed: string | null = null;
  let socket: WebSocket | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let joinMs = 0;
  const sample = (): SessionSample => ({ joinMs, bytes, frames, messages, latencies: [...latencies], failed });
  const close = (): void => {
    if (pingTimer !== null) clearInterval(pingTimer);
    pingTimer = null;
    socket?.close();
    socket = null;
  };
  try {
    socket = new WebSocket(wsUrl);
    socket.binaryType = 'arraybuffer';
    const live = socket;
    live.addEventListener('message', (event) => {
      const frame = new Uint8Array(event.data as ArrayBuffer);
      frames += 1;
      bytes += frame.byteLength;
      const decoded = decodeS2C(frame) ?? [];
      messages += decoded.length;
      for (const message of decoded) {
        if (message.type === 'pong') latencies.push(performance.now() - message.t);
      }
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket timeout')), 15_000);
      live.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      live.addEventListener('error', () => { clearTimeout(timer); reject(new Error('handshake rejected')); }, { once: true });
    });
    joinMs = performance.now() - startedAt;
    if (options.mode === 'detached') {
      close();
      return { sample, close };
    }
    if (options.pingIntervalMs > 0) {
      pingTimer = setInterval(() => { live.send(encodeC2S({ type: 'ping', t: performance.now() })); }, options.pingIntervalMs);
      pingTimer.unref();
    }
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error);
    close();
  }
  return { sample, close };
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
