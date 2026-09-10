import {
  CharacterRuntime, Rng, Session,
  type EndReason, type Ruleset, type SessionSnapshot,
} from '@draconya/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContent } from '@draconya/content';
import { createLogger } from '../log.js';
import type { SessionDirectory } from '../directory.js';
import type { SnapshotStore } from '../snapshots.js';
import type { ReceiptStore } from '../receipts.js';
import { SessionHost } from './host.js';
import type { SessionHostOptions } from './host.js';
import type { GameMetrics } from './metrics.js';
import { FakeSocket } from './testing.js';
import { CityShard, createCitySessionFactory, createSessionBuilder } from './sessions.js';
import { TEST_MAP, rawTestContent, testContent } from '../testing/content.js';

const logger = createLogger('silent', 'test');

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Ruleset instrumentado: conta AVANÇOS e muda de taxa com a presença de visualizador.
 *
 * O que estes testes verificam é o hospedeiro — com que cadência ele avança cada sessão, e se
 * ele perde ou repete tempo ao trocar de taxa. Isso não é observável por um evento agendado,
 * que só vence quando a regra de jogo manda: a instrumentação entra no `advanceBy` da própria
 * sessão, que é exatamente a fronteira que se quer medir.
 */
function countingRuleset(hzAttached = 10, hzDetached = 1) {
  const counter = { advances: 0, elapsedMs: 0, ended: 0 };
  const ruleset: Ruleset = {
    type: 'hunt',
    hz: (attached) => (attached ? hzAttached : hzDetached),
    onEnter: (session) => {
      const advance = session.advanceBy.bind(session);
      (session as unknown as { advanceBy: (dtMs: number) => void }).advanceBy = (dtMs) => {
        counter.advances += 1;
        counter.elapsedMs += dtMs;
        advance(dtMs);
      };
    },
    onEvent: () => {},
    onCreatureDied: () => {},
    onEnd: () => {
      counter.ended += 1;
    },
  };
  return { ruleset, counter };
}

function buildHost(
  ruleset: Ruleset,
  options: {
    now?: () => number;
    directory?: SessionDirectory;
    snapshots?: SnapshotStore;
    receipts?: ReceiptStore;
    restoreSession?: (snapshot: SessionSnapshot) => Session | null;
    buildSession?: NonNullable<SessionHostOptions['buildSession']>;
    metrics?: GameMetrics;
    // `NonNullable`: `SessionHostOptions['x']` já inclui `undefined`, e espalhar uma opcional
    // desse tipo é o que `exactOptionalPropertyTypes` recusa.
    acceptBotConfig?: NonNullable<SessionHostOptions['acceptBotConfig']>;
    itemCatalog?: NonNullable<SessionHostOptions['itemCatalog']>;
    saveBotConfig?: NonNullable<SessionHostOptions['saveBotConfig']>;
    level?: number;
  } = {},
) {
  const sessions: Session[] = [];
  // `level` é do PERSONAGEM de teste, não do host: tirar do espalhamento é o que impede
  // `exactOptionalPropertyTypes` de recusar uma chave que `SessionHostOptions` não tem.
  const { level, ...hostOptions } = options;
  const host = new SessionHost({
    nodeId: 'n1',
    contentVersion: 'v-test',
    logger,
    ...hostOptions,
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
        level: level ?? 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
      }));
      sessions.push(session);
      return session;
    },
  });
  return { host, sessions };
}

describe('session host', () => {
  it('drains crediting the progress and tells whoever is watching', async () => {
    // Um deploy com milhares de sessões desanexadas em voo destrói progresso de gente que
    // nem está lá para reagir. Encerrar creditando é o que o §38.4 permite explicitamente.
    const saved: Array<{ sessionId: string; seq: number; reason: string }> = [];
    const receipts = {
      save: async (r: { sessionId: string; seq: number; reason: string }) => {
        saved.push(r);
      },
    } as unknown as ReceiptStore;
    const directory = { register: async () => true } as unknown as SessionDirectory;
    const { ruleset, counter } = countingRuleset();
    const { host } = buildHost(ruleset, { directory, receipts });
    await host.prepare('p1', undefined, 'a1');
    const socket = new FakeSocket();
    host.attach(socket, 'p1');

    const ended = await host.drainAll('drain');

    expect(ended).toBe(1);
    expect(counter.ended).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.reason).toBe('drain');
    // `seq` avança na sessão: é metade da chave de idempotência do ledger (invariante 10).
    expect(saved[0]?.seq).toBe(1);

    const extrato = socket.received().find((m) => m.type === 'session-ended');
    expect(extrato).toBeDefined();
    if (extrato?.type !== 'session-ended') return;
    expect(extrato.reason).toBe('drain');
  });

  it('saves the receipt before telling the player', async () => {
    // A ordem é a diferença entre as duas metades ruins. Gravado e não avisado: o jogador
    // perdeu a mensagem, mas o crédito está no Redis esperando o `jobs`. Avisado e não
    // gravado: um extrato que nunca vai existir — a pior das duas.
    const order: string[] = [];
    const receipts = {
      save: async () => {
        order.push('receipt');
      },
    } as unknown as ReceiptStore;
    const directory = { register: async () => true } as unknown as SessionDirectory;
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, { directory, receipts });
    await host.prepare('p1', undefined, 'a1');
    const socket = new FakeSocket();
    const original = socket.send.bind(socket);
    socket.send = (data) => {
      order.push('viewer');
      return original(data);
    };
    host.attach(socket, 'p1');
    order.length = 0;

    await host.drainAll('drain');

    expect(order[0]).toBe('receipt');
    expect(order).toContain('viewer');
  });

  it('keeps draining when one session fails', async () => {
    // Drenagem interrompida no meio é PIOR que drenagem nenhuma: metade credita, metade
    // some, e ninguém sabe qual metade.
    let calls = 0;
    const receipts = {
      save: async () => {
        calls += 1;
        if (calls === 1) throw new Error('redis fora do ar');
      },
    } as unknown as ReceiptStore;
    const directory = { register: async () => true } as unknown as SessionDirectory;
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, { directory, receipts });
    await host.prepare('p1', undefined, 'a1');
    await host.prepare('p2', undefined, 'a1');

    const ended = await host.drainAll('drain');

    expect(calls).toBe(2);
    expect(ended).toBe(1);
  });


  it('resumes from a snapshot instead of starting the character over', async () => {
    // Sem isto, cair o processo devolveria o personagem no estado inicial — e o produto
    // inteiro é "a sessão sobrevive". Perder o progresso em silêncio é pior que a queda.
    const snapshot = { id: 's-antiga', type: 'city' } as unknown as SessionSnapshot;
    const snapshots = {
      load: async () => ({
        characterId: 'p1', accountId: 'a1', nodeId: 'n0',
        savedAtMs: Date.now() - 5 * 60_000, snapshot,
      }),
      save: async () => {},
      remove: async () => {},
    } as unknown as SnapshotStore;
    const restored = new Session({
      id: 's-retomada', contentVersion: 'v-test',
      ruleset: countingRuleset().ruleset, rng: Rng.fromSeed('x'), createdAtMs: 0,
    });
    const directory = { register: async () => true } as unknown as SessionDirectory;
    const { ruleset } = countingRuleset();
    const { host, sessions } = buildHost(ruleset, {
      directory, snapshots, restoreSession: () => restored,
    });

    await host.prepare('p1', undefined, 'a1');

    expect(host.sessionFor('p1')?.id).toBe('s-retomada');
    // A fábrica NÃO foi chamada: um personagem novo teria apagado a sessão retomada.
    expect(sessions).toHaveLength(0);
  });

  it('tells the player that the session was resumed, and how much was lost', async () => {
    // Silenciar aqui é como o modo idle perde a confiança de quem joga: o extrato não fecha
    // e ninguém explica por quê.
    const snapshots = {
      load: async () => ({
        characterId: 'p1', accountId: 'a1', nodeId: 'n0',
        savedAtMs: Date.now() - 7 * 60_000,
        snapshot: { id: 's', type: 'city' } as unknown as SessionSnapshot,
      }),
      save: async () => {},
      remove: async () => {},
    } as unknown as SnapshotStore;
    const restored = new Session({
      id: 's-retomada', contentVersion: 'v-test',
      ruleset: countingRuleset().ruleset, rng: Rng.fromSeed('x'), createdAtMs: 0,
    });
    const directory = { register: async () => true } as unknown as SessionDirectory;
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      directory, snapshots, restoreSession: () => restored,
    });
    await host.prepare('p1', undefined, 'a1');

    const socket = new FakeSocket();
    host.attach(socket, 'p1');
    host.flush();

    const warning = socket.received().find((m) => m.type === 'system-message');
    expect(warning).toBeDefined();
    if (warning?.type !== 'system-message') return;
    expect(warning.level).toBe('warning');
    expect(warning.text).toContain('7 min');
  });

  it('discards a snapshot it cannot rebuild instead of retrying forever', async () => {
    // Formato antigo ou ruleset desconhecido. Tentar de novo a cada reconexão deixaria o
    // personagem preso num laço que ninguém consegue diagnosticar.
    let removed = false;
    const snapshots = {
      load: async () => ({
        characterId: 'p1', accountId: 'a1', nodeId: 'n0', savedAtMs: Date.now(),
        snapshot: { id: 's', type: 'hunt' } as unknown as SessionSnapshot,
      }),
      save: async () => {},
      remove: async () => {
        removed = true;
      },
    } as unknown as SnapshotStore;
    const directory = { register: async () => true } as unknown as SessionDirectory;
    const { ruleset } = countingRuleset();
    const { host, sessions } = buildHost(ruleset, {
      directory, snapshots, restoreSession: () => null,
    });

    await host.prepare('p1', undefined, 'a1');

    expect(removed).toBe(true);
    // Caiu para a criação normal: melhor um personagem no estado inicial que nenhum.
    expect(sessions).toHaveLength(1);
  });


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
    const advancesBefore = counter.advances;
    const elapsedBefore = counter.elapsedMs;
    expect(advancesBefore).toBe(1);

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
    expect(counter.advances).toBe(advancesBefore + 1);
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
    expect(counter.advances).toBe(1);
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
    expect(counter.advances).toBe(10);

    viewer.markClosed();
    host.detach(viewer);
    for (let i = 11; i <= 20; i++) {
      now = i * 100;
      host.cycle();
    }
    // A 1 Hz, dez ciclos de 100 ms viram UM tick — com o mesmo tempo simulado dentro.
    expect(counter.advances).toBe(11);
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
    expect(counter.advances).toBe(0);
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

  it('answers session-attach with the current state, through the queue', () => {
    // ENFILEIRADO, não imediato. Mandar o estado na frente da fila o colocaria depois de
    // deltas que já esperavam, e o cliente aplicaria um passo antigo por cima do estado
    // atual — a troca de "completo" para "só deltas" tem que ser atômica.
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset);
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    socket.frames.length = 0;

    host.handle(viewer, { type: 'session-attach' });
    expect(socket.frames).toHaveLength(0);
    expect(viewer.queued).toBe(1);

    host.flush();
    const state = socket.received().find((m) => m.type === 'session-state');
    expect(state).toBeDefined();
    if (state?.type !== 'session-state') return;
    expect(state.self.characterId).toBe('p1');
    expect(state.self.creatureId).toBe(1);
    expect(state.self.maxHealth).toBe(100);
    expect(state.world.creatures).toHaveLength(1);
    expect(state.world.creatures[0]?.id).toBe(1);
    // Estado, não replay: o que vai é onde as coisas estão e o agregado, nunca a fila.
    expect(state.aggregates.durationMs).toBe(0);
  });

  it('keeps the same creature number across reattachments', () => {
    // Renumerar a cada pedido faria o cliente achar que a criatura antiga sumiu e outra
    // apareceu no mesmo lugar — e a câmera perderia o alvo no meio de um passo.
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset);
    const viewer = host.attach(new FakeSocket(), 'p1');

    host.handle(viewer, { type: 'session-attach' });
    host.handle(viewer, { type: 'session-attach' });
    host.flush();

    const ids = (viewer as unknown as { characterId: string }).characterId;
    expect(ids).toBe('p1');
    expect(host.sessionFor('p1')).toBeDefined();
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

  it('ends the session and gives the slot back on logout', async () => {
    // Sair do jogo não é desconectar. Enquanto o `logout` só fechava o socket, NADA no
    // servidor devolvia um slot de personagem ativo: dois personagens que já tivessem
    // conectado esgotavam o teto até o processo reiniciar (FUN-52).
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
    await host.prepare('p1', undefined, 'a1');
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');

    host.handle(viewer, { type: 'logout' });
    // Esperar pela ÚLTIMA coisa que a saída faz. Esperar pelo sumiço da sessão local resolve
    // antes das chamadas ao diretório, e a asserção do slot vira corrida.
    await vi.waitFor(() => expect(slotsReleased).toEqual([['a1', 'p1']]));

    expect(host.sessionFor('p1')).toBeUndefined();
    expect(socket.ended?.code).toBe(1000);
    expect(counter.ended).toBe(1);
    expect(released).toEqual(['p1']);
  });

  it('closes every tab of the character on logout, not just the one that asked', async () => {
    // Sair do jogo é do personagem, não da aba. A outra aba ficaria olhando uma sessão que
    // não existe mais, sem atualizar e sem dizer por quê.
    const directory = {
      register: async () => true,
      release: async () => {},
      releaseSlot: async () => {},
    } as unknown as SessionDirectory;
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, { directory });
    await host.prepare('p1', undefined, 'a1');
    const first = new FakeSocket();
    const second = new FakeSocket();
    const viewer = host.attach(first, 'p1');
    host.attach(second, 'p1');

    host.handle(viewer, { type: 'logout' });
    await vi.waitFor(() => expect(host.sessionFor('p1')).toBeUndefined());

    expect(first.ended?.code).toBe(1000);
    expect(second.ended?.code).toBe(1000);
    expect(host.viewersOf('p1')).toBe(0);
  });

  it('keeps the session when the socket merely closes', () => {
    // O contraponto do teste acima, e o ADR 0001 em uma linha: desconectar não encerra.
    const { ruleset, counter } = countingRuleset();
    const { host } = buildHost(ruleset);
    const viewer = host.attach(new FakeSocket(), 'p1');

    viewer.markClosed();
    host.detach(viewer);

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
    expect(counter.advances).toBe(1);
  });
});


