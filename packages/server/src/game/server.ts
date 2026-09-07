// Processo `game` — stateful. Hospeda sessões e o WebSocket.
//
// ESQUELETO. O que existe aqui é o ciclo de vida do processo: subir, aceitar conexão,
// e drenar em SIGTERM. A sessão de verdade é a FUN-25; anexar/desanexar visualizador é a
// FUN-13; a drenagem que encerra creditando é a FUN-29. Os pontos de encaixe estão marcados.

import uWS from 'uWebSockets.js';
import type { Configuration } from '../config.js';
import type { Logger } from '../log.js';
import type { Role } from '../role.js';

export function createGame(configuration: Configuration, logger: Logger): Role {
  let listeningSocket: uWS.us_listen_socket | null = null;
  let acceptingNewSessions = true;

  const app = uWS.App();

  app.get('/healthz', (response) => {
    // Durante a drenagem o nó continua vivo para as sessões existentes, mas para de
    // aceitar novas — o balanceador precisa enxergar isso.
    response.writeStatus(acceptingNewSessions ? '200 OK' : '503 Service Unavailable');
    response.writeHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: acceptingNewSessions, role: 'game' }));
  });

  app.ws('/*', {
    // Limites conservadores: cliente lento não pode fazer o nó crescer sem limite (FUN-13).
    maxPayloadLength: 64 * 1024,
    idleTimeout: 60,
    maxBackpressure: 1024 * 1024,

    upgrade: (response, request, context) => {
      if (!acceptingNewSessions) {
        response.writeStatus('503 Service Unavailable').end();
        return;
      }
      // FUN-12: validar o ticket aqui, de uso único, e resolver o personagem.
      const ticket = new URLSearchParams(request.getQuery()).get('ticket') ?? '';
      response.upgrade(
        { ticket },
        request.getHeader('sec-websocket-key'),
        request.getHeader('sec-websocket-protocol'),
        request.getHeader('sec-websocket-extensions'),
        context,
      );
    },

    open: () => {
      // FUN-13: anexar visualizador à sessão. Desanexar não pode ter efeito sobre ela.
      logger.debug('Connection opened');
    },

    message: () => {
      // FUN-7 + FUN-13: decodificar o frame e despachar por opcode.
    },

    close: () => {
      // FUN-13: desanexar visualizador. A SESSÃO CONTINUA — é o ADR 0001 em uma linha.
      logger.debug('Connection closed');
    },
  });

  return {
    name: 'game',
    async start() {
      await new Promise<void>((resolve, reject) => {
        app.listen('0.0.0.0', configuration.GAME_PORT, (socket) => {
          if (!socket) {
            reject(new Error(`Game could not listen on port ${configuration.GAME_PORT}`));
            return;
          }
          listeningSocket = socket;
          logger.info({ port: configuration.GAME_PORT }, 'Game listening');
          resolve();
        });
      });
    },
    async drain() {
      // FUN-29: aqui é onde a drenagem de verdade entra — parar de aceitar, snapshot
      // final de cada sessão, encerrar creditando o progresso, notificar. O orçamento
      // de tempo importa: drenagem interrompida no meio é pior que drenagem nenhuma.
      acceptingNewSessions = false;
      logger.info('Game stopped accepting new sessions');
      if (listeningSocket) {
        uWS.us_listen_socket_close(listeningSocket);
        listeningSocket = null;
      }
      logger.info('Game stopped');
    },
  };
}
