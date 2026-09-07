import type { Clock } from '@draconya/sim';

/** Relógio monotônico de produção, disponível apenas na borda do servidor. */
export function systemClock(): Clock {
  return { nowMs: () => performance.now() };
}
