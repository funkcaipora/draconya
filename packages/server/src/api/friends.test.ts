import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerFriendRoutes } from './friends.js';
import type { FriendRouteDependencies } from './friends.js';

// A lista de amigos e ONDE cada um está (#403, §21), com o diretório de mentira: o que está em teste é a
// tradução do `type` da sessão para o `where` do contrato — a Cidade, o mundo aberto (#839, OW-18), a hunt e
// o offline. A tabela `friend` e o diretório de verdade estão em `friends.postgres.test.ts`.
const FRIENDS = ['city', 'world', 'hunt', 'training', 'offline'] as const;

function build(locations: Readonly<Record<string, { type: string }>>) {
  const app = Fastify();
  const deps: FriendRouteDependencies = {
    authenticate: async (request: FastifyRequest) => {
      const accountId = request.headers['x-account'];
      return typeof accountId === 'string' ? { accountId } : null;
    },
    ownsCharacter: async (accountId, characterId) => accountId === 'acc-me' && characterId === 'me',
    getCharacterByName: async () => null,
    addFriend: async (characterId, friendCharacterId) => ({
      id: 'f-1', characterId, friendCharacterId, createdAt: new Date(0),
    }),
    listFriends: async () => FRIENDS.map((id) => ({
      characterId: id, name: id, vocation: null, level: 10, createdAt: new Date(0),
    })),
    removeFriend: async () => true,
    locateSession: async (characterId) => locations[characterId] ?? null,
  };
  registerFriendRoutes(app, deps);
  return app;
}

describe('onde cada amigo está (#403, #839)', () => {
  it('a Cidade é `city`, o MUNDO é `world`, a instância é `hunt` e quem não tem sessão é offline', async () => {
    const app = build({
      city: { type: 'city' }, world: { type: 'world' }, hunt: { type: 'hunt' }, training: { type: 'training' },
    });

    const response = await app.inject({
      method: 'GET', url: '/api/friends?characterId=me', headers: { 'x-account': 'acc-me' },
    });

    expect(response.statusCode).toBe(200);
    const byId = new Map((response.json() as Array<{ characterId: string }>).map((entry) => [entry.characterId, entry]));
    // Mutação que mata: manter o colapso antigo (`city` → `city`, o resto → `hunt`) — o amigo no mundo
    // apareceria "em caçada", e o jogador iria procurá-lo numa hunt idle que ele não está.
    expect(byId.get('city')).toMatchObject({ online: true, where: 'city' });
    expect(byId.get('world')).toMatchObject({ online: true, where: 'world' });
    expect(byId.get('hunt')).toMatchObject({ online: true, where: 'hunt' });
    // O treino é uma instância: continua colapsando em `hunt`, como sempre (o mínimo do §21).
    expect(byId.get('training')).toMatchObject({ online: true, where: 'hunt' });
    expect(byId.get('offline')).toMatchObject({ online: false, where: null });
  });
});
