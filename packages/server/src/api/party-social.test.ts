import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { registerPartyRoutes } from './party.js';
import type { PartyRouteDependencies } from './party.js';
import type { CharacterRecord } from '../db/repository.js';
import { NO_VOCATION, PartyStore } from '../party-store.js';
import { connectTestRedis } from '../testing/redis.js';

const { redis, available } = await connectTestRedis(19);

afterAll(async () => {
  if (available) await redis.quit();
});

beforeEach(async () => {
  if (available) await redis.flushdb();
});

// O convite social (RF-09): NÃO depende de party pré-existente — a party nasce no aceite,
// resolvida em UM script Lua, com o `SET NX` em `party:by-char:{convidador}` como trava.
// O que se prende na ROTA: quem manda (fora de hunt), quem aceita (o convidado autenticado),
// os erros tipados, e que corrida nenhuma cria duas parties.

const character = (id: string, accountId: string, over: Partial<Pick<CharacterRecord, 'vocation'>> = {}): CharacterRecord => ({
  id, accountId, name: `Hero ${id}`, vocation: over.vocation ?? null, level: 10, xp: 0, gold: 50,
  capacity: 400, premiumUntil: null, staminaMs: 86_400_000, staminaUpdatedAt: new Date(),
  state: 'city', sessionId: null, botConfig: null, skills: {}, outfitColors: null, bestiary: null,
  ammo: null,
  createdAt: new Date(),
});

const NODE = { nodeId: 'n1', sessions: 0, url: 'ws://n1:7171' };

