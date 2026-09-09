// POST /api/tickets — emite o ticket de sessão e resolve o nó (FUN-12).

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { IssueFailure, TicketService } from '../tickets.js';
import type { GameRepository } from '../db/repository.js';

export interface Principal {
  readonly accountId: string;
}

export interface TicketRouteDependencies {
  /** Só a emissão: a rota não consome ticket, e o tipo estreito é o que diz isso. */
  readonly tickets: Pick<TicketService, 'issue' | 'resolveNode'>;
  /**
   * Quem está pedindo. A sessão HTTP é resolvida aqui e MORRE aqui: o que segue para o
   * socket é o ticket, nunca a credencial (invariante 4 aplicado à borda de entrada).
   *
   * Injetada pela camada HTTP (FUN-10). Se ausente por configuração incompleta, a rota
   * responde 501, nunca falha aberta.
   */
  readonly authenticate?: (request: FastifyRequest) => Promise<Principal | null>;
  /** Valida posse e exclusão sob o mesmo lock de linha usado pelo soft delete. */
  readonly withOwnedCharacter?: GameRepository['withOwnedCharacter'];
}

const RequestBody = z.object({ characterId: z.string().min(1).max(128) });

/** Falha de emissão → código HTTP. Nenhuma delas é erro do servidor. */
const STATUS: Record<IssueFailure, number> = {
  'active-limit': 409,
  'no-node-available': 503,
  'session-node-unavailable': 503,
};

/**
 * Handler solto, e não um plugin que registra a rota: a instância do Fastify aqui carrega o
 * tipo do logger do pino, e passá-la entre módulos arrasta essa parametrização inteira junto.
 * O handler depende só de `FastifyRequest`/`FastifyReply`.
 */
export function createTicketHandler(
  deps: TicketRouteDependencies,
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (request, reply) => {
    const { authenticate, withOwnedCharacter } = deps;
    if (authenticate === undefined || withOwnedCharacter === undefined) {
      return reply.code(501).send({ error: 'auth-not-configured' });
    }

    const body = RequestBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid-body' });

    const principal = await authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });

    // O nó é resolvido FORA da trava de linha (FUN-53). Qual nó de jogo está vivo não tem
    // relação nenhuma com a linha do personagem, e descobrir isso é `SCAN` mais `MGET` no
    // Redis: segurando a trava, uma lentidão do Redis vira pool do Postgres esgotado e toda
    // rota que toca o banco parando de responder.
    const resolution = await deps.tickets.resolveNode(body.data.characterId);
    if (!resolution.ok) {
      return reply.code(STATUS[resolution.reason]).send({ error: resolution.reason });
    }

    // 404, e não 403: responder "existe, mas não é seu" transforma este endpoint num
    // verificador de nomes de personagem para qualquer conta autenticada.
    const issued = await withOwnedCharacter(
      principal.accountId,
      body.data.characterId,
      (character) => deps.tickets.issue(principal.accountId, character.id, {
        level: character.level,
        xp: character.xp,
        staminaMs: character.staminaMs,
        staminaUpdatedAtMs: character.staminaUpdatedAt.getTime(),
      }, resolution.node),
    );
    if (issued === null) {
      return reply.code(404).send({ error: 'character-not-found' });
    }

    if (!issued.ok) return reply.code(STATUS[issued.reason]).send({ error: issued.reason });

    // O ticket NÃO entra no log — nem ele nem a wsUrl, que o carrega na query string.
    request.log.info(
      { characterId: body.data.characterId, nodeId: issued.value.nodeId },
      'Ticket issued',
    );
    return reply.send({
      ticket: issued.value.ticket,
      wsUrl: issued.value.wsUrl,
      expiresAtMs: issued.value.expiresAtMs,
    });
  };
}
