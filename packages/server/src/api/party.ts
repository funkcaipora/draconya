// A formação da party de hunt (#195, ADR 0027 decisão 8): HTTP, no `api`, em Redis.
//
// O personagem está na Cidade, e a Cidade é inerte — nada disto passa pela sessão. Criar,
// convidar, configurar, entrar, sair são escritas num formulário em Redis (`PartyStore`);
// `start` é o que faz para N o que `POST /api/tickets` faz para um: valida, liquida o
// progresso pendente de cada um, escolhe UM nó, emite um ticket por membro com o mesmo
// `sessionId` e o bloco `party`, e apaga o formulário. Daqui em diante a sessão é a party.
//
// Desde a #501 o líder configura a sala (hunt, dificuldade, level mínimo e composição por
// vocação), a busca de salas FILTRA no servidor pela elegibilidade do candidato, o join
// público valida a vaga por vocação ATOMICAMENTE em Lua, o `/join` em curso RESERVA a vaga
// antes da resposta (com rollback), a aprovação pré-start não existe mais, e o convite —
// tradicional ou social — só sai de quem está fora de hunt.
//
// Tudo aqui é INTENÇÃO (invariante 4): quem decide se a party existe, quem lidera, quem cabe
// na sala e se a hunt começa é este processo, nunca o corpo do request.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { GameRepository } from '../db/repository.js';
import type { IssueFailure, IssuedTicket, PartyTicket, TicketService } from '../tickets.js';
import type { PartyRecord, PartyStore } from '../party-store.js';
import { NO_VOCATION } from '../party-store.js';
import type { SessionDirectory } from '../directory.js';
import { initialCharacterOf } from './tickets.js';
import type { Principal, SettlementResult } from './tickets.js';

export interface PartyRouteDependencies {
  readonly party: PartyStore;
  readonly tickets: Pick<TicketService, 'issue' | 'resolveNode' | 'revoke'>;
  readonly authenticate: (request: FastifyRequest) => Promise<Principal | null>;
  readonly ownsCharacter: GameRepository['ownsCharacter'];
  readonly getCharacter: GameRepository['getCharacter'];
  /** Por chave primária (DT-07): o nome do convidador de um convite social. */
  readonly getCharacterById: GameRepository['getCharacterById'];
  readonly listItemInstances?: GameRepository['listItemInstances'];
  readonly settleProgress: (characterId: string) => Promise<SettlementResult>;
  /** Onde o personagem está, segundo o diretório: só quem está na Cidade (ou em repouso) inicia. */
  readonly locateSession: (characterId: string) => Promise<{ type: string } | null>;
  /**
   * O diretório de sessões, para a LOTACÃO VIVA (#402): quem ainda está na sessão da party é
   * `lookup(member).sessionId === party.sessionId`, e o nó do líder vem de `node(nodeId)`. O
   * `api` só LÊ o diretório; quem escreve estado quente é a sessão dona (invariante 9).
   */
  readonly directory: Pick<SessionDirectory, 'lookup' | 'node'>;
  /** Os limites e o catálogo, do conteúdo fixado no boot — a rota não recebe o `Content` inteiro. */
  readonly limits: {
    readonly maxMembers: number;
    /** A versão de conteúdo deste processo, para o teste de versão do `/join` (invariante 7). */
    readonly contentVersion: string;
    /** As dificuldades da hunt, ou `null` se ela não existe. */
    readonly difficultiesOf: (huntId: string) => readonly string[] | null;
    /** As vocações do catálogo fixado no boot: as chaves de `vocationTargets` vêm daqui ∪ `none`. */
    readonly vocations: readonly string[];
  };
  /** Quanto tempo o ticket de cada membro fica esperando ser pego. Padrão: 30 s. */
  readonly ticketTtlMs?: number;
  /** A faixa de level do matchmaking (#199, §43.2 aberto). `0` desliga o filtro. */
  readonly matchmakingLevelRange?: number;
}

/** `inviteeId`, e não `characterId`: este é o personagem de QUEM convida, no mesmo corpo. */
const Invite = z.object({ inviteeId: z.string().min(1).max(128) });
/** `targetId`, e não `characterId`: este é o personagem de QUEM FALA (o líder); o alvo vai
 * separado, como `inviteeId` já faz em `Invite`. */
const Kick = z.object({ targetId: z.string().min(1).max(128) });
/**
 * O patch do `/configure` (RF-02): cada eixo muda sozinho, e só o que veio é aplicado.
 * `vocationTargets` é vocação → TOTAL desejado; quem valida as chaves contra o catálogo e a
 * soma contra `maxMembers` é a rota, que tem os dois.
 */