describe('a sessão que acaba sozinha devolve o personagem à próxima (FUN-38)', () => {
  /** Ruleset que mata o personagem no primeiro tick, como uma hunt faz na morte (§26.1). */
  function lethalRuleset(): Ruleset {
    return {
      type: 'hunt',
      hz: () => 10,
      onEnter: (session) => {
        // Mata no primeiro evento, como uma hunt faz na morte (§26.1).
        session.scheduleIn('lethal', 0);
      },
      onEvent: (session) => {
        const character = session.participants[0];
        if (character !== undefined && character.alive) session.kill(character);
      },
      onCreatureDied: (session) => {
        session.end('death');
      },
      onEnd: () => {},
    };
  }

  /** Construtor de mentira: uma sessão de Cidade que cura, como a de verdade faz no `onEnter`. */
  function citySuccessor(): (request: { to: string }, ended: Session) => Session {
    return (_request, ended) => {
      const session = new Session({
        id: `city-${ended.id}`,
        contentVersion: 'v-test',
        ruleset: {
          type: 'city',
          // Como a Cidade de verdade desde a FUN-71: um duplo que não fosse shard faria estes
          // testes exercitarem um caminho que a produção não tem mais.
          shared: true,
          hz: () => 0,
          onEnter: (_s, character) => {
            character.health = character.maxHealth;
            character.alive = true;
          },
          onEvent: () => {},
          onCreatureDied: () => {},
          onEnd: () => {},
        },
        rng: Rng.fromSeed(ended.id),
        createdAtMs: ended.nowMs,
      });
      for (const character of ended.participants) session.enter(character);
      return session;
    };
  }

  it('acontece SEM ninguém olhando — é o caso que importa', async () => {
    // O jogador não está lá quando morre numa hunt AFK. Se a sequência só funcionasse com
    // visualizador, o invariante 3 estaria quebrado — e o jeito de descobrir seria um
    // personagem preso numa sessão encerrada até alguém reconectar.
    const saved: Array<{ reason: string }> = [];
    const receipts = {
      save: async (r: { reason: string }) => { saved.push(r); },
    } as unknown as ReceiptStore;
    const directory = {
      register: async () => true,
      succeed: async () => true,
    } as unknown as SessionDirectory;
    const { host } = buildHost(lethalRuleset(), {
      directory, receipts, buildSession: citySuccessor(), now: () => 1000,
    });
    await host.prepare('p1', undefined, 'a1');
    // Nenhum `attach`: ninguém está assistindo.
    expect(host.viewersOf('p1')).toBe(0);

    host.cycle(1100);
    await vi.waitFor(() => expect(host.sessionFor('p1')?.ruleset.type).toBe('city'));

    expect(saved).toHaveLength(1);
    expect(saved[0]?.reason).toBe('death');
    // Voltou à PZ com vida cheia (§26.1) — e curado DEPOIS de encerrar, não antes.
    const character = host.sessionFor('p1')?.participants[0];
    expect(character?.health).toBe(character?.maxHealth);
    expect(character?.alive).toBe(true);
  });

  it('grava o extrato ANTES de trocar de sessão', async () => {
    // Morrer e o processo cair em seguida deixa o crédito no Redis esperando o `jobs`. A
    // troca sem o crédito seria uma morte que não custou nada e não rendeu nada.
    const order: string[] = [];
    const receipts = {
      save: async () => { order.push('receipt'); },
    } as unknown as ReceiptStore;
    const directory = {
      register: async () => true,
      succeed: async () => { order.push('directory'); return true; },
    } as unknown as SessionDirectory;
    const { host } = buildHost(lethalRuleset(), {
      directory, receipts, buildSession: citySuccessor(), now: () => 1000,
    });
    await host.prepare('p1', undefined, 'a1');

    host.cycle(1100);
    await vi.waitFor(() => expect(order).toEqual(['receipt', 'directory']));
  });

  it('leva junto quem estava olhando, em vez de derrubar o socket', async () => {
    const directory = {
      register: async () => true, succeed: async () => true,
    } as unknown as SessionDirectory;
    const { host } = buildHost(lethalRuleset(), {
      directory, buildSession: citySuccessor(), now: () => 1000,
    });
    await host.prepare('p1', undefined, 'a1');
    const socket = new FakeSocket();
    host.attach(socket, 'p1');

    host.cycle(1100);
    await vi.waitFor(() => expect(host.sessionFor('p1')?.ruleset.type).toBe('city'));
    host.flush();

    const types = socket.received().map((m) => m.type);
    // O extrato vem ANTES do estado novo: ver a cidade aparecer e só depois descobrir que
    // morreu é a ordem errada de contar a mesma notícia.
    expect(types.indexOf('session-ended')).toBeLessThan(types.lastIndexOf('session-state'));
    expect(socket.ended).toBeNull();
  });

  it('a morte APAGA o snapshot da hunt, em vez de deixá-lo de pé', async () => {
    // A morte é marco de snapshot, e a Cidade é um shard, que não tem snapshot (ADR 0023). As
    // duas coisas juntas dão UMA obrigação: apagar.
    //
    // Não apagar é o defeito silencioso — quem morre volta para a praça, o snapshot da hunt
    // já creditada fica no Redis, e a próxima conexão RETOMA a hunt encerrada, creditando de
    // novo. Antes da FUN-71 o `save` da Cidade cobria essa linha por acidente; com o shard,
    // não há mais o que salvar por cima.
    const acts: string[] = [];
    const snapshots = {
      save: async (_c: string, _a: string, _n: string, snapshot: SessionSnapshot) => {
        acts.push(`save:${snapshot.type}`);
      },
      load: async () => null,
      remove: async (characterId: string) => { acts.push(`remove:${characterId}`); },
    } as unknown as SnapshotStore;
    const directory = {
      register: async () => true, succeed: async () => true,
    } as unknown as SessionDirectory;
    const { host } = buildHost(lethalRuleset(), {
      directory, snapshots, buildSession: citySuccessor(), now: () => 1000,
    });
    await host.prepare('p1', undefined, 'a1');

    host.cycle(1100);
    await vi.waitFor(() => expect(acts).toEqual(['remove:p1']));
  });

  it('solta o personagem quando o registro no diretório trocou de dono', async () => {
    // Insistir seria escrever por cima de um dono que já não somos nós — e duas cópias da
    // mesma sessão dobram XP e loot, que é pior que uma sessão perdida.
    const directory = {
      register: async () => true,
      succeed: async () => false,
      release: async () => {},
      releaseSlot: async () => {},
    } as unknown as SessionDirectory;
    const { host } = buildHost(lethalRuleset(), {
      directory, buildSession: citySuccessor(), now: () => 1000,
    });
    await host.prepare('p1', undefined, 'a1');

    host.cycle(1100);
    await vi.waitFor(() => expect(host.sessionFor('p1')).toBeUndefined());
  });

  it('a Cidade não sucede a si mesma: sem sucessor, o personagem é solto', async () => {
    const directory = {
      register: async () => true, release: async () => {}, releaseSlot: async () => {},
    } as unknown as SessionDirectory;
    const { host } = buildHost(lethalRuleset(), {
      directory, buildSession: () => null, now: () => 1000,
    });
    await host.prepare('p1', undefined, 'a1');

    host.cycle(1100);
    await vi.waitFor(() => expect(host.sessionFor('p1')).toBeUndefined());
  });
});

