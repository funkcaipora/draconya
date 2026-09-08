import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createTicketHandler, type TicketRouteDependencies } from './tickets.js';
import type { IssueResult } from '../tickets.js';
import type { CharacterRecord } from '../db/repository.js';

const CHARACTER: CharacterRecord = {
  id: 'p1', accountId: 'a1', name: 'Hero', vocation: null, level: 1, xp: 0, gold: 0,
  capacity: 400, premiumUntil: null, staminaMs: 86400000, staminaUpdatedAt: new Date(),
  state: 'city', sessionId: null, createdAt: new Date(),
};

const ISSUED: IssueResult = {
  ok: true,
  value: {
    ticket: 'tok', wsUrl: 'ws://n1:7171/?ticket=tok', nodeId: 'n1', expiresAtMs: 1_000,
  },
};

function build(overrides: Partial<TicketRouteDependencies> = {}) {
  const app = Fastify();
  app.post('/api/tickets', createTicketHandler({
    tickets: { issue: async () => ISSUED },
    authenticate: async () => ({ accountId: 'a1' }),
    withOwnedCharacter: async (_accountId, _characterId, operation) => operation(CHARACTER),
    ...overrides,
  }));
  return app;
}

const post = (app: ReturnType<typeof build>, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/tickets', payload: body });

describe('POST /api/tickets', () => {
  it('returns the ticket and the URL of the resolved node', async () => {
    const response = await post(build(), { characterId: 'p1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ticket: 'tok', wsUrl: 'ws://n1:7171/?ticket=tok', expiresAtMs: 1_000,
    });
  });

  it('refuses to serve at all while authentication is not wired', async () => {
    // Falhar fechado. Uma rota de ticket sem autenticação emite credencial para qualquer
    // personagem — é pior que a rota não existir.
    const response = await post(build({ authenticate: undefined }), { characterId: 'p1' });
    expect(response.statusCode).toBe(501);
  });

  it('rejects an anonymous caller', async () => {
    const response = await post(build({ authenticate: async () => null }), { characterId: 'p1' });
    expect(response.statusCode).toBe(401);
  });

  it('answers 404 for a character that is not the caller\'s', async () => {
    // Não 403: distinguir "não existe" de "não é seu" entrega uma lista de personagens.
    const response = await post(build({ withOwnedCharacter: async () => null }), { characterId: 'p1' });
    expect(response.statusCode).toBe(404);
  });

  it('uses persisted attributes instead of client supplied progress', async () => {
    const issue = vi.fn(async () => ISSUED);
    const response = await post(build({ tickets: { issue } }), {
      characterId: 'p1', level: 999, xp: 999999, accountId: 'attacker',
    });
    expect(response.statusCode).toBe(200);
    expect(issue).toHaveBeenCalledWith('a1', 'p1', { level: 1, xp: 0 });
  });

  it('rejects a malformed body', async () => {
    expect((await post(build(), { characterId: '' })).statusCode).toBe(400);
    expect((await post(build(), {})).statusCode).toBe(400);
  });

  it.each([
    ['active-limit', 409],
    ['no-node-available', 503],
    ['session-node-unavailable', 503],
  ] as const)('maps %s to HTTP %i', async (reason, status) => {
    const app = build({ tickets: { issue: async () => ({ ok: false, reason }) } });
    const response = await post(app, { characterId: 'p1' });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: reason });
  });
});
