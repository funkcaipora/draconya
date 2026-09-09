import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AuthService, SESSION_COOKIE } from '../auth/service.js';
import type { AuthSession, AuthSessionStore } from '../auth/sessions.js';
import {
  CharacterNameTakenError,
  type AccountRecord,
  type CharacterRecord,
  type GameRepository,
} from '../db/repository.js';
import { registerCharacterRoutes } from './characters.js';

class MemorySessions implements AuthSessionStore {
  readonly data = new Map<string, AuthSession>();
  async create(session: AuthSession) { this.data.set('token', session); return 'token'; }
  async get(token: string) { return this.data.get(token) ?? null; }
  async delete(token: string) { this.data.delete(token); }
}

class MemoryRepository implements GameRepository {
  readonly characters = new Map<string, CharacterRecord>();
  next = 0;
  async ensureAccount(identity: { externalAuthId: string; email: string }): Promise<AccountRecord> {
    return { id: 'a1', email: identity.email, externalAuthId: identity.externalAuthId, coins: 0 };
  }
  async createCharacter(accountId: string, name: string): Promise<CharacterRecord> {
    if ([...this.characters.values()].some((character) => character.name.toLowerCase() === name.toLowerCase())) {
      throw new CharacterNameTakenError();
    }
    const now = new Date('2026-09-07T12:00:00Z');
    const character: CharacterRecord = {
      id: `c${++this.next}`, accountId, name, vocation: null, level: 1, xp: 0, gold: 0,
      capacity: 400, premiumUntil: null, staminaMs: 86_400_000, staminaUpdatedAt: now,
      state: 'city', sessionId: null, createdAt: now,
    };
    this.characters.set(character.id, character);
    return character;
  }
  async listCharacters(accountId: string) {
    return [...this.characters.values()].filter((character) => character.accountId === accountId);
  }
  async getCharacter(accountId: string, characterId: string) {
    const character = this.characters.get(characterId);
    return character?.accountId === accountId ? character : null;
  }
  async ownsCharacter(accountId: string, characterId: string) {
    return (await this.getCharacter(accountId, characterId)) !== null;
  }
  async withOwnedCharacter<T>(
    accountId: string,
    characterId: string,
    operation: (character: CharacterRecord) => Promise<T>,
  ) {
    const character = await this.getCharacter(accountId, characterId);
    return character === null ? null : operation(character);
  }
  async softDeleteCharacter(
    accountId: string,
    characterId: string,
    isCharacterActive?: (accountId: string, characterId: string) => Promise<boolean>,
  ) {
    if (!(await this.ownsCharacter(accountId, characterId))) return 'not-found' as const;
    if (isCharacterActive !== undefined && await isCharacterActive(accountId, characterId)) {
      return 'active' as const;
    }
    this.characters.delete(characterId);
    return 'deleted' as const;
  }
}

async function build() {
  const repository = new MemoryRepository();
  const sessions = new MemorySessions();
  const auth = new AuthService({ repository, sessions, devMode: true });
  await auth.devLogin('hero@example.com');
  const app = Fastify();
  registerCharacterRoutes(app, auth, repository);
  return { app, repository, cookie: `${SESSION_COOKIE}=token` };
}

