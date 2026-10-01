// A compra mínima por gold na Cidade (#631, M44-13; ADR 0059 d.2): o `buy-item { itemId }` que a
// exercise weapon precisa enquanto a loja geral (E5) não existe.
//
// **É o mínimo, e de propósito.** Só item com `purchasable: true` — o preço é o `buyPrice`, o MENOR
// `buy` de NPC do Canary (`npc-prices.ts`, ADR 0038 d.6) —, uma unidade por pedido, direto na
// mochila. Não há stock, reputação, nem diálogo de NPC (ADR 0042 questão 2: tela de serviço é o
// padrão). A loja geral substitui o mecanismo sem mudar o dado: `purchasable`/`buyPrice` continuam
// sendo o que o catálogo diz.
//
// **Gold e item andam JUNTOS.** O débito é `goldDelta` (o canal de sempre — o extrato o leva ao
// ledger, invariante 10) e o item nasce como instância NOVA de origem `purchase`, que o extrato
// grava em `item_instance` por `acquired` (ADR 0052 d.3). Nada muda se o pedido é recusado: a
// conferência inteira vem ANTES de tocar em `goldDelta` ou na mochila.

import type { Item } from '@draconya/content';
import type { CharacterRuntime } from './character.js';
import type { CarriedItem, ContainerRules } from './inventory.js';

export type BuyRefusal =
  /** Não existe, ou não é `purchasable`: o catálogo mínimo não vende isto. */
  | 'not-for-sale'
  | 'not-enough-gold'
  /** O peso não cabe (`add` recusa por peso, como o Canary no NPC). */
  | 'over-capacity'
  | 'stack-too-large';

export type BuyResult =
  | { readonly ok: true; readonly instanceId: string; readonly price: number }
  | { readonly ok: false; readonly reason: BuyRefusal };

export interface BuyOptions {
  /** O catálogo inteiro — o peso da compra é conferido contra ele (`Inventory.add`). */
  readonly catalog: ReadonlyMap<string, Item>;
  readonly rules: ContainerRules;
  /**
   * A identidade da instância NOVA. Quem chama a fabrica ÚNICA por compra: numa cópia da Cidade dois
   * personagens compartilham o `session.id`, e a mesma cópia é reaberta em outro dia, então um id
   * derivado só de `lootSeq` colidiria na chave primária de `item_instance` (o `ON CONFLICT DO
   * NOTHING` do ledger engoliria a segunda compra). É o host quem sabe o que é único.
   */
  readonly instanceId: string;
}

/**
 * Compra UMA unidade de `item` por `item.buyPrice`. Devolve a recusa ou a instância criada. O gold
 * disponível é o SALDO — `gold + goldDelta` —, porque um gasto anterior na mesma sessão de Cidade
 * já baixou o que sobra.
 */
export function buyItem(
  character: CharacterRuntime, item: Item | undefined, options: BuyOptions,
): BuyResult {
  if (item === undefined || item.purchasable !== true || item.buyPrice === undefined) {
    return { ok: false, reason: 'not-for-sale' };
  }
  const price = item.buyPrice;
  if (character.gold + character.goldDelta < price) return { ok: false, reason: 'not-enough-gold' };
  const carried: CarriedItem = {
    instanceId: options.instanceId, itemId: item.id, quantity: 1, origin: 'purchase',
  };
  const placed = character.inventory.add(carried, options.catalog, character, options.rules);
  if (!placed.ok) {
    // `not-carried` é catálogo sem o item: o pedido nunca chegaria aqui com `item` definido, mas a
    // resposta honesta é "isto não está à venda" — nunca uma recusa de inventário que o jogador não leu.
    if (placed.reason === 'over-capacity' || placed.reason === 'stack-too-large') {
      return { ok: false, reason: placed.reason };
    }
    return { ok: false, reason: 'not-for-sale' };
  }
  character.goldDelta -= price;
  return { ok: true, instanceId: options.instanceId, price };
}
