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
import { resolveDeath } from './death.js';
import type { KillCredit, Victim } from './death.js';
import type { Rng, RngState } from './rng.js';
import type { CombatEvent } from './combat-events.js';
import type { CreatureMoved, MoveResult } from './movement.js';
import type { PresenceEvent } from './presence.js';
import type { GridPoint } from './monster/step.js';
import { Schedule } from './schedule.js';
import type { ScheduleState, ScheduledEvent } from './schedule.js';

/**
 * Um acontecimento de GAMEPLAY, produzido haja ou não alguém olhando (§12 do documento de
 * referência OpenTibia).
 *
 * Não é mensagem de protocolo. Quem traduz um destes num pacote é o servidor, que é o único
 * lado que conhece socket — e é isso que mantém a matemática igual entre a hunt anexada e a
 * desanexada: o evento nasce dos dois lados, e só num deles alguém o serializa.
 */
export type DomainEvent = CreatureMoved | PresenceEvent | CombatEvent;

/**
 * Teto de eventos de domínio guardados à espera de quem os leia.
 *
 * O hospedeiro drena a cada ciclo, então na prática o buffer nunca passa de um avanço. O teto
 * existe para a sessão que ninguém drena — um nó sem visualizador nenhum não pode acumular
 * memória por horas de hunt. Estourar DESCARTA os mais antigos, e é a escolha certa: isto é
 * apresentação, e apresentação é perdível. Gameplay não passa por aqui.
 */
export const MAX_PENDING_DOMAIN_EVENTS = 512;

/**
 * Versão do FORMATO de snapshot — não do conteúdo, não do servidor.
 *
 * Existe desde o primeiro snapshot de propósito: sem ela, o primeiro deploy que mudar o
 * formato descarta em silêncio milhares de sessões em voo, e ninguém liga uma coisa à outra.
 * Mudou o formato, sobe o número e decide explicitamente entre migrar e descartar.
 *
 * **3 (FUN-68):** `lastTickMs` — relógio de processo — deu lugar a `logicalNowMs` e à fila de
 * eventos. Um snapshot de formato 2 não é migrável: os acumuladores de cooldown que ele grava
 * não dizem quando cada ação vence, só quanto já esperou, e inventar vencimento a partir
 * disso é inventar simulação. Quem lê recusa e credita, que é o caminho que o ADR 0018 já
 * mandava seguir.
 */
export const SNAPSHOT_FORMAT_VERSION = 3;

/**
 * Teto de eventos num único `advanceBy`.
 *
 * O sucessor do `MAX_CATCH_UP` dos cooldowns, e existe pela mesma razão: uma engasgada de
 * processo — GC longo, depurador, máquina suspensa — não pode virar horas de combate
 * resolvidas de uma vez. Ao estourar, o que venceu é empurrado para o alvo e o atraso é
 * DESCARTADO, nunca acumulado (ADR 0018).
 *
 * O número é folgado de propósito: uma hunt cheia carrega ~100 eventos com cadência de
 * centenas de milissegundos, então isto só é alcançado por volta de quinze segundos de
 * intervalo num único avanço. O ciclo do nó é de 100 ms.
 */
export const MAX_EVENTS_PER_ADVANCE = 4096;

