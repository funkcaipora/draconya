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

import type { Session, SessionType } from '@draconya/sim';
import type { C2SMessage } from '@draconya/protocol';
import type { SessionDirectory } from '../directory.js';
import type { Logger } from '../log.js';
import type { InitialCharacter } from '../tickets.js';
import { Viewer, type ViewerOptions, type ViewerSocket } from './viewer.js';

/** Cria a sessão de um personagem que ainda não tem uma. */
export type SessionFactory = (characterId: string, initialCharacter?: InitialCharacter) => Session;

export interface SessionHostOptions {
  readonly nodeId: string;
  readonly contentVersion: string;
  readonly createSession: SessionFactory;
  readonly logger: Logger;
  readonly directory?: SessionDirectory;
  readonly viewer?: ViewerOptions;
  /** Relógio monotônico da simulação. Injetável para o teste não depender de tempo real. */
  readonly now?: () => number;
}

interface HostedSession {
  readonly session: Session;
  readonly viewers: Set<Viewer>;
}

/**
 * Teto de taxa do laço: 10 Hz. Uma sessão pode pedir menos — a política por tipo e por
 * presença de visualizador é do próprio ruleset (ADR 0003) e é lida a cada ciclo.
 */
const CYCLE_MS = 100;
/** Um terço do lease do diretório, pela mesma razão do batimento. */
const RENEW_INTERVAL_MS = 10_000;

export class SessionHost {
  readonly #options: SessionHostOptions;
  readonly #logger: Logger;

  /** Por sessão. O índice por personagem existe porque uma sessão terá vários (guild war). */
  readonly #sessions = new Map<string, HostedSession>();
  readonly #sessionIdByCharacter = new Map<string, string>();
  readonly #accountIdByCharacter = new Map<string, string>();
  readonly #preparations = new Map<string, Promise<void>>();

  #cycleTimer: NodeJS.Timeout | null = null;
  #renewTimer: NodeJS.Timeout | null = null;

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
  ): Promise<void> {
    const existing = this.sessionFor(characterId);
    if (existing !== undefined) {
      await this.#register(characterId, existing, accountId);
      return;
    }

    const pending = this.#preparations.get(characterId);
    if (pending !== undefined) {
      await pending;
      return;
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
    const viewer = new Viewer(socket, characterId, this.#options.viewer);
    hosted.viewers.add(viewer);
    hosted.session.attach(viewer.id);

    viewer.sendNow({
      type: 'welcome',
      characterId,
      contentVersion: this.#options.contentVersion,
    });
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
    this.#logger.debug(
      { characterId: viewer.characterId, sessionId, viewers: hosted.viewers.size },
      'Viewer detached',
    );
    // TODO(FUN-30): sessão de cidade sem visualizador e sem estado fica aqui para sempre.
    // Quem decide que ela pode ir embora é a máquina de estados do personagem — recolher
    // no detach seria exatamente o defeito que esta issue existe para não ter.
  }

  /** Ações do jogador são tratadas NA CHEGADA, não enfileiradas para o tick (ver AGENTS.md). */
  handle(viewer: Viewer, message: C2SMessage): void {
    switch (message.type) {
      case 'ping':
        // Fora da fila: `pong` que espera o ciclo mede a fila, não a rede.
        viewer.sendNow({ type: 'pong', t: message.t });
        return;
      case 'logout':
        viewer.close(1000, 'logout');
        return;
      default:
        // walk, walk-to, say, client-ready, session-attach e authenticate chegam nas
        // FUN-30/32/42. Ignorar em silêncio é melhor que responder errado.
        this.#logger.debug({ type: message.type }, 'Message not handled yet');
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
    for (const hosted of this.#sessions.values()) {
      const hz = hosted.session.currentHz();
      // `0` é orientada a evento: cidade e treino não têm laço nenhum.
      if (hz <= 0 || hosted.session.ended !== null) continue;
      if (nowMs - hosted.session.nowMs < 1000 / hz) continue;
      try {
        hosted.session.tick(nowMs);
      } catch (error) {
        // Uma sessão que explode não pode derrubar as outras do nó.
        this.#logger.error({ error, sessionId: hosted.session.id }, 'Session tick failed');
      }
    }
    this.flush();
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
  }

  stop(): void {
    if (this.#cycleTimer) clearInterval(this.#cycleTimer);
    if (this.#renewTimer) clearInterval(this.#renewTimer);
    this.#cycleTimer = null;
    this.#renewTimer = null;
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
    const session = this.#options.createSession(characterId, initialCharacter);
    await this.#register(characterId, session, accountId);
    this.#createLocal(characterId, session, accountId);
  }

  #createLocal(characterId: string, session: Session, accountId?: string): void {
    const hosted: HostedSession = { session, viewers: new Set() };
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
