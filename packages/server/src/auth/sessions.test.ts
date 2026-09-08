import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestRedis } from '../testing/redis.js';
import { RedisAuthSessionStore, type AuthSession } from './sessions.js';

// O banco 3 é exclusivo deste arquivo; ver testing/redis.ts.
const { redis, available } = await connectTestRedis(3);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

const describeWithRedis = available ? describe : describe.skip;
const session: AuthSession = {
  accountId: 'account-1',
  externalAuthId: 'user-1',
  email: 'hero@example.com',
};

describeWithRedis('RedisAuthSessionStore', () => {
  it('stores opaque sessions with an expiry', async () => {
    const sessions = new RedisAuthSessionStore(redis, 120);
    const token = await sessions.create(session);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await sessions.get(token)).toEqual(session);
    expect(await redis.ttl(`auth:session:${token}`)).toBeGreaterThan(0);
    expect(await redis.ttl(`auth:session:${token}`)).toBeLessThanOrEqual(120);
  });

  it('atomically replaces an existing session token', async () => {
    const sessions = new RedisAuthSessionStore(redis, 120);
    const oldToken = await sessions.create(session);
    const newToken = await sessions.create(session, oldToken);

    expect(newToken).not.toBe(oldToken);
    expect(await sessions.get(oldToken)).toBeNull();
    expect(await sessions.get(newToken)).toEqual(session);
  });

  it('consumes authorization state exactly once and expires it separately', async () => {
    const sessions = new RedisAuthSessionStore(redis, 120);
    const state = 'a'.repeat(32);
    await sessions.saveAuthorizationState(state, 60);

    expect(await redis.ttl(`auth:state:${state}`)).toBeGreaterThan(0);
    await expect(sessions.consumeAuthorizationState(state)).resolves.toBe(true);
    await expect(sessions.consumeAuthorizationState(state)).resolves.toBe(false);
    const expired = 'b'.repeat(32);
    await sessions.saveAuthorizationState(expired, 60);
    await redis.pexpire(`auth:state:${expired}`, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(sessions.consumeAuthorizationState(expired)).resolves.toBe(false);
  });

  it('rejects malformed session records', async () => {
    const sessions = new RedisAuthSessionStore(redis, 120);
    const token = 'x'.repeat(43);
    await redis.set(`auth:session:${token}`, JSON.stringify({ ...session, accountId: '' }), 'EX', 60);

    await expect(sessions.get(token)).resolves.toBeNull();
    await redis.set(`auth:session:${token}`, '{invalid', 'EX', 60);
    await expect(sessions.get(token)).resolves.toBeNull();
  });

  it('expires local sessions without renewing their TTL on reads', async () => {
    const sessions = new RedisAuthSessionStore(redis, 120);
    const token = await sessions.create(session);
    await redis.pexpire(`auth:session:${token}`, 50);
    expect(await sessions.get(token)).toEqual(session);
    expect(await redis.pttl(`auth:session:${token}`)).toBeLessThanOrEqual(50);
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(await sessions.get(token)).toBeNull();
  });

  it.each([0, -1, 0.5, NaN, Infinity])('rejects invalid TTL %s', (ttl) => {
    expect(() => new RedisAuthSessionStore(redis, ttl)).toThrow('positive integer');
  });
});