export interface SessionSnapshot {
  readonly formatVersion: number;
  readonly contentVersion: string;
  readonly id: string;
  readonly type: SessionType;
  readonly createdAtMs: number;
  /**
   * Relógio LÓGICO da sessão: começa em zero e só anda com `advanceBy`.
   *
   * É o que torna a retomada trivial. O `lastTickMs` de antes era o monotônico do processo que
   * morreu, e monotônico não é comparável entre processos — daí o `rebaseClock`, que existia
   * só para consertar isso. Um relógio que nasce em zero e é próprio da sessão não tem o que
   * rebasear: retomar é continuar de onde parou, e o intervalo pulado nunca chega a existir.
   */
  readonly logicalNowMs: number;
  readonly schedule: ScheduleState;
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

/**
 * O que a hunt rendeu (§16.1, §16.2).
 *
 * **Nada aqui é "por hora".** A derivada é `valor / durationMs`, e o cliente a faz — mandar a
 * divisão pela rede é mandar o mesmo número duas vezes, e as duas divergem na primeira pausa
 * entre calcular e enviar.
 *
 * Todo agregado é escrito ONDE O FATO ACONTECE, pela sessão dona (invariante 9): o maior hit
 * no golpe, o loot no abate, o supply no uso. Reconstruir por varredura seria contar de novo o
 * que já foi contado, e é assim que dois números que deveriam bater param de bater.
 */
export interface Aggregates {
  durationMs: number;
  xpGained: number;
  goldGained: number;
  goldSpent: number;
  kills: number;
  deaths: number;
  /**
   * Quantos ITENS caíram (§16.1). Contagem, não valor: o preço de venda é do Market, que é F6,
   * e um "valor do loot" hoje seria um número inventado passando por medida.
   */
  itemsLooted: number;
  /** Quantos supplies foram usados. O gold deles já está em `goldSpent`. */
  suppliesUsed: number;
  /** O maior golpe de arma da sessão. Zero é "ainda não bateu em ninguém". */
  bestBasicHit: number;
  /** O maior dano de magia da sessão, do ALVO que levou mais — não a soma de uma área. */
  bestSpellHit: number;
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
   * Esta sessão é um SHARD — uma cópia compartilhada por muitos personagens (FUN-71)?
   *
   * Ausente é `false`, que é a sessão de sempre: um personagem, dono do que ela produz. O
   * invariante 8 continua de pé na letra — todo personagem está em exatamente uma sessão —, e
   * o que muda é a leitura: a sessão é que passa a ter muitos.
   *
   * Marcar `true` muda o que "sair" significa. Numa sessão privada, sair é encerrar; num
   * shard, sair é `leave`, e quem fica não perde nada. Ver o ADR 0023.
   */
  readonly shared?: boolean;

  /**
   * O mapa desta sessão, pelo id do conteúdo (FUN-120). É o que `instance-enter` e
   * `session-state.world.mapId` levam ao cliente, para ele buscar a geometria e a pilha de
   * aparências certas. Ausente é sessão sem mapa — só fixture de teste; toda sessão de jogo
   * tem um.
   */
  readonly mapId?: string;

  /**
   * O ambiente da cena (FUN-121): `cavern` escurece o mundo no cliente. Ausente é superfície.
   * Apresentação pura — nada da simulação depende disto.
   */
  readonly ambience?: 'surface' | 'cavern' | undefined;

  /**
   * Com que frequência o HOSPEDEIRO avança esta sessão, em Hz. `0` significa orientada a
   * evento — sem laço.
   *
   * A política do ADR 0003 mora aqui, e não num `switch` em outro lugar: cada ruleset conhece
   * o próprio custo. Cidade e treino devolvem 0; hunt cai de 10 para 1–2 ao desanexar; quest,
   * boss e guild war ficam em 10 mesmo desanexados, porque o §6.2 mantém o personagem no mapa
   * e vulnerável.
   *
   * Desde a FUN-68 isto é uma taxa de ATUALIZAÇÃO, não de simulação: quem decide quando cada
   * ação acontece é a fila de eventos, e o resultado é idêntico em qualquer taxa. O que cai
   * ao desanexar é a granularidade com que o mundo é observado — e não há ninguém observando.
   */
  hz(attached: boolean): number;

  onEnter(session: Session, character: CharacterRuntime): void;

  /**
   * O personagem saiu de uma sessão que CONTINUA viva (FUN-71). Só acontece em shard.
   *
   * Existe porque a saída tem consequência no mundo: o tile que ele ocupava precisa ser
   * liberado, senão sobra um bloqueio invisível que ninguém consegue pisar e nada explica.
   * Numa sessão privada isto nunca é chamado — lá a sessão inteira acaba, e `onEnd` basta.
   */
  onLeave?(session: Session, character: CharacterRuntime): void;

