// POST /api/tickets — emite o ticket de sessão e resolve o nó (FUN-12).

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OutfitColors } from '@draconya/protocol';
import type { BestiaryState } from '@draconya/sim';
import { isAmmoSelection, isBestiaryState, isStockMap } from '../tickets.js';
import type { InitialCharacter, IssueFailure, TicketService } from '../tickets.js';
import type { CharacterRecord, GameRepository } from '../db/repository.js';

export interface Principal {
  readonly accountId: string;
}

export interface TicketRouteDependencies {
  /** Só a emissão: a rota não consome ticket, e o tipo estreito é o que diz isso. */
  readonly tickets: Pick<TicketService, 'issue' | 'resolveNode' | 'revoke'>;
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
   * Posse SEM travar a linha, para a checagem que vem antes da liquidação (ADR 0024).
   *
   * Duas checagens de posse na mesma rota não é descuido: esta é a que decide se a rota faz
   * ALGUMA COISA, e precisa rodar antes; a de `withOwnedCharacter` é a que decide o que é
   * lido, e precisa da trava. Uma não substitui a outra, e a barata é um lookup por chave
   * primária — mais barato que o `SCAN` do `resolveNode`, que já roda aqui do lado.
   */
  readonly ownsCharacter?: GameRepository['ownsCharacter'];
  /**
   * Liquida o extrato que a sessão anterior deixou pendente (FUN-56).
   *
   * Exigida junto com `withOwnedCharacter`, e não opcional por conta própria: quem sabe ler
   * a linha do personagem tem que saber deixá-la em dia antes. Sem isso a rota emitiria
   * ticket com o progresso de antes da última sessão, e o defeito voltaria calado.
   */
  readonly settleProgress?: (characterId: string) => Promise<SettlementResult>;
  /**
   * O que o personagem tem, para o ticket carregar (FUN-82).
   *
   * Estreita, como o resto desta interface: a rota não precisa do repositório inteiro para
   * montar uma mochila. Ausente é personagem que entra de mãos vazias — degradação, e é o que
   * acontece num `api` montado sem banco.
   */
  readonly listItemInstances?: GameRepository['listItemInstances'];
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
    const { authenticate, withOwnedCharacter, ownsCharacter, settleProgress } = deps;
    if (authenticate === undefined
      || withOwnedCharacter === undefined
      || ownsCharacter === undefined
      || settleProgress === undefined) {
      return reply.code(501).send({ error: 'auth-not-configured' });
    }

    const body = RequestBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid-body' });

