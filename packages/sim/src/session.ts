// A `Session` é a unidade de simulação, e é o coração da arquitetura (ADR 0001).
//
// Todo personagem está sempre em exatamente uma sessão, cidade inclusive (invariante 8) — o
// que transforma o estado exclusivo de regra policiada em propriedade estrutural, e serve de
// controle de concorrência sobre o estado quente sem lock nenhum.
//
// A sessão roda com ZERO visualizadores. Se algum caminho presumir que existe um, quebra na
// primeira hunt AFK — que é o modo padrão do jogo.

import { CharacterRuntime } from './character.js';
import type { CharacterState } from './character.js';
import type { Rng, RngState } from './rng.js';

/**
 * Versão do FORMATO de snapshot — não do conteúdo, não do servidor.
 *
 * Existe desde o primeiro snapshot de propósito: sem ela, o primeiro deploy que mudar o
 * formato descarta em silêncio milhares de sessões em voo, e ninguém liga uma coisa à outra.
 * Mudou o formato, sobe o número e decide explicitamente entre migrar e descartar.
 */
export const SNAPSHOT_FORMAT_VERSION = 2;

export interface SessionSnapshot {
  readonly formatVersion: number;
  readonly contentVersion: string;
  readonly id: string;
  readonly type: SessionType;
  readonly createdAtMs: number;
  readonly lastTickMs: number;
  readonly rng: RngState;
  readonly participants: readonly CharacterState[];
  readonly aggregates: Aggregates;
  readonly notableEvents: readonly NotableEvent[];
  readonly ledgerSeq: number;
  readonly endedReason: EndReason | null;
  /** Opaco: quem entende do formato é o próprio ruleset. */
  readonly ruleset?: unknown;
}

export type SessionType = 'city' | 'hunt' | 'training' | 'quest' | 'boss' | 'guild-war';

export type EndReason =
  | 'manual-exit'
  | 'exit-rule'
  | 'death'
  | 'drain'
  | 'completed';

export interface NotableEvent {
  readonly atMs: number;
  readonly type: string;
  readonly detail?: string;
}

export interface Aggregates {
  durationMs: number;
  xpGained: number;
  goldGained: number;
  goldSpent: number;
  kills: number;
  deaths: number;
}

export interface Receipt {
  readonly sessionId: string;
  readonly reason: EndReason;
  readonly aggregates: Aggregates;
  readonly notableEvents: readonly NotableEvent[];
}

/**
 * O que um ruleset define — e são as MESMAS quatro coisas para hunt, treino, quest, boss e
 * guild war. Se a Guild War não couber aqui depois, ela foi modelada em cima de hunt, e
 * descobrir isso na F5 custa semanas.
 */
export interface Ruleset {
  readonly type: SessionType;

  /**
   * Taxa de tick desejada, em Hz. `0` significa orientada a evento — sem laço.
   *
   * A política do ADR 0003 mora aqui, e não num `switch` em outro lugar: cada ruleset conhece
   * o próprio custo. Cidade e treino devolvem 0; hunt cai de 10 para 1–2 ao desanexar; quest,
   * boss e guild war ficam em 10 mesmo desanexados, porque o §6.2 mantém o personagem no mapa
   * e vulnerável.
   */
  hz(attached: boolean): number;

  onEnter(session: Session, character: CharacterRuntime): void;
  onTick(session: Session, dtMs: number): void;
  onDeath(session: Session, character: CharacterRuntime): void;
  onEnd(session: Session, reason: EndReason): void;

  /**
   * Estado próprio do ruleset, para entrar no snapshot. Ruleset sem estado pode omitir.
   * O serializador trata o retorno como opaco — quem entende do formato é o ruleset.
   */
  getState?(): unknown;
  restore?(state: unknown): void;
}

export interface SessionOptions {
  readonly id: string;
  readonly contentVersion: string;
  readonly ruleset: Ruleset;
  readonly rng: Rng;
  readonly createdAtMs: number;
}

export class Session {
  readonly id: string;
  /** Congelada na criação (invariante 7): a sessão termina na versão em que começou. */
  readonly contentVersion: string;
  readonly ruleset: Ruleset;
  readonly rng: Rng;
  readonly createdAtMs: number;

  readonly participants: CharacterRuntime[] = [];
  readonly notableEvents: NotableEvent[] = [];
  readonly aggregates: Aggregates = {
    durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0,
  };

  /** Sequência para idempotência econômica: `UNIQUE (session_id, seq)` (invariante 10). */
  ledgerSeq = 0;

  #viewers = new Set<string>();
  #lastTickMs: number;
  #endedReason: EndReason | null = null;

  /**
   * Reconstrói uma sessão a partir de um snapshot (FUN-27, FUN-28).
   *
   * Visualizadores NÃO são restaurados: são conexões, e conexão não sobrevive à queda de um
   * nó. Uma sessão retomada nasce desanexada, que é o estado correto — quem estava olhando
   * vai reanexar por conta própria.
   */
  static fromSnapshot(snapshot: SessionSnapshot, ruleset: Ruleset, rng: Rng): Session {
    if (snapshot.formatVersion !== SNAPSHOT_FORMAT_VERSION) {
      throw new Error(
        `snapshot format version ${snapshot.formatVersion}; this server reads ` +
          `${SNAPSHOT_FORMAT_VERSION}. Migrate or explicitly discard.`,
      );
    }
    if (ruleset.type !== snapshot.type) {
      throw new Error(`ruleset "${ruleset.type}" does not match snapshot "${snapshot.type}"`);
    }

    const session = new Session({
      id: snapshot.id,
      contentVersion: snapshot.contentVersion,
      ruleset,
      rng,
      createdAtMs: snapshot.createdAtMs,
    });
    session.#lastTickMs = snapshot.lastTickMs;
    session.#endedReason = snapshot.endedReason;
    session.ledgerSeq = snapshot.ledgerSeq;
    Object.assign(session.aggregates, snapshot.aggregates);
    session.notableEvents.push(...snapshot.notableEvents);
    for (const state of snapshot.participants) {
      session.participants.push(new CharacterRuntime(state));
    }
    if (snapshot.ruleset !== undefined) ruleset.restore?.(snapshot.ruleset);
    return session;
  }