describe('máquina de estados do personagem (FUN-30)', () => {
  const quiet = (type: 'city' | 'hunt'): Ruleset => ({
    type,
    hz: () => (type === 'city' ? 0 : 10),
    onEnter: () => {},
    onEvent: () => {},
    onCreatureDied: () => {},
    onEnd: () => {},
  });

  /** Constrói o destino, e conta quantas vezes foi chamado. */
  const builder = (): {
    build: (request: { to: string }, from: Session) => Session | null;
    built: string[];
  } => {
    const built: string[] = [];
    return {
      built,
      build: (request, from) => {
        built.push(request.to);
        const session = new Session({
          id: `${request.to}-${built.length}`,
          contentVersion: 'v-test',
          ruleset: quiet(request.to as 'city' | 'hunt'),
          rng: Rng.fromSeed(request.to),
          createdAtMs: from.nowMs,
        });
        for (const character of from.participants) session.enter(character);
        return session;
      },
    };
  };

  const cityHost = (options: Record<string, unknown> = {}) => {
    const directory = {
      register: async () => true, succeed: async () => true,
      release: async () => {}, releaseSlot: async () => {},
    } as unknown as SessionDirectory;
    return buildHost(quiet('city'), { directory, ...options });
  };

  it('leva o personagem da Cidade para a hunt, com sessão nova', async () => {
    const { build } = builder();
    const { host } = cityHost({ buildSession: build });
    await host.prepare('p1', undefined, 'a1');
    const antes = host.sessionFor('p1');

    await host.transition('p1', { to: 'hunt', huntId: 'arena', difficulty: 'beginner' });

    expect(host.sessionFor('p1')?.ruleset.type).toBe('hunt');
    expect(host.sessionFor('p1')).not.toBe(antes);
    // O personagem é o MESMO objeto: reconstruir perderia o que a sessão anterior mudou nele.
    expect(host.sessionFor('p1')?.participants[0]).toBe(antes?.participants[0]);
  });

  it('recusa transição inválida com erro claro, e não mexe na sessão', async () => {
    // Não se vai de hunt direto para boss: a Cidade é o centro (§6).
    const { build } = builder();
    const { host } = buildHost(quiet('hunt'), {
      directory: { register: async () => true } as unknown as SessionDirectory,
      buildSession: build,
    });
    await host.prepare('p1', undefined, 'a1');
    const antes = host.sessionFor('p1');

    await expect(host.transition('p1', { to: 'boss' })).rejects.toThrow(/volte para a cidade/);
    expect(host.sessionFor('p1')).toBe(antes);
  });

  it('recusa ir para onde já se está', async () => {
    const { build } = builder();
    const { host } = cityHost({ buildSession: build });
    await host.prepare('p1', undefined, 'a1');

    await expect(host.transition('p1', { to: 'city' })).rejects.toThrow(/já está/);
  });

  it('duas transições disputadas resultam em EXATAMENTE uma sessão', async () => {
    // É o requisito difícil da issue. Sem a trava, as duas leriam a mesma sessão de origem e
    // a segunda tentaria trocar um registro que a primeira já trocou — a CAS recusaria, e o
    // caminho de recusa SOLTA o personagem. Perder a corrida derrubaria o jogador do jogo.
    const { build, built } = builder();
    const { host } = cityHost({ buildSession: build });
    await host.prepare('p1', undefined, 'a1');

    const primeira = host.transition('p1', { to: 'hunt', huntId: 'a', difficulty: 'beginner' });
    const segunda = host.transition('p1', { to: 'hunt', huntId: 'b', difficulty: 'beginner' });

    await expect(primeira).resolves.toBeUndefined();
    await expect(segunda).rejects.toThrow(/já está em andamento/);
    // Uma construída, uma sessão hospedada, um personagem.
    expect(built).toEqual(['hunt']);
    expect(host.sessionCount).toBe(1);
    expect(host.sessionFor('p1')?.ruleset.type).toBe('hunt');
  });

  it('destino que este servidor não constrói deixa o personagem onde estava', async () => {
    // Construir ANTES de encerrar: se o destino não existe, a sessão antiga não pode já ter
    // sido fechada — senão o personagem fica sem nenhuma.
    const { host } = cityHost({ buildSession: () => null });
    await host.prepare('p1', undefined, 'a1');
    const antes = host.sessionFor('p1');

    await expect(host.transition('p1', { to: 'hunt' })).rejects.toThrow(/não constrói/);
    expect(host.sessionFor('p1')).toBe(antes);
    expect(antes?.ended).toBeNull();
  });

  it('a mensagem do cliente é INTENÇÃO: a recusa volta como aviso, não como socket fechado',
    async () => {
      // O cliente pediu algo inválido, não algo malicioso. Derrubar o socket faria o jogador
      // levar uma desconexão por ter clicado no botão errado.
      const { build } = builder();
      const { host } = cityHost({ buildSession: build });
      await host.prepare('p1', undefined, 'a1');
      const socket = new FakeSocket();
      const viewer = host.attach(socket, 'p1');

      // Já está na cidade: sair da hunt não faz sentido.
      host.handle(viewer, { type: 'leave-hunt' });
      await vi.waitFor(() => {
        host.flush();
        expect(socket.received().some((m) => m.type === 'system-message')).toBe(true);
      });

      expect(socket.ended).toBeNull();
      expect(host.sessionFor('p1')?.ruleset.type).toBe('city');
    });

  it('entrar numa hunt pela mensagem do cliente troca a sessão e manda o estado novo',
    async () => {
      const { build } = builder();
      const { host } = cityHost({ buildSession: build });
      await host.prepare('p1', undefined, 'a1');
      const socket = new FakeSocket();
      const viewer = host.attach(socket, 'p1');

      host.handle(viewer, { type: 'enter-hunt', huntId: 'arena', difficulty: 'beginner' });
      await vi.waitFor(() => expect(host.sessionFor('p1')?.ruleset.type).toBe('hunt'));
      host.flush();

      const estados = socket.received().filter((m) => m.type === 'session-state');
      expect(estados.length).toBeGreaterThan(0);
    });
});

