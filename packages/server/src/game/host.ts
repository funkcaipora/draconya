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

import type { Session, SessionSnapshot, SessionType } from '@draconya/sim';
import type { C2SMessage, S2CMessage } from '@draconya/protocol';
import type { SessionDirectory } from '../directory.js';
import type { SnapshotStore } from '../snapshots.js';
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
  /** Onde as sessões são guardadas para sobreviver à queda do processo (FUN-28). */
  readonly snapshots?: SnapshotStore;
  /** Reconstrói uma sessão a partir de um snapshot. `null` = não dá para retomar. */
  readonly restoreSession?: (snapshot: SessionSnapshot, nowMs: number) => Session | null;
  readonly viewer?: ViewerOptions;
  /** Relógio monotônico da simulação. Injetável para o teste não depender de tempo real. */
  readonly now?: () => number;
}

interface HostedSession {
  readonly session: Session;
  readonly viewers: Set<Viewer>;
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

export class SessionHost {
  readonly #options: SessionHostOptions;
  readonly #logger: Logger;

  /** Por sessão. O índice por personagem existe porque uma sessão terá vários (guild war). */
  readonly #sessions = new Map<string, HostedSession>();
  readonly #sessionIdByCharacter = new Map<string, string>();
  readonly #accountIdByCharacter = new Map<string, string>();
  readonly #preparations = new Map<string, Promise<void>>();
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
    const viewer = new Viewer(socket, characterId, this.#options.viewer);
    hosted.viewers.add(viewer);
    hosted.session.attach(viewer.id);

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
    this.#logger.debug(
      { characterId: viewer.characterId, sessionId, viewers: hosted.viewers.size },
      'Viewer detached',
    );
    // A sessão FICA, mesmo sem ninguém olhando — é o ADR 0001, e há teste de integração
    // exigindo que uma reconexão reencontre a MESMA sessão.
    //
    // O efeito colateral disso hoje é grave e está registrado na FUN-52: como nada mais
    // solta um slot de personagem ativo, duas sessões criadas alguma vez neste nó esgotam o
    // teto de dois até o processo reiniciar. Resolver exige decidir se "ativo" é "tem sessão
    // hospedada" ou "tem alguém jogando", e essa decisão é da FUN-30, não deste detach.
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
    const resumed = await this.#resume(characterId);
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
  async #resume(characterId: string): Promise<{ session: Session; gapMs: number } | null> {
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

    const session = restore(stored.snapshot, this.#now());
    if (session === null) {
      // Não dá para reconstruir: formato antigo, ou ruleset que este servidor não conhece.
      // Apagar é melhor que tentar de novo a cada reconexão para sempre.
      this.#logger.warn({ characterId }, 'Snapshot could not be restored; discarding it');
      await snapshots.remove(characterId).catch(() => undefined);
      return null;
    }
    return { session, gapMs: Math.max(0, Date.now() - stored.savedAtMs) };
  }

  #createLocal(characterId: string, session: Session, accountId?: string): void {
    const hosted: HostedSession = { session, viewers: new Set(), creatureIds: new Map() };
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
