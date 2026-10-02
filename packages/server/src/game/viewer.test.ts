import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeS2C, encodeS2C } from '@draconya/protocol';
import type { S2CMessage } from '@draconya/protocol';
import { EncodeCache, Viewer } from './viewer.js';
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

describe('serializar uma vez (OW-22)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const step = (id: number): S2CMessage => ({
    type: 'creature-move', id, from: { x: 1, y: 1, z: 7 }, to: { x: 2, y: 1, z: 7 }, durationMs: 150,
  });

  /** Os quadros que cada visualizador escreveu, para comparar byte a byte. */
  const flushAll = (queues: readonly (readonly S2CMessage[])[], cache?: EncodeCache): Uint8Array[][] => {
    const sockets = queues.map(() => new FakeSocket());
    queues.forEach((queue, index) => {
      const viewer = new Viewer(sockets[index] as FakeSocket, `p${String(index)}`);
      for (const message of queue) viewer.send(message);
      viewer.flush(cache);
    });
    return sockets.map((socket) => socket.frames);
  };

  it('os frames saem byte a byte iguais com e sem o cache', () => {
    // A chave de ofuscação de cada frame sai de `Math.random`: com ele fixo, a saída é função só
    // do conteúdo, e "o cache não muda o fio" vira uma igualdade de bytes — não de mensagens
    // decodificadas, que passaria mesmo com o lote trocado.
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const shared = step(7);
    const queues = [[shared], [shared, step(8)], [step(9), shared, { type: 'pong', t: 1 } as S2CMessage]];

    const without = flushAll(queues);
    const withCache = flushAll(queues, new EncodeCache());

    expect(withCache).toEqual(without);
    // E o frame de uma mensagem só é o crú — não um lote de um.
    expect(withCache[0]?.[0]).toEqual(encodeS2C(shared));
  });

  it('a mesma referência para N visualizadores é codificada uma vez', () => {
    const cache = new EncodeCache();
    const shared = step(1);
    const queues = Array.from({ length: 5 }, () => [shared]);

    flushAll(queues, cache);

    expect(cache.stats.encoded).toBe(1);
    expect(cache.stats.reused).toBe(4);
    expect(cache.stats.encodedBytes).toBe(encodeS2C(shared).byteLength);
  });

  it('objetos diferentes com o mesmo conteúdo são codificados cada um: a chave é a identidade', () => {
    // Sem comparar conteúdo nem montar hash: o hospedeiro entrega a MESMA referência a quem
    // recebe a mesma mensagem, e é isso que o cache aproveita.
    const cache = new EncodeCache();
    flushAll([[step(1)], [step(1)]], cache);
    expect(cache.stats.encoded).toBe(2);
    expect(cache.stats.reused).toBe(0);
  });

  it('cada visualizador decodifica as SUAS mensagens, na ordem em que as recebeu', () => {
    const cache = new EncodeCache();
    const shared = step(1);
    const mine = step(2);
    const sockets = [new FakeSocket(), new FakeSocket()];
    const first = new Viewer(sockets[0] as FakeSocket, 'a');
    const second = new Viewer(sockets[1] as FakeSocket, 'b');
    first.send(mine);
    first.send(shared);
    second.send(shared);
    first.flush(cache);
    second.flush(cache);

    expect(sockets[0]?.received()).toEqual([mine, shared]);
    expect(sockets[1]?.received()).toEqual([shared]);
  });

  it('clear() esvazia o ciclo: mensagem mutada depois dele é codificada de novo', () => {
    // O prazo de validade do cache é o ciclo. Um frame velho mandaria o conteúdo de ontem.
    const cache = new EncodeCache();
    const message = { type: 'system-message', level: 'info', text: 'antes' } as S2CMessage;
    const socket = new FakeSocket();
    const viewer = new Viewer(socket, 'p1');
    viewer.send(message);
    viewer.flush(cache);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
    (message as { text: string }).text = 'depois';
    viewer.send(message);
    viewer.flush(cache);

    expect(socket.received().map((m) => (m as { text: string }).text)).toEqual(['antes', 'depois']);
    // Os contadores sobrevivem ao clear: quem mede lê duas vezes e subtrai.
    expect(cache.stats.encoded).toBe(2);
  });

  it('sem cache o visualizador codifica sozinho, como sempre', () => {
    const socket = new FakeSocket();
    const viewer = new Viewer(socket, 'p1');
    viewer.send(step(1));
    viewer.send(step(2));
    viewer.flush();
    expect(decodeS2C(socket.frames[0] as Uint8Array)).toEqual([step(1), step(2)]);
  });

  it('visualizador morto não codifica nada: o cache não paga por quem não vai receber', () => {
    const cache = new EncodeCache();
    const socket = new FakeSocket();
    const viewer = new Viewer(socket, 'p1');
    viewer.send(step(1));
    viewer.markClosed();
    viewer.flush(cache);

    expect(cache.stats.encoded).toBe(0);
    expect(socket.frames).toHaveLength(0);
  });
});