describe('character routes', () => {
  it('creates, lists, selects and soft-deletes a character', async () => {
    const { app, cookie } = await build();
    const created = await app.inject({
      method: 'POST', url: '/api/characters', headers: { cookie }, payload: { name: 'Sir Dragon' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json()).toMatchObject({ name: 'Sir Dragon', vocation: null, level: 1 });

    const list = await app.inject({ method: 'GET', url: '/api/characters', headers: { cookie } });
    expect(list.json().characters).toHaveLength(1);

    const selected = await app.inject({
      method: 'POST', url: `/api/characters/${id}/select`, headers: { cookie },
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json().id).toBe(id);

    expect((await app.inject({
      method: 'DELETE', url: `/api/characters/${id}`, headers: { cookie },
    })).statusCode).toBe(204);
    expect((await app.inject({
      method: 'POST', url: `/api/characters/${id}/select`, headers: { cookie },
    })).statusCode).toBe(404);
  });

  it('normalizes names and rejects a case-insensitive duplicate', async () => {
    const { app, cookie } = await build();
    const first = await app.inject({
      method: 'POST', url: '/api/characters', headers: { cookie }, payload: { name: '  Sir   Dragon  ' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().name).toBe('Sir Dragon');

    const duplicate = await app.inject({
      method: 'POST', url: '/api/characters', headers: { cookie }, payload: { name: 'sir dragon' },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('validates length after normalization and rejects control whitespace', async () => {
    const { app, cookie } = await build();
    for (const name of [' A ', 'Sir\tDragon', 'Sir\nDragon']) {
      const response = await app.inject({
        method: 'POST', url: '/api/characters', headers: { cookie }, payload: { name },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid-name' });
    }
  });

  it('normalizes canonically equivalent Unicode names before persistence', async () => {
    const { app, cookie } = await build();
    const decomposed = await app.inject({
      method: 'POST', url: '/api/characters', headers: { cookie }, payload: { name: 'Jose\u0301' },
    });
    expect(decomposed.statusCode).toBe(201);
    expect(decomposed.json().name).toBe('José');

    const composed = await app.inject({
      method: 'POST', url: '/api/characters', headers: { cookie }, payload: { name: 'JOSÉ' },
    });
    expect(composed.statusCode).toBe(409);
  });


  it('passes the active reservation check into the protected delete operation', async () => {
    const repository = new MemoryRepository();
    const sessions = new MemorySessions();
    const auth = new AuthService({ repository, sessions, devMode: true });
    await auth.devLogin('hero@example.com');
    const created = await repository.createCharacter('a1', 'Busy Hero');
    const app = Fastify();
    registerCharacterRoutes(
      app,
      auth,
      repository,
      async (_accountId, characterId) => characterId === created.id,
    );

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/characters/${created.id}`,
      headers: { cookie: `${SESSION_COOKIE}=token` },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'character-active' });
  });

  it('o estado vem do DIRETÓRIO, não da coluna que ninguém escreve (FUN-30)', async () => {
    // A coluna `state` existe e não é escrita por ninguém: a verdade sobre em que atividade o
    // personagem está é a sessão, e a sessão vive no Redis. Lendo a coluna, a API respondia
    // "city" para quem estava numa hunt havia seis horas.
    const repository = new MemoryRepository();
    const sessions = new MemorySessions();
    const auth = new AuthService({ repository, sessions, devMode: true });
    await auth.devLogin('hero@example.com');
    const created = await repository.createCharacter('a1', 'Hunting Hero');
    const app = Fastify();
    registerCharacterRoutes(
      app, auth, repository, undefined,
      async () => ({ sessionId: 's-hunt', type: 'hunt' }),
    );

    const response = await app.inject({
      method: 'GET', url: '/api/characters', headers: { cookie: `${SESSION_COOKIE}=token` },
    });

    const [character] = response.json().characters as Array<{ state: string; sessionId: string }>;
    expect(character?.state).toBe('hunt');
    expect(character?.sessionId).toBe('s-hunt');
    expect(created.state).toBe('city');
  });

  it('sem sessão no diretório, o estado cai para o da linha', async () => {
    // Personagem que não está conectado. A coluna diz `city`, e é o que ele é.
    const { app } = await build();
    const response = await app.inject({
      method: 'POST', url: '/api/characters',
      headers: { cookie: `${SESSION_COOKIE}=token` },
      payload: { name: 'Resting Hero' },
    });
    expect(response.json().state).toBe('city');
  });

  it('requires authentication', async () => {
    const { app } = await build();
    expect((await app.inject({ method: 'GET', url: '/api/characters' })).statusCode).toBe(401);
  });
});