const Configure = z.object({
  huntId: z.string().min(1).max(128).optional(),
  difficulty: z.string().min(1).max(64).optional(),
  minLevel: z.number().int().min(1).max(1_000).optional(),
  vocationTargets: z.record(z.string().min(1).max(64), z.number().int().min(0).max(1_000)).optional(),
  shareCosts: z.boolean().optional(),
  splitLoot: z.boolean().optional(),
});
/** DT-05: o corpo legado do `/propose`, que hoje é um shim da MESMA escrita do `/configure`. */
const Propose = z.object({
  huntId: z.string().min(1).max(128),
  difficulty: z.string().min(1).max(64),
  /**
   * O `mode` legado de um cliente anterior ao #400; os dois eixos são o formato novo
   * (ADR 0035 D1). Um dos dois tem de vir: o `mode` sozinho migra para os eixos, e os eixos
   * sozinhos derivam o `mode` — as duas formas produzem o mesmo ticket.
   */
  mode: z.enum(['split', 'shared']).optional(),
  shareCosts: z.boolean().optional(),
  splitLoot: z.boolean().optional(),
}).refine(
  (value) => value.mode !== undefined || value.shareCosts !== undefined || value.splitLoot !== undefined,
  { message: 'informe mode ou os dois eixos' },
);
const Selected = z.object({ characterId: z.string().min(1).max(128) });
const RoomsQuery = z.object({
  characterId: z.string().min(1).max(128),
  huntId: z.string().min(1).max(128).optional(),
});

const STATUS: Record<IssueFailure, number> = {
  'active-limit': 409,
  'no-node-available': 503,
  'session-node-unavailable': 503,
};

/** A recusa de entrada numa party em curso, com o status do `game`/`api` (#402, DT-02). */
export type RunningJoinRefusal = 'party-full' | 'content-version' | 'session-not-here' | 'room-not-eligible';

/**
 * A lotação VIVA (#402, D7): quem ainda está na sessão da party, pelo diretório. Quem saiu da
 * hunt perdeu o lease e é podado do ZSET na mesma passada — a party formada continua sendo a
 * lista original, mas a CONTAGEM é do diretório, nunca do Redis do formulário.
 */
async function liveMembers(
  party: PartyRecord, deps: Pick<PartyRouteDependencies, 'party' | 'directory'>,
): Promise<readonly string[]> {
  if (party.state !== 'hunting' || party.sessionId === null) return party.members;
  const alive: string[] = [];
  for (const characterId of party.members) {
    const location = await deps.directory.lookup(characterId);
    if (location?.sessionId === party.sessionId) alive.push(characterId);
    else await deps.party.prune(party.id, characterId);
  }
  return alive;
}

/** A lista de vocações presentes, pela linha de cada membro — a mesma leitura de sempre. */
async function vocationsOf(
  members: readonly string[],
  party: PartyRecord,
  getCharacter: PartyRouteDependencies['getCharacter'],
): Promise<string[]> {
  const vocations = new Set<string>();
  for (const member of members) {
    const accountId = party.accounts[member];
    const character = accountId === undefined ? null : await getCharacter(accountId, member);
    if (character?.vocation !== null && character?.vocation !== undefined) vocations.add(character.vocation);
  }
  return [...vocations];
}

type PartyFormView = {
  id: string; leaderId: string; mode: PartyRecord['mode']; shareCosts: boolean; splitLoot: boolean;
  huntId: string | null;
  difficulty: string | null;
  state: PartyRecord['state'];
  sessionId: string | null;
  published: boolean;
  minLevel: number | null;
  maxLevel: number | null;
  vocationTargets: Readonly<Record<string, number>>;
  openSlots: Readonly<Record<string, number>>;
  members: Array<{ characterId: string; name: string }>;
};

async function view(
  party: PartyRecord,
  deps: Pick<PartyRouteDependencies, 'getCharacter' | 'party'>,
): Promise<PartyFormView> {
  const members = await Promise.all(party.members.map(async (characterId) => {
    const accountId = party.accounts[characterId];
    // Entrada corrompida (conta divergente, personagem apagado) vira AUSENTE, nunca resposta
    // recusada — a mesma régua de outfit/bestiary/bot-config (ver CLAUDE.md de `server`).
    const character = accountId === undefined ? null : await deps.getCharacter(accountId, characterId);
    return { characterId, name: character?.name ?? characterId };
  }));
  return {
    id: party.id, leaderId: party.leaderId, mode: party.mode,
    shareCosts: party.shareCosts, splitLoot: party.splitLoot,
    huntId: party.huntId, difficulty: party.difficulty,
    state: party.state, sessionId: party.sessionId, published: party.published,
    minLevel: party.minLevel, maxLevel: party.maxLevel,
    vocationTargets: party.vocationTargets,
    openSlots: await deps.party.openSlots(party.id, party.vocationTargets),
    members,
  };
}

/**
 * A entrada numa party em CURSO (#402, ADR 0035 D7). O cliente manda só a intenção; quem
 * decide elegibilidade, lotação, versão de conteúdo e o nó é este processo. O teto aqui é
 * OTIMISTA — a recusa definitiva é o `onEnter` do `sim`, dentro do ciclo da sessão dona (DT-02).
 *
 * A vaga por vocação é RESERVADA antes da emissão (DT-04, RF-06): o Lua conta o que já foi
 * reservado, e qualquer falha depois da reserva solta a vaga de volta — rollback é
 * `releaseSlot` + `revoke` do ticket, nunca um membro fantasma.
 */
