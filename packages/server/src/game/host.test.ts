import { CharacterRuntime, Rng, Session, type Ruleset } from '@draconya/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../log.js';
import type { SessionDirectory } from '../directory.js';
import { SessionHost } from './host.js';
import { FakeSocket } from './testing.js';

const logger = createLogger('silent', 'test');

afterEach(() => {
  vi.useRealTimers();
});

/** Ruleset instrumentado: conta ticks e muda de taxa com a presença de visualizador. */
function countingRuleset(hzAttached = 10, hzDetached = 1) {
  const counter = { ticks: 0, elapsedMs: 0, ended: 0 };
  const ruleset: Ruleset = {
    type: 'hunt',
    hz: (attached) => (attached ? hzAttached : hzDetached),
    onEnter: () => {},
    onTick: (_session, dtMs) => {
      counter.ticks += 1;
      counter.elapsedMs += dtMs;
    },
    onDeath: () => {},
    onEnd: () => {
      counter.ended += 1;
    },
  };
  return { ruleset, counter };
}

function buildHost(
  ruleset: Ruleset,
  options: { now?: () => number; directory?: SessionDirectory } = {},
) {
  const sessions: Session[] = [];
  const host = new SessionHost({
    nodeId: 'n1',
    contentVersion: 'v-test',
    logger,
    ...options,
    createSession: (characterId) => {
      const session = new Session({
        id: `s-${characterId}`,
        contentVersion: 'v-test',
        ruleset,
        rng: Rng.fromSeed(characterId),
        createdAtMs: 0,
      });
      session.enter(new CharacterRuntime({
        id: characterId,
        position: { x: 0, y: 0, z: 7 },
        health: 100, maxHealth: 100, mana: 10, maxMana: 10,
        level: 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
      }));
      sessions.push(session);
      return session;
    },
  });
  return { host, sessions };
}

