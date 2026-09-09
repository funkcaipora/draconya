// Entrada única dos três papéis.
//
//   PROCESSES=api,game,jobs   modo solo — tudo num processo (desenvolvimento e validação)
//   PROCESSES=game            um papel por container (escala)
//
// A mesma imagem serve aos dois. Validar numa VPS pequena não exige desenho diferente
// do de escala — muda só a variável.

import { resolve } from 'node:path';
import { Redis } from 'ioredis';
import { loadContent } from '@draconya/content/load';
import { loadConfiguration } from './config.js';
import { createLogger } from './log.js';
import { createApi } from './api/server.js';
import { createGame } from './game/server.js';
import { createCitySessionFactory, restoreSession } from './game/sessions.js';
import { createJobs } from './jobs/scheduler.js';
import { SessionDirectory } from './directory.js';
import { TicketService } from './tickets.js';
import { SnapshotStore } from './snapshots.js';
import type { Role } from './role.js';
import { createDatabase } from './db/client.js';
import { DrizzleGameRepository } from './db/repository.js';
import { RedisAuthSessionStore } from './auth/sessions.js';
import { AuthService } from './auth/service.js';
import { WorkOsIdentityProvider } from './auth/workos.js';

const VALID_ROLES = ['api', 'game', 'jobs'] as const;
type RoleName = (typeof VALID_ROLES)[number];

/** Prazo para drenar antes de o orquestrador mandar SIGKILL. */
const DRAIN_TIMEOUT_MS = 25_000;

function requestedRoles(): RoleName[] {
  // `PROCESSOS` foi o nome até a migração para inglês (ADR 0014). Um ambiente que ainda o
  // declara é o pior caso possível: a variável é IGNORADA, o default entra no lugar, e quem
  // pediu só `game` recebe os três papéis — inclusive um `api` e um `jobs` a mais por
  // container, sem nada no log dizendo isso. Falhar no boot é a única reação honesta.
  if (process.env['PROCESSOS'] !== undefined) {
    throw new Error(
      'PROCESSOS was renamed to PROCESSES (ADR 0014). Rename it; it is being ignored, and '
      + 'the process would silently start every role instead of the ones you asked for.',
    );
  }
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

  // Um cliente para os três papéis. Falhar aqui é melhor que falhar na primeira requisição:
  // sem Redis não há diretório de sessão, e sem diretório nenhum papel faz o seu trabalho.
  const redis = new Redis(configuration.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    commandTimeout: 3_000,
  });
  await redis.connect();
  await redis.ping();

  const directory = new SessionDirectory(redis);
  const tickets = new TicketService(redis, directory);
  const snapshots = new SnapshotStore(redis);

  // Postgres só é exigido quando o papel `api` está presente. Um nó exclusivamente `game`
  // continua sem conexão de banco no caminho quente da simulação.
  const database = names.includes('api') ? createDatabase(configuration.DATABASE_URL) : null;
  if (database !== null) await database.ping();
  const repository = database === null ? null : new DrizzleGameRepository(database.db);
  const authSessions = new RedisAuthSessionStore(redis, configuration.AUTH_SESSION_TTL_SECONDS);

  const auth = repository === null
    ? null
    : new AuthService({
        repository,
        sessions: authSessions,
        authorizationStates: authSessions,
        devMode: configuration.AUTH_DEV_MODE,
        ...(configuration.AUTH_DEV_MODE
          || configuration.WORKOS_API_KEY === undefined
          || configuration.WORKOS_CLIENT_ID === undefined
          ? {}
          : {
              provider: new WorkOsIdentityProvider({
                apiKey: configuration.WORKOS_API_KEY,
                clientId: configuration.WORKOS_CLIENT_ID,
                redirectUri: configuration.WORKOS_REDIRECT_URI,
              }),
            }),
      });

  const contentDir = resolve(configuration.CONTENT_DIR);
  const content = loadContent(contentDir);
  logger.info(
    { contentDir, contentVersion: content.version, monsters: content.monsters.size },
    'Content loaded',
  );

  const factories: Record<RoleName, () => Role> = {
    api: () => createApi(configuration, logger.child({ role: 'api' }), {
      tickets,
      ...(auth === null || repository === null
        ? {}
        : {
            auth,
            repository,
            isCharacterActive: async (accountId, characterId) =>
              (await directory.lookup(characterId)) !== null
              || (await directory.activeSlots(accountId)).includes(characterId),
          }),
    }),
    game: () => createGame(configuration, logger.child({ role: 'game' }), {
      directory,
      tickets,
      contentVersion: content.version,
      createSession: createCitySessionFactory(content.version),
      snapshots,
      restoreSession,
    }),
    jobs: () => createJobs(configuration, logger.child({ role: 'jobs' }), {
      tickets, directory, snapshots,
    }),
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
      if (database !== null) await database.close().catch(() => undefined);
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
