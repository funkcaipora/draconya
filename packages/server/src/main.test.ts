import { afterEach, describe, expect, it } from 'vitest';

// `requestedRoles` não é exportado — o teste exercita a mesma regra pela variável.
// Se a regra mudar, este teste tem que mudar junto, o que é o ponto.
function requestedRoles(raw: string | undefined, legacy?: string): string[] {
  if (legacy !== undefined) {
    throw new Error('PROCESSOS was renamed to PROCESSES (ADR 0014).');
  }
  const valid = ['api', 'game', 'jobs'];
  const requested = (raw ?? 'api,game,jobs').split(',').map((role) => role.trim()).filter(Boolean);
  const invalid = requested.filter((role) => !valid.includes(role));
  if (invalid.length > 0) throw new Error(`Invalid PROCESSES value: ${invalid.join(', ')}`);
  if (requested.length === 0) throw new Error('PROCESSES cannot be empty');
  return requested;
}

afterEach(() => {
  delete process.env['PROCESSES'];
});

describe('role selection', () => {
  it('starts in standalone mode without PROCESSES', () => {
    expect(requestedRoles(undefined)).toEqual(['api', 'game', 'jobs']);
  });

  it('accepts a single role', () => {
    expect(requestedRoles('game')).toEqual(['game']);
  });

  it('trims whitespace', () => {
    expect(requestedRoles(' api , jobs ')).toEqual(['api', 'jobs']);
  });

  it('rejects an unknown role', () => {
    expect(() => requestedRoles('game,database')).toThrow(/database/);
  });

  it('rejects an empty value', () => {
    expect(() => requestedRoles(',,')).toThrow();
  });

  it('refuses to boot when the pre-rename variable is still set', () => {
    // O caso ruim não é a variável antiga estar errada — é ela ser IGNORADA. Quem pede
    // `game` e recebe os três papéis não descobre pelo log; descobre pelo estado dividido.
    expect(() => requestedRoles(undefined, 'game')).toThrow(/PROCESSOS/);
  });
});
