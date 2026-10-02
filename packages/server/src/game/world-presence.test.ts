import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { localToAbsolute } from '@draconya/content';
import type { Content, Tilemap } from '@draconya/content';
import type { S2CMessage } from '@draconya/protocol';
import { CharacterRuntime, NO_WORLD_POSITION, Rng, Session, XLOG_DELAY_MS } from '@draconya/sim';
import type { Point, Ruleset, WorldDepartureReason } from '@draconya/sim';
import { createLogger } from '../log.js';
import type { SessionDirectory } from '../directory.js';
import type { ReceiptStore } from '../receipts.js';
import type { InitialCharacter } from '../tickets.js';
import { SessionHost } from './host.js';
import type { Viewer } from './viewer.js';
import { createSessionWiring } from './sessions.js';
import type { SessionWiring } from './sessions.js';
import { FakeSocket } from './testing.js';

// A presença do mundo no hospedeiro (#840, OW-19, ADR 0060 decisão 7), sobre a Thais REAL: o último
// visualizador que se solta, o personagem que chega sem nenhum e o `logout` viram INTENÇÃO para o `sim`, e o
// `departure-requested` que ele devolve vira checkpoint e repouso. O que o `sim` decide — `canLogout`, os 60 s,
// a janela de luta — é de `rulesets/world-presence.test.ts`; aqui se prova que o hospedeiro só LIGA o socket a
// essas decisões, e que nenhuma delas é dele.
//
// O relógio é o do nó (`tick` avança e roda UM ciclo): o mundo anda a 10 Hz com ou sem visualizador, e os
// 60 s do x-log são do relógio LÓGICO da sessão — o `tick(60_000)` cobre o instante exato.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => (cached ??= loadContent(DATA));
const logger = createLogger('silent', 'test');

const THAIS = (): Tilemap => {
  const map = real().maps.get('thais');
  if (map === undefined) throw new Error('o conteúdo real não tem a thais');
  return map;
};

/** A coordenada ABSOLUTA de um tile local do recorte, como o ticket e o extrato a carregam. */
const absolute = (tile: { x: number; y: number; z: number }): Point => {
  const point = localToAbsolute(THAIS(), tile);
  if (point === undefined) throw new Error(`fora do recorte: ${JSON.stringify(tile)}`);
  return point;
};

const TEMPLE = { x: 94, y: 88, z: 7 };
/** A rua ao sul do templo: andável e FORA da PZ — onde a luta trava a saída. */
const STREET = { x: 94, y: 97, z: 7 };
/** O tile de cima do templo: PZ + no-logout (`world-session-real.test.ts`) — nunca se sai dali. */
const UPSTAIRS = { x: 94, y: 93, z: 6 };

interface SavedLine {
  readonly characterId: string;
  readonly reason: string;
  readonly health?: number;
  readonly mana?: number;
  readonly worldPosition?: Point | null;
}

interface Node {
  readonly host: SessionHost;
  readonly wiring: SessionWiring;
  /** Todo `saveBatch` recebido, achatado — o que o Redis veria do mundo. */
  readonly lines: SavedLine[];
  /** Os mesmos, um `saveBatch` por elemento: o lote é um `MULTI` só. */
  readonly batches: SavedLine[][];
  /** Quantas gravações o Redis de mentira ainda recusa (`connection lost`), e quantas já recebeu. */
  readonly redis: { failNext: number; attempts: number; registers: number };
  /**
   * Segura o Redis de mentira até o teste abrir a porta: o que o `saveBatch` e o `register` do diretório
   * esperam, para fixar a ORDEM de uma corrida (a reconexão contra a saída) em vez de sortear por tempo.
   */
  readonly hold: { saveBatch: Promise<void> | null; register: Promise<void> | null };
  /** O que o diretório viu soltar: personagem, e conta que devolveu o slot. */
  readonly released: string[];
  readonly slots: string[];
  /** Avança o relógio do nó em `ms` e roda UM ciclo do hospedeiro. */
  readonly tick: (ms: number) => void;
  /** Prepara o personagem como o `game` faz no handshake e liga um socket a ele. */
  readonly login: (id: string, initial?: Partial<InitialCharacter>) => Promise<{ viewer: Viewer; socket: FakeSocket }>;
  /** Só o `prepare`: o ticket consumido e nenhum websocket (ainda). */
  readonly arrive: (id: string, initial?: Partial<InitialCharacter>) => Promise<void>;
  /** O socket cai por conta própria, como o `close` do servidor: marca e chama `detach`. */
  readonly drop: (viewer: Viewer) => void;
  /** Liga outro socket a quem já está no nó (a reconexão: `prepare` acha a sessão, `attach` entra). */
  readonly reconnect: (id: string) => Promise<{ viewer: Viewer; socket: FakeSocket }>;
  readonly session: (id: string) => Session;
  readonly character: (id: string) => CharacterRuntime;
  /** O instante lógico do mundo. */
  readonly now: () => number;
}

