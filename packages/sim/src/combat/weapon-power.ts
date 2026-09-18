// O poder de uma arma, resolvido por PERFIL (CMB-05, #333).
//
// A fórmula é do CONTEÚDO: a família declara `levelFactor` e `spread`, a skill apontada dá a
// contribuição por nível e a arma (ou a munição) dá o `base`. Aqui só há aritmética — sem I/O,
// sem catálogo, sem `if` por nome de item ou vocação. O RNG é o da sessão.
//
// Duas formas, e a distinção é contrato:
//
//   - `power` (corpo a corpo e distância): escala por level e skill. `spread: 0` devolve o
//     valor SEM consumir sorteio — é o que preserva o v1 bit a bit (DT-03).
//   - `fixedDamage` (wand/rod): faixa fixa, UMA rolagem por golpe, como o loot.
//
// Wand/rod NÃO passam por multiplicador de weapon skill: o perfil deles não tem `power`, e é
// por construção, não por um `if` — o contrato de wand/rod é distinto do de spellPower (DT-02).

import type { WeaponProfile } from '@draconya/content';
import type { Rng } from '../rng.js';

/**
 * O poder bruto de um golpe de arma, antes da mitigação.
 *
 * `skillLevel` é o nível ABSOLUTO da skill da família; a contribuição conta a partir do
 * `skillStartingLevel` compilado, que é o `startingLevel` da skill. `level` entra pelo
 * `levelFactor` da família — zero em todo o conteúdo inicial, e por isso não muda o v1.
 *
 * Função PURA a menos do RNG da sessão. Devolve valor NÃO arredondado no caminho `power`
 * (quem aplica a postura e arredonda é o ruleset, uma vez só); no caminho `fixedDamage`
 * devolve o inteiro sorteado.
 */
export function resolveWeaponPower(
  profile: WeaponProfile,
  level: number,
  skillLevel: number,
  rng: Rng,
): number {
  if (profile.fixedDamage !== undefined) {
    return rng.integer(profile.fixedDamage.min, profile.fixedDamage.max);
  }
  const formula = profile.power;
  // Perfil sem fórmula nem faixa é uma arma sem dano — conteúdo que o boot já recusou, e zero
  // é a resposta honesta em vez de um número inventado.
  if (formula === undefined) return 0;

  const steps = Math.max(0, skillLevel - formula.skillStartingLevel);
  const mid = formula.base * (1 + level * formula.levelFactor + steps * formula.skillFactor);
  // Spread zero NÃO consome sorteio: é o que mantém a sequência de RNG da hunt idêntica à do
  // v1 em corpo a corpo e distância.
  if (formula.spread <= 0) return mid;

  const min = Math.floor(mid * (1 - formula.spread));
  const max = Math.ceil(mid * (1 + formula.spread));
  return rng.integer(min, max);
}
