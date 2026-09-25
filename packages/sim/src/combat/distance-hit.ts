// Chance de acerto à distância (#522, ADR 0037 d.5, `combat-v2`).
//
// Só a DISTÂNCIA rola acerto ofensivo — corpo a corpo continua sem rolagem
// (`player-always-hit-melee`, `combat/weapon-power.ts`). O mecanismo é ORIGINAL do Draconya
// (ADR 0019): reproduz o COMPORTAMENTO de `WeaponDistance::useWeapon` do Canary para o balde de
// munição "de duas mãos" (arco/besta — a única família de distância que o catálogo tem hoje),
// nunca o código.
//
// A tabela por `distance` é CONTEÚDO (`combat.distanceHitChance`), não constante mágica: cada
// tile de 1 a 7 tem um teto de skill, um fator e um termo fixo — os mesmos números do Canary,
// transcritos como DADO (§12.1), nunca como `switch` no motor.
//
// Dois campos "só dado" desde o #524 entram em jogo aqui pela primeira vez:
//
//   - `ammunition.maxHitChance` (o `it.maxHitChance` do Canary): ausente, usa o balde default
//     da tabela; um valor DIFERENTE (o power bolt declara 91) vira chance FIXA — o balde que a
//     tabela não modela cai no `else { chance = maxHitChance }` do Canary.
//   - `weapon.hitChance` (o bônus/malus da ARMA, ex.: royal crossbow `+3`): soma ao que a
//     munição calculou — tabela ou flat —, sempre, e independe de qual dos dois caminhos rendeu.

import type { Combat } from '@draconya/content';
import type { Rng } from '../rng.js';

/**
 * A chance de acerto, em PERCENTUAL inteiro `[0,100]`, para um tiro a `distance` tiles com
 * `skillLevel` de distância — ANTES do bônus/malus da arma (`weapon.hitChance`).
 *
 * `ammoMaxHitChance` é o `ammunition.maxHitChance` do conteúdo (#524): ausente, ou igual ao
 * balde default da tabela (`table.maxHitChance`), usa a tabela por skill/tile; qualquer OUTRO
 * valor é a chance fixa da munição especial, sem tabela.
 */
export function distanceHitChancePercent(
  distance: number, skillLevel: number, table: NonNullable<Combat['distanceHitChance']>,
  ammoMaxHitChance?: number,
): number {
  const bucket = ammoMaxHitChance ?? table.maxHitChance;
  if (bucket !== table.maxHitChance) return bucket;

  const tier = table.tiers.find((candidate) => candidate.distance === distance);
  if (tier === undefined) return table.maxHitChance;
  const cappedSkill = Math.min(skillLevel, tier.skillCap);
  const percent = Math.trunc(cappedSkill * tier.perSkill) + tier.flat;
  return Math.min(100, Math.max(0, percent));
}

/**
 * Rola o acerto de UM tiro. `weaponHitChanceBonus` é o `weapon.hitChance` do arco/besta (#524):
 * somado ao percentual da munição (tabela ou flat), sempre — nunca uma substituição.
 *
 * A rolagem acontece SEMPRE — mesmo com chance 0 ou 100 — para a sequência de RNG não depender
 * do VALOR da chance, a mesma regra do `blockChance` e do crítico (ADR 0031). Consome exatamente
 * uma fração do `Rng` da sessão.
 */
export function rollDistanceHit(
  distance: number, skillLevel: number, table: NonNullable<Combat['distanceHitChance']>,
  rng: Rng, ammoMaxHitChance?: number, weaponHitChanceBonus?: number,
): boolean {
  const basePercent = distanceHitChancePercent(distance, skillLevel, table, ammoMaxHitChance);
  const percent = Math.min(100, Math.max(0, basePercent + (weaponHitChanceBonus ?? 0)));
  return rng.chance(percent / 100);
}