function node(options: { readonly openWorld?: boolean } = {}): Node {
  const content = real();
  let nowMs = 0;
  const wiring = createSessionWiring(content, () => nowMs, {
    ...(options.openWorld === false ? {} : { openWorld: true }),
  });
  const lines: SavedLine[] = [];
  const batches: SavedLine[][] = [];
  const redis = { failNext: 0, attempts: 0, registers: 0 };
  const hold: Node['hold'] = { saveBatch: null, register: null };
  const released: string[] = [];
  const slots: string[] = [];
  const receipts = {
    save: async (line: SavedLine) => { lines.push(line); },
    saveBatch: async (batch: readonly SavedLine[]) => {
      redis.attempts += 1;
      if (hold.saveBatch !== null) await hold.saveBatch;
      if (redis.failNext > 0) {
        redis.failNext -= 1;
        throw new Error('connection lost');
      }
      batches.push([...batch]);
      lines.push(...batch);
    },
  } as unknown as ReceiptStore;
  const directory = {
    register: async () => {
      redis.registers += 1;
      if (hold.register !== null) await hold.register;
      return true;
    },
    release: async (characterId: string) => { released.push(characterId); },
    releaseSlot: async (_accountId: string, characterId: string) => { slots.push(characterId); },
    renew: async () => undefined,
    succeed: async () => true,
  } as unknown as SessionDirectory;
  const host = new SessionHost({
    nodeId: 'n1', contentVersion: content.version, logger, receipts, now: () => nowMs,
    openWorld: options.openWorld !== false, directory,
    createSession: wiring.createSession,
    buildSession: wiring.buildSession,
    itemCatalog: content.items,
    blessingCatalog: content.blessings,
    progression: content.progression,
  });
  const arrive: Node['arrive'] = async (id, initial = {}) => {
    await host.prepare(id, { level: 1, xp: 0, townId: 'thais', ...initial }, `acc-${id}`);
  };
  const attach = (id: string) => {
    const socket = new FakeSocket();
    const viewer = host.attach(socket, id);
    host.handle(viewer, { type: 'session-attach' });
    host.flush();
    return { viewer, socket };
  };
  return {
    host, wiring, lines, batches, redis, hold, released, slots,
    arrive,
    login: async (id, initial) => {
      await arrive(id, initial);
      return attach(id);
    },
    drop: (viewer) => { viewer.markClosed(); host.detach(viewer); },
    reconnect: async (id) => {
      await arrive(id);
      return attach(id);
    },
    tick: (ms) => { nowMs += ms; host.cycle(nowMs); },
    session: (id) => {
      const session = host.sessionFor(id);
      if (session === undefined) throw new Error(`${id} não tem sessão`);
      return session;
    },
    character: (id) => {
      const found = (host.sessionFor(id)?.participants ?? []).find((participant) => participant.id === id);
      if (found === undefined) throw new Error(`${id} não está na sessão`);
      return found;
    },
    now: () => nowMs,
  };
}

const ofType = <T extends S2CMessage['type']>(messages: readonly S2CMessage[], type: T) =>
  messages.filter((message): message is Extract<S2CMessage, { type: T }> => message.type === type);

/** O personagem acabou de dar ou receber um golpe: o carimbo que `canLogout` lê (`isInFight`). */
const fight = (n: Node, id: string): void => { n.character(id).lastCombatActionAtMs = n.session(id).nowMs; };

/** Espera o `release` do hospedeiro terminar: o personagem não é mais hospedado. */
const untilGone = (n: Node, id: string) => vi.waitFor(() => { expect(n.host.sessionFor(id)).toBeUndefined(); });

const linesOf = (n: Node, id: string): SavedLine[] => n.lines.filter((line) => line.characterId === id);

