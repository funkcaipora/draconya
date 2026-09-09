// Extrato → linha de ledger, e progressão de volta para o personagem (FUN-29, FUN-54).
//
// Creditar é ESCRITA ECONÔMICA, e o invariante 10 diz como: linha append-only com
// `UNIQUE (session_id, seq)`. É essa chave que faz retry nunca duplicar — e retry aqui não é
// hipótese, é o desenho: o `game` grava o extrato no Redis, este código insere, e só depois
// apaga. Morrer entre inserir e apagar custa uma tentativa repetida, e a tentativa repetida é
// operação nula.

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { levelForXp } from '@draconya/sim';
import type { Progression } from '@draconya/content';
import type { Database } from '../db/client.js';
import { characters, ledger } from '../db/schema.js';
import type { Logger } from '../log.js';
import type { ReceiptStore, SessionReceipt } from '../receipts.js';

export interface LedgerSweepOptions {
  readonly database: Database;
  readonly receipts: ReceiptStore;
  readonly logger: Logger;
  /**
   * A curva de XP, para derivar o level novo (FUN-54). Ausente: o ledger é escrito e a linha
   * do personagem não — que é o comportamento de antes desta issue, e serve para um `jobs`
   * montado sem conteúdo em teste.
   */
  readonly progression?: Progression;
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
      // Uma transação: ou a linha de ledger e a progressão entram juntas, ou nenhuma das
      // duas. Separadas, uma queda no meio deixaria o gold creditado no ledger sem estar na
      // linha do personagem — e a reconciliação entre os dois é justamente o que o
      // invariante 10 existe para não precisar.
      await options.database.transaction(async (tx) => {
        const inserted = await tx
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
          .onConflictDoNothing({ target: [ledger.sessionId, ledger.seq] })
          .returning({ id: ledger.id });

        // Vazio = a linha já existia, este extrato já foi creditado. Aplicar a progressão
        // agora seria creditar duas vezes um delta que a chave única acabou de recusar.
        if (inserted.length === 0) return;
        await applyProgression(tx, receipt, options.progression);
      });

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

/**
 * Escreve a progressão da sessão na linha do personagem (FUN-54).
 *
 * XP e gold entram como DELTA, e o `xpGained` do extrato já é o líquido — inclui a penalidade
 * de morte como número negativo (FUN-37). O level é DERIVADO da XP nova, nunca copiado do
 * extrato: copiar faria um extrato antigo processado fora de ordem rebaixar um personagem que
 * já subiu, enquanto derivar sempre bate com a XP que está na linha.
 *
 * O piso de zero na XP é do banco, não confiança no chamador: XP negativa é um estado
 * impossível que dá erro estranho em todo lugar que a lê depois.
 */
async function applyProgression(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  receipt: SessionReceipt,
  progression: Progression | undefined,
): Promise<void> {
  const [row] = await tx
    .update(characters)
    .set({
      xp: sql`greatest(${characters.xp} + ${receipt.aggregates.xpGained}, 0)`,
      gold: sql`greatest(${characters.gold} + ${creditOf(receipt)}, 0)`,
      // Stamina é valor absoluto, não soma — e por isso vem com guarda de instante: um
      // extrato antigo, processado fora de ordem, não pode devolver stamina já gasta.
      ...(receipt.staminaMs === undefined || receipt.staminaUpdatedAtMs === undefined
        ? {}
        : {
          staminaMs: sql`case when ${characters.staminaUpdatedAt} <= ${new Date(receipt.staminaUpdatedAtMs)} then ${receipt.staminaMs} else ${characters.staminaMs} end`,
          staminaUpdatedAt: sql`greatest(${characters.staminaUpdatedAt}, ${new Date(receipt.staminaUpdatedAtMs)})`,
        }),
    })
    .where(eq(characters.id, receipt.characterId))
    .returning({ xp: characters.xp });

  if (row === undefined || progression === undefined) return;
  await tx
    .update(characters)
    .set({ level: levelForXp(row.xp, progression) })
    .where(eq(characters.id, receipt.characterId));
}

/** Só para teste: conta linhas de uma sessão, para provar que o retry não duplica. */
export async function countLedgerRows(database: Database, sessionId: string): Promise<number> {
  const rows = await database.execute(
    sql`select count(*)::int as total from ${ledger} where ${ledger.sessionId} = ${sessionId}`,
  );
  const first = (rows as unknown as Array<{ total: number }>)[0];
  return first?.total ?? 0;
}
