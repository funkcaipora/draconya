// A Boosted Creature do dia (M42, #615, ADR 0054 decisão 7).
//
//   world_daily          Postgres, uma linha por dia            verdade durável
//   world:daily:boosted  Redis, cópia do dia corrente            leitura barata da `api`
//
// O `jobs` é quem escreve os dois — o sorteio é dele (o singleton com lock, invariante 9 não
// se aplica aqui porque isto não é `CharacterRuntime` nenhum: é estado do MUNDO, sem dono
// quente). A `api` só LÊ o Redis ao emitir um ticket: ela nunca fala com o Postgres para isto,
// porque a cópia em Redis é exatamente o que a ADR 0054 pede ("mais uma cópia em Redis para a
// api") e ler os dois bancos para uma leitura que só precisa de uma string seria o dobro do
// custo pela mesma resposta.
//
// Idempotência (#615, "jobs idempotente no mesmo dia"): `day` é a CHAVE PRIMÁRIA de
// `world_daily`, e o sorteio é `INSERT … ON CONFLICT (day) DO NOTHING`. Rodar o ciclo duas
// vezes no mesmo dia — o normal, a cada 10 s — nunca sorteia duas vezes: a segunda tentativa
// bate no conflito, e é a LINHA JÁ GRAVADA (não o candidato descartado) que volta para o
// Redis, a mesma trava que o índice único já dá ao ledger (invariante 10).

import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Database } from './db/client.js';
import { worldDaily } from './db/schema.js';

const REDIS_KEY = 'world:daily:boosted';
/**
 * Dois dias: folga contra o `jobs` cair perto da virada sem reagendar a tempo — melhor o
 * cache expirar e a `api` degradar para "sem boosted" (ausente é sempre um valor válido, nunca
 * ticket recusado) do que nunca expirar e servir uma boosted de uma semana atrás para sempre
 * se o `jobs` parar de vez.
 */
const REDIS_TTL_SECONDS = 2 * 24 * 60 * 60;

interface CachedBoosted {
  readonly day: string;
  readonly boostedMonsterId: string;
}

function parseCached(raw: string | null): CachedBoosted | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' || parsed === null
      || typeof (parsed as Record<string, unknown>)['day'] !== 'string'
      || typeof (parsed as Record<string, unknown>)['boostedMonsterId'] !== 'string'
    ) return undefined;
    return parsed as CachedBoosted;
  } catch {
    return undefined;
  }
}

/**
 * A leitura que a `api` faz ao emitir um ticket (#615): só Redis, só o `monsterId` — quem
 * roda sem Redis (não deveria acontecer: os três papéis exigem Redis) ou antes do primeiro
 * ciclo do `jobs` lê `undefined`, e o ticket sai sem o campo, degradação já prevista (ADR 0054:
 * "ausente é conteúdo sem boosted/baseline.json, ou personagem cujo ticket não o carregava").
 */
export async function readCachedBoostedMonsterId(redis: Redis): Promise<string | undefined> {
  const raw = await redis.get(REDIS_KEY);
  return parseCached(raw)?.boostedMonsterId;
}

/** O dia (UTC, `YYYY-MM-DD`) deslocado pela hora de virada — a chave de `world_daily`. */
export function boostedDayKey(nowMs: number, rolloverHourUtc: number): string {
  const shifted = new Date(nowMs - rolloverHourUtc * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * O que o `jobs` chama a cada ciclo (`scheduler.ts`): sorteia SE faltar o dia de hoje, escreve
 * Postgres e Redis. O candidato é descartado sem custo quando o dia já existe — só o `INSERT`
 * roda; não há leitura antes para "ver se precisa", porque a existência SÓ o `ON CONFLICT`
 * decide sem correr o risco de dois `jobs` (o de antes de perder a liderança e o novo) lerem
 * "não existe" ao mesmo tempo e os dois tentarem escrever — o índice primário já resolve isso.
 */
export class WorldDailyStore {
  readonly #redis: Redis;
  readonly #database: Database;

  constructor(redis: Redis, database: Database) {
    this.#redis = redis;
    this.#database = database;
  }

  /**
   * Garante que `day` tem uma boosted sorteada, e devolve QUAL é — a que já existia, se
   * existia. `pickMonsterId` só é CHAMADA quando o candidato pode ser necessário; com o dia já
   * sorteado o valor descartado nem é gerado.
   */
  async ensureDay(day: string, pickMonsterId: () => string): Promise<string> {
    const candidate = pickMonsterId();
    const inserted = await this.#database
      .insert(worldDaily)
      .values({ day, boostedMonsterId: candidate })
      .onConflictDoNothing({ target: worldDaily.day })
      .returning({ boostedMonsterId: worldDaily.boostedMonsterId });
    const boostedMonsterId = inserted[0]?.boostedMonsterId ?? await this.#readDay(day) ?? candidate;
    await this.#cache(day, boostedMonsterId);
    return boostedMonsterId;
  }

  async #readDay(day: string): Promise<string | undefined> {
    const [row] = await this.#database
      .select({ boostedMonsterId: worldDaily.boostedMonsterId })
      .from(worldDaily)
      .where(eq(worldDaily.day, day));
    return row?.boostedMonsterId;
  }

  async #cache(day: string, boostedMonsterId: string): Promise<void> {
    const payload: CachedBoosted = { day, boostedMonsterId };
    await this.#redis.set(REDIS_KEY, JSON.stringify(payload), 'EX', REDIS_TTL_SECONDS);
  }
}
