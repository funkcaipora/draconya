import {
  CharacterRuntime, Rng, Session, createHuntSession, statsForLevel,
  type EndReason, type Ruleset, type SessionSnapshot,
} from '@draconya/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOT_VOCABULARY_VERSION, botConfigSchema, buildContent, itemSchema, placeholderAppearances,
} from '@draconya/content';
import type { Ammunition, Appearances, BotConfig, RawContent } from '@draconya/content';
import type { OutfitColors, S2CMessage } from '@draconya/protocol';
import { createLogger } from '../log.js';
import type { SessionDirectory } from '../directory.js';
import type { SnapshotStore } from '../snapshots.js';
import type { ReceiptStore } from '../receipts.js';
import { SessionHost } from './host.js';
import type { SessionHostOptions } from './host.js';
import type { GameMetrics } from './metrics.js';
import { FakeSocket } from './testing.js';
import { CityShard, createCitySessionFactory, createSessionBuilder } from './sessions.js';
import { buildCatalogue } from './catalogue.js';
import {
  TEST_COMBAT, TEST_HUNT, TEST_MAP, TEST_PROGRESSION, TEST_ROUTE, rawTestContent, testContent,
} from '../testing/content.js';

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
    ammunition?: NonNullable<SessionHostOptions['ammunition']>;
    vocations?: NonNullable<SessionHostOptions['vocations']>;
    vocationLevel?: number;
    progression?: NonNullable<SessionHostOptions['progression']>;
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

  it('the receipt carries the bestiary of the owner, absolute (FUN-113)', async () => {
    // Abate que não chega ao extrato é abate que some no próximo logout — e o marco 10 000
    // nunca chegaria. Absoluto, como as skills: o ledger funde pelo maior de cada monstro.
    // Mutação que mata: apagar a linha do `bestiary` em `#saveReceipt` (a lista de permissão
    // do `parseReceipt` está coberta em `receipts.test.ts`; esta é a outra ponta).
    const saved: Array<{ bestiary?: Record<string, number> }> = [];
    const receipts = {
      save: async (r: { bestiary?: Record<string, number> }) => { saved.push(r); },
    } as unknown as ReceiptStore;
    const directory = { register: async () => true } as unknown as SessionDirectory;
    const { ruleset } = countingRuleset();
    const { host, sessions } = buildHost(ruleset, { directory, receipts });
    await host.prepare('p1', undefined, 'a1');
    const owner = sessions[0]?.participants[0];
    if (owner === undefined) throw new Error('sem personagem');
    owner.bestiary.record('rat');
    owner.bestiary.record('rat');
    owner.bestiary.record('bat');

    await host.drainAll('drain');

    expect(saved[0]?.bestiary).toEqual({ rat: 2, bat: 1 });
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
    // Esvazia o que anexar já enfileirou — catálogo e inventário (FUN-79, FUN-90). O que este
    // teste mede é o `session-state` esperar a fila, não quantas mensagens existem.
    host.flush();
    socket.frames.length = 0;

    host.handle(viewer, { type: 'session-attach' });
    expect(socket.frames).toHaveLength(0);
    // Três: o mundo (`session-state`), os vitais (`player-stats`, FUN-109) — gold, capacidade
    // e stamina só viajam na segunda — e o Bestiário (`bestiary`, FUN-113), que só viaja na
    // terceira. Os três na FILA, nenhum no fio.
    expect(viewer.queued).toBe(3);

    host.flush();
    const state = socket.received().find((m) => m.type === 'session-state');
    expect(state).toBeDefined();
    // E os vitais vêm DEPOIS do mundo, nunca antes: o HUD que recebe o número novo por cima
    // de um mundo antigo mostra uma barra que o mundo desmente.
    //
    // Mutação que mata: trocar a ordem dos dois `send` em `#sendState`.
    const types = socket.received().map((m) => m.type);
    expect(types.indexOf('player-stats')).toBeGreaterThan(types.indexOf('session-state'));
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

    // A fila é esvaziada primeiro: anexar já enfileira o catálogo e o inventário (FUN-79,
    // FUN-90), e o que este teste mede é o `ping` NÃO passar por ela.
    host.flush();
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
    mapId: type === 'city' ? 'city' : 'arena',
    // A hunt de teste é um bueiro (FUN-121); a Cidade não diz ambiente, e o campo não viaja.
    ...(type === 'hunt' ? { ambience: 'cavern' as const } : {}),
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

    await host.transition('p1', { to: 'hunt', huntId: 'arena', difficulty: 'cautious' });

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

    const primeira = host.transition('p1', { to: 'hunt', huntId: 'a', difficulty: 'cautious' });
    const segunda = host.transition('p1', { to: 'hunt', huntId: 'b', difficulty: 'cautious' });

    await expect(primeira).resolves.toBeUndefined();
    await expect(segunda).rejects.toThrow(/já está em andamento/);
    // Uma construída, uma sessão hospedada, um personagem.
    expect(built).toEqual(['hunt']);
    expect(host.sessionCount).toBe(1);
    expect(host.sessionFor('p1')?.ruleset.type).toBe('hunt');
  });

  it('a transição anuncia a cena nova ANTES do estado: instance-enter com o mapa da hunt (FUN-120)', async () => {
    // O cliente limpa a cena no `instance-enter` e a povoa no `session-state`. Na ordem
    // inversa, o estado chegaria e seria apagado pela troca — a hunt abriria vazia.
    const { build } = builder();
    const { host } = cityHost({ buildSession: build });
    await host.prepare('p1', undefined, 'a1');
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    socket.frames.length = 0;

    host.handle(viewer, { type: 'enter-hunt', huntId: 'arena', difficulty: 'cautious' });
    await vi.waitFor(() => expect(host.sessionFor('p1')?.ruleset.type).toBe('hunt'));
    host.flush();

    const received = socket.received();
    const enter = received.findIndex((m) => m.type === 'instance-enter');
    // Com o ambiente da hunt (FUN-121): é o que escurece o bueiro no cliente.
    expect(received[enter]).toEqual({ type: 'instance-enter', instanceId: 'hunt-1', map: 'arena', ambience: 'cavern' });
    expect(received[enter + 1]).toMatchObject({ type: 'session-state', world: { mapId: 'arena' } });
  });

  it('a volta da hunt anuncia a Cidade de novo: instance-enter com o mapa e a instância da praça, antes do estado (FUN-120)', async () => {
    // O caminho em que o anúncio de chegada corre antes de o visualizador entrar na sessão
    // nova — o que o recém-chegado vê tem de vir inteiro do `#sendState`, e na ordem certa.
    const { build } = builder();
    const { host } = cityHost({ buildSession: build });
    await host.prepare('p1', undefined, 'a1');
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    host.handle(viewer, { type: 'enter-hunt', huntId: 'arena', difficulty: 'cautious' });
    await vi.waitFor(() => expect(host.sessionFor('p1')?.ruleset.type).toBe('hunt'));
    host.flush();
    socket.frames.length = 0;

    host.handle(viewer, { type: 'leave-hunt' });
    await vi.waitFor(() => expect(host.sessionFor('p1')?.ruleset.type).toBe('city'));
    host.flush();

    const received = socket.received();
    const enter = received.findIndex((m) => m.type === 'instance-enter');
    // Sem `ambience`: a Cidade não diz, e o campo não viaja — `toEqual` prende a ausência.
    expect(received[enter]).toEqual({ type: 'instance-enter', instanceId: 'city-2', map: 'city' });
    expect(received[enter + 1]).toMatchObject({ type: 'session-state', sessionType: 'city', world: { mapId: 'city' } });
    expect(socket.ended).toBeNull();
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

      host.handle(viewer, { type: 'enter-hunt', huntId: 'arena', difficulty: 'cautious' });
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

  it('a progressão PERMANENTE do snapshot vai no extrato: skills e Bestiário (FUN-113)', async () => {
    // Achado da revisão da FUN-113: o extrato levava XP, gold e stamina, e deixava skills e
    // Bestiário no snapshot que estava prestes a ser apagado — a XP era creditada e o abate
    // 9 999 voltava a ser o 5 000 do banco. Os dois são absolutos e monotônicos, e o ledger
    // funde pelo maior, então levá-los nunca rebaixa nada. Mutação que mata: tirar qualquer
    // dos dois espalhamentos de `#creditUnrestorable`.
    const snapshot = stored();
    const participant = snapshot.participants[0] as SessionSnapshot['participants'][number];
    const withProgress: SessionSnapshot = {
      ...snapshot,
      participants: [{
        ...participant,
        skills: { melee: { level: 12, points: 3 } },
        bestiary: { rat: 9_999 },
      }],
    };
    const receipts: Array<Record<string, unknown>> = [];
    const { snapshots } = withSnapshots(withProgress);
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      directory: { register: async () => true } as unknown as SessionDirectory,
      snapshots,
      receipts: { save: async (receipt: Record<string, unknown>) => { receipts.push(receipt); } } as unknown as ReceiptStore,
      restoreSession: () => null,
    });

    await host.prepare('p1', undefined, 'a1');

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      reason: 'drain',
      skills: { melee: { level: 12, points: 3 } },
      bestiary: { rat: 9_999 },
    });
  });

  it('a vocação, o equipamento e a arma de vocação do snapshot vão no extrato (#154)', async () => {
    // Era o buraco de `#creditUnrestorable`: item equipado numa sessão irrestaurável se perdia,
    // e a arma de vocação — que nasce equipada com o prefixo da sessão — com ele. Mutação que
    // mata: tirar `equipment`, `acquired` ou `vocation` do espalhamento.
    const snapshot = stored();
    const participant = snapshot.participants[0] as SessionSnapshot['participants'][number];
    const withChoice: SessionSnapshot = {
      ...snapshot,
      participants: [{
        ...participant,
        vocationId: 'knight',
        inventory: {
          backpack: [{ instanceId: 'hero:kit:1', itemId: 'machete', quantity: 1 }],
          equipped: { hand: { instanceId: 's-antiga:p1:vocation', itemId: 'steel-axe', quantity: 1, origin: 'vocation-choice' } },
        },
      }],
    };
    const receipts: Array<Record<string, unknown>> = [];
    const { snapshots } = withSnapshots(withChoice);
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, {
      directory: { register: async () => true } as unknown as SessionDirectory,
      snapshots,
      receipts: { save: async (receipt: Record<string, unknown>) => { receipts.push(receipt); } } as unknown as ReceiptStore,
      restoreSession: () => null,
    });

    await host.prepare('p1', undefined, 'a1');

    expect(receipts[0]).toMatchObject({
      vocation: 'knight',
      equipment: { hand: 's-antiga:p1:vocation' },
      acquired: [{ instanceId: 's-antiga:p1:vocation', itemId: 'steel-axe', origin: 'vocation-choice' }],
    });
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

  it('o attach anuncia a Cidade: instance-enter com o mapa, e o session-state diz o mesmo mapa (FUN-120)', () => {
    // Era opcode definido, tratado no cliente e nunca enviado — e `world.mapId` saía `null`.
    const host = cityHost();
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    host.handle(viewer, { type: 'session-attach' });
    host.flush();

    const received = socket.received();
    const enter = received.findIndex((m) => m.type === 'instance-enter');
    expect(received[enter]).toMatchObject({ type: 'instance-enter', map: 'city' });
    expect(received[enter + 1]).toMatchObject({ type: 'session-state', world: { mapId: 'city' } });
  });

  it('a segunda aba recebe a própria cena, e a primeira não recebe nada de novo (FUN-120)', () => {
    // Duas abas do mesmo personagem são dois visualizadores da MESMA sessão: cada
    // `session-attach` leva a cena a quem pediu — e só a ele.
    const host = cityHost();
    const first = new FakeSocket();
    const firstViewer = host.attach(first, 'p1');
    host.handle(firstViewer, { type: 'session-attach' });
    host.flush();
    first.frames.length = 0;

    const second = new FakeSocket();
    const secondViewer = host.attach(second, 'p1');
    host.handle(secondViewer, { type: 'session-attach' });
    host.flush();

    const received = second.received();
    const enter = received.findIndex((m) => m.type === 'instance-enter');
    expect(received[enter]).toMatchObject({ type: 'instance-enter', map: 'city' });
    expect(received[enter + 1]).toMatchObject({ type: 'session-state', world: { mapId: 'city' } });
    expect(first.received().filter((m) => m.type === 'instance-enter' || m.type === 'session-state')).toEqual([]);
  });

  it('um passo por vez: a rajada de walk anda UM tile, e o próximo só quando o passo acabar (FUN-122)', () => {
    // O teclado do cliente repete o `walk` no ritmo do passo; o ritmo, porém, é do servidor.
    // Sem isto, um cliente mandando mil `walk` por segundo atravessaria a praça em meio segundo.
    let now = 0;
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger,
      createSession: createCitySessionFactory(testContent()),
      now: () => now,
    });
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    socket.frames.length = 0;

    for (let i = 0; i < 10; i++) host.handle(viewer, { type: 'walk', direction: 'east' });
    host.flush();
    const moves = () => socket.received().filter((m) => m.type === 'creature-move');
    expect(moves()).toHaveLength(1);
    expect(host.sessionFor('p1')?.participants[0]?.position).toEqual({ x: 3, y: 2, z: 7 });
    expect(socket.ended).toBeNull();

    // O passo da Cidade de teste dura 500 ms: aos 499 ainda não; aos 500, anda.
    now = 499;
    host.handle(viewer, { type: 'walk', direction: 'east' });
    host.flush();
    expect(moves()).toHaveLength(1);
    now = 500;
    host.handle(viewer, { type: 'walk', direction: 'east' });
    host.flush();
    expect(moves()).toHaveLength(2);
    expect(host.sessionFor('p1')?.participants[0]?.position).toEqual({ x: 4, y: 2, z: 7 });
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

    // O que anexar já mandou não é resposta ao `say`: o teste mede o que as quatro linhas
    // recusadas produzem, e a resposta é NADA.
    host.flush();
    socket.frames.length = 0;

    host.handle(viewer, { type: 'say', channel: 'global', text: 'oi' });
    host.handle(viewer, { type: 'say', channel: 'local', text: '   ' });
    host.handle(viewer, { type: 'say', channel: 'local', text: 'oi\u200b' });
    host.handle(viewer, { type: 'say', channel: 'local', text: '\u202eHero: oi' });
    host.flush();

    expect(socket.received()).toHaveLength(0);
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

  /** O que o servidor respondeu sobre a configuração. Tipado desde a FUN-89. */
  const mensagens = (socket: FakeSocket) =>
    socket.received().filter((m) => m.type === 'bot-config-result');

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
    expect(mensagens(socket).some((m) => m.type === 'bot-config-result' && m.ok)).toBe(true);
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
    // Resultado TIPADO, e não uma frase: a tela precisa da resposta para não descartar o que
    // o jogador digitou, e casar com texto quebraria no dia em que alguém melhorasse a redação.
    const aviso = mensagens(socket).find((m) => m.type === 'bot-config-result');
    expect(aviso?.type === 'bot-config-result' && aviso.ok).toBe(false);
    expect(aviso?.type === 'bot-config-result' && aviso.reason).toContain('vocabulário');
  });

  it('o gate de level recusa o bot avançado, e o mesmo config passa no 50', () => {
    // §13.2 pelo caminho de verdade: o level vem do personagem da sessão, nunca da mensagem.
    const { ruleset } = countingRuleset();
    const baixo = buildHost(ruleset, { acceptBotConfig: accepting, level: 49 });
    const socketBaixo = new FakeSocket();
    const viewerBaixo = baixo.host.attach(socketBaixo, 'p1');
    baixo.host.handle(viewerBaixo, { type: 'bot-config', config: { version: 1, avancado: true } });
    baixo.host.flush();
    const aviso = mensagens(socketBaixo).find((m) => m.type === 'bot-config-result');
    expect(aviso?.type === 'bot-config-result' && aviso.reason).toContain('level 50');

    const alto = buildHost(ruleset, { acceptBotConfig: accepting, level: 50 });
    const socketAlto = new FakeSocket();
    const viewerAlto = alto.host.attach(socketAlto, 'p1');
    alto.host.handle(viewerAlto, { type: 'bot-config', config: { version: 1, avancado: true } });
    alto.host.flush();
    expect(mensagens(socketAlto).some((m) => m.type === 'bot-config-result' && m.ok)).toBe(true);
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
    expect(mensagens(socket).some((m) => m.type === 'bot-config-result' && m.ok)).toBe(true);
  });

  it('host montado SEM validador avisa, em vez de aceitar em silêncio', () => {
    // Aceitar sem julgar seria pior que recusar: o jogador acharia que configurou.
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset);
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');

    host.handle(viewer, { type: 'bot-config', config: CONFIG });
    host.flush();

    expect(mensagens(socket).some((m) => m.type === 'bot-config-result' && !m.ok)).toBe(true);
  });

  it('a configuração em vigor volta no session-state — a tela abre com o que a hunt executa (FUN-111)', () => {
    // Era o defeito do passe de QA do MVP: salvo, reanexado, e a tela do bot vazia — um
    // "Salvar" dali apagava as regras em execução. Mutação que mata: tirar `botConfig` de
    // `#sessionState`.
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, { acceptBotConfig: accepting });
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    const stateOf = () => {
      host.handle(viewer, { type: 'session-attach' });
      host.flush();
      return socket.received().filter((m) => m.type === 'session-state').at(-1) as
        { botConfig?: unknown } | undefined;
    };

    // Antes de configurar: sem chave, e não `undefined` — "nunca configurou" é a ausência.
    expect(stateOf()).not.toHaveProperty('botConfig');

    host.handle(viewer, { type: 'bot-config', config: CONFIG });
    host.flush();
    expect(stateOf()?.botConfig).toEqual(CONFIG);
  });

  it('a configuração do TICKET também volta no session-state (FUN-111)', async () => {
    // Quem reanexa depois de um deploy entra pelo ticket, e a configuração dele é a que vale.
    const { ruleset } = countingRuleset();
    const { host } = buildHost(ruleset, { acceptBotConfig: accepting });
    await host.prepare('p2', { level: 1, xp: 0, botConfig: CONFIG }, 'a1');
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p2');
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    const state = socket.received().filter((m) => m.type === 'session-state').at(-1) as
      { botConfig?: unknown } | undefined;
    expect(state?.botConfig).toEqual(CONFIG);
  });
});