  /**
   * Um evento venceu. `session.nowMs` É o instante do vencimento — não "algum ponto do tick".
   *
   * Quem quiser repetir reagenda a partir daqui (`session.nowMs + intervalo`), e é isso que
   * dispensa acumulador: o evento roda no instante exato em que era devido, então a próxima
   * data não herda erro nenhum.
   */
  onEvent(session: Session, event: ScheduledEvent): void;

  /**
   * Uma criatura morreu — monstro ou personagem (FUN-63). O ruleset decide a CONSEQUÊNCIA; o
   * pipeline (`resolveDeath`) já congelou os eventos dela e já resolveu quem matou.
   *
   * Hunt: monstro vira recompensa e respawn; personagem encerra a sessão em PZ. Guild War:
   * personagem respawna pelas regras da partida. É por isso que isto não mora na criatura
   * (§30 da referência) — e é o que substituiu o `onDeath`, que só conhecia personagem.
   */
  onCreatureDied(session: Session, victim: Victim, credit: KillCredit): void;
  onEnd(session: Session, reason: EndReason): void;

  /**
   * Um jogador pediu para andar (FUN-69). INTENÇÃO, processada NA CHEGADA — nunca enfileirada
   * para o próximo evento: enfileirar põe até 100 ms de jitter em cima do ping, irrelevante na
   * hunt e inaceitável no PvP manual da F5.
   *
   * Passa pelo MESMO sistema de movimento que o bot e o monstro, e recebe a mesma razão de
   * recusa. Ausente no ruleset significa "esta sessão não anda".
   */
  requestMove?(session: Session, characterId: string, to: GridPoint): MoveResult;

