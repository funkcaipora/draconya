import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import { decodeS2C, encodeC2S } from '@draconya/protocol';
import type { S2CMessage } from '@draconya/protocol';
import { loadConfiguration } from '../config.js';
import type { SessionDirectory } from '../directory.js';
import { createLogger } from '../log.js';
import type { InitialCharacter, TicketClaim, TicketService } from '../tickets.js';
import { buildCatalogue } from './catalogue.js';
import { createGame } from './server.js';
import type { GameRole } from './server.js';
import type { WorldEntryGate, WorldEntryVerdict } from './rest-entry.js';
import { createSessionWiring } from './sessions.js';

// A entrada pelo repouso no SOCKET de verdade (#842, OW-21): o servidor uWebSockets, o handshake por ticket e o
// `SessionHost` com a costura de sessões do nó sobre o conteúdo real. O que se prende é o que o cliente VÊ: o
// mundo cheio abre o socket só para entregar `world-full` e fechar, e o ticket com `entry: { hunt }` cai direto
// na hunt. A fila em si — Redis — é de `world-queue.test.ts` e `rest-entry.test.ts`; aqui a porta é escrita à
// mão, para fixar o que o socket faz com cada resposta dela.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => (cached ??= loadContent(DATA));
const logger = createLogger('silent', 'test');

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('sem porta');
  await new Promise<void>((resolve, reject) => { server.close((error) => (error ? reject(error) : resolve())); });
  return address.port;
}

/** O diretório de mentira: aceita todo registro, e não vê nenhum outro nó. */
const directory = {
  register: async () => true,
  renew: async () => undefined,
  heartbeat: async () => undefined,
  aliveNodes: async () => [],
  release: async () => undefined,
  releaseSlot: async () => undefined,
  succeed: async () => true,
} as unknown as SessionDirectory;

/**
 * O ticket de mentira: `tk-<id>` é o personagem `<id>`, e `tk-<id>@<hunt>` é o mesmo personagem pedindo a hunt
 * idle direta (`entry: { hunt }`).
 */
const tickets = {
  consume: async (token: string, nodeId: string): Promise<TicketClaim | null> => {
    if (!token.startsWith('tk-')) return null;
    const [characterId = '', hunt] = token.slice(3).split('@');
    const initialCharacter: InitialCharacter = { level: 1, xp: 0, townId: 'thais' };
    return {
      accountId: `acc-${characterId}`, characterId, nodeId, initialCharacter,
      ...(hunt === undefined ? {} : { entry: { hunt } }),
    };
  },
} as unknown as TicketService;

class Inbox {
  readonly messages: S2CMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  opened = false;
  failed = false;
  constructor(readonly socket: WebSocket) {
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => { this.opened = true; });
    socket.addEventListener('error', () => { this.failed = true; });
    socket.addEventListener('close', (event) => { this.closed = { code: event.code, reason: event.reason }; });
    socket.addEventListener('message', (event) => {
      this.messages.push(...(decodeS2C(new Uint8Array(event.data as ArrayBuffer)) ?? []));
    });
  }

  async waitFor<T extends S2CMessage['type']>(type: T, timeoutMs = 4_000): Promise<Extract<S2CMessage, { type: T }>> {
    await until(() => this.messages.some((message) => message.type === type), timeoutMs, `waiting for ${type}`);
    return this.messages.find((message) => message.type === type) as Extract<S2CMessage, { type: T }>;
  }
}

/** Espera uma condição do nó com PRAZO, em vez de dormir um número escolhido no olho. */
async function until(condition: () => boolean, timeoutMs = 4_000, what = 'the condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out ${what}`);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
}

const running: GameRole[] = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const game of running.splice(0)) game.stop();
});

/** Uma porta que responde `verdict` a todo login e conta quem bateu e quem largou a fila. */
function scriptedGate(verdict: WorldEntryVerdict) {
  const logins: string[] = [];
  const left: string[] = [];
  const gate: WorldEntryGate = {
    login: async (characterId) => { logins.push(characterId); return verdict; },
    leave: async (characterId) => { left.push(characterId); },
  };
  return { gate, logins, left };
}

async function startNode(options: {
  readonly gate?: WorldEntryGate;
  readonly huntless?: boolean;
  readonly openWorld?: boolean;
}): Promise<{ game: GameRole; port: number }> {
  const port = await availablePort();
  const openWorld = options.openWorld !== false;
  const configuration = loadConfiguration({
    PROCESSES: 'game', REDIS_URL: 'redis://localhost:6379', NODE_ENV: 'test', NODE_ID: 'game-1',
    GAME_PORT: String(port), GAME_PUBLIC_URL: `ws://127.0.0.1:${String(port)}`,
    OPEN_WORLD: openWorld ? '1' : '0',
  });
  const content = real();
  const wiring = createSessionWiring(content, () => Date.now(), { openWorld });
  const catalogue = buildCatalogue(content);
  const game = createGame(configuration, logger, {
    directory, tickets, contentVersion: content.version,
    createSession: wiring.createSession, buildSession: wiring.buildSession,
    itemCatalog: content.items, progression: content.progression,
    catalogue: () => (options.huntless === true ? { ...catalogue, hunts: [] } : catalogue),
    ...(options.gate === undefined ? {} : { worldEntry: options.gate }),
  });
  await game.start();
  running.push(game);
  return { game, port };
}

