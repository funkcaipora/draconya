// O sorteio de um valor de combate que não é de arma (#681).

import type { Combat } from '@draconya/content';
import type { Rng } from '../rng.js';
import { isV3OrLater } from './profile.js';
import { normalRandomInt } from './weapon-power.js';

/**
 * O sorteio de um VALOR de combate que não é de arma — magia, runa, poção, ability e cura de
 * monstro (#681). O Canary usa `normal_random` em todos (`combat.cpp:189`/`:2046`,
 * `global_functions.cpp:372`/`:455`); só o `combat-v3` segue isso. `combat-v1`/`v2` e o chamador
 * sem contexto de combate continuam na rolagem UNIFORME de sempre — um `rng.integer`, bit a bit
 * (ADR 0031). A normal consome SEMPRE, mesmo com `min === max` (a regra de `normalRandomInt`).
 *
 * Dano de condição e velocidade NÃO passam por aqui: o Canary os sorteia por `uniform_random`
 * (`condition.cpp:1908`, `:2547`).
 */
export function rollCombatValue(
  rng: Rng, min: number, max: number, combat: Pick<Combat, 'compatibilityProfile'> | undefined,
): number {
  if (isV3OrLater(combat?.compatibilityProfile)) return normalRandomInt(rng, min, max);
  return rng.integer(min, max);
}
