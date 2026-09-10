// Processo `game` — stateful. Hospeda sessões e o WebSocket.
//
// A escolha do uWebSockets.js é pela CONTA DE CONEXÕES, não pela CPU: o gargalo projetado do
// sistema é quanta gente cabe conectada, e não quanto custa simular.
//
// O que este arquivo faz é a borda: handshake por ticket, decodificação de frame e ciclo de
// vida do processo. Quem hospeda sessão e visualizador é o `SessionHost`.

import uWS from 'uWebSockets.js';
import { decodeC2S } from '@draconya/protocol';
import type { Configuration } from '../config.js';
import type { Session, SessionSnapshot } from '@draconya/sim';
import type { SessionDirectory } from '../directory.js';
import type { SnapshotStore } from '../snapshots.js';
import type { ReceiptStore } from '../receipts.js';
import type { Logger } from '../log.js';
import type { Role } from '../role.js';
import type { TicketService } from '../tickets.js';
import {
  SessionHost, type SessionBuilder, type SessionFactory, type SessionHostOptions,
  type SessionRestorer,
} from './host.js';
import { GameMetrics } from './metrics.js';
import { Viewer } from './viewer.js';

export interface GameDependencies {
  readonly directory?: SessionDirectory;
  readonly tickets?: TicketService;
  readonly createSession?: SessionFactory;
  readonly contentVersion?: string;
  /** Onde a sessão é guardada para sobreviver à queda do processo (FUN-28). */
  readonly snapshots?: SnapshotStore;
  readonly receipts?: ReceiptStore;
  readonly restoreSession?: SessionRestorer;
  readonly buildSession?: SessionBuilder;
  /**
   * Relógio monotônico da simulação. Injetável porque o critério de saída da Fase 1 (FUN-44)
   * precisa "esperar" minutos de hunt sem esperar de verdade — teste que dorme dez minutos
   * não roda no CI, e portanto não roda nunca.
   */
  readonly now?: () => number;
  /** Aceita ou recusa uma configuração de bot (FUN-81). Ver `SessionHostOptions`. */
  readonly acceptBotConfig?: SessionHostOptions['acceptBotConfig'];
  /** Persiste a configuração aceita. A única escrita de banco do `game`. */
  readonly saveBotConfig?: SessionHostOptions['saveBotConfig'];
  /** O catálogo de itens, para as regras de equipar (FUN-82). */
  readonly itemCatalog?: SessionHostOptions['itemCatalog'];
}

/**
 * O papel `game`, mais o que só ele tem.
 *
 * `host` e `stop` não entram na interface `Role` de propósito: `api` e `jobs` não hospedam
 * sessão nenhuma, e um método que só um dos três implementa de verdade é um método que os
 * outros dois precisam fingir.
 */
export interface GameRole extends Role {
  /** As sessões deste nó. Exposto para o teste do critério de saída da Fase 1 dirigir o tempo. */
  readonly host: SessionHost | null;
  /**
   * Para tudo SEM creditar nada: é o que um `kill -9` parece de fora.
   *
   * O snapshot que já estiver no Redis fica, e é dele que a retomada vive (FUN-28). Isto não
   * é a drenagem — a drenagem credita, e confundir as duas seria justamente perder o
   * progresso que o ADR 0010 existe para preservar.
   */
  stop(): void;
}

/** Um terço do lease do diretório: dá duas chances de errar antes de o nó parecer morto. */
const HEARTBEAT_INTERVAL_MS = 10_000;

interface SocketData {
  accountId: string;
  characterId: string;
  viewer: Viewer | null;
}