describe('perder a conexão no mundo (#840, OW-19)', () => {
  // Os dois ramos de `#presentMoves`: sem ninguém olhando o mundo inteiro (o x-log de quem está só) e com
  // outros visualizadores na sessão. O pedido de saída tem de chegar nos dois — é gameplay, não apresentação.
  it.each([
    ['sozinho no mundo, sem NENHUM visualizador', false],
    ['com outro personagem olhando', true],
  ])('na PZ, %s: fica 60 s e sai, com a posição e a vida salvas', async (_name, withKeeper) => {
    const n = node();
    const { viewer } = await n.login('a', { health: 123, mana: 7 });
    if (withKeeper) await n.login('keeper');
    const before = n.character('a');
    const world = n.session('a');

    n.drop(viewer);
    n.tick(XLOG_DELAY_MS - 1_000);
    // Antes dos 60 s ele continua lá, parado: perder a conexão não o tira (`protocolgame.cpp:918-933`).
    expect(n.host.sessionFor('a')).toBe(world);
    expect(n.lines).toEqual([]);

    n.tick(1_000);
    await untilGone(n, 'a');

    // Saiu para o REPOUSO: sem sessão, sem registro no diretório, com o slot devolvido.
    expect(n.released).toEqual(['a']);
    expect(n.slots).toEqual(['a']);
    expect(world.participants.some((participant) => participant.id === 'a')).toBe(false);
    // E o que o personagem deixou: a âncora é o tile ABSOLUTO onde ele estava, e a vida e a mana são as de
    // agora (regeneradas desde o ticket, mas as da linha são as que ele tinha ao sair).
    expect(linesOf(n, 'a')).toEqual([expect.objectContaining({
      characterId: 'a', reason: 'manual-exit',
      worldPosition: absolute(TEMPLE), health: before.health, mana: before.mana,
    })]);
    // O resto do mundo não é tocado.
    if (withKeeper) expect(n.session('keeper')).toBe(world);
  });

  it('reconectar antes dos 60 s: a MESMA sessão e o MESMO personagem, e o x-log não vem', async () => {
    const n = node();
    const { viewer } = await n.login('a', { worldPosition: absolute(STREET) });
    const world = n.session('a');
    const hero = n.character('a');
    fight(n, 'a');

    n.drop(viewer);
    n.tick(XLOG_DELAY_MS - 5_000);
    const { viewer: back, socket } = await n.reconnect('a');
    expect(back.dead).toBe(false);
    // Muito depois dos 60 s: o x-log foi cancelado pela reconexão (`presence-restored`).
    n.tick(5 * 60_000);

    expect(n.session('a')).toBe(world);
    expect(n.character('a')).toBe(hero);
    expect(n.lines).toEqual([]);
    expect(n.released).toEqual([]);
    expect(socket.ended).toBeNull();
  });

  it('cair de novo depois de reconectar recomeça a contagem do zero', async () => {
    const n = node();
    const { viewer } = await n.login('a');
    n.drop(viewer);
    n.tick(40_000);
    const { viewer: back } = await n.reconnect('a');
    n.tick(30_000);
    expect(n.host.sessionFor('a')).toBeDefined();

    n.drop(back);
    // 59 s depois da SEGUNDA queda: os 40 s da primeira não contam.
    n.tick(59_000);
    expect(n.host.sessionFor('a')).toBeDefined();
    n.tick(1_000);
    await untilGone(n, 'a');
  });

  it('em luta, fora da PZ: não sai aos 60 s, e sai 60 s depois do ÚLTIMO golpe', async () => {
    const n = node();
    const { viewer } = await n.login('a', { worldPosition: absolute(STREET) });
    fight(n, 'a');

    n.drop(viewer);
    n.tick(30_000);
    fight(n, 'a'); // outro golpe aos 30 s: a janela recomeça
    n.tick(31_000); // aos 61 s o x-log tenta, e a luta o segura
    expect(n.host.sessionFor('a')).toBeDefined();
    expect(n.lines).toEqual([]);

    n.tick(29_000); // 90 s: a janela do último golpe ainda não venceu
    expect(n.host.sessionFor('a')).toBeDefined();
    n.tick(2_000);
    await untilGone(n, 'a');
    expect(linesOf(n, 'a')).toEqual([expect.objectContaining({ worldPosition: absolute(STREET) })]);
  });

  it('o mundo NÃO é recolhido por repouso como a Cidade: o personagem em luta fica além dos 5 min', async () => {
    const n = node();
    const { viewer } = await n.login('a', { worldPosition: absolute(STREET) });
    n.drop(viewer);

    // Seis minutos sem visualizador, apanhando a cada meio minuto. A Cidade teria sido recolhida aos 5.
    for (let elapsed = 0; elapsed < 6 * 60_000; elapsed += 30_000) {
      fight(n, 'a');
      n.tick(30_000);
    }
    expect(n.host.sessionFor('a')).toBeDefined();
    expect(n.released).toEqual([]);

    // A luta acaba, e é o `sim` — não o recolhimento — que o tira.
    n.tick(61_000);
    await untilGone(n, 'a');
  });

  it('a Cidade (flag desligada) segue como era: fechar o navegador a recolhe aos 5 min, e nada é de presença', async () => {
    const n = node({ openWorld: false });
    const { viewer } = await n.login('a');
    expect(n.session('a').ruleset.type).toBe('city');

    n.drop(viewer);
    n.tick(60_000 + 1_000);
    expect(n.host.sessionFor('a')).toBeDefined();
    n.tick(5 * 60_000);
    await untilGone(n, 'a');
  });

  it('com duas abas, fechar uma não é perder a conexão; fechar a segunda é', async () => {
    const n = node();
    const first = await n.login('a');
    const second = await n.reconnect('a');

    n.drop(first.viewer);
    n.tick(5 * 60_000);
    expect(n.host.sessionFor('a')).toBeDefined();

    n.drop(second.viewer);
    n.tick(XLOG_DELAY_MS);
    await untilGone(n, 'a');
  });
});