async function joinRunningParty(
  me: { accountId: string; characterId: string },
  party: PartyRecord,
  deps: PartyRouteDependencies,
): Promise<{ status: number; body: unknown }> {
  if (party.sessionId === null || party.huntId === null || party.difficulty === null) {
    return { status: 409, body: { error: 'nothing-proposed' } };
  }
  // Quem entra numa hunt em curso está na Cidade (ou em repouso — Cidade sem sessão, ADR 0024).
  const current = await deps.locateSession(me.characterId);
  if (current !== null && current.type !== 'city') return { status: 409, body: { error: 'not-in-city' } };

  // Elegibilidade: convite explícito OU sala publicada com o level no mínimo (RF-05).
  const invited = await deps.party.isInvited(party.id, me.characterId);
  const candidate = await deps.getCharacter(me.accountId, me.characterId);
  if (candidate === null) return { status: 404, body: { error: 'character-not-found' } };
  if (!invited && (!party.published || party.minLevel === null || candidate.level < party.minLevel)) {
    return { status: 403, body: { error: 'room-not-eligible' } };
  }

  const alive = await liveMembers(party, deps);
  if (alive.length >= deps.limits.maxMembers) return { status: 409, body: { error: 'party-full' } };
  if (party.contentVersion !== deps.limits.contentVersion) {
    return { status: 409, body: { error: 'content-version' } };
  }

  // O progresso pendente dele entra na tabela antes da emissão — o MESMO caminho do `/start`.
  let settlement: SettlementResult;
  try {
    settlement = await deps.settleProgress(me.characterId);
  } catch {
    return { status: 503, body: { error: 'progress-not-settled' } };
  }
  if (settlement.failed > 0) return { status: 503, body: { error: 'progress-not-settled' } };

  // O nó da SESSÃO do líder, não o de um nó qualquer: o ticket amarra ao nó que a hospeda.
  const location = await deps.directory.lookup(party.leaderId);
  const node = location === null ? null : await deps.directory.node(location.nodeId);
  if (node === null) return { status: 503, body: { error: 'session-not-here' } };

  // ORDEM (RF-06): settle → nó → RESERVA → emissão → inscrição. A reserva é Lua — dois joins
  // na última vaga da mesma vocação não passam os dois.
  const reserved = await deps.party.reserveSlot(party.id, me.characterId, {
    maxMembers: deps.limits.maxMembers,
    vocation: candidate.vocation,
    targets: party.vocationTargets,
    invited,
  });
  if (reserved === 'not-found') return { status: 404, body: { error: 'party-not-found' } };
  if (reserved === 'full') return { status: 409, body: { error: 'party-full' } };
  if (reserved === 'no-vocation-slot') return { status: 409, body: { error: 'no-vocation-slot' } };
  if (reserved === 'already-member') return { status: 409, body: { error: 'already-in-party' } };

  const ticket: PartyTicket = {
    sessionId: party.sessionId, leaderId: party.leaderId,
    shareCosts: party.shareCosts, splitLoot: party.splitLoot,
    huntId: party.huntId, difficulty: party.difficulty, join: true,
    members: [{
      characterId: me.characterId, accountId: me.accountId,
      initialCharacter: initialCharacterOf(candidate, await deps.listItemInstances?.(me.characterId) ?? []),
    }],
  };
  const issued = await deps.tickets.issue(
    me.accountId, me.characterId, ticket.members[0]?.initialCharacter, node, ticket,
  );
  if (!issued.ok) {
    // Rollback (RF-06): sem ticket, a reserva volta — a vaga não pode ficar fantasma.
    await deps.party.releaseSlot(party.id, me.characterId);
    return { status: STATUS[issued.reason], body: { error: issued.reason } };
  }
  try {
    // Só DEPOIS do ticket: falha na emissão não deixa membro fantasma no roster.
    await deps.party.enroll(party.id, me.characterId, me.accountId);
  } catch (error) {
    // Falhou DEPOIS do ticket: revoga o que saiu e solta a vaga — nada fica pela metade.
    await deps.tickets.revoke(issued.value.ticket, me.accountId, me.characterId).catch(() => undefined);
    await deps.party.releaseSlot(party.id, me.characterId).catch(() => undefined);
    throw error;
  }
  return { status: 200, body: { sessionId: ticket.sessionId, ticket: issued.value } };
}

