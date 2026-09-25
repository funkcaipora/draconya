// Chance de acerto à distância (#522, ADR 0037 d.5, `combat-v2`).
//
// Só a DISTÂNCIA rola acerto ofensivo — corpo a corpo continua sem rolagem
// (`player-always-hit-melee`, `combat/weapon-power.ts`). O mecanismo é ORIGINAL do Draconya
// (ADR 0019): reproduz o COMPORTAMENTO de `WeaponDistance::useWeapon` do Canary — as TRÊS
// tabelas por balde que ele modela (75 uma mão, 90 duas mãos, 100), nunca o código.
//
// Três campos "só dado" entram em jogo aqui pela primeira vez:
//
//   - `ammunition.hitChance` (o `it.hitChance` DIRETO do Canary, #522): declarado e ≠ 0, ignora
//     a tabela inteira — a munição/arma de arremesso avulsa com chance fixa (viper star 80%).
//   - `ammunition.maxHitChance` (o `it.maxHitChance` do Canary, #524): seleciona o BALDE — um
//     valor que a tabela não modela (o power bolt declara 91) vira chance fixa também, mas só
//     quando `ammunition.hitChance` não decidiu antes.
//   - `weapon.hitChance` (o bônus/malus da ARMA, #524, ex.: royal crossbow `+3`): soma ao que a
//     munição calculou — tabela ou flat, por qualquer caminho —, sempre.
//
// Distância fora de `tiers`, dentro de um balde RECONHECIDO, é MISS (0%): o `default: chance =
// it.hitChance;` de cada `switch` do Canary, que vale 0 porque só se chega a essa tabela quando
// `it.hitChance` já é 0 — nunca o teto do balde.

import type { Combat } from '@draconya/content';
import type { Rng } from '../rng.js';

/**
 * A chance de acerto, em PERCENTUAL inteiro `[0,100]`, para um tiro a `distance` tiles com
 * `skillLevel` de distância — ANTES do bônus/malus da arma (`weapon.hitChance`).
 *
 * `ammoHitChance` (o `it.hitChance` direto) tem PRIORIDADE sobre `ammoMaxHitChance` — a mesma
 * ordem do Canary (`WeaponDistance::useWeapon` confere `it.hitChance != 0` antes de entrar na
 * tabela). `ammoMaxHitChance` ausente, ou igual ao `defaultMaxHitChance` da tabela, usa o balde
 * default; um balde sem entrada em `buckets` é chance FIXA; uma distância sem entrada em
 * `tiers`, dentro de um balde reconhecido, é MISS (0), nunca o teto do balde.
 */
export function distanceHitChancePercent(
  distance: number, skillLevel: number, table: NonNullable<Combat['distanceHitChance']>,
  ammoMaxHitChance?: number, ammoHitChance?: number,
): number {
  if (ammoHitChance !== undefined && ammoHitChance !== 0) return ammoHitChance;

  const bucketId = ammoMaxHitChance ?? table.defaultMaxHitChance;
  const bucket = table.buckets.find((candidate) => candidate.maxHitChance === bucketId);
  if (bucket === undefined) return bucketId;

  const tier = bucket.tiers.find((candidate) => candidate.distance === distance);
  if (tier === undefined) return 0;
  const cappedSkill = Math.min(skillLevel, tier.skillCap);
  const percent = Math.trunc(cappedSkill * tier.perSkill) + tier.flat;
  return Math.min(100, Math.max(0, percent));
}

/**
 * Rola o acerto de UM tiro. `weaponHitChanceBonus` é o `weapon.hitChance` do arco/besta (#524):
 * somado ao percentual da munição (tabela, ou qualquer um dos dois caminhos fixos), sempre —
 * nunca uma substituição.
 *
 * A rolagem acontece SEMPRE — mesmo com chance 0 ou 100 — para a sequência de RNG não depender
 * do VALOR da chance, a mesma regra do `blockChance` e do crítico (ADR 0031). Consome exatamente
 * uma fração do `Rng` da sessão.
 */
export function rollDistanceHit(
  distance: number, skillLevel: number, table: NonNullable<Combat['distanceHitChance']>,
  rng: Rng, ammoMaxHitChance?: number, ammoHitChance?: number, weaponHitChanceBonus?: number,
): boolean {
  const basePercent = distanceHitChancePercent(distance, skillLevel, table, ammoMaxHitChance, ammoHitChance);
  const percent = Math.min(100, Math.max(0, basePercent + (weaponHitChanceBonus ?? 0)));
  return rng.chance(percent / 100);
}
