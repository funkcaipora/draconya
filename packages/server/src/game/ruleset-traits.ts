// As perguntas que o hospedeiro faz a um `Ruleset`, com nome (OW-04, ADR 0060 d.10c).
//
// Antes, o hospedeiro respondia todas elas com uma só pergunta: "esta sessão é um shard?"
// (`ruleset.shared === true`), em treze lugares de `game/host.ts`. Funcionava enquanto a Cidade
// era o único shard, e o shard, por definição, não creditava nada. O mundo aberto é o primeiro
// shard que credita — e a pergunta "é shard?" passa a ter quatro respostas diferentes, uma por
// ramo: sair é `leave`? credita o agregado? guarda snapshot? tem campo de visão por célula?
//
// Cada predicado abaixo é UMA dessas perguntas. Hoje todos se resolvem por `shared` e `progress`,
// e por isso a refatoração não muda nada observável (a Cidade e a hunt não declaram `progress`):
// o que ela compra é que o mundo troque UMA resposta sem tocar nas outras. A tabela de quem lê
// qual predicado, e o que cada um faz no mundo, está em `packages/server/AGENTS.md`.
//
// **Sem `sim` aqui dentro.** São funções puras sobre dois campos do ruleset: quem decide o que
// gravar é o hospedeiro, e o `sim` só declara.

import { progressOf } from '@draconya/sim';
import type { Ruleset } from '@draconya/sim';

/** O que os predicados leem do ruleset. Os dois campos que o OW-03 separou. */
export type RulesetTraits = Pick<Ruleset, 'shared' | 'progress'>;

/**
 * Sair desta sessão é `leave` — a sessão continua de pé para quem fica — e não `end`.
 *
 * É o sentido que sobrou de `Ruleset.shared` depois do OW-03: uma cópia compartilhada por muitos
 * personagens (ADR 0023). Quem sai leva o próprio extrato (a Cidade, o mundo), e a sessão só some
 * quando ninguém mais está nela. A sessão privada (hunt, treino) é o contrário: sair é encerrar.
 */
export function leavesOnExit(ruleset: RulesetTraits): boolean {
  return ruleset.shared === true;
}

/**
 * O que os donos rendem — XP, gold, abates, itens — vira linha de ledger pelo AGREGADO da sessão
 * (`Session.credit`), e não só pelo estado.
 *
 * É a resposta à pergunta "o gold desta sessão anda pelo agregado?" que o canal único de gold
 * (ADR 0060 d.10c) exige:
 *
 * - **creditsAggregates** (hunt, treino, e o mundo `checkpointed`): o gold se move pelo agregado
 *   E pelo `goldDelta`, juntos, e o hospedeiro liquida o `goldDelta` depois de gravar o extrato
 *   (`settleGoldDelta`). O extrato leva o agregado.
 * - **sem ele** (a Cidade): o `goldDelta` vai como agregado do extrato de ESTADO
 *   (`#saveDurableReceipt`), porque o agregado da sessão é cumulativo e nunca zerado por extrato.
 * - **nunca as duas coisas**: somar os dois re-creditaria a mesma venda no próximo logout.
 *
 * A sessão privada sempre credita — o `end` é o único caminho do que ela rendeu até o ledger, e
 * um `progress: 'none'` nela não tem leitura: o campo só tem sentido em quem `leavesOnExit`.
 * Sessão compartilhada credita só se declarar `progress: 'checkpointed'` (`progressOf` resolve
 * a ausência para `'none'`).
 */
export function creditsAggregates(ruleset: RulesetTraits): boolean {
  return !leavesOnExit(ruleset) || progressOf(ruleset) === 'checkpointed';
}

/**
 * O hospedeiro guarda snapshot desta sessão (FUN-28) — para ela sobreviver à queda do nó.
 *
 * Só a sessão privada: a que se compartilha não tem como guardar a si mesma por personagem — o
 * snapshot seria a praça inteira, uma cópia por participante, a cada intervalo (ADR 0023). O
 * progresso do mundo chega ao banco por checkpoint, com timer próprio (ADR 0060 d.10a, OW-16 —
 * `checkpointsProgress`), e não por snapshot.
 */
export function keepsSnapshot(ruleset: RulesetTraits): boolean {
  return !leavesOnExit(ruleset);
}

/**
 * O progresso desta sessão chega ao Redis por CHECKPOINT: um lote a cada `WORLD_CHECKPOINT_MS` com o
 * extrato de todo personagem sujo, e antecipado inteiro em saída, transição, morte e drenagem
 * (ADR 0060 d.10d, OW-16). É a sessão que sai por personagem E credita — o mundo.
 *
 * Não é `creditsAggregates` (a hunt também credita, e uma vez só, no `end`) nem `!keepsSnapshot` (a
 * Cidade também não guarda snapshot, e não credita nada): é a conjunção das duas respostas que só o
 * mundo dá. A Cidade grava estado ao sair (`#saveDurableReceipt`), a hunt grava no `end` e tem snapshot
 * a cada dez segundos; nenhuma das duas tem lote.
 */
export function checkpointsProgress(ruleset: RulesetTraits): boolean {
  return leavesOnExit(ruleset) && progressOf(ruleset) === 'checkpointed';
}

/**
 * O que cada visualizador recebe é filtrado por campo de visão por célula (`AreaOfInterest`,
 * FUN-33) — quando o nó tem a opção ligada. Só faz sentido onde há vizinhança: numa sessão de
 * um dono só (ou de uma party) todo mundo vê tudo, e filtrar seria custo sem ganho. O mundo
 * tem a vizinhança mais populosa de todas e liga.
 */
export function usesAreaOfInterest(ruleset: RulesetTraits): boolean {
  return ruleset.shared === true;
}

/**
 * A sessão aceita o que a Cidade oferece em serviço — hoje, comprar bênção (#570). Sessão
 * privada recusa: a `blessing.lua` do Canary trava o santuário em protect zone, e a hunt nunca é
 * uma.
 *
 * É a pergunta "esta sessão é lugar de serviço?" no nível da SESSÃO. No mundo, ela não basta: o
 * serviço exige estar num tile de PZ, e essa conferência é do tile, não da sessão — é
 * `Ruleset.acceptsCityServices(session, characterId)`, que o `sim` responde desde a OW-13 e o
 * hospedeiro chama desde a OW-18 (`SessionHost#cityServiceRefusal`, que soma as duas perguntas).
 */
export function offersCityServices(ruleset: RulesetTraits): boolean {
  return ruleset.shared === true;
}