/** A sala publicada, para `GET /api/party/rooms` (D8, RF-04). */
async function roomView(
  party: PartyRecord,
  members: readonly string[],
  openSlots: Readonly<Record<string, number>>,
  deps: Pick<PartyRouteDependencies, 'getCharacter' | 'limits'>,
): Promise<{
  partyId: string; huntId: string | null; difficulty: string | null;
  leader: { characterId: string; name: string; level: number };
  vocations: string[]; members: number; maxMembers: number;
  minLevel: number | null; state: PartyRecord['state'];
  vocationTargets: Readonly<Record<string, number>>; openSlots: Readonly<Record<string, number>>;
}> {
  const leaderAccount = party.accounts[party.leaderId];
  const leader = leaderAccount === undefined ? null : await deps.getCharacter(leaderAccount, party.leaderId);
  return {
    partyId: party.id, huntId: party.huntId, difficulty: party.difficulty,
    leader: { characterId: party.leaderId, name: leader?.name ?? party.leaderId, level: leader?.level ?? 0 },
    vocations: await vocationsOf(members, party, deps.getCharacter),
    members: members.length, maxMembers: deps.limits.maxMembers,
    minLevel: party.minLevel, state: party.state,
    vocationTargets: party.vocationTargets, openSlots,
  };
}

/**
 * Registra as rotas. Cada uma começa do mesmo jeito: quem é (sessão HTTP), com qual personagem
 * (`characterId` no corpo, e a posse é conferida ANTES de qualquer efeito — ADR 0024), e em que
 * party ele está.
 */
