// O checkpoint do mundo, do lado do hospedeiro (#837, OW-16, ADR 0060 decisão 10).
//
// O mundo é uma sessão que nunca termina, e por isso o progresso dos donos não pode esperar o `end`
// (a hunt) nem o logout de cada um: a cada `WORLD_CHECKPOINT_MS` o hospedeiro grava, de UMA vez, o
// extrato de todo personagem que mudou desde o último lote — e grava o lote inteiro, não só a linha de
// quem sai, quando alguém sai, transiciona, morre ou o nó drena. Numa queda o mundo perde até um
// intervalo de TODOS ao mesmo tempo, e todos voltam ao mesmo instante (o último lote), em vez de cada
// um a um instante diferente.
//
// Este arquivo é o que NÃO precisa de `SessionHost`: o que é "sujo", qual o estado que o último lote
// gravou, e a fila de extratos que ainda não pousaram. A orquestração — montar o extrato, a versão
// durável, o `MULTI`, o gold — mora em `host.ts`, porque lê estado privado dele.
//
// **Nada aqui lê um visualizador.** O que um personagem rendeu não depende de haver alguém olhando
// (invariante 3): "sujo" olha o personagem e os agregados da sessão, nunca `#presentMoves` — que sem
// visualizador nem roda.

import type { Aggregates, CharacterRuntime, InventoryState, Point } from '@draconya/sim';
import type { SessionReceipt } from '../receipts.js';

/**
 * A cadência do checkpoint do mundo: 60 s (ADR 0060 d.10d). É o que a decisão compra — 3,3
 * transações por segundo com 200 personagens caçando, contra 20 a cada 10 s — e o que o mundo perde
 * numa queda. Configurável por `WORLD_CHECKPOINT_MS` (`config.ts`); a hunt idle continua com os 10 s do
 * snapshot (ADR 0018:57), que é outro mecanismo.
 */
export const WORLD_CHECKPOINT_MS = 60_000;

/**
 * Onde o personagem está no mundo AGORA, em coordenada absoluta, se o ruleset sabe dizê-lo —
 * `WorldRuleset#worldPositionOf`, que traduz o `position` do recorte pelo `source.region` do mapa.
 *
 * É uma consulta ao ruleset por forma, e não por tipo: o `Ruleset` genérico do `sim` não declara a
 * pergunta (só o mundo a responde, como `acceptsCityServices`), e o hospedeiro não conhece a classe.
 * Ausente é "este ruleset não sabe", e o checkpoint segue sem a âncora — o personagem de uma sessão
 * sem posição absoluta não tem para onde voltar.
 */
export function worldPositionOf(ruleset: object, character: CharacterRuntime): Point | undefined {
  const reader = ruleset as { worldPositionOf?: (character: CharacterRuntime) => Point | undefined };
  return reader.worldPositionOf?.(character);
}

/**
 * O que o personagem CARREGA, `instanceId → quantidade`: mochila, bolsa e o corpo (o equipado conta —
 * é uma instância e tem linha de `item_instance` como as outras). É o que o extrato do mundo leva em
 * `quantities` e o que o checkpoint compara para saber o que SAIU do inventário.
 */
export function carriedQuantities(inventory: InventoryState): Map<string, number> {
  const carried = new Map<string, number>();
  for (const item of inventory.backpack) if (item !== null) carried.set(item.instanceId, item.quantity);
  for (const item of inventory.satchel ?? []) if (item !== null) carried.set(item.instanceId, item.quantity);
  for (const item of Object.values(inventory.equipped)) carried.set(item.instanceId, item.quantity);
  return carried;
}

/**
 * O que o inventário do dono deve ao banco, além do que o `sim` já contou em `removedInstances` (#837).
 *
 * O `acquired` do extrato é CUMULATIVO — a sessão do mundo nunca termina, e todo item que o personagem
 * pega nela leva o prefixo dela —, e o ledger o insere sem tocar na linha que já existe. Sozinho ele
 * congela a quantidade de uma pilha no primeiro checkpoint em que ela apareceu, e deixa de pé a linha
 * da que acabou. Estes dois campos fecham a conta:
 *
 * - `quantities`: a quantidade de TODA instância carregada AGORA — estado absoluto INTEIRO, e não
 *   delta, porque o ledger só escreve absoluto de extrato mais novo e descarta o velho por completo
 *   (premissa da guarda de versão, `jobs/ledger.ts`): um delta se perderia com ele;
 * - `removed`: o que o `sim` já reportou MAIS toda instância que estava no inventário no último extrato
 *   (`baseline`) e já não está — a comida que acabou, o anel que venceu, a carga gasta. Nenhum desses
 *   caminhos passa por `removedInstances` (`Inventory.consumeOne`, `destroy`), e o host não precisa
 *   saber quais são: a diferença entre dois inventários os pega todos. Só entra o que o PRÓPRIO jogo
 *   carregou, nunca uma linha que o banco tenha e a sessão não conheça.
 */
export interface InventoryDelta {
  readonly quantities: Record<string, number>;
  readonly removed: string[];
}

/**
 * `baseline` é o inventário do último extrato (ou da chegada); `undefined` é "não sei" — o personagem
 * sem marca —, e então só o que o `sim` reportou é removido: apagar sem saber o que o banco tem seria
 * adivinhar. `reported` é o `removedInstances` que o `sim` drenou.
 */
export function inventoryDeltaOf(
  baseline: ReadonlyMap<string, number> | undefined, current: ReadonlyMap<string, number>,
  reported: readonly string[],
): InventoryDelta {
  const removed = new Set(reported);
  if (baseline !== undefined) for (const instanceId of baseline.keys()) if (!current.has(instanceId)) removed.add(instanceId);
  return { quantities: Object.fromEntries(current), removed: [...removed] };
}

