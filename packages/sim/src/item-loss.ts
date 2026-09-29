// Perda de item na morte (#571, ADR 0042 decisão 4) — `Blessings.PlayerDeath`/`DropLoot` do
// Canary (`data/libs/systems/blessing.lua:82-126`), mais o consumo do Amulet of Loss de
// `Player::death` (`src/creatures/players/player.cpp:4213-4219`).
//
// **O Tibia larga o item perdido no cadáver do jogador; o Draconya não tem item no chão.** O
// ADR 0037 (Alternativas) já rejeitou o cadáver-container que isso exigiria, então "perder" aqui
// é DESTRUIR: o item sai do inventário, a instância entra em `removedInstances` (o `jobs` apaga a
// linha de `item_instance` na MESMA transação da linha de ledger, `UNIQUE (session_id, seq)` —
// invariante 10) e cada perda vira um evento notável do extrato. Isto é irreversível para o
// jogador, e por isso o conteúdo real entrega o bloco DESLIGADO até o dono decidir (ver
// `itemLossSchema` em `packages/content/src/schemas.ts`): este módulo é o mecanismo inteiro, e
// `enabled` é a única chave.
//
// **O mecanismo, como o Canary o descreve:**
//
//   1. o Amulet of Loss VESTIDO (`protectsOnDeath` no slot do pescoço) protege tudo: nenhum
//      sorteio; e um personagem com CINCO ou mais bênçãos também está protegido — a tabela
//      `LossPercent` dá zero a partir dali;
//   2. senão, cada slot vestido, na ordem de `CANARY_SLOT_ORDER`, consome UM sorteio de 1 a
//      10 000 (`math.random(100 * multiplier)`, resolução de 0,01%) e perde o item se o número
//      cair até `chance × 100` — `chance` cheia para container (a mochila, e a aljava, que no
//      cliente é container), `chance / 10` para o resto;
//   3. perder a mochila leva junto tudo o que estava dentro dela;
//   4. quem ficou sem mochila nas costas — perdeu agora ou já não tinha — ganha uma bag nova.
//
// Tudo isto roda ANTES da penalidade de XP/skill e do consumo das bênçãos, como no Canary
// (`Creature::onDeath` chama `dropCorpse` antes de `death()`): a contagem de bênçãos que decide
// a chance é a de ANTES de a morte consumi-las, e o Amulet of Loss protege antes de ser
// consumido. O consumo do colar é a função à parte (`consumeLossAmulet`), porque no Canary ele
// vem DEPOIS da penalidade e lê o level já rebaixado.
//
// Puro (invariante 1): sem I/O, sem relógio; o sorteio é do `Rng` da sessão — determinístico por
// semente, e o mesmo com ou sem ninguém assistindo (invariante 3).

import type { Item, ItemLoss, ItemSlot, Progression } from '@draconya/content';
import type { CharacterRuntime } from './character.js';
import { CANARY_SLOT_ORDER, containerRulesFor } from './inventory.js';
import type { CarriedItem } from './inventory.js';
import type { Rng } from './rng.js';

/**
 * A resolução do sorteio: `math.random(100 * multiplier)` com `multiplier = 100`
 * (`blessing.lua:102-105`) — inteiro em [1, 10 000], então a chance mínima é 0,01%.
 */
export const LOSS_ROLL_RESOLUTION = 10_000;

/** Uma perda: a instância destruída e de onde ela saiu. */
export interface LostItem {
  readonly item: CarriedItem;
  /**
   * O slot do corpo de onde saiu, ou `'backpack-contents'` quando estava DENTRO da mochila que
   * se perdeu junto — o item de dentro nunca foi sorteado, foi levado pelo container.
   */
  readonly from: ItemSlot | 'backpack-contents';
}

export interface ItemLossOutcome {
  readonly lost: readonly LostItem[];
  /**
   * Por que nenhum sorteio aconteceu: o colar protegia, ou as bênçãos zeravam a chance. `null` é
   * "sorteou" (mesmo que nada tenha caído) ou "desligado".
   */
  readonly protectedBy: 'amulet' | 'blessings' | null;
  /** A mochila que a morte entregou a quem ficou sem nenhuma, ou `null`. */
  readonly replacement: CarriedItem | null;
}

const NOTHING_LOST: ItemLossOutcome = { lost: [], protectedBy: null, replacement: null };

export interface ItemLossContext {
  readonly progression: Progression;
  readonly items: ReadonlyMap<string, Item>;
  /**
   * Quantas bênçãos o morto tinha ANTES de a morte as consumir (`blessingCount`,
   * `blessings.ts`) — o índice da tabela `lossPercentByBlessings`.
   */
  readonly blessings: number;
  readonly rng: Rng;
  /**
   * Cunha o id da instância da mochila de reposição. Vem de fora porque o formato depende do
   * tipo de sessão (em party o id leva o dono no meio — dois membros com `lootSeq` 0 colidiriam),
   * e o `hunt.ts` é quem sabe.
   */
  readonly newInstanceId: () => string;
}

/**
 * A chance, em percentual, de perder cada item vestido com esta contagem de bênçãos
 * (`Blessings.LossPercent[n].item`). Contagem além do fim da tabela usa a última entrada.
 */
export function lossPercentFor(rules: ItemLoss, blessings: number): number {
  const table = rules.lossPercentByBlessings;
  return table[Math.min(Math.max(blessings, 0), table.length - 1)] ?? 0;
}

