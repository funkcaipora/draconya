// O `seq` de `use-item`/`use-item-on` (#726, ADR 0049 decisão 3) — monotônico por cliente, como
// o de `select-target` (`state/target.ts`). Só precisa ser ÚNICO por clique: o servidor não
// reconcilia por ordem aqui (ao contrário do alvo), e o `use-result` que volta com este número
// é o que deixaria uma tela reconciliar um toast específico ao clique certo, se um dia precisar.

let nextSeq = 1;

/** O próximo `seq`, e avança o contador. Puro — sem socket, sem React (ADR 0007). */
export function nextUseItemSeq(): number {
  return nextSeq++;
}
