// POST /api/tickets — emite o ticket de sessão e resolve o nó (FUN-12).

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { IssueFailure, TicketService } from '../tickets.js';

export interface Principal {
  readonly accountId: string;
}

export interface TicketRouteDependencies {
  /** Só a emissão: a rota não consome ticket, e o tipo estreito é o que diz isso. */
  readonly tickets: Pick<TicketService, 'issue'>;
  /**
   * Quem está pedindo. A sessão HTTP é resolvida aqui e MORRE aqui: o que segue para o
   * socket é o ticket, nunca a credencial (invariante 4 aplicado à borda de entrada).
   *
   * Ausente enquanto a FUN-10 não existe. A rota então responde 501, não 200: endpoint de
   * ticket sem autenticação é "entre como qualquer um", e falhar aberto aqui seria pior que
   * não ter a rota.
   */
  readonly authenticate?: (request: FastifyRequest) => Promise<Principal | null>;
  /** Posse do personagem. Ausente enquanto a FUN-11 não existe; mesma regra do acima. */
  readonly ownsCharacter?: (accountId: string, characterId: string) => Promise<boolean>;
}

const RequestBody = z.object({ characterId: z.string().min(1) });

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
    const { authenticate, ownsCharacter } = deps;
    if (authenticate === undefined || ownsCharacter === undefined) {
      return reply.code(501).send({ error: 'auth-not-configured' });
    }

    const body = RequestBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid-body' });

    const principal = await authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });

    // 404, e não 403: responder "existe, mas não é seu" transforma este endpoint num
    // verificador de nomes de personagem para qualquer conta autenticada.
    if (!(await ownsCharacter(principal.accountId, body.data.characterId))) {
      return reply.code(404).send({ error: 'character-not-found' });
    }

    const issued = await deps.tickets.issue(principal.accountId, body.data.characterId);
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
