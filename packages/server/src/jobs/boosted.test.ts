// A tarefa diária do `jobs` (#615): SÓ decide quando rodar e com quais candidatos — o sorteio
// de fato, e a idempotência dele, são de `WorldDailyStore` (ver `world-daily.postgres.test.ts`).
// Aqui, um `WorldDailyStore` de mentira que só grava o que recebeu.

import { describe, expect, it } from 'vitest';
import { createLogger } from '../log.js';
import { rollBoostedCreature } from './boosted.js';
import type { WorldDailyStore } from '../world-daily.js';

const logger = createLogger('silent', 'test');

function fakeStore(): { store: WorldDailyStore; calls: readonly string[] } {
  const calls: string[] = [];
  const store = {
    async ensureDay(day: string, pick: () => string): Promise<string> {
      calls.push(day);
      return pick();
    },
  } as unknown as WorldDailyStore;
  return { store, calls };
}

describe('rollBoostedCreature (#615)', () => {
  it('sem candidato nenhum, não chama o store — conteúdo sem Bestiário não sorteia nada', async () => {
    const { store, calls } = fakeStore();
    await rollBoostedCreature({
      worldDaily: store, rolloverHourUtc: 0, monsterIds: [], logger,
      now: () => Date.parse('2026-09-28T12:00:00Z'),
    });
    expect(calls).toEqual([]);
  });

  it('chama `ensureDay` com o dia certo, deslocado pela hora de virada', async () => {
    const { store, calls } = fakeStore();
    await rollBoostedCreature({
      worldDaily: store, rolloverHourUtc: 4, monsterIds: ['rat', 'dragon'], logger,
      now: () => Date.parse('2026-09-29T03:00:00Z'),
    });
    // Antes das 4h UTC, ainda é o dia anterior.
    expect(calls).toEqual(['2026-09-28']);
  });

  it('uma falha do store é registrada e não escapa (o ciclo do `jobs` não pode cair por isso)', async () => {
    const store = {
      async ensureDay(): Promise<string> {
        throw new Error('Postgres fora do ar');
      },
    } as unknown as WorldDailyStore;
    await expect(rollBoostedCreature({
      worldDaily: store, rolloverHourUtc: 0, monsterIds: ['rat'], logger,
      now: () => 0,
    })).resolves.toBeUndefined();
  });
});
