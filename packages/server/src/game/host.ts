// Hospedagem de sessões num nó de jogo (FUN-13).
//
// O modelo inteiro está na relação entre estas duas coisas:
//
//   sessão      vive aqui, avança sozinha, sobrevive ao socket e ao restart
//   visualizador  um socket olhando uma sessão; entra e sai sem consequência nenhuma
//
// Se desanexar encerrar, pausar, creditar ou zerar qualquer coisa, o modelo está errado —
// é o ADR 0001 em uma frase, e é o teste que define esta issue.
//
// A `Session` do `sim` guarda só IDS de visualizador, porque ela não pode conhecer socket
// (invariante 1). Os objetos ficam aqui. A ponte entre os dois é `session.attached`, que é o
// que decide a taxa de tick — a sessão sabe SE alguém olha, nunca QUEM.

import { performance } from 'node:perf_hooks';
import type { EndReason, Receipt, Session, SessionSnapshot, SessionType } from '@draconya/sim';
import type { C2SMessage, S2CMessage } from '@draconya/protocol';
import type { SessionDirectory } from '../directory.js';
import type { SnapshotStore } from '../snapshots.js';
import type { ReceiptStore } from '../receipts.js';
import type { Logger } from '../log.js';
import type { InitialCharacter } from '../tickets.js';
import { Viewer, type ViewerOptions, type ViewerSocket } from './viewer.js';
import { REFUSAL_TEXT, TransitionError, refuseTransition } from './transitions.js';
import { TICK_LAG_BUDGET_MS, type GameMetrics } from './metrics.js';

/** Cria a sessão de um personagem que ainda não tem uma. */
export type SessionFactory = (characterId: string, initialCharacter?: InitialCharacter) => Session;

/** Reconstrói uma sessão a partir de um snapshot. `null` = não dá para retomar (FUN-28). */
export type SessionRestorer = (snapshot: SessionSnapshot) => Session | null;

/** Para onde o personagem quer ir. `huntId` e `difficulty` só valem para `to: 'hunt'`. */
export interface TransitionRequest {
  readonly to: SessionType;
  readonly huntId?: string;
  readonly difficulty?: string;
}

/**
 * Constrói a sessão de destino de uma transição (FUN-30, FUN-38).
 *
 * `null` significa "não sei construir essa": a transição é recusada, e no caminho da morte a
 * sessão é solta. É a MESMA costura para a morte que devolve à cidade e para o jogador que
 * entra numa hunt — dois caminhos separados dariam duas chances de o estado exclusivo furar,
 * e é o estado exclusivo que dispensa lock sobre o gold (invariante 9).
 */
export type SessionBuilder = (request: TransitionRequest, from: Session) => Session | null;

export interface SessionHostOptions {
  readonly nodeId: string;
  readonly contentVersion: string;
  readonly createSession: SessionFactory;
  readonly logger: Logger;
  readonly directory?: SessionDirectory;
  /** Onde as sessões são guardadas para sobreviver à queda do processo (FUN-28). */
  readonly snapshots?: SnapshotStore;
  /** Onde o extrato de uma sessão encerrada espera virar linha de ledger (FUN-29). */
  readonly receipts?: ReceiptStore;
  readonly restoreSession?: SessionRestorer;
  /** Constrói a sessão de destino de uma transição — a PZ na morte, a hunt no menu. */
  readonly buildSession?: SessionBuilder;
  readonly viewer?: ViewerOptions;
  /** Métricas do nó (FUN-47). Ausente: o host roda igual, só não conta nada. */
  readonly metrics?: GameMetrics;
  /** Relógio monotônico da simulação. Injetável para o teste não depender de tempo real. */
  readonly now?: () => number;
}

interface HostedSession {
  readonly session: Session;
  readonly viewers: Set<Viewer>;
  /**
   * Desde quando ninguém olha, no relógio monotônico. `null` = tem visualizador.
   *
   * Só importa para sessão de REPOUSO — a que é orientada a evento. Uma hunt desanexada nunca
   * é recolhida por isto, e é o ADR 0001 em uma linha.
   */
  restingSince: number | null;
  /**
   * Quando esta sessão foi avançada pela última vez, no relógio monotônico DESTE processo.
   *
   * O relógio do processo mora aqui desde a FUN-68, e não mais dentro da `Session`: lá dentro
   * o tempo é lógico, começa em zero e é da sessão. É o que aposentou o `rebaseClock` — uma
   * sessão retomada de snapshot nasce com esta marca no agora do processo novo, então o
   * primeiro avanço dela é de milissegundos, e o intervalo em que o nó esteve fora nunca
   * chega a ser oferecido à simulação (ADR 0018).
   */
  lastAdvancedAtMs: number;
  /**
   * O extrato desta sessão já virou crédito? A drenagem grava e DEPOIS solta, e sem esta
   * marca o `release` gravaria de novo com um `seq` novo — que a chave única do ledger não
   * teria como recusar, e o jogador receberia o mesmo gold duas vezes.
   */
  credited: boolean;
  /**
   * `characterId` (UUID) → id numérico de criatura na instância.
   *
   * O protocolo numera criatura com `number` porque isso vai no caminho quente: um id de 4
   * bytes por `creature-move`, dezenas de vezes por segundo, contra 36 de um UUID. A tradução
   * é do servidor — o `sim` não conhece protocolo, e o cliente não pode inventar número.
   */
  readonly creatureIds: Map<string, number>;
}

/** `created` diz se ESTA chamada trouxe a sessão à existência — ver `prepare`. */
export interface PrepareResult {
  readonly created: boolean;
}

/**
 * Teto de taxa do laço: 10 Hz. Uma sessão pode pedir menos — a política por tipo e por
 * presença de visualizador é do próprio ruleset (ADR 0003) e é lida a cada ciclo.
 */
const CYCLE_MS = 100;
/** Um terço do lease do diretório, pela mesma razão do batimento. */
const RENEW_INTERVAL_MS = 10_000;
/**
 * Cada quanto a sessão é gravada.
 *
 * É exatamente o que se perde numa queda: dez segundos de XP. Aceitável para progresso,
 * INACEITÁVEL para transação econômica — por isso o ledger é escrito à parte (invariante 10),
 * e não depende deste intervalo.
 */
