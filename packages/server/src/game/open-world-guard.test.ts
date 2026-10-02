import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { loadConfiguration } from '../config.js';
import type { Configuration } from '../config.js';
import type { NodeStatus, SessionDirectory } from '../directory.js';
import { createLogger } from '../log.js';
import { createGame } from './server.js';
import { MultipleGameNodesError, assertSoleGameNode } from './open-world-guard.js';

// A recusa de subir com `OPEN_WORLD` e outro `game` vivo (#839, OW-18, ADR 0060 d.2c): o mundo é uma sessão
// num processo só (invariante 9), e a trava de verdade — a que deixa mais de um nó — é a OW-59.
const logger = createLogger('silent', 'test');

const alive = (nodeId: string): NodeStatus => ({ nodeId, sessions: 0, url: `ws://${nodeId}:7171/ws`, players: 0 });
const directoryOf = (nodes: readonly NodeStatus[] | Error): Pick<SessionDirectory, 'aliveNodes'> => ({
  aliveNodes: async () => {
    if (nodes instanceof Error) throw nodes;
    return [...nodes];
  },
});

describe('assertSoleGameNode (#839)', () => {
  it('sem nenhum outro nó vivo, o nó sobe', async () => {
    await expect(assertSoleGameNode(directoryOf([]), 'game-1')).resolves.toBeUndefined();
  });

  it('o batimento do PRÓPRIO nó — a encarnação anterior, até o fim do lease — não conta', async () => {
    // O contêiner que reinicia com o mesmo `NODE_ID` encontra o batimento de si mesmo, e não pode se
    // recusar por causa dele.
    await expect(assertSoleGameNode(directoryOf([alive('game-1')]), 'game-1')).resolves.toBeUndefined();
  });

  it('outro nó `game` vivo recusa, com todos os ids no erro, em ordem', async () => {
    const error = await assertSoleGameNode(
      directoryOf([alive('game-3'), alive('game-1'), alive('game-2')]), 'game-1',
    ).catch((caught: unknown) => caught);

    // Mutação que mata: não filtrar o próprio id (recusaria o restart) ou não recusar o outro (dois mundos).
    expect(error).toBeInstanceOf(MultipleGameNodesError);
    expect(error).toMatchObject({ nodeId: 'game-1', others: ['game-2', 'game-3'] });
    expect((error as Error).message).toMatch(/game-2, game-3/);
    expect((error as Error).message).toMatch(/OW-59/);
  });

  it('não saber é recusar: o diretório que falha derruba a subida, e não a deixa passar', async () => {
    await expect(assertSoleGameNode(directoryOf(new Error('redis down')), 'game-1')).rejects.toThrow('redis down');
  });
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('sem porta');
  await new Promise<void>((resolve, reject) => { server.close((error) => (error ? reject(error) : resolve())); });
  return address.port;
}

async function configurationOf(openWorld: boolean): Promise<Configuration> {
  const port = await availablePort();
  return loadConfiguration({
    PROCESSES: 'game', REDIS_URL: 'redis://localhost:6379', NODE_ENV: 'test', NODE_ID: 'game-1',
    GAME_PORT: String(port), GAME_PUBLIC_URL: `ws://127.0.0.1:${String(port)}`,
    OPEN_WORLD: openWorld ? '1' : '0',
  });
}

describe('o papel `game` e a recusa de subir (#839)', () => {
  const heartbeats: string[] = [];
  const directory = (nodes: readonly NodeStatus[]): SessionDirectory => ({
    aliveNodes: async () => [...nodes],
    heartbeat: async (nodeId: string) => { heartbeats.push(nodeId); },
  } as unknown as SessionDirectory);

  it('com `OPEN_WORLD` e outro `game` vivo, o `start` recusa ANTES de abrir a porta e de bater o coração', async () => {
    heartbeats.length = 0;
    const game = createGame(await configurationOf(true), logger, { directory: directory([alive('game-2')]) });

    await expect(game.start()).rejects.toBeInstanceOf(MultipleGameNodesError);

    // O `api` nunca vê um nó que vai cair: nenhum batimento saiu.
    expect(heartbeats).toEqual([]);
  });

  it('com `OPEN_WORLD` e sem outro nó, sobe e bate o coração', async () => {
    heartbeats.length = 0;
    const game = createGame(await configurationOf(true), logger, { directory: directory([alive('game-1')]) });

    await game.start();
    try {
      expect(heartbeats).toEqual(['game-1']);
    } finally {
      game.stop();
    }
  });

  it('com a flag DESLIGADA o nó sobe ao lado de outro: a recusa é só do mundo aberto', async () => {
    heartbeats.length = 0;
    const game = createGame(await configurationOf(false), logger, { directory: directory([alive('game-2')]) });

    await game.start();
    try {
      expect(heartbeats).toEqual(['game-1']);
    } finally {
      game.stop();
    }
  });
});
