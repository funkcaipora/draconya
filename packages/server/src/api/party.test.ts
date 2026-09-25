import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { registerPartyRoutes } from './party.js';
import type { PartyRouteDependencies } from './party.js';
import type { IssueResult, PartyTicket } from '../tickets.js';
import type { CharacterRecord } from '../db/repository.js';
import { NO_VOCATION, PartyStore } from '../party-store.js';
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

const character = (id: string, accountId: string, over: Partial<CharacterRecord> = {}): CharacterRecord => ({
  id, accountId, name: `Hero ${id}`, vocation: null, level: 10, xp: 0, gold: 50,
  capacity: 400, premiumUntil: null, staminaMs: 86_400_000, staminaUpdatedAt: new Date(),
  state: 'city', sessionId: null, botConfig: null, skills: {}, outfitColors: null, bestiary: null,
  ammo: null, supplyStock: null, ammunitionStock: null,
  createdAt: new Date(),
  ...over,
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
  // Onde cada personagem está pelo diretório FAKE: sessão e nó. `locate` cobre o `type` que as
  // rotas antigas já usavam; `sessionId`/`nodeId` são a lotação viva e o nó do líder (#402).
  const locations = new Map<string, { sessionId: string; nodeId: string; type: string }>();
  const deps: PartyRouteDependencies = {
    party: new PartyStore(redis),
    tickets: {
      resolveNode: async () => ({ ok: true, node: NODE }),
      issue: async (_accountId, characterId, _initial, node, party) => {
        const result = over.issue?.(characterId) ?? {
          ok: true,
          value: { ticket: `tok-${characterId}`, wsUrl: `ws://n1:7171/?ticket=tok-${characterId}`, nodeId: node?.nodeId ?? 'n1', expiresAtMs: 1_000 },
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
    /** A busca de salas (RF-04) é DO personagem: `characterId` na query, posse conferida. */
    rooms: (query = '') => app.inject({
      method: 'GET', url: `/api/party/rooms?characterId=${characterId}${query}`,
      headers: { 'x-account': characters.get(characterId)?.accountId ?? 'nobody' },
    }),
  });
  return { app, as, issued, revoked, locations, characters, deps, redis };
}

describe.runIf(available)('as rotas da party (#195, ADR 0027 decisão 8)', () => {
  it('runs the whole flow: create, invite, join, configure, start — one ticket per member, no approval (RF-07)', async () => {
    const { as, issued } = build();
    const created = await as('p1').post('/api/party');
    expect(created.statusCode).toBe(200);
    const createdBody = created.json() as { id: string; members: Array<{ characterId: string; name: string }> };
    const id = createdBody.id;
    expect(createdBody.members).toEqual([{ characterId: 'p1', name: 'Hero p1' }]);

    // Sem convite e sem sala publicada: recusa tipada (RF-05).
    expect((await as('p2').post(`/api/party/${id}/join`)).statusCode).toBe(403);
    expect((await as('p2').post(`/api/party/${id}/join`)).json()).toEqual({ error: 'room-not-eligible' });
    // `p2` não é o líder — e ainda nem está na party.
    expect((await as('p2').post(`/api/party/${id}/invite`, { inviteeId: 'p3' })).statusCode).toBe(403);
    expect((await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p2' })).statusCode).toBe(200);
    const joined = await as('p2').post(`/api/party/${id}/join`);
    expect(joined.statusCode).toBe(200);
    expect((joined.json() as { members: Array<{ characterId: string; name: string }> }).members).toEqual([
      { characterId: 'p1', name: 'Hero p1' },
      { characterId: 'p2', name: 'Hero p2' },
    ]);

    // A rota de aprovação não existe mais (RF-07), e sem proposta não se inicia.
    expect((await as('p2').post(`/api/party/${id}/approve`)).statusCode).toBe(404);
    expect((await as('p1').post(`/api/party/${id}/propose`, { huntId: 'nope', difficulty: 'bold', mode: 'shared' })).statusCode).toBe(400);
    const proposed = await as('p1').post(`/api/party/${id}/propose`, { huntId: 'arena', difficulty: 'bold', mode: 'shared' });
    expect(proposed.statusCode).toBe(200);
    expect((proposed.json() as { members: Array<{ characterId: string; name: string }> }).members).toEqual([
      { characterId: 'p1', name: 'Hero p1' },
      { characterId: 'p2', name: 'Hero p2' },
    ]);

    // O líder inicia DIRETO: nada de "aguardando aprovação" (RF-07).
    const started = await as('p1').post(`/api/party/${id}/start`);
    expect(started.statusCode).toBe(200);
    const body = started.json() as { sessionId: string; ticket: { ticket: string } | null };
    expect(body.ticket?.ticket).toBe('tok-p1');
    // Dois tickets, o MESMO bloco de party em cada um, na ordem de entrada.
    expect(issued.map((entry) => entry.characterId)).toEqual(['p1', 'p2']);
    const party = issued[1]?.party;
    expect(party).toMatchObject({ sessionId: body.sessionId, leaderId: 'p1', mode: 'shared', huntId: 'arena', difficulty: 'bold' });
    expect(party?.members.map((m) => [m.characterId, m.accountId, m.initialCharacter.level])).toEqual([['p1', 'a1', 10], ['p2', 'a2', 10]]);
    // O outro pega o seu pelo `mine`, uma vez; depois, o ticket some mas a party CONTINUA (#402).
    const mine = await as('p2').mine();
    expect((mine.json() as { ticket: { ticket: string } | null }).ticket?.ticket).toBe('tok-p2');
    const after = (await as('p2').mine()).json() as { party: { state: string } | null; ticket: unknown; invites: unknown[] };
    expect(after.ticket).toBeNull();
    expect(after.party?.state).toBe('hunting');
    expect(after.invites).toEqual([]);
  });

  it('configure patches each axis alone and validates the composition against the catalog and maxMembers (RF-01, RF-02)', async () => {
    const { as } = build();
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    // Não-líder não configura.
    expect((await as('p2').post(`/api/party/${id}/configure`, { minLevel: 5 })).statusCode).toBe(403);
    // Chaves fora do catálogo ∪ none: 400 unknown-vocation.
    expect((await as('p1').post(`/api/party/${id}/configure`, { vocationTargets: { necromancer: 2 } })).json()).toEqual({ error: 'unknown-vocation' });
    // Soma > maxMembers do conteúdo (4 aqui): 400 composition-too-large — nunca um 8 escrito à mão.
    expect((await as('p1').post(`/api/party/${id}/configure`, { vocationTargets: { knight: 3, druid: 2 } })).json()).toEqual({ error: 'composition-too-large' });
    // Hunt e dificuldade validadas pelo conteúdo, cada eixo sozinho.
    expect((await as('p1').post(`/api/party/${id}/configure`, { huntId: 'nope' })).json()).toEqual({ error: 'unknown-hunt' });
    expect((await as('p1').post(`/api/party/${id}/configure`, { difficulty: 'nope' })).json()).toEqual({ error: 'unknown-difficulty' });
    // `none` é chave válida (personagem sem vocação, level < 8).
    const configured = await as('p1').post(`/api/party/${id}/configure`, {
      huntId: 'arena', difficulty: 'bold', minLevel: 10, vocationTargets: { [NO_VOCATION]: 4 },
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json()).toMatchObject({ huntId: 'arena', difficulty: 'bold', minLevel: 10, vocationTargets: { [NO_VOCATION]: 4 } });
    // Os dois eixos são independentes: shareCosts muda sozinho, e o patch parcial não apaga o resto.
    expect((await as('p1').post(`/api/party/${id}/configure`, { shareCosts: true })).json()).toMatchObject({ shareCosts: true, splitLoot: false });
    expect((await as('p1').post(`/api/party/${id}/configure`, { splitLoot: true })).json()).toMatchObject({ shareCosts: true, splitLoot: true, mode: 'shared' });
    expect((await as('p1').post(`/api/party/${id}/configure`, { shareCosts: false })).json()).toMatchObject({ shareCosts: false, splitLoot: true, mode: 'split' });
    expect((await as('p1').post(`/api/party/${id}/configure`, { splitLoot: false })).json()).toMatchObject({ shareCosts: false, splitLoot: false, mode: 'split' });
    // A composição continua lá: o patch dos eixos não tocou nela.
    expect(((await as('p1').post(`/api/party/${id}/configure`, { minLevel: 1 })).json() as { vocationTargets: unknown }).vocationTargets).toEqual({ [NO_VOCATION]: 4 });
  });

  it('publish validates the configured state and has no body (RF-03); unpublish closes without undoing', async () => {
    const { as } = build();
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    // Sem hunt proposta: recusa.
    expect((await as('p1').post(`/api/party/${id}/publish`)).json()).toEqual({ error: 'nothing-proposed' });
    await as('p1').post(`/api/party/${id}/configure`, { huntId: 'arena', difficulty: 'bold' });
    // Sem level mínimo: recusa.
    expect((await as('p1').post(`/api/party/${id}/publish`)).json()).toEqual({ error: 'not-configured' });
    await as('p1').post(`/api/party/${id}/configure`, { minLevel: 1 });
    // Sem nenhuma vaga pública (composição vazia): recusa.
    expect((await as('p1').post(`/api/party/${id}/publish`)).json()).toEqual({ error: 'no-vocation-slot' });
    await as('p1').post(`/api/party/${id}/configure`, { vocationTargets: { [NO_VOCATION]: 4 } });
    const published = await as('p1').post(`/api/party/${id}/publish`);
    expect(published.statusCode).toBe(200);
    expect((published.json() as { published: boolean }).published).toBe(true);
    // Fechar vagas não desfaz a configuração.
    await as('p1').post(`/api/party/${id}/unpublish`);
    const closed = (await as('p1').mine()).json() as { party: { published: boolean; minLevel: number | null; huntId: string | null } | null };
    expect(closed.party).toMatchObject({ published: false, minLevel: 1, huntId: 'arena' });
  });

  it('refuses a member in a hunt, and reserves nothing', async () => {
    const { as, issued } = build({ locate: (characterId) => (characterId === 'p2' ? { type: 'hunt' } : null) });
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p2' });
    await as('p2').post(`/api/party/${id}/join`);
    await as('p1').post(`/api/party/${id}/propose`, { huntId: 'arena', difficulty: 'bold', mode: 'split' });
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
    const formed = (matched.json() as { party: { leaderId: string; members: Array<{ characterId: string; name: string }> } | null }).party;
    expect(formed?.leaderId).toBe('p1');
    expect(formed?.members).toEqual([
      { characterId: 'p1', name: 'Hero p1' },
      { characterId: 'p2', name: 'Hero p2' },
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

    // Líder expulsa p2 -> 200, p2 removido, nomes presentes
    const kick = await as('p1').post(`/api/party/${id}/kick`, { targetId: 'p2' });
    expect(kick.statusCode).toBe(200);
    const body = kick.json() as { members: Array<{ characterId: string; name: string }> };
    expect(body.members).toEqual([
      { characterId: 'p1', name: 'Hero p1' },
      { characterId: 'p3', name: 'Hero p3' },
    ]);

    // Expulsar membro já removido -> 409
    const kickAgain = await as('p1').post(`/api/party/${id}/kick`, { targetId: 'p2' });
    expect(kickAgain.statusCode).toBe(409);
    expect(kickAgain.json()).toEqual({ error: 'target-not-a-member' });
  });

  it('caps the party at maxMembers, keeps one party per character, and only the leader configures', async () => {
    const { app, as } = build();
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    for (const member of ['p2', 'p3', 'p4', 'p5']) await as('p1').post(`/api/party/${id}/invite`, { inviteeId: member });
    for (const member of ['p2', 'p3', 'p4']) expect((await as(member).post(`/api/party/${id}/join`)).statusCode).toBe(200);
    expect((await as('p5').post(`/api/party/${id}/join`)).json()).toEqual({ error: 'party-full' });
    expect((await as('p2').post('/api/party')).json()).toEqual({ error: 'already-in-party' });
    expect((await as('p2').post(`/api/party/${id}/propose`, { huntId: 'arena', difficulty: 'bold', mode: 'split' })).statusCode).toBe(403);
    // O líder que sai passa a liderança.
    await as('p1').post(`/api/party/${id}/propose`, { huntId: 'arena', difficulty: 'bold', mode: 'split' });
    const left = await as('p1').post(`/api/party/${id}/leave`);
    expect((left.json() as { party: { leaderId: string } }).party).toMatchObject({ leaderId: 'p2' });
    // Quem não é dono do personagem não fala por ele: `p3` com a conta de `p5`.
    const forged = await app.inject({ method: 'POST', url: '/api/party', payload: { characterId: 'p3' }, headers: { 'x-account': 'a5' } });
    expect(forged.statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/party', payload: { characterId: 'p3' } })).statusCode).toBe(401);
  });
});

// A party em curso, a sala pública e a busca (RF-04, #402, ADR 0035 D7/D8). O `api` sozinho
// não decide a capacidade definitiva — o que se prende aqui é a elegibilidade, o ticket de
// entrada, os índices e o FILTRO do servidor; a recusa por lotação de verdade é do `onEnter`
// no `game` (testado em host.test.ts).
describe.runIf(available)('a party em curso, a sala pública e a busca (#402, #501)', () => {
  async function startedParty(over: {
    minLevel?: number;
    vocationTargets?: Record<string, number>;
  } = {}) {
    const context = build();
    const { as } = context;
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    await as('p1').post(`/api/party/${id}/configure`, {
      huntId: 'arena', difficulty: 'bold', minLevel: over.minLevel ?? 1,
      // Sem composição não há vaga pública: a de teste abre `none` para todos que couberem.
      vocationTargets: over.vocationTargets ?? { [NO_VOCATION]: 4 },
    });
    await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p2' });
    await as('p2').post(`/api/party/${id}/join`);
    await as('p1').post(`/api/party/${id}/publish`);
    const started = await as('p1').post(`/api/party/${id}/start`);
    expect(started.statusCode).toBe(200);
    const sessionId = (started.json() as { sessionId: string }).sessionId;
    context.locations.set('p1', { sessionId, nodeId: 'n1', type: 'hunt' });
    context.locations.set('p2', { sessionId, nodeId: 'n1', type: 'hunt' });
    return { ...context, id, sessionId };
  }

  it('publishes a room that the eligible candidate lists, with composition and open slots (RF-04)', async () => {
    const { as, id } = await startedParty();
    const rooms = await as('p3').rooms();
    expect(rooms.statusCode).toBe(200);
    const listed = rooms.json() as { rooms: Array<{
      partyId: string; leader: { characterId: string; name: string; level: number };
      members: number; maxMembers: number; minLevel: number; state: string;
      vocationTargets: Record<string, number>; openSlots: Record<string, number>;
    }> };
    expect(listed.rooms.map((room) => room.partyId)).toContain(id);
    expect(listed.rooms[0]?.leader).toEqual({ characterId: 'p1', name: 'Hero p1', level: 10 });
    expect(listed.rooms[0]?.members).toBe(2);
    expect(listed.rooms[0]?.maxMembers).toBe(4);
    expect(listed.rooms[0]?.minLevel).toBe(1);
    expect(listed.rooms[0]?.state).toBe('hunting');
    expect(listed.rooms[0]?.vocationTargets).toEqual({ [NO_VOCATION]: 4 });
    expect(listed.rooms[0]?.openSlots).toEqual({ [NO_VOCATION]: 2 });
    await as('p1').post(`/api/party/${id}/unpublish`);
    const after = await as('p3').rooms();
    expect((after.json() as { rooms: unknown[] }).rooms).toEqual([]);
  });

  it('rooms hides rooms below minLevel, of another hunt, full, and without a vocation slot for the candidate', async () => {
    const context = await startedParty({ minLevel: 20, vocationTargets: { [NO_VOCATION]: 3, druid: 1 } });
    const { as, id, locations, sessionId, characters } = context;
    // Level 10 < minLevel 20: a sala some (não fica desabilitada).
    expect(((await as('p3').rooms()).json() as { rooms: unknown[] }).rooms).toEqual([]);
    // Outro candidato no level: vê a sala.
    context.characters.set('p3', character('p3', 'a3', { level: 20 }));
    expect(((await as('p3').rooms()).json() as { rooms: Array<{ partyId: string }> }).rooms.map((room) => room.partyId)).toContain(id);
    // Filtro por hunt: sala de outra hunt some, a da hunt pedida fica.
    expect(((await as('p3').rooms('&huntId=cellars')).json() as { rooms: unknown[] }).rooms).toEqual([]);
    expect(((await as('p3').rooms('&huntId=arena')).json() as { rooms: Array<{ partyId: string }> }).rooms.map((room) => room.partyId)).toContain(id);
    // Vocação sem linha na composição: o sorcerer não tem vaga nenhuma, e a sala some para ele.
    context.characters.set('p4', character('p4', 'a4', { vocation: 'sorcerer', level: 20 }));
    expect(((await as('p4').rooms()).json() as { rooms: unknown[] }).rooms).toEqual([]);
    // O druid (level 20, vaga 0/1) vê a sala.
    context.characters.set('p5', character('p5', 'a5', { vocation: 'druid', level: 20 }));
    expect(((await as('p5').rooms()).json() as { rooms: Array<{ partyId: string }> }).rooms.map((room) => room.partyId)).toContain(id);
    // p3 (none) e p5 (druid) entram em curso, cada um pela VAGA dele (o líder está em hunt,
    // então convite nenhum sai — RF-08): a composição fecha e a sala some para o sorcerer,
    // que não tinha vaga nenhuma — agora também porque a lotação viva fechou o teto.
    for (const member of ['p3', 'p5']) {
      expect((await as(member).post(`/api/party/${id}/join`)).statusCode).toBe(200);
      locations.set(member, { sessionId, nodeId: 'n1', type: 'hunt' });
    }
    expect(((await as('p4').rooms()).json() as { rooms: unknown[] }).rooms).toEqual([]);
    // A busca exige posse: outro dono não vê a sala de ninguém — coberto pelo `whoQuery`.
  });

  it('joins a hunting party by public room, reserving the vocation slot, and emits a one-member `join: true` ticket (RF-05, RF-06)', async () => {
    const { as, issued, id, sessionId, characters } = await startedParty();
    const join = await as('p3').post(`/api/party/${id}/join`);
    expect(join.statusCode).toBe(200);
    expect((join.json() as { sessionId: string }).sessionId).toBe(sessionId);
    const ticket = issued[issued.length - 1]?.party;
    expect(ticket).toMatchObject({ join: true, sessionId, leaderId: 'p1', huntId: 'arena', difficulty: 'bold' });
    expect(ticket?.members).toHaveLength(1);
    expect(ticket?.members[0]).toMatchObject({ characterId: 'p3', accountId: 'a3' });
    // Uma vocação SEM linha na composição não entra em curso (RF-05) — nem com a sala publicada.
    characters.set('p4', character('p4', 'a4', { vocation: 'druid' }));
    const withoutSlot = await as('p4').post(`/api/party/${id}/join`);
    expect(withoutSlot.statusCode).toBe(409);
    expect((withoutSlot.json() as { error: string }).error).toBe('no-vocation-slot');
  });

  it('refuses a public-room join outside the configured minimum level (RF-04, RF-05)', async () => {
    const { as, id } = await startedParty({ minLevel: 20 });
    const join = await as('p3').post(`/api/party/${id}/join`);
    expect(join.statusCode).toBe(403);
    expect(join.json()).toEqual({ error: 'room-not-eligible' });
  });

  it('the running join that fails to issue the ticket releases the reserved slot (RF-06)', async () => {
    let allow = false;
    const context = build({
      issue: (characterId) => (characterId === 'p3' && !allow
        ? { ok: false, reason: 'active-limit' }
        : { ok: true, value: { ticket: `tok-${characterId}`, wsUrl: 'ws://x', nodeId: 'n1', expiresAtMs: 1 } }),
    });
    const { as, issued, redis, locations } = context;
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    await as('p1').post(`/api/party/${id}/configure`, {
      huntId: 'arena', difficulty: 'bold', minLevel: 1, vocationTargets: { [NO_VOCATION]: 3 },
    });
    await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p2' });
    await as('p2').post(`/api/party/${id}/join`);
    await as('p1').post(`/api/party/${id}/publish`);
    const started = await as('p1').post(`/api/party/${id}/start`);
    expect(started.statusCode).toBe(200);
    const sessionId = (started.json() as { sessionId: string }).sessionId;
    locations.set('p1', { sessionId, nodeId: 'n1', type: 'hunt' });
    locations.set('p2', { sessionId, nodeId: 'n1', type: 'hunt' });

    // A reserva acontece; a EMISSÃO falha: rollback = vaga de volta, ticket nenhum emitido.
    const first = await as('p3').post(`/api/party/${id}/join`);
    expect(first.statusCode).toBe(409);
    expect(first.json()).toEqual({ error: 'active-limit' });
    expect(issued.map((entry) => entry.characterId)).toEqual(['p1', 'p2']);
    // Mutação que mata: sem rollback, o hash `:vocations` guardaria o p3 fantasma — o teto
    // de 3 (`none`) estaria estourado com quem nunca entrou.
    expect(await redis.hexists(`party:${id}:vocations`, 'p3')).toBe(0);
    // Com a emissão curando, o MESMO personagem entra de vaga nova.
    allow = true;
    const retried = await as('p3').post(`/api/party/${id}/join`);
    expect(retried.statusCode).toBe(200);
    expect(await redis.hexists(`party:${id}:vocations`, 'p3')).toBe(1);
  });

  it('refuses an invite from a leader in a hunt (RF-08), and respects maxMembers when forming', async () => {
    const { as, id } = await startedParty();
    // O líder está na hunt: convite nenhum sai — nem para party em curso (RF-08).
    const inHunt = await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p3' });
    expect(inHunt.statusCode).toBe(409);
    expect(inHunt.json()).toEqual({ error: 'inviter-in-hunt' });
    // Fora de hunt, o convite continua respeitando o teto: party formando cheia não convida.
    // O p1 sai da party em hunt (que continua de pé com o p2) para poder formar outra.
    await as('p1').post(`/api/party/${id}/leave`);
    const forming = build();
    const id2 = ((await forming.as('p1').post('/api/party')).json() as { id: string }).id;
    for (const member of ['p2', 'p3', 'p4', 'p5']) {
      await forming.as('p1').post(`/api/party/${id2}/invite`, { inviteeId: member });
    }
    for (const member of ['p3', 'p4', 'p5']) {
      await forming.as(member).post(`/api/party/${id2}/join`);
    }
    // p2 está ocupado em outra party; o teto de 4 fecha com p1 + p3 + p4 + p5.
    const fifth = await forming.as('p1').post(`/api/party/${id2}/invite`, { inviteeId: 'p2' });
    expect(fifth.statusCode).toBe(409);
    expect(fifth.json()).toEqual({ error: 'party-full' });
  });

  it('an invited character joins even outside the public filters, as long as the inviter is out of a hunt', async () => {
    const { as } = build();
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    // Level 3 e vocação fora da composição: o convite é decisão explícita (#499 §3).
    await as('p1').post(`/api/party/${id}/configure`, {
      huntId: 'arena', difficulty: 'bold', minLevel: 20, vocationTargets: { knight: 2 },
    });
    await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p2' });
    const joined = await as('p2').post(`/api/party/${id}/join`);
    expect(joined.statusCode).toBe(200);
    expect(((await as('p1').mine()).json() as { party: { members: unknown[] } | null }).party?.members).toHaveLength(2);
  });

  it('a published forming party accepts a qualified stranger without an invite, and only with a vocation slot (DT-04, RF-05)', async () => {
    const { as, characters } = build();
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    await as('p1').post(`/api/party/${id}/configure`, {
      huntId: 'arena', difficulty: 'bold', minLevel: 1, vocationTargets: { knight: 2 },
    });
    await as('p1').post(`/api/party/${id}/publish`);
    // Sem vocação e sem linha na composição: recusa.
    const noneJoin = await as('p3').post(`/api/party/${id}/join`);
    expect(noneJoin.statusCode).toBe(409);
    expect(noneJoin.json()).toEqual({ error: 'no-vocation-slot' });
    // Um knight entra sem convite nenhum — a sala publicada convida implicitamente (DT-04).
    characters.set('p3', character('p3', 'a3', { vocation: 'knight' }));
    const joined = await as('p3').post(`/api/party/${id}/join`);
    expect(joined.statusCode).toBe(200);
    expect((joined.json() as { members: Array<{ characterId: string }> }).members.map((m) => m.characterId)).toEqual(['p1', 'p3']);
  });

  it('shows the pre-start invite to the invitee in `mine`, and `decline` clears it (RF-07, RF-08)', async () => {
    // Convite existe em FORMAÇÃO: durante a hunt ninguém convida (RF-08), então o índice
    // reverso é exercitado antes do start — e o `/mine` continua sendo o polling único.
    const { as } = build();
    const id = ((await as('p1').post('/api/party')).json() as { id: string }).id;
    await as('p1').post(`/api/party/${id}/invite`, { inviteeId: 'p5' });
    const mine = (await as('p5').mine()).json() as { invites: Array<{ partyId: string; leaderId: string; leaderName: string; huntId: string | null; state: string }> };
    expect(mine.invites).toEqual([{ partyId: id, leaderId: 'p1', leaderName: 'Hero p1', huntId: null, state: 'forming' }]);
    const declined = await as('p5').post(`/api/party/${id}/decline`);
    expect(declined.statusCode).toBe(200);
    expect(((await as('p5').mine()).json() as { invites: unknown[] }).invites).toEqual([]);
  });
});
