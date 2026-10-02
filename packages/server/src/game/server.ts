// Processo `game` — stateful. Hospeda sessões e o WebSocket.
//
// A escolha do uWebSockets.js é pela CONTA DE CONEXÕES, não pela CPU: o gargalo projetado do
// sistema é quanta gente cabe conectada, e não quanto custa simular.
//
// O que este arquivo faz é a borda: handshake por ticket, decodificação de frame e ciclo de
// vida do processo. Quem hospeda sessão e visualizador é o `SessionHost`.

import uWS from 'uWebSockets.js';
import { decodeC2S, encodeS2C } from '@draconya/protocol';
import type { S2CProps } from '@draconya/protocol';
import type { Configuration } from '../config.js';
import type { Session, SessionSnapshot } from '@draconya/sim';
import type { SessionDirectory } from '../directory.js';
import type { SnapshotStore } from '../snapshots.js';
import type { ReceiptStore } from '../receipts.js';
import type { Logger } from '../log.js';
import type { Role } from '../role.js';
import type { TicketService } from '../tickets.js';
import {
  SessionHost, type PrepareResult, type SessionBuilder, type SessionFactory, type SessionHostOptions,
  type SessionRestorer,
} from './host.js';
import { GameMetrics } from './metrics.js';
import { assertSoleGameNode } from './open-world-guard.js';
import { Viewer } from './viewer.js';

export interface GameDependencies {
  readonly directory?: SessionDirectory;
  readonly tickets?: TicketService;
  readonly createSession?: SessionFactory;
  readonly contentVersion?: string;
  /** Constrói UM personagem para entrar numa sessão em curso (#402). */
  readonly createParticipant?: SessionHostOptions['createParticipant'];
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
  /**
   * Carrega uma configuração de bot JÁ PERSISTIDA (ADR 0014) — slot com referência morta
   * esvazia em vez de recusar a configuração inteira. Ver `SessionHostOptions`.
   */
  readonly loadBotConfig?: SessionHostOptions['loadBotConfig'];
  /** Registra a configuração aceita no Redis; jobs/api escrevem no Postgres (ADR 0028). */
  readonly saveBotConfig?: SessionHostOptions['saveBotConfig'];
  /** O catálogo de itens, para as regras de equipar (FUN-82). */
  readonly itemCatalog?: SessionHostOptions['itemCatalog'];
  /** O catálogo de munição abstrata, para `select-ammo` (#152). */
  readonly ammunitionCatalog?: SessionHostOptions['ammunitionCatalog'];
  /** O Treino (#631, ADR 0059): as regras do livro do offline training, para as intenções de Treino. */
  readonly training?: SessionHostOptions['training'];
  /** O catálogo dos 25 Charms, para `charm-unlock`/`charm-assign` (M39-02, #602). */
  readonly charmCatalog?: SessionHostOptions['charmCatalog'];
  /** A ficha de Bestiário de cada monstro, para a economia de Charms derivar pontos e completude. */
  readonly charmBestiaryEntries?: SessionHostOptions['charmBestiaryEntries'];
  /** O Hazard (multiplicadores e zonas), para `set-hazard-level` (M44-14, #632). */
  readonly hazard?: SessionHostOptions['hazard'];
  /** As sete bênçãos PvE, para `buy-blessing` (#570, ADR 0052). */
  readonly blessingCatalog?: SessionHostOptions['blessingCatalog'];
  /** O catálogo de magias, para `learn-spell` (#624, ADR 0058). */
  readonly spellCatalog?: SessionHostOptions['spellCatalog'];
  /** As vocações e o level da escolha (#154). */
  readonly vocations?: SessionHostOptions['vocations'];
  readonly vocationLevel?: SessionHostOptions['vocationLevel'];
  /** A tabela de progressão, para os tamanhos de container (#160). */
  readonly progression?: SessionHostOptions['progression'];
  /** O catálogo de monstros, para nome e outfit de quem nasce na hunt (FUN-103). */
  readonly monsterCatalog?: SessionHostOptions['monsterCatalog'];
  /** O outfit de todo jogador, até alguém escolher o seu (FUN-103). */
  readonly playerOutfitId?: SessionHostOptions['playerOutfitId'];
  /** A tabela de aparências, para o que o combate desenha (FUN-109). */
  readonly appearances?: SessionHostOptions['appearances'];
  /** O catálogo do que existe: hunts e vocabulário do bot (FUN-79, FUN-89). */
  readonly catalogue?: SessionHostOptions['catalogue'];
  /** O catálogo de skills (#340, SV-04). */
  readonly skillCatalog?: SessionHostOptions['skillCatalog'];
  /**
   * A porta do mundo para quem vem do repouso (#842, OW-21): a fila do mundo cheio. Só existe com `OPEN_WORLD`
   * ligado (`createSessionWiring`). Ver `SessionHostOptions.worldEntry`.
   */
  readonly worldEntry?: SessionHostOptions['worldEntry'];
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
  /**
   * O handshake foi aceito só para entregar a recusa do mundo cheio (OW-21): o socket abre, manda `world-full`
   * e fecha — nenhum visualizador é criado e nenhuma sessão é tocada. Ausente é o socket de sempre.
   */
  worldFull?: S2CProps<'world-full'>;
}

