import { describe, expect, it } from 'vitest';
import { Viewer } from './viewer.js';
import { FakeSocket } from './testing.js';

const message = (text: string) => ({ level: 'info', text }) as const;

describe('viewer', () => {
  it('sends one frame per flush, not one per message', () => {
    // É esta propriedade que sustenta a projeção de banda por jogador: o nó acumula a saída
    // de um ciclo e manda um frame, em vez de um `send` por evento.
    const socket = new FakeSocket();
    const viewer = new Viewer(socket, 'p1');

    viewer.send({ type: 'system-message', ...message('a') });
    viewer.send({ type: 'system-message', ...message('b') });
    viewer.send({ type: 'system-message', ...message('c') });
    expect(socket.frames).toHaveLength(0);

    viewer.flush();
    expect(socket.frames).toHaveLength(1);
    expect(socket.received().map((m) => (m as { text: string }).text)).toEqual(['a', 'b', 'c']);
  });

  it('does not wrap a single message in a batch envelope', () => {
    const socket = new FakeSocket();
    const viewer = new Viewer(socket, 'p1');
    viewer.send({ type: 'system-message', ...message('only') });
    viewer.flush();
    expect(socket.received()).toEqual([{ type: 'system-message', level: 'info', text: 'only' }]);
  });

  it('sends latency answers outside the queue', () => {
    // `pong` que espera o ciclo mede a fila, não a rede.
    const socket = new FakeSocket();
    const viewer = new Viewer(socket, 'p1');
    viewer.send({ type: 'system-message', ...message('queued') });
    viewer.sendNow({ type: 'pong', t: 42 });

    expect(socket.received()).toEqual([{ type: 'pong', t: 42 }]);
    expect(viewer.queued).toBe(1);
  });

  it('dies when the socket stops draining', () => {
    const socket = new FakeSocket();
    const viewer = new Viewer(socket, 'p1', { maxBufferedBytes: 100 });
    socket.buffered = 101;

    viewer.send({ type: 'system-message', ...message('a') });
    viewer.flush();

    expect(viewer.dead).toBe(true);
    expect(socket.frames).toHaveLength(0);
  });

  it('dies when the queue grows past the ceiling', () => {
    // Sem teto, um cliente lento vira consumo de memória do nó inteiro.
    const socket = new FakeSocket();
    const viewer = new Viewer(socket, 'p1', { maxQueued: 3 });
    for (let i = 0; i < 4; i++) viewer.send({ type: 'system-message', ...message(`m${i}`) });

    expect(viewer.dead).toBe(true);
  });

  it('never touches a socket that already closed', () => {
    // Mexer na resposta depois que o uWS fechou o socket derruba o processo.
    const socket = new FakeSocket();
    const viewer = new Viewer(socket, 'p1');
    viewer.markClosed();

    viewer.send({ type: 'system-message', ...message('a') });
    viewer.sendNow({ type: 'pong', t: 1 });
    viewer.flush();
    viewer.close(1000, 'again');

    expect(socket.frames).toHaveLength(0);
    expect(socket.ended).toBeNull();
  });
});
