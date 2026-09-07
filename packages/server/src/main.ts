// Entrada única dos três papéis.
//
//   PROCESSOS=api,game,jobs   modo solo — tudo num processo (desenvolvimento e validação)
//   PROCESSOS=game            um papel por container (escala)
//
// A mesma imagem serve aos dois. Validar numa VPS pequena não exige desenho diferente
// do de escala — muda só a variável.

import { loadConfiguration } from './config.js';
import { createLogger } from './log.js';
import { createApi } from './api/server.js';
import { createGame } from './game/server.js';
import { createJobs } from './jobs/scheduler.js';
import type { Role } from './role.js';

const VALID_ROLES = ['api', 'game', 'jobs'] as const;
type RoleName = (typeof VALID_ROLES)[number];

/** Prazo para drenar antes de o orquestrador mandar SIGKILL. */
const DRAIN_TIMEOUT_MS = 25_000;

function requestedRoles(): RoleName[] {
  const raw = process.env['PROCESSES'] ?? 'api,game,jobs';
  const requested = raw.split(',').map((role) => role.trim()).filter(Boolean);
  const invalid = requested.filter((role) => !VALID_ROLES.includes(role as RoleName));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid PROCESSES value: ${invalid.join(', ')}. Valid roles: ${VALID_ROLES.join(', ')}`,
    );
  }
  if (requested.length === 0) throw new Error('PROCESSES cannot be empty');
  return requested as RoleName[];
}

async function main(): Promise<void> {
  const configuration = loadConfiguration();
  const names = requestedRoles();
  const logger = createLogger(configuration.LOG_LEVEL, names.join('+'));

  const factories: Record<RoleName, () => Role> = {
    api: () => createApi(configuration, logger.child({ role: 'api' })),
    game: () => createGame(configuration, logger.child({ role: 'game' })),
    jobs: () => createJobs(configuration, logger.child({ role: 'jobs' })),
  };

  const roles = names.map((name) => factories[name]());
  logger.info({ roles: names, standalone: names.length > 1 }, 'Starting');

  for (const role of roles) await role.start();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    // Segundo sinal força a saída: se o operador mandou duas vezes, ele quer agora.
    if (shuttingDown) {
      logger.warn({ signal }, 'Second signal received; exiting immediately');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, 'Draining');

    const timeout = setTimeout(() => {
      logger.error({ timeoutMs: DRAIN_TIMEOUT_MS }, 'Drain timed out; exiting');
      process.exit(1);
    }, DRAIN_TIMEOUT_MS);
    timeout.unref();

    // Ordem importa: `api` primeiro para parar de emitir ticket, depois `jobs` para
    // não competir por sessão órfã, e `game` por último para ter o prazo inteiro —
    // é ele que precisa creditar progresso de quem não está olhando.
    const drainOrder = ['api', 'jobs', 'game'];
    const draining = [...roles].sort(
      (a, b) => drainOrder.indexOf(a.name) - drainOrder.indexOf(b.name),
    );

    void (async () => {
      for (const role of draining) {
        try {
          await role.drain();
        } catch (error) {
          logger.error({ error, role: role.name }, 'Failed to drain role');
        }
      }
      clearTimeout(timeout);
      logger.info('Shutdown completed cleanly');
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Estado inconsistente não pode continuar servindo: melhor cair e ser reiniciado.
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