describe('sessão de repouso não segura o slot para sempre (FUN-52)', () => {
  const resting = (): Ruleset => ({
    // Orientada a evento, como a Cidade: sem laço nenhum.
    type: 'city', hz: () => 0,
    onEnter: () => {}, onEvent: () => {}, onCreatureDied: () => {}, onEnd: () => {},
  });

  const GRACE_MS = 5 * 60_000;

  const releasing = () => {
    const released: string[] = [];
    const directory = {
      register: async () => true,
      release: async (characterId: string) => { released.push(characterId); },
      releaseSlot: async () => {},
    } as unknown as SessionDirectory;
    return { directory, released };
  };

  it('devolve o slot depois da carência, quando ninguém está olhando', async () => {
    // O defeito: quem fechava o navegador deixava a sessão de cidade de pé para sempre, e o
    // terceiro personagem da conta não conectava mais. Reiniciar o nó "resolvia" — o que
    // escondia o problema em desenvolvimento e o deixava aparecer só em produção.
    const { directory, released } = releasing();
    let now = 0;
    const { host } = buildHost(resting(), { directory, now: () => now });
    await host.prepare('p1', undefined, 'a1');
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    host.detach(viewer);

    now += GRACE_MS + 1;
    host.cycle(now);

    await vi.waitFor(() => expect(released).toEqual(['p1']));
    expect(host.sessionFor('p1')).toBeUndefined();
  });

  it('não recolhe dentro da carência: recarregar a página não pode custar a sessão', async () => {
    const { directory, released } = releasing();
    let now = 0;
    const { host } = buildHost(resting(), { directory, now: () => now });
    await host.prepare('p1', undefined, 'a1');
    const viewer = host.attach(new FakeSocket(), 'p1');
    host.detach(viewer);

    now += GRACE_MS - 1;
    host.cycle(now);

    expect(released).toEqual([]);
    expect(host.sessionFor('p1')).toBeDefined();
  });

  it('reconectar dentro da carência reencontra a MESMA sessão', async () => {
    // É o ADR 0001 e o teste de integração que o codifica: desanexar não encerra nada.
    const { directory } = releasing();
    let now = 0;
    const { host } = buildHost(resting(), { directory, now: () => now });
    await host.prepare('p1', undefined, 'a1');
    const antes = host.sessionFor('p1');
    host.detach(host.attach(new FakeSocket(), 'p1'));

    now += GRACE_MS - 1;
    host.cycle(now);
    host.attach(new FakeSocket(), 'p1');
    now += GRACE_MS * 10;
    host.cycle(now);

    // Com visualizador de volta, o relógio de repouso zerou: não é recolhida nunca mais.
    expect(host.sessionFor('p1')).toBe(antes);
  });

  it('NUNCA recolhe uma hunt desanexada, por mais tempo que passe', async () => {
    // A linha que separa "repouso" de "progresso sem ninguém olhando". Recolher aqui seria o
    // fim do modo idle, que é o modo PADRÃO do jogo.
    const { directory, released } = releasing();
    let now = 0;
    const { ruleset } = countingRuleset(10, 1);
    const { host } = buildHost(ruleset, { directory, now: () => now });
    await host.prepare('p1', undefined, 'a1');
    host.detach(host.attach(new FakeSocket(), 'p1'));

    now += GRACE_MS * 100;
    host.cycle(now);

    expect(released).toEqual([]);
    expect(host.sessionFor('p1')).toBeDefined();
  });

  it('um ticket emitido e nunca usado também não segura o slot', async () => {
    // `prepare` cria a sessão antes de o socket subir. Se o jogador nunca conecta, a sessão
    // nasce sem visualizador e ficaria de pé para sempre.
    const { directory, released } = releasing();
    let now = 0;
    const { host } = buildHost(resting(), { directory, now: () => now });
    await host.prepare('p1', undefined, 'a1');

    now += GRACE_MS + 1;
    host.cycle(now);

    await vi.waitFor(() => expect(released).toEqual(['p1']));
  });
});

describe('soltar a sessão credita antes de descartá-la (FUN-52)', () => {
  it('logout dentro de uma sessão com progresso não joga a XP fora', async () => {
    // Desde a FUN-54 o extrato é o único caminho até o banco, e o `release` apaga o snapshot
    // logo em seguida — as duas cópias do progresso. Sem creditar antes, sair do jogo dentro
    // de uma hunt custaria a sessão inteira.
    const saved: Array<{ reason: string; seq: number }> = [];
    const receipts = {
      save: async (r: { reason: string; seq: number }) => { saved.push(r); },
    } as unknown as ReceiptStore;
    const directory = {
      register: async () => true, release: async () => {}, releaseSlot: async () => {},
    } as unknown as SessionDirectory;
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, { directory, receipts });
    await host.prepare('p1', undefined, 'a1');

    await host.release('p1');

    expect(saved).toHaveLength(1);
    expect(saved[0]?.seq).toBe(1);
  });

  it('mas NÃO credita duas vezes quando a drenagem já creditou', async () => {
    // A drenagem grava e depois solta. Sem a marca, o `release` gravaria de novo com um `seq`
    // novo — que a chave única do ledger não teria como recusar, e o jogador receberia o
    // mesmo gold duas vezes.
    const saved: Array<{ seq: number }> = [];
    const receipts = {
      save: async (r: { seq: number }) => { saved.push(r); },
    } as unknown as ReceiptStore;
    const directory = {
      register: async () => true, release: async () => {}, releaseSlot: async () => {},
    } as unknown as SessionDirectory;
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, { directory, receipts });
    await host.prepare('p1', undefined, 'a1');

    await host.drainAll('drain');

    expect(saved).toHaveLength(1);
  });
});

describe('o host alimenta as métricas do nó (FUN-47)', () => {
  const observed = () => {
    const ticks: Array<{ type: string; durationUs: number; lagMs: number }> = [];
    const sessions: Array<ReadonlyMap<string, number>> = [];
    const frames: Array<{ messages: number; bytes: number }> = [];
    const reattaches: number[] = [];
    const slots: number[] = [];
    const metrics = {
      observeTick: (type: string, durationUs: number, lagMs: number) => {
        ticks.push({ type, durationUs, lagMs });
      },
      observeSessions: (counts: ReadonlyMap<string, number>) => { sessions.push(counts); },
      observeFrame: (messages: number, bytes: number) => { frames.push({ messages, bytes }); },
      observeReattach: (ms: number) => { reattaches.push(ms); },
      observeSlots: (max: number) => { slots.push(max); },
    };
    return { metrics, ticks, sessions, frames, reattaches, slots };
  };

  it('mede o custo de cada tick, por tipo de sessão', async () => {
    // É a métrica que mais importa cedo: toda a projeção de custo do projeto depende dela.
    const seen = observed();
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      directory: { register: async () => true } as unknown as SessionDirectory,
      metrics: seen.metrics as never,
      // Relógio dirigido. O hospedeiro conta o atraso desde o último avanço DESTA sessão
      // (FUN-68), então a hora em que ela foi criada faz parte da conta — com o relógio real,
      // o quanto o processo já tinha rodado entraria no resultado.
      now: () => 0,
    });
    await host.prepare('p1', undefined, 'a1');

    host.cycle(1100);

    expect(seen.ticks).toHaveLength(1);
    expect(seen.ticks[0]?.type).toBe('hunt');
    expect(seen.ticks[0]?.durationUs).toBeGreaterThanOrEqual(0);
  });

  it('o ATRASO é o que passou do período pedido, não o intervalo', async () => {
    // Um tick de 1 Hz a cada 1000 ms está no prazo; o mesmo intervalo a 10 Hz é 900 ms de
    // atraso, e é essa diferença que diz que o nó saturou.
    const seen = observed();
    // Desanexada roda a 1 Hz: período de 1000 ms.
    const { ruleset } = countingRuleset(10, 1);
    const { host } = buildHost(ruleset, {
      directory: { register: async () => true } as unknown as SessionDirectory,
      metrics: seen.metrics as never,
      now: () => 0,
    });
    await host.prepare('p1', undefined, 'a1');

    // Criada em 0, avançada em 3000, período de 1000: dois segundos de atraso.
    host.cycle(3000);

    expect(seen.ticks[0]?.lagMs).toBe(2000);
  });

  it('reconta as sessões por ciclo, em vez de manter um contador espalhado', async () => {
    // Um contador incremental erra na primeira aresta que alguém esquecer, e erra DEVAGAR: o
    // painel vai ficando errado sem nada quebrar.
    const seen = observed();
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      directory: { register: async () => true } as unknown as SessionDirectory,
      metrics: seen.metrics as never,
    });
    await host.prepare('p1', undefined, 'a1');
    host.attach(new FakeSocket(), 'p1');

    host.cycle(1100);

    expect([...(seen.sessions.at(-1) ?? [])]).toEqual([['hunt|true', 1]]);
    expect(seen.slots.at(-1)).toBe(1);
  });

  it('conta mensagens e bytes do quadro que saiu no fio', async () => {
    const seen = observed();
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      directory: { register: async () => true } as unknown as SessionDirectory,
      metrics: seen.metrics as never,
    });
    await host.prepare('p1', undefined, 'a1');
    // `welcome` sai por `sendNow`, fora da fila; o estado vai pela fila e é o que o flush manda.
    const viewer = host.attach(new FakeSocket(), 'p1');
    host.handle(viewer, { type: 'session-attach' });
    host.flush();

    expect(seen.frames.length).toBeGreaterThan(0);
    expect(seen.frames.at(-1)?.bytes).toBeGreaterThan(0);
  });

  it('mede quanto custou pôr o personagem de volta numa sessão', async () => {
    const seen = observed();
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      directory: { register: async () => true } as unknown as SessionDirectory,
      metrics: seen.metrics as never,
    });

    await host.prepare('p1', undefined, 'a1');

    expect(seen.reattaches).toHaveLength(1);
    expect(seen.reattaches[0]).toBeGreaterThanOrEqual(0);
  });
});

