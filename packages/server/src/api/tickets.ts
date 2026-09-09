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
  /**
   * Liquida o extrato que a sessão anterior deixou pendente (FUN-56).
   *
   * Exigida junto com `withOwnedCharacter`, e não opcional por conta própria: quem sabe ler
   * a linha do personagem tem que saber deixá-la em dia antes. Sem isso a rota emitiria
   * ticket com o progresso de antes da última sessão, e o defeito voltaria calado.
   */
  readonly settleProgress?: (characterId: string) => Promise<SettlementResult>;
}

/**
 * O que a liquidação devolve. Aqui só `failed` interessa — qualquer falha recusa a entrada.
 * `written` é o que a lista de personagens usa (FUN-66) para decidir se relê a linha.
 */
export interface SettlementResult {
  readonly written: number;
  readonly failed: number;
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
    const { authenticate, withOwnedCharacter, settleProgress } = deps;
    if (authenticate === undefined
      || withOwnedCharacter === undefined
      || settleProgress === undefined) {
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

    // O progresso pendente entra na tabela ANTES da leitura da linha (FUN-56). Sem isto,
    // quem reconecta dentro dos dez segundos da varredura do `jobs` entra com o level e a XP
    // de antes da sessão que acabou — e como `statsForLevel` deriva os pontos do level, o
    // personagem também encolhe. O banco converge sozinho depois, o que é o pior formato:
    // ninguém reproduz de propósito e quem reporta parece enganado.
    //
    // Fora da trava de linha, pela mesma razão que `resolveNode`: a liquidação PRECISA da
    // trava para escrever, e chamá-la de dentro dela seria travar contra si mesma.
    //
    // Isso a põe ANTES da checagem de posse, e é uma escolha, não descuido: uma conta
    // autenticada consegue disparar a liquidação de um personagem que não é dela. O que ela
    // ganha com isso é o crédito sair dez segundos mais cedo do que a varredura o daria —
    // nenhum valor muda, nada é devolvido na resposta (o 404 vem logo abaixo), e sem extrato
    // pendente nem o banco é tocado. E o id é um UUID v4 que nenhuma rota mostra a quem não
    // é dono. Fechar essa fresta custaria uma consulta de posse a mais em TODO login, o que
    // é caro para o que se compra.
    let settlement: SettlementResult;
    try {
      settlement = await settleProgress(body.data.characterId);
    } catch (error) {
      request.log.error({ error, characterId: body.data.characterId }, 'Settlement failed');
      return reply.code(503).send({ error: 'progress-not-settled' });
    }
    // Recusar em vez de deixar passar: entrar com um personagem que o servidor SABE estar
    // desatualizado é justamente o defeito que esta rota acabou de deixar de ter. O 503 é
    // retentável de graça — o extrato continua no Redis, e a varredura o pega de qualquer
    // jeito dentro de dez segundos.
    if (settlement.failed > 0) {
      request.log.error(
        { characterId: body.data.characterId, failed: settlement.failed },
        'Refusing to issue a ticket over stale character progress',
      );
      return reply.code(503).send({ error: 'progress-not-settled' });
    }

    // 404, e não 403: responder "existe, mas não é seu" transforma este endpoint num
    // verificador de nomes de personagem para qualquer conta autenticada.
    const issued = await withOwnedCharacter(
      principal.accountId,
      body.data.characterId,
      (character) => deps.tickets.issue(principal.accountId, character.id, {
        level: character.level,
        xp: character.xp,
        name: character.name,
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