export function registerPartyRoutes(app: FastifyInstance, deps: PartyRouteDependencies): void {
  const ticketTtlMs = deps.ticketTtlMs ?? 30_000;

  /** Autentica e confere a posse do personagem do corpo. `null` já respondeu. */
  async function who(
    request: FastifyRequest, reply: FastifyReply,
  ): Promise<{ accountId: string; characterId: string } | null> {
    const body = Selected.safeParse(request.body);
    if (!body.success) {
      await reply.code(400).send({ error: 'invalid-body' });
      return null;
    }
    const principal = await deps.authenticate(request);
    if (principal === null) {
      await reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    // 404, e não 403: "existe, mas não é seu" faria disto um verificador de ids.
    if (!await deps.ownsCharacter(principal.accountId, body.data.characterId)) {
      await reply.code(404).send({ error: 'character-not-found' });
      return null;
    }
    return { accountId: principal.accountId, characterId: body.data.characterId };
  }

  /** Como `who`, para GET: o personagem vai na query, e a posse é conferida do mesmo jeito. */
  async function whoQuery(
    request: FastifyRequest, reply: FastifyReply,
    query: { characterId: string },
  ): Promise<{ accountId: string; characterId: string } | null> {
    const principal = await deps.authenticate(request);
    if (principal === null) {
      await reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    if (!await deps.ownsCharacter(principal.accountId, query.characterId)) {
      await reply.code(404).send({ error: 'character-not-found' });
      return null;
    }
    return { accountId: principal.accountId, characterId: query.characterId };
  }

  app.post('/api/party', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const character = await deps.getCharacter(me.accountId, me.characterId);
    if (character === null) return reply.code(404).send({ error: 'character-not-found' });
    const party = await deps.party.create(me.characterId, me.accountId, character.vocation);
    if (party === null) return reply.code(409).send({ error: 'already-in-party' });
    return reply.send(await view(party, deps));
  });

  app.get('/api/party/mine', async (request, reply) => {
    // `mine` é GET: o personagem vai na query, e a posse é conferida do mesmo jeito.
    const query = Selected.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid-query' });
    const principal = await deps.authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (!await deps.ownsCharacter(principal.accountId, query.data.characterId)) {
      return reply.code(404).send({ error: 'character-not-found' });
    }
    // Depois do `start` a party SOBREVIVE (#402): o ticket continua de uso único, mas o registro
    // responde `party.state === 'hunting'` depois que ele já foi pego. E os convites pendentes vêm
    // pelos DOIS índices reversos — o tradicional e o social (RF-09, DT-06) — numa lista única,
    // para o polling do Shell continuar sendo um só.
    const ticket = await deps.party.takeTicket(query.data.characterId);
    const record = await deps.party.of(query.data.characterId);
    const traditional = await Promise.all(
      (await deps.party.invitesOf(query.data.characterId)).map(async (id) => {
        const invited = await deps.party.get(id);
        if (invited === null) return null;
        const leaderAccount = invited.accounts[invited.leaderId];
        const leader = leaderAccount === undefined
          ? null
          : await deps.getCharacter(leaderAccount, invited.leaderId);
        return {
          partyId: id, leaderId: invited.leaderId, leaderName: leader?.name ?? invited.leaderId,
          huntId: invited.huntId, state: invited.state,
        };
      }),
    );
    const social = await Promise.all(
      (await deps.party.socialInvitesOf(query.data.characterId)).map(async (invite) => {
        const inviter = await deps.getCharacterById(invite.inviterCharacterId);
        return {
          inviteId: invite.inviteId, leaderId: invite.inviterCharacterId,
          leaderName: inviter?.name ?? invite.inviterCharacterId,
          createdAtMs: invite.createdAtMs,
        };
      }),
    );
    return reply.send({
      party: record === null ? null : await view(record, deps),
      ticket,
      invites: [
        ...traditional.filter((invite): invite is NonNullable<typeof invite> => invite !== null),
        ...social,
      ],
    });
  });

  // O matchmaking (#199, §15.2): FORMA a party, não a inicia. Quem entra na fila ou casa na
  // hora — e a party formada segue o fluxo de sempre: o líder configura e inicia, ou fica
  // esperando quem vier. A faixa de level é do conteúdo; `0` é "qualquer um".
  app.post('/api/matchmaking/join', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const character = await deps.getCharacter(me.accountId, me.characterId);
    if (character === null) return reply.code(404).send({ error: 'character-not-found' });
    const location = await deps.locateSession(me.characterId);
    if (location !== null && location.type !== 'city') return reply.code(409).send({ error: 'not-in-city' });
    const result = await deps.party.enqueue(
      me.characterId, me.accountId, character.level, character.vocation,
      deps.matchmakingLevelRange ?? 0, deps.limits.maxMembers,
    );
    if (result === 'in-party') return reply.code(409).send({ error: 'already-in-party' });
    return reply.send({ party: result === null ? null : await view(result, deps) });
  });

  app.post('/api/matchmaking/leave', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    await deps.party.dequeue(me.characterId);
    return reply.send({ ok: true });
  });

  app.post('/api/party/:id/invite', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const invite = Invite.safeParse(request.body);
    if (!invite.success) return reply.code(400).send({ error: 'invalid-body' });
    const party = await deps.party.get((request.params as { id: string }).id);
    if (party === null) return reply.code(404).send({ error: 'party-not-found' });
    if (party.leaderId !== me.characterId) return reply.code(403).send({ error: 'not-leader' });
    // Convidar é da Cidade (RF-08): quem está numa hunt não convida — vale para o convite
    // tradicional e para o social, pela MESMA régua do diretório (DT-02).
    const location = await deps.locateSession(me.characterId);
    if (location !== null && location.type !== 'city') {
      return reply.code(409).send({ error: 'inviter-in-hunt' });
    }
    // Lotação também trava o convite (§20.1): a contagem é VIVA quando a hunt já começou.
    const count = (await liveMembers(party, deps)).length;
    if (count >= deps.limits.maxMembers) return reply.code(409).send({ error: 'party-full' });
    await deps.party.invite(party.id, invite.data.inviteeId);
    return reply.send({ ok: true });
  });

  app.post('/api/party/:id/configure', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const patch = Configure.safeParse(request.body);
    if (!patch.success) return reply.code(400).send({ error: 'invalid-body' });
    const party = await deps.party.get((request.params as { id: string }).id);
    if (party === null) return reply.code(404).send({ error: 'party-not-found' });
    if (party.leaderId !== me.characterId) return reply.code(403).send({ error: 'not-leader' });
    // A hunt e a dificuldade são validadas pelo CONTEÚDO, como no `enter-hunt`: uma hunt
    // define as dificuldades que fazem sentido para ela. Cada eixo muda sozinho (RF-02).
    if (patch.data.huntId !== undefined && deps.limits.difficultiesOf(patch.data.huntId) === null) {
      return reply.code(400).send({ error: 'unknown-hunt' });
    }
    if (patch.data.difficulty !== undefined) {
      const huntId = patch.data.huntId ?? party.huntId;
      const difficulties = huntId === null ? null : deps.limits.difficultiesOf(huntId);
      if (difficulties === null || !difficulties.includes(patch.data.difficulty)) {
        return reply.code(400).send({ error: 'unknown-difficulty' });
      }
    }
    if (patch.data.vocationTargets !== undefined) {
      // Chaves ∈ catálogo ∪ `none` (RF-02); a soma é contra `maxMembers` do conteúdo, nunca
      // um número escrito à mão (RF-01).
      for (const key of Object.keys(patch.data.vocationTargets)) {
        if (key !== NO_VOCATION && !deps.limits.vocations.includes(key)) {
          return reply.code(400).send({ error: 'unknown-vocation' });
        }
      }
      const sum = Object.values(patch.data.vocationTargets).reduce((total, slots) => total + slots, 0);
      if (sum > deps.limits.maxMembers) return reply.code(400).send({ error: 'composition-too-large' });
    }
    await deps.party.configure(party.id, patch.data);
    const updated = await deps.party.get(party.id);
    return reply.send(updated === null ? { ok: true } : await view(updated, deps));
  });

  app.post('/api/party/:id/publish', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const party = await deps.party.get((request.params as { id: string }).id);
    if (party === null) return reply.code(404).send({ error: 'party-not-found' });
    if (party.leaderId !== me.characterId) return reply.code(403).send({ error: 'not-leader' });
    // Sem corpo (RF-03): o que se publica é o estado que o `configure` gravou, e é o store
    // quem valida — hunt proposta, level mínimo e pelo menos uma vaga pública.
    const published = await deps.party.publish(party.id);
    if (published === 'not-found') return reply.code(404).send({ error: 'party-not-found' });
    if (published === 'nothing-proposed') return reply.code(409).send({ error: 'nothing-proposed' });
    if (published === 'not-configured') return reply.code(409).send({ error: 'not-configured' });
    if (published === 'no-vocation-slot') return reply.code(409).send({ error: 'no-vocation-slot' });
    const updated = await deps.party.get(party.id);
    return reply.send(updated === null ? { ok: true } : await view(updated, deps));
  });

  app.post('/api/party/:id/unpublish', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const party = await deps.party.get((request.params as { id: string }).id);
    if (party === null) return reply.code(404).send({ error: 'party-not-found' });
    if (party.leaderId !== me.characterId) return reply.code(403).send({ error: 'not-leader' });
    await deps.party.unpublish(party.id);
    return reply.send({ ok: true });
  });

  // Encontrar Party (§17–§20, RF-04): a busca é DO CANDIDATO — quem é, o level e a vocação
  // vêm daqui, e o FILTRO é do servidor. Sala inelegível some da lista, não fica desabilitada.
  app.get('/api/party/rooms', async (request, reply) => {
    const query = RoomsQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid-query' });
    const me = await whoQuery(request, reply, query.data);
    if (me === null) return;
    const candidate = await deps.getCharacter(me.accountId, me.characterId);
    if (candidate === null) return reply.code(404).send({ error: 'character-not-found' });
    const candidateVocation = candidate.vocation ?? NO_VOCATION;
    const rooms: Awaited<ReturnType<typeof roomView>>[] = [];
    for (const party of await deps.party.rooms()) {
      // Filtro barato primeiro; a composição (uma leitura por sala) só para quem passou.
      if (query.data.huntId !== undefined && party.huntId !== query.data.huntId) continue;
      if (party.minLevel === null || candidate.level < party.minLevel) continue;
      const members = party.state === 'hunting' ? await liveMembers(party, deps) : party.members;
      if (members.length >= deps.limits.maxMembers) continue;
      const openSlots = await deps.party.openSlots(party.id, party.vocationTargets);
      if ((openSlots[candidateVocation] ?? 0) <= 0) continue;
      rooms.push(await roomView(party, members, openSlots, deps));
    }
    return reply.send({ rooms });
  });

  // O convidado recusa sem saber o `partyId`? Ele sabe — vem no `invites[]` do `/mine`. Aqui a
  // liderança não importa: quem recusa é o PRÓPRIO convidado (D8).
  app.post('/api/party/:id/decline', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    await deps.party.decline((request.params as { id: string }).id, me.characterId);
    return reply.send({ ok: true });
  });

  app.post('/api/party/:id/join', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const id = (request.params as { id: string }).id;
    const party = await deps.party.get(id);
    if (party === null) return reply.code(404).send({ error: 'party-not-found' });
    // Party em CURSO: ticket de entrada para o nó da sessão do líder (#402, D7), com a vaga
    // por vocação RESERVADA antes da emissão (DT-04).
    if (party.state === 'hunting') {
      const result = await joinRunningParty(me, party, deps);
      return reply.code(result.status).send(result.body);
    }
    // Party FORMANDO: o Lua de sempre, agora com a vaga por vocação dentro do script (DT-01).
    const candidate = await deps.getCharacter(me.accountId, me.characterId);
    if (candidate === null) return reply.code(404).send({ error: 'character-not-found' });
    const invited = await deps.party.isInvited(id, me.characterId);
    const publicEligible = party.published && party.minLevel !== null && candidate.level >= party.minLevel;
    // A rota responde a elegibilidade ANTES do script; o script reconferindo no mesmo passo é
    // o que fecha a corrida entre a leitura e o join.
    if (!invited && !publicEligible) return reply.code(403).send({ error: 'room-not-eligible' });
    const result = await deps.party.join(id, me.characterId, me.accountId, {
      maxMembers: deps.limits.maxMembers,
      vocation: candidate.vocation ?? NO_VOCATION,
      targets: party.vocationTargets,
      publicEligible,
    });
    if (result === 'not-found') return reply.code(404).send({ error: 'party-not-found' });
    if (result === 'room-not-eligible') return reply.code(403).send({ error: 'room-not-eligible' });
    if (result === 'no-vocation-slot') return reply.code(409).send({ error: 'no-vocation-slot' });
    if (result === 'full') return reply.code(409).send({ error: 'party-full' });
    if (result !== 'joined') return reply.code(409).send({ error: result });
    const joined = await deps.party.get(id);
    return reply.send(joined === null ? { ok: true } : await view(joined, deps));
  });

  app.post('/api/party/:id/leave', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const party = await deps.party.leave((request.params as { id: string }).id, me.characterId);
    return reply.send({ party: party === null ? null : await view(party, deps) });
  });

  app.post('/api/party/:id/kick', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const kick = Kick.safeParse(request.body);
    if (!kick.success) return reply.code(400).send({ error: 'invalid-body' });
    const result = await deps.party.kick(
      (request.params as { id: string }).id, me.characterId, kick.data.targetId,
    );
    if (result === 'not-found') return reply.code(404).send({ error: 'party-not-found' });
    if (result === 'not-leader') return reply.code(403).send({ error: 'not-leader' });
    if (result === 'cannot-kick-self') return reply.code(409).send({ error: 'cannot-kick-self' });
    if (result === 'target-not-a-member') return reply.code(409).send({ error: 'target-not-a-member' });
    return reply.send(await view(result, deps));
  });

  /**
   * DT-05: `/propose` é um SHIM da MESMA escrita de `/configure` — o cliente atual ainda o
   * chama, e quem remove o uso é a task B do mesmo PR. Não é um fluxo à parte: traduz o corpo
   * legado (`mode`) para os dois eixos e escreve pelo mesmo caminho.
   */
  app.post('/api/party/:id/propose', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const proposal = Propose.safeParse(request.body);
    if (!proposal.success) return reply.code(400).send({ error: 'invalid-body' });
    const party = await deps.party.get((request.params as { id: string }).id);
    if (party === null) return reply.code(404).send({ error: 'party-not-found' });
    if (party.leaderId !== me.characterId) return reply.code(403).send({ error: 'not-leader' });
    const difficulties = deps.limits.difficultiesOf(proposal.data.huntId);
    if (difficulties === null) return reply.code(400).send({ error: 'unknown-hunt' });
    if (!difficulties.includes(proposal.data.difficulty)) return reply.code(400).send({ error: 'unknown-difficulty' });
    // Os dois eixos são a verdade (D1); `mode` é derivado no que faltar. Um cliente anterior
    // ao #400 só manda `mode`, e ele migra pela mesma tabela do snapshot.
    const shareCosts = proposal.data.shareCosts ?? proposal.data.mode === 'shared';
    const splitLoot = proposal.data.splitLoot ?? proposal.data.mode === 'shared';
    await deps.party.configure(party.id, {
      huntId: proposal.data.huntId, difficulty: proposal.data.difficulty, shareCosts, splitLoot,
    });
    const updated = await deps.party.get(party.id);
    return reply.send(updated === null ? { ok: true } : await view(updated, deps));
  });

  /**
   * O convite social (RF-09): NÃO exige party — a party nasce, se precisar, no aceite, em Lua.
   * O convidador tem de estar fora de hunt (RF-08): o aceite resolve a party DELE, e quem está
   * caçando não pode ser o ponto de partida de nenhuma.
   */
  app.post('/api/party/invites/social', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const invite = Invite.safeParse(request.body);
    if (!invite.success) return reply.code(400).send({ error: 'invalid-body' });
    const location = await deps.locateSession(me.characterId);
    if (location !== null && location.type !== 'city') {
      return reply.code(409).send({ error: 'inviter-in-hunt' });
    }
    if (invite.data.inviteeId === me.characterId) return reply.code(400).send({ error: 'invite-self' });
    const invitee = await deps.getCharacterById(invite.data.inviteeId);
    if (invitee === null) return reply.code(404).send({ error: 'character-not-found' });
    const inviter = await deps.getCharacter(me.accountId, me.characterId);
    if (inviter === null) return reply.code(404).send({ error: 'character-not-found' });
    const inviteId = randomUUID();
    await deps.party.createSocialInvite({
      inviteId,
      inviterCharacterId: me.characterId,
      inviterAccountId: me.accountId,
      inviterVocation: inviter.vocation,
      inviteeCharacterId: invite.data.inviteeId,
    });
    return reply.send({ ok: true, inviteId });
  });

  /**
   * O aceite do convite social (RF-09): UM script resolve — usar a party do convidador (caso
   * A), criar uma com ele de líder (caso B), ou recusar com erro tipado. Race-safe por
   * construção: dois aceites não criam duas parties.
   */
  app.post('/api/party/invites/social/:inviteId/accept', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    // O aceite é da Cidade: quem está numa hunt não entra em outra (invariante 8).
    const location = await deps.locateSession(me.characterId);
    if (location !== null && location.type !== 'city') {
      return reply.code(409).send({ error: 'not-in-city' });
    }
    const character = await deps.getCharacter(me.accountId, me.characterId);
    if (character === null) return reply.code(404).send({ error: 'character-not-found' });
    const accepted = await deps.party.acceptSocialInvite({
      inviteId: (request.params as { inviteId: string }).inviteId,
      inviteeCharacterId: me.characterId,
      inviteeAccountId: me.accountId,
      // A vocação ATUAL do Postgres (§6); `none` canônico quem normaliza é o store.
      inviteeVocation: character.vocation,
      maxMembers: deps.limits.maxMembers,
    });
    if (accepted === 'not-found') return reply.code(404).send({ error: 'invite-not-found' });
    if (accepted === 'inviter-unavailable') return reply.code(409).send({ error: 'inviter-unavailable' });
    if (accepted === 'in-another-party') return reply.code(409).send({ error: 'in-another-party' });
    return reply.send(await view(accepted.party, deps));
  });

  /**
   * O início. A ORDEM importa, e cada troca tem consequência:
   *
   *   1. tudo o que pode recusar vem ANTES de reservar qualquer coisa — Cidade, hunt válida,
   *      liquidação de cada um (a aprovação dos membros não existe mais, RF-07);
   *   2. um nó só, resolvido pelo líder; o `consume` recusa ticket de nó errado, então os N
   *      precisam do mesmo;
   *   3. os tickets são emitidos um a um, e a falha do k-ésimo REVOGA os k−1 anteriores: três
   *      membros com slot reservado para uma sessão que não vai existir é o que "tudo ou nada"
   *      evita — sem script Lua entre N contas, porque as chaves são de contas diferentes;
   *   4. só depois de todos emitidos a party some e os tickets ficam para cada um pegar.
   */
  app.post('/api/party/:id/start', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const party = await deps.party.get((request.params as { id: string }).id);
    if (party === null) return reply.code(404).send({ error: 'party-not-found' });
    if (party.leaderId !== me.characterId) return reply.code(403).send({ error: 'not-leader' });
    if (party.huntId === null || party.difficulty === null) return reply.code(409).send({ error: 'nothing-proposed' });
    if (party.members.length < 2) return reply.code(409).send({ error: 'not-enough-members' });
    const difficulties = deps.limits.difficultiesOf(party.huntId);
    if (difficulties === null || !difficulties.includes(party.difficulty)) {
      return reply.code(409).send({ error: 'unknown-hunt' });
    }

    // Todos na Cidade (ou em repouso, que é Cidade sem sessão — ADR 0024): quem está numa hunt
    // não entra em outra (invariante 8).
    for (const member of party.members) {
      const location = await deps.locateSession(member);
      if (location !== null && location.type !== 'city') return reply.code(409).send({ error: 'not-in-city', characterId: member });
    }

    // O progresso pendente de CADA um entra na tabela antes da leitura da linha (FUN-56), e
    // qualquer falha recusa o início — retentável de graça.
    for (const member of party.members) {
      let settlement: SettlementResult;
      try {
        settlement = await deps.settleProgress(member);
      } catch (error) {
        request.log.error({ error, characterId: member }, 'Settlement failed');
        return reply.code(503).send({ error: 'progress-not-settled' });
      }
      if (settlement.failed > 0) return reply.code(503).send({ error: 'progress-not-settled' });
    }

    // As linhas, com a conta de cada um (registrada ao entrar na party).
    const members: PartyTicket['members'][number][] = [];
    for (const characterId of party.members) {
      const accountId = party.accounts[characterId];
      const character = accountId === undefined ? null : await deps.getCharacter(accountId, characterId);
      if (accountId === undefined || character === null) return reply.code(409).send({ error: 'member-gone', characterId });
      members.push({
        characterId, accountId,
        initialCharacter: initialCharacterOf(character, await deps.listItemInstances?.(characterId) ?? []),
      });
    }

    const resolution = await deps.tickets.resolveNode(party.leaderId);
    if (!resolution.ok) return reply.code(STATUS[resolution.reason]).send({ error: resolution.reason });

    const sessionId = randomUUID();
    // `mode` continua no ticket como espelho derivado (D1): um nó `game` anterior ao #400 só o
    // lê, e o `parsePartyTicket` do nó novo migra o mesmo par. O tipo é o `PartyTicket` (que já
    // carrega os dois eixos) mais o espelho, e a assinatura de `issue` aceita o superconjunto.
    const ticket: PartyTicket & { mode: PartyRecord['mode'] } = {
      sessionId, leaderId: party.leaderId,
      shareCosts: party.shareCosts, splitLoot: party.splitLoot, mode: party.mode,
      huntId: party.huntId, difficulty: party.difficulty, members,
    };
    const issued: Array<{ characterId: string; accountId: string; value: IssuedTicket }> = [];
    for (const member of members) {
      const result = await deps.tickets.issue(
        member.accountId, member.characterId, member.initialCharacter, resolution.node, ticket,
      );
      if (!result.ok) {
        for (const done of issued) await deps.tickets.revoke(done.value.ticket, done.accountId, done.characterId);
        return reply.code(STATUS[result.reason]).send({ error: result.reason, characterId: member.characterId });
      }
      issued.push({ characterId: member.characterId, accountId: member.accountId, value: result.value });
    }

    await deps.party.started(
      party.id, sessionId, deps.limits.contentVersion,
      Object.fromEntries(issued.map((entry) => [entry.characterId, {
        ticket: entry.value.ticket, wsUrl: entry.value.wsUrl, expiresAtMs: entry.value.expiresAtMs, sessionId,
      }])),
      ticketTtlMs,
    );
    request.log.info({ sessionId, members: members.length, nodeId: resolution.node.nodeId }, 'Party started');
    // O líder recebe o SEU; os outros pegam pelo `mine`. O ticket não entra no log.
    const mine = await deps.party.takeTicket(me.characterId);
    return reply.send({ sessionId, ticket: mine });
  });
}
