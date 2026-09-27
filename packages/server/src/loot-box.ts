// A forma compartilhada de um item de EXTRATO (`SessionReceipt.acquired`/`lootBox`).
//
// Até o ADR 0048, este arquivo também hospedava a Caixa de Loot da Sessão (`LootBoxStore`,
// `lootbox:{sessionId}` no Redis, TTL de 30 min) — o transbordo por capacidade do loot de
// monstro. O ADR a retirou (decisão 7): o caso que ela cobria — loot que não coube — passa a
// ser "fica no cadáver" (`packages/sim`), como o Canary faz. `BoxedItem` continua aqui porque
// `acquiredBy`/`acquiredByState` (`game/host.ts`, `snapshot-settlement.ts`) e o campo `lootBox`
// do extrato (ainda escrito por `chooseVocation`/`#grantKitPiece`/`#settle` — grants e
// liquidação de bolsa que não têm cadáver de monstro para usar) continuam precisando da forma.

/** Um item no extrato. Mesma forma do `CarriedItem` do `sim`, sem depender dele. */
export interface BoxedItem {
  readonly instanceId: string;
  readonly itemId: string;
  readonly quantity: number;
  /** De onde veio (#154). Ausente é `'loot'`. */
  readonly origin?: string;
}
