// A parte PURA de `world-daily.ts` (#615): a chave do dia e a leitura do cache. Sem Redis nem
// Postgres — o resto (`WorldDailyStore.ensureDay`, o sorteio idempotente de verdade) está em
// `world-daily.postgres.test.ts`.

import { describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { boostedDayKey, readCachedBoostedMonsterId } from './world-daily.js';

describe('boostedDayKey (#615)', () => {
  it('é o dia UTC quando a virada é meia-noite', () => {
    // 2026-09-28T23:59:59Z ainda é dia 28 sem deslocamento nenhum.
    expect(boostedDayKey(Date.parse('2026-09-28T23:59:59Z'), 0)).toBe('2026-09-28');
    expect(boostedDayKey(Date.parse('2026-09-29T00:00:00Z'), 0)).toBe('2026-09-29');
  });

  it('desloca pela hora de virada — 23:59 UTC com virada às 4h ainda é o dia anterior', () => {
    // A hora de virada é quando o `jobs` troca a boosted; ANTES dela, ainda é o dia de ontem —
    // exatamente como a stamina/o rollover de servidor do Tibia (4h da manhã, server-save).
    expect(boostedDayKey(Date.parse('2026-09-29T03:59:59Z'), 4)).toBe('2026-09-28');
    expect(boostedDayKey(Date.parse('2026-09-29T04:00:00Z'), 4)).toBe('2026-09-29');
  });
});

describe('readCachedBoostedMonsterId (#615)', () => {
  it('devolve `undefined` para um valor que não é o formato esperado', async () => {
    // Um `Redis` falso o bastante para `get` — não precisamos de um servidor de verdade para
    // provar que o parser recusa lixo em vez de lançar ou devolver campo torto.
    const fake = { get: async () => 'não é json' } as unknown as Redis;
    expect(await readCachedBoostedMonsterId(fake)).toBeUndefined();
  });

  it('devolve `undefined` quando a chave não existe', async () => {
    const fake = { get: async () => null } as unknown as Redis;
    expect(await readCachedBoostedMonsterId(fake)).toBeUndefined();
  });

  it('devolve o `monsterId` de um cache bem formado', async () => {
    const fake = {
      get: async () => JSON.stringify({ day: '2026-09-28', boostedMonsterId: 'dragon' }),
    } as unknown as Redis;
    expect(await readCachedBoostedMonsterId(fake)).toBe('dragon');
  });
});
