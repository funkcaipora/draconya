// A conversão do Base Power (#436, ADR 0033 — movida de `sim/casting.ts`).
//
// Mora aqui, e não em `sim`, porque o cliente precisa dela para mostrar a faixa "min~max" no
// `ActionConfigModal` sem importar `sim` (fronteira de `packages/client/AGENTS.md`). `content` é
// a dependência que `sim` e `client` já têm em comum, então é a fonte única: `sim` importa esta
// função, o cliente calcula a mesma PRÉVIA a partir do catálogo — a rolagem de verdade continua
// só no servidor (invariante 4).
//
// Há DOIS caminhos, e a escolha é do conteúdo (#474, ADR 0019):
//
//   1. `formula` presente — a fórmula canônica do Canary, com os coeficientes da magia:
//      `min = level × levelFactor + skill × skillMin + baseMin` (idem `max`). O mecanismo é do
//      motor, os coeficientes são do conteúdo;
//   2. `formula` ausente — a conversão provisória do Base Power (ADR 0026 decisão 5), bit a bit
//      como antes. É o que preserva a migração aditiva do ADR 0031: magia sem fórmula não muda.

import type { Combat, SpellFormula } from './schemas.js';

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

/**
 * A faixa de dano de uma magia: a fórmula canônica quando ela existe, senão a conversão
 * provisória do `basePower` (#474).
 *
 * O arredondamento é o do Canary: o callback devolve números fracionários e a engine os trunca
 * em inteiro (`static_cast<int32_t>`) antes de sortear. `floor` nas duas pontas é o mesmo para
 * valor positivo, e o piso de 1 + `max >= min` preservam a garantia que `spellPowerRange` já
 * dava — a magia nunca cura nem bate zero, e a faixa nunca vem invertida.
 *
 * `fallbackPower` é `combat.spellPower` e só é lido no caminho sem fórmula; `basePower` é o
 * número de exibição (ADR 0033) e só vale quando não há fórmula.
 */
export function evaluateSpellPower(
  formula: SpellFormula | undefined,
  basePower: number,
  level: number,
  skillLevel: number,
  fallbackPower: Combat['spellPower'],
): { readonly min: number; readonly max: number } {
  if (formula === undefined) {
    return spellPowerRange(basePower, level, skillLevel, fallbackPower);
  }
  const levelTerm = level * formula.levelFactor;
  const min = Math.max(1, Math.floor(levelTerm + skillLevel * formula.skillMin + formula.baseMin));
  const max = Math.max(min, Math.floor(levelTerm + skillLevel * formula.skillMax + formula.baseMax));
  return { min, max };
}
