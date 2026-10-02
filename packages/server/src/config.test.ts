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

  it('keeps the open world OFF by default (#836, OW-15, ADR 0060)', () => {
    // O default é o jogo de hoje: com a flag desligada nada novo é lido nem escrito. Mutação que
    // mata: trocar o default para `true`.
    expect(loadConfiguration(minimumEnvironment as NodeJS.ProcessEnv).OPEN_WORLD).toBe(false);
  });

  it.each([['1', true], ['true', true], ['0', false], ['false', false]] as const)(
    'reads OPEN_WORLD=%s as %s',
    (value, expected) => {
      const configuration = loadConfiguration({ ...minimumEnvironment, OPEN_WORLD: value } as NodeJS.ProcessEnv);
      expect(configuration.OPEN_WORLD).toBe(expected);
    },
  );

  it('refuses an OPEN_WORLD value that is not a boolean flag, instead of silently turning the world off', () => {
    for (const value of ['yes', 'on', '2', 'TRUE', '']) {
      expect(() => loadConfiguration({ ...minimumEnvironment, OPEN_WORLD: value } as NodeJS.ProcessEnv))
        .toThrow(/OPEN_WORLD/);
    }
  });

  it('checkpoints the world every 60 s by default (#837, OW-16, ADR 0060 d.10d)', () => {
    // O que a decisão compra — 3,3 transações por segundo com 200 personagens — e o que o mundo perde
    // numa queda. Mutação que mata: trocar o default por 10 000 (o intervalo do snapshot da hunt).
    expect(loadConfiguration(minimumEnvironment as NodeJS.ProcessEnv).WORLD_CHECKPOINT_MS).toBe(60_000);
  });

  it('reads WORLD_CHECKPOINT_MS in milliseconds, between one second and one hour', () => {
    for (const [value, expected] of [['1000', 1_000], ['10000', 10_000], ['3600000', 3_600_000]] as const) {
      const configuration = loadConfiguration(
        { ...minimumEnvironment, WORLD_CHECKPOINT_MS: value } as NodeJS.ProcessEnv,
      );
      expect(configuration.WORLD_CHECKPOINT_MS).toBe(expected);
    }
  });

  it('refuses a WORLD_CHECKPOINT_MS that is not a sane cadence, instead of checkpointing in a loop or never', () => {
    // 0 viraria um `setInterval` de 0 ms (um lote por volta do laço de eventos); NaN e negativo o
    // fariam disparar de imediato; mais de uma hora é o intervalo do Canary, e daí para cima o mundo
    // perderia horas numa queda.
    for (const value of ['0', '999', '-5', 'abc', '1.5', '3600001', '']) {
      expect(() => loadConfiguration({ ...minimumEnvironment, WORLD_CHECKPOINT_MS: value } as NodeJS.ProcessEnv))
        .toThrow(/WORLD_CHECKPOINT_MS/);
    }
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
    expect(() => loadConfiguration({ REDIS_URL: minimumEnvironment.REDIS_URL })).toThrow(/DATABASE_URL/);
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


describe('role-specific requirements', () => {
  const production = {
    ...minimumEnvironment, NODE_ENV: 'production',
    WORKOS_API_KEY: 'test-key', WORKOS_CLIENT_ID: 'test-client',
    API_ORIGIN: 'https://game.example.com',
    WORKOS_REDIRECT_URI: 'https://game.example.com/api/auth/callback',
    GAME_PUBLIC_URL: 'wss://game.example.com/ws',
  };

  it.each(['api', 'jobs', 'api,jobs', 'api,game', 'game,jobs', 'api,game,jobs'])(
    'requires Postgres when PROCESSES=%s', (roles) => {
      expect(() => loadConfiguration({ ...production, PROCESSES: roles, DATABASE_URL: '' }))
        .toThrow(/DATABASE_URL/);
    },
  );

  it('starts production game without Postgres or WorkOS', () => {
    const config = loadConfiguration({
      REDIS_URL: minimumEnvironment.REDIS_URL, PROCESSES: 'game',
      NODE_ENV: 'production', GAME_PUBLIC_URL: production.GAME_PUBLIC_URL,
      THINGS_DIR: '/tooling/only',
    });
    expect(config.PROCESSES).toEqual(['game']);
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.WORKOS_API_KEY).toBeUndefined();
    expect(config).not.toHaveProperty('THINGS_DIR');
  });

  it('starts production jobs without WorkOS, HTTPS origin or public socket URL', () => {
    expect(loadConfiguration({ ...minimumEnvironment, PROCESSES: 'jobs', NODE_ENV: 'production' })
      .PROCESSES).toEqual(['jobs']);
  });

  it('does not require a public socket URL on an API-only node', () => {
    expect(loadConfiguration({ ...production, PROCESSES: 'api', GAME_PUBLIC_URL: undefined })
      .PROCESSES).toEqual(['api']);
  });

  it.each(['api', 'api,jobs', 'api,game', 'api,game,jobs'])(
    'requires WorkOS only when api is selected (%s)', (roles) => {
      expect(() => loadConfiguration({
        ...production, PROCESSES: roles, WORKOS_API_KEY: undefined, WORKOS_CLIENT_ID: undefined,
      })).toThrow(/WORKOS_API_KEY/);
    },
  );

  it.each(['', 'garbage', 'https://game.example.com/ws', 'ws://u:p@host/ws', 'ws://host/ws?ticket=x', 'wss://host/ws#fragment'])(
    'rejects an invalid advertised socket URL: %s', (url) => {
      expect(() => loadConfiguration({ ...minimumEnvironment, PROCESSES: 'game', GAME_PUBLIC_URL: url }))
        .toThrow(/GAME_PUBLIC_URL/);
    },
  );

  it.each(['development', 'test'])( 'allows local ws in %s', (environment) => {
    expect(loadConfiguration({ REDIS_URL: minimumEnvironment.REDIS_URL, PROCESSES: 'game', NODE_ENV: environment })
      .GAME_PUBLIC_URL).toBe('ws://localhost:7171');
  });

  it('requires explicit WSS for production game and solo', () => {
    for (const PROCESSES of ['game', 'api,game,jobs']) {
      expect(() => loadConfiguration({ ...production, PROCESSES, GAME_PUBLIC_URL: undefined }))
        .toThrow(/GAME_PUBLIC_URL must use wss/);
    }
    expect(loadConfiguration(production).PROCESSES).toEqual(['api', 'game', 'jobs']);
  });

  it('rejects invalid role selection before checking services', () => {
    expect(() => loadConfiguration({ PROCESSES: 'unknown' })).toThrow(/Invalid PROCESSES/);
    expect(() => loadConfiguration({ PROCESSES: 'game,game' })).toThrow(/duplicate/);
    expect(() => loadConfiguration({ PROCESSOS: 'game' })).toThrow(/PROCESSOS/);
  });

  it.each(['api', 'game', 'jobs'])('requires Redis for %s', (PROCESSES) => {
    expect(() => loadConfiguration({ ...production, PROCESSES, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
  });
});
