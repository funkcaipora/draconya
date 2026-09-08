// Entrada única dos três papéis.
//
//   PROCESSOS=api,game,jobs   modo solo — tudo num processo (desenvolvimento e validação)
//   PROCESSOS=game            um papel por container (escala)
//
// A mesma imagem serve aos dois. Validar numa VPS pequena não exige desenho diferente
// do de escala — muda só a variável.

import { Redis } from 'ioredis';
import { loadConfiguration, type Configuration } from './config.js';
import { createLogger } from './log.js';
import { createApi, type ApiDependencies } from './api/server.js';
import { createGame } from './game/server.js';
import { createJobs } from './jobs/scheduler.js';
import { SessionDirectory } from './directory.js';
import { TicketService } from './tickets.js';
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

/**
 * Enquanto a FUN-10 (auth) e a FUN-11 (personagens) não existem, a emissão de ticket precisa
 * de um dono e de uma prova de posse vindos de algum lugar. Em `AUTH_DEV_MODE` isso é um
 * cabeçalho, o que basta para exercitar o fluxo ponta a ponta; fora dele não existe, e a
 * rota responde 501. Falhar fechado é a única opção: um endpoint que emite ticket para
 * qualquer personagem é acesso a qualquer conta.
 */
function developmentPrincipals(configuration: Configuration): ApiDependencies {
  if (!configuration.AUTH_DEV_MODE) return {};
  return {
    authenticate: async (request) => {
      const accountId = request.headers['x-dev-account'];
      return typeof accountId === 'string' && accountId !== '' ? { accountId } : null;
    },
    ownsCharacter: async () => true,
  };
}

async function main(): Promise<void> {
  const configuration = loadConfiguration();
  const names = requestedRoles();
  const logger = createLogger(configuration.LOG_LEVEL, names.join('+'));

  // Um cliente para os três papéis. Falhar aqui é melhor que falhar na primeira requisição:
  // sem Redis não há diretório de sessão, e sem diretório nenhum papel faz o seu trabalho.
  const redis = new Redis(configuration.REDIS_URL, { maxRetriesPerRequest: 3 });
  await redis.ping();

  const directory = new SessionDirectory(redis);
  const tickets = new TicketService(redis, directory);

  const factories: Record<RoleName, () => Role> = {
    api: () => createApi(configuration, logger.child({ role: 'api' }), {
      tickets,
      ...developmentPrincipals(configuration),
    }),
    game: () => createGame(configuration, logger.child({ role: 'game' }), {
      directory,
      tickets,
    }),
    jobs: () => createJobs(configuration, logger.child({ role: 'jobs' }), { tickets }),
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
      // Depois de todo mundo drenar: o `game` usa o Redis até o último crédito.
      await redis.quit().catch(() => redis.disconnect());
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
