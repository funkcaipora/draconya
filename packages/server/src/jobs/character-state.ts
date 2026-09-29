import type { BotConfigStore } from '../bot-config-store.js';
import { settleBotConfig } from './bot-config.js';
import { settleCharacterProgress, type LedgerSweepOptions, type LedgerSweepResult } from './ledger.js';

/** A mesma admissão para ticket solo, party e lista de personagens. Falha recusa dado velho. */
export async function settleCharacterState(
  characterId: string,
  options: LedgerSweepOptions & { readonly botConfigs: BotConfigStore },
): Promise<LedgerSweepResult> {
  const written = await settleBotConfig(characterId, options);
  const progress = await settleCharacterProgress(characterId, options);
  return { written: written + progress.written, failed: progress.failed };
}
