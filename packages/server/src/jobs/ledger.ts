// Extrato → linha de ledger (FUN-29).
//
// Creditar é ESCRITA ECONÔMICA, e o invariante 10 diz como: linha append-only com
// `UNIQUE (session_id, seq)`. É essa chave que faz retry nunca duplicar — e retry aqui não é
// hipótese, é o desenho: o `game` grava o extrato no Redis, este código insere, e só depois
// apaga. Morrer entre inserir e apagar custa uma tentativa repetida, e a tentativa repetida é
// operação nula.

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { ledger } from '../db/schema.js';
import type { Logger } from '../log.js';
import type { ReceiptStore, SessionReceipt } from '../receipts.js';

export interface LedgerSweepOptions {
  readonly database: Database;
  readonly receipts: ReceiptStore;
  readonly logger: Logger;
}

export interface LedgerSweepResult {
  readonly written: number;
  readonly failed: number;
}

/** Saldo da sessão. Ganho menos gasto: é o que de fato muda o gold do personagem. */
export function creditOf(receipt: SessionReceipt): number {
  return receipt.aggregates.goldGained - receipt.aggregates.goldSpent;
}

export async function writePendingReceipts(
  options: LedgerSweepOptions,
): Promise<LedgerSweepResult> {
  const pending = await options.receipts.pending();
  let written = 0;
  let failed = 0;

  for (const receipt of pending) {
    try {
      await options.database
        .insert(ledger)
        .values({
          id: randomUUID(),
          characterId: receipt.characterId,
          sessionId: receipt.sessionId,
          seq: receipt.seq,
          type: `session-${receipt.reason}`,
          delta: creditOf(receipt),
          ref: {
            xpGained: receipt.aggregates.xpGained,
            kills: receipt.aggregates.kills,
            deaths: receipt.aggregates.deaths,
            durationMs: receipt.aggregates.durationMs,
            notableEvents: receipt.notableEvents,
          },
        })
        // A chave única é a idempotência. `DO NOTHING` transforma o retry em operação nula
        // em vez de erro, que é o que permite apagar o extrato com segurança logo abaixo.
        .onConflictDoNothing({ target: [ledger.sessionId, ledger.seq] });

      await options.receipts.remove(receipt.sessionId);
      written += 1;
    } catch (error) {
      // O extrato FICA no Redis. Perder o crédito em silêncio é o defeito que este arquivo
      // existe para não ter; tentar de novo no próximo ciclo não custa nada.
      failed += 1;
      options.logger.error(
        { error, sessionId: receipt.sessionId, characterId: receipt.characterId },
        'Failed to write a session receipt to the ledger; keeping it for the next cycle',
      );
    }
  }

  return { written, failed };
}

/** Só para teste: conta linhas de uma sessão, para provar que o retry não duplica. */
export async function countLedgerRows(database: Database, sessionId: string): Promise<number> {
  const rows = await database.execute(
    sql`select count(*)::int as total from ${ledger} where ${ledger.sessionId} = ${sessionId}`,
  );
  const first = (rows as unknown as Array<{ total: number }>)[0];
  return first?.total ?? 0;
}