describe('chegar ao mundo sem visualizador (#840, OW-19)', () => {
  it('o ticket consumido e nenhum websocket: sai aos 60 s, como quem caiu', async () => {
    const n = node();
    await n.arrive('a');
    expect(n.character('a').position).toEqual(TEMPLE);

    n.tick(XLOG_DELAY_MS - 1_000);
    expect(n.host.sessionFor('a')).toBeDefined();
    n.tick(1_000);
    await untilGone(n, 'a');

    expect(linesOf(n, 'a')).toEqual([expect.objectContaining({ reason: 'manual-exit', worldPosition: absolute(TEMPLE) })]);
    expect(n.released).toEqual(['a']);
  });

  it('o websocket que conecta logo depois do ticket devolve a presença: o personagem fica', async () => {
    const n = node();
    await n.arrive('a');
    n.tick(2_000);
    const { socket } = await n.reconnect('a');

    n.tick(10 * 60_000);
    expect(n.host.sessionFor('a')).toBeDefined();
    expect(n.lines).toEqual([]);
    expect(socket.ended).toBeNull();
  });

  it('a chegada que se soltou na corrida: a volta da hunt SEM visualizador sai aos 60 s', async () => {
    const n = node();
    const { viewer } = await n.login('a');
    await n.host.transition('a', { to: 'hunt', huntId: 'rat-cellars' });
    // O visualizador caiu enquanto o personagem estava na hunt — onde nada disso é presença.
    n.drop(viewer);
    n.tick(5 * 60_000);
    expect(n.session('a').ruleset.type).toBe('hunt');

    await n.host.transition('a', { to: 'world' });
    expect(n.session('a').ruleset.type).toBe('world');
    n.lines.length = 0;

    n.tick(XLOG_DELAY_MS);
    await untilGone(n, 'a');
    expect(linesOf(n, 'a')).toEqual([expect.objectContaining({ reason: 'manual-exit', worldPosition: absolute(TEMPLE) })]);
  });

  it('a volta da hunt COM visualizador não perde presença: o personagem fica', async () => {
    const n = node();
    await n.login('a');
    await n.host.transition('a', { to: 'hunt', huntId: 'rat-cellars' });
    await n.host.transition('a', { to: 'world' });

    n.tick(10 * 60_000);
    expect(n.session('a').ruleset.type).toBe('world');
  });
});

/** Uma porta que o teste abre quando quer: o Redis de mentira espera por ela (`Node.hold`). */
const door = () => {
  let open!: () => void;
  const closed = new Promise<void>((resolve) => { open = resolve; });
  return { closed, open };
};

/** Cede a fila de microtarefas e de timers: o que não depende de porta nenhuma já andou. */
const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 5); });

