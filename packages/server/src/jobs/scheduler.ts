// Processo `jobs` — singleton com lock. Agendador, expirações e reconciliação.
//
// ESQUELETO. O laço existe; as tarefas entram depois: Guild War diária, expiração da
// Caixa de Loot, reset de Prey, expiração de Premium, recuperação de sessão órfã (FUN-28)
// e reconciliação de pagamento.

import type { Configuration } from '../config.js';
import type { Logger } from '../log.js';
import type { Role } from '../role.js';
import type { TicketService } from '../tickets.js';

export interface JobsDependencies {
  readonly tickets?: TicketService;
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

      // FUN-28: procurar sessões órfãs (lease expirado) e decidir retomar ou creditar.
      // Precisa de lock com fencing token — duas cópias da mesma sessão rodando é pior
      // que uma perdida, porque dobra loot e XP.
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
