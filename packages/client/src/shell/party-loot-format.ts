// As contas de apresentação da party v2 (#405, ADR 0033): a reserva proporcional de cada
// membro, o rótulo do bônus/multiplicador de XP e a regra "VENDER implica PEGAR" (D2).
//
// Puro: nenhuma função aqui lê estado, socket ou DOM — só formata o número que já chegou do
// servidor (invariante 4). O tipo `PartyView`/`PartyBagView` entra por `import type`, então o
// módulo não carrega a store do HUD.

import type { PartyBagView, PartyView } from '../state/hud.js';

export interface ReservedCapacity {
  readonly reserved: number;
  readonly available: number;
  /**
   * `null` quando `available` é 0: dividir por zero não é "0 %", é "não dá para calcular". O
   * chamador OMITE o percentual nesse caso, nunca escreve zero.
   */
  readonly percent: number | null;
}

/**
 * A MINHA entrada de `party-bag.reservations` (§11-§13): quanto está reservado, quanto está
 * disponível e o percentual. `null` quando não há entrada para este personagem — é o mesmo
 * "não se aplica" de sempre: nó `game` anterior ao #400, ou a mensagem ainda não chegou.
 */
export function reservedCapacityOf(
  bag: PartyBagView, characterId: string,
): ReservedCapacity | null {
  const mine = bag.reservations?.find((reservation) => reservation.characterId === characterId);
  if (mine === undefined) return null;
  const percent = mine.available > 0
    ? Math.round((mine.reserved / mine.available) * 100)
    : null;
  return { reserved: mine.reserved, available: mine.available, percent };
}

/**
 * Os dois eixos do líder (ADR 0033, D1). `shareCosts`/`splitLoot` são os campos v2; `mode` é o
 * espelho derivado que um nó anterior manda — o helper de fallback é o ÚNICO lugar que o lê, e
 * nunca é escrito à mão aqui.
 */
export function shareCostsOf(view: PartyView): boolean {
  return view.shareCosts ?? view.mode === 'shared';
}

export function splitLootOf(view: PartyView): boolean {
  return view.splitLoot ?? view.mode === 'shared';
}

/**
 * `VENDER` só faz sentido se o item também está em `PEGAR` (D2): vender o que não é coletado é
 * um id inerte. `collect === null` é "coleta tudo", então vale para qualquer item.
 */
export function autoSellEnabledFor(
  itemId: string, collect: readonly string[] | null,
): boolean {
  return collect === null || collect.includes(itemId);
}

/**
 * `+25%` — o bônus sobre a base solo (100 %), nunca o pool cru. O servidor manda o pool
 * (100..200), e é a diferença que o jogador lê como "bônus".
 */
export function xpBonusLabel(xpPercent: number): string {
  return `+${String(xpPercent - 100)}%`;
}

/** `2x` — o mesmo pool como multiplicador (200 → `2x`, 125 → `1,25x`). */
export function xpMultiplierLabel(xpPercent: number): string {
  return `${(xpPercent / 100).toLocaleString('pt-BR')}x`;
}
