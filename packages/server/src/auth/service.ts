import { randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { GameRepository } from '../db/repository.js';
import { readCookie } from './cookies.js';
import type {
  AuthSession,
  AuthSessionStore,
  AuthorizationStateStore,
} from './sessions.js';
import type { IdentityProvider } from './workos.js';

export const SESSION_COOKIE = 'draconya_session';
export const STATE_COOKIE = 'draconya_auth_state';
export const AUTHORIZATION_STATE_TTL_SECONDS = 600;

export interface Principal {
  readonly accountId: string;
  readonly email: string;
}

export interface AuthServiceOptions {
  readonly repository: GameRepository;
  readonly sessions: AuthSessionStore;
  readonly authorizationStates?: AuthorizationStateStore;
  readonly provider?: IdentityProvider;
  readonly devMode: boolean;
}

export class AuthService {
  readonly #repository: GameRepository;
  readonly #sessions: AuthSessionStore;
  readonly #authorizationStates: AuthorizationStateStore | undefined;
  readonly #provider: IdentityProvider | undefined;
  readonly #devMode: boolean;

  constructor(options: AuthServiceOptions) {
    this.#repository = options.repository;
    this.#sessions = options.sessions;
    this.#authorizationStates = options.authorizationStates;
    this.#provider = options.provider;
    this.#devMode = options.devMode;
  }

  get devMode(): boolean {
    return this.#devMode;
  }

  get hostedConfigured(): boolean {
    return this.#provider !== undefined;
  }

  async createAuthorization(screen: 'sign-in' | 'sign-up'): Promise<{
    readonly state: string;
    readonly url: string;
  }> {
    if (this.#provider === undefined) throw new Error('identity provider not configured');
    const stateStore = this.#authorizationStateStore();
    const state = randomBytes(24).toString('base64url');
    await stateStore.saveAuthorizationState(state, AUTHORIZATION_STATE_TTL_SECONDS);
    return { state, url: this.#provider.authorizationUrl(state, screen) };
  }

  async consumeAuthorizationState(state: string): Promise<boolean> {
    return this.#authorizationStateStore().consumeAuthorizationState(state);
  }

  async completeHostedLogin(
    code: string,
    request: { ip?: string; userAgent?: string },
    replacedToken?: string,
  ): Promise<{ token: string; session: AuthSession }> {
    if (this.#provider === undefined) throw new Error('identity provider not configured');
    const identity = await this.#provider.exchangeCode(code, request);
    const account = await this.#repository.ensureAccount(identity);
    const session: AuthSession = {
      accountId: account.id,
      externalAuthId: identity.externalAuthId,
      email: account.email,
      workosSessionId: identity.workosSessionId,
    };
    return { token: await this.#sessions.create(session, replacedToken), session };
  }

  async devLogin(email: string, replacedToken?: string): Promise<{ token: string; session: AuthSession }> {
    if (!this.#devMode) throw new Error('development authentication is disabled');
    const normalizedEmail = email.trim().toLowerCase();
    const externalAuthId = `dev:${normalizedEmail}`;
    const account = await this.#repository.ensureAccount({ externalAuthId, email: normalizedEmail });
    const session: AuthSession = {
      accountId: account.id,
      externalAuthId,
      email: account.email,
    };
    return { token: await this.#sessions.create(session, replacedToken), session };
  }

  async authenticate(request: FastifyRequest): Promise<Principal | null> {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token === null) return null;
    const session = await this.#sessions.get(token);
    return session === null ? null : { accountId: session.accountId, email: session.email };
  }

  async currentSession(request: FastifyRequest): Promise<AuthSession | null> {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token === null) return null;
    return this.#sessions.get(token);
  }

  async logout(request: FastifyRequest, returnTo: string): Promise<string | null> {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token === null) return null;
    const session = await this.#sessions.get(token);
    await this.#sessions.delete(token);
    if (
      session?.workosSessionId === undefined
      || this.#provider === undefined
    ) {
      return null;
    }
    return this.#provider.logoutUrl(session.workosSessionId, returnTo);
  }

  #authorizationStateStore(): AuthorizationStateStore {
    if (this.#authorizationStates === undefined) {
      throw new Error('authorization state store not configured');
    }
    return this.#authorizationStates;
  }
}