/**
 * O código com que o socket fecha depois do `world-full` (OW-21). Faixa de aplicação (4000–4999): o
 * cliente que só olha o código sabe que NÃO foi uma queda — a fila já tem o lugar dele, e quem cuida de
 * voltar é o tempo da mensagem, não o recuo de reconexão.
 */
const WORLD_FULL_CLOSE_CODE = 4001;

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
      ...(dependencies.createParticipant === undefined
        ? {}
        : { createParticipant: dependencies.createParticipant }),
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
      ...(dependencies.loadBotConfig === undefined
        ? {}
        : { loadBotConfig: dependencies.loadBotConfig }),
      ...(dependencies.saveBotConfig === undefined
        ? {}
        : { saveBotConfig: dependencies.saveBotConfig }),
      ...(dependencies.itemCatalog === undefined
        ? {}
        : { itemCatalog: dependencies.itemCatalog }),
      ...(dependencies.ammunitionCatalog === undefined
        ? {}
        : { ammunitionCatalog: dependencies.ammunitionCatalog }),
      ...(dependencies.training === undefined ? {} : { training: dependencies.training }),
      ...(dependencies.charmCatalog === undefined
        ? {}
        : { charmCatalog: dependencies.charmCatalog }),
      ...(dependencies.charmBestiaryEntries === undefined
        ? {}
        : { charmBestiaryEntries: dependencies.charmBestiaryEntries }),
      ...(dependencies.hazard === undefined ? {} : { hazard: dependencies.hazard }),
      ...(dependencies.blessingCatalog === undefined
        ? {}
        : { blessingCatalog: dependencies.blessingCatalog }),
      ...(dependencies.spellCatalog === undefined
        ? {}
        : { spellCatalog: dependencies.spellCatalog }),
      ...(dependencies.vocations === undefined ? {} : { vocations: dependencies.vocations }),
      ...(dependencies.vocationLevel === undefined ? {} : { vocationLevel: dependencies.vocationLevel }),
      ...(dependencies.progression === undefined ? {} : { progression: dependencies.progression }),
      ...(dependencies.monsterCatalog === undefined
        ? {}
        : { monsterCatalog: dependencies.monsterCatalog }),
      ...(dependencies.playerOutfitId === undefined
        ? {}
        : { playerOutfitId: dependencies.playerOutfitId }),
      ...(dependencies.appearances === undefined
        ? {}
        : { appearances: dependencies.appearances }),
      ...(dependencies.catalogue === undefined
        ? {}
        : { catalogue: dependencies.catalogue }),
      ...(dependencies.skillCatalog === undefined
        ? {}
        : { skillCatalog: dependencies.skillCatalog }),
      // A fila do mundo cheio (#842, OW-21): só com a flag ligada.
      ...(dependencies.worldEntry === undefined ? {} : { worldEntry: dependencies.worldEntry }),
      // O mundo aberto (#836, OW-15): com a flag ligada todo extrato leva a posição, a cidade, a
      // vida, a mana e as condições do personagem.
      openWorld: configuration.OPEN_WORLD,
      // A cadência do lote de checkpoint do mundo (#837, OW-16): sem efeito até existir uma sessão
      // `checkpointed`, que só nasce com a flag ligada.
      worldCheckpointMs: configuration.WORLD_CHECKPOINT_MS,
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
          let refused: PrepareResult['refused'];
          let worldFull: PrepareResult['worldFull'];
          if (claim !== null) {
            const prepared = await host.prepare(
              claim.characterId, claim.initialCharacter, claim.accountId, claim.party, claim.entry,
            );
            created = prepared.created;
            refused = prepared.refused;
            worldFull = prepared.worldFull;
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
            // O mundo cheio (OW-21, ADR 0060 d.2b): o socket ABRE — o cliente precisa da mensagem, e um
            // `409` cru não leva a posição na fila — só para receber `world-full` e fechar. A hunt idle está ao
            // alcance enquanto este nó aceita sessões novas e o catálogo tem hunt.
            if (refused === 'world-full' && worldFull !== undefined) {
              response.upgrade<SocketData>(
                {
                  accountId: claim.accountId, characterId: claim.characterId, viewer: null,
                  worldFull: {
                    position: worldFull.position,
                    retryAfterMs: worldFull.retryAfterMs,
                    huntAvailable: acceptingNewSessions && host.offersHunts,
                  },
                },
                key,
                protocol,
                extensions,
                context,
              );
              return;
            }
            // A recusa da admissão em curso (#402): fecha com o motivo, sem `upgrade`. É o
            // mesmo desfecho do `onEnter` do #397, e o cliente tenta de novo pelo `/join`.
            if (refused !== undefined) {
              const status = {
                'party-full': '409 Conflict',
                'content-version': '409 Conflict',
                'session-not-here': '503 Service Unavailable',
                // O personagem saía do mundo quando o ticket chegou (#840, OW-19): o cliente reconecta.
                'leaving': '503 Service Unavailable',
                // A hunt direta que o ticket pediu não existe mais neste nó (OW-21): o pedido é que está
                // errado, e tentar de novo com o MESMO ticket — já queimado — não adianta.
                'hunt-unavailable': '409 Conflict',
                // `world-full` sem a posição não acontece (o hospedeiro sempre a leva); se acontecer, o
                // cliente vê o nó indisponível e tenta de novo, que é o que a fila quer dele.
                'world-full': '503 Service Unavailable',
                // A largada de uma party em que um membro do mundo está em luta (OW-20): nada foi movido, e o
                // cliente do líder mostra o motivo; tentar de novo vale quando a luta acabar.
                'member-in-fight': '409 Conflict',
              }[refused];
              response.writeStatus(status).end(refused);
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
          logger.error({ err: error }, 'Game handshake failed');
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
      // O mundo cheio (OW-21): entrega a posição na fila e fecha. Sem visualizador, sem sessão — o personagem
      // não está em lugar nenhum, e `close` abaixo não tem o que desanexar.
      if (data.worldFull !== undefined) {
        socket.send(encodeS2C({ type: 'world-full', ...data.worldFull }), true);
        socket.end(WORLD_FULL_CLOSE_CODE, 'world-full');
        return;
      }
      try {
        data.viewer = host.attach(socket, data.characterId);
      } catch (error) {
        // O personagem deixou de estar aqui entre o `prepare` e o `open` — saiu do mundo (o x-log, o
        // `logout`), ou a sessão foi solta. Uma exceção que escapa de um handler do uWebSockets é um
        // `uncaughtException`, e o `main.ts` o transforma em `process.exit(1)`: com o mundo num processo
        // só (ADR 0060 d.2c), o descuido de uma reconexão derrubaria todo jogador. Fecha este socket, e
        // a reconexão do cliente pede outro ticket.
        logger.warn({ err: error, characterId: data.characterId }, 'Closing a connection that could not attach');
        socket.end(1013, 'try again later');
      }
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
      // O mundo aberto vive numa sessão num processo só (invariante 9, ADR 0060 d.2c): com a flag
      // ligada, o nó se recusa a subir se há outro `game` vivo — ANTES de abrir a porta, e antes de
      // bater o coração, para o `api` nunca emitir ticket para um nó que vai cair. A trava de verdade,
      // que deixa mais de um nó, é a `world:{id}:owner` da OW-59.
      if (configuration.OPEN_WORLD && dependencies.directory !== undefined) {
        await assertSoleGameNode(dependencies.directory, nodeId);
      }
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
              players: host?.connectedCharacterCount ?? 0,
            })
            .catch((error: unknown) => logger.error({ err: error }, 'Heartbeat failed'));
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
