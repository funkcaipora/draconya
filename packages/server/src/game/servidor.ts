// Processo `game` — stateful. Hospeda sessões e o WebSocket.
//
// ESQUELETO. O que existe aqui é o ciclo de vida do processo: subir, aceitar conexão,
// e drenar em SIGTERM. A sessão de verdade é a FUN-25; anexar/desanexar visualizador é a
// FUN-13; a drenagem que encerra creditando é a FUN-29. Os pontos de encaixe estão marcados.

import uWS from 'uWebSockets.js';
import type { Configuracao } from '../config.js';
import type { Log } from '../log.js';
import type { Papel } from '../papel.js';

export function criarGame(cfg: Configuracao, log: Log): Papel {
  let socketDeEscuta: uWS.us_listen_socket | null = null;
  let aceitandoNovas = true;

  const app = uWS.App();

  app.get('/healthz', (resposta) => {
    // Durante a drenagem o nó continua vivo para as sessões existentes, mas para de
    // aceitar novas — o balanceador precisa enxergar isso.
    resposta.writeStatus(aceitandoNovas ? '200 OK' : '503 Service Unavailable');
    resposta.writeHeader('content-type', 'application/json');
    resposta.end(JSON.stringify({ ok: aceitandoNovas, papel: 'game' }));
  });

  app.ws('/*', {
    // Limites conservadores: cliente lento não pode fazer o nó crescer sem limite (FUN-13).
    maxPayloadLength: 64 * 1024,
    idleTimeout: 60,
    maxBackpressure: 1024 * 1024,

    upgrade: (resposta, requisicao, contexto) => {
      if (!aceitandoNovas) {
        resposta.writeStatus('503 Service Unavailable').end();
        return;
      }
      // FUN-12: validar o ticket aqui, de uso único, e resolver o personagem.
      const ticket = new URLSearchParams(requisicao.getQuery()).get('ticket') ?? '';
      resposta.upgrade(
        { ticket },
        requisicao.getHeader('sec-websocket-key'),
        requisicao.getHeader('sec-websocket-protocol'),
        requisicao.getHeader('sec-websocket-extensions'),
        contexto,
      );
    },

    open: () => {
      // FUN-13: anexar visualizador à sessão. Desanexar não pode ter efeito sobre ela.
      log.debug('conexão aberta');
    },

    message: () => {
      // FUN-7 + FUN-13: decodificar o frame e despachar por opcode.
    },

    close: () => {
      // FUN-13: desanexar visualizador. A SESSÃO CONTINUA — é o ADR 0001 em uma linha.
      log.debug('conexão fechada');
    },
  });

  return {
    nome: 'game',
    async iniciar() {
      await new Promise<void>((resolver, rejeitar) => {
        app.listen('0.0.0.0', cfg.GAME_PORT, (socket) => {
          if (!socket) {
            rejeitar(new Error(`game não conseguiu ouvir na porta ${cfg.GAME_PORT}`));
            return;
          }
          socketDeEscuta = socket;
          log.info({ porta: cfg.GAME_PORT }, 'game ouvindo');
          resolver();
        });
      });
    },
    async drenar() {
      // FUN-29: aqui é onde a drenagem de verdade entra — parar de aceitar, snapshot
      // final de cada sessão, encerrar creditando o progresso, notificar. O orçamento
      // de tempo importa: drenagem interrompida no meio é pior que drenagem nenhuma.
      aceitandoNovas = false;
      log.info('game parou de aceitar novas sessões');
      if (socketDeEscuta) {
        uWS.us_listen_socket_close(socketDeEscuta);
        socketDeEscuta = null;
      }
      log.info('game encerrado');
    },
  };
}
