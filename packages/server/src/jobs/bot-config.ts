import { eq } from 'drizzle-orm';
import type { BotConfigStore } from '../bot-config-store.js';
import type { Database } from '../db/client.js';
import { characters } from '../db/schema.js';
import type { Logger } from '../log.js';

export interface BotConfigPersistenceOptions {
  readonly database: Database;
  readonly botConfigs: BotConfigStore;
  readonly logger: Logger;
}

/** Compartilhado pelo jobs e pela admissão: nunca devolver ticket com preferência pendente. */
export async function settleBotConfig(
  characterId: string, options: BotConfigPersistenceOptions,
): Promise<number> {
  // Sem pendência não há transação: a admissão chama isto em toda listagem e em todo ticket,
  // e no caso comum a resposta é um `HEXISTS` — nenhuma trava de linha, nenhuma ida ao
  // Postgres. É a mesma economia que `settleCharacterProgress` faz com `pendingFor`. Uma
  // edição que chegue entre esta leitura e a trava fica para o próximo ciclo ou admissão —
  // exatamente como ficaria se tivesse chegado um instante depois desta chamada.
  if (!(await options.botConfigs.hasPending(characterId))) return 0;
  const result = await options.database.transaction(async (tx) => {
    // Ler a pendência DEPOIS da trava serializa api/jobs sem relógio nem versão no schema.
    // Um consumidor atrasado não pode sobrescrever a edição que outro já gravou. A leitura
    // de fora, acima, só decide se vale abrir a transação; a que conta é esta.
    const [character] = await tx.select({ deletedAt: characters.deletedAt })
      .from(characters).where(eq(characters.id, characterId)).for('update');
    const pending = await options.botConfigs.load(characterId);
    if (pending === null) return null;
    const writable = character !== undefined && character.deletedAt === null;
    if (writable) {
      await tx.update(characters).set({ botConfig: pending.config })
        .where(eq(characters.id, characterId));
    }
    return { pending, written: writable ? 1 : 0 };
  });
  if (result === null) return 0;
  // Só depois do commit. Queda aqui repete a substituição inteira, sem efeito econômico.
  await options.botConfigs.acknowledge(characterId, result.pending);
  return result.written;
}

export async function writePendingBotConfigs(
  options: BotConfigPersistenceOptions,
): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;
  for (const characterId of await options.botConfigs.pendingCharacters()) {
    try {
      written += await settleBotConfig(characterId, options);
    } catch (error) {
      failed += 1;
      options.logger.error({ error, characterId }, 'Failed to persist bot configuration');
    }
  }
  return { written, failed };
}
