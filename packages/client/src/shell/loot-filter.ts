// Filtro de exibição do bloco Loot do `AutomationsPanel` (#764, ADR 0048 d.2/d.4).
//
// O defeito do QA: o bloco listava TODOS os itens do catálogo (≈1858 depois da #748) como uma
// `<ul>` só, sem busca — uma tela ilegível e um DOM gigante montado sempre, mesmo com o painel
// fechado na Cidade. Esta função é a decisão PURA de "o que aparece": os itens já marcados
// (`itemIds` ou `autoSell`) vêm sempre primeiro, e o resto do catálogo só entra quando a busca
// tem texto — nunca as ~1858 linhas de uma vez. `AutomationsPanel.tsx` é a única casca que
// chama isto e desenha o resultado.

import type { ItemDefinition } from '../state/hud.js';

/** O recorte do rascunho de loot que a decisão de exibição precisa — nunca o `BotConfigV2`
 *  inteiro, para este módulo não depender de `@draconya/content`. */
export interface LootSelection {
  readonly itemIds: readonly string[];
  readonly autoSell: readonly string[];
}

export interface LootDisplay {
  /** Marcados primeiro (ordem do catálogo), depois os resultados da busca (também na ordem do
   *  catálogo) — nunca os dois misturados, para o topo não pular de lugar a cada tecla. */
  readonly rows: readonly ItemDefinition[];
  /** Quantos itens do catálogo (fora os já marcados) casam com a busca — antes do corte por
   *  `limit`. Usado para o aviso "refine a busca". */
  readonly matchCount: number;
  /** Quantos resultados da busca (fora os marcados) entraram em `rows`, depois do corte —
   *  `rows.length - marked.length`, mas exposto para a tela não recalcular. */
  readonly shownMatches: number;
  /** `true` quando a busca tem mais resultados do que `limit` permite mostrar. */
  readonly truncated: boolean;
}

export const LOOT_SEARCH_RESULT_LIMIT = 50;

function isMarked(item: ItemDefinition, selection: LootSelection): boolean {
  return selection.itemIds.includes(item.id) || selection.autoSell.includes(item.id);
}

/**
 * Decide quais linhas o bloco Loot desenha.
 *
 * Sem busca (`query` vazia), só os itens já marcados aparecem — nunca o catálogo inteiro; é
 * exatamente o caso que tornava a tela ilegível. Com busca, os marcados continuam no topo (sem
 * duplicar, mesmo que o nome também case com a busca) e os resultados da busca — só entre os
 * NÃO marcados — completam a lista até `limit`.
 */
export function visibleLootItems(
  items: readonly ItemDefinition[],
  selection: LootSelection,
  query: string,
  limit: number = LOOT_SEARCH_RESULT_LIMIT,
): LootDisplay {
  const marked = items.filter((item) => isMarked(item, selection));
  const needle = query.trim().toLowerCase();
  if (needle === '') return { rows: marked, matchCount: 0, shownMatches: 0, truncated: false };

  const matches = items.filter((item) => !isMarked(item, selection) && item.name.toLowerCase().includes(needle));
  const remaining = Math.max(0, limit - marked.length);
  const limited = matches.slice(0, remaining);
  return {
    rows: [...marked, ...limited],
    matchCount: matches.length,
    shownMatches: limited.length,
    truncated: matches.length > limited.length,
  };
}
