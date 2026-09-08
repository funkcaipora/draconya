import { afterEach, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { loadConfiguration } from '../config.js';
import { buildApi } from './server.js';

const configuration = loadConfiguration({
  DATABASE_URL: 'postgres://localhost/test', REDIS_URL: 'redis://localhost', NODE_ENV: 'test',
  API_ORIGIN: 'https://play.draconya.example',
});
const apps: ReturnType<typeof buildApi>[] = [];

function setup() {
  const logs: string[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => { logs.push(line); } });
  const app = buildApi(configuration, logger);
  app.post('/api/protected', async () => ({ ok: true }));
  app.get('/api/protected', async () => ({ accountId: 'private-account' }));
  app.get('/api/failure', async () => { throw new Error('database-password-secret'); });
  apps.push(app);
  return { app, logs };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('API security boundary', () => {
  it.each([
    { origin: 'https://evil.example' },
    { origin: 'https://forum.draconya.example' },
    { origin: 'null' },
    { referer: 'https://evil.example/form' },
    { referer: 'invalid-url' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ])('rejects untrusted browser mutations with %j', async (headers) => {
    const { app } = setup();
    const response = await app.inject({ method: 'POST', url: '/api/protected', headers });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'untrusted-origin' });
  });

  it('accepts the configured browser origin and credentialed CLI requests', async () => {
    const { app } = setup();
    for (const headers of [{ origin: configuration.API_ORIGIN }, {}]) {
      const response = await app.inject({ method: 'POST', url: '/api/protected', headers });
      expect(response.statusCode).toBe(200);
    }
  });

  it('keeps authentication callbacks readable and private without logging credentials', async () => {
    const { app, logs } = setup();
    const response = await app.inject({
      method: 'GET', url: '/api/protected?code=secret-code&state=secret-state',
      headers: { cookie: 'draconya_session=secret-cookie', referer: 'https://auth.workos.com' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['access-control-allow-origin']).toBe(configuration.API_ORIGIN);
    expect(logs.join('')).not.toMatch(/secret-code|secret-state|secret-cookie/);
  });

  it('fails closed without leaking dependency errors', async () => {
    const { app, logs } = setup();
    const response = await app.inject({ method: 'GET', url: '/api/failure' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'service-unavailable' });
    expect(logs.join('')).not.toContain('database-password-secret');
  });
});
