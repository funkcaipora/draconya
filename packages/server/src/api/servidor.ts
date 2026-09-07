// Processo `api` — stateless. HTTP: auth, tickets, personagens, market, pagamentos.
// Nada aqui segura estado de jogo; isso é do `game`.

import Fastify from 'fastify';
import { collectDefaultMetrics, Registry } from 'prom-client';
import type { Configuracao } from '../config.js';
import type { Log } from '../log.js';
import type { Papel } from '../papel.js';

export function criarApi(cfg: Configuracao, log: Log): Papel {
  const app = Fastify({ loggerInstance: log });
  const registro = new Registry();
  collectDefaultMetrics({ register: registro });

  app.get('/healthz', async () => ({ ok: true, papel: 'api' }));

  app.get('/metrics', async (_req, resposta) => {
    resposta.header('content-type', registro.contentType);
    return registro.metrics();
  });

  return {
    nome: 'api',
    async iniciar() {
      await app.listen({ port: cfg.API_PORT, host: '0.0.0.0' });
      log.info({ porta: cfg.API_PORT }, 'api ouvindo');
    },
    async drenar() {
      // Stateless: fechar de imediato é seguro. Requisição em voo termina sozinha.
      await app.close();
      log.info('api encerrada');
    },
  };
}
