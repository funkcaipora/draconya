// Entrada única dos três papéis.
//
//   PROCESSES=api,game,jobs   modo solo — tudo num processo (desenvolvimento e validação)
//   PROCESSES=game            um papel por container (escala)
//
// A mesma imagem serve aos dois. Validar numa VPS pequena não exige desenho diferente
// do de escala — muda só a variável.

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Redis } from 'ioredis';
import { loadContent } from '@draconya/content/load';
import { loadConfiguration } from './config.js';
import { createLogger } from './log.js';
import { buildCatalogue } from './game/catalogue.js';
import { createApi } from './api/server.js';
import { createGame } from './game/server.js';
import {
  CityShard, createBotConfigValidator, createCitySessionFactory, createSessionBuilder,
  createSessionRestorer,
} from './game/sessions.js';
import { createJobs } from './jobs/scheduler.js';
import { createSingletonLock } from './jobs/lock.js';
import { JobsMetrics } from './jobs/metrics.js';
import { settleCharacterProgress } from './jobs/ledger.js';
import { SessionDirectory } from './directory.js';
import { TicketService } from './tickets.js';
import { SnapshotStore } from './snapshots.js';
import { ReceiptStore } from './receipts.js';
import { LootBoxStore } from './loot-box.js';
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
  const receipts = new ReceiptStore(redis);

  // Postgres só é exigido quando o papel `api` está presente. Um nó exclusivamente `game`
  // continua sem conexão de banco no caminho quente da simulação.
  // `api` precisa de banco para conta e personagem; `jobs` precisa para escrever o ledger
  // (FUN-29). Um nó exclusivamente `game` segue SEM conexão de banco — é o caminho quente da
  // simulação, e o AGENTS.md do pacote proíbe banco ali.
  const needsDatabase = names.includes('api') || names.includes('jobs');
  const database = needsDatabase ? createDatabase(configuration.DATABASE_URL) : null;
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

  const lootBoxes = new LootBoxStore(redis);

  // A cópia da Cidade deste nó (FUN-71, ADR 0023). Uma por processo `game`, e é assim que
  // "Cidade 2" nasce: dois nós já são duas praças, sem nada a mais.
  const nowMs = (): number => Date.now();
  const cityShard = new CityShard(content, nowMs);
  // O catálogo do que existe (FUN-79, FUN-89), montado UMA vez: a versão de conteúdo é fixada
  // e não muda enquanto o processo vive.
  const catalogue = buildCatalogue(content);

  const factories: Record<RoleName, () => Role> = {
    api: () => {
      const apiLogger = logger.child({ role: 'api' });
      return createApi(configuration, apiLogger, {
        tickets,
        ...(auth === null || repository === null || database === null
          ? {}
          : {
              auth,
              repository,
              // Uma ida ao Redis, não duas: esta checagem roda com a transação do Postgres
              // ABERTA, segurando a linha do personagem (FUN-53).
              isCharacterActive: (accountId, characterId) =>
                directory.isActive(accountId, characterId),
              locateSession: (characterId) => directory.lookup(characterId),
              // O `api` escreve a linha do personagem aqui — e isso NÃO é estado quente
              // (invariante 9): o extrato só existe depois que a sessão dona acabou, e é
              // exatamente a mesma escrita que o `jobs` faria dez segundos depois. Sem ela,
              // quem reconecta dentro da janela da varredura vê o personagem zerar (FUN-56).
              // A mochila do personagem viaja no ticket (FUN-82): é assim que ela chega ao
              // `game`, que não fala com o Postgres.
              listItemInstances: (characterId: string) =>
                repository.listItemInstances(characterId),
              settleProgress: (characterId: string) =>
                settleCharacterProgress(characterId, {
                  database: database.db,
                  receipts,
                  logger: apiLogger,
                  progression: content.progression,
                }),
            }),
      });
    },
    game: () => createGame(configuration, logger.child({ role: 'game' }), {
      directory,
      tickets,
      contentVersion: content.version,
      // A MESMA cópia da Cidade nos dois caminhos (FUN-71, ADR 0023): quem entra no jogo e
      // quem volta de uma hunt chegam na mesma praça. Duas instâncias de `CityShard` aqui
      // dariam duas praças que nunca se veem, e o defeito seria invisível até alguém tentar
      // encontrar um amigo.
      createSession: createCitySessionFactory(content, nowMs, cityShard),
      snapshots,
      receipts,
      restoreSession: createSessionRestorer(content),
      buildSession: createSessionBuilder(content, nowMs, cityShard),
      // O host não recebe o `Content` inteiro: recebe a função que julga uma configuração de
      // bot (FUN-81). Quem cuida de socket não precisa conhecer balanceamento.
      acceptBotConfig: createBotConfigValidator(content),
      catalogue: () => catalogue,
      // O catálogo, para as regras de equipar. Não é o `Content` inteiro: o host não precisa
      // de balanceamento para decidir se uma espada cabe num slot.
      itemCatalog: content.items,
      // Nome e outfit de quem nasce na hunt (FUN-103). Mesmo raciocínio do catálogo de itens:
      // o host recebe o mapa, não o `Content` — e o mapa é do conteúdo fixado no boot.
      monsterCatalog: content.monsters,
      ...(content.appearances?.characters === undefined
        ? {}
        : { playerOutfitId: content.appearances.characters.default }),
      // E o que o combate desenha (FUN-109): sangue, projétil, explosão, brilho da poção. A
      // tabela inteira, e não os ids soltos, porque o host resolve por `spellId` e `supplyId`
      // na hora em que o `sim` emite — e a tabela é do conteúdo fixado no boot (invariante 7).
      ...(content.appearances === undefined ? {} : { appearances: content.appearances }),
      // A Caixa de Loot da Sessão (FUN-88). Redis, e não Postgres, porque ela EXPIRA — e
      // expirar precisa significar que o item nunca existiu.
      lootBoxes,
      // A ÚNICA escrita de banco do `game`, e ela é uma instrução só. Sem banco configurado,
      // a configuração vale na sessão e some no logout — degradação, não falha.
      ...(repository === null
        ? {}
        : { saveBotConfig: (characterId: string, config: unknown) =>
            repository.saveBotConfig(characterId, config) }),
    }),
    jobs: () => createJobs(configuration, logger.child({ role: 'jobs' }), {
      tickets, directory, snapshots, receipts, progression: content.progression,
      lootBoxes,
      metrics: new JobsMetrics(configuration.NODE_ID),
      // O dono do lock é único POR PROCESSO, não por máquina (FUN-91): dois containers `jobs`
      // no mesmo host compartilham o `NODE_ID`, renovariam o lock um do outro, e os dois se
      // achariam líderes — que é exatamente o que o lock existe para impedir.
      lock: createSingletonLock(redis, `${configuration.NODE_ID}:${randomUUID()}`),
      ...(database === null ? {} : { database: database.db }),
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