describe('a reconexão que corre contra a saída do mundo (#840, OW-19)', () => {
  const INITIAL = { level: 1, xp: 0, townId: 'thais' } as const;

  it('o ticket que chega com o x-log em voo ESPERA a saída e é recusado — não reanexa a quem vai embora', async () => {
    // O x-log vence 60 s depois de o navegador fechar, e o cliente reconecta sozinho, com o mesmo atraso:
    // a janela é o `release` (o lote do Redis) e é aí que o ticket cai.
    const n = node();
    const { viewer } = await n.login('a');
    await n.login('keeper');
    n.drop(viewer);
    const gate = door();
    n.hold.saveBatch = gate.closed;
    n.tick(XLOG_DELAY_MS);
    await vi.waitFor(() => { expect(n.redis.attempts).toBe(1); });
    const world = n.session('a');
    expect(world.participants.some((participant) => participant.id === 'a')).toBe(false);

    let answered: unknown;
    const arriving = n.host.prepare('a', { ...INITIAL }, 'acc-a').then((result) => { answered = result; });
    await settle();
    // Esperando a saída: nem `created: false` nem uma sessão nova.
    expect(answered).toBeUndefined();

    gate.open();
    await arriving;
    expect(answered).toEqual({ created: false, refused: 'leaving' });
    expect(n.host.sessionFor('a')).toBeUndefined();
    expect(n.released).toEqual(['a']);
    expect(n.host.viewersOf('a')).toBe(0);

    // A reconexão seguinte (um ticket novo) encontra o personagem em repouso e entra de verdade.
    n.hold.saveBatch = null;
    const { viewer: back, socket } = await n.reconnect('a');
    expect(back.dead).toBe(false);
    expect(socket.ended).toBeNull();
    expect(n.session('a').participants.some((participant) => participant.id === 'a')).toBe(true);
  });

  it('o `prepare` que espera o diretório quando o x-log vence responde com a saída, e não com `created: false`', async () => {
    const n = node();
    const { viewer } = await n.login('a');
    await n.login('keeper');
    n.drop(viewer);
    n.tick(XLOG_DELAY_MS - 1_000);

    // O `prepare` acha a sessão de pé e fica no `register` do diretório (a lentidão do Redis)...
    const gate = door();
    n.hold.register = gate.closed;
    const registersBefore = n.redis.registers;
    const arriving = n.host.prepare('a', { ...INITIAL }, 'acc-a');
    await vi.waitFor(() => { expect(n.redis.registers).toBe(registersBefore + 1); });

    // ...e o x-log vence nesse meio tempo, e a saída inteira acaba antes de o diretório responder.
    n.tick(1_000);
    await untilGone(n, 'a');
    gate.open();

    expect(await arriving).toEqual({ created: false, refused: 'leaving' });
  });

  it('o upgrade que já passou do `prepare` quando o x-log vence: `attach` recusa, e ninguém fica olhando quem saiu', async () => {
    const n = node();
    const { viewer } = await n.login('a');
    await n.login('keeper');
    n.drop(viewer);
    // O ticket foi consumido e o `prepare` terminou antes dos 60 s: só o websocket falta.
    await n.arrive('a');
    const gate = door();
    n.hold.saveBatch = gate.closed;
    n.tick(XLOG_DELAY_MS);
    await vi.waitFor(() => { expect(n.redis.attempts).toBe(1); });

    // `attach` lançar sem ninguém tratar derrubava o processo (`open` do servidor): agora é o erro de que o
    // servidor fecha o socket — e nenhum visualizador entra num personagem que o `sim` já não conhece.
    expect(() => n.host.attach(new FakeSocket(), 'a')).toThrow('a is leaving the world');
    // `viewersOf` conta os da sessão: só o de `keeper`, e nenhum a mais.
    expect(n.host.viewersOf('a')).toBe(1);

    gate.open();
    await untilGone(n, 'a');
    expect(n.host.viewersOf('keeper')).toBe(1);
  });

  it('a saída do x-log que FALHOU nunca fica sem dono: o ciclo de checkpoint a repete, sem jogador nenhum', async () => {
    const n = node();
    const { viewer } = await n.login('a', { worldPosition: absolute(STREET) });
    await n.login('keeper');
    n.drop(viewer);
    n.redis.failNext = 1;

    n.tick(XLOG_DELAY_MS);
    await vi.waitFor(() => { expect(n.redis.attempts).toBe(1); });
    await settle();
    // O personagem é um fantasma: o `sim` já não o conhece, e o hospedeiro ainda o tem — com o slot da conta.
    expect(n.host.sessionFor('a')).toBeDefined();
    expect(n.session('a').participants.some((participant) => participant.id === 'a')).toBe(false);
    expect(n.released).toEqual([]);
    // Fantasma não recebe visualizador: ele só veria uma cena vazia.
    expect(() => n.host.attach(new FakeSocket(), 'a')).toThrow('a is leaving the world');

    // Muito tempo depois, sem ninguém: o ciclo seguinte do checkpoint termina o que o x-log começou.
    n.tick(10 * 60_000);
    await n.host.checkpointWorlds();
    await untilGone(n, 'a');

    expect(n.released).toEqual(['a']);
    expect(n.slots).toEqual(['a']);
    expect(linesOf(n, 'a')).toEqual([expect.objectContaining({ reason: 'manual-exit', worldPosition: absolute(STREET) })]);
    // E a saída que acabou não é repetida: o ciclo seguinte não solta nada de novo.
    await n.host.checkpointWorlds();
    expect(n.released).toEqual(['a']);
  });

  it('quem reconecta a um fantasma o liberta: o `prepare` repete a saída e o ticket seguinte entra', async () => {
    const n = node();
    const { viewer } = await n.login('a', { worldPosition: absolute(STREET) });
    await n.login('keeper');
    n.drop(viewer);
    n.redis.failNext = 1;
    n.tick(XLOG_DELAY_MS);
    await vi.waitFor(() => { expect(n.redis.attempts).toBe(1); });
    await settle();
    expect(n.released).toEqual([]);

    // O ticket da reconexão repete a saída (o Redis voltou) e é recusado: o personagem agora está em repouso.
    expect(await n.host.prepare('a', { ...INITIAL }, 'acc-a')).toEqual({ created: false, refused: 'leaving' });
    expect(n.released).toEqual(['a']);
    expect(n.host.sessionFor('a')).toBeUndefined();

    // E se o Redis AINDA recusa, o ticket também é recusado — nunca reanexa ao fantasma.
    const second = await n.login('a', { worldPosition: absolute(STREET) });
    n.drop(second.viewer);
    n.redis.failNext = 2;
    n.tick(XLOG_DELAY_MS);
    await vi.waitFor(() => { expect(n.redis.attempts).toBeGreaterThanOrEqual(3); });
    await settle();
    expect(await n.host.prepare('a', { ...INITIAL }, 'acc-a')).toEqual({ created: false, refused: 'leaving' });
    expect(n.host.sessionFor('a')).toBeDefined();
    await n.host.checkpointWorlds();
    await untilGone(n, 'a');
  });
});

