// Primeira tarefa diária real do `jobs` (M42, #615, ADR 0054 decisão 7).
//
// Uma vez por dia (a hora de virada é `content.boosted.rolloverHourUtc`), sorteia um monstro
// com entrada de Bestiário para ser a Boosted Creature — `spawntime / 2`, XP ×2, um roll extra
// de loot (ver `packages/sim/src/rulesets/hunt.ts`). O sorteio em si mora em `world-daily.ts`;
// aqui só se decide QUANDO rodar e COM QUAIS candidatos.

import { randomInt } from 'node:crypto';
import type { Logger } from '../log.js';
import { boostedDayKey, WorldDailyStore } from '../world-daily.js';

export interface BoostedCreatureDependencies {
  readonly worldDaily: WorldDailyStore;
  /** A hora de virada, de `content.boosted.rolloverHourUtc`. */
  readonly rolloverHourUtc: number;
  /**
   * Os candidatos: todo monstro com entrada de Bestiário (`Object.keys(content.bestiary.
   * entries)`), como o Canary faz com o bestiário inteiro — não uma lista separada de
   * conteúdo. Vazio é conteúdo sem Bestiário: o ciclo não sorteia nada.
   */
  readonly monsterIds: readonly string[];
  readonly now?: () => number;
  readonly logger: Logger;
}

/** Um `monsterId` ao acaso da lista — `Math.random` é proibido em `sim`, mas `jobs` não é `sim`. */
function pickRandomMonsterId(monsterIds: readonly string[]): string {
  const index = randomInt(monsterIds.length);
  // Não-vazio é conferido por quem chama; o `as string` só nomeia o que já é garantido.
  return monsterIds[index] as string;
}

/**
 * Chamada A CADA CICLO do `jobs` (`createJobsCycle`, a cada 10 s). Idempotente por construção:
 * `WorldDailyStore.ensureDay` só sorteia quando o dia ainda não tem linha — as chamadas
 * seguintes do mesmo dia leem a mesma de volta e só reescrevem o cache do Redis, sem tocar o
 * Postgres de novo (o `ON CONFLICT DO NOTHING` nem chega a inserir).
 */
export async function rollBoostedCreature(deps: BoostedCreatureDependencies): Promise<void> {
  if (deps.monsterIds.length === 0) return;
  const now = deps.now ?? Date.now;
  const day = boostedDayKey(now(), deps.rolloverHourUtc);
  try {
    const boostedMonsterId = await deps.worldDaily.ensureDay(day, () => pickRandomMonsterId(deps.monsterIds));
    deps.logger.debug({ day, boostedMonsterId }, 'Boosted creature confirmed for the day');
  } catch (error) {
    deps.logger.error({ err: error, day }, 'Could not roll the boosted creature');
  }
}
