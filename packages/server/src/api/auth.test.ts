import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../auth/service.js';
import type { AuthSession, AuthSessionStore } from '../auth/sessions.js';
import type { ExternalIdentity, IdentityProvider } from '../auth/workos.js';
import type {
  AccountRecord,
  CharacterRecord,
  GameRepository,
  ItemInstanceRecord,
} from '../db/repository.js';
import { loadConfiguration } from '../config.js';
import { registerAuthRoutes } from './auth.js';

const configuration = loadConfiguration({
  DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
  API_ORIGIN: 'http://localhost:5173',
  AUTH_SESSION_TTL_SECONDS: '43200',
  NODE_ENV: 'test',
});

class MemorySessions implements AuthSessionStore {
  readonly data = new Map<string, AuthSession>();
  readonly states = new Set<string>();
  next = 0;
  async create(session: AuthSession, replacedToken?: string) {
    const token = `s${++this.next}`;
    this.data.set(token, session);
    if (replacedToken !== undefined) this.data.delete(replacedToken);
    return token;
  }
  async get(token: string) { return this.data.get(token) ?? null; }
  async delete(token: string) { this.data.delete(token); }
  async saveAuthorizationState(state: string) { this.states.add(state); }
  async consumeAuthorizationState(state: string) { return this.states.delete(state); }
}

class MemoryRepository implements GameRepository {
  readonly accounts = new Map<string, AccountRecord>();
  async createItemInstance(instance: {
    itemId: string; ownerCharacterId: string; origin: string; quantity?: number;
  }): Promise<ItemInstanceRecord> {
    // Item não passa por este arquivo. Um `throw` seria pior que um valor: ele transformaria
    // um método nunca chamado numa falha em teste de outra coisa.
    return {
      id: 'i1', itemId: instance.itemId, ownerCharacterId: instance.ownerCharacterId,
      quantity: instance.quantity ?? 1, origin: instance.origin, createdAt: new Date(0),
    };
  }
  async listItemInstances(): Promise<readonly ItemInstanceRecord[]> {
    return [];
  }
  async saveBotConfig(): Promise<void> {
    // Este arquivo é sobre autenticação. A configuração do bot não passa por aqui.
  }
  async ensureAccount(identity: { externalAuthId: string; email: string }) {
    const existing = [...this.accounts.values()].find(
      (account) => account.externalAuthId === identity.externalAuthId,
    );
    if (existing !== undefined) return existing;
    const account = {
      id: `a${this.accounts.size + 1}`,
      email: identity.email.toLowerCase(),
      externalAuthId: identity.externalAuthId,
      coins: 0,
    };
    this.accounts.set(account.id, account);
    return account;
  }
  async createCharacter(): Promise<CharacterRecord> { throw new Error('not used'); }
  async listCharacters(): Promise<readonly CharacterRecord[]> { return []; }
  async getCharacter(): Promise<CharacterRecord | null> { return null; }
  async ownsCharacter(): Promise<boolean> { return false; }
  async withOwnedCharacter<T>(): Promise<T | null> { return null; }
  async softDeleteCharacter() { return 'not-found' as const; }
}

class FakeProvider implements IdentityProvider {
  exchangedCodes: string[] = [];
  authorizationUrl(state: string, screen: 'sign-in' | 'sign-up') {
    return `https://auth.example/${screen}?state=${state}`;
  }
  async exchangeCode(code: string): Promise<ExternalIdentity> {
    this.exchangedCodes.push(code);
    if (code !== 'ok') throw new Error('bad code');
    return { externalAuthId: 'user_1', email: 'hero@example.com', workosSessionId: 'session_1' };
  }
  logoutUrl(workosSessionId: string, returnTo: string) {
    return `https://auth.example/logout?sid=${workosSessionId}&returnTo=${encodeURIComponent(returnTo)}`;
  }
}