  /**
   * Estado próprio do ruleset, para entrar no snapshot. Ruleset sem estado pode omitir.
   * O serializador trata o retorno como opaco — quem entende do formato é o ruleset.
   */
  getState?(): unknown;
  restore?(state: unknown): void;
  /**
   * Depois de `restore`, com os participantes já reconstruídos (#160). `onEnter` não roda na
   * retomada — o personagem já está dentro —, e o que a entrada repõe pela tabela (os tamanhos
   * de container) precisa de um lugar para ser reposto num snapshot anterior ao formato.
   */
  onResume?(session: Session): void;
}

export interface SessionOptions {
  readonly id: string;
  readonly contentVersion: string;
  readonly ruleset: Ruleset;
  readonly rng: Rng;
  readonly createdAtMs: number;
}

const EMPTY_EVENTS: readonly DomainEvent[] = [];

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
    itemsLooted: 0, suppliesUsed: 0, bestBasicHit: 0, bestSpellHit: 0,
  };

  /** Sequência para idempotência econômica: `UNIQUE (session_id, seq)` (invariante 10). */
  ledgerSeq = 0;

  #viewers = new Set<string>();
  /** Relógio LÓGICO. Começa em zero, anda só com `advanceBy`. Ver `SessionSnapshot`. */
  #logicalNowMs = 0;
  #schedule = new Schedule();
  #domainEvents: DomainEvent[] = [];
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
    session.#logicalNowMs = snapshot.logicalNowMs;
    session.#schedule = Schedule.fromState(snapshot.schedule);
    session.#endedReason = snapshot.endedReason;
    session.ledgerSeq = snapshot.ledgerSeq;
    Object.assign(session.aggregates, snapshot.aggregates);
    session.notableEvents.push(...snapshot.notableEvents);
    for (const state of snapshot.participants) {
      session.participants.push(new CharacterRuntime(state));
    }
    if (snapshot.ruleset !== undefined) ruleset.restore?.(snapshot.ruleset);
    ruleset.onResume?.(session);
    return session;
  }

  constructor(options: SessionOptions) {
    this.id = options.id;
    this.contentVersion = options.contentVersion;
    this.ruleset = options.ruleset;
    this.rng = options.rng;
    // Instante do HOSPEDEIRO, guardado para quem investiga — não é o relógio da simulação, e
    // desde a FUN-68 nada aqui dentro o consulta. A simulação começa em zero.
    this.createdAtMs = options.createdAtMs;
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
   * Tira um personagem de uma sessão que CONTINUA viva (FUN-71) e devolve quem saiu.
   *
   * É a operação que faltava para a Cidade compartilhada existir: antes disto, "sair" só sabia
   * ser `end`, e um jogador saindo da praça encerraria a praça para todo mundo.
   *
   * **Só faz sentido em shard**, e é o hospedeiro quem sabe disso — aqui a checagem seria uma
   * regra de servidor dentro do motor. O que este método garante é o mínimo: quem saiu sai da
   * lista, o ruleset é avisado para desfazer o que a entrada fez, e a sessão não termina.
   *
   * Não mexe em agregado nem em extrato: no shard não há nada a creditar (§37), e numa sessão
   * privada esta chamada não acontece.
   */
  leave(characterId: string): CharacterRuntime | null {
    const index = this.participants.findIndex((participant) => participant.id === characterId);
    if (index < 0) return null;
    const [character] = this.participants.splice(index, 1);
    if (character === undefined) return null;
    this.ruleset.onLeave?.(this, character);
    return character;
  }

  /**
   * Avança a simulação em `dtMs`, processando só os eventos que VENCEM na janela.
   *
   * Recebe o INTERVALO, não o instante: o relógio é da sessão, e quem hospeda não tem como
   * saber que horas são aqui dentro. Foi a troca que a FUN-68 fez, e é o que aposenta o
   * `rebaseClock` — o relógio do processo agora mora no hospedeiro, junto do dado que é dele.
   *
   * Antes de cada evento o relógio é posto EXATAMENTE no vencimento dele. É essa linha que faz
   * dez `advanceBy(100)` e um `advanceBy(1000)` produzirem o mesmo estado, e não uma
   * aproximação dele: os dois despacham os mesmos eventos, nos mesmos instantes, na mesma
   * ordem. A equivalência entre taxas deixou de depender de fórmula nenhuma ser escrita com
   * cuidado.
   */
  advanceBy(dtMs: number): void {
    if (dtMs < 0) throw new Error(`dtMs cannot be negative: ${dtMs}`);
    if (this.#endedReason) return;
    if (dtMs === 0) return;

    const targetMs = this.#logicalNowMs + dtMs;
    this.aggregates.durationMs += dtMs;

    let processed = 0;
    for (;;) {
      const next = this.#schedule.peek();
      if (next === undefined || next.dueAtMs > targetMs) break;
      if (processed >= MAX_EVENTS_PER_ADVANCE) {
        // Engasgada: o que venceu vai para o alvo e o atraso morre aqui. Ver
        // `MAX_EVENTS_PER_ADVANCE` e o ADR 0018 — intervalo pulado é descartado, não devido.
        this.#schedule.deferOverdue(targetMs);
        this.record('advance-truncated', String(dtMs));
        break;
      }
      this.#schedule.pop();
      processed++;
      // Nunca para trás: dois eventos podem vencer no mesmo instante, e um evento agendado
      // com atraso (vencimento já no passado) roda agora, não no passado.
      if (next.dueAtMs > this.#logicalNowMs) this.#logicalNowMs = next.dueAtMs;
      this.ruleset.onEvent(this, next);
      // Encerrou no meio: os eventos restantes não acontecem num mundo que acabou.
      if (this.#endedReason !== null) break;
    }

    this.#logicalNowMs = targetMs;
  }

  /**
   * O "agora" da simulação, em tempo lógico. Durante o despacho de um evento é o instante em
   * que ele venceu. Não é relógio de parede e não serve para exibir data.
   */
  get nowMs(): number {
    return this.#logicalNowMs;
  }

  /** Agenda para daqui a `delayMs`. É a forma que quase todo reagendamento usa. */
  scheduleIn(
    kind: string,
    delayMs: number,
    options: { readonly priority?: number; readonly subject?: string } = {},
  ): ScheduledEvent {
    if (delayMs < 0) throw new Error(`delayMs cannot be negative: ${delayMs}`);
    return this.#schedule.schedule(kind, this.#logicalNowMs + delayMs, options);
  }

  /** Cancela os eventos de um subject — o que um monstro que morre leva junto. */
  cancelEvents(subject: string): number {
    return this.#schedule.cancelSubject(subject);
  }

  /** Cancela só os eventos de um `kind` de um subject — reagendar um passo sem tocar no ataque. */
  cancelEvent(kind: string, subject: string): number {
    return this.#schedule.cancel(kind, subject);
  }

  /** Quantos eventos esperam. Existe para métrica e teste; não é regra de jogo. */
  get pendingEvents(): number {
    return this.#schedule.size;
  }

  /**
   * Registra um acontecimento de gameplay. Sempre — nunca condicionado a haver visualizador.
   *
   * Um `if (temViewer)` aqui mudaria a matemática conforme alguém estivesse olhando, que é o
   * invariante 3 quebrado e o que o §12 proíbe em letra. Viewer decide quem SERIALIZA, nunca
   * o que acontece.
   */
  emit(event: DomainEvent): void {
    this.#domainEvents.push(event);
    // Estourou: descarta a metade mais antiga de UMA vez, e não um por push. `shift()` num
    // vetor cheio é O(n) a cada passo, e numa sessão que ninguém drena isso é o coletor
    // rodando o tempo todo — medido no `pnpm bench:hunts`: 18,8 → 25,5 µs por tick.
    if (this.#domainEvents.length > MAX_PENDING_DOMAIN_EVENTS) {
      this.#domainEvents.splice(0, MAX_PENDING_DOMAIN_EVENTS >> 1);
    }
  }

  /**
   * Retira e devolve o que aconteceu desde a última drenagem.
   *
   * NÃO entra no snapshot: é o que aconteceu, não o que a sessão é. Um evento gravado e
   * reentregue depois de uma retomada viraria um passo repetido na tela de quem reconectou.
   */
  drainEvents(): readonly DomainEvent[] {
    if (this.#domainEvents.length === 0) return EMPTY_EVENTS;
    const drained = this.#domainEvents;
    this.#domainEvents = [];
    return drained;
  }

  /**
   * A morte de um personagem: conta no extrato e entra no MESMO pipeline que a de um monstro.
   * O que ela significa — encerrar, respawnar — é do ruleset, em `onCreatureDied`.
   */
  kill(character: CharacterRuntime): void {
    character.alive = false;
    character.health = 0;
    this.aggregates.deaths++;
    this.record('death', character.id);
    resolveDeath(this, { kind: 'character', character });
  }

  /** Lista curta para a tela de retorno (§16.2). Não é log: guarda só o que vale contar. */
  record(type: string, detail?: string): void {
    this.notableEvents.push(
      detail === undefined
        ? { atMs: this.#logicalNowMs, type }
        : { atMs: this.#logicalNowMs, type, detail },
    );
  }

  end(reason: EndReason): Receipt {
    if (!this.#endedReason) {
      this.#endedReason = reason;
      this.ruleset.onEnd(this, reason);
      this.record('ended', reason);
    }
    return this.receipt() as Receipt;
  }

  /**
   * O extrato da sessão encerrada, ou `null` enquanto ela vive.
   *
   * Existe porque quem encerra nem sempre é quem precisa do extrato: a morte encerra a hunt
   * de DENTRO do ruleset (§26.1), e o servidor descobre depois, no ciclo. Sem isto ele
   * precisaria chamar `end` de novo só para receber o extrato de volta — o que funciona, e
   * lê como se estivesse encerrando uma sessão já encerrada.
   */
  receipt(): Receipt | null {
    if (this.#endedReason === null) return null;
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
      logicalNowMs: this.#logicalNowMs,
      schedule: this.#schedule.getState(),
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