describe('snapshot que não volta é CREDITADO antes de sumir (FUN-55)', () => {
  const stored = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
    formatVersion: 2, contentVersion: 'v-test', id: 's-antiga', type: 'hunt',
    createdAtMs: 0, logicalNowMs: 60_000, schedule: { events: [], nextSeq: 0 },
    rng: { a: 1, b: 2, c: 3, d: 4 },
    participants: [{
      id: 'p1', position: { x: 1, y: 1, z: 7 }, health: 100, maxHealth: 100, mana: 0,
      maxMana: 0, level: 4, xp: 900, vocationId: null, staminaMs: 10_000,
      staminaUpdatedAtMs: 5, goldDelta: 0, alive: true, cooldowns: {},
    }],
    aggregates: {
      durationMs: 600_000, xpGained: 900, goldGained: 40, goldSpent: 0, kills: 12, deaths: 0,
       itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
    },
    notableEvents: [{ atMs: 1_000, type: 'level-up', detail: '4' }],
    ledgerSeq: 0, endedReason: null,
    ...over,
  });

  const withSnapshots = (snapshot: SessionSnapshot) => {
    const removed: string[] = [];
    const saved: Array<{ sessionId: string; seq: number; reason: string; xpGained: number }> = [];
    const snapshots = {
      load: async () => ({ snapshot, savedAtMs: Date.now() }),
      remove: async (characterId: string) => { removed.push(characterId); },
      save: async () => {},
    } as unknown as SnapshotStore;
    const receipts = {
      save: async (receipt: {
        sessionId: string; seq: number; reason: string;
        aggregates: { xpGained: number };
      }) => {
        saved.push({
          sessionId: receipt.sessionId, seq: receipt.seq, reason: receipt.reason,
          xpGained: receipt.aggregates.xpGained,
        });
      },
    } as unknown as ReceiptStore;
    return { snapshots, receipts, removed, saved };
  };

  it('credita o progresso do snapshot que este servidor não sabe reconstruir', async () => {
    // Descartar em silêncio é o oposto do que o ADR 0010 decide para o mesmo problema —
    // encerrar creditando — e o §38.4 é explícito que hunt AFK não pode sumir sem explicação.
    const snapshot = stored();
    const { snapshots, receipts, removed, saved } = withSnapshots(snapshot);
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      directory: { register: async () => true } as unknown as SessionDirectory,
      snapshots, receipts,
      restoreSession: () => null,
    });

    await host.prepare('p1', undefined, 'a1');

    expect(saved).toEqual([{
      sessionId: 's-antiga', seq: 1, reason: 'drain', xpGained: 900,
    }]);
    // Só DEPOIS de creditar é que o snapshot some.
    expect(removed).toEqual(['p1']);
    // E o personagem entra numa sessão nova, em vez de ficar sem nenhuma.
    expect(host.sessionFor('p1')).toBeDefined();
  });

  it('o `seq` sai do snapshot, e é ele que impede creditar duas vezes', async () => {
    // Um snapshot que sobreviveu a uma drenagem parcial já tem `ledgerSeq` avançado. Ignorar
    // isso e usar `1` faria o mesmo progresso entrar no ledger com um `seq` que a chave única
    // não teria como recusar.
    const { snapshots, receipts, saved } = withSnapshots(stored({ ledgerSeq: 3 }));
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      directory: { register: async () => true } as unknown as SessionDirectory,
      snapshots, receipts,
      restoreSession: () => null,
    });

    await host.prepare('p1', undefined, 'a1');

    expect(saved[0]?.seq).toBe(4);
  });

  it('se o crédito falhar, o snapshot NÃO é apagado', async () => {
    // Perder o crédito é o defeito que este caminho existe para não ter. Falhar a conexão é
    // recuperável — o jogador tenta de novo em segundos e o progresso continua lá.
    const { snapshots, removed } = withSnapshots(stored());
    const receipts = {
      save: async () => { throw new Error('redis is down'); },
    } as unknown as ReceiptStore;
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      directory: { register: async () => true } as unknown as SessionDirectory,
      snapshots, receipts,
      restoreSession: () => null,
    });

    await expect(host.prepare('p1', undefined, 'a1')).rejects.toThrow(/redis is down/);
    expect(removed).toEqual([]);
  });
});

describe('walk pelo socket passa pelo sistema de movimento (FUN-69)', () => {
  /** Um host com sessões de Cidade DE VERDADE — mapa, ponto de entrada e legalidade. */
  const cityHost = () => new SessionHost({
    nodeId: 'n1', contentVersion: 'v-test', logger,
    createSession: createCitySessionFactory(testContent()),
    now: () => 0,
  });

  it('move o personagem e quem está olhando recebe UM creature-move, com duração', () => {
    // `creature-move` não tinha emissor nenhum antes desta issue. Um passo é enviado uma vez,
    // com origem, destino e duração — o cliente interpola o intervalo inteiro (ADR 0001).
    const host = cityHost();
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    socket.frames.length = 0;

    // Nasceu no entryPoint do mapa de teste, e não em (0,0) — é a FUN-60.
    expect(host.sessionFor('p1')?.participants[0]?.position).toEqual({ x: 2, y: 2, z: 7 });

    host.handle(viewer, { type: 'walk', direction: 'north' });
    host.flush();

    const moves = socket.received().filter((m) => m.type === 'creature-move');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      from: { x: 2, y: 2, z: 7 }, to: { x: 2, y: 1, z: 7 }, durationMs: 500,
    });
    expect(host.sessionFor('p1')?.participants[0]?.position).toEqual({ x: 2, y: 1, z: 7 });
  });

  it('recusa em silêncio: parede, teleporte por walk-to, e nada sai no lote', () => {
    // `walk` sai dezenas de vezes por segundo de um cliente segurando a tecla. Responder
    // cada recusa geraria tráfego de volta a partir de tráfego de entrada.
    const host = cityHost();
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    host.handle(viewer, { type: 'walk', direction: 'north' });   // (2,1)
    host.flush();
    socket.frames.length = 0;

    host.handle(viewer, { type: 'walk', direction: 'north' });   // (2,0) é parede
    host.handle(viewer, { type: 'walk-to', destination: { x: 4, y: 4, z: 7 } }); // dois tiles
    host.flush();

    expect(socket.received().filter((m) => m.type === 'creature-move')).toHaveLength(0);
    expect(host.sessionFor('p1')?.participants[0]?.position).toEqual({ x: 2, y: 1, z: 7 });
  });

  it('walk-to adjacente anda; a origem é o que o SERVIDOR sabe, nunca o que o cliente diz', () => {
    const host = cityHost();
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    socket.frames.length = 0;

    host.handle(viewer, { type: 'walk-to', destination: { x: 3, y: 3, z: 7 } });
    host.flush();

    const move = socket.received().find((m) => m.type === 'creature-move');
    expect(move).toMatchObject({ from: { x: 2, y: 2, z: 7 }, to: { x: 3, y: 3, z: 7 } });
  });
});

describe('say (FUN-58)', () => {
  const quietCity = (): Ruleset => ({
    type: 'city', hz: () => 0, onEnter: () => {}, onEvent: () => {}, onCreatureDied: () => {}, onEnd: () => {},
  });
  const chatHost = () => {
    const directory = {
      register: async () => true, succeed: async () => true,
      release: async () => {}, releaseSlot: async () => {},
    } as unknown as SessionDirectory;
    return buildHost(quietCity(), { directory });
  };
  const chats = (socket: FakeSocket) => socket.received().filter((m) => m.type === 'chat-message');

  it('chega a todos os visualizadores da sessão, o autor inclusive, assinado com o nome do ticket', async () => {
    // Duas abas do mesmo personagem são dois visualizadores da MESMA sessão. As duas recebem,
    // e a que falou também: é o eco que confirma que a mensagem saiu.
    const { host } = chatHost();
    await host.prepare('p1', { level: 1, xp: 0, name: 'Hero' }, 'a1');
    const socketA = new FakeSocket();
    const socketB = new FakeSocket();
    const viewerA = host.attach(socketA, 'p1');
    host.attach(socketB, 'p1');

    host.handle(viewerA, { type: 'say', channel: 'local', text: '  olá  ' });
    host.flush();

    const expected = { type: 'chat-message', channel: 'local', author: 'Hero', text: 'olá' };
    expect(chats(socketA)).toEqual([expected]);
    expect(chats(socketB)).toEqual([expected]);
  });

  it('não vaza para visualizador de OUTRA sessão', async () => {
    const { host } = chatHost();
    await host.prepare('p1', { level: 1, xp: 0, name: 'One' }, 'a1');
    await host.prepare('p2', { level: 1, xp: 0, name: 'Two' }, 'a2');
    const socket1 = new FakeSocket();
    const socket2 = new FakeSocket();
    const viewer1 = host.attach(socket1, 'p1');
    host.attach(socket2, 'p2');

    host.handle(viewer1, { type: 'say', channel: 'local', text: 'oi' });
    host.flush();

    expect(chats(socket1)).toHaveLength(1);
    expect(chats(socket2)).toHaveLength(0);
  });

  it('canal desconhecido, texto vazio e caractere de controle: nada sai, nem erro', async () => {
    // Sem resposta de propósito: um cliente com bug mandando em laço não pode gerar
    // tráfego de volta. `\u200b` (zero-width) e `\u202e` (bidi override) são como se
    // falsifica o nome de autor na tela.
    const { host } = chatHost();
    await host.prepare('p1', { level: 1, xp: 0, name: 'Hero' }, 'a1');
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');

    host.handle(viewer, { type: 'say', channel: 'global', text: 'oi' });
    host.handle(viewer, { type: 'say', channel: 'local', text: '   ' });
    host.handle(viewer, { type: 'say', channel: 'local', text: 'oi\u200b' });
    host.handle(viewer, { type: 'say', channel: 'local', text: '\u202eHero: oi' });
    host.flush();

    expect(socket.received().filter((m) => m.type !== 'welcome')).toHaveLength(0);
  });

  it('sem nome no ticket, assina com o id — nunca cala', async () => {
    // Ticket de um `api` antigo, durante deploy em rolagem. Degradação, não perda.
    const { host } = chatHost();
    await host.prepare('p1', { level: 1, xp: 0 }, 'a1');
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');

    host.handle(viewer, { type: 'say', channel: 'local', text: 'oi' });
    host.flush();

    expect(chats(socket)).toEqual([{ type: 'chat-message', channel: 'local', author: 'p1', text: 'oi' }]);
  });
});

