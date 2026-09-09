// Processo `api` — stateless. HTTP: auth, tickets, personagens, market, pagamentos.
// Nada aqui segura estado de jogo; isso é do `game`.

import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyRequest } from 'fastify';
import { collectDefaultMetrics, Registry } from 'prom-client';
import type { AuthService } from '../auth/service.js';
import type { Configuration } from '../config.js';
import { AccountIdentityConflictError, type GameRepository } from '../db/repository.js';
import type { Logger } from '../log.js';
import type { Role } from '../role.js';
import { registerAuthRoutes } from './auth.js';
import { registerCharacterRoutes } from './characters.js';
import { createTicketHandler, type TicketRouteDependencies } from './tickets.js';

export interface ApiDependencies extends Partial<TicketRouteDependencies> {
  readonly auth?: AuthService;
  readonly repository?: GameRepository;
  readonly isCharacterActive?: (accountId: string, characterId: string) => Promise<boolean>;
  /** Onde o personagem está agora, segundo o diretório de sessões (FUN-30). */
  readonly locateSession?: (
    characterId: string,
  ) => Promise<{ sessionId: string; type: string } | null>;
}

export function createApi(
  configuration: Configuration,
  logger: Logger,
  dependencies: ApiDependencies = {},
): Role {
  const app = buildApi(configuration, logger, dependencies);
  return {
    name: 'api',
    async start() {
      await app.listen({ port: configuration.API_PORT, host: '0.0.0.0' });
      logger.info({ port: configuration.API_PORT }, 'API listening');
    },
    async drain() {
      await app.close();
      logger.info('API stopped');
    },
  };
}

/** A mesma composição usada no processo e nos testes de integração HTTP. */
export function buildApi(
  configuration: Configuration,
  logger: Logger,
  dependencies: ApiDependencies = {},
) {
  const apiLogger: FastifyBaseLogger = logger.child({}, {
    // A URL da callback contém code/state. Não registrar credenciais nem cookies.
    serializers: {
      req: (request: FastifyRequest) => ({ method: request.method, url: request.url.split('?')[0] }),
    },
  });
  const app = Fastify({ loggerInstance: apiLogger });
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  app.addHook('onRequest', async (request, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.origin;
    const referer = request.headers.referer;
    const expectedOrigin = new URL(configuration.API_ORIGIN).origin;
    // SameSite não isola subdomínios. A origem é verificada também nas mutações sem JSON,
    // como logout. Clientes CLI sem metadados de navegador continuam permitidos.
    let allowed = true;
    if (origin !== undefined) allowed = origin === expectedOrigin;
    else if (referer !== undefined) {
      try { allowed = new URL(referer).origin === expectedOrigin; }
      catch { allowed = false; }
    } else {
      const site = request.headers['sec-fetch-site'];
      allowed = site !== 'cross-site' && site !== 'same-site';
    }
    if (!allowed) return reply.code(403).send({ error: 'untrusted-origin' });
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AccountIdentityConflictError) {
      return reply.code(409).send({ error: 'account-identity-conflict' });
    }
    // Exceções de banco/provedor podem conter SQL, e-mails ou detalhes de autenticação.
    // Não devolver nem registrar o objeto bruto ao tratar uma falha não prevista.
    const statusCode = error.statusCode;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: 'invalid-request' });
    }
    request.log.error({ errorType: error.name }, 'Request failed');
    return reply.code(503).send({ error: 'service-unavailable' });
  });

  // O cliente Vite roda em outra origem em desenvolvimento. CORS é deliberadamente estreito:
  // uma origem configurada, credenciais habilitadas, nada de wildcard com cookie.
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('access-control-allow-origin', configuration.API_ORIGIN);
    reply.header('access-control-allow-credentials', 'true');
    reply.header('vary', 'Origin');
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'private, no-store');
    return payload;
  });
  app.options('/*', async (_request, reply) => {
    reply.header('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    reply.header('access-control-allow-headers', 'content-type');
    return reply.code(204).send();
  });

  app.get('/healthz', async () => ({ ok: true, role: 'api' }));

  const auth = dependencies.auth;
  const repository = dependencies.repository;
  if (auth !== undefined) registerAuthRoutes(app, configuration, auth);
  if (auth !== undefined && repository !== undefined) {
    registerCharacterRoutes(
      app, auth, repository, dependencies.isCharacterActive, dependencies.locateSession,
    );
  }

  const tickets = dependencies.tickets;
  if (tickets !== undefined) {
    app.post('/api/tickets', createTicketHandler({
      ...dependencies,
      tickets,
      ...(auth === undefined ? {} : { authenticate: auth.authenticate.bind(auth) }),
      ...(repository === undefined ? {} : {
        withOwnedCharacter: repository.withOwnedCharacter.bind(repository),
      }),
    }));
  }

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  app.addHook('onClose', async () => { registry.clear(); });
  return app;
}
