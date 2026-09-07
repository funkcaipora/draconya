// Processo `api` — stateless. HTTP: auth, tickets, personagens, market, pagamentos.
// Nada aqui segura estado de jogo; isso é do `game`.

import Fastify from 'fastify';
import { collectDefaultMetrics, Registry } from 'prom-client';
import type { Configuration } from '../config.js';
import type { Logger } from '../log.js';
import type { Role } from '../role.js';

export function createApi(configuration: Configuration, logger: Logger): Role {
  const app = Fastify({ loggerInstance: logger });
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  app.get('/healthz', async () => ({ ok: true, role: 'api' }));

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