describe('equipar pelo socket (FUN-82)', () => {
  const catalogo = new Map([
    ['sword', {
      id: 'sword', name: 'Sword', appearanceId: 1, kind: 'weapon' as const, slot: 'hand' as const,
      weight: 10, stackable: false, twoHanded: false, attack: 20, armor: 0,
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
    hero.inventory.add({ instanceId: 'i1', itemId: 'sword', quantity: 1 }, catalogo, hero, { backpackSlots: 0, satchelSlots: 0, row: 1 });
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
    expect([...hero.inventory.items()]).toHaveLength(1);
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
    expect([...hero.inventory.items()].map((i) => i.instanceId)).toEqual(['i1']);
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
    hero.inventory.add({ instanceId: 'i1', itemId: 'sword', quantity: 1 }, catalogo, hero, { backpackSlots: 0, satchelSlots: 0, row: 1 });

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
    // p1 fica no ponto de entrada (2,2) e p2 entra no livre mais próximo A PÉ, que é o vizinho
    // ao norte, (2,1) (FUN-120). p2 anda para o oeste, que é (1,1) — dentro do mapa e livre.
    const { host, enter } = praca();
    const primeiro = enter('p1');
    const segundo = enter('p2');
    expect(host.sessionFor('p2')?.participants[1]?.position).toEqual({ x: 2, y: 1, z: 7 });
    primeiro.socket.frames.length = 0;

    host.handle(segundo.viewer, { type: 'walk', direction: 'west' });
    host.flush();

    const moves = primeiro.socket.received().filter((m) => m.type === 'creature-move');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from: { x: 2, y: 1, z: 7 }, to: { x: 1, y: 1, z: 7 } });
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
      type: 'enter-hunt', huntId: 'arena', difficulty: 'cautious',
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
      city: { mapId: 'city', stepDurationMs: 500 },
    });
    const shard = new CityShard(content, () => 0);
    // O relógio anda um passo a cada consulta (FUN-122): um passo por vez é a regra do
    // hospedeiro, e esta praça de teste dá centenas deles em sequência.
    let clock = 0;
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger,
      createSession: createCitySessionFactory(content, () => 0, shard),
      now: () => (clock += 1_000),
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

describe('o catálogo chega ao cliente (FUN-79, FUN-89)', () => {
  const content = testContent();
  const catalogue = buildCatalogue(content);
  const withCatalogue = () => new SessionHost({
    nodeId: 'n1', contentVersion: 'v-test', logger,
    createSession: createCitySessionFactory(content),
    catalogue: () => catalogue,
    now: () => 0,
  });

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
    expect(antesDoFlush.some((m) => m.type === 'catalogue')).toBe(false);

    host.flush();
    expect(socket.received().some((m) => m.type === 'catalogue')).toBe(true);
  });

  it('sai uma vez por conexão, com o que a tela mostra', () => {
    // A versão de conteúdo é fixada na sessão (invariante 7): o catálogo não muda enquanto ela
    // vive, então mandá-lo de novo seria repetir o mesmo pacote sem motivo.
    const host = withCatalogue();
    const socket = new FakeSocket();
    host.attach(socket, 'p1');
    host.flush();

    const sent = socket.received().filter((m) => m.type === 'catalogue');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      hunts: catalogue.hunts,
      bot: { vocabularyVersion: content.bot.vocabularyVersion },
    });
  });

  it('sem catálogo injetado, o host não inventa um', () => {
    // O host não conhece conteúdo (FUN-81): sem a função, ele não tem o que mandar — e mandar
    // uma lista vazia diria ao cliente que não há hunt nenhuma, que é diferente de "não sei".
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger,
      createSession: createCitySessionFactory(content),
      now: () => 0,
    });
    const socket = new FakeSocket();
    host.attach(socket, 'p1');
    host.flush();

    expect(socket.received().some((m) => m.type === 'catalogue')).toBe(false);
  });
});

describe('o inventário chega ao cliente (FUN-90)', () => {
  // Pelo SCHEMA, e não por literal: `Item` tem campos com default (`requires`, entre eles), e
  // uma fixture escrita à mão diverge do que `buildContent` produz — aqui isso explodia dentro
  // do `equip`, num erro que não tem nada a ver com o que o teste mede.
  // A aparência vem da tabela e não do schema desde a FUN-94, então ela entra depois do parse.
  const catalogo = new Map([['sword', {
    ...itemSchema.parse({
      id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand', weight: 50, attack: 20,
    }),
    appearanceId: 3264,
  }]]);
  const comMochila = () => {
    const content = testContent();
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger,
      createSession: (characterId) => {
        const session = createCitySessionFactory(content)(characterId);
        const character = session.participants[0];
        if (character !== undefined) {
          character.inventory.add(
            { instanceId: 'i1', itemId: 'sword', quantity: 1 }, catalogo, character,
            { backpackSlots: 0, satchelSlots: 0, row: 1 },
          );
        }
        return session;
      },
      itemCatalog: catalogo,
      now: () => 0,
    });
    return host;
  };

  it('sai ao ANEXAR, e não só depois do primeiro equipar', () => {
    // Uma mochila que abre vazia até alguém mexer nela mente — e o jogador conclui que o loot
    // não caiu.
    const host = comMochila();
    const socket = new FakeSocket();
    host.attach(socket, 'p1');
    host.flush();

    const sent = socket.received().filter((m) => m.type === 'inventory');
    expect(sent).toHaveLength(1);
    // Sem mochila nas costas (a fixture nasce só com a espada), o item está na BOLSA (#160).
    const message = sent[0];
    if (message?.type !== 'inventory') throw new Error('não veio inventory');
    expect(message.backpack).toEqual([]);
    expect(message.satchel[0]).toEqual({ instanceId: 'i1', itemId: 'sword', quantity: 1 });
  });

  it('o PESO vem calculado, e é o do servidor', () => {
    // O cliente não soma peso: quem sabe o que cabe é quem recusa.
    const host = comMochila();
    const socket = new FakeSocket();
    host.attach(socket, 'p1');
    host.flush();

    const sent = socket.received().find((m) => m.type === 'inventory');
    expect(sent?.type === 'inventory' && sent.capacity.used).toBe(50);
    expect(sent?.type === 'inventory' && sent.capacity.total).toBeGreaterThan(0);
  });

  it('equipar reenvia a mochila, e o sucesso NÃO vira mensagem de sistema', () => {
    // "Equipado com sucesso" é ruído. O item mudando de lugar na tela é a confirmação.
    const host = comMochila();
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    host.flush();
    socket.frames.length = 0;

    host.handle(viewer, { type: 'equip', instanceId: 'i1' });
    host.flush();

    const sent = socket.received();
    expect(sent.filter((m) => m.type === 'inventory')).toHaveLength(1);
    expect(sent.some((m) => m.type === 'system-message')).toBe(false);
    const inventory = sent.find((m) => m.type === 'inventory');
    expect(inventory?.type === 'inventory' && inventory.equipped['hand']?.instanceId).toBe('i1');
  });

  it('o equipado vai INTEIRO: id, item e quantidade, como uma entrada da mochila (FUN-108)', () => {
    // O `sim` MOVE o item para o corpo ao equipar — ele some da mochila. Com `slot →
    // instanceId` o cliente não tinha como chegar à definição, e o slot vestido ficava sem
    // nome e sem sprite. `received()` decodifica pelo schema do protocolo: um host que
    // voltasse a mandar só o id seria recusado em silêncio e o inventário NUNCA chegaria.
    // Mutação que mata: `equipped[slot] = item.instanceId` em `#sendInventory` — a
    // mensagem some do `received()` e `inventory` fica `undefined`.
    const host = comMochila();
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    host.flush();
    socket.frames.length = 0;

    host.handle(viewer, { type: 'equip', instanceId: 'i1' });
    host.flush();

    const inventory = socket.received().find((m) => m.type === 'inventory');
    expect(inventory?.type === 'inventory' && inventory.equipped).toEqual({
      hand: { instanceId: 'i1', itemId: 'sword', quantity: 1 },
    });
    // Saiu da mochila: o mesmo item não pode estar nos dois lugares.
    expect(inventory?.type === 'inventory' && inventory.backpack).toEqual([]);
  });

  it('a recusa vira MENSAGEM, e a mochila não é reenviada', () => {
    // Reenviar depois de uma recusa mandaria o mesmo estado de novo, dizendo que algo mudou.
    const host = comMochila();
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    host.flush();
    socket.frames.length = 0;

    host.handle(viewer, { type: 'equip', instanceId: 'nao-existe' });
    host.flush();

    expect(socket.received().some((m) => m.type === 'system-message')).toBe(true);
    expect(socket.received().some((m) => m.type === 'inventory')).toBe(false);
  });
});

