// A formação da party de hunt (#195, ADR 0027 decisão 8): HTTP, no `api`, em Redis.
//
// O personagem está na Cidade, e a Cidade é inerte — nada disto passa pela sessão. Criar,
// convidar, entrar, sair, propor e aprovar são escritas num formulário em Redis (`PartyStore`);
// `start` é o que faz para N o que `POST /api/tickets` faz para um: valida, liquida o progresso
// pendente de cada um, escolhe UM nó, emite um ticket por membro com o mesmo `sessionId` e o
// bloco `party`, e apaga o formulário. Daqui em diante a sessão é a party.
//
// Tudo aqui é INTENÇÃO (invariante 4): quem decide se a party existe, quem lidera e se a hunt
// começa é este processo, nunca o corpo do request.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { GameRepository } from '../db/repository.js';
import type { IssueFailure, IssuedTicket, PartyTicket, TicketService } from '../tickets.js';
import type { PartyRecord, PartyStore } from '../party-store.js';
import { initialCharacterOf } from './tickets.js';
import type { Principal, SettlementResult } from './tickets.js';

export interface PartyRouteDependencies {
  readonly party: PartyStore;
  readonly tickets: Pick<TicketService, 'issue' | 'resolveNode' | 'revoke'>;
  readonly authenticate: (request: FastifyRequest) => Promise<Principal | null>;
  readonly ownsCharacter: GameRepository['ownsCharacter'];
  readonly getCharacter: GameRepository['getCharacter'];
  readonly listItemInstances?: GameRepository['listItemInstances'];
  readonly settleProgress: (characterId: string) => Promise<SettlementResult>;
  /** Onde o personagem está, segundo o diretório: só quem está na Cidade (ou em repouso) inicia. */
  readonly locateSession: (characterId: string) => Promise<{ type: string } | null>;
  /** Os limites e o catálogo, do conteúdo fixado no boot — a rota não recebe o `Content` inteiro. */
  readonly limits: {
    readonly maxMembers: number;
    /** As dificuldades da hunt, ou `null` se ela não existe. */
    readonly difficultiesOf: (huntId: string) => readonly string[] | null;
  };
  /** Quanto tempo o ticket de cada membro fica esperando ser pego. Padrão: 30 s. */
  readonly ticketTtlMs?: number;
}

/** `inviteeId`, e não `characterId`: este é o personagem de QUEM convida, no mesmo corpo. */
const Invite = z.object({ inviteeId: z.string().min(1).max(128) });
const Propose = z.object({
  huntId: z.string().min(1).max(128),
  difficulty: z.string().min(1).max(64),
  mode: z.enum(['split', 'shared']),
});
const Selected = z.object({ characterId: z.string().min(1).max(128) });

const STATUS: Record<IssueFailure, number> = {
  'active-limit': 409,
  'no-node-available': 503,
  'session-node-unavailable': 503,
};

function view(party: PartyRecord) {
  return {
    id: party.id,
    leaderId: party.leaderId,
    mode: party.mode,
    huntId: party.huntId,
    difficulty: party.difficulty,
    members: party.members.map((characterId) => ({
      characterId, approved: party.approved.includes(characterId),
    })),
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

  app.post('/api/party', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const party = await deps.party.create(me.characterId, me.accountId);
    if (party === null) return reply.code(409).send({ error: 'already-in-party' });
    return reply.send(view(party));
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
    // Depois do `start` a party sumiu e sobrou o ticket de cada um: pegar é UMA vez.
    const ticket = await deps.party.takeTicket(query.data.characterId);
    if (ticket !== null) return reply.send({ party: null, ticket });
    const party = await deps.party.of(query.data.characterId);
    return reply.send({ party: party === null ? null : view(party), ticket: null });
  });

  app.post('/api/party/:id/invite', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const invite = Invite.safeParse(request.body);
    if (!invite.success) return reply.code(400).send({ error: 'invalid-body' });
    const party = await deps.party.get((request.params as { id: string }).id);
    if (party === null) return reply.code(404).send({ error: 'party-not-found' });
    if (party.leaderId !== me.characterId) return reply.code(403).send({ error: 'not-leader' });
    await deps.party.invite(party.id, invite.data.inviteeId);
    return reply.send({ ok: true });
  });

  app.post('/api/party/:id/join', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const result = await deps.party.join(
      (request.params as { id: string }).id, me.characterId, me.accountId, deps.limits.maxMembers,
    );
    if (result === 'not-found') return reply.code(404).send({ error: 'party-not-found' });
    if (result !== 'joined') return reply.code(409).send({ error: result });
    const party = await deps.party.get((request.params as { id: string }).id);
    return reply.send(party === null ? { ok: true } : view(party));
  });

  app.post('/api/party/:id/leave', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const party = await deps.party.leave((request.params as { id: string }).id, me.characterId);
    return reply.send({ party: party === null ? null : view(party) });
  });

  app.post('/api/party/:id/propose', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const proposal = Propose.safeParse(request.body);
    if (!proposal.success) return reply.code(400).send({ error: 'invalid-body' });
    const party = await deps.party.get((request.params as { id: string }).id);
    if (party === null) return reply.code(404).send({ error: 'party-not-found' });
    if (party.leaderId !== me.characterId) return reply.code(403).send({ error: 'not-leader' });
    // A hunt e a dificuldade são validadas pelo CONTEÚDO, como no `enter-hunt`: uma hunt
    // define as dificuldades que fazem sentido para ela.
    const difficulties = deps.limits.difficultiesOf(proposal.data.huntId);
    if (difficulties === null) return reply.code(400).send({ error: 'unknown-hunt' });
    if (!difficulties.includes(proposal.data.difficulty)) return reply.code(400).send({ error: 'unknown-difficulty' });
    await deps.party.propose(party.id, proposal.data, me.characterId);
    const updated = await deps.party.get(party.id);
    return reply.send(updated === null ? { ok: true } : view(updated));
  });

  app.post('/api/party/:id/approve', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const party = await deps.party.get((request.params as { id: string }).id);
    if (party === null) return reply.code(404).send({ error: 'party-not-found' });
    if (!party.members.includes(me.characterId)) return reply.code(403).send({ error: 'not-a-member' });
    if (party.huntId === null) return reply.code(409).send({ error: 'nothing-proposed' });
    await deps.party.approve(party.id, me.characterId);
    const updated = await deps.party.get(party.id);
    return reply.send(updated === null ? { ok: true } : view(updated));
  });

  /**
   * O início. A ORDEM importa, e cada troca tem consequência:
   *
   *   1. tudo o que pode recusar vem ANTES de reservar qualquer coisa — aprovação, Cidade,
   *      hunt válida, liquidação de cada um;
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
    if (party.members.some((member) => !party.approved.includes(member))) {
      return reply.code(409).send({ error: 'not-approved' });
    }
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
    const ticket: PartyTicket = {
      sessionId, leaderId: party.leaderId, mode: party.mode,
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
      party.id,
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
