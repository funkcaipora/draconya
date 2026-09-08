// Processo `api` — stateless. HTTP: auth, tickets, personagens, market, pagamentos.
// Nada aqui segura estado de jogo; isso é do `game`.

import Fastify from 'fastify';
import { collectDefaultMetrics, Registry } from 'prom-client';
import type { Configuration } from '../config.js';
import type { Logger } from '../log.js';
import type { Role } from '../role.js';
import { createTicketHandler, type TicketRouteDependencies } from './tickets.js';

export type ApiDependencies = Partial<TicketRouteDependencies>;

export function createApi(
  configuration: Configuration,
  logger: Logger,
  dependencies: ApiDependencies = {},
): Role {
  const app = Fastify({ loggerInstance: logger });
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  app.get('/healthz', async () => ({ ok: true, role: 'api' }));

  // Sem serviço de ticket o `api` sobe assim mesmo: `/healthz` e `/metrics` continuam de pé,
  // e é isso que permite subir só o HTTP sem Redis para inspecionar um processo.
  const tickets = dependencies.tickets;
  if (tickets !== undefined) {
    app.post('/api/tickets', createTicketHandler({ ...dependencies, tickets }));
  }

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  return {
    name: 'api',
    async start() {
      await app.listen({ port: configuration.API_PORT, host: '0.0.0.0' });
      logger.info({ port: configuration.API_PORT }, 'API listening');
    },
    async drain() {
      // Stateless: fechar de imediato é seguro. Requisição em voo termina sozinha.
      await app.close();
      logger.info('API stopped');
    },
  };
}