describe('o monstro chega ao cliente (FUN-103)', () => {
  /**
   * Um host cuja sessão é uma HUNT DE VERDADE, com o `HuntRuleset` do `sim` e o conteúdo de
   * teste. É a primeira vez que este arquivo tem uma: todos os outros testes usam ruleset de
   * contagem ou a Cidade, e por isso nenhum deles jamais viu um monstro — que era exatamente
   * o defeito.
   */
  /**
   * Uma arena de 8×8 com o herói num canto e o spawn no oposto.
   *
   * A arena comum tem interior 2×2: o rato nasce COLADO no herói, e aí ninguém anda — o herói
   * para para lutar, o rato já está ao alcance. Para ver passo de monstro é preciso distância,
   * e um rato com raio de agressão bastante para ir buscá-la.
   */
  function wideArena(): RawContent {
    const raw = rawTestContent();
    const grid = ['########', '#......#', '#......#', '#......#', '#......#', '#......#', '#......#', '########'];
    // O anel interno, no sentido horário a partir de (1,1): 20 tiles, fechando um laço.
    const tiles: Array<{ x: number; y: number; z: number }> = [];
    for (let x = 1; x <= 6; x++) tiles.push({ x, y: 1, z: 7 });
    for (let y = 2; y <= 6; y++) tiles.push({ x: 6, y, z: 7 });
    for (let x = 5; x >= 1; x--) tiles.push({ x, y: 6, z: 7 });
    for (let y = 5; y >= 2; y--) tiles.push({ x: 1, y, z: 7 });
    return {
      ...raw,
      maps: [{ id: 'arena', z: 7, grid }, ...(raw.maps ?? []).filter((m) =>
        (m as { id: string }).id !== 'arena')],
      // O spawn no índice 10 é (6,6): o canto oposto ao herói em (1,1).
      routes: [{ id: 'arena-loop', mapId: 'arena', tiles, spawnPoints: [{ routeIndex: 10, radius: 1 }] }],
      monsters: (raw.monsters as Array<Record<string, unknown>>).map((m) =>
        m['id'] === 'rat' ? { ...m, health: 100_000, aggroRadius: 10 } : m),
    };
  }

  function hunt(over: Partial<{
    monsterCatalog: boolean; playerOutfitId: number;
    /** Um rato que aguenta: o herói de teste mata o comum num golpe, e aí não há o que ver. */
    tanky: boolean;
    /** A arena larga, para haver passo de monstro. Implica `tanky`. */
    wide: boolean;
    /** O rato deixa cadáver (FUN-123): aparência 7 na tabela, meio segundo no chão. */
    corpses: boolean;
  }> = {}) {
    const raw = rawTestContent();
    const withCorpses = (base: RawContent): RawContent => ({
      ...base,
      hunts: (base.hunts as Array<Record<string, unknown>>).map((h) => ({ ...h, corpseTtlMs: 500 })),
      appearances: (base.appearances as Array<Record<string, unknown>>).map((a) => ({ ...a, corpses: { rat: 7 } })),
    });
    const content = over.corpses === true
      ? buildContent(withCorpses(raw))
      : over.wide === true
        ? buildContent(wideArena())
        : over.tanky === true
          ? buildContent({
            ...raw,
            monsters: (raw.monsters as Array<Record<string, unknown>>).map((m) =>
              m['id'] === 'rat' ? { ...m, health: 100_000 } : m),
          })
          : testContent();
    let now = 0;
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: content.version, logger,
      now: () => now,
      ...(over.monsterCatalog === false ? {} : { monsterCatalog: content.monsters }),
      ...(over.playerOutfitId === undefined ? {} : { playerOutfitId: over.playerOutfitId }),
      createSession: (characterId) => {
        const session = createHuntSession({
          id: `hunt-${characterId}`, content, huntId: 'arena', difficulty: 'cautious',
          createdAtMs: 0,
        });
        session.enter(new CharacterRuntime({
          id: characterId,
          position: { x: 1, y: 1, z: 7 },
          health: 1_200, maxHealth: 1_200, mana: 50, maxMana: 50,
          level: 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
        }));
        return session;
      },
    });
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'hero');
    /** Avança o relógio do host em passos, drenando eventos a cada um. */
    const runFor = (ms: number, step = 100) => {
      for (let t = 0; t < ms; t += step) { now += step; host.cycle(); }
      host.flush();
    };
    /** O `session-state` é PEDIDO pelo cliente (`session-attach`), não vem no attach. */
    const stateOf = (sock: FakeSocket, who: ReturnType<typeof host.attach>) => {
      host.handle(who, { type: 'session-attach' });
      host.flush();
      return sock.received().filter((m) => m.type === 'session-state').at(-1) as
        { world: { creatures: Array<{ name: string; appearanceId: number; position: { z: number } }> } }
        | undefined;
    };
    return { host, socket, viewer, runFor, stateOf, received: () => socket.received() };
  }

  it('o abate vira ground-item-appear com a arte do cadáver, e o prazo vira ground-item-disappear (FUN-123)', () => {
    // O `sim` diz que o rato morreu e onde; a tabela diz que o rato morto é o objeto 7. Quem
    // reanexa no meio vê o cadáver no `session-state`; meio segundo depois ele some pelo id.
    const { host, socket, viewer, runFor, received } = hunt({ corpses: true });
    runFor(3_000, 100);
    const appeared = received().filter((m) => m.type === 'ground-item-appear');
    expect(appeared.length).toBeGreaterThan(0);
    expect(appeared[0]).toMatchObject({ appearanceId: 7, position: { z: 7 } });
    const gone = received().filter((m) => m.type === 'ground-item-disappear');
    expect(gone.length).toBeGreaterThan(0);
    // Todo id que sumiu tinha aparecido antes.
    const ids = new Set(appeared.map((m) => (m as { id: number }).id));
    for (const m of gone) expect(ids.has((m as { id: number }).id)).toBe(true);

    // O estado completo leva os que ainda estão no chão — e só eles.
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    const state = socket.received().filter((m) => m.type === 'session-state').at(-1) as
      { world: { groundItems: Array<{ id: number; appearanceId: number }> } } | undefined;
    const live = new Set(appeared.map((m) => (m as { id: number }).id));
    for (const m of gone) live.delete((m as { id: number }).id);
    expect(new Set(state?.world.groundItems.map((g) => g.id))).toEqual(live);
    for (const g of state?.world.groundItems ?? []) expect(g.appearanceId).toBe(7);
  });

  it('a hunt anuncia o mapa dela: instance-enter e session-state.world.mapId (FUN-120)', () => {
    const { host, socket, viewer } = hunt();
    host.handle(viewer, { type: 'session-attach' });
    host.flush();

    const received = socket.received();
    const enter = received.findIndex((m) => m.type === 'instance-enter');
    expect(received[enter]).toEqual({ type: 'instance-enter', instanceId: 'hunt-hero', map: 'arena' });
    expect(received[enter + 1]).toMatchObject({ type: 'session-state', world: { mapId: 'arena' } });
  });

  it('na hunt também é um passo por vez: a rajada de walk anda um tile por duração de passo (FUN-122)', () => {
    // O `walk` do jogador entra pelo mesmo `#requestWalk` em qualquer sessão, e antes da
    // trava a hunt aceitava a rajada — o personagem andava mais rápido que a fórmula do Tibia.
    const { host, socket, viewer } = hunt({ wide: true });
    host.flush();
    socket.frames.length = 0;
    const before = { ...host.sessionFor('hero')?.participants[0]?.position };
    for (let i = 0; i < 10; i++) host.handle(viewer, { type: 'walk', direction: 'east' });
    host.flush();
    const after = host.sessionFor('hero')?.participants[0]?.position;
    expect(after?.x).toBe((before.x ?? 0) + 1);
    expect(socket.received().filter((m) => m.type === 'creature-move' && m.id === 1)).toHaveLength(1);
  });

  it('o monstro que nasce vira creature-appear, com nome e outfit do catálogo', () => {
    // Antes disto o passo do monstro atravessava o fio com um id que ninguém tinha anunciado,
    // e o cliente descartava em silêncio — a hunt rodava inteira e a tela ficava vazia.
    const { runFor, received } = hunt();
    runFor(300);

    const appears = received().filter((m) => m.type === 'creature-appear');
    expect(appears.length).toBeGreaterThan(0);
    // Nome e outfit saem do CATÁLOGO, não do `sim` — que não conhece nem um nem outro.
    expect(appears[0]).toMatchObject({ name: 'Rat', health: 20, maxHealth: 20 });
    expect((appears[0] as { appearanceId: number }).appearanceId).toBeGreaterThan(0);
    // E o andar vem junto: o cliente desenha por `z`.
    expect((appears[0] as { position: { z: number } }).position.z).toBe(7);
  });

  it('NENHUM passo chega com id que não foi anunciado', () => {
    // Era exatamente o defeito: o passo do monstro atravessava o fio com um id que ninguém
    // tinha anunciado, e o cliente descartava em silêncio. Agora todo id de `creature-move`
    // ou é o do herói (que vem no `session-state`) ou foi apresentado por `creature-appear`.
    const { runFor, received, stateOf, socket, viewer } = hunt({ wide: true });
    const eu = stateOf(socket, viewer);
    const heroi = (eu as unknown as { self: { creatureId: number } } | undefined)?.self.creatureId;
    runFor(5_000);

    const anunciados = new Set(received().filter((m) => m.type === 'creature-appear')
      .map((m) => (m as { id: number }).id));
    const passos = received().filter((m) => m.type === 'creature-move')
      .map((m) => (m as { id: number }).id);
    expect(passos.length).toBeGreaterThan(0);
    for (const id of passos) expect(id === heroi || anunciados.has(id)).toBe(true);
    // E o monstro de fato andou: ao menos um passo é de um id anunciado.
    expect(passos.some((id) => anunciados.has(id))).toBe(true);
  });

  it('o analisador chega ao vivo: um abate durante a hunt vira mensagem, sem reconectar (FUN-110)', () => {
    // Era o defeito do passe de QA do MVP: três abates, level 2, 39 de gold no HUD — e a
    // janela em zero, porque os agregados só saíam no `session-state`. Mutação que mata:
    // apagar a chamada de `#presentAnalyzer` no ciclo.
    const { host, runFor, received } = hunt();
    runFor(60_000);
    const session = host.sessionFor('hero');
    expect(session?.aggregates.kills).toBeGreaterThan(0);

    const updates = received().filter((m) => m.type === 'analyzer') as unknown as
      Array<{ aggregates: { kills: number; xpGained: number; durationMs: number }; notableEvents: unknown[] }>;
    expect(updates.length).toBeGreaterThan(0);
    // A ÚLTIMA diz o que a sessão diz agora; o tempo dela é o do ciclo em que saiu, nunca à
    // frente do da sessão — é o que rebaseia o relógio da janela sem o fazer andar para trás.
    expect(updates.at(-1)?.aggregates.kills).toBe(session?.aggregates.kills);
    expect(updates.at(-1)?.aggregates.xpGained).toBe(session?.aggregates.xpGained);
    expect(updates.at(-1)?.aggregates.durationMs).toBeGreaterThan(0);
    expect(updates.at(-1)?.aggregates.durationMs).toBeLessThanOrEqual(session?.aggregates.durationMs ?? 0);
    // E os abates sobem entre uma e outra: cada mensagem é uma mudança, não um eco.
    const kills = updates.map((u) => u.aggregates.kills);
    expect(new Set(kills).size).toBe(kills.length);
  });

  it('cada um dos NOVE agregados é gatilho sozinho — e o session-attach zera a comparação', () => {
    // O passe de QA pegou "Mortos 0"; o que este teste impede é o mesmo defeito num campo só:
    // uma poção usada, um gasto, um golpe de magia que não mata. Mutação que mata: apagar
    // qualquer comparação de `sameAnalyzer`, ou o `#sendState` deixar de gravar `sentAnalyzer`
    // (o ciclo depois do attach mandaria um eco do que o `session-state` acabou de levar).
    const { host, runFor, received, viewer } = hunt({ tanky: true });
    const session = host.sessionFor('hero');
    if (session === undefined) throw new Error('sem sessão');
    const count = () => received().filter((m) => m.type === 'analyzer').length;

    // Depois do primeiro golpe (bestBasicHit), o attach leva tudo e zera: o ciclo seguinte,
    // em que só o tempo anda (o próximo golpe é a 2 000 ms), não manda NADA.
    runFor(100);
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    const afterAttach = count();
    runFor(100);
    expect(count()).toBe(afterAttach);

    const fields = [
      'xpGained', 'goldGained', 'goldSpent', 'kills', 'deaths', 'itemsLooted', 'suppliesUsed',
      'bestBasicHit', 'bestSpellHit',
    ] as const;
    for (const field of fields) {
      const before = count();
      session.aggregates[field] += 1;
      runFor(100);
      expect(count(), field).toBe(before + 1);
    }
    // E um evento notável novo, sozinho, também — e chega SÓ ele, não a lista inteira.
    const before = count();
    session.record('level-up', '99');
    runFor(100);
    expect(count()).toBe(before + 1);
    const last = received().filter((m) => m.type === 'analyzer').at(-1) as unknown as
      { notableEvents: Array<{ type: string; detail?: string }> };
    expect(last.notableEvents).toEqual([{ atMs: expect.any(Number), type: 'level-up', detail: '99' }]);
  });

  it('o tempo NÃO é gatilho: toda mensagem do analisador é uma mudança, nunca um tique', () => {
    // `durationMs` muda em todo ciclo; compará-lo mandaria a mensagem a 10 Hz para dizer que
    // cem milissegundos passaram. Com um rato que aguenta não há abate nem loot em vinte
    // ciclos — só o primeiro golpe, que sobe `bestBasicHit` uma vez e É mudança.
    // Mutação que mata: comparar `durationMs` em `sameAnalyzer` (vinte mensagens em vez de ≤ 2).
    const { host, runFor, received, viewer } = hunt({ tanky: true });
    // O `session-attach` leva os agregados e zera a comparação; a partir daqui só mudança manda.
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    const before = received().filter((m) => m.type === 'analyzer').length;
    runFor(2_000);
    const updates = received().filter((m) => m.type === 'analyzer').slice(before) as unknown as
      Array<{ aggregates: Record<string, number> }>;
    expect(host.sessionFor('hero')?.aggregates.kills).toBe(0);
    expect(updates.length).toBeLessThanOrEqual(2);
    // E cada uma difere da anterior em algo que NÃO é o tempo.
    const stripped = updates.map(({ aggregates: { durationMs: _duration, ...rest } }) => JSON.stringify(rest));
    for (let index = 1; index < stripped.length; index += 1) {
      expect(stripped[index]).not.toBe(stripped[index - 1]);
    }
  });

  it('o Bestiário chega no session-attach, DEPOIS dos vitais, mesmo sem abate nenhum (FUN-113)', () => {
    // Progressão que só viaja em mensagem própria: sem ela quem reconecta veria a contagem em
    // zero até o próximo abate — na Cidade, que não tem ciclo, para sempre. Vai pela FILA,
    // atrás do `session-state` e do `player-stats`, como tudo que responde ao attach.
    // Mutação que mata: apagar o `viewer.send` do Bestiário em `#sendState`.
    const { socket, viewer, stateOf, received } = hunt();
    stateOf(socket, viewer);

    const types = received().map((m) => m.type);
    const bestiary = received().filter((m) => m.type === 'bestiary');
    expect(bestiary).toHaveLength(1);
    expect(bestiary[0]).toEqual({ type: 'bestiary', counts: {} });
    expect(types.indexOf('bestiary')).toBeGreaterThan(types.indexOf('player-stats'));
  });

  it('o abate sobe o contador ao vivo: cada mensagem é uma mudança, e a última diz o que o sim diz (FUN-113)', () => {
    // O contador sobe no `sim` com ou sem visualizador (invariante 3); a mensagem é
    // apresentação, e sai quando a SOMA mudou desde a última entrega. Mutação que mata:
    // apagar a chamada de `#presentBestiary` no ciclo (nenhuma mensagem além do attach), ou
    // apagar a comparação com `sentBestiary` (uma por ciclo, e a lista teria repetição).
    const { host, socket, viewer, stateOf, runFor, received } = hunt();
    stateOf(socket, viewer);
    runFor(60_000);
    const hero = host.sessionFor('hero')?.participants[0];
    const kills = hero?.bestiary.killsOf('rat') ?? 0;
    expect(kills).toBeGreaterThan(1);

    const updates = received().filter((m) => m.type === 'bestiary') as unknown as
      Array<{ counts: Record<string, number> }>;
    // A do attach (vazia) e pelo menos uma por abate contado depois dela.
    expect(updates.length).toBeGreaterThan(1);
    expect(updates.at(-1)?.counts).toEqual({ rat: kills });
    const totals = updates.map((u) => u.counts['rat'] ?? 0);
    expect(new Set(totals).size).toBe(totals.length);
    // E o `sim` conta o mesmo que o analisador viu morrer: nenhum abate com stamina cheia
    // fica de fora do Bestiário.
    expect(kills).toBe(host.sessionFor('hero')?.aggregates.kills);
  });

  it('quem reanexa depois dos abates recebe o mapa CHEIO no session-attach (FUN-113)', () => {
    // Todo attach dos outros testes acontece antes do primeiro abate, então `{}` era o único
    // mapa jamais afirmado no attach — e um `#sendState` que mandasse `{}` sempre passava
    // (mutação que sobrevivia na revisão). Aqui o attach vem DEPOIS de sessenta segundos de
    // hunt, e o mapa tem que ser o do `sim`.
    const { host, socket, viewer, stateOf, runFor, received } = hunt();
    runFor(60_000);
    const kills = host.sessionFor('hero')?.participants[0]?.bestiary.killsOf('rat') ?? 0;
    expect(kills).toBeGreaterThan(1);
    const before = received().filter((m) => m.type === 'bestiary').length;

    stateOf(socket, viewer);
    const messages = received().filter((m) => m.type === 'bestiary') as unknown as
      Array<{ counts: Record<string, number> }>;
    expect(messages.length).toBe(before + 1);
    expect(messages.at(-1)?.counts).toEqual({ rat: kills });
    // E o attach zerou a comparação: um ciclo sem abate não manda de novo.
    runFor(100, 100);
    expect(host.sessionFor('hero')?.participants[0]?.bestiary.killsOf('rat')).toBe(kills);
    expect(received().filter((m) => m.type === 'bestiary').length).toBe(before + 1);
  });

  it('sem abate não sai Bestiário nenhum — o tempo não é gatilho (FUN-113)', () => {
    // Um rato que aguenta: vinte ciclos com golpe, dano e passo, e o contador parado. O
    // `session-attach` leva o mapa e zera a comparação; a partir daí só mudança manda.
    // Mutação que mata: comparar com `undefined` em vez da soma entregue (uma por ciclo).
    const { host, socket, viewer, stateOf, runFor, received } = hunt({ tanky: true });
    stateOf(socket, viewer);
    const before = received().filter((m) => m.type === 'bestiary').length;
    expect(before).toBe(1);

    runFor(2_000);

    expect(host.sessionFor('hero')?.aggregates.kills).toBe(0);
    expect(received().filter((m) => m.type === 'bestiary')).toHaveLength(before);
  });

  it('a vida do monstro desce por creature-health, e a morte vira creature-disappear', () => {
    // `creature-health` existia no protocolo sem emissor nenhum: o monstro aparecia, andava e
    // morria com a barra cheia o tempo todo — e o sintoma parecia bug do cliente.
    const { host, runFor, received } = hunt();
    runFor(60_000);

    const session = host.sessionFor('hero');
    expect(session?.aggregates.kills).toBeGreaterThan(0);

    const healths = received().filter((m) => m.type === 'creature-health');
    const gone = received().filter((m) => m.type === 'creature-disappear');
    expect(healths.length).toBeGreaterThan(0);
    expect(gone).toHaveLength(session?.aggregates.kills ?? -1);
    // O ÚLTIMO creature-health de quem sumiu chegou a zero, e o máximo é o do catálogo.
    for (const g of gone) {
      const dele = healths.filter((h) => (h as { id: number }).id === (g as { id: number }).id);
      expect(dele.length).toBeGreaterThan(0);
      expect(dele[dele.length - 1]).toMatchObject({ health: 0, maxHealth: 20 });
    }
  });

  it('o id numérico NUNCA se repete depois de um ciclo de morte e respawn', () => {
    // `size + 1` reciclava: com {a:1, b:2, c:3}, remover b faz o próximo receber 3 — e com
    // respawn constante o cliente desenhava o morto no lugar do vivo. É invisível em qualquer
    // cenário só de personagem, e por isso nenhum teste antigo pegava.
    const { runFor, received } = hunt();
    runFor(90_000);

    const appears = received().filter((m) => m.type === 'creature-appear')
      .map((m) => (m as { id: number }).id);
    const gone = received().filter((m) => m.type === 'creature-disappear');
    // Houve morte E renascimento — senão o teste não exercita a reciclagem.
    expect(gone.length).toBeGreaterThan(1);
    expect(appears.length).toBeGreaterThan(1);
    expect(new Set(appears).size).toBe(appears.length);
  });

  it('quem reanexa no meio vê os monstros VIVOS no session-state', () => {
    // Não só o que nascer depois: o que já está lá também. Sem isto, reconectar mostraria uma
    // adega vazia até o próximo respawn.
    const { host, runFor, stateOf } = hunt({ tanky: true });
    runFor(500);

    const late = new FakeSocket();
    const lateViewer = host.attach(late, 'hero');
    const state = stateOf(late, lateViewer);
    const ratos = state?.world.creatures.filter((c) => c.name === 'Rat') ?? [];
    expect(ratos.length).toBeGreaterThan(0);
    expect(ratos[0]?.appearanceId).toBeGreaterThan(0);
    expect(ratos[0]?.position.z).toBe(7);
  });

  it('o personagem veste o outfit padrão do conteúdo, e não o `1` fixo', () => {
    // Outfit 1 no pacote 1332 é um ícone amarelo de 32×32 — não um humanoide. Ligar os sprites
    // sem mexer aqui trocaria "retângulo verde" por "blob amarelo".
    const { stateOf, socket, viewer } = hunt({ playerOutfitId: 128 });
    const state = stateOf(socket, viewer);
    const eu = state?.world.creatures.find((c) => c.name === 'hero');
    expect(eu?.appearanceId).toBe(128);
  });

  it('sem catálogo o monstro AINDA aparece — sem nome, outfit 0', () => {
    // Sumir com ele esconderia de quem olha que a simulação está de pé. Degradação visível é
    // melhor que tela vazia sem causa.
    const { runFor, received } = hunt({ monsterCatalog: false });
    runFor(300);
    const appears = received().filter((m) => m.type === 'creature-appear');
    expect(appears.length).toBeGreaterThan(0);
    expect(appears[0]).toMatchObject({ name: 'rat', appearanceId: 0 });
  });
});

