// Preço de bênção, só para EXIBIR (#570, ADR 0052). PURO, sem estado.
//
// O cliente não pode importar `sim` (fronteira do pacote), então esta é uma cópia INTENCIONAL
// de `blessingCost`/`hasBlessing` (`packages/sim/src/blessings.ts`) — a mesma fórmula, o mesmo
// bitmask, refeita aqui só para a tela mostrar o preço e o estado "já tem" ANTES de mandar a
// intenção. Quem decide de verdade é o servidor (invariante 4): se as duas divergirem, a tela
// mostra um preço errado por um instante, e a compra é recusada ou aceita pelo número real do
// servidor — nunca o contrário.

import type { BlessingsConfig } from '../state/hud.js';

export function hasBlessing(mask: number, order: number): boolean {
  return (mask & (1 << order)) !== 0;
}

export function blessingCost(
  level: number, enhanced: boolean, pricing: BlessingsConfig['pricing'],
): number {
  if (level < pricing.freeBelowLevel) return 0;
  if (level <= pricing.flatUntilLevel) return pricing.flatPrice;
  if (level < pricing.highFromLevel) {
    const multiplier = enhanced ? pricing.midEnhancedMultiplier : pricing.midMultiplier;
    return multiplier * (level - pricing.midOffset);
  }
  const base = enhanced ? pricing.highEnhancedBase : pricing.highBase;
  const multiplier = enhanced ? pricing.highEnhancedMultiplier : pricing.highMultiplier;
  return base + multiplier * (level - pricing.highFromLevel);
}
