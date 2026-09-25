// Sorteio de loot (FUN-63, §31 da referência) — um estágio do pipeline de morte.
//
// Moeda é CAMPO no personagem (`character.gold`), não item, e a tabela de conteúdo diz isso
// com um lugar próprio para `gold`. Item de verdade precisa de definição, instância, capacidade
// e inventário, e nada disso existe: `items` fica vazio e o `buildContent` recusa qualquer coisa
// nele. A forma do dado já está certa; o que falta é o catálogo.

import type { LootRoll, LootTable } from '@draconya/content';
import type { Rng } from './rng.js';

export interface LootItem {
  readonly itemId: string;
  readonly quantity: number;
}

/**
 * Um supply sorteado (#520): poção é suprimento ABSTRATO (AB-01), e não passa pela mochila —
 * `quantity` credita direto o estoque de quem recebe (`CharacterRuntime.supplyStock`), sem
 * peso, sem instância. Ver `lootTableSchema` em `@draconya/content`.
 */
export interface LootSupply {
  readonly supplyId: string;
  readonly quantity: number;
}

export interface LootResult {
  readonly gold: number;
  readonly items: readonly LootItem[];
  readonly supplies: readonly LootSupply[];
}

const NO_ITEMS: readonly LootItem[] = [];
const NO_SUPPLIES: readonly LootSupply[] = [];

/**
 * Sorteia a tabela com o `Rng` da SESSÃO, nunca `Math.random`: sem isso, uma sessão retomada
 * continua com outra sequência de loot, e nenhuma investigação de "por que não caiu" fica
 * possível.
 *
 * A ORDEM dos sorteios é contrato: mudar a ordem muda o resultado de toda semente já gravada,
 * e uma hunt retomada passaria a render diferente do que renderia. Gold primeiro, itens e
 * supplies na ordem da tabela — cada linha consome UMA rolagem, declare ela `itemId` ou
 * `supplyId`; separar os dois resultados em listas diferentes DEPOIS de sortear não muda a
 * sequência nenhuma (FUN-63).
 */
export function rollLoot(table: LootTable, rng: Rng): LootResult {
  const gold = table.gold === undefined ? 0 : rollLine(table.gold, rng);
  let items: LootItem[] | null = null;
  let supplies: LootSupply[] | null = null;
  for (const line of table.items) {
    const quantity = rollLine(line, rng);
    if (quantity === 0) continue;
    if (line.itemId !== undefined) {
      (items ??= []).push({ itemId: line.itemId, quantity });
    } else if (line.supplyId !== undefined) {
      (supplies ??= []).push({ supplyId: line.supplyId, quantity });
    }
  }
  return { gold, items: items ?? NO_ITEMS, supplies: supplies ?? NO_SUPPLIES };
}

/**
 * Uma linha: cai ou não, e quanto.
 *
 * `chance: 0` NÃO consome sorteio (DT-05): uma linha desabilitada não pode deslocar a
 * sequência das outras — semente é contrato. `min === max` também não consome o sorteio de
 * intervalo, pela mesma razão: quantidade fixa não tem o que sortear.
 */
function rollLine(line: LootRoll, rng: Rng): number {
  if (line.chance <= 0) return 0;
  if (!rng.chance(line.chance)) return 0;
  return line.min === line.max ? line.min : rng.integer(line.min, line.max);
}