export function createGame(
  configuration: Configuration,
  logger: Logger,
  dependencies: GameDependencies = {},
): GameRole {
  let listeningSocket: uWS.us_listen_socket | null = null;
  let acceptingNewSessions = true;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const nodeId = configuration.NODE_ID;
  const app = uWS.App();

  const metrics = new GameMetrics(nodeId);

  const host = dependencies.createSession === undefined
    ? null
    : new SessionHost({
      nodeId,
      contentVersion: dependencies.contentVersion ?? 'unknown',
      createSession: dependencies.createSession,
      logger,
      ...(dependencies.directory === undefined ? {} : { directory: dependencies.directory }),
      ...(dependencies.snapshots === undefined ? {} : { snapshots: dependencies.snapshots }),
      ...(dependencies.receipts === undefined ? {} : { receipts: dependencies.receipts }),
      ...(dependencies.buildSession === undefined
        ? {}
        : { buildSession: dependencies.buildSession }),
      ...(dependencies.restoreSession === undefined
        ? {}
        : { restoreSession: dependencies.restoreSession }),
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.acceptBotConfig === undefined
        ? {}
        : { acceptBotConfig: dependencies.acceptBotConfig }),
      ...(dependencies.saveBotConfig === undefined
        ? {}
        : { saveBotConfig: dependencies.saveBotConfig }),
      ...(dependencies.itemCatalog === undefined
        ? {}
        : { itemCatalog: dependencies.itemCatalog }),
      metrics,
    });

  app.get('/healthz', (response) => {
    // Durante a drenagem o nó continua vivo para as sessões existentes, mas para de
    // aceitar novas — o balanceador precisa enxergar isso.
    response.writeStatus(acceptingNewSessions ? '200 OK' : '503 Service Unavailable');
    response.writeHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: acceptingNewSessions, role: 'game' }));
  });

  // Sem autenticação, como no `api`: `/metrics` não sai para a internet — quem o expõe é a
  // rede, e pôr credencial aqui daria a falsa impressão de que ele pode sair.
  app.get('/metrics', (response) => {
    response.onAborted(() => undefined);
    void metrics.registry.metrics().then((body) => {
      response.cork(() => {
        response.writeStatus('200 OK');
        response.writeHeader('content-type', metrics.registry.contentType);
        response.end(body);
      });
    }).catch(() => {
      response.cork(() => { response.writeStatus('500 Internal Server Error').end(); });
    });
  });

  app.ws<SocketData>('/*', {
    // Limites conservadores: cliente lento não pode fazer o nó crescer sem limite.
    maxPayloadLength: 64 * 1024,
    idleTimeout: 60,
    maxBackpressure: 1024 * 1024,
    // Ping de protocolo do próprio WebSocket, para o socket morto ser recolhido pelo
    // `idleTimeout`. O `ping` do nosso protocolo é outra coisa: serve para o CLIENTE medir
    // latência, e é respondido fora da fila de saída.
    sendPingsAutomatically: true,

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
      if (tickets === undefined || host === null) {
        // Fechado por padrão: sem ticket e sem hospedagem ninguém entra. Aberto seria
        // "qualquer um vira qualquer personagem", que é pior do que o socket não funcionar.
        response.writeStatus('503 Service Unavailable').end();
        return;
      }

      let aborted = false;
      response.onAborted(() => {
        aborted = true;
      });

      void (async () => {
        try {
          const claim = await tickets.consume(ticket, nodeId);
          let created = false;
          if (claim !== null) {
            ({ created } = await host.prepare(
              claim.characterId, claim.initialCharacter, claim.accountId,
            ));
          }
          // Cliente desistiu enquanto Redis/diretório respondiam. Tocar em `response`
          // depois do abort derruba o processo inteiro.
          if (aborted) {
            // A sessão já foi criada e registrada, e nenhum socket vai chegar para
            // desanexá-la depois. Sem isto ela fica hospedada para sempre, segurando um dos
            // dois slots da conta e impedindo até apagar o personagem. Só solta o que ESTA
            // chamada criou: uma reconexão que reencontrou a sessão não pode derrubá-la.
            if (claim !== null && created && host.viewersOf(claim.characterId) === 0) {
              await host.release(claim.characterId);
            }
            return;
          }
          response.cork(() => {
            if (claim === null) {
              response.writeStatus('401 Unauthorized').end();
              return;
            }
            response.upgrade<SocketData>(
              { accountId: claim.accountId, characterId: claim.characterId, viewer: null },
              key,
              protocol,
              extensions,
              context,
            );
          });
        } catch (error) {
          logger.error({ error }, 'Game handshake failed');
          if (aborted) return;
          response.cork(() => {
            if (!aborted) {
              response.writeStatus('503 Service Unavailable').end();
            }
          });
        }
      })();
    },

    open: (socket) => {
      if (host === null) return;
      const data = socket.getUserData();
      data.viewer = host.attach(socket, data.characterId);
    },

    message: (socket, message, isBinary) => {
      const data = socket.getUserData();
      const viewer = data.viewer;
      if (host === null || viewer === null) return;

      const decoded = isBinary ? decodeC2S(message) : null;
      if (decoded === null) {
        // Frame que não decodifica é cliente quebrado ou hostil. Fechar é mais honesto que
        // ignorar: ignorar deixa os dois lados achando que a conversa continua.
        logger.warn({ characterId: data.characterId }, 'Closing connection on invalid frame');
        viewer.close(1002, 'protocol error');
        return;
      }
      for (const one of decoded) host.handle(viewer, one);
    },

    close: (socket) => {
      if (host === null) return;
      const data = socket.getUserData();
      if (data.viewer === null) return;
      // O socket JÁ caiu: marcar sem tocar nele. A SESSÃO CONTINUA — ADR 0001 em uma linha.
      data.viewer.markClosed();
      host.detach(data.viewer);
      data.viewer = null;
    },
  });

  function closeListener(): void {
    if (listeningSocket === null) return;
    uWS.us_listen_socket_close(listeningSocket);
    listeningSocket = null;
  }

  return {
    name: 'game',
    host,
    stop() {
      acceptingNewSessions = false;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      host?.stop();
      closeListener();
      logger.warn({ nodeId }, 'Game stopped without draining');
    },
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

      host?.start();

      // O batimento é o que torna este nó VISÍVEL para o `api` emitir ticket. Sem ele o
      // processo sobe, aceita conexão e nunca recebe nenhuma — falha silenciosa clássica.
      const directory = dependencies.directory;
      if (directory !== undefined) {
        const beat = (): void => {
          void directory
            .heartbeat(nodeId, {
              sessions: host?.sessionCount ?? 0,
              url: configuration.GAME_PUBLIC_URL,
            })
            .catch((error: unknown) => logger.error({ error }, 'Heartbeat failed'));
        };
        beat();
        heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
      }
    },
    async drain() {
      // Ordem: parar de aceitar → snapshot final → encerrar creditando → avisar → sair.
      acceptingNewSessions = false;
      const sessions = host?.sessionCount ?? 0;
      logger.info({ sessions }, 'Game stopped accepting new sessions');

      const startedAtMs = performance.now();
      // Gravar ANTES de encerrar: se o processo morrer no meio da drenagem, o que sobra é um
      // snapshot retomável (FUN-28) em vez de uma sessão pela metade. O que drenar com
      // sucesso apaga o próprio snapshot logo em seguida — quem fica com ele é justamente
      // quem NÃO conseguiu creditar.
      await host?.saveAll();
      const ended = (await host?.drainAll('drain')) ?? 0;
      const elapsedMs = Math.round(performance.now() - startedAtMs);

      // O tempo aparece no log de propósito: é ele que decide o `terminationGracePeriod` do
      // orquestrador. Drenagem interrompida no meio é PIOR que drenagem nenhuma — metade
      // credita e metade some, e ninguém sabe qual metade.
      logger.info(
        { sessions, ended, elapsedMs, perSessionMs: ended > 0 ? elapsedMs / ended : 0 },
        'Game drained sessions crediting progress',
      );
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      host?.stop();
      closeListener();
      logger.info('Game stopped');
    },
  };
}
