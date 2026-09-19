// A conversão do Base Power (#436, ADR 0033 — movida de `sim/casting.ts`).
//
// Mora aqui, e não em `sim`, porque o cliente precisa dela para mostrar a faixa "min~max" no
// `ActionConfigModal` sem importar `sim` (fronteira de `packages/client/AGENTS.md`). `content` é
// a dependência que `sim` e `client` já têm em comum, então é a fonte única: `sim` importa esta
// função, o cliente calcula a mesma PRÉVIA a partir do catálogo — a rolagem de verdade continua
// só no servidor (invariante 4).

import type { Combat } from './schemas.js';

/**
 * A conversão do Base Power (ADR 0026 decisão 5): inteira nas duas pontas, `min <= max`
 * sempre, nunca abaixo de 1. Os coeficientes são conteúdo (`combat.spellPower`).
 */
export function spellPowerRange(
  basePower: number, level: number, skillLevel: number, spellPower: Combat['spellPower'],
): { readonly min: number; readonly max: number } {
  const mid = basePower * (1 + level * spellPower.levelFactor + skillLevel * spellPower.skillFactor);
  return {
    min: Math.max(1, Math.floor(mid * (1 - spellPower.spread))),
    max: Math.max(1, Math.ceil(mid * (1 + spellPower.spread))),
  };
}
