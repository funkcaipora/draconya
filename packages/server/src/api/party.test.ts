import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { registerPartyRoutes } from './party.js';
import type { PartyRouteDependencies } from './party.js';
import type { IssueResult, PartyTicket } from '../tickets.js';
import type { CharacterRecord } from '../db/repository.js';
import { PartyStore } from '../party-store.js';
import { connectTestRedis } from '../testing/redis.js';

const { redis, available } = await connectTestRedis(13);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

// As rotas da party (#195): quem é, de quem é o personagem, em que party ele está — e o
// `start`, que é o que faz para N o que `POST /api/tickets` faz para um. O formulário é o
// `PartyStore` de verdade, no Redis; ticket, banco e diretório são falsos.

const character = (id: string, accountId: string): CharacterRecord => ({
  id, accountId, name: `Hero ${id}`, vocation: null, level: 10, xp: 0, gold: 50,
  capacity: 400, premiumUntil: null, staminaMs: 86_400_000, staminaUpdatedAt: new Date(),
  state: 'city', sessionId: null, botConfig: null, skills: {}, outfitColors: null, bestiary: null,
  ammo: null,
  createdAt: new Date(),
});

const NODE = { nodeId: 'n1', sessions: 0, url: 'ws://n1:7171' };

function build(over: {
  issue?: (characterId: string) => IssueResult;
  locate?: (characterId: string) => { type: string } | null;
} = {}) {
  const app = Fastify();
  const characters = new Map<string, CharacterRecord>([
    ['p1', character('p1', 'a1')], ['p2', character('p2', 'a2')],
    ['p3', character('p3', 'a3')], ['p4', character('p4', 'a4')], ['p5', character('p5', 'a5')],
  ]);
  const issued: Array<{ characterId: string; party: PartyTicket | undefined }> = [];
  const revoked: string[] = [];
  const deps: PartyRouteDependencies = {
    party: new PartyStore(redis),
    tickets: {
      resolveNode: async () => ({ ok: true, node: NODE }),
      issue: async (_accountId, characterId, _initial, _node, party) => {
        const result = over.issue?.(characterId) ?? {
          ok: true,
          value: { ticket: `tok-${characterId}`, wsUrl: `ws://n1:7171/?ticket=tok-${characterId}`, nodeId: 'n1', expiresAtMs: 1_000 },
        };
        if (result.ok) issued.push({ characterId, party });
        return result;
      },
      revoke: async (token) => { revoked.push(token); },
    },
    // A conta vem do header, para o teste falar por qualquer um dos cinco.
    authenticate: async (request: FastifyRequest) => {
      const accountId = request.headers['x-account'];
      return typeof accountId === 'string' ? { accountId } : null;
    },
    ownsCharacter: async (accountId, characterId) => characters.get(characterId)?.accountId === accountId,
    getCharacter: async (accountId, characterId) => {
      const found = characters.get(characterId);
      return found !== undefined && found.accountId === accountId ? found : null;
    },
    settleProgress: async () => ({ written: 0, failed: 0 }),
    locateSession: async (characterId) => over.locate?.(characterId) ?? null,
    limits: { maxMembers: 4, difficultiesOf: (huntId) => (huntId === 'arena' ? ['cautious', 'bold'] : null) },
  };
  registerPartyRoutes(app, deps);
  const as = (characterId: string) => ({
    post: (url: string, payload: Record<string, unknown> = {}) => app.inject({
      method: 'POST', url, payload: { characterId, ...payload },
      headers: { 'x-account': characters.get(characterId)?.accountId ?? 'nobody' },
    }),
    mine: () => app.inject({
      method: 'GET', url: `/api/party/mine?characterId=${characterId}`,
      headers: { 'x-account': characters.get(characterId)?.accountId ?? 'nobody' },
    }),
  });
  return { app, as, issued, revoked };
}