describe('session host', () => {
  it('releases a session the handshake created but never attached', async () => {
    // Handshake abortado: o `prepare` cria e registra, o cliente some antes do upgrade, e
    // nenhum socket vai chegar para desanexar depois. Sem soltar, a sessão fica hospedada
    // para sempre segurando um dos dois slots da conta — e o personagem nem pode ser
    // apagado, porque o diretório o reporta ativo.
    const released: string[] = [];
    const slotsReleased: Array<[string, string]> = [];
    const directory = {
      register: async () => true,
      release: async (characterId: string) => {
        released.push(characterId);
      },
      releaseSlot: async (accountId: string, characterId: string) => {
        slotsReleased.push([accountId, characterId]);
      },
    } as unknown as SessionDirectory;
    const { ruleset, counter } = countingRuleset();
    const { host } = buildHost(ruleset, { directory });

    const first = await host.prepare('p1', undefined, 'a1');
    expect(first.created).toBe(true);
    expect(host.sessionFor('p1')).toBeDefined();

    await host.release('p1');

    expect(host.sessionFor('p1')).toBeUndefined();
    expect(host.sessionCount).toBe(0);
    expect(released).toEqual(['p1']);
    expect(slotsReleased).toEqual([['a1', 'p1']]);
    // Encerrada pelo ruleset, não descartada: quem sabe se há algo a creditar é ele.
    expect(counter.ended).toBe(1);
  });

  it('tells a second handshake that it did not create the session', async () => {
    // Reconexão reencontra a sessão. Se ela dissesse `created`, um abort seguinte
    // derrubaria a sessão que o primeiro socket está usando.
    const directory = { register: async () => true } as unknown as SessionDirectory;
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, { directory });

    expect((await host.prepare('p1', undefined, 'a1')).created).toBe(true);
    expect((await host.prepare('p1', undefined, 'a1')).created).toBe(false);
  });

  it('waits for directory registration before exposing a prepared session', async () => {
    const { ruleset } = countingRuleset();
    let finishRegistration: ((registered: boolean) => void) | undefined;
    const registration = new Promise<boolean>((resolve) => {
      finishRegistration = resolve;
    });
    const directory = {
      register: () => registration,
    } as unknown as SessionDirectory;
    const sessions: Session[] = [];
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger, directory,
      createSession: (characterId) => {
        const session = new Session({
          id: `s-${characterId}`, contentVersion: 'v-test', ruleset,
          rng: Rng.fromSeed(characterId), createdAtMs: 0,
        });
        sessions.push(session);
        return session;
      },
    });

    const preparing = host.prepare('p1', { level: 1, xp: 0 }, 'a1');
    expect(host.sessionCount).toBe(0);
    finishRegistration?.(true);
    await preparing;
    expect(host.sessionCount).toBe(1);
    expect(sessions).toHaveLength(1);
  });

  it('shares one preparation across concurrent handshakes', async () => {
    const { ruleset } = countingRuleset();
    const directory = { register: async () => true } as unknown as SessionDirectory;
    let created = 0;
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger, directory,
      createSession: (characterId) => {
        created += 1;
        return new Session({
          id: `s-${characterId}`, contentVersion: 'v-test', ruleset,
          rng: Rng.fromSeed(characterId), createdAtMs: 0,
        });
      },
    });

    await Promise.all([
      host.prepare('p1', { level: 1, xp: 0 }, 'a1'),
      host.prepare('p1', { level: 1, xp: 0 }, 'a1'),
    ]);
    expect(created).toBe(1);
  });

  it('does not host a session whose active reservation expired', async () => {
    const { ruleset } = countingRuleset();
    const directory = { register: async () => false } as unknown as SessionDirectory;
    const guarded = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger, directory,
      createSession: (characterId) => new Session({
        id: `s-${characterId}`, contentVersion: 'v-test', ruleset,
        rng: Rng.fromSeed(characterId), createdAtMs: 0,
      }),
    });

    await expect(guarded.prepare('p1', { level: 1, xp: 0 }, 'a1')).rejects.toThrow(
      'active reservation expired',
    );
    expect(guarded.sessionCount).toBe(0);
  });

  it('renews the account slot with the session lease', async () => {
    vi.useFakeTimers();
    const { ruleset } = countingRuleset(0, 0);
    const renew = vi.fn(async () => undefined);
    const directory = {
      register: async () => true,
      renew,
    } as unknown as SessionDirectory;
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger, directory,
      createSession: (characterId) => new Session({
        id: `s-${characterId}`, contentVersion: 'v-test', ruleset,
        rng: Rng.fromSeed(characterId), createdAtMs: 0,
      }),
    });
    await host.prepare('p1', { level: 1, xp: 0 }, 'a1');

    host.start();
    await vi.advanceTimersByTimeAsync(10_000);
    host.stop();

    expect(renew).toHaveBeenCalledWith([{ characterId: 'p1', accountId: 'a1' }]);
  });
  it('gives two connections of one character the same session', () => {
    // Duas abas são dois VISUALIZADORES, nunca duas sessões — invariante 8.
    const { ruleset } = countingRuleset();
    const { host, sessions } = buildHost(ruleset);

    host.attach(new FakeSocket(), 'p1');
    host.attach(new FakeSocket(), 'p1');

    expect(sessions).toHaveLength(1);
    expect(host.sessionCount).toBe(1);
    expect(host.viewersOf('p1')).toBe(2);
  });

  it('closing one connection affects neither the other nor the simulation', () => {
    // É O TESTE QUE DEFINE ESTA ISSUE. Se derrubar um socket encerrar, pausar ou zerar
    // qualquer coisa, o modelo está errado — é o ADR 0001 inteiro em uma linha.
    const { ruleset, counter } = countingRuleset(10, 10);
    let now = 0;
    const { host } = buildHost(ruleset, { now: () => now });

    const socketA = new FakeSocket();
    const socketB = new FakeSocket();
    const viewerA = host.attach(socketA, 'p1');
    host.attach(socketB, 'p1');

    now = 1_000;
    host.cycle();
    const ticksBefore = counter.ticks;
    const elapsedBefore = counter.elapsedMs;
    expect(ticksBefore).toBe(1);

    viewerA.markClosed();
    host.detach(viewerA);

    now = 2_000;
    host.cycle();

    const session = host.sessionFor('p1');
    expect(host.sessionCount).toBe(1);
    expect(host.viewersOf('p1')).toBe(1);
    expect(session?.ended).toBeNull();
    expect(counter.ended).toBe(0);
    // A simulação seguiu, e não perdeu nem repetiu tempo na saída do visualizador.
    expect(counter.ticks).toBe(ticksBefore + 1);
    expect(counter.elapsedMs).toBe(elapsedBefore + 1_000);
    expect(session?.aggregates.durationMs).toBe(2_000);
  });

  it('keeps the session alive with nobody watching', () => {
    // A hunt é o modo padrão e o navegador fechado é o caso comum, não a exceção.
    const { ruleset, counter } = countingRuleset(10, 10);
    let now = 0;
    const { host } = buildHost(ruleset, { now: () => now });

    const viewer = host.attach(new FakeSocket(), 'p1');
    viewer.markClosed();
    host.detach(viewer);

    now = 1_000;
    host.cycle();

    expect(host.viewersOf('p1')).toBe(0);
    expect(host.sessionFor('p1')?.attached).toBe(false);
    expect(counter.ticks).toBe(1);
  });

  it('slows down when detached and speeds up when attached, without losing time', () => {
    // Invariante 2: o resultado não depende da taxa, porque o cálculo recebe `dtMs`.
    const { ruleset, counter } = countingRuleset(10, 1);
    let now = 0;
    const { host } = buildHost(ruleset, { now: () => now });

    const viewer = host.attach(new FakeSocket(), 'p1');
    for (let i = 1; i <= 10; i++) {
      now = i * 100;
      host.cycle();
    }
    expect(counter.ticks).toBe(10);

    viewer.markClosed();
    host.detach(viewer);
    for (let i = 11; i <= 20; i++) {
      now = i * 100;
      host.cycle();
    }
    // A 1 Hz, dez ciclos de 100 ms viram UM tick — com o mesmo tempo simulado dentro.
    expect(counter.ticks).toBe(11);
    expect(counter.elapsedMs).toBe(2_000);
  });

  it('never ticks an event-driven session', () => {
    // A cidade é o único espaço compartilhado do jogo; agendar tick nela é queimar CPU
    // justamente onde o custo por jogador precisa ficar perto de zero. O ruleset de Cidade
    // lança em `onTick` de propósito, então este teste falharia alto.
    const { ruleset, counter } = countingRuleset(0, 0);
    let now = 0;
    const { host } = buildHost(ruleset, { now: () => now });

    host.attach(new FakeSocket(), 'p1');
    now = 10_000;
    expect(() => host.cycle()).not.toThrow();
    expect(counter.ticks).toBe(0);
  });

  it('greets the connection with the content version pinned to the session', () => {
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset);
    const socket = new FakeSocket();

    host.attach(socket, 'p1');

    expect(socket.received()).toEqual([
      { type: 'welcome', characterId: 'p1', contentVersion: 'v-test' },
    ]);
  });

  it('answers ping immediately, without waiting for the cycle', () => {
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset);
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');

    host.handle(viewer, { type: 'ping', t: 99 });

    expect(socket.received()).toContainEqual({ type: 'pong', t: 99 });
    expect(viewer.queued).toBe(0);
  });

  it('closes the connection on logout without touching the session', () => {
    const { ruleset, counter } = countingRuleset();
    const { host } = buildHost(ruleset);
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');

    host.handle(viewer, { type: 'logout' });

    expect(socket.ended?.code).toBe(1000);
    expect(host.sessionFor('p1')?.ended).toBeNull();
    expect(counter.ended).toBe(0);
  });

  it('drops a viewer that stopped draining and keeps the session running', () => {
    // Cliente lento não pode fazer o nó crescer sem limite. Ele cai; a sessão fica.
    const { ruleset, counter } = countingRuleset(10, 10);
    let now = 0;
    const { host } = buildHost(ruleset, { now: () => now });
    const slow = new FakeSocket();
    const healthy = new FakeSocket();

    const slowViewer = host.attach(slow, 'p1');
    host.attach(healthy, 'p1');
    slow.buffered = 10 * 1024 * 1024;
    slowViewer.send({ type: 'system-message', level: 'info', text: 'x' });

    now = 1_000;
    host.cycle();

    expect(slow.ended?.code).toBe(1013);
    expect(host.viewersOf('p1')).toBe(1);
    expect(host.sessionFor('p1')?.ended).toBeNull();
    expect(counter.ticks).toBe(1);
  });
});