function build(over: { locate?: (characterId: string) => { type: string } | null } = {}) {
  const app = Fastify();
  const characters = new Map<string, CharacterRecord>([
    ['p1', character('p1', 'a1')], ['p2', character('p2', 'a2')],
    ['p3', character('p3', 'a3')], ['p4', character('p4', 'a4')], ['p5', character('p5', 'a5')],
  ]);
  const locations = new Map<string, { sessionId: string; nodeId: string; type: string }>();
  const deps: PartyRouteDependencies = {
    party: new PartyStore(redis),
    tickets: {
      resolveNode: async () => ({ ok: true, node: NODE }),
      issue: async (_accountId, _characterId, _initial, node) => ({
        ok: true,
        value: { ticket: 'tok-unused', wsUrl: `ws://n1:7171/?ticket=unused`, nodeId: node?.nodeId ?? 'n1', expiresAtMs: 1_000 },
      }),
      revoke: async () => {},
    },
    authenticate: async (request: FastifyRequest) => {
      const accountId = request.headers['x-account'];
      return typeof accountId === 'string' ? { accountId } : null;
    },
    ownsCharacter: async (accountId, characterId) => characters.get(characterId)?.accountId === accountId,
    getCharacter: async (accountId, characterId) => {
      const found = characters.get(characterId);
      return found !== undefined && found.accountId === accountId ? found : null;
    },
    getCharacterById: async (characterId) => characters.get(characterId) ?? null,
    settleProgress: async () => ({ written: 0, failed: 0 }),
    locateSession: async (characterId) => over.locate?.(characterId) ?? locations.get(characterId) ?? null,
    directory: {
      lookup: async (characterId) => locations.get(characterId) ?? null,
      node: async (nodeId) => ({ nodeId, sessions: 0, url: `ws://${nodeId}:7171` }),
    },
    limits: {
      maxMembers: 4, contentVersion: 'v-test',
      vocations: ['knight', 'druid', 'sorcerer', 'paladin'],
      difficultiesOf: (huntId) => (huntId === 'arena' ? ['cautious', 'bold'] : null),
    },
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
  /** As parties que existem AGORA: o HASH `party:{uuid}` de cada uma. */
  const partyHashes = async (): Promise<string[]> =>
    (await redis.keys('party:*')).filter((key) => /^party:[0-9a-f-]{36}$/.test(key));
  return { app, as, locations, characters, deps, partyHashes };
}

describe.runIf(available)('o convite social (RF-09)', () => {
  it('sends without a party, and the accept CREATES exactly one party with the inviter as leader', async () => {
    const { as, partyHashes } = build();
    // Sem party nenhuma: o envio não exige uma (RF-09).
    const sent = await as('p1').post('/api/party/invites/social', { inviteeId: 'p2' });
    expect(sent.statusCode).toBe(200);
    const { inviteId } = sent.json() as { inviteId: string };
    expect(inviteId).toMatch(/[0-9a-f-]{36}/);
    // O convidado vê o convite no `invites[]` do `/mine` — a union com os tradicionais (DT-06).
    const mine = (await as('p2').mine()).json() as { invites: Array<{ inviteId: string; leaderId: string; leaderName: string; createdAtMs: number }> };
    expect(mine.invites).toEqual([
      { inviteId, leaderId: 'p1', leaderName: 'Hero p1', createdAtMs: expect.any(Number) },
    ]);
    // O aceite cria a party: convidador de líder, convidado dentro.
    const accepted = await as('p2').post(`/api/party/invites/social/${inviteId}/accept`);
    expect(accepted.statusCode).toBe(200);
    const party = accepted.json() as { id: string; leaderId: string; members: Array<{ characterId: string }>; vocationTargets: Record<string, number> };
    expect(party.leaderId).toBe('p1');
    expect(party.members.map((member) => member.characterId)).toEqual(['p1', 'p2']);
    expect(party.vocationTargets).toEqual({});
    // EXATAMENTE UMA party, e os dois ocupados por ela.
    expect(await partyHashes()).toHaveLength(1);
    expect((await redis.get('party:by-char:p1'))).toBe(party.id);
    expect((await redis.get('party:by-char:p2'))).toBe(party.id);
    // O convite foi consumido: repetir o aceite é invite-not-found.
    const repeated = await as('p2').post(`/api/party/invites/social/${inviteId}/accept`);
    expect(repeated.statusCode).toBe(404);
    expect(repeated.json()).toEqual({ error: 'invite-not-found' });
    expect(((await as('p2').mine()).json() as { invites: unknown[] }).invites).toEqual([]);
  });

  it('two accepts racing for the same invite still make one party — the loser reads invite-not-found', async () => {
    const { as, partyHashes } = build();
    const { inviteId } = (await as('p1').post('/api/party/invites/social', { inviteeId: 'p2' })).json() as { inviteId: string };
    // Dois aceites do MESMO convite: o Redis serializa os scripts — o segundo não acha o convite.
    const [first, second] = await Promise.all([
      as('p2').post(`/api/party/invites/social/${inviteId}/accept`),
      as('p2').post(`/api/party/invites/social/${inviteId}/accept`),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 404]);
    expect(second.statusCode === 404 ? second.json() : first.json()).toEqual({ error: 'invite-not-found' });
    expect(await partyHashes()).toHaveLength(1);
  });

  it('two DIFFERENT invites from the same inviter never make two parties', async () => {
    const { as, partyHashes } = build();
    const firstSent = (await as('p1').post('/api/party/invites/social', { inviteeId: 'p2' })).json() as { inviteId: string };
    const secondSent = (await as('p1').post('/api/party/invites/social', { inviteeId: 'p3' })).json() as { inviteId: string };
    const [a, b] = await Promise.all([
      as('p2').post(`/api/party/invites/social/${firstSent.inviteId}/accept`),
      as('p3').post(`/api/party/invites/social/${secondSent.inviteId}/accept`),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    // Os dois caem na MESMA party: o que perde a corrida do SET NX entra na que ganhou.
    const partyA = a.json() as { id: string; members: Array<{ characterId: string }> };
    const partyB = b.json() as { id: string };
    expect(partyA.id).toBe(partyB.id);
    expect(partyA.members.map((member) => member.characterId).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(await partyHashes()).toHaveLength(1);
  });

  it('is typed: self, unknown invitee, inviter in hunt, invitee in another party, inviter gone, expired', async () => {
    const { as } = build();
    // Convite para si mesmo: 400.
    expect((await as('p1').post('/api/party/invites/social', { inviteeId: 'p1' })).json()).toEqual({ error: 'invite-self' });
    // Convidado que não existe: 404 (e não 403 — "não é seu" viraria verificador de ids).
    expect((await as('p1').post('/api/party/invites/social', { inviteeId: 'stranger' })).statusCode).toBe(404);
    // Convidador em hunt: 409 inviter-in-hunt (RF-08).
    const hunting = build({ locate: (characterId) => (characterId === 'p1' ? { type: 'hunt' } : null) });
    expect((await hunting.as('p1').post('/api/party/invites/social', { inviteeId: 'p2' })).json()).toEqual({ error: 'inviter-in-hunt' });
    // Convite normal, mas o convidado entra em outra party antes do aceite: recusa SEM consumir.
    const { inviteId } = (await as('p1').post('/api/party/invites/social', { inviteeId: 'p2' })).json() as { inviteId: string };
    const other = await as('p2').post('/api/party');
    expect(other.statusCode).toBe(200);
    const busy = await as('p2').post(`/api/party/invites/social/${inviteId}/accept`);
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toEqual({ error: 'in-another-party' });
    expect(((await as('p2').mine()).json() as { invites: Array<{ inviteId: string }> }).invites.map((invite) => invite.inviteId)).toEqual([inviteId]);
    // Convidador indisponível: virou MEMBRO de outra party — 409 inviter-unavailable.
    const otherId = (other.json() as { id: string }).id;
    await as('p2').post(`/api/party/${otherId}/leave`);
    const host = (await as('p3').post('/api/party')).json() as { id: string };
    await as('p3').post(`/api/party/${host.id}/invite`, { inviteeId: 'p1' });
    await as('p1').post(`/api/party/${host.id}/join`);
    const unavailable = await as('p2').post(`/api/party/invites/social/${inviteId}/accept`);
    expect(unavailable.statusCode).toBe(409);
    expect(unavailable.json()).toEqual({ error: 'inviter-unavailable' });
    // O convite continua de pé para quando o convidador se resolver.
    expect(((await as('p2').mine()).json() as { invites: unknown[] }).invites).toHaveLength(1);
    // Convite expirado (a chave sumiu pelo TTL): 404 invite-not-found, índice podado na leitura.
    await redis.del(`party:social-invite:${inviteId}`);
    const gone = await as('p2').post(`/api/party/invites/social/${inviteId}/accept`);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({ error: 'invite-not-found' });
    expect(((await as('p2').mine()).json() as { invites: unknown[] }).invites).toEqual([]);
  });

  it('the accept uses the party the inviter already leads when it exists and has room', async () => {
    const { as, partyHashes } = build();
    const { inviteId } = (await as('p1').post('/api/party/invites/social', { inviteeId: 'p2' })).json() as { inviteId: string };
    // O convidador criou a própria party entre o envio e o aceite: o aceite ENTRA nela.
    const created = await as('p1').post('/api/party');
    const partyId = (created.json() as { id: string }).id;
    const accepted = await as('p2').post(`/api/party/invites/social/${inviteId}/accept`);
    expect(accepted.statusCode).toBe(200);
    expect((accepted.json() as { id: string }).id).toBe(partyId);
    expect(((await as('p1').mine()).json() as { party: { members: Array<{ characterId: string }> } | null }).party?.members.map((member) => member.characterId)).toEqual(['p1', 'p2']);
    // Nenhuma party NOVA nasceu.
    expect(await partyHashes()).toHaveLength(1);
  });

  it('the accept refuses a candidate in a hunt (invariante 8)', async () => {
    const { as } = build({ locate: (characterId) => (characterId === 'p2' ? { type: 'hunt' } : null) });
    const { inviteId } = (await as('p1').post('/api/party/invites/social', { inviteeId: 'p2' })).json() as { inviteId: string };
    const refused = await as('p2').post(`/api/party/invites/social/${inviteId}/accept`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'not-in-city' });
    // E o convite NÃO foi consumido: o convidado aceita quando voltar.
    expect(((await as('p2').mine()).json() as { invites: unknown[] }).invites).toHaveLength(1);
  });

  it('a party born from a social invite follows the normal flow: configure, publish, public join', async () => {
    const { as } = build();
    const { inviteId } = (await as('p1').post('/api/party/invites/social', { inviteeId: 'p2' })).json() as { inviteId: string };
    const accepted = await as('p2').post(`/api/party/invites/social/${inviteId}/accept`);
    const id = (accepted.json() as { id: string }).id;
    // A party nasce em formação, com os dois eixos zerados e o líder certo.
    expect(accepted.json()).toMatchObject({ leaderId: 'p1', shareCosts: false, splitLoot: false, state: 'forming' });
    // E ela se comporta como qualquer party: o líder configura com composição, publica, e um
    // stranger da vocação certa entra pela sala.
    const configured = await as('p1').post(`/api/party/${id}/configure`, {
      huntId: 'arena', difficulty: 'bold', minLevel: 1, vocationTargets: { [NO_VOCATION]: 4 },
    });
    expect(configured.statusCode).toBe(200);
    expect((await as('p1').post(`/api/party/${id}/publish`)).statusCode).toBe(200);
    const strangerJoin = await as('p3').post(`/api/party/${id}/join`);
    expect(strangerJoin.statusCode).toBe(200);
    expect(((await as('p1').mine()).json() as { party: { members: unknown[] } | null }).party?.members).toHaveLength(3);
  });
});