describe('o `logout` no mundo (#840, OW-19)', () => {
  it('na PZ passa na hora: o socket fecha com `logout`, e o checkpoint leva a posição e a vida', async () => {
    const n = node();
    const { viewer, socket } = await n.login('a', { health: 77 });
    await n.login('keeper');
    const hero = n.character('a');

    n.host.handle(viewer, { type: 'logout' });
    await untilGone(n, 'a');

    expect(socket.ended).toEqual({ code: 1000, reason: 'logout' });
    expect(linesOf(n, 'a')).toEqual([expect.objectContaining({
      reason: 'manual-exit', worldPosition: absolute(TEMPLE), health: hero.health,
    })]);
    expect(n.released).toEqual(['a']);
    expect(n.slots).toEqual(['a']);
    // Ninguém recebeu `logout-refused`.
    expect(ofType(socket.received(), 'logout-refused')).toEqual([]);
  });

  it('em luta, fora da PZ, é RECUSADO: o motivo volta a quem pediu, e o personagem não sai nem fecha', async () => {
    const n = node();
    const { viewer, socket } = await n.login('a', { worldPosition: absolute(STREET) });
    const other = await n.login('keeper');
    fight(n, 'a');
    const world = n.session('a');

    n.host.handle(viewer, { type: 'logout' });
    n.host.flush();

    expect(ofType(socket.received(), 'logout-refused')).toEqual([{ type: 'logout-refused', reason: 'in-fight' }]);
    // Só quem pediu a lê.
    expect(ofType(other.socket.received(), 'logout-refused')).toEqual([]);
    expect(n.host.sessionFor('a')).toBe(world);
    expect(socket.ended).toBeNull();
    expect(n.lines).toEqual([]);
    expect(n.released).toEqual([]);

    // A luta acaba (60 s sem golpe) e o mesmo pedido passa.
    n.tick(61_000);
    n.host.handle(viewer, { type: 'logout' });
    await untilGone(n, 'a');
    expect(linesOf(n, 'a')).toEqual([expect.objectContaining({ worldPosition: absolute(STREET) })]);
  });

  it('em luta, na PZ, passa: a PZ isenta da luta', async () => {
    const n = node();
    const { viewer, socket } = await n.login('a');
    fight(n, 'a');

    n.host.handle(viewer, { type: 'logout' });
    await untilGone(n, 'a');

    expect(socket.ended).toEqual({ code: 1000, reason: 'logout' });
    expect(ofType(socket.received(), 'logout-refused')).toEqual([]);
  });

  it('num tile de no-logout é recusado, até na PZ: o motivo é o do tile', async () => {
    const n = node();
    const { viewer, socket } = await n.login('a', { worldPosition: absolute(UPSTAIRS) });

    n.host.handle(viewer, { type: 'logout' });
    n.host.flush();

    expect(ofType(socket.received(), 'logout-refused')).toEqual([{ type: 'logout-refused', reason: 'no-logout-tile' }]);
    expect(n.host.sessionFor('a')).toBeDefined();
  });

  it('a recusa chega a TODAS as abas de quem pediu', async () => {
    const n = node();
    const first = await n.login('a', { worldPosition: absolute(STREET) });
    const second = await n.reconnect('a');
    fight(n, 'a');

    n.host.handle(first.viewer, { type: 'logout' });
    n.host.flush();

    expect(ofType(first.socket.received(), 'logout-refused')).toHaveLength(1);
    expect(ofType(second.socket.received(), 'logout-refused')).toHaveLength(1);
  });

  it('o `logout` repetido (o duplo clique) não grava duas saídas: o personagem já saiu do `sim`', async () => {
    const n = node();
    const { viewer } = await n.login('a');
    await n.login('keeper');

    n.host.handle(viewer, { type: 'logout' });
    n.host.handle(viewer, { type: 'logout' });
    await untilGone(n, 'a');

    expect(linesOf(n, 'a')).toHaveLength(1);
    expect(n.released).toEqual(['a']);
  });

  it('a saída que FALHOU é tentada de novo: o `logout` não tem como pedir outra vez, e o ciclo de checkpoint a termina', async () => {
    const n = node();
    const { viewer, socket } = await n.login('a', { worldPosition: absolute(STREET) });
    await n.login('keeper');
    n.redis.failNext = 1;

    n.host.handle(viewer, { type: 'logout' });
    await vi.waitFor(() => { expect(n.redis.attempts).toBe(1); });
    // O Redis recusou o extrato: o `release` não soltou o personagem (diretório e slot ficam), embora o `sim`
    // já o tenha tirado da sessão. O socket fechou — o `release` começa por aí.
    await vi.waitFor(() => { expect(socket.ended).not.toBeNull(); });
    await vi.waitFor(() => { expect(n.host.sessionFor('a')).toBeDefined(); });
    expect(n.released).toEqual([]);
    expect(n.lines).toEqual([]);

    // Ninguém pede de novo — o cliente nem tem como (não manda `logout` nem reanexa a quem está saindo) —, e
    // quem repete a saída é o hospedeiro: o próximo ciclo de checkpoint, com o extrato que não pousou na frente.
    await n.host.checkpointWorlds();
    await untilGone(n, 'a');

    expect(linesOf(n, 'a')).toEqual([expect.objectContaining({ reason: 'manual-exit', worldPosition: absolute(STREET) })]);
    expect(n.released).toEqual(['a']);
    expect(n.slots).toEqual(['a']);
  });

  it('a saída ANTECIPA o lote inteiro: a linha de quem sai vai junto da de quem está sujo, num `saveBatch` só', async () => {
    const n = node();
    const { viewer } = await n.login('a');
    await n.login('keeper', { worldPosition: absolute(STREET) });
    // O outro mexeu em algo desde o último lote (perdeu vida): está sujo.
    n.character('keeper').health -= 10;

    n.host.handle(viewer, { type: 'logout' });
    await untilGone(n, 'a');

    expect(n.batches).toHaveLength(1);
    expect(n.batches[0]?.map((line) => [line.characterId, line.reason])).toEqual([
      ['a', 'manual-exit'], ['keeper', 'checkpoint'],
    ]);
  });

  it('o `logout` de quem já está numa transição não o solta: ele está deixando o mundo, e o `release` pegaria a hunt', async () => {
    const n = node();
    const { viewer } = await n.login('a');
    await n.login('keeper');

    // A transição em voo: o `sim` já tirou o personagem do mundo, e o hospedeiro ainda o tem mapeado.
    const going = n.host.transition('a', { to: 'hunt', huntId: 'rat-cellars' });
    n.host.handle(viewer, { type: 'logout' });
    await going;
    await vi.waitFor(() => { expect(n.host.sessionFor('a')).toBeDefined(); });

    expect(n.session('a').ruleset.type).toBe('hunt');
    expect(n.released).toEqual([]);
    expect(viewer.dead).toBe(false);
  });

  it('com a flag DESLIGADA o `logout` é o de sempre: a Cidade solta o personagem, sem `canLogout`', async () => {
    const n = node({ openWorld: false });
    const { viewer, socket } = await n.login('a');
    expect(n.session('a').ruleset.type).toBe('city');
    fight(n, 'a');

    n.host.handle(viewer, { type: 'logout' });
    await untilGone(n, 'a');

    expect(socket.ended).toEqual({ code: 1000, reason: 'logout' });
    expect(ofType(socket.received(), 'logout-refused')).toEqual([]);
  });
});

