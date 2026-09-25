// O anexo do ticket do líder (#527): fala o protocolo com um socket falso, como
// `client/src/net/connection.test.ts` faz do outro lado da mesma conversa.

import { encodeS2C } from '@draconya/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachPartyTicket, type AttachSocketLike } from './dragon-party-attach.js';

class FakeSocket implements AttachSocketLike {
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  readonly sent: Uint8Array[] = [];
  closed = false;

  send(data: Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const promise = attachPartyTicket('ws://n1:7171/?ticket=leader', {
    openSocket: (url) => {
      expect(url).toBe('ws://n1:7171/?ticket=leader');
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  return { promise, sockets };
}

const sessionStateFrame = (sessionType: string): ArrayBuffer => {
  const frame = encodeS2C({
    type: 'session-state',
    sessionType,
    elapsedMs: 0,
    self: {
      creatureId: 1, characterId: 'leader', health: 100, maxHealth: 100, mana: 10, maxMana: 10,
      level: 200, xp: 0, vocationId: 'knight', speed: 618, skills: {}, magicLevel: { level: 0, percentToNext: 0 },
    },
    world: { mapId: 'darashia', creatures: [], groundItems: [] },
    aggregates: { durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0 },
    notableEvents: [],
  });
  return frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('attachPartyTicket (#527)', () => {
  it('sends session-attach on open and resolves with the sessionType of the first session-state', async () => {
    const { promise, sockets } = harness();
    await Promise.resolve();
    const socket = sockets[0];
    expect(socket).toBeDefined();
    expect(socket?.binaryType).toBe('arraybuffer');

    socket?.onopen?.();
    expect(socket?.sent).toHaveLength(1);

    socket?.onmessage?.({ data: sessionStateFrame('hunt') });
    await expect(promise).resolves.toEqual({ sessionType: 'hunt' });
    // O socket é fechado sozinho — não é o modo `--attach` do jogador.
    expect(socket?.closed).toBe(true);
  });

  it('ignores messages that are not session-state before resolving', async () => {
    const { promise, sockets } = harness();
    await Promise.resolve();
    const socket = sockets[0];
    socket?.onopen?.();

    const pong = encodeS2C({ type: 'pong', t: 1 });
    socket?.onmessage?.({ data: pong.buffer.slice(pong.byteOffset, pong.byteOffset + pong.byteLength) });
    socket?.onmessage?.({ data: sessionStateFrame('hunt') });

    await expect(promise).resolves.toEqual({ sessionType: 'hunt' });
  });

  it('rejects, closing the socket, when nothing arrives within the timeout', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const promise = attachPartyTicket('ws://n1:7171/?ticket=leader', {
      timeoutMs: 1_000,
      openSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const assertion = expect(promise).rejects.toThrow(/1000 ms/);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(sockets[0]?.closed).toBe(true);
  });

  it('rejects when the socket closes before any session-state arrives', async () => {
    const { promise, sockets } = harness();
    await Promise.resolve();
    sockets[0]?.onclose?.({});
    await expect(promise).rejects.toThrow(/fechou antes do session-state/);
  });

  it('rejects on a socket error', async () => {
    const { promise, sockets } = harness();
    await Promise.resolve();
    sockets[0]?.onerror?.({ message: 'boom' });
    await expect(promise).rejects.toThrow(/erro no socket/);
  });

  it('clears every handler after resolving, so a late close cannot fire a second time', async () => {
    // Mutação que mata: sem zerar `onclose` ao terminar, um `close()` disparado por um socket de
    // verdade logo depois de resolver rejeitaria uma promise que já assentou.
    const { promise, sockets } = harness();
    await Promise.resolve();
    const socket = sockets[0];
    socket?.onopen?.();
    socket?.onmessage?.({ data: sessionStateFrame('hunt') });
    await expect(promise).resolves.toEqual({ sessionType: 'hunt' });
    expect(socket?.onopen).toBeNull();
    expect(socket?.onmessage).toBeNull();
    expect(socket?.onerror).toBeNull();
    expect(socket?.onclose).toBeNull();
  });
});
