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
});