const SNAPSHOT_INTERVAL_MS = 10_000;

/**
 * Quanto tempo uma sessão de REPOUSO fica de pé sem ninguém olhando (FUN-52).
 *
 * Cinco minutos é escolhido pelos dois lados do erro. Curto demais e recarregar a página vira
 * sessão nova a cada vez; longo demais e quem fechou o navegador segura um dos dois slots da
 * conta por horas — que era o defeito.
 *
 * Não vale para hunt: uma sessão que rende nunca é recolhida por ausência (ADR 0001).
 */
const RESTING_GRACE_MS = 5 * 60_000;

/** Intervalo mínimo entre dois avisos de atraso. Ver `#warnLag`. */
const LAG_WARNING_INTERVAL_MS = 60_000;

export class SessionHost {
  readonly #options: SessionHostOptions;
  readonly #logger: Logger;

  /** Por sessão. O índice por personagem existe porque uma sessão terá vários (guild war). */
  readonly #sessions = new Map<string, HostedSession>();
  readonly #sessionIdByCharacter = new Map<string, string>();
  readonly #accountIdByCharacter = new Map<string, string>();
  readonly #preparations = new Map<string, Promise<void>>();
  /** Transições em voo, por personagem. Ver `transition`. */
  readonly #transitions = new Map<string, Promise<void>>();
  #lastLagWarningMs = Number.NEGATIVE_INFINITY;
  /** Quanto tempo a retomada pulou, esperando o primeiro visualizador para ser contado. */
  readonly #resumedGapMs = new Map<string, number>();

  #cycleTimer: NodeJS.Timeout | null = null;
  #renewTimer: NodeJS.Timeout | null = null;
  #snapshotTimer: NodeJS.Timeout | null = null;

  constructor(options: SessionHostOptions) {
    this.#options = options;
    this.#logger = options.logger;
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  get viewerCount(): number {
    let total = 0;
    for (const hosted of this.#sessions.values()) total += hosted.viewers.size;
    return total;
  }

  sessionFor(characterId: string): Session | undefined {
    const sessionId = this.#sessionIdByCharacter.get(characterId);
    return sessionId === undefined ? undefined : this.#sessions.get(sessionId)?.session;
  }

  viewersOf(characterId: string): number {
    const sessionId = this.#sessionIdByCharacter.get(characterId);
    return sessionId === undefined ? 0 : (this.#sessions.get(sessionId)?.viewers.size ?? 0);
  }

  /**
   * Cria e registra a sessão antes de o handshake aceitar o socket. Chamadas simultâneas
   * compartilham a mesma promessa, portanto nunca criam duas sessões locais do personagem.
   */
  async prepare(
    characterId: string,
    initialCharacter?: InitialCharacter,
    accountId?: string,
  ): Promise<PrepareResult> {
    const startedAt = performance.now();
    try {
      return await this.#prepare(characterId, initialCharacter, accountId);
    } finally {
      // O que o jogador espera ao reconectar: resolver o diretório, carregar o snapshot e
      // hospedar. É o número que o teste de carga cobra, e ele NÃO inclui o tempo de rede —
      // essa metade é do cliente, e medir as duas juntas aqui esconderia qual delas piorou.
      this.#options.metrics?.observeReattach(performance.now() - startedAt);
    }
  }

  async #prepare(
    characterId: string,
    initialCharacter?: InitialCharacter,
    accountId?: string,
  ): Promise<PrepareResult> {
    const existing = this.sessionFor(characterId);
    if (existing !== undefined) {
      await this.#register(characterId, existing, accountId);
      return { created: false };
    }

    const pending = this.#preparations.get(characterId);
    if (pending !== undefined) {
      await pending;
      // Quem esperou a preparação de outro NÃO criou nada: soltar seria derrubar a sessão
      // que o outro handshake está prestes a usar.
      return { created: false };
    }

    const preparation = this.#createAndRegister(characterId, initialCharacter, accountId);
    this.#preparations.set(characterId, preparation);
    try {
      await preparation;
    } finally {
      if (this.#preparations.get(characterId) === preparation) {
        this.#preparations.delete(characterId);
      }
    }
    return { created: true };
  }

  /** Liga um socket a uma sessão já preparada. */
  attach(socket: ViewerSocket, characterId: string): Viewer {
    let hosted = this.#hostedSession(characterId);
    // Mantém o host sem diretório útil em testes e em consumidores locais. Em produção,
    // `prepare` é obrigatório porque o registro precisa terminar antes do upgrade.
    if (hosted === undefined && this.#options.directory === undefined) {
      this.#createLocal(characterId, this.#options.createSession(characterId));
      hosted = this.#hostedSession(characterId);
    }
    if (hosted === undefined) throw new Error(`session for ${characterId} was not prepared`);
    const metrics = this.#options.metrics;
    const viewer = new Viewer(socket, characterId, {
      ...this.#options.viewer,
      ...(metrics === undefined
        ? {}
        : { onFrame: (messages, bytes) => { metrics.observeFrame(messages, bytes); } }),
    });
    hosted.viewers.add(viewer);
    hosted.session.attach(viewer.id);
    hosted.restingSince = null;

    viewer.sendNow({
      type: 'welcome',
      characterId,
      contentVersion: this.#options.contentVersion,
    });

    // O jogador precisa SABER que houve retomada e o que se perdeu. Silenciar aqui é como o
    // modo idle perde a confiança de quem joga: o extrato não fecha e ninguém explica.
    const gapMs = this.#resumedGapMs.get(characterId);
    if (gapMs !== undefined) {
      this.#resumedGapMs.delete(characterId);
      const minutes = Math.round(gapMs / 60_000);
      viewer.send({
        type: 'system-message',
        level: 'warning',
        text: minutes > 0
          ? `Sessão retomada após queda do servidor. Cerca de ${minutes} min de progresso `
            + 'não foram simulados.'
          : 'Sessão retomada após queda do servidor, sem perda perceptível.',
      });
    }
    this.#logger.debug(
      { characterId, sessionId: hosted.session.id, viewers: hosted.viewers.size },
      'Viewer attached',
    );
    return viewer;
  }

  /**
   * Tira o visualizador da lista. NÃO encerra a sessão, não a pausa e não credita nada: a
   * sessão fica exatamente como estava, só que sem ninguém olhando.
   */
  detach(viewer: Viewer): void {
    const sessionId = this.#sessionIdByCharacter.get(viewer.characterId);
    const hosted = sessionId === undefined ? undefined : this.#sessions.get(sessionId);
    if (hosted === undefined) return;

    hosted.viewers.delete(viewer);
    hosted.session.detach(viewer.id);
    if (hosted.viewers.size === 0) hosted.restingSince = this.#now();
    this.#logger.debug(
      { characterId: viewer.characterId, sessionId, viewers: hosted.viewers.size },
      'Viewer detached',
    );
    // A sessão FICA, mesmo sem ninguém olhando — é o ADR 0001, e há teste de integração
    // exigindo que uma reconexão reencontre a MESMA sessão.
    //
    // O que muda com a FUN-52 é só a sessão de REPOUSO: a de cidade, orientada a evento, é
    // recolhida depois de um prazo de carência (ver `#collectResting`). Uma hunt desanexada
    // nunca é — ela é o modo padrão do jogo.
  }