function cookies(setCookie: string | string[] | undefined): string[] {
  if (setCookie === undefined) throw new Error('missing cookie');
  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

function cookiePair(setCookie: string | string[] | undefined, name: string): string {
  const found = cookies(setCookie).find((cookie) => cookie.startsWith(`${name}=`));
  if (found === undefined) throw new Error(`missing ${name} cookie`);
  return found.split(';')[0]!;
}

describe('auth routes', () => {
  it('logs in with any valid email in dev mode and authenticates by httpOnly cookie', async () => {
    const sessions = new MemorySessions();
    const auth = new AuthService({
      repository: new MemoryRepository(), sessions, devMode: true,
    });
    const app = Fastify();
    registerAuthRoutes(app, configuration, auth);

    const login = await app.inject({
      method: 'POST', url: '/api/auth/dev-login', payload: { email: 'Hero@Example.com' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toContain('HttpOnly');

    const cookie = cookiePair(login.headers['set-cookie'], 'draconya_session');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: 'hero@example.com' });

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode)
      .toBe(401);
    expect(logout.headers['set-cookie']).toContain('Max-Age=0');
  });

  it('rotates and invalidates the previous session token after login', async () => {
    const sessions = new MemorySessions();
    const auth = new AuthService({
      repository: new MemoryRepository(), sessions, devMode: true,
    });
    const app = Fastify();
    registerAuthRoutes(app, configuration, auth);

    const first = await app.inject({
      method: 'POST', url: '/api/auth/dev-login', payload: { email: 'hero@example.com' },
    });
    const oldCookie = cookiePair(first.headers['set-cookie'], 'draconya_session');
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      headers: { cookie: oldCookie },
      payload: { email: 'hero@example.com' },
    });
    const newCookie = cookiePair(second.headers['set-cookie'], 'draconya_session');

    expect(newCookie).not.toBe(oldCookie);
    expect((await app.inject({
      method: 'GET', url: '/api/auth/me', headers: { cookie: oldCookie },
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'GET', url: '/api/auth/me', headers: { cookie: newCookie },
    })).statusCode).toBe(200);
  });

  it('uses state on the hosted redirect callback before creating a session', async () => {
    const sessions = new MemorySessions();
    const provider = new FakeProvider();
    const auth = new AuthService({
      repository: new MemoryRepository(), sessions, authorizationStates: sessions,
      provider, devMode: false,
    });
    const app = Fastify();
    registerAuthRoutes(app, configuration, auth);

    const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toContain('https://auth.example/sign-in');
    expect(login.headers['set-cookie']).toContain('Path=/api/auth/callback');
    const stateCookie = cookiePair(login.headers['set-cookie'], 'draconya_auth_state');
    const state = decodeURIComponent(stateCookie.split('=')[1]!);

    const callback = await app.inject({
      method: 'GET', url: `/api/auth/callback?code=ok&state=${encodeURIComponent(state)}`,
      headers: { cookie: stateCookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(configuration.API_ORIGIN);
    expect(callback.headers['set-cookie']).toHaveLength(2);
    expect(cookies(callback.headers['set-cookie'])).toEqual(expect.arrayContaining([
      expect.stringContaining('draconya_auth_state=; Path=/api/auth/callback; Max-Age=0'),
      expect.stringContaining('draconya_session=s1; Path=/; Max-Age=43200; HttpOnly'),
    ]));

    const replay = await app.inject({
      method: 'GET', url: `/api/auth/callback?code=ok&state=${encodeURIComponent(state)}`,
      headers: { cookie: stateCookie },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toEqual({ error: 'invalid-state' });
    expect(provider.exchangedCodes).toEqual(['ok']);

    const sessionCookie = cookiePair(callback.headers['set-cookie'], 'draconya_session');
    const logout = await app.inject({
      method: 'POST', url: '/api/auth/logout', headers: { cookie: sessionCookie },
    });
    expect(logout.json().redirectTo).toBe(
      'https://auth.example/logout?sid=session_1&returnTo=http%3A%2F%2Flocalhost%3A5173',
    );
  });

  it('sets production cookies securely and uses only the configured callback destination', async () => {
    const sessions = new MemorySessions();
    const production = loadConfiguration({
      DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost',
      NODE_ENV: 'production', API_ORIGIN: 'https://play.example',
      WORKOS_API_KEY: 'test-key', WORKOS_CLIENT_ID: 'test-client',
      WORKOS_REDIRECT_URI: 'https://api.example/api/auth/callback',
    });
    const app = Fastify();
    registerAuthRoutes(app, production, new AuthService({
      repository: new MemoryRepository(), sessions, authorizationStates: sessions,
      provider: new FakeProvider(), devMode: false,
    }));
    const login = await app.inject({ url: '/api/auth/login?returnTo=https://evil.example' });
    expect(login.headers['set-cookie']).toContain('HttpOnly; Secure; SameSite=Lax');
    const stateCookie = cookiePair(login.headers['set-cookie'], 'draconya_auth_state');
    const state = stateCookie.split('=')[1]!;
    const callback = await app.inject({
      url: `/api/auth/callback?code=ok&state=${state}`, headers: { cookie: stateCookie },
    });
    expect(callback.headers.location).toBe('https://play.example');
    expect(cookies(callback.headers['set-cookie']).every((cookie) => cookie.includes('Secure'))).toBe(true);
    await app.close();
  });

  it('rejects a callback with the wrong state', async () => {
    const sessions = new MemorySessions();
    const auth = new AuthService({
      repository: new MemoryRepository(), sessions, authorizationStates: sessions,
      provider: new FakeProvider(), devMode: false,
    });
    const app = Fastify();
    registerAuthRoutes(app, configuration, auth);
    const expectedState = 'a'.repeat(32);
    const returnedState = 'b'.repeat(32);
    await sessions.saveAuthorizationState(expectedState);
    const response = await app.inject({
      method: 'GET', url: `/api/auth/callback?code=ok&state=${returnedState}`,
      headers: { cookie: `draconya_auth_state=${expectedState}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
  });

  it('consumes state and handles a provider callback error without exchanging a code', async () => {
    const sessions = new MemorySessions();
    const provider = new FakeProvider();
    const auth = new AuthService({
      repository: new MemoryRepository(), sessions, authorizationStates: sessions,
      provider, devMode: false,
    });
    const app = Fastify();
    registerAuthRoutes(app, configuration, auth);
    const login = await app.inject({ method: 'GET', url: '/api/auth/register' });
    const stateCookie = cookiePair(login.headers['set-cookie'], 'draconya_auth_state');
    const state = decodeURIComponent(stateCookie.split('=')[1]!);

    const response = await app.inject({
      method: 'GET',
      url: `/api/auth/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      headers: { cookie: stateCookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'authentication-failed' });
    expect(provider.exchangedCodes).toEqual([]);
    expect(sessions.states.has(state)).toBe(false);
  });

  it('hides hosted and development routes when their mode is unavailable', async () => {
    const repository = new MemoryRepository();
    const sessions = new MemorySessions();
    const hostedApp = Fastify();
    registerAuthRoutes(hostedApp, configuration, new AuthService({
      repository, sessions, provider: new FakeProvider(), devMode: false,
    }));
    expect((await hostedApp.inject({
      method: 'POST', url: '/api/auth/dev-login', payload: { email: 'hero@example.com' },
    })).statusCode).toBe(404);

    const unconfiguredApp = Fastify();
    registerAuthRoutes(unconfiguredApp, configuration, new AuthService({
      repository, sessions, devMode: false,
    }));
    expect((await unconfiguredApp.inject({ method: 'GET', url: '/api/auth/login' })).statusCode)
      .toBe(503);
  });
});
