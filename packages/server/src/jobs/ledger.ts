// Extrato → linha de ledger, e progressão de volta para o personagem (FUN-29, FUN-54).
//
// Creditar é ESCRITA ECONÔMICA, e o invariante 10 diz como: linha append-only com
// `UNIQUE (session_id, seq)`. É essa chave que faz retry nunca duplicar — e retry aqui não é
// hipótese, é o desenho: o `game` grava o extrato no Redis, este código insere, e só depois
// apaga. Morrer entre inserir e apagar custa uma tentativa repetida, e a tentativa repetida é
// operação nula.

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Skills, levelForXp } from '@draconya/sim';
import type { SkillsState } from '@draconya/sim';
import type { Progression } from '@draconya/content';
import type { Database } from '../db/client.js';
import { characters, itemInstances, ledger } from '../db/schema.js';
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
  return writeReceipts(await options.receipts.pending(), options);
}

/**
 * Liquida agora o que este personagem tem pendente, em vez de esperar a varredura (FUN-56).
 *
 * O problema: entre a sessão encerrar e o `jobs` varrer passam até dez segundos, e quem
 * reconecta dentro dessa janela lê `level` e `xp` da tabela — ainda sem o delta da sessão
 * que acabou. O personagem aparece com o progresso de antes, e como `statsForLevel` deriva
 * HP e mana do level, ele também ENCOLHE. É indistinguível de perda de dados, some sozinho
 * em dez segundos, e ninguém consegue reproduzir de propósito.
 *
 * Isto é o MESMO caminho da varredura, não um paralelo: mesma linha de ledger, mesma chave
 * única, mesma transação. É o que torna o encontro dos dois inofensivo — o `jobs` e esta
 * chamada podem processar o mesmo extrato ao mesmo tempo, e o segundo a chegar bate na
 * `UNIQUE (session_id, seq)`, não aplica nada e apaga um extrato já creditado.
 *
 * Somar o delta pendente por cima do que veio do banco, em vez de liquidar, seria mais
 * barato e estaria errado: entre ler a linha e ler o Redis cabe uma varredura inteira, e o
 * mesmo delta entraria duas vezes na conta que o jogador vê.
 */
export async function settleCharacterProgress(
  characterId: string,
  options: LedgerSweepOptions,
): Promise<LedgerSweepResult> {
  return writeReceipts(await options.receipts.pendingFor(characterId), options);
}

async function writeReceipts(
  pending: readonly SessionReceipt[],
  options: LedgerSweepOptions,
): Promise<LedgerSweepResult> {
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

      await options.receipts.remove(receipt.sessionId, receipt.characterId);
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
 * de morte como número negativo (FUN-37). Estado final não serviria: não é idempotente, e dois
 * extratos do mesmo personagem processados fora de ordem se sobrescreveriam.
 */
async function applyProgression(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  receipt: SessionReceipt,
  progression: Progression | undefined,
): Promise<void> {
  // Lê com trava de linha e decide aqui, em vez de montar `case when` no `UPDATE`.
  //
  // A primeira versão fazia a guarda de stamina em SQL e estava errada de um jeito que só o
  // teste com Postgres de verdade pegou. A trava já é necessária de qualquer forma — o
  // `jobs` é singleton, mas nada impede dois ciclos se cruzarem num deploy —, e com a linha
  // em mãos a regra vira três linhas de TypeScript que qualquer um confere lendo.
  const [current] = await tx
    .select({
      xp: characters.xp,
      gold: characters.gold,
      skills: characters.skills,
      staminaUpdatedAt: characters.staminaUpdatedAt,
    })
    .from(characters)
    .where(eq(characters.id, receipt.characterId))
    .for('update');
  if (current === undefined) return;

  // Piso de zero: a penalidade de morte chega como número negativo (FUN-37), e XP negativa é
  // um estado impossível que dá erro estranho em todo lugar que a lê depois.
  const xp = Math.max(0, current.xp + receipt.aggregates.xpGained);
  const gold = Math.max(0, current.gold + creditOf(receipt));

  // Stamina é valor absoluto, não soma — e por isso vem com guarda de instante: um extrato
  // atrasado, processado fora de ordem, não pode devolver stamina já gasta.
  const stamina = receipt.staminaMs !== undefined
    && receipt.staminaUpdatedAtMs !== undefined
    && receipt.staminaUpdatedAtMs >= current.staminaUpdatedAt.getTime()
    ? { staminaMs: receipt.staminaMs, staminaUpdatedAt: new Date(receipt.staminaUpdatedAtMs) }
    : {};

  // Skill nunca desce, então fundir pelo MAIOR de cada uma é a regra, não uma escolha
  // conservadora: um extrato antigo processado fora de ordem não tem como rebaixar o que já
  // subiu. É a preocupação da guarda de instante da stamina, resolvida sem instante nenhum.
  const skills = receipt.skills === undefined
    ? {}
    : { skills: Skills.merge(current.skills as SkillsState | undefined, receipt.skills) };

  // O layout de equipamento (FUN-82). Escopado por dono dentro do próprio `applyEquipment`:
  // um extrato não move item de outra pessoa nem que traga o id dela.
  if (receipt.equipment !== undefined) {
    await applyEquipment(tx, receipt.characterId, receipt.equipment);
  }

  await tx
    .update(characters)
    .set({
      xp,
      gold,
      ...skills,
      // O level é DERIVADO da XP nova, nunca copiado do extrato: copiar faria um extrato
      // antigo, processado fora de ordem, rebaixar um personagem que já subiu.
      ...(progression === undefined ? {} : { level: levelForXp(xp, progression) }),
      ...stamina,
    })
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

/**
 * Põe cada instância no slot que o extrato diz, e tira as que saíram (FUN-82).
 *
 * **Desequipa primeiro**, e a ordem é a razão de isto ser dois passos: o índice único do banco
 * recusa duas peças no mesmo slot, e trocar A por B esbarraria nele se B entrasse antes de A
 * sair.
 *
 * Escopado por dono: um extrato com o id de um item alheio não move nada, porque a consulta que
 * decide o que existe é a das instâncias DESTE personagem.
 */
async function applyEquipment(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  characterId: string,
  equipment: Readonly<Record<string, string>>,
): Promise<void> {
  const wanted = new Map(Object.entries(equipment).map(([slot, id]) => [id, slot]));
  const owned = await tx
    .select({ id: itemInstances.id, equippedSlot: itemInstances.equippedSlot })
    .from(itemInstances)
    .where(eq(itemInstances.ownerCharacterId, characterId));

  for (const row of owned) {
    if (row.equippedSlot === null || wanted.get(row.id) === row.equippedSlot) continue;
    await tx.update(itemInstances).set({ equippedSlot: null }).where(eq(itemInstances.id, row.id));
  }
  for (const row of owned) {
    const slot = wanted.get(row.id);
    if (slot === undefined || slot === row.equippedSlot) continue;
    await tx.update(itemInstances).set({ equippedSlot: slot }).where(eq(itemInstances.id, row.id));
  }
}
