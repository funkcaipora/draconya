import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerFriendRoutes } from './friends.js';
import type { FriendRouteDependencies } from './friends.js';
import { DrizzleGameRepository } from '../db/repository.js';
import { SessionDirectory } from '../directory.js';
import { accounts, characters } from '../db/schema.js';
import { connectTestDatabase, type TestDatabase } from '../testing/database.js';
import { connectTestRedis } from '../testing/redis.js';

// Amigos (§21, ADR 0031 decisão 6): adicionar por nome, listar com online/onde, remover. O
// banco é Postgres de verdade (a tabela `friend` é o que está em teste) e o diretório é de
// verdade (Redis db 18) — é ele que responde "onde este amigo está agora".
//
// Os sete cenários são os da issue: adiciona por nome; lista um em hunt, um em city e um
// offline; remove; recusa duplicado; recusa a si mesmo; recusa nome inexistente; remover quem
// não é amigo devolve `{ ok: false }`.

const databaseAvailable = process.env['DATABASE_TEST_URL'] !== undefined;

const { redis, available } = await connectTestRedis(0);

afterAll(async () => {
  if (available) await redis.quit();
});

describe.runIf(databaseAvailable && available)('as rotas de Amigos (#403)', () => {
  let testDatabase: TestDatabase;
  let repository: DrizzleGameRepository;
  let directory: SessionDirectory;

  beforeAll(async () => {
    testDatabase = await connectTestDatabase();
    repository = new DrizzleGameRepository(testDatabase.database.db);
    directory = new SessionDirectory(redis);
  });

  beforeEach(async () => {
    await testDatabase.database.db.execute(sql`truncate table ${accounts} cascade`);
    await redis.flushdb();
  });

  afterAll(async () => {
    await testDatabase.cleanup();
  });

  async function seed(externalAuthId: string, name: string) {
    const account = await repository.ensureAccount({
      externalAuthId, email: `${externalAuthId}@example.com`,
    });
    const character = await repository.createCharacter(account.id, name);
    return { account, character };
  }

  function build() {
    const app = Fastify();
    const deps: FriendRouteDependencies = {
      // A conta vem do header, para o teste falar por qualquer um dos personagens.
      authenticate: async (request: FastifyRequest) => {
        const accountId = request.headers['x-account'];
        return typeof accountId === 'string' ? { accountId } : null;
      },
      ownsCharacter: repository.ownsCharacter.bind(repository),
      getCharacterByName: repository.getCharacterByName.bind(repository),
      addFriend: repository.addFriend.bind(repository),
      listFriends: repository.listFriends.bind(repository),
      removeFriend: repository.removeFriend.bind(repository),
      locateSession: (characterId) => directory.lookup(characterId),
    };
    registerFriendRoutes(app, deps);
    return app;
  }

  it('adiciona um amigo pelo nome', async () => {
    const me = await seed('acc-me', 'Me');
    const target = await seed('acc-target', 'Alvo');
    const app = build();

    const response = await app.inject({
      method: 'POST', url: '/api/friends',
      // Minúsculas de propósito: a busca usa a normalização do índice único (DT-04).
      payload: { characterId: me.character.id, name: 'alvo' },
      headers: { 'x-account': me.account.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect((await repository.listFriends(me.character.id)).map((f) => f.characterId))
      .toEqual([target.character.id]);
  });

  it('lista com um amigo em hunt, um em city e um offline', async () => {
    const me = await seed('acc-me', 'Me');
    const hunting = await seed('acc-hunt', 'Hunter');
    const resting = await seed('acc-city', 'Citizen');
    const offline = await seed('acc-off', 'Ghost');
    const app = build();

    await testDatabase.database.db
      .update(characters)
      .set({ vocation: 'knight', level: 42 })
      .where(eq(characters.id, hunting.character.id));
    await directory.register(hunting.character.id, { sessionId: 's-hunt', nodeId: 'n1', type: 'hunt' });
    await directory.register(resting.character.id, { sessionId: 's-city', nodeId: 'n1', type: 'city' });

    for (const target of [hunting, resting, offline]) {
      const added = await app.inject({
        method: 'POST', url: '/api/friends',
        payload: { characterId: me.character.id, name: target.character.name },
        headers: { 'x-account': me.account.id },
      });
      expect(added.statusCode).toBe(200);
    }

    const response = await app.inject({
      method: 'GET', url: `/api/friends?characterId=${me.character.id}`,
      headers: { 'x-account': me.account.id },
    });

    expect(response.statusCode).toBe(200);
    const byId = new Map((response.json() as Array<{ characterId: string }>)
      .map((entry) => [entry.characterId, entry]));
    expect(byId.get(hunting.character.id)).toMatchObject({
      name: 'Hunter', vocationId: 'knight', level: 42, online: true, where: 'hunt',
    });
    expect(byId.get(resting.character.id)).toMatchObject({
      name: 'Citizen', vocationId: null, level: 1, online: true, where: 'city',
    });
    expect(byId.get(offline.character.id)).toMatchObject({
      name: 'Ghost', online: false, where: null,
    });
  });

  it('remove um amigo', async () => {
    const me = await seed('acc-me', 'Me');
    const target = await seed('acc-target', 'Alvo');
    await repository.addFriend(me.character.id, target.character.id);
    const app = build();

    const response = await app.inject({
      method: 'DELETE', url: `/api/friends/${target.character.id}`,
      payload: { characterId: me.character.id },
      headers: { 'x-account': me.account.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(await repository.listFriends(me.character.id)).toEqual([]);
  });

  it('remover quem não é amigo é idempotente, não é erro', async () => {
    const me = await seed('acc-me', 'Me');
    const stranger = await seed('acc-stranger', 'Estranho');
    const app = build();

    const response = await app.inject({
      method: 'DELETE', url: `/api/friends/${stranger.character.id}`,
      payload: { characterId: me.character.id },
      headers: { 'x-account': me.account.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: false });
  });

  it('recusa um amigo duplicado com 409 already-friends', async () => {
    const me = await seed('acc-me', 'Me');
    const target = await seed('acc-target', 'Alvo');
    await repository.addFriend(me.character.id, target.character.id);
    const app = build();

    const response = await app.inject({
      method: 'POST', url: '/api/friends',
      payload: { characterId: me.character.id, name: target.character.name },
      headers: { 'x-account': me.account.id },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'already-friends' });
  });

  it('recusa adicionar a si mesmo com 409 cannot-friend-self', async () => {
    const me = await seed('acc-me', 'Me');
    const app = build();

    const response = await app.inject({
      method: 'POST', url: '/api/friends',
      payload: { characterId: me.character.id, name: me.character.name },
      headers: { 'x-account': me.account.id },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'cannot-friend-self' });
  });

  it('recusa um nome inexistente com 404 character-not-found', async () => {
    const me = await seed('acc-me', 'Me');
    const app = build();

    const response = await app.inject({
      method: 'POST', url: '/api/friends',
      payload: { characterId: me.character.id, name: 'Fantasma' },
      headers: { 'x-account': me.account.id },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'character-not-found' });
  });
});