  async #logout(characterId: string): Promise<void> {
    try {
      await this.release(characterId, 1000, 'logout');
    } catch (error) {
      this.#logger.error({ error, characterId }, 'Failed to log the character out');
    }
  }

  /**
   * Tira a sessão deste nó e devolve o slot da conta. Encerra antes de soltar, para o
   * ruleset ter a chance de creditar o que for dele.
   *
   * Fecha TODOS os visualizadores do personagem, não só quem pediu: sair do jogo é do
   * personagem, não da aba. Deixar a outra aba aberta olhando uma sessão que já não existe
   * seria uma tela que não atualiza mais e não diz por quê.
   */
  async release(characterId: string, closeCode?: number, closeReason?: string): Promise<void> {
    const hosted = this.#hostedSession(characterId);
    if (hosted === undefined) return;
    const accountId = this.#accountIdByCharacter.get(characterId);

    if (closeCode !== undefined) {
      for (const viewer of [...hosted.viewers]) viewer.close(closeCode, closeReason ?? '');
    }
    hosted.viewers.clear();

    if (hosted.session.ended === null) hosted.session.end('manual-exit');
    // Creditar ANTES de soltar. Sem isto, sair do jogo dentro de uma hunt jogaria fora a XP
    // da sessão inteira: desde a FUN-54 o extrato é o único caminho até o banco, e logo
    // abaixo o snapshot — a outra cópia do progresso — é apagado.
    const receipt = hosted.session.receipt();
    if (receipt !== null) await this.#saveReceipt(characterId, hosted, receipt);

    this.#sessions.delete(hosted.session.id);
    this.#sessionIdByCharacter.delete(characterId);
    this.#accountIdByCharacter.delete(characterId);

    // A sessão ACABOU: deixar o snapshot faria a próxima conexão ressuscitar uma sessão
    // encerrada, com os agregados de antes.
    await this.#options.snapshots?.remove(characterId).catch(() => undefined);

    const directory = this.#options.directory;
    if (directory === undefined) return;
    try {
      await directory.release(characterId);
      if (accountId !== undefined) await directory.releaseSlot(accountId, characterId);
    } catch (error) {
      // Falhar aqui deixa o slot preso até o lease expirar, que é ruim mas se resolve
      // sozinho. Silenciar seria pior: é a única pista de por que uma conta ficou sem slot.
      this.#logger.error({ error, characterId }, 'Failed to release session from the directory');
    }
    this.#logger.info({ characterId, sessionId: hosted.session.id }, 'Session released');
  }

  /** Ações do jogador são tratadas NA CHEGADA, não enfileiradas para o tick (ver AGENTS.md). */
  handle(viewer: Viewer, message: C2SMessage): void {
    switch (message.type) {
      case 'ping':
        // Fora da fila: `pong` que espera o ciclo mede a fila, não a rede.
        viewer.sendNow({ type: 'pong', t: message.t });
        return;
      case 'session-attach': {
        const hosted = this.#hostedSession(viewer.characterId);
        if (hosted === undefined) return;
        // ENFILEIRADO, nunca `sendNow`. A troca de "estado completo" para "só deltas" precisa
        // ser atômica: mandar o estado na frente da fila o colocaria DEPOIS de deltas que já
        // estavam esperando, e o cliente aplicaria um passo antigo por cima do estado atual.
        // A própria fila é a atomicidade — basta não furá-la.
        viewer.send(this.#sessionState(hosted, viewer.characterId));
        return;
      }
      case 'enter-hunt':
        // INTENÇÃO, nunca resultado (invariante 4): o cliente diz qual hunt e qual
        // dificuldade, e quem decide se cabe, cria a instância e credita é o servidor.
        void this.#requestTransition(viewer, {
          to: 'hunt', huntId: message.huntId, difficulty: message.difficulty,
        });
        return;
      case 'leave-hunt':
        // Sair é voltar para a cidade, não ficar sem sessão: todo personagem está em
        // exatamente uma (invariante 8).
        void this.#requestTransition(viewer, { to: 'city' });
        return;
      case 'logout':
        // Sair do jogo ENCERRA a sessão e devolve o slot; fechar o socket não.
        //
        // A distinção é a que o ADR 0001 faz: desconectar não é sair. Uma hunt precisa
        // sobreviver ao navegador fechado, e é por isso que o `detach` não encerra nada. Mas
        // um `logout` explícito é o jogador dizendo que terminou — e enquanto ele não
        // encerrava nada, o slot de personagem ativo não tinha NENHUMA forma de voltar
        // (FUN-52): dois personagens que já tivessem conectado esgotavam o teto até o
        // processo reiniciar, e nem apagar o personagem funcionava.
        void this.#logout(viewer.characterId);
        return;
      default:
        // walk, walk-to, say, client-ready e authenticate ainda não têm tratamento. Ignorar
        // em silêncio é melhor que responder errado.
        this.#logger.debug({ type: message.type }, 'Message not handled yet');
    }
  }

  /**
   * Executa a transição pedida pelo jogador e conta o que aconteceu.
   *
   * A recusa vira MENSAGEM, e é o produto: "você não pode fazer isso" é o texto que faz
   * alguém achar que o jogo travou. Cada recusa diz o que fazer em seguida.
   */
  async #requestTransition(viewer: Viewer, request: TransitionRequest): Promise<void> {
    try {
      await this.transition(viewer.characterId, request);
    } catch (error) {
      if (error instanceof TransitionError) {
        viewer.send({
          type: 'system-message', level: 'warning', text: REFUSAL_TEXT[error.refusal],
        });
        return;
      }
      // Falha inesperada: o personagem continua onde estava, que é o estado seguro.
      this.#logger.error(
        { error, characterId: viewer.characterId, to: request.to },
        'Transition failed',
      );
      viewer.send({
        type: 'system-message', level: 'error', text: 'Não foi possível mudar de atividade.',
      });
    }
  }

  /**
   * Um ciclo: avança quem tem tick a dever e manda um frame por visualizador.
   *
   * A taxa é perguntada ao ruleset A CADA ciclo porque ela muda com a presença de
   * visualizador — anexar acelera, desanexar desacelera, e nada disso altera o resultado
   * (invariante 2).
   */
  cycle(nowMs: number = this.#now()): void {
    for (const hosted of [...this.#sessions.values()]) {
      const hz = hosted.session.currentHz();
      // `0` é orientada a evento: cidade e treino não têm laço nenhum.
      if (hz <= 0) {
        this.#collectResting(hosted, nowMs);
        continue;
      }
      if (hosted.session.ended !== null) continue;
      const periodMs = 1000 / hz;
      // Contra a marca DESTE processo, e não contra o relógio da sessão: desde a FUN-68 o
      // tempo lá dentro é lógico, começa em zero, e comparar os dois compararia grandezas
      // diferentes — uma hunt com dez minutos de relógio lógico pareceria dez minutos
      // atrasada no primeiro ciclo depois de retomada.
      const overdueMs = nowMs - hosted.lastAdvancedAtMs;
      if (overdueMs < periodMs) continue;
      hosted.lastAdvancedAtMs = nowMs;
      const startedAt = this.#options.metrics === undefined ? 0 : performance.now();
      try {
        hosted.session.advanceBy(overdueMs);
      } catch (error) {
        // Uma sessão que explode não pode derrubar as outras do nó.
        this.#logger.error({ error, sessionId: hosted.session.id }, 'Session tick failed');
      }
      // O ATRASO é quanto o tick passou do período que ele mesmo pediu, não o intervalo. Um
      // tick de 1 Hz que roda a cada 1000 ms está no prazo; o mesmo intervalo num tick de
      // 10 Hz é 900 ms de atraso, e é essa diferença que diz que o nó saturou.
      const lagMs = Math.max(0, overdueMs - periodMs);
      this.#options.metrics?.observeTick(
        hosted.session.ruleset.type,
        (performance.now() - startedAt) * 1000,
        lagMs,
      );
      // O alerta que a issue pede, no único lugar onde este nó consegue falar hoje. Um pico
      // isolado não acorda ninguém — só o primeiro de uma rajada, para o log não virar a
      // própria causa do atraso quando o nó satura de verdade.
      if (lagMs > TICK_LAG_BUDGET_MS) this.#warnLag(hosted.session.ruleset.type, lagMs, nowMs);
      // A sessão pode ter acabado DENTRO do tick — a morte é o caso (§26.1), e ela acontece
      // com o jogador ausente na maior parte das vezes. Se a sucessão dependesse de alguém
      // estar olhando, o invariante 3 estaria quebrado.
      if (hosted.session.ended !== null) void this.#succeed(hosted);
    }
    this.flush();
    this.#observeSessions();
  }

  /**
   * Um aviso por minuto, no máximo. Um nó saturado atrasa TODAS as sessões ao mesmo tempo, e
   * uma linha de log por sessão por ciclo transformaria o sintoma em causa.
   */
  #warnLag(type: SessionType, lagMs: number, nowMs: number): void {
    if (nowMs - this.#lastLagWarningMs < LAG_WARNING_INTERVAL_MS) return;
    this.#lastLagWarningMs = nowMs;
    this.#logger.warn(
      { type, lagMs: Math.round(lagMs), budgetMs: TICK_LAG_BUDGET_MS },
      'Tick ran past its budget; the node is saturating',
    );
  }

  /**
   * Recontagem por ciclo, não por sessão: um contador incremental espalhado por `attach`,
   * `detach`, `release` e `#replace` erra na primeira aresta que alguém esquecer, e erra
   * DEVAGAR — o painel vai ficando errado sem nada quebrar.
   */
  #observeSessions(): void {
    const metrics = this.#options.metrics;
    if (metrics === undefined) return;

    const counts = new Map<string, number>();
    for (const hosted of this.#sessions.values()) {
      const key = `${hosted.session.ruleset.type}|${hosted.viewers.size > 0}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    metrics.observeSessions(counts);

    const perAccount = new Map<string, number>();
    for (const accountId of this.#accountIdByCharacter.values()) {
      perAccount.set(accountId, (perAccount.get(accountId) ?? 0) + 1);
    }
    metrics.observeSlots(perAccount.size === 0 ? 0 : Math.max(...perAccount.values()));
  }

  /**
   * A sessão acabou sozinha: credita, avisa, e põe o personagem na próxima (FUN-38).
   *
   * A ORDEM é o assunto todo, e cada troca tem uma consequência:
   *
   *   1. o extrato é gravado ANTES de qualquer aviso — morrer e o processo cair em seguida
   *      deixa o crédito no Redis esperando o `jobs`, que é a metade certa de perder;
   *   2. o `session-ended` sai antes do estado novo, senão o jogador vê a Cidade aparecer e
   *      só depois descobre que morreu;
   *   3. a sessão nova é registrada no diretório ANTES de substituir a local — registrar
   *      depois deixaria o personagem apontando para uma sessão que este nó já esqueceu;
   *   4. a cura vem com a Cidade, e a Cidade vem DEPOIS do encerramento. Restaurar HP antes
   *      de encerrar gravaria no extrato uma sessão que "terminou com vida cheia", o que
   *      estraga a tela de retorno e o analisador.
   */
  async #succeed(hosted: HostedSession): Promise<void> {
    const characters = this.#charactersOf(hosted.session.id);
    const characterId = characters[0];
    if (characterId === undefined) return;
    if (characters.length > 1) {
      // Party divide uma sessão, e um extrato por personagem é decisão de produto que ainda
      // não foi tomada. Creditar o mesmo agregado N vezes seria pior que não creditar.
      this.#logger.error(
        { sessionId: hosted.session.id, characters: characters.length },
        'Cannot succeed a session shared by more than one character',
      );
      return;
    }
    const receipt = hosted.session.receipt();
    if (receipt === null) return;

    try {
      await this.#saveReceipt(characterId, hosted, receipt);
      for (const viewer of hosted.viewers) {
        viewer.send({
          type: 'session-ended',
          reason: receipt.reason,
          aggregates: receipt.aggregates,
          notableEvents: receipt.notableEvents.map((event) => ({ ...event })),
        });
      }

      // Toda sessão que acaba sozinha devolve o personagem à Cidade (§6): "a hunt acabou"
      // nunca pode significar "ficou sem sessão" (invariante 8).
      const next = this.#options.buildSession?.({ to: 'city' }, hosted.session) ?? null;
      if (next === null) {
        await this.release(characterId, 1000, receipt.reason);
        return;
      }
      await this.#replace(characterId, hosted, next);
    } catch (error) {
      // Falhar aqui deixa o personagem numa sessão encerrada, que o ciclo ignora — ruim, e
      // recuperável na próxima conexão. Soltar no meio de uma falha seria pior: sem saber em
      // que ponto parou, soltar pode significar perder o crédito que talvez tenha gravado.
      this.#logger.error(
        { error, characterId, sessionId: hosted.session.id },
        'Failed to move the character to the next session',
      );
    }
  }

  /**
   * Muda o personagem de atividade (FUN-30, §6).
   *
   * Lança `TransitionError` quando a transição não é válida — e a recusa é o produto, não um
   * detalhe: "você não pode fazer isso" é a mensagem que faz alguém achar que o jogo travou.
   *
   * A ORDEM é a que falha seguro. A troca no diretório é ATÔMICA (`succeed`), então não
   * existe o instante em que o personagem está em duas sessões nem o instante em que ele não
   * está em nenhuma — que é o requisito difícil desta issue, e a razão de não haver aqui um
   * "reservar depois liberar" em dois passos.
   */
  async transition(characterId: string, request: TransitionRequest): Promise<void> {
    const hosted = this.#hostedSession(characterId);
    if (hosted === undefined) throw new Error(`character ${characterId} has no session here`);

    const refusal = refuseTransition(hosted.session.ruleset.type, request.to);
    if (refusal !== null) throw refusal;

    // Duas transições disputadas: exatamente UMA vence, e a outra sabe que perdeu.
    //
    // Sem esta trava as duas leriam a mesma sessão de origem, e a segunda tentaria trocar um
    // registro de diretório que a primeira já trocou — a CAS recusaria, e o caminho de recusa
    // SOLTA o personagem. Perder a corrida derrubaria o jogador do jogo.
    if (this.#transitions.has(characterId)) {
      throw new TransitionError(
        'already-transitioning', `uma transição de ${characterId} já está em andamento`,
      );
    }

    const running = this.#runTransition(characterId, hosted, request);
    this.#transitions.set(characterId, running);
    try {
      await running;
    } finally {
      if (this.#transitions.get(characterId) === running) this.#transitions.delete(characterId);
    }
  }

  async #runTransition(
    characterId: string,
    hosted: HostedSession,
    request: TransitionRequest,
  ): Promise<void> {
    // Construir ANTES de encerrar: se o destino não existe — hunt que saiu do conteúdo,
    // dificuldade que a hunt não define — o personagem fica exatamente onde estava, em vez de
    // ficar sem sessão porque a antiga já tinha sido fechada.
    const next = this.#options.buildSession?.(request, hosted.session) ?? null;
    if (next === null) {
      throw new TransitionError(
        'unknown-destination', `este servidor não constrói uma sessão de "${request.to}"`,
      );
    }

    const receipt = hosted.session.ended === null
      ? hosted.session.end('manual-exit')
      : hosted.session.receipt();
    if (receipt !== null) {
      await this.#saveReceipt(characterId, hosted, receipt);
      for (const viewer of hosted.viewers) {
        viewer.send({
          type: 'session-ended',
          reason: receipt.reason,
          aggregates: receipt.aggregates,
          notableEvents: receipt.notableEvents.map((event) => ({ ...event })),
        });
      }
    }
    await this.#replace(characterId, hosted, next);
  }

  /** Troca a sessão do personagem por outra, no diretório e aqui dentro. */
  async #replace(characterId: string, hosted: HostedSession, next: Session): Promise<void> {
    const accountId = this.#accountIdByCharacter.get(characterId);
    const directory = this.#options.directory;
    if (directory !== undefined && accountId !== undefined) {
      const moved = await directory.succeed(
        characterId,
        accountId,
        { sessionId: hosted.session.id, nodeId: this.#options.nodeId,
          type: hosted.session.ruleset.type },
        { sessionId: next.id, nodeId: this.#options.nodeId, type: next.ruleset.type },
      );
      // O registro não é mais nosso: outro nó assumiu, ou o lease expirou. Insistir seria
      // escrever por cima de um dono que já não somos.
      if (!moved) {
        this.#logger.warn({ characterId }, 'Directory entry changed hands; releasing instead');
        await this.release(characterId, 1000, 'session-moved');
        return;
      }
    }

    const successor: HostedSession = {
      session: next, viewers: new Set(), creatureIds: new Map(),
      restingSince: hosted.viewers.size > 0 ? null : this.#now(),
      lastAdvancedAtMs: this.#now(),
      credited: false,
    };
    this.#sessions.delete(hosted.session.id);
    this.#sessions.set(next.id, successor);
    this.#sessionIdByCharacter.set(characterId, next.id);

    // Os visualizadores acompanham o PERSONAGEM, não a sessão. Fechar o socket porque a hunt
    // acabou faria quem estava assistindo levar uma desconexão em vez de ver a volta à cidade.
    for (const viewer of hosted.viewers) {
      successor.viewers.add(viewer);
      next.attach(viewer.id);
      viewer.send(this.#sessionState(successor, characterId));
    }
    hosted.viewers.clear();

    // A morte é MARCO de snapshot (FUN-27). Perder a transição por estar entre dois
    // intervalos é o pior caso: o jogador volta vivo, na hunt, e a penalidade aparece do nada
    // um pouco depois.
    const snapshots = this.#options.snapshots;
    if (snapshots !== undefined && accountId !== undefined) {
      await snapshots.save(characterId, accountId, this.#options.nodeId, next.snapshot());
    }
    this.#logger.info(
      { characterId, from: hosted.session.id, to: next.id, type: next.ruleset.type },
      'Character moved to the next session',
    );
  }

  /** Quem está nesta sessão. Busca linear num mapa pequeno, e só quando uma sessão acaba. */
  #charactersOf(sessionId: string): string[] {
    const found: string[] = [];
    for (const [characterId, id] of this.#sessionIdByCharacter) {
      if (id === sessionId) found.push(characterId);
    }
    return found;
  }

  /**
   * Recolhe a sessão de REPOUSO que ninguém está olhando há tempo demais (FUN-52).
   *
   * O problema que isto resolve: quem fecha o navegador e não volta deixava a sessão de
   * cidade hospedada e renovada para sempre, segurando um dos dois slots da conta. O sintoma
   * aparecia longe da causa — o terceiro personagem não conectava, e o primeiro não podia ser
   * apagado. Reiniciar o nó "resolvia", o que escondia o problema em desenvolvimento e o
   * deixava aparecer só em produção, onde o processo fica de pé por dias.
   *
   * **Só a sessão orientada a evento é recolhida.** Uma hunt desanexada roda a 1 Hz e nunca
   * passa por aqui — desconectar não pode encerrar nada, ou a hunt AFK deixa de existir
   * (ADR 0001). É essa linha que separa "repouso" de "progresso sem ninguém olhando".
   *
   * E o invariante 8 continua de pé na leitura que importa: a Cidade é o estado de REPOUSO, e
   * repouso não precisa de nó. Sem sessão hospedada o personagem continua na cidade, pela
   * coluna `characters.state` — o que a API já reporta assim (FUN-30).
   *
   * A carência existe para reconexão não virar rotatividade: recarregar a página, trocar de
   * rede ou perder o Wi-Fi por um instante não pode custar uma sessão nova.
   */
  #collectResting(hosted: HostedSession, nowMs: number): void {
    if (hosted.viewers.size > 0 || hosted.restingSince === null) return;
    if (nowMs - hosted.restingSince < RESTING_GRACE_MS) return;

    const characterId = this.#charactersOf(hosted.session.id)[0];
    if (characterId === undefined) return;
    // Marca antes de soltar: `release` é assíncrono, e o ciclo seguinte não pode tentar de
    // novo enquanto o primeiro ainda está no meio do caminho.
    hosted.restingSince = null;
    this.#logger.info(
      { characterId, sessionId: hosted.session.id },
      'Collecting a resting session nobody is watching',
    );
    void this.release(characterId).catch((error: unknown) => {
      this.#logger.error({ error, characterId }, 'Failed to collect a resting session');
    });
  }

  /** Manda o acumulado e derruba quem não está drenando. */
  flush(): void {
    for (const hosted of this.#sessions.values()) {
      for (const viewer of hosted.viewers) {
        viewer.flush();
        if (!viewer.dead) continue;
        this.#logger.warn(
          { characterId: viewer.characterId },
          'Dropping viewer that stopped draining',
        );
        viewer.close(1013, 'backpressure');
        this.detach(viewer);
      }
    }
  }

  start(): void {
    this.#cycleTimer = setInterval(() => this.cycle(), CYCLE_MS);
    this.#renewTimer = setInterval(() => void this.#renewLeases(), RENEW_INTERVAL_MS);
    this.#snapshotTimer = setInterval(() => void this.saveAll(), SNAPSHOT_INTERVAL_MS);
  }

  stop(): void {
    if (this.#cycleTimer) clearInterval(this.#cycleTimer);
    if (this.#renewTimer) clearInterval(this.#renewTimer);
    if (this.#snapshotTimer) clearInterval(this.#snapshotTimer);
    this.#cycleTimer = null;
    this.#renewTimer = null;
    this.#snapshotTimer = null;
  }

  /**
   * Encerra TODAS as sessões creditando o progresso, e avisa quem estiver olhando (FUN-29).
   *
   * É o que um deploy faz: encerrar creditando, e não migrar ao vivo (ADR 0010). Sem isto,
   * um deploy com milhares de sessões desanexadas em voo destrói progresso de gente que nem
   * está lá para reagir — e o §38.4 é explícito que hunt AFK não pode sumir em silêncio.
   *
   * A ORDEM importa. O extrato é gravado ANTES de o visualizador ser avisado: se o processo
   * morrer no meio, o jogador ficou sem a mensagem mas o crédito está no Redis esperando o
   * `jobs`. O contrário — avisar e morrer antes de gravar — mostraria um extrato que nunca
   * vai existir, que é a pior das duas metades.
   */
  async drainAll(reason: EndReason = 'drain'): Promise<number> {
    let ended = 0;
    for (const [characterId, sessionId] of [...this.#sessionIdByCharacter]) {
      const hosted = this.#sessions.get(sessionId);
      if (hosted === undefined) continue;
      try {
        const receipt = hosted.session.end(reason);
        await this.#saveReceipt(characterId, hosted, receipt);
        for (const viewer of hosted.viewers) {
          viewer.sendNow({
            type: 'session-ended',
            reason: receipt.reason,
            aggregates: receipt.aggregates,
            notableEvents: receipt.notableEvents.map((event) => ({ ...event })),
          });
        }
        // Creditada: o snapshot e o registro no diretório TÊM que sumir.
        //
        // Deixar o snapshot criaria um caminho de crédito DOBRADO — a próxima conexão
        // retomaria (FUN-28) o estado de antes do encerramento, e uma segunda drenagem
        // creditaria os mesmos agregados de novo, com um `seq` novo que a chave única do
        // ledger não consegue recusar. E deixar o registro no diretório apontando para um nó
        // que já saiu é a definição de sessão órfã.
        await this.release(characterId, 1001, 'drain');
        ended += 1;
      } catch (error) {
        // Uma sessão que falha não pode impedir as outras de creditar: drenagem que para no
        // meio é pior que drenagem nenhuma, porque metade credita e metade some.
        //
        // A que falhou FICA com snapshot e registro: é o caminho da FUN-28, e voltar
        // retomável é melhor que sumir sem crédito.
        this.#logger.error({ error, characterId, sessionId }, 'Failed to drain a session');
      }
    }
    return ended;
  }

  async #saveReceipt(
    characterId: string,
    hosted: HostedSession,
    receipt: Receipt,
  ): Promise<void> {
    const receipts = this.#options.receipts;
    const accountId = this.#accountIdByCharacter.get(characterId);
    if (receipts === undefined || accountId === undefined) return;
    // Uma sessão credita UMA vez. A drenagem grava e depois solta, e sem esta guarda o
    // `release` gravaria de novo com um `seq` novo — que a chave única do ledger não teria
    // como recusar, e o jogador receberia o mesmo gold duas vezes.
    if (hosted.credited) return;
    hosted.credited = true;
    // `seq` avança na sessão: é metade da chave de idempotência do ledger (invariante 10), e
    // é o que impede uma drenagem repetida por retry de creditar duas vezes.
    hosted.session.ledgerSeq += 1;
    // A stamina do dono da sessão vai junto (FUN-54): sem ela, o tempo de hunt gasto nunca
    // chegaria ao banco, e reconectar devolveria a stamina de antes da hunt.
    const owner = hosted.session.participants.find((p) => p.id === characterId);
    await receipts.save({
      sessionId: receipt.sessionId,
      characterId,
      accountId,
      reason: receipt.reason,
      seq: hosted.session.ledgerSeq,
      aggregates: receipt.aggregates,
      notableEvents: receipt.notableEvents,
      ...(owner?.staminaMs === undefined || owner.staminaMs === null
        ? {}
        : { staminaMs: owner.staminaMs, staminaUpdatedAtMs: owner.staminaUpdatedAtMs }),
    });
  }

  /** Grava todas as sessões hospedadas. Chamado pelo timer e pela drenagem. */
  async saveAll(): Promise<void> {
    const snapshots = this.#options.snapshots;
    if (snapshots === undefined) return;
    for (const [characterId, sessionId] of this.#sessionIdByCharacter) {
      const hosted = this.#sessions.get(sessionId);
      const accountId = this.#accountIdByCharacter.get(characterId);
      if (hosted === undefined || accountId === undefined) continue;
      try {
        await snapshots.save(
          characterId, accountId, this.#options.nodeId, hosted.session.snapshot(),
        );
      } catch (error) {
        // Falhar aqui é perder o próximo intervalo, não a sessão. Silenciar seria perder a
        // única pista de por que uma retomada voltou mais atrasada do que devia.
        this.#logger.error({ error, characterId }, 'Failed to save session snapshot');
      }
    }
  }

  /** Id numérico da criatura, criado na primeira vez que alguém precisa dele. */
  #creatureId(hosted: HostedSession, characterId: string): number {
    const existing = hosted.creatureIds.get(characterId);
    if (existing !== undefined) return existing;
    const assigned = hosted.creatureIds.size + 1;
    hosted.creatureIds.set(characterId, assigned);
    return assigned;
  }

  /**
   * O estado ATUAL, montado do zero a cada pedido.
   *
   * Não existe fila de eventos guardada para reproduzir depois, e isso é decisão, não
   * economia: guardar seis horas de eventos para reproduzir na volta é o erro que o §16.2
   * nomeia. O que a sessão guarda é onde tudo está agora, os agregados e a lista curta de
   * eventos notáveis.
   */
  #sessionState(hosted: HostedSession, characterId: string): S2CMessage {
    const { session } = hosted;
    const self = session.participants.find((participant) => participant.id === characterId);

    const creatures = session.participants.map((participant) => ({
      id: this.#creatureId(hosted, participant.id),
      position: participant.position,
      // FUN-21 traz a indireção `content → appearanceId`; até lá todo mundo é a mesma coisa.
      appearanceId: 1,
      name: participant.id,
      health: participant.health,
      maxHealth: participant.maxHealth,
    }));

    return {
      type: 'session-state',
      sessionType: session.ruleset.type,
      elapsedMs: session.aggregates.durationMs,
      self: {
        creatureId: this.#creatureId(hosted, characterId),
        characterId,
        health: self?.health ?? 0,
        maxHealth: self?.maxHealth ?? 0,
        mana: self?.mana ?? 0,
        maxMana: self?.maxMana ?? 0,
        level: self?.level ?? 0,
        xp: self?.xp ?? 0,
      },
      world: {
        mapId: null,
        creatures,
      },
      aggregates: { ...session.aggregates },
      notableEvents: session.notableEvents.map((event) => ({ ...event })),
    };
  }

  #hostedSession(characterId: string): HostedSession | undefined {
    const sessionId = this.#sessionIdByCharacter.get(characterId);
    return sessionId === undefined ? undefined : this.#sessions.get(sessionId);
  }

  async #createAndRegister(
    characterId: string,
    initialCharacter: InitialCharacter | undefined,
    accountId: string | undefined,
  ): Promise<void> {
    const resumed = await this.#resume(characterId, accountId);
    const session = resumed?.session ?? this.#options.createSession(characterId, initialCharacter);
    await this.#register(characterId, session, accountId);
    this.#createLocal(characterId, session, accountId);
    if (resumed !== null) {
      this.#resumedGapMs.set(characterId, resumed.gapMs);
      this.#logger.info(
        { characterId, sessionId: session.id, gapMs: resumed.gapMs },
        'Session resumed from snapshot',
      );
    }
  }

  /**
   * Retoma do snapshot, se houver um e se ele for reconstruível.
   *
   * A exclusão mútua de verdade NÃO está aqui: está no `register`, que é atômico e recusa
   * registrar um `sessionId` diferente enquanto o lease de outro vive. Duas retomadas
   * simultâneas produzem duas sessões locais, mas só uma consegue se registrar — e a outra
   * levanta antes de existir para alguém. É por isso que a trava do `jobs` é contra trabalho
   * duplicado, e não contra duas cópias rodando.
   */
  async #resume(
    characterId: string,
    accountId: string | undefined,
  ): Promise<{ session: Session; gapMs: number } | null> {
    const snapshots = this.#options.snapshots;
    const restore = this.#options.restoreSession;
    if (snapshots === undefined || restore === undefined) return null;

    let stored;
    try {
      stored = await snapshots.load(characterId);
    } catch (error) {
      this.#logger.error({ error, characterId }, 'Failed to load session snapshot');
      return null;
    }
    if (stored === null) return null;

    const session = restore(stored.snapshot);
    if (session === null) {
      // Não dá para reconstruir: formato antigo, ruleset desconhecido, ou versão de conteúdo
      // diferente da deste nó (invariante 7).
      //
      // CREDITAR ANTES DE APAGAR. Descartar em silêncio é o oposto do que o ADR 0010 decide
      // para o mesmo problema — encerrar creditando, não jogar fora — e o §38.4 é explícito
      // que hunt AFK não pode sumir sem explicação. O snapshot carrega agregados, eventos
      // notáveis e `ledgerSeq`, que é tudo o que o extrato precisa.
      await this.#creditUnrestorable(characterId, accountId, stored.snapshot);
      this.#logger.warn(
        { characterId, sessionId: stored.snapshot.id, type: stored.snapshot.type },
        'Snapshot could not be restored; credited its progress and discarded it',
      );
      await snapshots.remove(characterId).catch(() => undefined);
      return null;
    }
    return { session, gapMs: Math.max(0, Date.now() - stored.savedAtMs) };
  }

  /**
   * Extrato de uma sessão que não volta mais, montado a partir do snapshot.
   *
   * O `seq` sai de `ledgerSeq + 1`, que é a MESMA regra do caminho normal — e é ela que torna
   * isto idempotente: se aquela sessão já tinha creditado esse `seq`, a chave única do ledger
   * recusa o segundo, e o jogador não recebe duas vezes. Sem essa aritmética, um snapshot que
   * sobreviveu a uma drenagem parcial creditaria o mesmo progresso de novo.
   */
  async #creditUnrestorable(
    characterId: string,
    accountId: string | undefined,
    snapshot: SessionSnapshot,
  ): Promise<void> {
    const receipts = this.#options.receipts;
    if (receipts === undefined || accountId === undefined) return;
    const owner = snapshot.participants.find((participant) => participant.id === characterId);
    try {
      await receipts.save({
        sessionId: snapshot.id,
        characterId,
        accountId,
        // `drain` porque foi o servidor que encerrou, não o jogador: é a mesma família de
        // "sua sessão foi encerrada por manutenção", que é o que de fato aconteceu.
        reason: 'drain',
        seq: snapshot.ledgerSeq + 1,
        aggregates: snapshot.aggregates,
        notableEvents: snapshot.notableEvents,
        ...(owner?.staminaMs === undefined || owner.staminaMs === null
          ? {}
          : {
            staminaMs: owner.staminaMs,
            staminaUpdatedAtMs: owner.staminaUpdatedAtMs ?? 0,
          }),
      });
    } catch (error) {
      // Falhar aqui perde o crédito, e é por isso que o snapshot NÃO é apagado em seguida
      // quando isto lança: a próxima conexão tenta de novo.
      this.#logger.error(
        { error, characterId, sessionId: snapshot.id },
        'Failed to credit an unrestorable snapshot',
      );
      throw error;
    }
  }

  #createLocal(characterId: string, session: Session, accountId?: string): void {
    const hosted: HostedSession = {
      session,
      viewers: new Set(),
      creatureIds: new Map(),
      // Nasce em repouso: um ticket emitido e nunca usado deixaria a sessão de pé para
      // sempre, segurando um slot que ninguém está usando.
      restingSince: this.#now(),
      // Vale tanto para a sessão nova quanto para a retomada de snapshot: as duas começam a
      // ser cobradas a partir de agora, e não de um relógio que não é deste processo.
      lastAdvancedAtMs: this.#now(),
      credited: false,
    };
    this.#sessions.set(session.id, hosted);
    this.#sessionIdByCharacter.set(characterId, session.id);
    if (accountId !== undefined) this.#accountIdByCharacter.set(characterId, accountId);

    this.#logger.info(
      { characterId, sessionId: session.id, type: session.ruleset.type },
      'Session created',
    );
  }

  async #register(
    characterId: string,
    session: Session,
    accountId: string | undefined,
  ): Promise<void> {
    const directory = this.#options.directory;
    if (directory === undefined) return;
    if (accountId === undefined) throw new Error('account is required to register a session');
    const registered = await directory.register(characterId, {
      sessionId: session.id,
      nodeId: this.#options.nodeId,
      type: session.ruleset.type satisfies SessionType,
    }, accountId);
    if (!registered) throw new Error('active reservation expired before session registration');
  }

  async #renewLeases(): Promise<void> {
    const directory = this.#options.directory;
    if (directory === undefined || this.#sessionIdByCharacter.size === 0) return;
    try {
      await directory.renew([...this.#accountIdByCharacter].map(([characterId, accountId]) => ({
        characterId,
        accountId,
      })));
    } catch (error) {
      // Lease não renovado vira sessão órfã para a FUN-28. Registrar alto: é o sintoma que
      // antecede uma sessão sendo retomada em outro nó sem necessidade.
      this.#logger.error({ error }, 'Failed to renew session leases');
    }
  }

  #now(): number {
    return this.#options.now?.() ?? performance.now();
  }
}