/**
 * O estado de um personagem que o ÚLTIMO lote gravou, no que o checkpoint decide por comparação:
 * onde ele estava, a vida, a mana, QUAIS condições tinha e o que carregava. É o que permite dizer
 * "este personagem não mexeu em nada" sem reserializar o extrato inteiro de duzentos personagens a
 * cada minuto.
 *
 * A condição entra pela CHAVE, e não pelo prazo restante: o prazo encolhe a cada segundo, e compará-lo
 * deixaria todo personagem com uma haste ativa sujo para sempre. A que entra ou sai muda a assinatura;
 * a que só envelhece não — e o prazo que a linha guarda fica um pouco velho, o que numa queda devolve
 * a condição com o prazo de um lote atrás (um pouco mais longo que o de agora): o mesmo erro, para o
 * mesmo lado, que a queda faz em todo o resto — o mundo volta ao último lote.
 */
export interface CheckpointMark {
  /** `x,y,z` da coordenada absoluta, ou vazio quando o ruleset não a diz. */
  readonly position: string;
  readonly health: number;
  readonly mana: number;
  readonly alive: boolean;
  /** As chaves das condições ativas, em ordem. */
  readonly conditions: string;
  /**
   * O que ele carregava, `instanceId → quantidade` (`carriedQuantities`). Mudar a quantidade de uma
   * pilha — comer, empilhar — suja o personagem, e a diferença contra o próximo inventário é o que
   * sobrou de `removedInstances` (`inventoryDeltaOf`).
   */
  readonly items: ReadonlyMap<string, number>;
}

/** O estado de `character` como o checkpoint o compara. `position` é a de agora (`worldPositionOf`). */
export function markOf(character: CharacterRuntime, position: Point | undefined): CheckpointMark {
  return {
    position: position === undefined ? '' : `${position.x},${position.y},${position.z}`,
    health: character.health,
    mana: character.mana,
    alive: character.alive,
    conditions: character.conditions.getState().map((condition) => condition.key).sort().join('|'),
    items: carriedQuantities(character.inventory.getState()),
  };
}

/** Os dois estados são o mesmo, no que o checkpoint compara? */
export function sameMark(a: CheckpointMark, b: CheckpointMark): boolean {
  if (a.position !== b.position || a.health !== b.health || a.mana !== b.mana
    || a.alive !== b.alive || a.conditions !== b.conditions || a.items.size !== b.items.size) {
    return false;
  }
  for (const [instanceId, quantity] of a.items) if (b.items.get(instanceId) !== quantity) return false;
  return true;
}

/**
 * O personagem rendeu ALGO desde o último extrato — XP, gold, abate, item, morte, suprimento, dano ou
 * cura. Tudo que os agregados dele contam, menos `durationMs`: o tempo corre para todo presente a cada
 * avanço, e um personagem parado na PZ teria o agregado "não zero" a partir do primeiro segundo.
 *
 * Dano e cura entram junto do valor porque são o sinal de que as skills andaram (`skills` é estado
 * absoluto do extrato) — e quem bateu sem matar nem apanhar nem mudar de lugar é raro, mas existe.
 */
export function hasActivity(aggregates: Aggregates): boolean {
  for (const key of Object.keys(aggregates) as (keyof Aggregates)[]) {
    if (key !== 'durationMs' && aggregates[key] !== 0) return true;
  }
  return false;
}

/**
 * Um extrato já montado — com `seq` do `sim` e a versão durável tomada — que ainda não pousou no
 * Redis. `claim` é a chave de `#claimedVersions` (`personagem|sessão|seq`); `owner` é de quem
 * `settleGoldDelta` roda DEPOIS de gravar, e é `undefined` só para o extrato sem dono achável.
 */
export interface PendingLine {
  readonly receipt: Omit<SessionReceipt, 'endedAtMs'>;
  readonly owner: CharacterRuntime | undefined;
  readonly claim: string;
}

/**
 * O que o hospedeiro guarda de UMA sessão `checkpointed` (OW-16). Só o mundo tem — a hunt e a
 * Cidade guardam `null` em `HostedSession.checkpoint`, e não pagam nada.
 */
export class CheckpointState {
  /**
   * O que o último lote gravou de cada personagem presente. Nasce na entrada (o estado com que ele
   * chegou É o que a linha dele guarda) e some na saída. Personagem SEM marca é tratado como sujo:
   * gravar a mais é o lado seguro.
   */
  readonly marks = new Map<string, CheckpointMark>();
  /**
   * Os extratos de um lote que NÃO pousou — o Redis estava fora, ou a resposta se perdeu. `leave` e
   * `checkpoint` emitem o extrato UMA vez e já zeraram o que ele leva: se ele só existisse na pilha da
   * função que falhou, esse crédito sumiria. Ficam aqui, com o mesmo `seq` e a mesma versão, e vão na
   * frente do lote seguinte: repetir é seguro (a chave é a mesma e o ledger recusa o `(session_id,
   * seq)` repetido), e a versão mantém a ordem na liquidação.
   */
  unsaved: PendingLine[] = [];
  /**
   * O fim do último lote enfileirado, que nunca rejeita. Os lotes de uma sessão rodam UM DE CADA VEZ:
   * o lote seguinte só é montado depois que o anterior terminou, então o que falhou já voltou para
   * `unsaved` e vai nele — e a saída de um personagem espera, por construção, o lote em voo que
   * pode ter o crédito dele.
   */
  tail: Promise<void> = Promise.resolve();
  /** Quantos lotes estão enfileirados ou em voo. O timer não empilha um novo sobre um que não acabou. */
  queued = 0;
}
