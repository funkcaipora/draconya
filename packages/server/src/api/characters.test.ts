import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AuthService, SESSION_COOKIE } from '../auth/service.js';
import type { AuthSession, AuthSessionStore } from '../auth/sessions.js';
import {
  CharacterNameTakenError,
  type AccountRecord,
  type CharacterRecord,
  type GameRepository,
  type ItemInstanceRecord,
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
  async applyEquipment(): Promise<void> {
    // Equipamento não passa por este arquivo.
  }
  async createItemInstance(instance: {
    itemId: string; ownerCharacterId: string; origin: string; quantity?: number;
  }): Promise<ItemInstanceRecord> {
    // Item não passa por este arquivo. Um `throw` seria pior que um valor: ele transformaria
    // um método nunca chamado numa falha em teste de outra coisa.
    return {
      id: 'i1', itemId: instance.itemId, ownerCharacterId: instance.ownerCharacterId,
      quantity: instance.quantity ?? 1, origin: instance.origin, equippedSlot: null,
      createdAt: new Date(0),
    };
  }
  async listItemInstances(): Promise<readonly ItemInstanceRecord[]> {
    return [];
  }
  async saveBotConfig(characterId: string, config: unknown): Promise<void> {
    const character = this.characters.get(characterId);
    if (character !== undefined) this.characters.set(characterId, { ...character, botConfig: config });
  }
  async ensureAccount(identity: { externalAuthId: string; email: string }): Promise<AccountRecord> {
    return { id: 'a1', email: identity.email, externalAuthId: identity.externalAuthId, coins: 0 };
  }
  async createCharacter(
    accountId: string, name: string, initial: { readonly botConfig?: unknown } = {},
  ): Promise<CharacterRecord> {
    if ([...this.characters.values()].some((character) => character.name.toLowerCase() === name.toLowerCase())) {
      throw new CharacterNameTakenError();
    }
    const now = new Date('2026-09-07T12:00:00Z');
    const character: CharacterRecord = {
      id: `c${++this.next}`, accountId, name, vocation: null, level: 1, xp: 0, gold: 0,
      capacity: 400, premiumUntil: null, staminaMs: 86_400_000, staminaUpdatedAt: now,
      state: 'city', sessionId: null, botConfig: initial.botConfig ?? null, skills: {},
      outfitColors: null, bestiary: null, ammo: null,
      createdAt: now,
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

  it('nasce com o bot padrão do conteúdo, e sem padrão nasce sem bot (FUN-114)', async () => {
    // O MVP é "magia + poção funcionando" na primeira hunt, sem abrir a tela do bot. O `api`
    // não conhece o vocabulário: o que recebe do conteúdo, grava. Mutação que mata: não passar
    // `botConfig` ao repositório.
    const repository = new MemoryRepository();
    const sessions = new MemorySessions();
    const auth = new AuthService({ repository, sessions, devMode: true });
    await auth.devLogin('hero@example.com');
    const app = Fastify();
    const defaultBotConfig = { version: 1, heal: [{ when: { kind: 'hp', op: '<=', percent: 70 }, do: { kind: 'spell', spellId: 'heal' } }] };
    registerCharacterRoutes(app, auth, repository, { defaultBotConfig });
    const cookie = `${SESSION_COOKIE}=token`;

    const created = await app.inject({
      method: 'POST', url: '/api/characters', headers: { cookie }, payload: { name: 'Novato' },
    });
    expect(created.statusCode).toBe(201);
    expect(repository.characters.get(created.json().id as string)?.botConfig).toEqual(defaultBotConfig);

    const { app: bare, cookie: bareCookie, repository: bareRepository } = await build();
    const bareCreated = await bare.inject({
      method: 'POST', url: '/api/characters', headers: { cookie: bareCookie }, payload: { name: 'Sem Bot' },
    });
    expect(bareRepository.characters.get(bareCreated.json().id as string)?.botConfig).toBeNull();
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
    registerCharacterRoutes(app, auth, repository, {
      isCharacterActive: async (_accountId, characterId) => characterId === created.id,
    });

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
    registerCharacterRoutes(app, auth, repository, {
      locateSession: async () => ({ sessionId: 's-hunt', type: 'hunt' }),
    });

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

describe('a tela de seleção liquida antes de ler (FUN-66)', () => {
  /** Um app com liquidação injetada, e um contador de quantas vezes a listagem foi ao repositório. */
  async function withSettlement(
    settleProgress: (characterId: string) => Promise<{ written: number; failed: number }>,
  ) {
    const repository = new MemoryRepository();
    const sessions = new MemorySessions();
    const auth = new AuthService({ repository, sessions, devMode: true });
    await auth.devLogin('hero@example.com');
    const created = await repository.createCharacter('a1', 'Late Hero');
    const listings = { count: 0 };
    const original = repository.listCharacters.bind(repository);
    repository.listCharacters = async (accountId: string) => {
      listings.count += 1;
      return original(accountId);
    };
    const app = Fastify();
    registerCharacterRoutes(app, auth, repository, { settleProgress });
    const cookie = `${SESSION_COOKIE}=token`;
    return { app, repository, created, listings, cookie };
  }

  it('sem nada pendente, faz UMA listagem só', async () => {
    // O caso comum, e é sempre. Reler incondicionalmente duplicaria a consulta.
    const { app, listings, cookie } = await withSettlement(async () => ({ written: 0, failed: 0 }));
    const response = await app.inject({ method: 'GET', url: '/api/characters', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(listings.count).toBe(1);
  });

  it('com extrato escrito, relê e mostra o progresso JÁ somado', async () => {
    // A regressão exata desta issue: a tela onde o jogador cai depois de sair de uma hunt
    // mostrava o level e a XP de antes, e o personagem aparecia certo só dentro do jogo.
    const { app, repository, created, listings, cookie } = await withSettlement(async (id) => {
      const character = repository.characters.get(id);
      if (character !== undefined) Object.assign(character, { xp: character.xp + 900, level: 4 });
      return { written: 1, failed: 0 };
    });
    const response = await app.inject({ method: 'GET', url: '/api/characters', headers: { cookie } });
    const [dto] = response.json().characters as Array<{ id: string; xp: number; level: number }>;
    expect(dto).toMatchObject({ id: created.id, xp: 900, level: 4 });
    expect(listings.count).toBe(2);
  });

  it('select também liquida, antes de ler', async () => {
    const { app, repository, created, cookie } = await withSettlement(async (id) => {
      const character = repository.characters.get(id);
      if (character !== undefined) Object.assign(character, { gold: 40 });
      return { written: 1, failed: 0 };
    });
    const response = await app.inject({
      method: 'POST', url: `/api/characters/${created.id}/select`, headers: { cookie },
    });
    expect(response.json()).toMatchObject({ id: created.id, gold: 40 });
  });

  it('NÃO liquida o personagem de outra conta (ADR 0024)', async () => {
    // Mesma fresta que o ADR 0024 fechou em `POST /api/tickets`, e ela existia aqui também:
    // `select` liquidava o id do path ANTES de conferir posse. O que o atacante ganhava não
    // era valor — era disparar escrita no ledger e na linha de um personagem alheio.
    const settled: string[] = [];
    const { app, repository, cookie } = await withSettlement(async (id) => {
      settled.push(id);
      return { written: 1, failed: 0 };
    });
    // Um personagem de OUTRA conta, e o atacante entra com a sessão da conta 'a1'.
    const alheio = await repository.createCharacter('a2', 'Alheio');

    const response = await app.inject({
      method: 'POST', url: `/api/characters/${alheio.id}/select`, headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
    expect(settled).toEqual([]);
  });

  it('sem nada pendente, o select faz UMA leitura só', async () => {
    // A correção de posse não pode custar uma consulta a mais no caso comum: só relê quando a
    // liquidação escreveu de fato. Sem este teste, "conferir antes" viraria "ler duas vezes".
    const { app, repository, created, cookie } = await withSettlement(
      async () => ({ written: 0, failed: 0 }),
    );
    let reads = 0;
    const original = repository.getCharacter.bind(repository);
    repository.getCharacter = async (accountId: string, characterId: string) => {
      reads += 1;
      return original(accountId, characterId);
    };

    const response = await app.inject({
      method: 'POST', url: `/api/characters/${created.id}/select`, headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(reads).toBe(1);
  });

  it('liquidação que lança NÃO derruba a resposta: sai o valor atrasado, e o erro vai ao log', async () => {
    // Ao contrário do ticket (FUN-56), que recusa com 503. A tela de personagens é como se
    // chega a qualquer lugar; 503 nela trancaria a conta inteira por uma falha de ledger, e o
    // valor aqui só é exibido.
    const { app, created, cookie } = await withSettlement(async () => {
      throw new Error('ledger indisponível');
    });
    const listed = await app.inject({ method: 'GET', url: '/api/characters', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().characters).toHaveLength(1);
    const selected = await app.inject({
      method: 'POST', url: `/api/characters/${created.id}/select`, headers: { cookie },
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toMatchObject({ id: created.id, xp: 0 });
  });
});