function open(port: number, ticket: string): Inbox {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/?ticket=${ticket}`);
  sockets.push(socket);
  return new Inbox(socket);
}

describe('o mundo cheio no socket de verdade (#842, OW-21)', () => {
  it('o handshake abre só para entregar `world-full` com a posição e a espera, e o socket FECHA — sem sessão nem visualizador', async () => {
    const { gate, logins } = scriptedGate({ admitted: false, position: 3, retryAfterMs: 10_000 });
    const { game, port } = await startNode({ gate });

    const inbox = open(port, 'tk-c');
    const full = await inbox.waitFor('world-full');

    expect(full).toEqual({ type: 'world-full', position: 3, retryAfterMs: 10_000, huntAvailable: true });
    // Fechou, e com um código de APLICAÇÃO (4001): o cliente que só olha o código sabe que não foi uma queda.
    await until(() => inbox.closed !== null, 4_000, 'for the close');
    expect(inbox.closed).toMatchObject({ code: 4001, reason: 'world-full' });
    // Nenhum `welcome`, nenhum estado: o personagem não está em lugar nenhum.
    expect(inbox.messages.map((message) => message.type)).toEqual(['world-full']);
    expect(logins).toEqual(['c']);
    expect(game.host?.sessionCount).toBe(0);
    expect(game.host?.sessionFor('c')).toBeUndefined();
    expect(game.host?.viewersOf('c')).toBe(0);
  });

  it('`huntAvailable` é falso quando o nó não tem hunt para oferecer', async () => {
    const { gate } = scriptedGate({ admitted: false, position: 1, retryAfterMs: 5_000 });
    const { port } = await startNode({ gate, huntless: true });

    const full = await open(port, 'tk-c').waitFor('world-full');

    expect(full.huntAvailable).toBe(false);
  });

  it('o mesmo personagem pode tentar de novo logo em seguida: a recusa não deixa o handshake preso', async () => {
    const { gate, logins } = scriptedGate({ admitted: false, position: 1, retryAfterMs: 5_000 });
    const { port } = await startNode({ gate });

    await open(port, 'tk-c').waitFor('world-full');
    await open(port, 'tk-c').waitFor('world-full');

    expect(logins).toEqual(['c', 'c']);
  });

  it('com a porta dizendo "entre", o login é o de sempre: o mundo, com `welcome` e estado', async () => {
    const { gate } = scriptedGate({ admitted: true });
    const { game, port } = await startNode({ gate });

    const inbox = open(port, 'tk-a');
    await inbox.waitFor('welcome');
    inbox.socket.send(encodeC2S({ type: 'session-attach' }));

    expect(await inbox.waitFor('session-state')).toMatchObject({ sessionType: 'world' });
    expect(inbox.messages.some((message) => message.type === 'world-full')).toBe(false);
    expect(game.host?.sessionFor('a')?.ruleset.type).toBe('world');
  });
});

describe('a hunt idle direta no socket de verdade (#842, OW-21)', () => {
  it('o ticket com `entry: { hunt }` cai direto na HUNT, e a porta do mundo nem é consultada', async () => {
    const { gate, logins } = scriptedGate({ admitted: false, position: 1, retryAfterMs: 5_000 });
    const { game, port } = await startNode({ gate });

    const inbox = open(port, 'tk-h@rat-cellars');
    await inbox.waitFor('welcome');
    inbox.socket.send(encodeC2S({ type: 'session-attach' }));

    // Mesmo com o mundo "cheio" (a porta recusaria): a hunt idle não passa por ele.
    expect(await inbox.waitFor('session-state')).toMatchObject({ sessionType: 'hunt', huntId: 'rat-cellars' });
    expect(game.host?.sessionFor('h')?.ruleset.type).toBe('hunt');
    expect(logins).toEqual([]);
    expect(inbox.messages.some((message) => message.type === 'world-full')).toBe(false);
  });

  it('o nó tira da fila quem entrou na hunt direta', async () => {
    const { gate, left } = scriptedGate({ admitted: false, position: 1, retryAfterMs: 5_000 });
    const { port } = await startNode({ gate });

    const inbox = open(port, 'tk-h@rat-cellars');
    await inbox.waitFor('welcome');

    expect(left).toEqual(['h']);
  });

  it('uma hunt que o nó não conhece recusa o handshake com 409, sem abrir o socket nem criar sessão', async () => {
    const { game, port } = await startNode({});

    const inbox = open(port, 'tk-h@nao-existe');
    await until(() => inbox.failed || inbox.closed !== null, 4_000, 'for the refusal');

    expect(inbox.opened).toBe(false);
    expect(game.host?.sessionCount).toBe(0);
    expect(game.host?.sessionFor('h')).toBeUndefined();
  });

  it('com a flag DESLIGADA o `entry` é ignorado e o login cai na Cidade', async () => {
    const { game, port } = await startNode({ openWorld: false });

    const inbox = open(port, 'tk-h@rat-cellars');
    await inbox.waitFor('welcome');
    inbox.socket.send(encodeC2S({ type: 'session-attach' }));

    expect(await inbox.waitFor('session-state')).toMatchObject({ sessionType: 'city' });
    expect(game.host?.sessionFor('h')?.ruleset.type).toBe('city');
  });
});
