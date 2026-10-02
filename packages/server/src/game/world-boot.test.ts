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
import { createGame } from './server.js';
import type { GameRole } from './server.js';
import { createSessionWiring } from './sessions.js';

// O mundo de PONTA A PONTA no papel `game` (#839, OW-18): o servidor uWebSockets de verdade, o handshake por
// ticket, o `SessionHost` com o ciclo de 100 ms e a costura de sessões do nó (`createSessionWiring`) sobre o
// conteúdo REAL — o que o `main.ts` monta, menos o Redis e o Postgres (o diretório e o ticket são de mentira:
// o que está em teste é o caminho do socket até o mundo). Com a flag ligada o login cai no mundo e dois
// sockets dividem a MESMA sessão; com ela desligada, na Cidade.
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

/** O ticket de mentira: `tk-<id>` é o personagem `<id>`. */
const tickets = {
  consume: async (token: string, nodeId: string): Promise<TicketClaim | null> => {
    if (!token.startsWith('tk-')) return null;
    const characterId = token.slice(3);
    const initialCharacter: InitialCharacter = { level: 1, xp: 0, townId: 'thais' };
    return { accountId: `acc-${characterId}`, characterId, nodeId, initialCharacter };
  },
} as unknown as TicketService;

class Inbox {
  readonly messages: S2CMessage[] = [];
  constructor(readonly socket: WebSocket) {
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event) => {
      this.messages.push(...(decodeS2C(new Uint8Array(event.data as ArrayBuffer)) ?? []));
    });
  }

  async waitFor<T extends S2CMessage['type']>(type: T, timeoutMs = 4_000): Promise<Extract<S2CMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find((message) => message.type === type);
      if (found !== undefined) return found as Extract<S2CMessage, { type: T }>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
      // Cedência, com prazo: a mensagem vem da rede, e não há relógio a injetar.
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    }
  }
}

/** Espera uma condição do nó com PRAZO, em vez de dormir um número escolhido no olho. */
async function until(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition');
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
}

const running: GameRole[] = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const game of running.splice(0)) game.stop();
});

async function startNode(openWorld: boolean): Promise<{ game: GameRole; port: number }> {
  const port = await availablePort();
  const configuration = loadConfiguration({
    PROCESSES: 'game', REDIS_URL: 'redis://localhost:6379', NODE_ENV: 'test', NODE_ID: 'game-1',
    GAME_PORT: String(port), GAME_PUBLIC_URL: `ws://127.0.0.1:${String(port)}`,
    OPEN_WORLD: openWorld ? '1' : '0',
  });
  const content = real();
  const wiring = createSessionWiring(content, () => Date.now(), { openWorld: configuration.OPEN_WORLD });
  const game = createGame(configuration, logger, {
    directory, tickets, contentVersion: content.version,
    createSession: wiring.createSession, buildSession: wiring.buildSession,
    itemCatalog: content.items, progression: content.progression,
  });
  await game.start();
  running.push(game);
  return { game, port };
}

async function connect(port: number, characterId: string): Promise<Inbox> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/?ticket=tk-${characterId}`);
  sockets.push(socket);
  const inbox = new Inbox(socket);
  await inbox.waitFor('welcome');
  socket.send(encodeC2S({ type: 'session-attach' }));
  return inbox;
}

describe('o login pelo socket de verdade (#839, OW-18)', () => {
  it('com `OPEN_WORLD` ligado o login cai no MUNDO, e o segundo socket entra na mesma sessão', async () => {
    const { game, port } = await startNode(true);

    const a = await connect(port, 'a');
    const b = await connect(port, 'b');

    const stateOfA = await a.waitFor('session-state');
    const stateOfB = await b.waitFor('session-state');
    expect(stateOfA).toMatchObject({ sessionType: 'world', world: { mapId: 'thais' } });
    expect(stateOfB).toMatchObject({ sessionType: 'world' });
    expect(await a.waitFor('instance-enter')).toMatchObject({ map: 'thais' });
    // Uma sessão só, com os dois dentro, no templo (o segundo no livre mais próximo).
    expect(game.host?.sessionCount).toBe(1);
    expect(game.host?.sessionFor('a')).toBe(game.host?.sessionFor('b'));
    expect(game.host?.sessionFor('a')?.participants.map((participant) => participant.id)).toEqual(['a', 'b']);
    expect(game.host?.sessionFor('a')?.participants[0]?.position).toEqual({ x: 94, y: 88, z: 7 });
    // O segundo chegou ao campo de visão do primeiro: o `creature-appear` dele chegou ao socket de `a`.
    await until(() => a.messages.some((message) => message.type === 'creature-appear' && message.name === 'b'));
  });

  it('desanexar NÃO tira o personagem do mundo: o socket fecha e a sessão segue de pé a 10 Hz', async () => {
    const { game, port } = await startNode(true);
    const a = await connect(port, 'a');
    await a.waitFor('session-state');

    a.socket.close();
    // O hospedeiro vê o socket fechar (`detach`) e o ciclo roda mais algumas vezes: o mundo segue de pé.
    await until(() => game.host?.viewersOf('a') === 0);
    await new Promise((resolve) => { setTimeout(resolve, 250); });

    // A presença (o x-log aos 60 s, OW-19) ainda não existe: o hospedeiro só garante que fechar o navegador
    // não encerra nada, e que o mundo não é recolhido como a Cidade (`hz > 0`).
    expect(game.host?.sessionCount).toBe(1);
    expect(game.host?.sessionFor('a')?.ruleset.type).toBe('world');
    expect(game.host?.sessionFor('a')?.currentHz()).toBe(10);
  });

  it('com a flag DESLIGADA — o default — o login cai na Cidade, como sempre', async () => {
    const { game, port } = await startNode(false);

    const a = await connect(port, 'a');

    expect(await a.waitFor('session-state')).toMatchObject({ sessionType: 'city' });
    expect(game.host?.sessionFor('a')?.ruleset.type).toBe('city');
  });
});
