// Processo `jobs` — singleton com lock. Agendador, expirações e reconciliação.
//
// ESQUELETO. O laço existe; as tarefas entram depois: Guild War diária, expiração da
// Caixa de Loot, reset de Prey, expiração de Premium, recuperação de sessão órfã (FUN-28)
// e reconciliação de pagamento.

import type { Configuration } from '../config.js';
import type { Logger } from '../log.js';
import type { Role } from '../role.js';
import type { TicketService } from '../tickets.js';
import type { SessionDirectory } from '../directory.js';
import type { SnapshotStore } from '../snapshots.js';
import type { ReceiptStore } from '../receipts.js';
import type { Database } from '../db/client.js';
import { sweepOrphanedSessions } from './orphans.js';
import type { Progression } from '@draconya/content';
import { writePendingReceipts } from './ledger.js';

export interface JobsDependencies {
  readonly tickets?: TicketService;
  readonly directory?: SessionDirectory;
  readonly snapshots?: SnapshotStore;
  readonly receipts?: ReceiptStore;
  readonly database?: Database;
  /** Curva de XP, para o `jobs` derivar o level ao creditar a progressão (FUN-54). */
  readonly progression?: Progression;
}

const SCHEDULE_INTERVAL_MS = 10_000;

export function createJobs(
  _configuration: Configuration,
  logger: Logger,
  dependencies: JobsDependencies = {},
): Role {
  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function runCycle(): Promise<void> {
    // Reentrância: um ciclo lento não pode se sobrepor ao seguinte.
    if (running) {
      logger.warn('Previous cycle is still running; skipping this cycle');
      return;
    }
    running = true;
    try {
      // FUN-12: devolver o slot de ticket que passou do prazo sem virar sessão.
      if (dependencies.tickets !== undefined) {
        const released = await dependencies.tickets.sweepAbandoned();
        if (released > 0) logger.info({ released }, 'Released abandoned character slots');
      }

      // FUN-29: extrato de sessão encerrada vira linha de ledger. Roda ANTES da varredura
      // de órfãs: uma sessão que acabou de ser drenada tem crédito esperando, e creditar é
      // mais urgente que arrumar índice.
      if (dependencies.receipts !== undefined && dependencies.database !== undefined) {
        const { written, failed } = await writePendingReceipts({
          database: dependencies.database,
          receipts: dependencies.receipts,
          logger,
          ...(dependencies.progression === undefined
            ? {}
            : { progression: dependencies.progression }),
        });
        if (written > 0 || failed > 0) logger.info({ written, failed }, 'Wrote session receipts');
      }

      // FUN-28: sessão órfã é snapshot sem lease. Este ciclo NÃO retoma — retomar é
      // hospedar, e quem hospeda é o `game`, no `prepare` de quem reconectar. Aqui só se
      // devolve o slot de quem não voltou, para o jogador poder usar os outros personagens.
      if (dependencies.directory !== undefined && dependencies.snapshots !== undefined) {
        const swept = await sweepOrphanedSessions({
          directory: dependencies.directory,
          snapshots: dependencies.snapshots,
          logger,
        });
        if (swept.released > 0) {
          logger.info(swept, 'Swept orphaned sessions');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Scheduler cycle failed');
    } finally {
      running = false;
    }
  }

  return {
    name: 'jobs',
    async start() {
      // TODO(FUN-28): tomar o lock de singleton no Redis antes de começar a agendar.
      timer = setInterval(() => void runCycle(), SCHEDULE_INTERVAL_MS);
      logger.info({ intervalMs: SCHEDULE_INTERVAL_MS }, 'Jobs started');
    },
    async drain() {
      if (timer) clearTimeout(timer);
      timer = null;
      while (running) await new Promise((resolve) => setTimeout(resolve, 50));
      logger.info('Jobs stopped');
    },
  };
}
