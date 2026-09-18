// Reposição por lote (ADR 0032 decisão 6, #419).
//
// Aritmética PURA, sem sessão, sem conteúdo e sem relógio — como `party.ts`, e pela mesma
// razão: é o ponto em que uma escolha errada (a ordem dos `min`) custa caro, e aqui ela é
// testável por tabela. Quem tem o inventário, o saldo e o preço é quem chama.
//
// A compra nunca deixa o saldo negativo: o limite por gold é calculado ANTES, e não corrigido
// depois. É a mesma ordem que `useSupply` sempre teve.

export interface RestockInput {
  /** Quantidade na pilha agora. */
  readonly current: number;
  /** Limiar de reposição (conteúdo/slot). */
  readonly min: number;
  /** Lote (conteúdo/slot). */
  readonly batch: number;
  /** Preço unitário de compra (conteúdo). */
  readonly price: number;
  /** Peso unitário do item. */
  readonly weight: number;
  /** `capacity - inventory.weight(items)`. */
  readonly freeCapacity: number;
  /** `MAX_STACK - current`. */
  readonly freeStack: number;
  /** `gold + goldDelta`. */
  readonly balance: number;
}

export interface RestockPlan {
  readonly itemId: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly total: number;
}

/**
 * O lote que cabe — ou `null` quando não há o que comprar.
 *
 * Três tetos, e o menor manda: o lote, o que a capacidade aguenta, o que a pilha aceita e o
 * que o saldo paga. `price: 0` é recusado de propósito: lote grátis acidental é o formato de
 * defeito que ninguém liga à causa (a flecha grátis é da AB-05, não daqui).
 */
export function planRestock(itemId: string, input: RestockInput): RestockPlan | null {
  if (input.balance <= 0 || input.price <= 0) return null;
  if (input.current >= input.min) return null;
  const byCapacity = input.weight > 0 ? Math.floor(input.freeCapacity / input.weight) : input.batch;
  const byStack = Math.max(0, input.freeStack);
  const byGold = Math.floor(input.balance / input.price);
  const quantity = Math.min(input.batch, byCapacity, byStack, byGold);
  if (quantity <= 0) return null;
  return { itemId, quantity, unitPrice: input.price, total: quantity * input.price };
}
