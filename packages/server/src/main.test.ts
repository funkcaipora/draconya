import { describe, expect, it } from 'vitest';
import { loadConfiguration, requestedRoles } from './config.js';

describe('role selection', () => {
  it('starts in standalone mode without PROCESSES', () => {
    expect(requestedRoles({})).toEqual(['api', 'game', 'jobs']);
  });

  it('accepts a single role', () => {
    expect(requestedRoles({ PROCESSES: 'game' })).toEqual(['game']);
  });

  it('trims whitespace', () => {
    expect(requestedRoles({ PROCESSES: ' api , jobs ' })).toEqual(['api', 'jobs']);
  });

  it('rejects an unknown role', () => {
    expect(() => requestedRoles({ PROCESSES: 'game,database' })).toThrow(/database/);
  });

  it('rejects an empty value', () => {
    expect(() => requestedRoles({ PROCESSES: ',,' })).toThrow();
  });

  it('refuses to boot when the pre-rename variable is still set', () => {
    // O caso ruim não é a variável antiga estar errada — é ela ser IGNORADA. Quem pede
    // `game` e recebe os três papéis não descobre pelo log; descobre pelo estado dividido.
    expect(() => requestedRoles({ PROCESSOS: 'game' })).toThrow(/PROCESSOS/);
  });
});

describe('modo solo (FUN-59)', () => {
  it('os três papéis têm portas distintas por padrão, para o boot não conflitar', () => {
    // O `jobs` ganhou porta própria para o `/metrics`. No modo solo os três sobem no mesmo
    // processo, e duas portas iguais falhariam no `listen` — o teste garante que os defaults
    // nunca colidem, que é o caso que ninguém configura à mão.
    // Só o obrigatório sem default; as portas ficam no padrão, que é o que se testa.
    const configuration = loadConfiguration({
      DATABASE_URL: 'postgres://x:y@localhost:5432/z', REDIS_URL: 'redis://localhost:6379',
    });
    const ports = [configuration.API_PORT, configuration.JOBS_PORT, configuration.GAME_PORT];
    expect(new Set(ports).size).toBe(3);
    expect(configuration.JOBS_PORT).toBe(3001);
  });
});