/**
 * O item é um container para a regra de perda? `item:isContainer()` do Canary lê o grupo do item
 * pela flag `container` do CLIENTE (`items.cpp:174-178`), não pelo `items.xml` — e a aljava tem a
 * flag (conferido nos `appearances.dat` do pacote 13.32 para os ids 35562, 35848 e 36666), então
 * perde com a chance cheia como a mochila. Sem catálogo para o id (conteúdo que saiu), não é
 * container: não há como saber, e o caso mais barato é o de um décimo.
 */
function isContainerForLoss(definition: Item | undefined): boolean {
  return definition !== undefined && (definition.kind === 'container' || definition.quiver);
}

/**
 * A morte tira os itens do personagem (`Blessings.PlayerDeath`). Muta o inventário do personagem
 * e a lista de instâncias destruídas (`removedInstances`, que o extrato drena); devolve o que
 * mudou para quem chamou registrar no extrato da sessão.
 *
 * Com o bloco de conteúdo ausente ou `enabled: false` não toca em nada — nem a bag de reposição:
 * o "nunca perde item" provisório é a AUSÊNCIA de qualquer mudança de inventário na morte.
 */
export function loseItemsOnDeath(character: CharacterRuntime, context: ItemLossContext): ItemLossOutcome {
  const rules = context.progression.deathPenalty.itemLoss;
  if (rules === undefined || !rules.enabled) return NOTHING_LOST;
  const inventory = character.inventory;

  const neck = inventory.equippedAt('neck');
  const hasAmulet = neck !== null && context.items.get(neck.itemId)?.protectsOnDeath === true;
  const percent = lossPercentFor(rules, context.blessings);

  const lost: LostItem[] = [];
  let protectedBy: ItemLossOutcome['protectedBy'] = null;
  if (hasAmulet) {
    protectedBy = 'amulet';
  } else if (percent <= 0) {
    protectedBy = 'blessings';
  } else {
    for (const slot of CANARY_SLOT_ORDER) {
      const equipped = inventory.equippedAt(slot);
      if (equipped === null) continue;
      // Um sorteio por item vestido, sempre — inclusive o que não cai. É o que faz a sequência do
      // `Rng` depender só de QUANTOS itens estão vestidos, nunca do resultado dos anteriores.
      const roll = context.rng.integer(1, LOSS_ROLL_RESOLUTION);
      const chance = isContainerForLoss(context.items.get(equipped.itemId))
        ? percent * 100
        : (percent * 100) / rules.nonContainerDivisor;
      if (roll > chance) continue;
      const taken = inventory.loseEquipped(slot);
      if (taken === null) continue;
      lost.push({ item: taken.item, from: slot });
      for (const inside of taken.contents) lost.push({ item: inside, from: 'backpack-contents' });
    }
    for (const entry of lost) character.removedInstances.push(entry.item.instanceId);
  }

  // Fica sem mochila nas costas: perdeu agora, ou já não tinha (a desvestiu). Roda mesmo
  // protegido — no Canary o `addItem(ITEM_BAG)` está fora dos ramos da perda.
  let replacement: CarriedItem | null = null;
  if (inventory.equippedAt('back') === null) {
    const bag: CarriedItem = {
      instanceId: context.newInstanceId(),
      itemId: rules.replacementContainerId,
      quantity: 1,
      origin: 'death-replacement',
    };
    if (inventory.grantEquipped('back', bag)) {
      // O container ganha os lugares da peça nova: sem isto a bag vestiria com zero lugares e o
      // loot iria para a bolsa como se o personagem estivesse sem mochila.
      inventory.ensureContainers(containerRulesFor(inventory, context.items, context.progression));
      replacement = bag;
    }
  }

  return { lost, protectedBy, replacement };
}

/**
 * A morte consome UM Amulet of Loss vestido (`Player::death`, `player.cpp:4213-4219`): o colar é
 * de uso único, protegendo ou não — inclusive com cinco bênçãos, quando ele não tinha o que
 * proteger. Devolve a instância consumida, ou `null`.
 *
 * **Roda DEPOIS da penalidade de morte**, porque no Canary a conferência lê o level JÁ
 * rebaixado: quem tem vocação e ficou abaixo do level do Adventurer's Blessing
 * (`progression.blessingPricing.freeBelowLevel`, 21 — `adventurersBlessingLevel` do
 * `config.lua.dist`) não perde bênção nem colar (`willNotLoseBless`). Sem `blessingPricing` no
 * conteúdo não há level de Adventurer, e o colar sempre se consome.
 *
 * Desligado (`enabled: false`) não consome nada, pela mesma razão de `loseItemsOnDeath`: gastar
 * o colar é perder item.
 */
export function consumeLossAmulet(
  character: CharacterRuntime,
  context: Pick<ItemLossContext, 'progression' | 'items'>,
): CarriedItem | null {
  const rules = context.progression.deathPenalty.itemLoss;
  if (rules === undefined || !rules.enabled) return null;
  const neck = character.inventory.equippedAt('neck');
  if (neck === null || context.items.get(neck.itemId)?.protectsOnDeath !== true) return null;
  const adventurerLevel = context.progression.blessingPricing?.freeBelowLevel;
  if (adventurerLevel !== undefined && character.level < adventurerLevel && character.vocationId !== null) {
    return null;
  }
  const consumed = character.inventory.destroy('neck');
  if (consumed !== null) character.removedInstances.push(consumed.instanceId);
  return consumed;
}