describe('configuração do bot pelo socket (FUN-81)', () => {
  const CONFIG = {
    version: 1,
    heal: [{
      when: { kind: 'hp', op: '<=', percent: 50 }, do: { kind: 'spell', spellId: 'heal' },
    }],
    potion: [], attack: [], rune: [], support: [],
  };

  /** Um validador de teste: aceita o que tiver `version`, recusa o resto com motivo. */
  const accepting: NonNullable<SessionHostOptions['acceptBotConfig']> = (raw, level) => {
    const config = raw as { version?: number; avancado?: boolean };
    if (config?.version !== 1) return { ok: false, reason: 'configuração fora do vocabulário' };
    if (config.avancado === true && level < 50) {
      return { ok: false, reason: 'bot avançado exige level 50' };
    }
    return { ok: true, config: config as never };
  };

  const mensagens = (socket: FakeSocket) =>
    socket.received().filter((m) => m.type === 'system-message');

  it('aceita, confirma ao jogador e PERSISTE', () => {
    const saved: Array<{ characterId: string; config: unknown }> = [];
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      acceptBotConfig: accepting,
      saveBotConfig: async (characterId, config) => { saved.push({ characterId, config }); },
    });
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');

    host.handle(viewer, { type: 'bot-config', config: CONFIG });
    host.flush();

    expect(saved).toEqual([{ characterId: 'p1', config: CONFIG }]);
    expect(mensagens(socket).some((m) => m.type === 'system-message' && m.level === 'info'))
      .toBe(true);
  });

  it('recusa com o MOTIVO, e não persiste nada', () => {
    // O jogador precisa saber o que corrigir. E uma configuração recusada que fosse gravada
    // voltaria na próxima conexão para ser recusada de novo, para sempre.
    const saved: unknown[] = [];
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      acceptBotConfig: accepting,
      saveBotConfig: async (_id, config) => { saved.push(config); },
    });
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');

    host.handle(viewer, { type: 'bot-config', config: { version: 99 } });
    host.flush();

    expect(saved).toHaveLength(0);
    const aviso = mensagens(socket).find((m) => m.type === 'system-message' && m.level === 'warning');
    expect(aviso?.type === 'system-message' && aviso.text).toContain('vocabulário');
  });

  it('o gate de level recusa o bot avançado, e o mesmo config passa no 50', () => {
    // §13.2 pelo caminho de verdade: o level vem do personagem da sessão, nunca da mensagem.
    const { ruleset } = countingRuleset();
    const baixo = buildHost(ruleset, { acceptBotConfig: accepting, level: 49 });
    const socketBaixo = new FakeSocket();
    const viewerBaixo = baixo.host.attach(socketBaixo, 'p1');
    baixo.host.handle(viewerBaixo, { type: 'bot-config', config: { version: 1, avancado: true } });
    baixo.host.flush();
    const aviso = mensagens(socketBaixo)
      .find((m) => m.type === 'system-message' && m.level === 'warning');
    expect(aviso?.type === 'system-message' && aviso.text).toContain('level 50');

    const alto = buildHost(ruleset, { acceptBotConfig: accepting, level: 50 });
    const socketAlto = new FakeSocket();
    const viewerAlto = alto.host.attach(socketAlto, 'p1');
    alto.host.handle(viewerAlto, { type: 'bot-config', config: { version: 1, avancado: true } });
    alto.host.flush();
    expect(mensagens(socketAlto).some((m) => m.type === 'system-message' && m.level === 'info'))
      .toBe(true);
  });

  it('falha ao PERSISTIR não desfaz o que já vale para o jogador', () => {
    // Aplicar antes de gravar é deliberado: uma falha do Postgres não pode fazer o jogador
    // ficar sem a cura que acabou de configurar. O preço é a configuração não voltar na
    // próxima conexão, e esse é o lado certo para errar.
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      acceptBotConfig: accepting,
      saveBotConfig: async () => { throw new Error('postgres caiu'); },
    });
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');

    expect(() => host.handle(viewer, { type: 'bot-config', config: CONFIG })).not.toThrow();
    host.flush();
    expect(mensagens(socket).some((m) => m.type === 'system-message' && m.level === 'info'))
      .toBe(true);
  });

  it('host montado SEM validador avisa, em vez de aceitar em silêncio', () => {
    // Aceitar sem julgar seria pior que recusar: o jogador acharia que configurou.
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset);
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');

    host.handle(viewer, { type: 'bot-config', config: CONFIG });
    host.flush();

    expect(mensagens(socket).some((m) => m.type === 'system-message' && m.level === 'error'))
      .toBe(true);
  });
});

describe('equipar pelo socket (FUN-82)', () => {
  const catalogo = new Map([
    ['sword', {
      id: 'sword', name: 'Sword', appearanceId: 1, kind: 'weapon' as const, slot: 'hand' as const,
      weight: 10, stackable: false, attack: 20, armor: 0,
      requires: { level: 20 },
    }],
  ]);
  const mensagens = (socket: FakeSocket) =>
    socket.received().filter((m) => m.type === 'system-message');

  const comItem = (level: number) => {
    const { ruleset } = countingRuleset();
    const { host, sessions } = buildHost(ruleset, { itemCatalog: catalogo, level });
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    const hero = sessions[0]?.participants[0] as CharacterRuntime;
    hero.capacity = 1_000;
    hero.inventory.add({ instanceId: 'i1', itemId: 'sword', quantity: 1 }, catalogo, hero);
    return { host, viewer, socket, hero };
  };

  it('veste, e o sucesso NÃO vira mensagem', () => {
    // Confirmar cada clique com uma linha de chat entulharia a tela. O que o jogador vê é o
    // item no lugar — e isso é a UI (M10), não uma mensagem de sistema.
    const { host, viewer, socket, hero } = comItem(20);

    host.handle(viewer, { type: 'equip', instanceId: 'i1' });
    host.flush();

    expect(hero.inventory.equippedAt('hand')?.instanceId).toBe('i1');
    expect(mensagens(socket)).toHaveLength(0);
  });

  it('recusa por level com o MOTIVO, e o item continua na mochila', () => {
    // A recusa do `sim` é tipada justamente para virar uma frase; "não foi possível" é o que
    // faz alguém abrir um chamado.
    const { host, viewer, socket, hero } = comItem(19);

    host.handle(viewer, { type: 'equip', instanceId: 'i1' });
    host.flush();

    expect(hero.inventory.equippedAt('hand')).toBeNull();
    expect(hero.inventory.backpack).toHaveLength(1);
    const aviso = mensagens(socket)[0];
    expect(aviso?.type === 'system-message' && aviso.text).toContain('level');
  });

  it('recusa slot que não existe, sem tocar em nada', () => {
    // O slot chega como string do cliente e é conferido contra o CONTEÚDO, como a dificuldade
    // de hunt: repetir a lista no protocolo criaria um segundo lugar para ela divergir.
    const { host, viewer, socket } = comItem(20);

    host.handle(viewer, { type: 'unequip', slot: 'rabo' });
    host.flush();

    expect(mensagens(socket)).toHaveLength(1);
  });

  it('desequipar devolve para a mochila', () => {
    const { host, viewer, hero } = comItem(20);
    host.handle(viewer, { type: 'equip', instanceId: 'i1' });
    host.handle(viewer, { type: 'unequip', slot: 'hand' });
    host.flush();

    expect(hero.inventory.equippedAt('hand')).toBeNull();
    expect(hero.inventory.backpack.map((i) => i.instanceId)).toEqual(['i1']);
  });

  it('host montado SEM catálogo recusa em vez de vestir no escuro', () => {
    // Um host sem conteúdo não sabe o que é uma espada. Vestir mesmo assim daria atributo de
    // item que ele não conhece.
    const { ruleset } = countingRuleset();
    const { host, sessions } = buildHost(ruleset);
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    const hero = sessions[0]?.participants[0] as CharacterRuntime;
    hero.capacity = 1_000;
    hero.inventory.add({ instanceId: 'i1', itemId: 'sword', quantity: 1 }, catalogo, hero);

    host.handle(viewer, { type: 'equip', instanceId: 'i1' });
    host.flush();

    expect(hero.inventory.equippedAt('hand')).toBeNull();
    expect(mensagens(socket)).toHaveLength(1);
  });
});

