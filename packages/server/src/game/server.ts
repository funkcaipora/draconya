// Processo `game` — stateful. Hospeda sessões e o WebSocket.
//
// ESQUELETO. O que existe aqui é o ciclo de vida do processo: subir, aceitar conexão,
// e drenar em SIGTERM. A sessão de verdade é a FUN-25; anexar/desanexar visualizador é a
// FUN-13; a drenagem que encerra creditando é a FUN-29. Os pontos de encaixe estão marcados.

import uWS from 'uWebSockets.js';
import type { Configuration } from '../config.js';
import type { SessionDirectory } from '../directory.js';
import type { Logger } from '../log.js';
import type { Role } from '../role.js';
import type { TicketService } from '../tickets.js';

export interface GameDependencies {
  readonly directory?: SessionDirectory;
  readonly tickets?: TicketService;
}

/** Um terço do lease do diretório: dá duas chances de errar antes de o nó parecer morto. */
const HEARTBEAT_INTERVAL_MS = 10_000;

export function createGame(
  configuration: Configuration,
  logger: Logger,
  dependencies: GameDependencies = {},
): Role {
  let listeningSocket: uWS.us_listen_socket | null = null;
  let acceptingNewSessions = true;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const nodeId = configuration.NODE_ID;
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

      // `request` é válido SÓ durante esta chamada — o uWS reaproveita a estrutura assim
      // que o handler retorna. Tudo que o caminho assíncrono vai precisar é lido agora;
      // ler depois devolve lixo, e o bug aparece como header vazio de vez em quando.
      const ticket = new URLSearchParams(request.getQuery()).get('ticket') ?? '';
      const key = request.getHeader('sec-websocket-key');
      const protocol = request.getHeader('sec-websocket-protocol');
      const extensions = request.getHeader('sec-websocket-extensions');

      const tickets = dependencies.tickets;
      if (tickets === undefined) {
        // Fechado por padrão: sem serviço de ticket ninguém entra. Aberto seria "qualquer
        // um vira qualquer personagem", que é pior do que o socket não funcionar.
        response.writeStatus('503 Service Unavailable').end();
        return;
      }

      let aborted = false;
      response.onAborted(() => {
        aborted = true;
      });

      void (async () => {
        const claim = await tickets.consume(ticket, nodeId);
        // Cliente desistiu enquanto o Redis respondia. Tocar em `response` depois do abort
        // derruba o processo inteiro. O ticket já foi queimado, e o slot volta pela
        // varredura de `tickets:pending` — que é justamente o desfecho que ela cobre.
        if (aborted) return;
        response.cork(() => {
          if (claim === null) {
            response.writeStatus('401 Unauthorized').end();
            return;
          }
          response.upgrade(
            { accountId: claim.accountId, characterId: claim.characterId },
            key,
            protocol,
            extensions,
            context,
          );
        });
      })();
    },

    open: (socket) => {
      // FUN-13: anexar visualizador à sessão. Desanexar não pode ter efeito sobre ela.
      const { characterId } = socket.getUserData() as { characterId: string };
      logger.debug({ characterId }, 'Connection opened');
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
          logger.info({ port: configuration.GAME_PORT, nodeId }, 'Game listening');
          resolve();
        });
      });

      // O batimento é o que torna este nó VISÍVEL para o `api` emitir ticket. Sem ele o
      // processo sobe, aceita conexão e nunca recebe nenhuma — falha silenciosa clássica.
      const directory = dependencies.directory;
      if (directory !== undefined) {
        // TODO(FUN-13): `sessions` sai do contador real de sessões hospedadas. Enquanto for
        // zero fixo, a escolha do nó menos carregado é na prática arbitrária — o que só não
        // importa porque hoje existe um nó.
        const beat = (): void => {
          void directory
            .heartbeat(nodeId, { sessions: 0, url: configuration.GAME_PUBLIC_URL })
            .catch((error: unknown) => logger.error({ error }, 'Heartbeat failed'));
        };
        beat();
        heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
      }
    },
    async drain() {
      // FUN-29: aqui é onde a drenagem de verdade entra — parar de aceitar, snapshot
      // final de cada sessão, encerrar creditando o progresso, notificar. O orçamento
      // de tempo importa: drenagem interrompida no meio é pior que drenagem nenhuma.
      acceptingNewSessions = false;
      logger.info('Game stopped accepting new sessions');
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (listeningSocket) {
        uWS.us_listen_socket_close(listeningSocket);
        listeningSocket = null;
      }
      logger.info('Game stopped');
    },
  };
}
