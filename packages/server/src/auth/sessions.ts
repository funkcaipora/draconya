// Sessão HTTP do aplicativo. WorkOS prova a identidade; depois disso a sessão local é uma
// capability opaca no Redis. Isso mantém requests autenticados funcionando durante uma queda
// transitória do provedor, coerente com o ADR 0012.

import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

export interface AuthSession {
  readonly accountId: string;
  readonly externalAuthId: string;
  readonly email: string;
  readonly workosSessionId?: string;
}

export interface AuthSessionStore {
  create(session: AuthSession, replacedToken?: string): Promise<string>;
  get(token: string): Promise<AuthSession | null>;
  delete(token: string): Promise<void>;
}

export interface AuthorizationStateStore {
  saveAuthorizationState(state: string, ttlSeconds: number): Promise<void>;
  consumeAuthorizationState(state: string): Promise<boolean>;
}

const key = (token: string): string => `auth:session:${token}`;
const stateKey = (state: string): string => `auth:state:${state}`;

export class RedisAuthSessionStore implements AuthSessionStore, AuthorizationStateStore {
  readonly #redis: Redis;
  readonly #ttlSeconds: number;

  constructor(redis: Redis, ttlSeconds: number) {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error('auth session TTL must be a positive integer');
    }
    this.#redis = redis;
    this.#ttlSeconds = ttlSeconds;
  }

  async create(session: AuthSession, replacedToken?: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const transaction = this.#redis.multi().set(
      key(token),
      JSON.stringify(session),
      'EX',
      this.#ttlSeconds,
    );
    if (replacedToken !== undefined && isSessionToken(replacedToken)) {
      transaction.del(key(replacedToken));
    }
    const results = await transaction.exec();
    if (results === null) throw new Error('auth session transaction was aborted');
    const failed = results.find(([error]) => error !== null);
    if (failed?.[0] !== null && failed?.[0] !== undefined) throw failed[0];
    return token;
  }

  async get(token: string): Promise<AuthSession | null> {
    if (!isSessionToken(token)) return null;
    const raw = await this.#redis.get(key(token));
    if (raw === null) return null;
    return parseSession(raw);
  }

  async delete(token: string): Promise<void> {
    if (isSessionToken(token)) await this.#redis.del(key(token));
  }

  async saveAuthorizationState(state: string, ttlSeconds: number): Promise<void> {
    if (!isAuthorizationState(state) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error('invalid authorization state');
    }
    const stored = await this.#redis.set(stateKey(state), '1', 'EX', ttlSeconds, 'NX');
    if (stored !== 'OK') throw new Error('authorization state collision');
  }

  async consumeAuthorizationState(state: string): Promise<boolean> {
    if (!isAuthorizationState(state)) return false;
    return await this.#redis.getdel(stateKey(state)) !== null;
  }
}

const isSessionToken = (token: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(token);
const isAuthorizationState = (state: string): boolean => /^[A-Za-z0-9_-]{32}$/.test(state);

function parseSession(raw: string): AuthSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (
    typeof value['accountId'] !== 'string' || value['accountId'] === ''
    || typeof value['externalAuthId'] !== 'string' || value['externalAuthId'] === ''
    || typeof value['email'] !== 'string' || value['email'] === ''
  ) {
    return null;
  }
  const workosSessionId = value['workosSessionId'];
  if (workosSessionId !== undefined && typeof workosSessionId !== 'string') return null;
  return workosSessionId === undefined
    ? {
        accountId: value['accountId'],
        externalAuthId: value['externalAuthId'],
        email: value['email'],
      }
    : {
        accountId: value['accountId'],
        externalAuthId: value['externalAuthId'],
        email: value['email'],
        workosSessionId,
      };
}