describe.runIf(available)('as rotas da party (#195, ADR 0027 decisão 8)', () => {
  it('runs the whole flow: create, invite, join, propose, approve, start — one ticket per member', async () => {
    const { as, issued } = build();
    const created = await as('p1').post('/api/party');
    expect(created.statusCode).toBe(200);
    const createdBody = created.json() as { id: string; members: Array<{ characterId: string; name: string; approved: boolean }> };
    const id = createdBody.id;
    expect(createdBody.members).toEqual([{ characterId: 'p1', name: 'Hero p1', approved: false }]);

    expect((await as('p2').post(`/api/party/${id}/join`)).statusCode).toBe(409);
    // `p2` não é o líder — e ainda nem está na party.
    expect((await as('p2').post(`/api/party/${id}/invite`, { inviteeId: 'p3' })).statusCode).toBe(403);
    expect((await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p2' })).statusCode).toBe(200);
    const joined = await as('p2').post(`/api/party/${id}/join`);
    expect(joined.statusCode).toBe(200);
    expect((joined.json() as { members: Array<{ characterId: string; name: string; approved: boolean }> }).members).toEqual([
      { characterId: 'p1', name: 'Hero p1', approved: false },
      { characterId: 'p2', name: 'Hero p2', approved: false },
    ]);

    // Sem proposta não se aprova nem se inicia.
    expect((await as('p2').post(`/api/party/${id}/approve`)).statusCode).toBe(409);
    expect((await as('p1').post(`/api/party/${id}/propose`, { huntId: 'nope', difficulty: 'bold', mode: 'shared' })).statusCode).toBe(400);
    const proposed = await as('p1').post(`/api/party/${id}/propose`, { huntId: 'arena', difficulty: 'bold', mode: 'shared' });
    expect(proposed.statusCode).toBe(200);
    expect((proposed.json() as { members: Array<{ characterId: string; name: string; approved: boolean }> }).members).toEqual([
      { characterId: 'p1', name: 'Hero p1', approved: true },
      { characterId: 'p2', name: 'Hero p2', approved: false },
    ]);
    // Não aprovado por todos: recusa, e NADA foi emitido.
    expect((await as('p1').post(`/api/party/${id}/start`)).json()).toEqual({ error: 'not-approved' });
    expect(issued).toEqual([]);
    const approved = await as('p2').post(`/api/party/${id}/approve`);
    expect(approved.statusCode).toBe(200);
    expect((approved.json() as { members: Array<{ characterId: string; name: string; approved: boolean }> }).members).toEqual([
      { characterId: 'p1', name: 'Hero p1', approved: true },
      { characterId: 'p2', name: 'Hero p2', approved: true },
    ]);

    const started = await as('p1').post(`/api/party/${id}/start`);
    expect(started.statusCode).toBe(200);
    const body = started.json() as { sessionId: string; ticket: { ticket: string } | null };
    expect(body.ticket?.ticket).toBe('tok-p1');
    // Dois tickets, o MESMO bloco de party em cada um, na ordem de entrada.
    expect(issued.map((entry) => entry.characterId)).toEqual(['p1', 'p2']);
    const party = issued[1]?.party;
    expect(party).toMatchObject({ sessionId: body.sessionId, leaderId: 'p1', mode: 'shared', huntId: 'arena', difficulty: 'bold' });
    expect(party?.members.map((m) => [m.characterId, m.accountId, m.initialCharacter.level])).toEqual([['p1', 'a1', 10], ['p2', 'a2', 10]]);
    // O outro pega o seu pelo `mine`, uma vez; depois, nada.
    const mine = await as('p2').mine();
    expect((mine.json() as { ticket: { ticket: string } | null }).ticket?.ticket).toBe('tok-p2');
    expect((await as('p2').mine()).json()).toEqual({ party: null, ticket: null });
  });

  it('refuses a member in a hunt, and reserves nothing', async () => {
    const { as, issued } = build({ locate: (characterId) => (characterId === 'p2' ? { type: 'hunt' } : null) });
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p2' });
    await as('p2').post(`/api/party/${id}/join`);
    await as('p1').post(`/api/party/${id}/propose`, { huntId: 'arena', difficulty: 'bold', mode: 'split' });
    await as('p2').post(`/api/party/${id}/approve`);
    const started = await as('p1').post(`/api/party/${id}/start`);
    expect(started.statusCode).toBe(409);
    expect(started.json()).toEqual({ error: 'not-in-city', characterId: 'p2' });
    expect(issued).toEqual([]);
    // A party continua de pé para tentar de novo.
    expect(((await as('p1').mine()).json() as { party: unknown }).party).not.toBeNull();
  });

  it('when the second ticket fails, the first is revoked and the party survives', async () => {
    // Mutação que mata: não revogar — `p1` ficaria com slot reservado para uma sessão que não existe.
    const { as, issued, revoked } = build({
      issue: (characterId) => (characterId === 'p2' ? { ok: false, reason: 'active-limit' } : { ok: true, value: { ticket: `tok-${characterId}`, wsUrl: 'ws://x', nodeId: 'n1', expiresAtMs: 1 } }),
    });
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p2' });
    await as('p2').post(`/api/party/${id}/join`);
    await as('p1').post(`/api/party/${id}/propose`, { huntId: 'arena', difficulty: 'bold', mode: 'split' });
    await as('p2').post(`/api/party/${id}/approve`);
    const started = await as('p1').post(`/api/party/${id}/start`);
    expect(started.statusCode).toBe(409);
    expect(started.json()).toEqual({ error: 'active-limit', characterId: 'p2' });
    expect(issued.map((e) => e.characterId)).toEqual(['p1']);
    expect(revoked).toEqual(['tok-p1']);
    expect(((await as('p1').mine()).json() as { party: unknown }).party).not.toBeNull();
  });

  it('matchmaking forms the party for two who queue, and the one in a hunt is refused (#199)', async () => {
    const { as, app } = build({ locate: (characterId) => (characterId === 'p5' ? { type: 'hunt' } : null) });
    expect((await as('p1').post('/api/matchmaking/join')).json()).toEqual({ party: null });
    const matched = await as('p2').post('/api/matchmaking/join');
    expect(matched.statusCode).toBe(200);
    const formed = (matched.json() as { party: { leaderId: string; members: Array<{ characterId: string; name: string; approved: boolean }> } | null }).party;
    expect(formed?.leaderId).toBe('p1');
    expect(formed?.members).toEqual([
      { characterId: 'p1', name: 'Hero p1', approved: false },
      { characterId: 'p2', name: 'Hero p2', approved: false },
    ]);
    expect((await as('p1').post('/api/matchmaking/join')).json()).toEqual({ error: 'already-in-party' });
    expect((await as('p5').post('/api/matchmaking/join')).json()).toEqual({ error: 'not-in-city' });
    expect((await as('p3').post('/api/matchmaking/leave')).statusCode).toBe(200);
    expect(app).toBeDefined();
  });

  it('kick removes member, rejects non-leader, self-kick, and non-member, returning updated members with names (#358)', async () => {
    const { as } = build();
    const created = await as('p1').post('/api/party');
    expect(created.statusCode).toBe(200);
    const id = (created.json() as { id: string }).id;

    await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p2' });
    await as('p2').post(`/api/party/${id}/join`);
    await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p3' });
    await as('p3').post(`/api/party/${id}/join`);

    await as('p1').post(`/api/party/${id}/propose`, { huntId: 'arena', difficulty: 'bold', mode: 'shared' });
    await as('p2').post(`/api/party/${id}/approve`);

    // Não-líder tentando expulsar -> 403
    const p2Kick = await as('p2').post(`/api/party/${id}/kick`, { targetId: 'p3' });
    expect(p2Kick.statusCode).toBe(403);
    expect(p2Kick.json()).toEqual({ error: 'not-leader' });

    // Líder tentando expulsar a si mesmo -> 409
    const selfKick = await as('p1').post(`/api/party/${id}/kick`, { targetId: 'p1' });
    expect(selfKick.statusCode).toBe(409);
    expect(selfKick.json()).toEqual({ error: 'cannot-kick-self' });

    // Líder tentando expulsar não-membro -> 409
    const nonMemberKick = await as('p1').post(`/api/party/${id}/kick`, { targetId: 'p4' });
    expect(nonMemberKick.statusCode).toBe(409);
    expect(nonMemberKick.json()).toEqual({ error: 'target-not-a-member' });

    // Party inexistente -> 404
    const notFoundKick = await as('p1').post('/api/party/nope/kick', { targetId: 'p2' });
    expect(notFoundKick.statusCode).toBe(404);
    expect(notFoundKick.json()).toEqual({ error: 'party-not-found' });

    // Body inválido -> 400
    const invalidBody = await as('p1').post(`/api/party/${id}/kick`, {});
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json()).toEqual({ error: 'invalid-body' });

    // Líder expulsa p2 -> 200, p2 removido, aprovações resetadas, nomes presentes
    const kick = await as('p1').post(`/api/party/${id}/kick`, { targetId: 'p2' });
    expect(kick.statusCode).toBe(200);
    const body = kick.json() as { members: Array<{ characterId: string; name: string; approved: boolean }> };
    expect(body.members).toEqual([
      { characterId: 'p1', name: 'Hero p1', approved: false },
      { characterId: 'p3', name: 'Hero p3', approved: false },
    ]);

    // Expulsar membro já removido -> 409
    const kickAgain = await as('p1').post(`/api/party/${id}/kick`, { targetId: 'p2' });
    expect(kickAgain.statusCode).toBe(409);
    expect(kickAgain.json()).toEqual({ error: 'target-not-a-member' });
  });

  it('caps the party at maxMembers, keeps one party per character, and only the leader proposes', async () => {
    const { app, as } = build();
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    for (const member of ['p2', 'p3', 'p4', 'p5']) await as('p1').post(`/api/party/${id}/invite`, { inviteeId: member });
    for (const member of ['p2', 'p3', 'p4']) expect((await as(member).post(`/api/party/${id}/join`)).statusCode).toBe(200);
    expect((await as('p5').post(`/api/party/${id}/join`)).json()).toEqual({ error: 'full' });
    expect((await as('p2').post('/api/party')).json()).toEqual({ error: 'already-in-party' });
    expect((await as('p2').post(`/api/party/${id}/propose`, { huntId: 'arena', difficulty: 'bold', mode: 'split' })).statusCode).toBe(403);
    // Sair desaprova; o líder que sai passa a liderança.
    await as('p1').post(`/api/party/${id}/propose`, { huntId: 'arena', difficulty: 'bold', mode: 'split' });
    await as('p2').post(`/api/party/${id}/approve`);
    const left = await as('p1').post(`/api/party/${id}/leave`);
    expect((left.json() as { party: { leaderId: string; members: Array<{ approved: boolean }> } }).party).toMatchObject({ leaderId: 'p2' });
    expect((left.json() as { party: { members: Array<{ approved: boolean }> } }).party.members.every((m) => !m.approved)).toBe(true);
    // Quem não é dono do personagem não fala por ele: `p3` com a conta de `p5`.
    const forged = await app.inject({ method: 'POST', url: '/api/party', payload: { characterId: 'p3' }, headers: { 'x-account': 'a5' } });
    expect(forged.statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/party', payload: { characterId: 'p3' } })).statusCode).toBe(401);
  });
});