describe('a praça compartilhada, vista pelo hospedeiro (FUN-71, ADR 0023)', () => {
  /** Um host com a Cidade DE VERDADE — mapa, ponto de entrada e legalidade de tile. */
  const praca = (now: () => number = () => 0) => {
    const content = testContent();
    const shard = new CityShard(content, now);
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger,
      createSession: createCitySessionFactory(content, now, shard),
      buildSession: createSessionBuilder(content, now, shard),
      now,
    });
    const enter = (characterId: string) => {
      const socket = new FakeSocket();
      const viewer = host.attach(socket, characterId);
      return { socket, viewer };
    };
    return { host, enter };
  };

  it('dois personagens ficam na MESMA sessão', () => {
    // O critério da issue. Antes disto a praça existia N vezes, vazia em todas.
    const { host, enter } = praca();
    enter('p1');
    enter('p2');

    expect(host.sessionFor('p1')).toBe(host.sessionFor('p2'));
    expect(host.sessionFor('p1')?.participants.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(host.sessionCount).toBe(1);
  });

  it('o passo de um chega ao outro como creature-move', () => {
    // p1 fica no ponto de entrada (2,2) e p2 entra no livre mais próximo, (1,1). p2 anda para
    // o sul, que é (1,2) — dentro do mapa e livre.
    const { host, enter } = praca();
    const primeiro = enter('p1');
    const segundo = enter('p2');
    expect(host.sessionFor('p2')?.participants[1]?.position).toEqual({ x: 1, y: 1, z: 7 });
    primeiro.socket.frames.length = 0;

    host.handle(segundo.viewer, { type: 'walk', direction: 'south' });
    host.flush();

    const moves = primeiro.socket.received().filter((m) => m.type === 'creature-move');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from: { x: 1, y: 1, z: 7 }, to: { x: 1, y: 2, z: 7 } });
  });

  it('o say de um chega ao outro — o alcance "sessão inteira" da FUN-58 passa a alcançar', () => {
    // A FUN-58 especificou "quem está na mesma instância recebe". Na Cidade privada isso
    // alcançava só o autor, e o teste dela passava porque o autor É alguém da sessão.
    const { host, enter } = praca();
    const primeiro = enter('p1');
    const segundo = enter('p2');
    primeiro.socket.frames.length = 0;

    host.handle(segundo.viewer, { type: 'say', channel: 'local', text: 'oi' });
    host.flush();

    expect(primeiro.socket.received()).toContainEqual(
      expect.objectContaining({ type: 'chat-message', text: 'oi' }),
    );
  });

  it('quem já estava recebe creature-appear de quem chega', () => {
    // Sem isto o novo só apareceria no primeiro passo que desse — e ficaria invisível
    // enquanto estivesse parado, que é o estado normal de quem acabou de entrar.
    const { host, enter } = praca();
    const primeiro = enter('p1');
    primeiro.socket.frames.length = 0;

    const segundo = enter('p2');
    host.flush();

    const appears = primeiro.socket.received().filter((m) => m.type === 'creature-appear');
    expect(appears).toHaveLength(1);
    expect(appears[0]).toMatchObject({ name: 'p2' });
    // E quem chegou não recebe o próprio aparecimento: ele já vem no `session-state`.
    expect(segundo.socket.received().some((m) => m.type === 'creature-appear')).toBe(false);
  });

  it('quem fica recebe creature-disappear de quem sai', async () => {
    // Esquecer isto deixa fantasma na tela do cliente: um boneco parado para sempre, que não
    // corresponde a ninguém. É o sintoma clássico, e o chato de achar.
    const { host, enter } = praca();
    const primeiro = enter('p1');
    enter('p2');
    primeiro.socket.frames.length = 0;

    await host.release('p2');
    host.flush();

    expect(primeiro.socket.received()).toContainEqual(
      expect.objectContaining({ type: 'creature-disappear' }),
    );
  });

  it('sair NÃO encerra nem recolhe a sessão de quem ficou', async () => {
    // O motivo de `Session.leave` existir. Antes, "sair" só sabia ser `end` — e um jogador
    // fechando o jogo na praça levaria a praça junto.
    const { host, enter } = praca();
    enter('p1');
    enter('p2');
    const session = host.sessionFor('p1');

    await host.release('p2');

    expect(host.sessionFor('p1')).toBe(session);
    expect(session?.ended).toBeNull();
    expect(session?.participants.map((p) => p.id)).toEqual(['p1']);
    expect(host.sessionFor('p2')).toBeUndefined();
  });

  it('a cópia some do hospedeiro quando o ÚLTIMO sai', async () => {
    const { host, enter } = praca();
    enter('p1');

    await host.release('p1');

    expect(host.sessionCount).toBe(0);
  });

  it('o repouso é por PERSONAGEM: quem desconectou é recolhido, quem ficou não', async () => {
    // A carência da FUN-52 era por SESSÃO. Numa praça compartilhada isso quer dizer o
    // contrário do que ela pretende: bastaria UM jogador olhando para segurar todo mundo na
    // memória do nó para sempre — e é essa a metade que um teste frouxo deixa passar.
    let agora = 0;
    const { host, enter } = praca(() => agora);
    enter('p1');
    const segundo = enter('p2');
    const session = host.sessionFor('p1');

    host.detach(segundo.viewer);
    agora = 10 * 60_000;
    host.cycle(agora);

    // p2 é recolhido...
    await vi.waitFor(() => { expect(host.sessionFor('p2')).toBeUndefined(); });
    // ...e p1, que continua olhando, fica na MESMA praça, que não acabou.
    expect(host.sessionFor('p1')).toBe(session);
    expect(session?.ended).toBeNull();
    expect(session?.participants.map((p) => p.id)).toEqual(['p1']);
  });

  it('caçar leva UM personagem — o que PEDIU —, não a praça inteira', () => {
    // `SessionBuilder` recebia só a sessão de origem. Com duzentas pessoas nela, "quem está
    // transicionando" viraria "todo mundo" — e como a hunt recusa o segundo participante, o
    // sintoma era a transição falhar para todo mundo sempre que houvesse mais alguém.
    //
    // Quem caça é o SEGUNDO da lista, de propósito: com o primeiro, um construtor que
    // ignorasse o `characterId` e pegasse `participants[0]` passaria por acidente.
    const { host, enter } = praca();
    enter('p1');
    const segundo = enter('p2');
    const praçaSession = host.sessionFor('p1');

    host.handle(segundo.viewer, {
      type: 'enter-hunt', huntId: 'arena', difficulty: 'beginner',
    });

    return vi.waitFor(() => {
      expect(host.sessionFor('p2')?.ruleset.type).toBe('hunt');
      expect(host.sessionFor('p2')?.participants.map((p) => p.id)).toEqual(['p2']);
      expect(host.sessionFor('p1')).toBe(praçaSession);
      expect(praçaSession?.participants.map((p) => p.id)).toEqual(['p1']);
    });
  });
});

describe('a praça não tem snapshot (FUN-71, ADR 0023)', () => {
  it('saveAll pula o shard: não há progresso a guardar, e ele guardaria a praça inteira', async () => {
    // Com duzentos na praça, salvar por participante grava o MESMO estado duzentas vezes a
    // cada dez segundos — e o que ele guardaria não tem dono: a Cidade não credita nada (§37).
    const saves: string[] = [];
    const snapshots = {
      save: async (characterId: string) => { saves.push(characterId); },
      load: async () => null,
      remove: async () => {},
    } as unknown as SnapshotStore;
    const content = testContent();
    const shard = new CityShard(content, () => 0);
    // Com diretório e conta: sem `accountId` o `saveAll` pula por outro motivo, e o teste
    // passaria mesmo com a regra do shard removida.
    const directory = { register: async () => true } as unknown as SessionDirectory;
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger, snapshots, directory,
      createSession: createCitySessionFactory(content, () => 0, shard),
      now: () => 0,
    });
    await host.prepare('p1', undefined, 'a1');
    await host.prepare('p2', undefined, 'a2');
    expect(host.sessionFor('p1')).toBe(host.sessionFor('p2'));

    await host.saveAll();

    expect(saves).toEqual([]);
  });
});

