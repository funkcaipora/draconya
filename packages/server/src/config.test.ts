import { describe, expect, it } from 'vitest';
import { loadConfiguration } from './config.js';

const minimumEnvironment = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/d',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfiguration', () => {
  it('applies defaults', () => {
    const configuration = loadConfiguration(minimumEnvironment as NodeJS.ProcessEnv);
    expect(configuration.API_PORT).toBe(3000);
    expect(configuration.AUTH_DEV_MODE).toBe(false);
  });

  it('treats blank optional WorkOS credentials as unconfigured', () => {
    const configuration = loadConfiguration({
      ...minimumEnvironment,
      WORKOS_API_KEY: '',
      WORKOS_CLIENT_ID: '',
    } as NodeJS.ProcessEnv);
    expect(configuration.WORKOS_API_KEY).toBeUndefined();
    expect(configuration.WORKOS_CLIENT_ID).toBeUndefined();
  });

  it('fails with a useful message when a required variable is missing', () => {
    expect(() => loadConfiguration({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('rejects AUTH_DEV_MODE in production', () => {
    expect(() =>
      loadConfiguration({
        ...minimumEnvironment, NODE_ENV: 'production', AUTH_DEV_MODE: 'true', WORKOS_API_KEY: 'k',
      } as NodeJS.ProcessEnv),
    ).toThrow(/AUTH_DEV_MODE/);
  });

  it('requires WORKOS_API_KEY in production', () => {
    expect(() =>
      loadConfiguration({ ...minimumEnvironment, NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrow(/WORKOS_API_KEY/);
  });

  it('requires WORKOS_CLIENT_ID in production', () => {
    expect(() =>
      loadConfiguration({
        ...minimumEnvironment,
        NODE_ENV: 'production',
        WORKOS_API_KEY: 'sk_test',
      } as NodeJS.ProcessEnv),
    ).toThrow(/WORKOS_CLIENT_ID/);
  });

  it('rejects a partially configured WorkOS integration', () => {
    expect(() => loadConfiguration({
      ...minimumEnvironment,
      WORKOS_CLIENT_ID: 'client_test',
    } as NodeJS.ProcessEnv)).toThrow(/configured together/);
  });

  it('requires HTTPS origins and redirects in production', () => {
    const production = {
      ...minimumEnvironment,
      NODE_ENV: 'production',
      WORKOS_API_KEY: 'sk_test',
      WORKOS_CLIENT_ID: 'client_test',
    } as NodeJS.ProcessEnv;

    expect(() => loadConfiguration(production)).toThrow(/API_ORIGIN must use https/);
    expect(() => loadConfiguration({
      ...production,
      API_ORIGIN: 'https://game.example.com',
    })).toThrow(/WORKOS_REDIRECT_URI must use https/);
  });

  it('rejects API_ORIGIN paths because it is also the CORS origin', () => {
    expect(() => loadConfiguration({
      ...minimumEnvironment,
      API_ORIGIN: 'https://game.example.com/play',
    } as NodeJS.ProcessEnv)).toThrow(/must be an origin/);
  });
});