    const principal = await authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });

    // Posse ANTES de qualquer efeito (ADR 0024). Sem isto, a liquidação abaixo roda sobre o
    // personagem que o corpo do request pedir, e uma conta autenticada dispara ação sobre dado
    // de outra conta — sem mudar valor e sem receber nada de volta, mas ainda assim ação.
    //
    // 404, e não 403, pela mesma razão do de baixo: "existe, mas não é seu" transformaria esta
    // rota num verificador de id de personagem para qualquer conta autenticada.
    if (!await ownsCharacter(principal.accountId, body.data.characterId)) {
      return reply.code(404).send({ error: 'character-not-found' });
    }

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
    // trava para escrever, e chamá-la de dentro dela seria travar contra si mesma. É por isso
    // que ela não pode acontecer dentro do `withOwnedCharacter` lá embaixo — e é por isso que
    // a posse é conferida em dois lugares (ADR 0024), com a barata vindo primeiro.
    let settlement: SettlementResult;
    try {
      settlement = await settleProgress(body.data.characterId);
    } catch (error) {
      request.log.error({ err: error, characterId: body.data.characterId }, 'Settlement failed');
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
      async (character) => deps.tickets.issue(
        principal.accountId,
        character.id,
        initialCharacterOf(character, await deps.listItemInstances?.(character.id) ?? []),
        resolution.node,
      ),
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

/**
 * O que o ticket carrega de um personagem: a linha do banco, validada campo a campo. É a
 * MESMA montagem para o ticket solo e para cada membro de uma party (#195) — o `game` não
 * fala com o Postgres, e tudo o que a sessão precisa saber do personagem passa por aqui.
 */
export function initialCharacterOf(
  character: CharacterRecord,
  instances: Parameters<typeof inventoryOf>[0],
): InitialCharacter {
  return {
    level: character.level,
    xp: character.xp,
    name: character.name,
    gold: character.gold,
    // A configuração do bot viaja no ticket (FUN-81): é assim que ela chega ao `game`,
    // que não fala com o Postgres. Mesmo caminho de level, XP e gold.
    ...(character.botConfig === null ? {} : { botConfig: character.botConfig }),
    // As cores do outfit viajam no ticket como o nome (FUN-104): dado do personagem que só
    // a apresentação lê, e o `game` não fala com o Postgres. Validadas AQUI, e não só no
    // consumo: é o que faz o tipo do ticket dizer a verdade sem cast, e a linha é `jsonb`
    // sem CHECK — um valor corrompido vira ausente, nunca personagem trancado fora.
    ...outfitColorsOf(character.outfitColors),
    // As skills entram na sessão porque escalam o dano DURANTE a hunt (FUN-75).
    skills: character.skills,
    // E o Bestiário, porque o bônus dos marcos escala a XP durante a hunt (FUN-113).
    // Validado AQUI como as cores: a linha é `jsonb` sem CHECK, e uma contagem corrompida
    // vira ausente — a sessão parte de `{}` — em vez de trancar o login.
    ...bestiaryOf(character.bestiary),
    // E a munição escolhida (#152), pela mesma régua do Bestiário: torta vira ausente.
    ...(isAmmoSelection(character.ammo) ? { ammo: character.ammo } : {}),
    // E o estoque de supply/munição do loot (#520), mesma régua: sem isto, uma hunt nova
    // sempre começaria com estoque zero, mesmo com drop de ontem esperando na linha.
    ...(isStockMap(character.supplyStock) ? { supplyStock: character.supplyStock } : {}),
    ...(isStockMap(character.ammunitionStock) ? { ammunitionStock: character.ammunitionStock } : {}),
    // E a vocação (#154): escrita uma vez pelo `jobs`, lida aqui a cada entrada.
    ...(character.vocation === null ? {} : { vocation: character.vocation }),
    // E o Premium (ADR 0035 D3): derivado AQUI contra o relógio — a sessão nunca compara datas,
    // só lê um boolean já resolvido. `null` ou vencido é Free, e ausente é o que o ticket
    // carrega: a sessão trata ausência como `false` (a regra do Bestiário, degradação).
    ...(character.premiumUntil !== null && character.premiumUntil.getTime() > Date.now()
      ? { premium: true }
      : {}),
    // E o inventário, porque a arma equipada decide o dano (FUN-82). A consulta usa o
    // índice por dono, e roda uma vez por emissão de ticket — não no caminho de tick.
    inventory: inventoryOf(instances),
    staminaMs: character.staminaMs,
    staminaUpdatedAtMs: character.staminaUpdatedAt.getTime(),
  };
}

/**
 * As cores do outfit como o ticket as carrega, ou nada (FUN-104).
 *
 * `null` é personagem que nunca escolheu, e é o caso comum enquanto a tela (§7.4) não existe.
 * Qualquer outra coisa que não bata no schema do protocolo — peça faltando, índice fora da
 * paleta — cai no mesmo "nada": o cliente pinta o padrão, e a emissão do ticket não é o lugar
 * de recusar um login por causa de cor.
 */
function outfitColorsOf(stored: unknown): { outfitColors?: OutfitColors } {
  if (stored === null || stored === undefined) return {};
  const parsed = OutfitColors.safeParse(stored);
  return parsed.success ? { outfitColors: parsed.data } : {};
}

/**
 * Os abates por monstro como o ticket os carrega, ou nada (FUN-113).
 *
 * `null` é personagem que nunca abateu nada, ou gravado antes do Bestiário — e o `game`
 * trata ausência como `{}`. Qualquer outra coisa que não seja um mapa de inteiros cai no mesmo
 * "nada": a emissão do ticket não é o lugar de recusar um login por causa de uma contagem, e
 * a chave só existe quando há valor, por causa do `exactOptionalPropertyTypes`.
 */
function bestiaryOf(stored: unknown): { bestiary?: BestiaryState } {
  return isBestiaryState(stored) ? { bestiary: stored } : {};
}

/**
 * Monta a mochila e o equipamento a partir das instâncias do banco (FUN-82).
 *
 * `equipped_slot` diz onde cada uma está: com slot, no corpo; sem slot, na mochila. Duas peças
 * no mesmo slot são impossíveis — o índice único do banco recusa —, então não há desempate a
 * fazer aqui.
 */
function inventoryOf(instances: readonly {
  id: string; itemId: string; quantity: number; equippedSlot: string | null;
  container?: string | null; slotIndex?: number | null;
}[]): { backpack: unknown[]; satchel: unknown[]; equipped: Record<string, unknown> } {
  // Posicional (#160): cada linha volta ao lugar gravado; a linha sem posição (anterior a
  // #160, ou duas na mesma posição por banco tocado à mão) entra no primeiro lugar livre da
  // mochila no fim — o `ensureContainers` da entrada acerta o tamanho inicial.
  const backpack: (unknown | null)[] = [];
  const satchel: (unknown | null)[] = [];
  const equipped: Record<string, unknown> = {};
  const unplaced: unknown[] = [];
  for (const row of instances) {
    const carried = { instanceId: row.id, itemId: row.itemId, quantity: row.quantity };
    if (row.equippedSlot !== null) { equipped[row.equippedSlot] = carried; continue; }
    const target = row.container === 'backpack' ? backpack : row.container === 'satchel' ? satchel : null;
    const index = row.slotIndex ?? null;
    if (target === null || index === null || index < 0 || target[index] !== undefined && target[index] !== null) {
      unplaced.push(carried);
      continue;
    }
    while (target.length <= index) target.push(null);
    target[index] = carried;
  }
  for (const carried of unplaced) {
    const free = backpack.indexOf(null);
    if (free >= 0) backpack[free] = carried;
    else backpack.push(carried);
  }
  return { backpack, satchel, equipped };
}
