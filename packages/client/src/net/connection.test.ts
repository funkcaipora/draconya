import { decodeC2S, encodeS2C } from '@draconya/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_HUD, hud } from '../state/hud.js';
import { world } from '../state/world.js';
import { createConnection, type SocketLike } from './connection.js';

class FakeSocket implements SocketLike {
  binaryType = '';
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: Uint8Array[] = [];
  closed = false;

  send(data: ArrayBufferView): void {
    this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  close(): void {
    this.closed = true;
  }

  /** O que o cliente mandou, já decodificado. */
  requests(): string[] {
    return this.sent.flatMap((frame) => (decodeC2S(frame) ?? []).map((m) => m.type));
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const pending: Array<{ fn: () => void; delayMs: number }> = [];
  const connection = createConnection({
    apiUrl: 'http://api',
    characterId: 'c1',
    requestTicket: async () => 'ws://node/?ticket=t',
    openSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    schedule: (fn, delayMs) => {
      const entry = { fn, delayMs };
      pending.push(entry);
      return () => {
        const index = pending.indexOf(entry);
        if (index >= 0) pending.splice(index, 1);
      };
    },
    random: () => 1,
  });
  const runPending = (): void => {
    const due = pending.splice(0, pending.length);
    for (const entry of due) entry.fn();
  };
  return { connection, sockets, pending, runPending };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
  world.creatures.clear();
  world.selfId = null;
});

describe('connection', () => {
  it('reattaches on open instead of asking to log in again', async () => {
    // Reconectar é REANEXAR. A primeira coisa que sai do socket é `session-attach`; se fosse
    // um login, o modelo de sessão (ADR 0001) teria vazado para a UI.
    const { connection, sockets } = harness();
    connection.start();
    await flush();

    expect(sockets).toHaveLength(1);
    sockets[0]?.onopen?.({});
    expect(sockets[0]?.requests()).toEqual(['session-attach']);
    expect(hud.get().connection).toBe('connected');
  });

  it('does not clear the world when the socket drops', async () => {
    // A tela continua mostrando a última coisa verdadeira em vez de piscar vazia. O mundo é
    // substituído quando o `session-state` chegar, não antes.
    const { connection, sockets, runPending } = harness();
    connection.start();
    await flush();
    sockets[0]?.onopen?.({});
    world.creatures.set(7, {
      id: 7, appearanceId: 1, name: 'r', health: 1, maxHealth: 1,
      position: { x: 1, y: 1, z: 7 }, step: null,
    });

    sockets[0]?.onclose?.({});

    expect(hud.get().connection).toBe('reconnecting');
    expect(world.creatures.size).toBe(1);

    runPending();
    await flush();
    expect(sockets).toHaveLength(2);
  });

  it('waits longer after each failure, and resets once it is back', async () => {
    const { connection, sockets, pending, runPending } = harness();
    connection.start();
    await flush();

    sockets[0]?.onclose?.({});
    expect(pending[0]?.delayMs).toBe(500);
    runPending();
    await flush();

    sockets[1]?.onclose?.({});
    expect(pending[0]?.delayMs).toBe(1_000);
    runPending();
    await flush();

    // Conectou: a próxima queda volta a esperar pouco, senão um blip depois de uma queda
    // longa herdaria a espera de meia hora.
    sockets[2]?.onopen?.({});
    sockets[2]?.onclose?.({});
    expect(pending[0]?.delayMs).toBe(500);
  });

  it('stops retrying after stop, and the intentional close does not schedule one', async () => {
    const { connection, sockets, pending } = harness();
    connection.start();
    await flush();
    sockets[0]?.onopen?.({});

    connection.stop();

    expect(sockets[0]?.closed).toBe(true);
    // Sem zerar os handlers antes de fechar, o `onclose` do fechamento intencional agendaria
    // uma reconexão que ninguém pediu.
    expect(pending).toHaveLength(0);
    expect(hud.get().connection).toBe('idle');
  });

  it('applies a batch of deltas in one go', async () => {
    // Ao voltar de aba de fundo chega um lote inteiro de uma vez. Aplicar em bloco, sem
    // tentar animar dez minutos de eventos.
    const { connection, sockets } = harness();
    connection.start();
    await flush();
    sockets[0]?.onopen?.({});

    const frame = encodeS2C({
      type: 'creature-appear', id: 3, position: { x: 2, y: 2, z: 7 },
      appearanceId: 1, name: 'rato', health: 20, maxHealth: 20,
    });
    sockets[0]?.onmessage?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) });

    expect(world.creatures.get(3)?.name).toBe('rato');
  });

  it('retries when the ticket is refused instead of stalling', async () => {
    // Ticket recusado pode ser transitório. Falhar em silêncio deixaria a tela em
    // "conectando" para sempre, que é indistinguível de jogo travado.
    const sockets: FakeSocket[] = [];
    const pending: Array<{ fn: () => void; delayMs: number }> = [];
    const connection = createConnection({
      apiUrl: 'http://api',
      characterId: 'c1',
      requestTicket: async () => {
        throw new Error('refused');
      },
      openSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (fn, delayMs) => {
        pending.push({ fn, delayMs });
        return () => {};
      },
      random: () => 1,
    });

    connection.start();
    await flush();

    expect(sockets).toHaveLength(0);
    expect(pending).toHaveLength(1);
    expect(hud.get().connection).toBe('reconnecting');
  });
});

describe('o ticket oferecido por fora (#197)', () => {
  it('is used once before asking the api, then the api is asked again', async () => {
    const { offerWsUrl, takeWsUrl } = await import('./pending-ticket.js');
    offerWsUrl('ws://party/?ticket=p');
    expect(takeWsUrl()).toBe('ws://party/?ticket=p');
    expect(takeWsUrl()).toBeNull();
  });
});