describe('a praça não manda tudo para todos (FUN-33)', () => {
  /**
   * Um host de Cidade com mapa GRANDE: no mapa de 6×6 do conteúdo de teste todo mundo está a
   * dois tiles de todo mundo, e uma AOI ali não teria o que cortar.
   */
  const cidade = (options: { areaOfInterest?: boolean } = {}) => {
    const size = 64;
    const content = buildContent({
      ...rawTestContent(),
      maps: [TEST_MAP, {
        id: 'city', z: 7, entryPoint: { x: 2, y: 2 },
        grid: Array.from({ length: size }, (_, y) =>
          Array.from({ length: size }, (_, x) =>
            (x === 0 || y === 0 || x === size - 1 || y === size - 1 ? '#' : '.')).join('')),
      }],
      city: { mapId: 'city' },
    });
    const shard = new CityShard(content, () => 0);
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger,
      createSession: createCitySessionFactory(content, () => 0, shard),
      now: () => 0,
      ...options,
    });
    /** Entra e caminha até `to`, um tile por vez. Sem isto todos nascem colados na entrada. */
    const enter = (characterId: string, to: { x: number; y: number }) => {
      const socket = new FakeSocket();
      const viewer = host.attach(socket, characterId);
      const character = host.sessionFor(characterId)?.participants
        .find((p) => p.id === characterId);
      for (let step = 0; step < size * 4 && character !== undefined; step++) {
        const { x, y } = character.position;
        if (x === to.x && y === to.y) break;
        const dx = Math.sign(to.x - x);
        const dy = Math.sign(to.y - y);
        // Diagonal primeiro, eixos como saída: o caminho até o destino passa por onde os
        // outros já estão parados, e tile é exclusivo. Sem as alternativas, um teste falha
        // porque alguém ficou no caminho — que é ruído, não o assunto.
        for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy]] as const) {
          if (sx === 0 && sy === 0) continue;
          host.handle(viewer, {
            type: 'walk-to', destination: { x: x + sx, y: y + sy, z: 7 },
          });
          if (character.position.x !== x || character.position.y !== y) break;
        }
      }
      if (character !== undefined && (character.position.x !== to.x
        || character.position.y !== to.y)) {
        throw new Error(`${characterId} não chegou em (${to.x},${to.y})`);
      }
      socket.frames.length = 0;
      return { socket, viewer };
    };
    /**
     * Esvazia a FILA e limpa o que já foi escrito.
     *
     * Zerar só os quadros não basta: o visualizador acumula mensagens até o `flush` do ciclo,
     * e as que a caminhada até o destino gerou chegariam no primeiro `flush` da asserção — um
     * teste que mede o passo de agora lendo o barulho da preparação.
     */
    const quiet = (...sockets: readonly FakeSocket[]): void => {
      host.flush();
      for (const socket of sockets) socket.frames.length = 0;
    };
    return { host, enter, quiet };
  };

  it('o passo de quem está LONGE não chega', () => {
    // É a issue em uma asserção. Sem AOI, cada passo de cada um vai para todos os outros — a
    // conta que a justifica é 2.000 jogadores × 2 passos/s × 2.000 destinatários.
    const { host, enter, quiet } = cidade();
    const perto = enter('perto', { x: 10, y: 10 });
    enter('longe', { x: 55, y: 55 });
    const distante = enter('outro-longe', { x: 54, y: 55 });
    quiet(perto.socket);

    host.handle(distante.viewer, { type: 'walk', direction: 'north' });
    host.flush();

    expect(perto.socket.received()).toEqual([]);
  });

  it('o passo de quem está PERTO chega', () => {
    // O outro lado: uma AOI que não entrega nada é fácil de escrever e inútil.
    const { host, enter, quiet } = cidade();
    const perto = enter('perto', { x: 10, y: 10 });
    const vizinho = enter('vizinho', { x: 12, y: 10 });
    quiet(perto.socket);

    host.handle(vizinho.viewer, { type: 'walk', direction: 'north' });
    host.flush();

    expect(perto.socket.received()).toContainEqual(
      expect.objectContaining({ type: 'creature-move' }),
    );
  });

  it('aproximar-se vira creature-appear, e afastar-se vira creature-disappear', () => {
    // O cuidado que a issue nomeia: esquecer o `disappear` deixa fantasma na tela do cliente,
    // um boneco parado que não corresponde a ninguém.
    const { host, enter, quiet } = cidade();
    const parado = enter('parado', { x: 10, y: 10 });
    const andarilho = enter('andarilho', { x: 55, y: 10 });
    quiet(parado.socket);

    for (let step = 0; step < 60; step++) {
      host.handle(andarilho.viewer, { type: 'walk', direction: 'west' });
    }
    host.flush();
    expect(parado.socket.received()).toContainEqual(
      expect.objectContaining({ type: 'creature-appear', name: 'andarilho' }),
    );

    quiet(parado.socket);
    for (let step = 0; step < 60; step++) {
      host.handle(andarilho.viewer, { type: 'walk', direction: 'east' });
    }
    host.flush();
    expect(parado.socket.received()).toContainEqual(
      expect.objectContaining({ type: 'creature-disappear' }),
    );
  });

  it('o session-state lista quem está no CAMPO, não a praça inteira', () => {
    // Numa praça de duzentos, o `session-state` completo seria o pior pacote do jogo — e
    // mandaria para a tela gente que ela não tem como desenhar, porque está fora da câmera.
    const { host, enter, quiet } = cidade();
    const perto = enter('perto', { x: 10, y: 10 });
    enter('vizinho', { x: 12, y: 10 });
    enter('longe', { x: 55, y: 55 });
    quiet(perto.socket);

    host.handle(perto.viewer, { type: 'session-attach' });
    host.flush();

    const state = perto.socket.received().find((m) => m.type === 'session-state');
    if (state?.type !== 'session-state') throw new Error('não veio session-state');
    expect(state.world.creatures.map((c) => c.name).sort()).toEqual(['perto', 'vizinho']);
  });

  it('o say tem ALCANCE, e é o mesmo campo de visão', () => {
    // "local" alcançando a praça inteira é o canal global com outro nome. O raio era desta
    // issue desde a FUN-58, e `docs/product/chat.md` registrava a espera.
    const { host, enter, quiet } = cidade();
    const perto = enter('perto', { x: 10, y: 10 });
    const vizinho = enter('vizinho', { x: 12, y: 10 });
    const longe = enter('longe', { x: 55, y: 55 });
    quiet(perto.socket, longe.socket);

    host.handle(vizinho.viewer, { type: 'say', channel: 'local', text: 'oi' });
    host.flush();

    expect(perto.socket.received()).toContainEqual(
      expect.objectContaining({ type: 'chat-message', text: 'oi' }),
    );
    expect(longe.socket.received()).toEqual([]);
  });

  it('desligar a AOI devolve o comportamento anterior — é o grupo de controle da medição', () => {
    // `pnpm bench:city` roda os dois lados, e é assim que "não cresce quadraticamente" vira
    // número em vez de afirmação.
    const { host, enter, quiet } = cidade({ areaOfInterest: false });
    const perto = enter('perto', { x: 10, y: 10 });
    const longe = enter('longe', { x: 55, y: 55 });
    quiet(perto.socket);

    host.handle(longe.viewer, { type: 'walk', direction: 'north' });
    host.flush();

    expect(perto.socket.received()).toContainEqual(
      expect.objectContaining({ type: 'creature-move' }),
    );
  });
});

describe('o catálogo de hunts chega ao cliente (FUN-79)', () => {
  const hunts = [
    { id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1, difficulties: ['beginner'] },
  ];
  const withCatalogue = () => {
    const content = testContent();
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger,
      createSession: createCitySessionFactory(content),
      huntCatalogue: () => hunts,
      now: () => 0,
    });
    return host;
  };

  it('vai pela FILA, e não furando a fila como o welcome', () => {
    // `welcome` é `sendNow` porque é resposta ao handshake. O catálogo não é resposta a nada:
    // furar a fila o poria na frente de deltas que já esperavam, pela mesma razão que o
    // `session-state` não fura (FUN-32).
    //
    // A asserção é ANTES do flush, e é o que a torna discriminante: trocar `send` por
    // `sendNow` faz o catálogo aparecer aqui. Afirmar só a ordem depois do flush não provaria
    // nada — `sendNow` escreve na hora, então o `welcome` viria primeiro de qualquer jeito.
    const host = withCatalogue();
    const socket = new FakeSocket();
    host.attach(socket, 'p1');

    const antesDoFlush = socket.received();
    expect(antesDoFlush.some((m) => m.type === 'welcome')).toBe(true);
    expect(antesDoFlush.some((m) => m.type === 'hunt-catalogue')).toBe(false);

    host.flush();
    expect(socket.received().some((m) => m.type === 'hunt-catalogue')).toBe(true);
  });

  it('sai uma vez por conexão, com o que a tela mostra', () => {
    // A versão de conteúdo é fixada na sessão (invariante 7): o catálogo não muda enquanto ela
    // vive, então mandá-lo de novo seria repetir o mesmo pacote sem motivo.
    const host = withCatalogue();
    const socket = new FakeSocket();
    host.attach(socket, 'p1');
    host.flush();

    const catalogue = socket.received().filter((m) => m.type === 'hunt-catalogue');
    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]).toMatchObject({ hunts });
  });

  it('sem catálogo injetado, o host não inventa um', () => {
    // O host não conhece conteúdo (FUN-81): sem a função, ele não tem o que mandar — e mandar
    // uma lista vazia diria ao cliente que não há hunt nenhuma, que é diferente de "não sei".
    const content = testContent();
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger,
      createSession: createCitySessionFactory(content),
      now: () => 0,
    });
    const socket = new FakeSocket();
    host.attach(socket, 'p1');
    host.flush();

    expect(socket.received().some((m) => m.type === 'hunt-catalogue')).toBe(false);
  });
});
