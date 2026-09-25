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
  /**
   * Fecha o socket atual DE PROPÓSITO e reconecta na hora (#197, #527): é como a party entra
   * na hunt — `enter(wsUrl)` oferece o ticket (`offerWsUrl`) e chama isto. Faz parte da
   * interface, e não só de `net/current.ts`, porque `restartConnection` só existe se o objeto
   * que `setConnection` guardou tiver o método — sem ele no retorno de `createConnection`, a
   * chamada virava um `false` silencioso e o ticket oferecido nunca era usado.
   */
  restart(): void;
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

    // O ticket oferecido por fora (#197) — o `start` da party, o `/mine` de cada membro, um
    // convite aceito — vale ANTES de pedir um novo por `POST /api/tickets`: é assim que a
    // party entra na hunt pelo MESMO `connect` de sempre, sem um segundo caminho de socket.
    // `takeWsUrl` é de uso único — se este ficar velho ou for recusado, `scheduleRetry` chama
    // `connect` de novo e a fila já está vazia, então a PRÓXIMA tentativa pede um ticket normal.
    const offered = takeWsUrl();
    let wsUrl: string;
    if (offered !== null) {
      wsUrl = offered;
    } else {
      try {
        wsUrl = await requestTicket(options.apiUrl, options.characterId);
      } catch {
        // Ticket recusado pode ser transitório (nó reiniciando) ou definitivo (sem sessão).
        // Tentar de novo com espera é o comportamento certo para os dois: o definitivo vira
        // uma sequência de falhas visível, não um travamento silencioso.
        scheduleRetry();
        return;
      }
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

  /**
   * Fecha o socket atual, se houver, e cancela a espera pendente — sem deixar o `onclose` do
   * fechamento intencional agendar uma reconexão que ninguém pediu. Base de `stop` (encerra) e
   * `restart` (reconecta na hora): as duas precisam do MESMO cuidado de zerar os handlers
   * ANTES de fechar.
   */
  function closeCurrent(): void {
    cancelRetry?.();
    cancelRetry = null;
    const open = socket;
    socket = null;
    if (open !== null) {
      open.onopen = null;
      open.onmessage = null;
      open.onclose = null;
      open.onerror = null;
      open.close();
    }
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
      closeCurrent();
      setStatus('idle');
    },
    restart() {
      // Reconecta na hora — nunca passa por `idle`: é uma troca de sessão (party, convite
      // aceito), não uma queda. `attempt` volta a zero para o status mostrar "conectando", não
      // "reconectando" (que soa a falha), e para o backoff não herdar a espera de uma queda
      // anterior que não tem nada a ver com isto.
      running = true;
      attempt = 0;
      closeCurrent();
      void connect();
    },
    send(message) {
      if (socket !== null && status === 'connected') sendOn(socket, message);
    },
    get status() {
      return status;
    },
  };
}