describe('as cores do outfit chegam ao cliente (FUN-104)', () => {
  const COLORS: OutfitColors = { head: 78, body: 69, legs: 58, feet: 76 };
  const PAINTED: OutfitColors = { head: 114, body: 20, legs: 3, feet: 132 };

  type Creature = { name: string; colors?: OutfitColors };
  /** O `session-state` é PEDIDO pelo cliente (`session-attach`), não vem no attach. */
  const stateOf = (host: SessionHost, socket: FakeSocket, viewer: ReturnType<SessionHost['attach']>) => {
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    return socket.received().filter((m) => m.type === 'session-state').at(-1) as
      { world: { creatures: Creature[] } } | undefined;
  };
  const appearsOn = (socket: FakeSocket) =>
    socket.received().filter((m) => m.type === 'creature-appear') as unknown as Creature[];

  /**
   * A praça de verdade (como na FUN-71), mas entrando por `prepare`: é o TICKET que traz as
   * cores, e `attach` sem preparo monta a sessão sem ticket nenhum. Sem diretório o preparo
   * não registra nada — o que se exercita é só a adoção do que o ticket carrega.
   *
   * O nome de exibição é DIFERENTE do id de propósito. O da FUN-71 usa os dois iguais, e por
   * isso nunca viu que o anúncio de chegada saía antes de o nome do ticket ser adotado.
   */
  const praca = () => {
    const content = testContent();
    const now = () => 0;
    const shard = new CityShard(content, now);
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger, now,
      createSession: createCitySessionFactory(content, now, shard),
    });
    const enter = async (characterId: string, outfitColors?: OutfitColors) => {
      await host.prepare(characterId, {
        level: 1, xp: 0, name: `Nome de ${characterId}`,
        ...(outfitColors === undefined ? {} : { outfitColors }),
      }, 'a1');
      const socket = new FakeSocket();
      const viewer = host.attach(socket, characterId);
      return { socket, viewer };
    };
    return { host, enter };
  };

  it('quem chega pintado aparece pintado para quem já estava, e no session-state de quem reanexa', async () => {
    // Os dois caminhos pelos quais um personagem chega à tela de outro, e o cliente aplica
    // os dois pelo mesmo `CreatureState`: um sem cores viraria a diferença entre "vi chegar"
    // e "reconectei".
    const { host, enter } = praca();
    const primeiro = await enter('p1', COLORS);
    primeiro.socket.frames.length = 0;

    const segundo = await enter('p2', PAINTED);
    host.flush();

    // `received()` passa pelo codec de verdade: o campo sobreviveu ao protocolo, não só ao
    // objeto em memória.
    expect(appearsOn(primeiro.socket)).toEqual([
      expect.objectContaining({ name: 'Nome de p2', colors: PAINTED }),
    ]);

    const visto = stateOf(host, segundo.socket, segundo.viewer);
    expect(visto?.world.creatures.find((c) => c.name === 'Nome de p1')?.colors).toEqual(COLORS);
    expect(visto?.world.creatures.find((c) => c.name === 'Nome de p2')?.colors).toEqual(PAINTED);
  });

  it('sem cores no ticket a chave NÃO existe — nem como undefined', async () => {
    // Personagem que nunca escolheu, ou ticket de um `api` antigo. O cliente lê a AUSÊNCIA como
    // "pinte o padrão"; uma chave `undefined` seria apagada pelo JSON de qualquer jeito, e o
    // tipo passaria a mentir sobre o que foi mandado.
    const { host, enter } = praca();
    const primeiro = await enter('p1');
    primeiro.socket.frames.length = 0;
    const segundo = await enter('p2');
    host.flush();

    const [appear] = appearsOn(primeiro.socket);
    expect(appear).toMatchObject({ name: 'Nome de p2' });
    expect(appear).not.toHaveProperty('colors');

    const visto = stateOf(host, segundo.socket, segundo.viewer);
    expect(visto?.world.creatures).toHaveLength(2);
    for (const creature of visto?.world.creatures ?? []) expect(creature).not.toHaveProperty('colors');
  });

  it('sair apaga as cores: quem volta com um ticket sem elas volta sem elas', async () => {
    // As cores vivem com o nome, e morrem com ele. Sem o `delete` no `release`, uma escolha
    // desfeita continuaria pintando o personagem até o nó reiniciar.
    const { host, enter } = praca();
    const primeiro = await enter('p1');
    await enter('p2', PAINTED);
    await host.release('p2');
    // Esvazia o que a primeira entrada e a saída enfileiraram ANTES de limpar: o visualizador
    // só escreve no socket no `flush`, e limpar antes dele deixaria o aparecimento pintado na
    // frente do que se quer ler.
    host.flush();
    primeiro.socket.frames.length = 0;

    await enter('p2');
    host.flush();

    const appears = appearsOn(primeiro.socket);
    expect(appears).toHaveLength(1);
    expect(appears[0]).toMatchObject({ name: 'Nome de p2' });
    expect(appears[0]).not.toHaveProperty('colors');
  });

  it('o monstro NUNCA traz cores, mesmo ao lado de um herói pintado', async () => {
    // O rato é uma camada só: o campo é de personagem, e a tabela é indexada por
    // `characterId`. Mandar `colors` num monstro faria o cliente tentar pintar o que não
    // tem máscara — e o herói pintado ao lado prova que a tabela estava povoada.
    // Um rato que AGUENTA, como no fixture da FUN-109: o herói de teste mata o comum num
    // golpe, e o `session-state` só lista monstro vivo — com o rato comum a lista vinha
    // vazia e o laço abaixo não afirmava nada (a mutação que sobreviveu na revisão).
    const raw = rawTestContent();
    const content = buildContent({
      ...raw,
      monsters: (raw.monsters as Array<Record<string, unknown>>).map((m) =>
        m['id'] === 'rat' ? { ...m, health: 100_000 } : m),
    });
    let now = 0;
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: content.version, logger, now: () => now,
      monsterCatalog: content.monsters,
      createSession: (characterId) => {
        const session = createHuntSession({
          id: `hunt-${characterId}`, content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
        });
        session.enter(new CharacterRuntime({
          id: characterId,
          position: { x: 1, y: 1, z: 7 },
          health: 1_200, maxHealth: 1_200, mana: 50, maxMana: 50,
          level: 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
        }));
        return session;
      },
    });
    await host.prepare('hero', { level: 8, xp: 0, name: 'hero', outfitColors: COLORS }, 'a1');
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'hero');
    for (let t = 0; t < 300; t += 100) { now += 100; host.cycle(); }
    host.flush();

    const ratos = appearsOn(socket).filter((c) => c.name === 'Rat');
    expect(ratos.length).toBeGreaterThan(0);
    for (const rato of ratos) expect(rato).not.toHaveProperty('colors');

    const visto = stateOf(host, socket, viewer);
    expect(visto?.world.creatures.find((c) => c.name === 'hero')?.colors).toEqual(COLORS);
    const vivos = visto?.world.creatures.filter((c) => c.name === 'Rat') ?? [];
    expect(vivos.length).toBeGreaterThan(0);
    for (const rato of vivos) expect(rato).not.toHaveProperty('colors');
  });

  it('quem já está hospedado continua com as cores com que entrou, mesmo com ticket novo', async () => {
    // O que o `packages/server/AGENTS.md` promete, prendido: `#prepare` de um personagem já
    // hospedado devolve `created: false` sem ler o ticket novo, então uma escolha feita no
    // meio da sessão só aparece na PRÓXIMA entrada. Se a §7.4 decidir o contrário um dia, é
    // este teste que vai virar, de propósito e à vista.
    const { host, enter } = praca();
    const { socket, viewer } = await enter('p1', COLORS);
    const again = await host.prepare('p1', { level: 1, xp: 0, name: 'Outro nome', outfitColors: PAINTED }, 'a1');
    expect(again.created).toBe(false);
    const visto = stateOf(host, socket, viewer);
    const eu = visto?.world.creatures.find((c) => c.name === 'Nome de p1');
    expect(eu).toBeDefined();
    expect(eu?.colors).toEqual(COLORS);
  });
});

