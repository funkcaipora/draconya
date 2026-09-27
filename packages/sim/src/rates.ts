// Os rates do servidor (#691, M44-G15): XP, skill, magia, loot e monstro/boss, lidos de
// `progression.rates` no conteúdo versionado (invariante 7). Só aritmética: quem os aplica são
// os pontos de ganho que já existem (abate, prática, sorteio de loot, golpe de monstro).
//
// O default é neutro, e cada aplicação curto-circuita em 1: nenhum arredondamento novo entra no
// caminho de quem não declara rate nenhum (DT-04).

import type { CreatureRates, Rates, RateStage } from '@draconya/content';

/** O id da skill que usa `magic`/`magicLevelStages` em vez de `skill`/`skillStages`. */
export const MAGIC_SKILL_ID = 'magic';

/**
 * `getRateFromTable` do Canary (`functions.lua:126-135`): a primeira faixa que contém `level`
 * vence (sem `maxLevel` é infinito); sem faixa, `fallback`.
 */
export function rateFromStages(
  stages: readonly RateStage[], level: number, fallback: number,
): number {
  for (const stage of stages) {
    if (level >= stage.minLevel && (stage.maxLevel === undefined || level <= stage.maxLevel)) {
      return stage.multiplier;
    }
  }
  return fallback;
}

/** O `baseRate` de XP do Canary (`player.lua:333-346`): o stage pelo level, ou `experience`. */
export function experienceRateFor(rates: Rates, level: number): number {
  return rates.useStages
    ? rateFromStages(rates.experienceStages, level, rates.experience)
    : rates.experience;
}

/**
 * O rate de tentativas de uma skill (`player.lua:617-640` do Canary). `skillId === 'magic'` usa
 * `magic`/`magicLevelStages`; o resto, `skill`/`skillStages`. `baseLevel` é o nível BASE — o
 * Canary acha o stage do ML por `getBaseMagicLevel()`, sem o bônus de item.
 */
export function skillRateFor(rates: Rates, skillId: string, baseLevel: number): number {
  const magic = skillId === MAGIC_SKILL_ID;
  const fallback = magic ? rates.magic : rates.skill;
  if (!rates.useStages) return fallback;
  return rateFromStages(magic ? rates.magicLevelStages : rates.skillStages, baseLevel, fallback);
}

/** Rate 1 devolve o valor intacto: nenhum arredondamento novo no caminho neutro. */
export function applyRate(value: number, rate: number): number {
  return rate === 1 ? value : Math.floor(value * rate);
}

/** Os multiplicadores que valem para este monstro: `boss` ou `monster` (`monsters.cpp:332`). */
export function creatureRatesFor(rates: Rates, boss: boolean): CreatureRates {
  return boss ? rates.boss : rates.monster;
}

/**
 * O ataque do monstro escalado (`combat.cpp:2778-2779`, `damage.value *= mult`): multiplica o
 * dano SORTEADO, truncado, e não a faixa — o sorteio é o mesmo, e a sequência do `Rng` não muda.
 */
export function applyAttackRate(rawDamage: number, multiplier: number): number {
  return multiplier === 1 ? rawDamage : Math.trunc(rawDamage * multiplier);
}
