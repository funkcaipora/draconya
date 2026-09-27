// A forma compartilhada de um item de EXTRATO (`SessionReceipt.acquired`).
//
// Até o ADR 0048, este arquivo também hospedava a Caixa de Loot da Sessão (`LootBoxStore`,
// `lootbox:{sessionId}` no Redis, TTL de 30 min) — o transbordo por capacidade do loot de
// monstro. O ADR a retirou (decisão 7): o caso que ela cobria — loot que não coube — passa a
// ser "fica no cadáver" (`packages/sim`), como o Canary faz. A #723 fechou o resto: o campo
// `lootBox` do extrato (escrito por `chooseVocation`/`#grantKitPiece`/`#settle` para os dois
// casos sem cadáver de monstro à mão) nunca era lido de volta — `jobs/ledger.ts` só processa
// `acquired` — então virou `Inventory.forceAdd` (`packages/sim/src/inventory.ts`, peso
// ignorado) em vez de outro depósito morto. `BoxedItem` segue aqui só para
// `acquiredBy`/`acquiredByState` (`game/host.ts`, `snapshot-settlement.ts`).

/** Um item no extrato. Mesma forma do `CarriedItem` do `sim`, sem depender dele. */
export interface BoxedItem {
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
  /** De onde veio (#154). Ausente é `'loot'`. */
  readonly origin?: string;
}