describe('o combate e os vitais chegam ao cliente (FUN-109)', () => {
  /**
   * Magia de dano e poção de mana, que o conteúdo de teste não tem: `strike` tira 40 num rato
   * de 20 — mata num golpe, e é o que faz o `creature-hit` de magia aparecer cedo.
   */
  const STRIKE = {
    id: 'strike', name: 'Golpe Arcano', manaCost: 15, cooldownMs: 2_000,
    effect: { kind: 'damage', power: 40, range: 3 },
  };
  /**
   * A magia de ÁREA (FUN-92): raio 1 a partir do alvo. Na arena de 2×2 todo tile interior é
   * vizinho de todo outro, então dois ratos vivos são sempre dois alvos do mesmo lançamento.
   */
  const BLAST = {
    id: 'blast', name: 'Explosão', manaCost: 20, cooldownMs: 2_000,
    effect: { kind: 'damage', power: 40, range: 3, area: { radius: 1 } },
  };
  /** A tabela de aparências do teste. Números do contrato, para o teste ler igual ao real. */
  const TABLE = {
    spells: {
      heal: { effect: 13 }, strike: { effect: 12, missile: 5 }, blast: { effect: 15, missile: 6 },
    },
    supplies: { 'health-potion': { effect: 14 } },
    hits: { melee: 1 },
    // O projétil do tiro (#152): o da flecha é da MUNIÇÃO, o da wand é da ARMA.
    ammunition: { arrow: { icon: 3447, missile: 3 } },
    weapons: { wand: { missile: 5 } },
  } as const;
  /** As armas de tiro do #152, e a flecha grátis que o bow atira sem ninguém escolher. */
  const BOW = {
    id: 'bow', name: 'Bow', kind: 'weapon', slot: 'hand', weight: 1, twoHanded: true,
    weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' },
  };
  const WAND = {
    id: 'wand', name: 'Wand', kind: 'weapon', slot: 'hand', weight: 1,
    weapon: { kind: 'wand', range: 3, manaPerHit: 2, damage: { min: 5, max: 5 } },
  };
  const ARROW = { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 20, price: 0 };
  /** Um dia inteiro de stamina — o teto de `TEST_STAMINA`, e exatamente 24:00 no HUD. */
  const FULL_STAMINA_MS = 86_400_000;
  /** Stamina no MEIO de um minuto: três segundos de hunt não viram o mostrador. */
  const MID_MINUTE_STAMINA_MS = FULL_STAMINA_MS - 30_000;
  /** A stamina como o HUD a mostra, e como `sameStats` a compara: em minutos inteiros. */
  const staminaMinute = (staminaMs: number) => Math.floor(staminaMs / 60_000);

  const rules = (over: Partial<BotConfig>): BotConfig => botConfigSchema.parse({
    version: BOT_VOCABULARY_VERSION,
    heal: [], potion: [], attack: [], rune: [], support: [],
    ...over,
  });
  const ofType = <T extends S2CMessage['type']>(messages: readonly S2CMessage[], type: T) =>
    messages.filter((m): m is Extract<S2CMessage, { type: T }> => m.type === type);

  /**
   * Uma hunt de verdade, como na FUN-103, mais o que esta issue precisa: a tabela de
   * aparências, uma configuração de bot, e um herói que pode nascer ferido, sem mana ou com
   * gold — porque é assim que se força uma cura, uma poção ou uma magia num teste curto.
   *
   * O herói nasce no LEVEL 1, com os máximos que a progressão dá ao level 1 — e não "level 8
   * com 50 de mana" como o helper da FUN-103. Aquele herói é inconsistente de propósito e
   * ninguém notava: no primeiro abate `grantXp` recalcula o level a partir da XP (zero → 1) e
   * os máximos voltam à tabela, o que zera a mana. Para uma hunt de golpe não faz diferença;
   * para uma que precisa lançar magia, faz toda — o bot nunca teria com quê.
   *
   * A mana inicial vem de uma progressão com `startingMana` alto, como o `withSpells` do
   * `sim`: a de teste nasce com zero, e um herói sem mana não testa magia nenhuma.
   *
   * E o herói TEM stamina — um dia inteiro, o teto. O helper da FUN-103 não tem, e foi assim
   * que a comparação exata de `staminaMs` passou pelo teste de "ciclo sem mudança": sem
   * stamina não há o que queimar, e o `sim` queima a cada evento que vence. Aqui ela queima
   * como em produção, e o teste que conta `player-stats` conta o que a produção manda.
   */
  function hunt(over: Partial<{
    table: boolean; bot: BotConfig; health: number; mana: number; gold: number;
    /** Sem spawn: uma hunt em que NADA acontece, para provar que nada é enviado. */
    monsters: boolean;
    /** Um rato que aguenta (como na FUN-103): o herói mata o comum num golpe e para de andar. */
    tanky: boolean;
    /** Quanto a hunt corre SEM NINGUÉM olhando antes de o visualizador chegar. */
    beforeMs: number;
    /** Sem `session-attach`: o socket está ligado, mas o cliente nunca pediu o mundo. */
    state: boolean;
    /** A stamina de nascença, em ms. Padrão: o dia inteiro, que é exatamente 24:00 no HUD. */
    stamina: number;
    /** Campos do rato trocados por cima do de teste: armadura, ataque, loot. */
    rat: Record<string, unknown>;
    /** Coeficientes de combate trocados por cima de `TEST_COMBAT`: o piso de dano, sobretudo. */
    combat: Record<string, unknown>;
    /** Quantos ratos por ponto de spawn. Padrão: um. */
    monsterCount: number;
    /** `false` desliga a regeneração: vida e mana ficam paradas quando nada as toca. */
    regen: boolean;
    /** O herói nasce com esta arma na mão, e o conteúdo com ela e com a flecha (#152). */
    weapon: 'bow' | 'wand';
  }> = {}) {
    const raw = rawTestContent();
    // Item e munição precisam de linha na tabela de aparência (FUN-94): a tabela derivada é
    // refeita com eles, e a de teste (`TABLE`) entra por cima só no host.
    const armory = over.weapon === undefined
      ? {}
      : { items: [BOW, WAND], ammunition: [ARROW] };
    const armed = over.weapon === undefined
      ? {}
      : {
        inventory: {
          backpack: [],
          equipped: { hand: { instanceId: `i-${over.weapon}`, itemId: over.weapon, quantity: 1 } },
        },
      };
    const ratOverride = {
      ...(over.tanky === true ? { health: 100_000 } : {}),
      ...(over.rat ?? {}),
    };
    const content = buildContent({
      ...raw,
      ...armory,
      ...(over.weapon === undefined ? {} : { appearances: [placeholderAppearances({ ...raw, ...armory })] }),
      spells: [...(raw.spells ?? []), STRIKE, BLAST],
      progression: [{
        ...TEST_PROGRESSION, startingMana: 200,
        ...(over.regen === false ? { regen: { healthPerSecond: 0, manaPerSecond: 0 } } : {}),
      }],
      ...(over.combat === undefined ? {} : { combat: [{ ...TEST_COMBAT, ...over.combat }] }),
      ...(over.monsterCount === undefined
        ? {}
        : {
          hunts: [{
            ...TEST_HUNT,
            difficulties: {
              cautious: { ...TEST_HUNT.difficulties.cautious, monsterCount: over.monsterCount },
            },
          }],
        }),
      ...(over.monsters === false
        ? { routes: [{ ...TEST_ROUTE, spawnPoints: [] }] }
        : {}),
      ...(Object.keys(ratOverride).length > 0
        ? {
          monsters: (raw.monsters as Array<Record<string, unknown>>).map((m) =>
            m['id'] === 'rat' ? { ...m, ...ratOverride } : m),
        }
        : {}),
    });
    const appearances = { ...(content.appearances as Appearances), ...TABLE };
    const stats = statsForLevel(1, null, content.progression);
    let now = 0;
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: content.version, logger,
      now: () => now,
      monsterCatalog: content.monsters,
      ...(over.table === false ? {} : { appearances }),
      createSession: (characterId) => {
        const session = createHuntSession({
          id: `hunt-${characterId}`, content, huntId: 'arena', difficulty: 'cautious',
          createdAtMs: 0,
          ...(over.bot === undefined ? {} : { botConfig: over.bot }),
        });
        session.enter(new CharacterRuntime({
          id: characterId,
          position: { x: 1, y: 1, z: 7 },
          health: over.health ?? stats.maxHealth, maxHealth: stats.maxHealth,
          mana: over.mana ?? stats.maxMana, maxMana: stats.maxMana,
          level: 1, xp: 0, gold: over.gold ?? 0, goldDelta: 0, alive: true, cooldowns: {},
          staminaMs: over.stamina ?? FULL_STAMINA_MS, staminaUpdatedAtMs: 0,
          ...armed,
        }));
        return session;
      },
    });
    const runFor = (ms: number, step = 100) => {
      for (let t = 0; t < ms; t += step) { now += step; host.cycle(); }
      host.flush();
    };
    // A sessão precisa existir para correr sem ninguém: `attach` é quem a cria neste host sem
    // diretório, então o visualizador entra e sai, e só depois o de verdade chega.
    if (over.beforeMs !== undefined) {
      host.detach(host.attach(new FakeSocket(), 'hero'));
      runFor(over.beforeMs);
    }
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'hero');
    // O `session-state` é pedido pelo cliente; é ele que dá ao herói o id numérico — sem isto
    // nenhum golpe no herói teria como ser apresentado, e o teste mediria o vazio.
    if (over.state !== false) host.handle(viewer, { type: 'session-attach' });
    host.flush();
    const state = ofType(socket.received(), 'session-state').at(-1);
    if (over.state !== false && state === undefined) throw new Error('session-attach não respondeu');
    const heroId = state?.self.creatureId ?? -1;
    const hero = () => host.sessionFor('hero')?.participants[0] as CharacterRuntime;
    /**
     * Onde o cliente DESENHA o herói no instante da mensagem `at`: o destino do último passo
     * dele antes dela, ou o tile de entrada se ainda não andou. A rota tem dois tiles no
     * mínimo, então o herói anda desde o primeiro instante — e "no tile do conjurador" só
     * pode ser conferido contra o que o cliente viu, não contra a posição inicial.
     */
    const heroTileAt = (all: readonly S2CMessage[], at: number) => {
      const last = ofType(all.slice(0, at), 'creature-move').filter((m) => m.id === heroId).at(-1);
      return last?.to ?? { x: 1, y: 1, z: 7 };
    };
    return {
      host, socket, viewer, heroId, runFor, hero, heroTileAt, maxHealth: stats.maxHealth,
      maxMana: stats.maxMana, received: () => socket.received(),
    };
  }

  it('o golpe do monstro vira creature-hit e creature-health do herói, e DEPOIS player-stats com o HP novo', () => {
    // Antes disto a vida do jogador só chegava no `session-state` da reanexação: a barra dele
    // ficava parada a hunt inteira enquanto a do rato andava, e quem olhava não sabia se
    // estava apanhando.
    //
    // Mutação que mata: apagar a chamada de `#presentStats` no ciclo — sobra só o
    // `player-stats` do `session-attach`, com a vida cheia. Mover `#presentStats` para
    // ANTES de `#presentMoves` mata pela ordem: o HP novo chega antes do golpe que o causou.
    // Descartar em `#presentPresence` o `creature-health-changed` cuja chave não é de monstro
    // mata pela barra: o herói apanha e `creature-health` do id dele nunca sai.
    const { runFor, received, heroId, hero } = hunt();
    runFor(10_000);

    // UMA leitura: `received()` decodifica os frames de novo a cada chamada, e a ordem entre
    // mensagens só faz sentido dentro da mesma lista.
    const all = received();
    const hits = ofType(all, 'creature-hit').filter((h) => h.id === heroId);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.kind).toBe('melee');
      expect(hit.amount).toBeGreaterThan(0);
    }
    const bars = ofType(all, 'creature-health').filter((h) => h.id === heroId);
    expect(bars.length).toBeGreaterThan(0);
    // A barra é a vida com que ele terminou — o golpe passou pela fila, não só pelo `sim`.
    expect(bars.at(-1)?.health).toBe(hero().health);

    const stats = ofType(all, 'player-stats');
    const ferido = stats.find((s) => s.health < s.maxHealth);
    expect(ferido).toBeDefined();
    expect(stats.at(-1)?.health).toBe(hero().health);
    // O golpe explica o número: o primeiro `player-stats` ferido vem DEPOIS do primeiro golpe.
    expect(all.indexOf(ferido as S2CMessage)).toBeGreaterThan(all.indexOf(hits[0] as S2CMessage));
  });

  it('a mana gasta numa magia chega em player-stats, mesmo sem a vida mudar', () => {
    // É a mutação que o campo a campo existe para pegar: comparar só `health` deixaria a cura
    // de vida cheia — que gasta 20 de mana e repõe zero — sem nenhum `player-stats`, e o HUD
    // mostraria mana cheia depois de dez curas.
    //
    // Mutação que mata: `sameStats` devolvendo `a.health === b.health` só.
    const { runFor, received, maxHealth, maxMana } = hunt({
      monsters: false,
      bot: rules({ heal: [{
        when: { kind: 'hp', op: '<=', percent: 100 }, do: { kind: 'spell', spellId: 'heal' },
      }] }),
    });
    runFor(300);

    const stats = ofType(received(), 'player-stats');
    expect(stats.some((s) => s.mana < maxMana)).toBe(true);
    // E a vida não mexeu — o teste é sobre mana, e precisa provar que só ela mudou.
    expect(stats.every((s) => s.health === maxHealth)).toBe(true);
  });

  it('ciclo sem mudança NÃO manda player-stats nenhum a mais — a stamina queimando inclusive', () => {
    // Nove números a 10 Hz para dizer que nada mudou é a banda inteira que a FUN-13 orça. O
    // herói TEM stamina, e o `sim` a queima a cada evento que vence (as regras de saída, a
    // cada 250 ms): comparar `staminaMs` exato mandava um `player-stats` por ciclo — em
    // produção, 482 em 120 s, mais que `creature-move`. O HUD mostra horas e minutos, e é no
    // minuto que a comparação olha.
    //
    // O helper nasce com o dia inteiro, que é EXATAMENTE 24:00: a primeira queima vira o
    // mostrador para 23:59, e esse é o único `player-stats` legítimo além do `session-attach`
    // em três segundos de hunt vazia.
    //
    // Mutação que mata: `a.staminaMs === b.staminaMs` de volta em `sameStats` — sobem para
    // treze (um por vencimento das regras de saída). Tirar o `sameStats` do `#presentStats`
    // (mandar sempre) sobe para trinta e um.
    const { runFor, received, hero } = hunt({ monsters: false });
    runFor(3_000);

    const stats = ofType(received(), 'player-stats');
    expect(stats.length).toBeLessThanOrEqual(2);
    // A stamina QUEIMOU — o `sim` não a poupou, só o fio não a repetiu a cada ciclo.
    expect(hero().staminaMs).toBeLessThan(FULL_STAMINA_MS);
    expect(hero().staminaMs).toBeGreaterThan(0);
    // E a hunt de fato correu: o relógio da sessão andou, só não havia o que contar.
    expect(ofType(received(), 'creature-move').length).toBeGreaterThan(0);
  });

  it('o player-stats entregue é a referência da comparação: uma mudança, e depois silêncio', () => {
    // O rato bate UMA vez e nunca mais (intervalo de ataque maior que o teste), a regeneração
    // está desligada, e a stamina nasce no meio de um minuto: depois do golpe, dez segundos em
    // que os nove campos não mexem. Se `#presentStats` compara com o que ENTREGOU, sai um
    // `player-stats` pelo golpe e nenhum depois; se compara com o do `session-attach` para
    // sempre, cada ciclo redescobre que a vida caiu e manda de novo — cem vezes.
    //
    // Mutação que mata: apagar o `hosted.sentStats.set(...)` de `#presentStats` — sobem
    // para cento e um, um por ciclo depois do golpe.
    const { runFor, received, maxHealth } = hunt({
      tanky: true, regen: false, stamina: MID_MINUTE_STAMINA_MS,
      rat: { attackIntervalMs: 600_000 },
    });
    runFor(10_000);

    const stats = ofType(received(), 'player-stats');
    // O golpe chegou ao HUD — senão o teste mediria uma hunt em que nada aconteceu.
    expect(stats.some((s) => s.health < maxHealth)).toBe(true);
    // O do `session-attach` e o do golpe. Nem um a mais.
    expect(stats.length).toBeLessThanOrEqual(2);
    // Dito de outro jeito, e vale para qualquer roteiro: nenhum repete o que veio antes.
    for (let i = 1; i < stats.length; i += 1) {
      const [before, after] = [stats[i - 1], stats[i]] as [typeof stats[number], typeof stats[number]];
      expect({ ...after, staminaMs: staminaMinute(after.staminaMs) })
        .not.toEqual({ ...before, staminaMs: staminaMinute(before.staminaMs) });
    }
  });

  it('o abate chega ao HUD: o player-stats leva a XP e o level do herói, não zero', () => {
    // O `session-state` também leva XP e level, e por isso um `xp: 0` fixo em `playerStatsOf`
    // passava pelos testes de reanexação — o HUD só ficava errado DEPOIS, quando o ciclo
    // atualizava. Seis abates dão 30 de XP, e 20 é o level 2: o último `player-stats` tem
    // de dizer a XP acumulada e o level que o `sim` calculou a partir dela.
    //
    // Mutação que mata: `xp: 0` em `playerStatsOf` (a XP do fio fica em zero com o herói em
    // 30); `level: 0` idem, pelo level.
    const { runFor, received, hero } = hunt();
    runFor(10_000);

    expect(hero().xp).toBeGreaterThan(0);
    expect(hero().level).toBeGreaterThan(1);
    const last = ofType(received(), 'player-stats').at(-1);
    expect(last?.xp).toBe(hero().xp);
    expect(last?.level).toBe(hero().level);
  });

  it('uma mudança SÓ de XP gera player-stats — a comparação olha a XP', () => {
    // O rato não machuca (`attack: 0`), não larga gold, a regeneração está desligada, e a
    // stamina nasce no meio de um minuto: dos nove campos, o abate mexe na XP e em nada mais.
    // Se `sameStats` não olhar a XP, o HUD fica em zero a hunt inteira — e nenhum outro teste
    // pega, porque em todos os outros o abate vem com gold junto.
    //
    // Mutação que mata: tirar `a.xp === b.xp` de `sameStats` — sobra só o `player-stats`
    // do `session-attach`, com XP zero.
    const { runFor, received, hero } = hunt({
      regen: false, stamina: MID_MINUTE_STAMINA_MS,
      rat: { attack: 0, loot: { items: [] } },
    });
    runFor(3_000);

    const stats = ofType(received(), 'player-stats');
    const first = stats[0] as (typeof stats)[number];
    expect(hero().xp).toBeGreaterThan(0);
    expect(stats.at(-1)?.xp).toBe(hero().xp);
    expect(stats.length).toBeGreaterThan(1);
    // E foi SÓ a XP: os outros oito campos são os do `session-attach`, em todos.
    for (const s of stats) {
      expect({ ...s, xp: 0, staminaMs: staminaMinute(s.staminaMs) })
        .toEqual({ ...first, xp: 0, staminaMs: staminaMinute(first.staminaMs) });
    }
  });

  it('a magia com tabela vira missile do conjurador ao alvo e effect NO alvo, com os ids da tabela', () => {
    // O `sim` diz "saiu `strike` contra o rato"; a tabela diz que isso é o projétil 5 e a
    // explosão 12 (invariante 6). A ordem é a do Tibia: o projétil voa, o efeito estoura no
    // tile de chegada, o número cai.
    //
    // Na arena de 2×2 o rato nasce colado e o primeiro morre no golpe engatilhado do herói,
    // antes de bater; o segundo nasce com esse golpe em cooldown e bate primeiro — e é o dano
    // levado que acorda a categoria `attack` do bot (é assim que o `sim` a arma). A magia sai
    // aí, com `targets ≥ 1`, e por isso a hunt precisa de alguns segundos.
    //
    // Mutação que mata: trocar `from` e `to` no `missile` — o `effect` deixa de estourar
    // onde o projétil chegou. `effectId: look.missile` mata pelo id.
    const { runFor, received } = hunt({
      bot: rules({ attack: [{
        when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'strike' },
      }] }),
    });
    runFor(5_000);

    const all = received();
    const missile = ofType(all, 'missile')[0];
    expect(missile).toBeDefined();
    expect(missile?.missileId).toBe(5);
    expect(missile?.from).not.toEqual(missile?.to);
    // O efeito estoura ONDE o projétil chegou, e logo depois dele.
    const at = all.indexOf(missile as S2CMessage);
    const effect = all[at + 1];
    expect(effect?.type).toBe('effect');
    if (effect?.type !== 'effect') return;
    expect(effect.effectId).toBe(12);
    expect(effect.position).toEqual(missile?.to);
    // E o número, com `kind: 'spell'`, vem depois dos dois — é o golpe do lançamento.
    const hit = all.slice(at).find((m) => m.type === 'creature-hit' && m.kind === 'spell');
    expect(hit).toBeDefined();
  });

  it('a magia de ÁREA estoura um effect em CADA alvo, e não só no primeiro', () => {
    // Dois ratos que aguentam, colados um no outro na arena de 2×2, e um `blast` de raio 1:
    // cada lançamento mira os dois. O projétil é UM (vai ao primeiro alvo — é um projétil,
    // não uma rajada), mas a explosão é uma por alvo, no tile de cada um — e o número que
    // cai também. Com dois ratos sempre vivos, são duas explosões por projétil.
    //
    // Mutação que mata: trocar o laço por alvo do `spell-cast` por "só o primeiro" — a
    // contagem de `effect` cai para a de `missile`, metade dos golpes.
    const { runFor, received } = hunt({
      tanky: true, monsterCount: 2,
      bot: rules({ attack: [{
        when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'blast' },
      }] }),
    });
    runFor(3_000);

    const all = received();
    const missiles = ofType(all, 'missile').filter((m) => m.missileId === 6);
    const explosoes = ofType(all, 'effect').filter((e) => e.effectId === 15);
    const golpes = ofType(all, 'creature-hit').filter((h) => h.kind === 'spell');
    expect(missiles.length).toBeGreaterThan(0);
    expect(explosoes).toHaveLength(golpes.length);
    expect(explosoes).toHaveLength(2 * missiles.length);
    // Em tiles DIFERENTES: cada rato levou a sua.
    const tiles = new Set(explosoes.map((e) => `${e.position.x},${e.position.y}`));
    expect(tiles.size).toBe(2);
  });

  it('a magia SEM linha na tabela é muda: nenhum effect, nenhum missile, nenhum erro', () => {
    // Uma magia nova sem arte ainda bate — o `creature-hit` prova — e derrubar a
    // apresentação por isso esconderia justamente que ela funcionou. Silêncio, não erro.
    //
    // Mutação que mata: ler `appearances.spells[spellId].effect` sem a guarda de `undefined`
    // — o ciclo explode num `TypeError` no primeiro lançamento.
    const { runFor, received } = hunt({
      table: false,
      bot: rules({ attack: [{
        when: { kind: 'targets', op: '>=', count: 1 }, do: { kind: 'spell', spellId: 'strike' },
      }] }),
    });
    expect(() => runFor(5_000)).not.toThrow();

    expect(ofType(received(), 'creature-hit').some((h) => h.kind === 'spell')).toBe(true);
    expect(ofType(received(), 'effect')).toHaveLength(0);
    expect(ofType(received(), 'missile')).toHaveLength(0);
  });

  it('golpe em criatura que o cliente ainda NÃO conhece é descartado; o session-attach é quem a apresenta', () => {
    // O rato nasceu com ninguém olhando: o `creature-appear` dele foi drenado para o nada, e
    // ele não tem id numérico. Quem chega depois liga o socket mas ainda não pediu o mundo —
    // e nesse intervalo o número flutuante não tem sobre quem cair. Descartar é a resposta:
    // mandar com um id inventado é um número num tile vazio, e o id ainda poderia colidir
    // com o de alguém de verdade. O rato aguenta (`tanky`) para continuar sendo ELE quando o
    // cliente enfim pedir o estado — e aí os golpes chegam, com o id que o estado deu.
    //
    // Mutação que mata: `hosted.creatureIds.get(...) ?? 0` no ramo de `creature-hit` (mandar
    // com id 0 em vez de descartar) — aparece um golpe antes do `session-state`.
    const { host, viewer, runFor, received } = hunt({ state: false, tanky: true, beforeMs: 1_000 });
    runFor(3_000);

    const antes = received();
    expect(ofType(antes, 'creature-appear')).toHaveLength(0);
    expect(ofType(antes, 'creature-hit')).toHaveLength(0);
    expect(ofType(antes, 'creature-health')).toHaveLength(0);
    // A luta aconteceu — o `sim` não espera ninguém (invariante 3): o HUD já mostra o dano.
    expect(ofType(antes, 'player-stats').some((s) => s.health < s.maxHealth)).toBe(true);

    host.handle(viewer, { type: 'session-attach' });
    runFor(3_000);

    const all = received();
    const state = ofType(all, 'session-state')[0];
    expect(state).toBeDefined();
    if (state === undefined) return;
    const known = new Set(state.world.creatures.map((c) => c.id));
    expect(known.size).toBe(2);
    const depois = all.slice(all.indexOf(state));
    const hits = ofType(depois, 'creature-hit');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(known.has(hit.id)).toBe(true);
    // Dos dois lados: o rato apanha do herói e o herói apanha do rato.
    expect(hits.some((h) => h.id === state.self.creatureId)).toBe(true);
    expect(hits.some((h) => h.id !== state.self.creatureId)).toBe(true);
  });

  it('cura em herói que o cliente ainda NÃO conhece é descartada; o session-attach é quem o apresenta', () => {
    // O espelho do teste de golpe, para a cura: o herói nasce ferido, o bot cura a cada
    // segundo, e o socket está ligado sem ter pedido o mundo — o herói não tem id numérico. O
    // "+60" em verde não tem sobre quem cair, e é descartado pela mesma razão do golpe:
    // mandar com id inventado é um número num tile vazio, que ainda pode colidir com o id de
    // alguém de verdade. A cura continua (a vida sobe a cada segundo até a metade), então
    // depois do `session-state` ela chega, com o id que o estado deu.
    //
    // O rato aguenta e nasceu sem ninguém olhando, como no teste de golpe: é ele que segura o
    // herói no lugar. Numa hunt vazia o herói percorre a rota, e o PASSO dele numera a
    // criatura antes de o estado sair — a cura teria id antes da hora, e o teste mediria
    // outra coisa.
    //
    // Mutação que mata: `hosted.creatureIds.get(...) ?? 0` no ramo de `creature-healed`
    // (mandar com id 0 em vez de descartar) — aparece uma cura antes do `session-state`.
    const { host, viewer, runFor, received, hero } = hunt({
      state: false, tanky: true, beforeMs: 1_000, health: 100,
      bot: rules({ heal: [{
        when: { kind: 'hp', op: '<=', percent: 50 }, do: { kind: 'spell', spellId: 'heal' },
      }] }),
    });
    runFor(3_000);

    const antes = received();
    expect(ofType(antes, 'session-state')).toHaveLength(0);
    expect(ofType(antes, 'creature-hit')).toHaveLength(0);
    // A cura ACONTECEU — o `sim` não espera ninguém (invariante 3): a vida subiu e a mana
    // desceu, e o HUD já sabe.
    expect(hero().health).toBeGreaterThan(100);
    expect(ofType(antes, 'player-stats').some((s) => s.mana < s.maxMana)).toBe(true);

    host.handle(viewer, { type: 'session-attach' });
    runFor(3_000);

    const all = received();
    const state = ofType(all, 'session-state')[0];
    expect(state).toBeDefined();
    if (state === undefined) return;
    const depois = all.slice(all.indexOf(state));
    const curas = ofType(depois, 'creature-hit').filter((h) => h.kind === 'heal');
    expect(curas.length).toBeGreaterThan(0);
    for (const cura of curas) expect(cura).toMatchObject({ id: state.self.creatureId, amount: 60 });
  });

  it('o golpe absorvido inteiro mostra "0" e NÃO sangra', () => {
    // Um rato blindado (armadura 100 contra 25 de ataque) e o piso de dano em zero: todo golpe
    // do herói resolve zero. O número cai — como no Tibia, senão o jogador não vê que está
    // tentando — mas sangue é o que a armadura acabou de impedir. O rato, por sua vez, bate 6
    // no herói sem armadura, e esses sangram: a contagem de `effect` é EXATAMENTE a dos golpes
    // que tiraram vida, e há golpes dos dois tipos na mesma hunt.
    //
    // Mutação que mata: tirar `event.amount > 0 &&` da guarda do sangue — os zeros passam a
    // sangrar e a contagem de `effect` sobe para a de TODOS os golpes.
    const { runFor, received } = hunt({
      rat: { armor: 100 }, combat: { minimumDamageFraction: 0 },
    });
    runFor(10_000);

    const all = received();
    const hits = ofType(all, 'creature-hit');
    for (const hit of hits) expect(hit.kind).toBe('melee');
    expect(hits.some((h) => h.amount === 0)).toBe(true);
    expect(hits.some((h) => h.amount > 0)).toBe(true);
    const effects = ofType(all, 'effect');
    expect(effects).toHaveLength(hits.filter((h) => h.amount > 0).length);
    for (const effect of effects) expect(effect.effectId).toBe(1);
  });

  it('o golpe corpo a corpo sangra com hits.melee, uma vez por golpe que tirou vida', () => {
    // Sem magia nem poção, todo `effect` é sangue: um por `creature-hit` de corpo a corpo que
    // saiu da barra, com o id que a tabela deu ao sangue — e nenhum outro.
    //
    // Mutação que mata: mandar o sangue com `appearances.spells` ou com id fixo — o
    // `effectId` deixa de ser 1. Tirar a guarda `amount > 0` não muda esta fixture (armadura
    // zero, esquiva zero), e é por isso que a contagem é contra os golpes com vida tirada.
    const { runFor, received } = hunt();
    runFor(10_000);

    const effects = ofType(received(), 'effect');
    const golpes = ofType(received(), 'creature-hit')
      .filter((h) => h.kind === 'melee' && h.amount > 0);
    expect(golpes.length).toBeGreaterThan(0);
    expect(effects).toHaveLength(golpes.length);
    for (const effect of effects) expect(effect.effectId).toBe(1);
  });

  it('a cura vira creature-hit com kind heal, e o efeito dela sai no tile do conjurador', () => {
    // O número em verde é o que a cura REPÔS (60), com o id do herói; o efeito 13 não vem do
    // `creature-healed`, vem do `spell-cast` sem alvo — é por isso que ele estoura no
    // conjurador, e é por isso que uma cura de vida cheia ainda brilha.
    //
    // "No tile do conjurador" é conferido contra o passo que o cliente já recebeu, e não
    // contra a posição de entrada: o herói anda desde o instante zero, e o passo vence antes
    // do bot no mesmo instante — o efeito precisa cair onde a tela mostra o herói.
    //
    // Mutação que mata: `kind: event.source` no ramo de `creature-healed` — sai `spell`, não
    // `heal`. Apagar o ramo de "sem alvo" do `spell-cast` mata pelo efeito 13; mandar o
    // efeito da cura em `targets[0]?.position ?? casterPosition` sobrevive, e é por isso
    // que a posição é conferida contra o tile do herói.
    const { runFor, received, heroId, heroTileAt } = hunt({
      monsters: false, health: 100,
      bot: rules({ heal: [{
        when: { kind: 'hp', op: '<=', percent: 50 }, do: { kind: 'spell', spellId: 'heal' },
      }] }),
    });
    runFor(300);

    const all = received();
    const cura = ofType(all, 'creature-hit').find((h) => h.kind === 'heal');
    expect(cura).toMatchObject({ id: heroId, amount: 60, kind: 'heal' });
    const effect = ofType(all, 'effect').find((e) => e.effectId === 13);
    expect(effect).toBeDefined();
    expect(effect?.position).toEqual(heroTileAt(all, all.indexOf(effect as S2CMessage)));
    // Sem alvo, sem projétil.
    expect(ofType(all, 'missile')).toHaveLength(0);
  });

  it('a poção vira effect com supplies.<id>.effect, cura em verde, e o gold do player-stats é o SALDO', () => {
    // Três coisas de uma poção só: o brilho (14) no tile de quem bebeu, o "+80" em verde, e
    // o gold do HUD caindo 45 — que é `gold + goldDelta`, o saldo, e não o que entrou com o
    // ticket nem o que a sessão movimentou.
    //
    // Mutação que mata: `gold: character.gold` em `playerStatsOf` — o HUD fica em 100 depois
    // de pagar 45. Ler o supply na tabela de `spells` em vez de `supplies` mata pelo brilho
    // 14, que deixa de existir.
    const { runFor, received, heroId, heroTileAt } = hunt({
      monsters: false, health: 100, gold: 100,
      bot: rules({ potion: [{
        when: { kind: 'hp', op: '<=', percent: 50 },
        do: { kind: 'supply', supplyId: 'health-potion' },
      }] }),
    });
    runFor(300);

    const all = received();
    const brilho = ofType(all, 'effect').find((e) => e.effectId === 14);
    expect(brilho).toBeDefined();
    expect(brilho?.position).toEqual(heroTileAt(all, all.indexOf(brilho as S2CMessage)));
    const cura = ofType(all, 'creature-hit').find((h) => h.kind === 'heal');
    expect(cura).toMatchObject({ id: heroId, amount: 80 });
    const stats = ofType(all, 'player-stats');
    expect(stats[0]?.gold).toBe(100);
    expect(stats.at(-1)?.gold).toBe(55);
  });

  it('o tiro do bow vira missile com o projétil da FLECHA, entre o herói e o rato (#152)', () => {
    // O `sim` diz só "atirou arrow com o bow" (invariante 6); a arte do projétil é da tabela.
    //
    // Mutação que mata: ler `appearances.weapons[weaponItemId]` para a flecha também — o bow
    // não tem linha em `weapons`, e o tiro ficaria mudo. Trocar `from`/`to` mata pela posição.
    const { runFor, received, heroId } = hunt({ weapon: 'bow', tanky: true });
    runFor(5_000);

    const all = received();
    const missiles = ofType(all, 'missile');
    expect(missiles.length).toBeGreaterThan(0);
    const first = all.findIndex((m) => m.type === 'missile');
    const rat = ofType(all, 'creature-appear').find((m) => m.id !== heroId);
    expect(missiles[0]).toMatchObject({
      missileId: TABLE.ammunition.arrow.missile, to: rat?.position,
    });
    const heroTile = ofType(all.slice(0, first), 'creature-move')
      .filter((m) => m.id === heroId).at(-1)?.to ?? { x: 1, y: 1, z: 7 };
    expect(missiles[0]?.from).toEqual(heroTile);
  });

  it('o golpe da wand vira missile com o projétil da ARMA, e cobra a mana (#152)', () => {
    const { runFor, received, hero, maxMana } = hunt({ weapon: 'wand', tanky: true, regen: false });
    runFor(5_000);

    const missiles = ofType(received(), 'missile');
    expect(missiles.length).toBeGreaterThan(0);
    expect(missiles[0]?.missileId).toBe(TABLE.weapons.wand.missile);
    expect(hero().mana).toBe(maxMana - WAND.weapon.manaPerHit * missiles.length);
  });

  it('SEM linha na tabela o tiro é mudo, e a matemática não muda (invariante 3)', () => {
    const { runFor, received } = hunt({ weapon: 'bow', tanky: true, table: false });
    runFor(5_000);

    const all = received();
    expect(ofType(all, 'missile')).toHaveLength(0);
    expect(ofType(all, 'creature-hit').length).toBeGreaterThan(0);
  });
});

