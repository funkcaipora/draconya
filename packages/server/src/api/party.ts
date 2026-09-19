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
  /** A faixa de level do matchmaking (#199, §43.2 aberto). `0` desliga o filtro. */
  readonly matchmakingLevelRange?: number;
}

/** `inviteeId`, e não `characterId`: este é o personagem de QUEM convida, no mesmo corpo. */
const Invite = z.object({ inviteeId: z.string().min(1).max(128) });
/** `targetId`, e não `characterId`: este é o personagem de QUEM FALA (o líder); o alvo vai
 * separado, como `inviteeId` já faz em `Invite`. */
const Kick = z.object({ targetId: z.string().min(1).max(128) });
const Propose = z.object({
  huntId: z.string().min(1).max(128),
  difficulty: z.string().min(1).max(64),
  /**
   * O `mode` legado de um cliente anterior ao #400; os dois eixos são o formato novo
   * (ADR 0033 D1). Um dos dois tem de vir: o `mode` sozinho migra para os eixos, e os eixos
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

const STATUS: Record<IssueFailure, number> = {
  'active-limit': 409,
  'no-node-available': 503,
  'session-node-unavailable': 503,
};

async function view(
  party: PartyRecord,
  getCharacter: PartyRouteDependencies['getCharacter'],
): Promise<{
  id: string; leaderId: string; mode: PartyRecord['mode']; shareCosts: boolean; splitLoot: boolean;
  huntId: string | null;
  difficulty: string | null;
  members: Array<{ characterId: string; name: string; approved: boolean }>;
}> {
  const members = await Promise.all(party.members.map(async (characterId) => {
    const accountId = party.accounts[characterId];
    // Entrada corrompida (conta divergente, personagem apagado) vira AUSENTE, nunca resposta
    // recusada — a mesma régua de outfit/bestiary/bot-config (ver CLAUDE.md de `server`).
    const character = accountId === undefined ? null : await getCharacter(accountId, characterId);
    return { characterId, name: character?.name ?? characterId, approved: party.approved.includes(characterId) };
  }));
  return {
    id: party.id, leaderId: party.leaderId, mode: party.mode,
    shareCosts: party.shareCosts, splitLoot: party.splitLoot,
    huntId: party.huntId, difficulty: party.difficulty, members,
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
    return reply.send(await view(party, deps.getCharacter));
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
    return reply.send({ party: party === null ? null : await view(party, deps.getCharacter), ticket: null });
  });

  // O matchmaking (#199, §15.2): FORMA a party, não a inicia. Quem entra na fila ou casa na
  // hora — e a party formada segue o fluxo de sempre: o líder propõe, os outros aprovam — ou
  // fica esperando quem vier. A faixa de level é do conteúdo; `0` é "qualquer um".
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
    return reply.send({ party: result === null ? null : await view(result, deps.getCharacter) });
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
    return reply.send(party === null ? { ok: true } : await view(party, deps.getCharacter));
  });

  app.post('/api/party/:id/leave', async (request, reply) => {
    const me = await who(request, reply);
    if (me === null) return;
    const party = await deps.party.leave((request.params as { id: string }).id, me.characterId);
    return reply.send({ party: party === null ? null : await view(party, deps.getCharacter) });
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
    return reply.send(await view(result, deps.getCharacter));
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
    // Os dois eixos são a verdade (D1); `mode` é derivado no que faltar. Um cliente anterior
    // ao #400 só manda `mode`, e ele migra pela mesma tabela do snapshot.
    const shareCosts = proposal.data.shareCosts ?? proposal.data.mode === 'shared';
    const splitLoot = proposal.data.splitLoot ?? proposal.data.mode === 'shared';
    const mode = proposal.data.mode ?? (shareCosts && splitLoot ? 'shared' : 'split');
    await deps.party.propose(
      party.id,
      { huntId: proposal.data.huntId, difficulty: proposal.data.difficulty, mode, shareCosts, splitLoot },
      me.characterId,
    );
    const updated = await deps.party.get(party.id);
    return reply.send(updated === null ? { ok: true } : await view(updated, deps.getCharacter));
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
    return reply.send(updated === null ? { ok: true } : await view(updated, deps.getCharacter));
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
