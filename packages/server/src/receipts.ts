// Extratos de sessão à espera de virar linha de ledger (FUN-29).
//
//   receipt:{sessionId}   extrato de uma sessão encerrada    TTL longo
//
// Existe porque creditar é ESCRITA ECONÔMICA e o nó de jogo não fala com o Postgres: o
// caminho quente da simulação não pode ter banco no meio (ver AGENTS.md do pacote). O `game`
// grava o extrato no Redis ao encerrar, e o `jobs` o transforma em linha de ledger.
//
// O par grava-depois-apaga é o que torna isto seguro contra queda: a linha de ledger tem
// `UNIQUE (session_id, seq)` (invariante 10), então reinserir é operação nula. Morrer entre
// inserir e apagar custa uma tentativa repetida, nunca um crédito dobrado.

import type { Redis } from 'ioredis';
import type { Aggregates, EndReason, NotableEvent } from '@draconya/sim';

export interface SessionReceipt {
  readonly sessionId: string;
  readonly characterId: string;
  readonly accountId: string;
  readonly reason: EndReason;
  /** Sequência dentro da sessão. É metade da chave de idempotência do ledger. */
  readonly seq: number;
  readonly aggregates: Aggregates;
  readonly notableEvents: readonly NotableEvent[];
  readonly endedAtMs: number;
  /**
   * Stamina materializada no fim da sessão, e o instante de relógio em que ela valia (§10).
   *
   * Vai como VALOR ABSOLUTO, não como delta, porque stamina não é uma soma: ela cai dentro da
   * hunt e sobe fora dela, e o número que interessa é o de agora. O instante é o que impede
   * um extrato antigo, processado fora de ordem, de sobrescrever um mais novo.
   */
  readonly staminaMs?: number;
  readonly staminaUpdatedAtMs?: number;
}

export interface ReceiptStoreOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

/** Generoso: um extrato perdido é progresso perdido, e ninguém percebe até o extrato faltar. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const key = (sessionId: string): string => `receipt:${sessionId}`;
const RECEIPT_PATTERN = 'receipt:*';

export class ReceiptStore {
  readonly #redis: Redis;
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(redis: Redis, options: ReceiptStoreOptions = {}) {
    this.#redis = redis;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  async save(receipt: Omit<SessionReceipt, 'endedAtMs'>): Promise<void> {
    const stored: SessionReceipt = { ...receipt, endedAtMs: this.#now() };
    await this.#redis.set(key(receipt.sessionId), JSON.stringify(stored), 'PX', this.#ttlMs);
  }

  async pending(limit = 200): Promise<SessionReceipt[]> {
    const receipts: SessionReceipt[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.#redis.scan(
        cursor, 'MATCH', RECEIPT_PATTERN, 'COUNT', 100,
      );
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.#redis.mget(...keys);
      for (const raw of values) {
        if (raw === null) continue;
        const parsed = parseReceipt(raw);
        if (parsed !== null) receipts.push(parsed);
        if (receipts.length >= limit) return receipts;
      }
    } while (cursor !== '0');
    return receipts;
  }

  async remove(sessionId: string): Promise<void> {
    await this.#redis.del(key(sessionId));
  }
}

function parseReceipt(raw: string): SessionReceipt | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (
    typeof value['sessionId'] !== 'string'
    || typeof value['characterId'] !== 'string'
    || typeof value['accountId'] !== 'string'
    || typeof value['reason'] !== 'string'
    || typeof value['seq'] !== 'number'
    || typeof value['aggregates'] !== 'object' || value['aggregates'] === null
  ) {
    return null;
  }
  return {
    sessionId: value['sessionId'],
    characterId: value['characterId'],
    accountId: value['accountId'],
    reason: value['reason'] as EndReason,
    seq: value['seq'],
    aggregates: value['aggregates'] as Aggregates,
    notableEvents: Array.isArray(value['notableEvents'])
      ? (value['notableEvents'] as NotableEvent[])
      : [],
    endedAtMs: typeof value['endedAtMs'] === 'number' ? value['endedAtMs'] : 0,
    // Os dois andam juntos: valor sem instante não dá para ordenar, e instante sem valor não
    // diz nada. Meio par é dado corrompido, e a resposta é ignorar o par inteiro.
    ...(typeof value['staminaMs'] === 'number' && typeof value['staminaUpdatedAtMs'] === 'number'
      ? { staminaMs: value['staminaMs'], staminaUpdatedAtMs: value['staminaUpdatedAtMs'] }
      : {}),
  };
}