describe('a munição escolhida pelo socket (#152, ADR 0026 decisão 4)', () => {
  const SNIPER: Ammunition = {
    id: 'sniper-arrow', name: 'Sniper Arrow', family: 'arrow', attack: 28, price: 5,
    requires: { level: 20 }, appearanceId: 7364, missileId: 22,
  };
  const ammunition = new Map([[SNIPER.id, SNIPER]]);
  const warnings = (socket: FakeSocket) =>
    socket.received().filter((m) => m.type === 'system-message');

  const atLevel = (level: number) => {
    const { ruleset } = countingRuleset();
    const { host, sessions } = buildHost(ruleset, { ammunition, level });
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    host.flush();
    const before = socket.received().length;
    const hero = sessions[0]?.participants[0] as CharacterRuntime;
    return { host, viewer, socket, hero, before };
  };

  it('escolhe, e a resposta é player-stats com a munição nova — não uma mensagem', () => {
    // O seletor no slot do escudo precisa ver a escolha refletida; na Cidade não há ciclo que
    // compare os vitais, então o sucesso manda `player-stats` na hora.
    const { host, viewer, socket, hero, before } = atLevel(20);

    host.handle(viewer, { type: 'select-ammo', ammoId: 'sniper-arrow' });
    host.flush();

    expect(hero.ammo.get('arrow')).toBe('sniper-arrow');
    expect(warnings(socket)).toHaveLength(0);
    const stats = socket.received().slice(before).filter((m) => m.type === 'player-stats');
    const last = stats.at(-1);
    expect(last?.type === 'player-stats' && last.ammo).toEqual({ arrow: 'sniper-arrow', bolt: null });
  });

  it('recusa por level com o MOTIVO, e a escolha anterior fica', () => {
    const { host, viewer, socket, hero } = atLevel(19);

    host.handle(viewer, { type: 'select-ammo', ammoId: 'sniper-arrow' });
    host.flush();

    expect(hero.ammo.get('arrow')).toBeUndefined();
    const warning = warnings(socket)[0];
    expect(warning?.type === 'system-message' && warning.text).toContain('level');
  });

  it('munição que o conteúdo não conhece é recusada, sem tocar em nada', () => {
    const { host, viewer, socket, hero } = atLevel(20);

    host.handle(viewer, { type: 'select-ammo', ammoId: 'flecha-de-brinquedo' });
    host.flush();

    expect(hero.ammo.size).toBe(0);
    expect(warnings(socket)).toHaveLength(1);
  });
});

