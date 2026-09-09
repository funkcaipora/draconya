// Processo `jobs` — singleton com lock. Agendador, expirações e reconciliação.
//
// ESQUELETO. O laço existe; as tarefas entram depois: Guild War diária, expiração da
// Caixa de Loot, reset de Prey, expiração de Premium, recuperação de sessão órfã (FUN-28)
// e reconciliação de pagamento.
//
// Desde a FUN-59 o `jobs` tem por onde falar: um `/metrics` próprio, em `JOBS_PORT`, como os
// outros dois papéis. É a forma que o Prometheus espera, e o que faz o alvo SUMIR quando o
// processo morre — que é exatamente o sinal que se quer. Um contador que vivesse no Redis e
// fosse servido por outro processo não morreria com o `jobs`, e "o `jobs` parou" ficaria
// indistinguível de "o `jobs` não achou nada".

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
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
import type { JobsMetrics } from './metrics.js';

export interface JobsDependencies {
  readonly tickets?: TicketService;
  readonly directory?: SessionDirectory;
  readonly snapshots?: SnapshotStore;
  readonly receipts?: ReceiptStore;
  readonly database?: Database;
  /** Curva de XP, para o `jobs` derivar o level ao creditar a progressão (FUN-54). */
  readonly progression?: Progression;
  /** Onde o ciclo conta o que fez (FUN-59). Ausente: o `jobs` roda igual, só não expõe nada. */
  readonly metrics?: JobsMetrics;
  /** Relógio de parede, para o carimbo de último sucesso. Injetável para teste. */
  readonly now?: () => number;
}

const SCHEDULE_INTERVAL_MS = 10_000;

/**
 * O ciclo, separado do agendamento para ser testável sem `setInterval`.
 *
 * A reentrância mora AQUI, e não no timer: um ciclo lento não pode se sobrepor ao seguinte, e
 * isso vale igual para quem dispara pelo relógio e para quem dispara à mão.
 */
export function createJobsCycle(
  logger: Logger,
  dependencies: JobsDependencies = {},
): { run(): Promise<void>; readonly running: boolean } {
  const { metrics } = dependencies;
  const now = dependencies.now ?? Date.now;
  let running = false;

  async function run(): Promise<void> {
    if (running) {
      logger.warn('Previous cycle is still running; skipping this cycle');
      // Um ciclo pulado é SINAL, não ruído: é o primeiro sintoma de intervalo apertado demais.
      metrics?.observeSkipped();
      return;
    }
    running = true;
    const startedAt = now();
    let slotsReleased = 0;
    let receiptsWritten = 0;
    let receiptsFailed = 0;
    try {
      // FUN-12: devolver o slot de ticket que passou do prazo sem virar sessão.
      if (dependencies.tickets !== undefined) {
        slotsReleased = await dependencies.tickets.sweepAbandoned();
        if (slotsReleased > 0) {
          logger.info({ released: slotsReleased }, 'Released abandoned character slots');
        }
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
        receiptsWritten = written;
        receiptsFailed = failed;
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
        // Um zero aqui é um zero OBSERVADO: a varredura olhou e não achou. Era a pendência
        // da FUN-47, e a diferença entre "nenhuma órfã" e "ninguém olhou" é o painel inteiro.
        metrics?.observeOrphans(swept.orphaned);
        if (swept.released > 0) {
          logger.info(swept, 'Swept orphaned sessions');
        }
      }

      metrics?.observeCycle(
        (now() - startedAt) / 1000,
        { slotsReleased, receiptsWritten, receiptsFailed },
        now(),
      );
    } catch (error) {
      // O `catch` continua engolindo — um ciclo que explode não pode derrubar o processo —,
      // mas agora conta. Antes, só logava, e log ninguém alerta.
      metrics?.observeCycleFailure();
      logger.error({ error }, 'Scheduler cycle failed');
    } finally {
      running = false;
    }
  }

  return {
    run,
    get running() {
      return running;
    },
  };
}

export function createJobs(
  configuration: Configuration,
  logger: Logger,
  dependencies: JobsDependencies = {},
): Role {
  const cycle = createJobsCycle(logger, dependencies);
  let timer: NodeJS.Timeout | null = null;
  // Fastify, e não uWebSockets: o `jobs` não tem WebSocket nem caminho quente. uWS existe no
  // `game` porque lá o socket é o produto; usar a biblioteca do `api` deixa o `jobs` com uma
  // dependência a menos para entender.
  let http: FastifyInstance | null = null;

  return {
    name: 'jobs',
    async start() {
      const { metrics } = dependencies;
      if (metrics !== undefined) {
        http = Fastify({ logger: false });
        // Sem autenticação, como nos outros dois papéis: quem esconde o `/metrics` é a rede.
        // Pôr credencial aqui daria a falsa impressão de que ele pode sair para a internet.
        http.get('/metrics', async (_request, reply) => {
          reply.header('content-type', metrics.registry.contentType);
          return metrics.registry.metrics();
        });
        // Conflito de porta — modo solo com dois papéis na mesma — falha AQUI, no boot, e não
        // em silêncio com um alvo que nunca responde.
        await http.listen({ port: configuration.JOBS_PORT, host: '0.0.0.0' });
        logger.info({ port: configuration.JOBS_PORT }, 'Jobs metrics listening');
      }
      // TODO(FUN-28): tomar o lock de singleton no Redis antes de começar a agendar.
      timer = setInterval(() => void cycle.run(), SCHEDULE_INTERVAL_MS);
      logger.info({ intervalMs: SCHEDULE_INTERVAL_MS }, 'Jobs started');
    },
    async drain() {
      if (timer) clearTimeout(timer);
      timer = null;
      while (cycle.running) await new Promise((resolve) => setTimeout(resolve, 50));
      if (http !== null) {
        await http.close();
        http = null;
      }
      logger.info('Jobs stopped');
    },
  };
}
