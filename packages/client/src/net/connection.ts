// O ciclo de conexão (FUN-24).
//
//   pedir ticket → abrir socket → session-attach → pronto
//        ↑                                          ↓
//        └───── espera com jitter ───────────── queda
//
// RECONECTAR É REANEXAR. Não recarrega a página, não recria personagem, não limpa o store:
// pede ticket novo e volta para a MESMA sessão, que nunca parou de rodar. Se a reconexão
// parecer um login novo para o jogador, o modelo de sessão (ADR 0001) vazou para a UI.

import { decodeS2C, encodeC2S, type C2SMessage } from '@draconya/protocol';
import { applyMessage } from '../state/apply.js';
import { hud, type ConnectionStatus } from '../state/hud.js';
import { backoffDelayMs } from './backoff.js';
import { takeWsUrl } from './pending-ticket.js';

/** O pedaço do WebSocket que isto usa. Estreito de propósito: o teste implementa à mão. */
export interface SocketLike {
  binaryType: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: ArrayBufferView): void;
  close(): void;
}

export interface ConnectionOptions {
  readonly apiUrl: string;
  readonly characterId: string;
  readonly openSocket?: (url: string) => SocketLike;
  readonly requestTicket?: (apiUrl: string, characterId: string) => Promise<string>;
  readonly schedule?: (fn: () => void, delayMs: number) => () => void;
  readonly random?: () => number;
}

export interface Connection {
  start(): void;
  stop(): void;
  send(message: C2SMessage): void;
  readonly status: ConnectionStatus;
}

async function defaultRequestTicket(apiUrl: string, characterId: string): Promise<string> {
  const response = await fetch(`${apiUrl}/api/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // A sessão HTTP é cookie httpOnly noutra origem; sem isto ela não vai junto.
    credentials: 'include',
    body: JSON.stringify({ characterId }),
  });
  if (!response.ok) throw new Error(`ticket refused with HTTP ${response.status}`);
  const body = (await response.json()) as { wsUrl?: unknown };
  if (typeof body.wsUrl !== 'string') throw new Error('ticket response has no wsUrl');
  return body.wsUrl;
}

export function createConnection(options: ConnectionOptions): Connection {
  const openSocket = options.openSocket
    ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const requestTicket = options.requestTicket ?? defaultRequestTicket;
  const schedule = options.schedule ?? ((fn, delayMs) => {
    const id = setTimeout(fn, delayMs);
    return () => clearTimeout(id);
  });
  const random = options.random ?? Math.random;

  let socket: SocketLike | null = null;
  let cancelRetry: (() => void) | null = null;
  let attempt = 0;
  let running = false;
  let status: ConnectionStatus = 'idle';

  function setStatus(next: ConnectionStatus): void {
    status = next;
    hud.set((state) => (state.connection === next ? state : { ...state, connection: next }));
  }

  function scheduleRetry(): void {
    if (!running) return;
    setStatus('reconnecting');
    const delay = backoffDelayMs(attempt, random);
    attempt += 1;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      void connect();
    }, delay);
  }

  async function connect(): Promise<void> {
    if (!running) return;
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

    let wsUrl: string;
    try {
      wsUrl = await requestTicket(options.apiUrl, options.characterId);
    } catch {
      // Ticket recusado pode ser transitório (nó reiniciando) ou definitivo (sem sessão).
      // Tentar de novo com espera é o comportamento certo para os dois: o definitivo vira
      // uma sequência de falhas visível, não um travamento silencioso.
      scheduleRetry();
      return;
    }
    if (!running) return;

    const next = openSocket(wsUrl);
    next.binaryType = 'arraybuffer';
    socket = next;

    next.onopen = () => {
      attempt = 0;
      // Reanexar. O estado completo vem por resposta, e NÃO se limpa o store antes: o mundo
      // antigo é substituído quando o `session-state` chegar, e até lá a tela continua
      // mostrando a última coisa verdadeira em vez de piscar vazia.
      sendOn(next, { type: 'session-attach' });
      setStatus('connected');
    };

    next.onmessage = (event) => {
      const data = event.data;
      if (!(data instanceof ArrayBuffer)) return;
      const decoded = decodeS2C(new Uint8Array(data));
      if (decoded === null) return;
      const nowMs = performance.now();
      // Em bloco. Ao voltar de aba de fundo chega um lote inteiro de uma vez, e tentar
      // animar dez minutos de eventos é o erro que o AGENTS.md do pacote nomeia.
      for (const message of decoded) applyMessage(message, nowMs);
    };

    next.onclose = () => {
      socket = null;
      scheduleRetry();
    };
    next.onerror = () => {
      // `onclose` vem logo atrás e é ele quem agenda; fechar aqui evita socket pendurado.
      next.close();
    };
  }

  function sendOn(target: SocketLike, message: C2SMessage): void {
    target.send(encodeC2S(message));
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      void connect();
    },
    stop() {
      running = false;
      cancelRetry?.();
      cancelRetry = null;
      const open = socket;
      socket = null;
      // Zerar os handlers antes de fechar: senão o `onclose` do fechamento intencional
      // agenda uma reconexão que ninguém pediu.
      if (open !== null) {
        open.onopen = null;
        open.onmessage = null;
        open.onclose = null;
        open.onerror = null;
        open.close();
      }
      setStatus('idle');
    },
    send(message) {
      if (socket !== null && status === 'connected') sendOn(socket, message);
    },
    get status() {
      return status;
    },
  };
}