describe('a escolha de vocação pelo socket (#154, ADR 0026 decisão 1)', () => {
  const axe = {
    ...itemSchema.parse({
      id: 'steel-axe', name: 'Steel Axe', kind: 'weapon', slot: 'hand', weight: 41, attack: 21,
      weapon: { kind: 'melee', range: 1 }, requires: { vocationId: 'knight' },
    }),
    appearanceId: 1,
  };
  const knight = {
    id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25,
    startingWeaponItemId: 'steel-axe',
  };
  const vocations = new Map([[knight.id, knight]]);
  const itemCatalog = new Map([[axe.id, axe]]);
  const warnings = (socket: FakeSocket) =>
    socket.received().filter((m) => m.type === 'system-message' && m.level === 'warning');

  const atLevel = (level: number, ruleset: Ruleset = countingRuleset().ruleset, extra: Record<string, unknown> = {}) => {
    const { host, sessions } = buildHost(ruleset, { itemCatalog, vocations, vocationLevel: 8, level, ...extra });
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    host.flush();
    const before = socket.received().length;
    const hero = sessions[0]?.participants[0] as CharacterRuntime;
    // O personagem de `buildHost` nasce sem capacidade; sem ela a arma iria para a Caixa.
    hero.capacity = 400;
    return { host, viewer, socket, hero, before };
  };

  it('escolhe na hunt: player-stats traz a vocação e inventory traz a arma na mão', () => {
    const { host, viewer, socket, hero, before } = atLevel(8);

    host.handle(viewer, { type: 'choose-vocation', vocationId: 'knight' });
    host.flush();

    expect(hero.vocationId).toBe('knight');
    expect(warnings(socket)).toHaveLength(0);
    const after = socket.received().slice(before);
    const stats = after.filter((m) => m.type === 'player-stats').at(-1);
    expect(stats?.type === 'player-stats' && stats.vocationId).toBe('knight');
    const inventory = after.filter((m) => m.type === 'inventory').at(-1);
    expect(inventory?.type === 'inventory' && inventory.equipped['hand']?.itemId).toBe('steel-axe');
  });

  it('recusa com o motivo: vocação inexistente, level baixo, e a segunda escolha', () => {
    const young = atLevel(7);
    young.host.handle(young.viewer, { type: 'choose-vocation', vocationId: 'knight' });
    young.host.flush();
    expect(young.hero.vocationId).toBeNull();
    expect(warnings(young.socket).map((m) => m.type === 'system-message' && m.text)).toEqual([
      'Você ainda não chegou ao level da escolha de vocação.',
    ]);

    const { host, viewer, socket, hero } = atLevel(8);
    host.handle(viewer, { type: 'choose-vocation', vocationId: 'monk' });
    host.handle(viewer, { type: 'choose-vocation', vocationId: 'knight' });
    host.handle(viewer, { type: 'choose-vocation', vocationId: 'knight' });
    host.flush();
    expect(hero.vocationId).toBe('knight');
    expect(warnings(socket).map((m) => m.type === 'system-message' && m.text)).toEqual([
      'Essa vocação não existe.',
      'Você já escolheu a sua vocação.',
    ]);
  });

  it('o extrato da hunt leva a vocação e a arma com a proveniência', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const receipts = { save: async (r: Record<string, unknown>) => { saved.push(r); } } as unknown as ReceiptStore;
    const { host, sessions } = buildHost(countingRuleset().ruleset, { itemCatalog, vocations, vocationLevel: 8, receipts });
    // `prepare` ANTES do attach: é ele que liga a conta à sessão, e sem conta não há extrato.
    await host.prepare('p1', undefined, 'a1');
    const viewer = host.attach(new FakeSocket(), 'p1');
    (sessions[0]?.participants[0] as CharacterRuntime).capacity = 400;
    host.handle(viewer, { type: 'choose-vocation', vocationId: 'knight' });
    await host.release('p1', 1000, 'logout');

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      vocation: 'knight',
      equipment: { hand: 's-p1:p1:vocation' },
      acquired: [{ instanceId: 's-p1:p1:vocation', itemId: 'steel-axe', origin: 'vocation-choice' }],
    });
  });

  describe('na Cidade — o shard grava um extrato de ESTADO, sem crédito', () => {
    const shard = (): Ruleset => ({
      type: 'city', shared: true, hz: () => 0,
      onEnter: () => {}, onEvent: () => {}, onCreatureDied: () => {}, onEnd: () => {},
    });
    const withReceipts = () => {
      const saved: Array<Record<string, unknown>> = [];
      const receipts = { save: async (r: Record<string, unknown>) => { saved.push(r); } } as unknown as ReceiptStore;
      return { saved, receipts };
    };

    it('escolher na praça e sair grava vocação, arma e layout, com agregados zerados', async () => {
      // Era a premissa quebrada da issue: o shard nunca gravava extrato, e a escolha feita na
      // Cidade sumia no logout. Mutação que mata: tirar `#saveDurableReceipt` do `release`.
      const { saved, receipts } = withReceipts();
      const { host, sessions } = buildHost(shard(), { itemCatalog, vocations, vocationLevel: 8, receipts });
      await host.prepare('p1', undefined, 'a1');
      const socket = new FakeSocket();
      const viewer = host.attach(socket, 'p1');
      (sessions[0]?.participants[0] as CharacterRuntime).capacity = 400;
      host.handle(viewer, { type: 'choose-vocation', vocationId: 'knight' });
      const sessionId = sessions[0]?.id as string;

      await host.release('p1', 1000, 'logout');

      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        sessionId, characterId: 'p1', accountId: 'a1', reason: 'manual-exit', seq: 1,
        vocation: 'knight',
        equipment: { hand: `${sessionId}:p1:vocation` },
        acquired: [{ itemId: 'steel-axe', origin: 'vocation-choice' }],
      });
      expect((saved[0] as { aggregates: { xpGained: number; goldGained: number } }).aggregates)
        .toMatchObject({ xpGained: 0, goldGained: 0 });
    });

    it('quem não mexeu em nada sai sem extrato', async () => {
      // Um extrato zerado por logout de praça seria uma linha de ledger por pessoa que fecha o
      // jogo. Mutação que mata: gravar sem conferir `dirty`.
      const { saved, receipts } = withReceipts();
      const { host } = buildHost(shard(), { itemCatalog, vocations, vocationLevel: 8, receipts });
      await host.prepare('p1', undefined, 'a1');
      host.attach(new FakeSocket(), 'p1');

      await host.release('p1', 1000, 'logout');

      expect(saved).toHaveLength(0);
    });

    it('a drenagem também grava o estado do shard', async () => {
      const { saved, receipts } = withReceipts();
      const { host } = buildHost(shard(), { itemCatalog, vocations, vocationLevel: 8, receipts });
      await host.prepare('p1', undefined, 'a1');
      const viewer = host.attach(new FakeSocket(), 'p1');
      host.handle(viewer, { type: 'choose-vocation', vocationId: 'knight' });

      await host.drainAll();

      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ reason: 'drain', vocation: 'knight' });
    });
  });
});

