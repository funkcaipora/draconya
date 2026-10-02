// POST /api/tickets — emite o ticket de sessão e resolve o nó (FUN-12).

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OutfitColors } from '@draconya/protocol';
import {
  isFamiliarState, isFightMode, isHazardState, readItemOverlay, readOfflineTrainingState, settleOfflineTraining,
} from '@draconya/sim';
import type {
  BestiaryState, BosstiaryState, CharmsState, FamiliarState, HazardState, LearnedSpellsState, OfflineTrainingRules,
  OfflineTrainingSettlement, OfflineTrainingState, SkillsState,
} from '@draconya/sim';
import {
  isAmmoSelection, isBestiaryState, isBosstiaryState, isCharmsState, isLearnedSpellsState, isStockMap,
} from '../tickets.js';
import type { InitialCharacter, IssueFailure, TicketService } from '../tickets.js';
import type { CharacterRecord, GameRepository } from '../db/repository.js';
import { worldStateOfRow } from '../world-state.js';

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
  /**
   * A Boosted Creature do dia (#615, ADR 0054 decisão 7), lida do cache em Redis que o `jobs`
   * publica (`world-daily.ts`) — nunca do Postgres, que é mais caro pela mesma resposta.
   * Ausente é `api` montado sem Redis (não deveria acontecer em produção) ou conteúdo sem
   * `boosted/baseline.json`: nenhuma hunt deste ticket aplica o bônus.
   */
  readonly currentBoostedMonsterId?: () => Promise<string | undefined>;
  /**
   * O bônus de Loyalty da CONTA (#628, ADR 0052 decisão 5): `accountId → percentual`, calculado
   * de `account.created_at` na hora da emissão e fixado no ticket — o `game` o mantém pela
   * sessão inteira. Ausente é `api` sem conteúdo de Loyalty (ou montado sem banco): nenhum
   * ticket carrega bônus e toda skill vale o nível base.
   */
  readonly loyaltyBonusPercentOf?: (accountId: string) => Promise<number | undefined>;
  /**
   * Os storages do personagem (#731, ADR 0050 d.6 T2), para o ticket carregar — mesma razão e
   * mesma degradação de `listItemInstances`: ausente é personagem sem storage nenhum setado.
   */
  readonly listCharacterStorages?: GameRepository['listCharacterStorages'];
  /**
   * A MAIOR versão durável ainda pendente no Redis para o personagem (#823, OW-02), lida DEPOIS
   * de liquidar (`ReceiptStore.highestPendingVersion`). O ticket leva
   * `max(characters.durable_version, isto)` como piso do contador do hospedeiro: a sessão nova
   * grava versões MAIORES que as de qualquer extrato que ainda espere liquidação. Ausente é
   * `api` montado sem Redis de extratos: o ticket leva só a coluna.
   */
  readonly pendingDurableVersion?: (characterId: string) => Promise<number>;
  /**
   * A flag `OPEN_WORLD` (#836, OW-15, ADR 0060 d.10.f): com ela ligada o ticket leva o mundo e os
   * vitais do personagem (`worldPosition`, `townId`, `health`, `mana`, `conditions`), lidos da linha
   * — é o que faz deslogar a 10 HP voltar com 10 HP. Ausente ou `false` — o default — é o ticket de
   * antes, byte a byte: o personagem nasce cheio, e as colunas novas não são lidas.
   */
  readonly openWorld?: boolean;
  /**
   * O gasto do banco de offline training na emissão do ticket (#631, ADR 0059 d.3, ADR 0052 d.5).
   *
   * Vive AQUI, e não no `game`, pela razão do ADR 0052 d.5: é um cálculo que precisa saber que
   * horas são (o `sim` não lê relógio, invariante 1) e só pode escrever na linha do personagem
   * quando ele está em REPOUSO — sem sessão hospedada, o único momento em que a linha não tem dono
   * quente (invariante 9, ADR 0024) —, e o `resolveNode` é quem diz isso. Ausente é `api` montado
   * sem Redis ou conteúdo sem `training/`: nenhum banco é gasto, e nada se perde (fica na linha).
   */
  readonly offlineTraining?: {
    /** As regras de conteúdo do gasto (`content.training` e o que `settleOfflineTraining` lê). */
    readonly rules: OfflineTrainingRules;
    /** Desde quando o personagem está sem sessão (`SessionDirectory.restedSince`), ou `null`. */
    readonly restedSince: (characterId: string) => Promise<number | null>;
    /** Relógio de parede; injetável para o teste. */
    readonly now?: () => number;
  };
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

    // A boosted do dia (#615) não depende de posse nem de linha nenhuma — é do MUNDO —, então
    // sai da trava, como a resolução de nó (FUN-53): uma lentidão do Redis aqui não segura a
    // linha do personagem.
    const boostedMonsterId = await deps.currentBoostedMonsterId?.();
    // A versão durável que ainda espera liquidação (#823), lida DEPOIS do `settleProgress` — o que
    // sobrou pendente (um teto de 50 estourado, por exemplo) é o que a coluna ainda não viu.
    const pendingDurableVersion = await deps.pendingDurableVersion?.(body.data.characterId) ?? 0;
    // Desde quando o personagem está em repouso (#631) — só quando o diretório o viu SEM sessão, e
    // FORA da trava de linha pela mesma razão: é uma ida ao Redis. Ausente o carimbo, não há gasto.
    const restedSince = resolution.resting === true
      ? await deps.offlineTraining?.restedSince(body.data.characterId) ?? null
      : null;
    // O Loyalty (#628) também não depende da linha do personagem — é da CONTA —, e o carimbo de
    // criação dela é lido fora da trava, pela mesma razão da boosted.
    const loyaltyBonusPercent = await deps.loyaltyBonusPercentOf?.(principal.accountId);

    // 404, e não 403: responder "existe, mas não é seu" transforma este endpoint num
    // verificador de nomes de personagem para qualquer conta autenticada.
    const outcome = await withOwnedCharacter(
      principal.accountId,
      body.data.characterId,
      async (row, writer) => {
        // O gasto do offline training, com a linha JÁ travada e o personagem em repouso (#631,
        // ADR 0059 d.3): o ticket leva o resultado (skills e banco novos) e, depois de emitido, a
        // MESMA transação o grava — o `game` nunca escreve a linha (invariante 9).
        const spend = restedSince === null || deps.offlineTraining === undefined
          ? null
          : offlineSpendOf(row, restedSince, deps.offlineTraining);
        const character = spend === null ? row : { ...row, skills: spend.skills, training: spend.training };
        const result = await deps.tickets.issue(
          principal.accountId,
          character.id,
          initialCharacterOf(
            character,
            await deps.listItemInstances?.(character.id) ?? [],
            await deps.listCharacterStorages?.(character.id) ?? [],
            boostedMonsterId,
            loyaltyBonusPercent,
            pendingDurableVersion,
            deps.openWorld === true,
          ),
          resolution.node,
        );
        // Só grava com o ticket na mão: recusado (`active-limit`), o banco não foi gasto por quem
        // não vai jogar — a escolha do livro fica para o próximo login.
        if (!result.ok || spend === null) return { result, spend: null };
        await writer.applyOfflineTraining({
          training: spend.training,
          ...(spend.settlement === null ? {} : { skills: spend.skills }),
          at: new Date(deps.offlineTraining?.now?.() ?? Date.now()),
        });
        return { result, spend };
      },
    );
    if (outcome === null) {
      return reply.code(404).send({ error: 'character-not-found' });
    }
    const { result: issued, spend } = outcome;
    if (spend !== null) {
      request.log.info(
        {
          characterId: body.data.characterId,
          trainedMs: spend.settlement?.trainedMs ?? 0,
          skillId: spend.settlement?.skillId ?? null,
          tries: spend.settlement?.tries ?? 0,
        },
        'Offline training settled',
      );
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

/** O resultado do gasto do banco para um ticket: o que o personagem passa a ter, e o que rendeu. */
interface OfflineSpend {
  readonly skills: SkillsState;
  readonly training: OfflineTrainingState;
  /** `null` quando a escolha do livro foi consumida mas nada rendeu (carência, banco vazio). */
  readonly settlement: OfflineTrainingSettlement | null;
}

/**
 * Calcula o gasto do banco de offline training do personagem (#631, ADR 0059 d.3-d.4), ou `null`
 * quando não há nada a fazer — nenhuma skill escolhida no livro é o caso comum, e nele a linha não
 * é tocada. `awayMs` é o tempo em repouso (agora − o carimbo do `release`); o teto por conta é
 * Free 6 h / Premium 12 h, e o Premium é derivado AQUI contra o relógio, como no ticket.
 */
function offlineSpendOf(
  character: CharacterRecord,
  restedSinceMs: number,
  offline: NonNullable<TicketRouteDependencies['offlineTraining']>,
): OfflineSpend | null {
  const training = readOfflineTrainingState(character.training);
  if (training === undefined || training.offlineSkill === null) return null;
  const nowMs = offline.now?.() ?? Date.now();
  const skills = typeof character.skills === 'object' && character.skills !== null
    ? character.skills as SkillsState
    : undefined;
  const result = settleOfflineTraining({
    training,
    skills,
    awayMs: nowMs - restedSinceMs,
    premium: character.premiumUntil !== null && character.premiumUntil.getTime() > nowMs,
    vocationId: character.vocation,
  }, offline.rules);
  return { skills: result.skills, training: result.training, settlement: result.settlement };
}

/**
 * O que o ticket carrega de um personagem: a linha do banco, validada campo a campo. É a
 * MESMA montagem para o ticket solo e para cada membro de uma party (#195) — o `game` não
 * fala com o Postgres, e tudo o que a sessão precisa saber do personagem passa por aqui.
 */
export function initialCharacterOf(
  character: CharacterRecord,
  instances: Parameters<typeof inventoryOf>[0],
  /** Os storages do personagem (#731), como `listCharacterStorages` os devolve. */
  storages: readonly { readonly storageKey: string; readonly value: number }[] = [],
  /** A Boosted Creature do dia (#615), do cache em Redis. Ver `TicketRouteDependencies`. */
  boostedMonsterId?: string,
  /** O bônus de Loyalty da conta (#628), já calculado pela `api`. Ver `TicketRouteDependencies`. */
  loyaltyBonusPercent?: number,
  /** A maior versão durável ainda pendente no Redis (#823). Ver `TicketRouteDependencies`. */
  pendingDurableVersion = 0,
  /** A flag `OPEN_WORLD` (#836, OW-15): leva o mundo e os vitais. Ver `TicketRouteDependencies`. */
  openWorld = false,
): InitialCharacter {
  return {
    level: character.level,
    xp: character.xp,
    name: character.name,
    gold: character.gold,
    soul: character.soul,
    ...(boostedMonsterId === undefined ? {} : { boostedMonsterId }),
    // O Loyalty (#628): fixado no ticket como a boosted, e ausente quando não há degrau — o
    // ticket do caso comum (conta com menos de 360 dias) continua idêntico ao de antes.
    ...(loyaltyBonusPercent === undefined ? {} : { loyaltyBonusPercent }),
    // A versão durável (#823, OW-02): o piso do contador do hospedeiro. Sai SEMPRE, inclusive
    // `0` — ausente significaria "o `api` não sabe", e o `game` passaria a gravar extratos sem
    // versão. `max` porque os pendentes que o teto de liquidação deixou para trás ainda não
    // subiram a coluna.
    durableVersion: Math.max(character.durableVersion, pendingDurableVersion),
    // O mundo e os vitais (#836, OW-15, ADR 0060 d.10.f), SÓ com a flag: a posição onde saiu, a
    // cidade, a vida e a mana com que saiu e as condições que faltavam. Cada campo é conferido ao
    // sair da linha (`worldStateOfRow`): nulo é "cheio, no templo, sem condição", e o `game` ainda
    // limita a vida e a mana pelo máximo do level. Sem a flag nada é lido — o ticket é o de antes.
    ...(openWorld ? worldStateOfRow(character) : {}),
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
    // E a economia de Charms (M39-02, #602), pela mesma régua do Bestiário.
    ...charmsOf(character.charms),
    // E o Bosstiary (#629), pela mesma régua do Bestiário.
    ...bosstiaryOf(character.bosstiary),
    // E as magias aprendidas (#624, ADR 0058), pela mesma régua: sem isto, quem comprou ontem
    // entraria hoje na hunt sem lançar nada, apesar de ter pago.
    ...learnedSpellsOf(character.learnedSpells),
    // E o familiar (M38-02, #599, ADR 0057 d.3): os carimbos de parede que o cooldown de 30 min e a
    // recriação ao entrar consultam — sem eles, sair da hunt zeraria o cooldown.
    ...familiarOf(character.familiar),
    // E o registro do Treino (#631, ADR 0059): a régua do `sim`, torto vira ausente.
    ...trainingOf(character.training),
    // E o Hazard (M44-14, #632): o nível que ele escolheu na Cidade entra na hunt fixado.
    ...hazardOf(character.hazard),
    // E os storages (#731, ADR 0050 d.6 T2): uma linha por chave, não uma coluna — a montagem é
    // a mesma ideia de `inventoryOf`, reduzindo as linhas do banco a um mapa.
    ...storagesOf(storages),
    // Comida ativa (#726, ADR 0049 decisão 5): sem isto, quem comeu antes de deslogar voltaria
    // em jejum na hunt seguinte.
    fedMs: character.fedMs,
    // As bênçãos (#570, ADR 0052): sem isto, quem comprou na Cidade entraria na hunt sem elas
    // e morreria sem redução nenhuma, apesar de ter pago.
    blessings: character.blessings,
    // E a vocação (#154): escrita uma vez pelo `jobs`, lida aqui a cada entrada.
    ...(character.vocation === null ? {} : { vocation: character.vocation }),
    // E a promoção (#566, ADR 0042 decisão 1): lida aqui a cada entrada, como a vocação.
    // Ausente quando `false` — a coluna não é nulável, e "não promovido" é o normal.
    ...(character.promoted ? { promoted: true } : {}),
    // E a postura de luta (#550, M30-03): validada AQUI, como o Bestiário — a coluna tem CHECK, mas
    // um valor torto (banco editado à mão) some do ticket e a sessão parte da ofensiva do Canary.
    ...(isFightMode(character.fightMode) ? { fightMode: character.fightMode } : {}),
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

/** O Bosstiary (#629), pela mesma régua e razão de `bestiaryOf`: torto ou `null` vira ausente. */
function bosstiaryOf(stored: unknown): { bosstiary?: BosstiaryState } {
  return isBosstiaryState(stored) ? { bosstiary: stored } : {};
}

/** As magias aprendidas (#624, ADR 0058), pela mesma régua e razão de `bestiaryOf`. */
function learnedSpellsOf(stored: unknown): { learnedSpells?: LearnedSpellsState } {
  return isLearnedSpellsState(stored) ? { learnedSpells: stored } : {};
}

/** A economia de Charms (M39-02, #602), pela mesma régua e razão de `bestiaryOf`. */
function charmsOf(stored: unknown): { charms?: CharmsState } {
  return isCharmsState(stored) ? { charms: stored } : {};
}

/** O familiar (M38-02, #599), pela mesma régua e razão de `charmsOf`. */
function familiarOf(stored: unknown): { familiar?: FamiliarState } {
  return isFamiliarState(stored) ? { familiar: stored } : {};
}

/** O registro do Treino (#631, ADR 0059), pela mesma régua e razão de `charmsOf`. */
function trainingOf(stored: unknown): { training?: OfflineTrainingState } {
  const training = readOfflineTrainingState(stored);
  return training === undefined ? {} : { training };
}

/** O Hazard (M44-14, #632), pela mesma régua e razão de `charmsOf`. */
function hazardOf(stored: unknown): { hazard?: HazardState } {
  return isHazardState(stored) ? { hazard: stored } : {};
}

/**
 * Reduz as linhas de `character_storage` (#731) a `storageKey → value` — a mesma ideia de
 * `inventoryOf`, para uma tabela em vez de uma coluna `jsonb`. Vazio é ausente, e não `{}`:
 * a chave só existe quando há valor, como em `bestiaryOf` (`exactOptionalPropertyTypes`).
 */
function storagesOf(
  rows: readonly { readonly storageKey: string; readonly value: number }[],
): { storages?: Readonly<Record<string, number>> } {
  if (rows.length === 0) return {};
  const storages: Record<string, number> = {};
  for (const row of rows) storages[row.storageKey] = row.value;
  return { storages };
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
  container?: string | null; slotIndex?: number | null; overlay?: unknown;
}[]): { backpack: unknown[]; satchel: unknown[]; equipped: Record<string, unknown> } {
  // Posicional (#160): cada linha volta ao lugar gravado; a linha sem posição (anterior a
  // #160, ou duas na mesma posição por banco tocado à mão) entra no primeiro lugar livre da
  // mochila no fim — o `ensureContainers` da entrada acerta o tamanho inicial.
  const backpack: (unknown | null)[] = [];
  const satchel: (unknown | null)[] = [];
  const equipped: Record<string, unknown> = {};
  const unplaced: unknown[] = [];
  for (const row of instances) {
    // O overlay por instância (#604, ADR 0046), lido na régua do Bestiário: torto vira ausente
    // — a instância volta a ser igual à definição — em vez de trancar o login.
    const overlay = readItemOverlay(row.overlay);
    const carried = {
      instanceId: row.id, itemId: row.itemId, quantity: row.quantity,
      ...(overlay === undefined ? {} : { overlay }),
    };
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