  constructor(options: SessionOptions) {
    this.id = options.id;
    this.contentVersion = options.contentVersion;
    this.ruleset = options.ruleset;
    this.rng = options.rng;
    this.createdAtMs = options.createdAtMs;
    this.#lastTickMs = options.createdAtMs;
  }

  get attached(): boolean {
    return this.#viewers.size > 0;
  }

  get ended(): EndReason | null {
    return this.#endedReason;
  }

  /** Anexar e desanexar não têm efeito nenhum sobre a simulação — é o ADR 0001 em uma linha. */
  attach(viewerId: string): void {
    this.#viewers.add(viewerId);
  }

  detach(viewerId: string): void {
    this.#viewers.delete(viewerId);
  }

  /** Hz atual, dado quem está olhando. `0` = orientada a evento. */
  currentHz(): number {
    return this.ruleset.hz(this.attached);
  }

  enter(character: CharacterRuntime): void {
    if (this.#endedReason) throw new Error(`session ${this.id} has already ended`);
    this.participants.push(character);
    this.ruleset.onEnter(this, character);
  }

  /**
   * Avança a simulação até `nowMs`.
   *
   * Recebe o INSTANTE, não o intervalo, de propósito: o `dtMs` é derivado do último tick, então
   * uma troca de taxa (anexar ou desanexar) não perde nem ganha tempo. Passar o intervalo
   * nominal da taxa nova faria a sessão derivar a cada troca — e trocar de taxa acontece o dia
   * inteiro, então o erro acumula até virar diferença visível de XP.
   */
  tick(nowMs: number): void {
    if (this.#endedReason) return;
    const dtMs = nowMs - this.#lastTickMs;
    if (dtMs <= 0) return;
    this.#lastTickMs = nowMs;
    this.aggregates.durationMs += dtMs;
    this.ruleset.onTick(this, dtMs);
  }

  /** Instante do último tick. É o "agora" da simulação — não use relógio de parede aqui. */
  get nowMs(): number {
    return this.#lastTickMs;
  }

  /**
   * Reposiciona o relógio da sessão SEM simular o intervalo pulado.
   *
   * Existe para a retomada depois de queda de nó (FUN-28). O `lastTickMs` de um snapshot foi
   * medido pelo relógio monotônico de OUTRO processo, e monotônico não é comparável entre
   * processos: reiniciado, o mesmo número pode estar no futuro (o próximo tick nunca acontece,
   * porque `dtMs` sai negativo para sempre) ou muito no passado (o primeiro tick chega com um
   * `dtMs` gigante e resolve horas de combate de uma vez).
   *
   * Descartar o intervalo é decisão registrada no ADR 0018, não omissão: ninguém simulou
   * aquele tempo, e creditar progresso por ele seria inventar recompensa.
   */
  rebaseClock(nowMs: number): void {
    this.#lastTickMs = nowMs;
  }

  kill(character: CharacterRuntime): void {
    character.alive = false;
    character.health = 0;
    this.aggregates.deaths++;
    this.record('death', character.id);
    this.ruleset.onDeath(this, character);
  }

  /** Lista curta para a tela de retorno (§16.2). Não é log: guarda só o que vale contar. */
  record(type: string, detail?: string): void {
    this.notableEvents.push(
      detail === undefined
        ? { atMs: this.#lastTickMs, type }
        : { atMs: this.#lastTickMs, type, detail },
    );
  }

  end(reason: EndReason): Receipt {
    if (!this.#endedReason) {
      this.#endedReason = reason;
      this.ruleset.onEnd(this, reason);
      this.record('ended', reason);
    }
    return {
      sessionId: this.id,
      reason: this.#endedReason,
      aggregates: { ...this.aggregates },
      notableEvents: [...this.notableEvents],
    };
  }

  getRngState(): RngState {
    return this.rng.getState();
  }

  /**
   * Snapshot para o Redis (FUN-27). Precisa reconstruir a sessão EXATAMENTE — cooldowns,
   * temporizadores em curso e o estado do gerador aleatório inclusive. Sem o gerador, a
   * sessão retomada continua com outra sequência de loot, e nenhuma investigação de "por
   * que não caiu" fica possível.
   */
  snapshot(): SessionSnapshot {
    const rulesetState = this.ruleset.getState?.();
    return {
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      contentVersion: this.contentVersion,
      id: this.id,
      type: this.ruleset.type,
      createdAtMs: this.createdAtMs,
      lastTickMs: this.#lastTickMs,
      rng: this.rng.getState(),
      participants: this.participants.map((p) => p.getState()),
      aggregates: { ...this.aggregates },
      notableEvents: [...this.notableEvents],
      ledgerSeq: this.ledgerSeq,
      endedReason: this.#endedReason,
      ...(rulesetState === undefined ? {} : { ruleset: rulesetState }),
    };
  }
}