// O hospedeiro cumpre o `departure-requested` como o `sim` o descreveu — a posição do EVENTO, o motivo
// traduzido em `EndReason` — sem decidir nada. Um ruleset de mentira fala a língua do mundo e emite o que o
// teste quer, porque o x-log real não deixa o personagem andar entre o evento e o hospedeiro.
describe('o hospedeiro cumpre o `departure-requested` sem decidir (#840, OW-19)', () => {
  const ORIGIN = { x: 32_000, y: 32_100 } as const;

  /** O mundo de mentira: `departure-requested` com o motivo e a posição que o teste escolher. */
  function stubWorld() {
    const requested: { reason: WorldDepartureReason; at: Point; times: number; verdict: 'ok' | 'unknown' } = {
      reason: 'logout', at: { x: 32_111, y: 32_222, z: 7 }, times: 1, verdict: 'ok',
    };
    const calls: string[] = [];
    const ruleset = {
      type: 'world', shared: true, progress: 'checkpointed', hz: () => 10,
      onEnter: () => {}, onEvent: () => {}, onCreatureDied: () => {}, onEnd: () => {},
      worldPositionOf: (character: CharacterRuntime): Point => ({
        x: ORIGIN.x + character.position.x, y: ORIGIN.y + character.position.y, z: character.position.z,
      }),
      requestLogout: (session: Session, characterId: string) => {
        calls.push(`logout:${characterId}`);
        // O `sim` que não conhece o personagem (ou o que morreu) não decide nada: `null`, e nenhum evento.
        if (requested.verdict === 'unknown') return null;
        for (let i = 0; i < requested.times; i += 1) {
          session.emit({ kind: 'departure-requested', characterId, reason: requested.reason, worldPosition: requested.at });
        }
        return { ok: true };
      },
      presenceLost: (_session: Session, characterId: string) => { calls.push(`lost:${characterId}`); },
      presenceRestored: (_session: Session, characterId: string) => { calls.push(`restored:${characterId}`); },
    } as unknown as Ruleset;
    const session = new Session({ id: 'world-stub', contentVersion: 'v-test', ruleset, rng: Rng.fromSeed('w'), createdAtMs: 0 });
    const lines: SavedLine[] = [];
    const receipts = {
      save: async () => { throw new Error('o mundo grava em lote'); },
      saveBatch: async (batch: readonly SavedLine[]) => { lines.push(...batch); },
    } as unknown as ReceiptStore;
    const host = new SessionHost({
      nodeId: 'n1', contentVersion: 'v-test', logger, receipts, openWorld: true,
      createSession: (characterId) => {
        session.enter(new CharacterRuntime({
          id: characterId, position: { x: 10, y: 20, z: 7 }, health: 100, maxHealth: 100, mana: 10, maxMana: 10,
          level: 8, xp: 0, gold: 0, goldDelta: 0, alive: true, cooldowns: {}, townId: 'thais',
        }));
        return session;
      },
    });
    const enter = async (characterId: string) => {
      await host.prepare(characterId, { level: 8, xp: 0, townId: 'thais' }, `acc-${characterId}`);
      return host.attach(new FakeSocket(), characterId);
    };
    return { host, session, requested, calls, lines, enter };
  }

  it('a âncora é a posição do EVENTO, e não a de quando o hospedeiro roda', async () => {
    const f = stubWorld();
    const viewer = await f.enter('a');

    f.host.handle(viewer, { type: 'logout' });
    await vi.waitFor(() => { expect(f.host.sessionFor('a')).toBeUndefined(); });

    // O personagem estava em (10, 20) → absoluto (32010, 32120); o evento diz (32111, 32222).
    expect(f.lines).toEqual([expect.objectContaining({ characterId: 'a', worldPosition: { x: 32_111, y: 32_222, z: 7 } })]);
  });

  it('sem posição no evento (o `0,0,0` do Canary) a âncora é a de agora', async () => {
    const f = stubWorld();
    f.requested.at = NO_WORLD_POSITION;
    const viewer = await f.enter('a');

    f.host.handle(viewer, { type: 'logout' });
    await vi.waitFor(() => { expect(f.host.sessionFor('a')).toBeUndefined(); });

    expect(f.lines).toEqual([expect.objectContaining({ worldPosition: { x: 32_010, y: 32_120, z: 7 } })]);
  });

  it.each([
    ['logout', 'manual-exit'],
    ['xlog', 'manual-exit'],
    ['idle-kick', 'manual-exit'],
    ['death', 'death'],
  ] as const)('o motivo `%s` do mundo vira `%s` no extrato, e o socket fecha com ele', async (reason, endReason) => {
    const f = stubWorld();
    f.requested.reason = reason;
    const socket = new FakeSocket();
    await f.host.prepare('a', { level: 8, xp: 0, townId: 'thais' }, 'acc-a');
    const viewer = f.host.attach(socket, 'a');

    f.host.handle(viewer, { type: 'logout' });
    await vi.waitFor(() => { expect(f.host.sessionFor('a')).toBeUndefined(); });

    expect(f.lines).toEqual([expect.objectContaining({ reason: endReason })]);
    expect(socket.ended).toEqual({ code: 1000, reason });
  });

  it('dois pedidos de saída do MESMO personagem no mesmo ciclo viram UMA saída', async () => {
    // O x-log e o idle kick (OW-47) podem vencer no mesmo avanço, e os dois eventos chegam juntos a
    // `#presentMoves`. O primeiro `release` já tirou o personagem da sessão do `sim`, mas o hospedeiro só
    // o esquece depois dos `await`s — e a segunda saída soltaria de novo o que já está saindo.
    const f = stubWorld();
    f.requested.times = 2;
    const viewer = await f.enter('a');
    const release = vi.spyOn(f.host, 'release');

    f.host.handle(viewer, { type: 'logout' });
    await vi.waitFor(() => { expect(f.host.sessionFor('a')).toBeUndefined(); });

    expect(release).toHaveBeenCalledTimes(1);
    expect(f.lines).toHaveLength(1);
  });

  it('sem veredicto (o `sim` não conhece o personagem) o `logout` é o `release` de sempre — não um pedido sem resposta', async () => {
    const f = stubWorld();
    f.requested.verdict = 'unknown';
    const socket = new FakeSocket();
    await f.host.prepare('a', { level: 8, xp: 0, townId: 'thais' }, 'acc-a');
    const viewer = f.host.attach(socket, 'a');
    const release = vi.spyOn(f.host, 'release');

    f.host.handle(viewer, { type: 'logout' });
    f.host.handle(viewer, { type: 'logout' }); // o duplo clique: o segundo não solta de novo

    await vi.waitFor(() => { expect(f.host.sessionFor('a')).toBeUndefined(); });
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('a', 1000, 'logout', undefined);
    expect(socket.ended).toEqual({ code: 1000, reason: 'logout' });
  });

  it('o hospedeiro entrega a presença e nada mais: o primeiro visualizador restaura, o último solta', async () => {
    const f = stubWorld();
    const first = await f.enter('a');
    const second = f.host.attach(new FakeSocket(), 'a');
    expect(f.calls).toEqual(['lost:a', 'restored:a']); // chegou sem ninguém; a primeira aba devolveu

    f.host.detach(first);
    expect(f.calls).toEqual(['lost:a', 'restored:a']); // a segunda ainda olha
    f.host.detach(second);
    expect(f.calls).toEqual(['lost:a', 'restored:a', 'lost:a']);
  });

  it('quem o servidor SOLTA não é "perda de conexão": o `close` que o `release` provoca não submete presence-lost', async () => {
    const f = stubWorld();
    const socket = new FakeSocket();
    await f.host.prepare('a', { level: 8, xp: 0, townId: 'thais' }, 'acc-a');
    const viewer = f.host.attach(socket, 'a');
    // O servidor real fecha o socket e o `close` chama o `detach`: o FakeSocket não o faz sozinho.
    const end = socket.end.bind(socket);
    socket.end = (code, reason) => { end(code, reason); viewer.markClosed(); f.host.detach(viewer); };
    f.calls.length = 0;

    await f.host.release('a', 1000, 'logout');

    // O personagem estava saindo, e entregar `presence-lost` de quem o `release` já soltou deixaria um x-log
    // pendente de um personagem que não está mais lá — e, se o mesmo id voltasse, de quem acabou de chegar.
    expect(f.calls).toEqual([]);
    expect(f.host.sessionFor('a')).toBeUndefined();
  });
});
