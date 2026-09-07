import { describe, expect, it } from 'vitest';
import { carregarConfiguracao } from './config.js';

const minimo = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/d',
  REDIS_URL: 'redis://localhost:6379',
};

describe('carregarConfiguracao', () => {
  it('aplica os defaults', () => {
    const cfg = carregarConfiguracao(minimo as NodeJS.ProcessEnv);
    expect(cfg.API_PORT).toBe(3000);
    expect(cfg.AUTH_DEV_MODE).toBe(false);
  });

  it('falha com mensagem útil quando falta variável obrigatória', () => {
    expect(() => carregarConfiguracao({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('recusa AUTH_DEV_MODE em produção', () => {
    expect(() =>
      carregarConfiguracao({
        ...minimo, NODE_ENV: 'production', AUTH_DEV_MODE: 'true', WORKOS_API_KEY: 'k',
      } as NodeJS.ProcessEnv),
    ).toThrow(/AUTH_DEV_MODE/);
  });

  it('exige WORKOS_API_KEY em produção', () => {
    expect(() =>
      carregarConfiguracao({ ...minimo, NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrow(/WORKOS_API_KEY/);
  });
});