describe('mover item pelo socket (#160, ADR 0026 decisão 6)', () => {
  const rock = { ...itemSchema.parse({ id: 'rock', name: 'Rock', kind: 'other', weight: 5 }), appearanceId: 1 };
  const sword = { ...itemSchema.parse({ id: 'sword', name: 'Sword', kind: 'weapon', slot: 'hand', weight: 50, attack: 24 }), appearanceId: 2 };
  const itemCatalog = new Map([[rock.id, rock], [sword.id, sword]]);
  const progression = { ...TEST_PROGRESSION, satchelInitialSlots: 10, containerRow: 5 } as never;
  const warnings = (socket: FakeSocket) =>
    socket.received().filter((m) => m.type === 'system-message').map((m) => (m.type === 'system-message' ? m.text : ''));

  const setup = () => {
    const { ruleset } = countingRuleset();
    const { host, sessions } = buildHost(ruleset, { itemCatalog, progression });
    const socket = new FakeSocket();
    const viewer = host.attach(socket, 'p1');
    host.flush();
    const hero = sessions[0]?.participants[0] as CharacterRuntime;
    hero.capacity = 1_000;
    // Sem mochila nas costas: a bolsa (10) recebe.
    hero.inventory.ensureContainers({ backpackSlots: 0, satchelSlots: 10, row: 5 });
    hero.inventory.add({ instanceId: 'r1', itemId: 'rock', quantity: 1 }, itemCatalog, hero, { backpackSlots: 0, satchelSlots: 10, row: 5 });
    hero.inventory.add({ instanceId: 's1', itemId: 'sword', quantity: 1 }, itemCatalog, hero, { backpackSlots: 0, satchelSlots: 10, row: 5 });
    const before = socket.received().length;
    return { host, viewer, socket, hero, before };
  };

  it('troca dois lugares e reenvia o inventário posicional; veste por move; recusa vira mensagem', () => {
    const { host, viewer, socket, hero, before } = setup();
    host.handle(viewer, { type: 'move-item', from: { container: 'satchel', index: 0 }, to: { container: 'satchel', index: 7 } });
    host.flush();
    expect(hero.inventory.satchel[7]?.instanceId).toBe('r1');
    expect(hero.inventory.satchel[0]).toBeNull();
    const inventory = socket.received().slice(before).filter((m) => m.type === 'inventory').at(-1);
    if (inventory?.type !== 'inventory') throw new Error('não veio inventory');
    expect(inventory.satchel).toHaveLength(10);
    expect(inventory.satchel[7]).toMatchObject({ instanceId: 'r1' });
    expect(inventory.satchel[0]).toBeNull();

    host.handle(viewer, { type: 'move-item', from: { container: 'satchel', index: 1 }, to: { slot: 'hand' } });
    host.flush();
    expect(hero.inventory.equippedAt('hand')?.instanceId).toBe('s1');

    host.handle(viewer, { type: 'move-item', from: { container: 'satchel', index: 3 }, to: { container: 'satchel', index: 4 } });
    host.handle(viewer, { type: 'move-item', from: { container: 'backpack', index: 0 }, to: { container: 'satchel', index: 4 } });
    host.handle(viewer, { type: 'move-item', from: { slot: 'hand' }, to: { slot: 'chapeu' } });
    host.flush();
    expect(warnings(socket)).toEqual(['Não há nada nesse lugar.', 'Esse lugar não existe.', 'Esse lugar não existe.']);
  });

  it('o extrato leva o layout — onde cada item está — junto com o equipamento', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const receipts = { save: async (r: Record<string, unknown>) => { saved.push(r); } } as unknown as ReceiptStore;
    const { host, sessions } = buildHost(countingRuleset().ruleset, { itemCatalog, progression, receipts });
    await host.prepare('p1', undefined, 'a1');
    const viewer = host.attach(new FakeSocket(), 'p1');
    const hero = sessions[0]?.participants[0] as CharacterRuntime;
    hero.capacity = 1_000;
    hero.inventory.ensureContainers({ backpackSlots: 0, satchelSlots: 10, row: 5 });
    hero.inventory.add({ instanceId: 'r1', itemId: 'rock', quantity: 1 }, itemCatalog, hero, { backpackSlots: 0, satchelSlots: 10, row: 5 });
    host.handle(viewer, { type: 'move-item', from: { container: 'satchel', index: 0 }, to: { container: 'satchel', index: 9 } });
    await host.release('p1', 1000, 'logout');
    expect(saved[0]).toMatchObject({ layout: { r1: { container: 'satchel', index: 9 } }, equipment: {} });
  });
});
