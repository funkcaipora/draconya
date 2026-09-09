// A fila de eventos da sessão (FUN-68, ADR 0019 §6 e §16).
//
// O laço de tick avaliava TODAS as criaturas a cada passo e quase todas respondiam "nada a
// fazer": numa hunt de 40 monstros a 10 Hz são 400 avaliações por segundo para umas poucas
// dezenas de ações reais. Aqui só corre quem VENCE.
//
// Mais barato é a consequência, não o motivo. O motivo é que o tick em lote não tem como
// expressar "o herói andou em t+500, o rato andou em t+500, e nesse instante eles não estavam
// adjacentes": num tick de 1 s os dois andam vários tiles de uma vez e a adjacência é
// conferida uma vez só, no fim. Daí o 1,51× de dano sofrido a mais na hunt desanexada — que é
// o modo PADRÃO do jogo.
//
// Com a fila, `advanceBy(1000)` processa exatamente os mesmos eventos, nos mesmos instantes e
// na mesma ordem que dez `advanceBy(100)`. A equivalência entre taxas deixa de ser uma
// propriedade que se testa e passa a ser uma propriedade da estrutura.

/**
 * Ordem entre eventos que vencem no MESMO instante.
 *
 * Reproduz a ordem que o `onTick` executava suas fases, e existe pela mesma razão que a
 * ordem de desempate do spawner: dois nós com o mesmo snapshot precisam simular a mesma
 * coisa. Sem uma ordem total, "quem age primeiro em t=500" viraria detalhe de implementação
 * do heap — e a sessão deixaria de ser reproduzível.
 */
export const EventPriority = {
  /** Stamina e regeneração: mexem no personagem antes de qualquer um decidir o que fazer. */
  Upkeep: 0,
  /** Nascer antes de agir: um monstro que vence no mesmo instante em que nasce já age. */
  Spawn: 1,
  Movement: 2,
  /** Depois do movimento: quem chegou ao alcance neste instante bate neste instante. */
  Attack: 3,
  /** Por último, sobre o mundo já resolvido. */
  Housekeeping: 4,
} as const;

export interface ScheduledEvent {
  /** Instante LÓGICO da sessão em que o evento vence. Nunca relógio de processo. */
  readonly dueAtMs: number;
  readonly priority: number;
  /** Desempate final. Crescente, atribuído no agendamento. */
  readonly seq: number;
  /** O que fazer. Quem interpreta é o ruleset — a fila não conhece regra de jogo nenhuma. */
  readonly kind: string;
  /**
   * De quem é o evento: id de monstro, id de personagem, índice de slot de spawn.
   *
   * String sempre, inclusive para id numérico de criatura, porque é o que atravessa JSON sem
   * o número virar chave de objeto no caminho de volta.
   */
  readonly subject: string;
}

export interface ScheduleState {
  /** Em ordem de vencimento. Ver `getState`. */
  readonly events: readonly ScheduledEvent[];
  readonly nextSeq: number;
}

export const EMPTY_SCHEDULE: ScheduleState = { events: [], nextSeq: 0 };

/**
 * `a` vence antes de `b`? Ordem total: instante, prioridade, sequência.
 *
 * `seq` nunca empata — é único por agendamento —, então esta comparação nunca devolve
 * "iguais", e é isso que a torna uma ordem total de verdade.
 */
export function comesFirst(a: ScheduledEvent, b: ScheduledEvent): boolean {
  if (a.dueAtMs !== b.dueAtMs) return a.dueAtMs < b.dueAtMs;
  if (a.priority !== b.priority) return a.priority < b.priority;
  return a.seq < b.seq;
}

/**
 * Heap binário mínimo. Não é sofisticação prematura: uma hunt cheia carrega da ordem de cem
 * eventos, e inserir em vetor ordenado custa cem comparações onde o heap custa sete. O custo
 * de tick é o número que a FUN-46 cobra, e é aqui que ele mora agora.
 */
export class Schedule {
  #heap: ScheduledEvent[] = [];
  #nextSeq = 0;

  static fromState(state: ScheduleState = EMPTY_SCHEDULE): Schedule {
    const schedule = new Schedule();
    // Reconstrói o heap em vez de confiar na ordem gravada: o vetor do snapshot está ordenado
    // por vencimento (é o que se lê), e ordenado não é a mesma coisa que "é um heap válido"
    // para todo formato — reempilhar custa O(n) e dispensa a confiança.
    for (const event of state.events) schedule.#push(event);
    schedule.#nextSeq = state.nextSeq;
    return schedule;
  }

  get size(): number {
    return this.#heap.length;
  }

  /**
   * Ordenado por vencimento, e não a ordem interna do heap.
   *
   * O snapshot é lido por gente investigando "por que a hunt parou", e um vetor em ordem de
   * heap não responde nada. Custa um `sort` a cada dez segundos.
   */
  getState(): ScheduleState {
    const events = [...this.#heap].sort((a, b) => (comesFirst(a, b) ? -1 : 1));
    return { events, nextSeq: this.#nextSeq };
  }

  /** Agenda e devolve o evento criado, já com a sequência atribuída. */
  schedule(
    kind: string,
    dueAtMs: number,
    options: { readonly priority?: number; readonly subject?: string } = {},
  ): ScheduledEvent {
    const event: ScheduledEvent = {
      kind,
      dueAtMs,
      priority: options.priority ?? EventPriority.Movement,
      subject: options.subject ?? '',
      seq: this.#nextSeq++,
    };
    this.#push(event);
    return event;
  }

  peek(): ScheduledEvent | undefined {
    return this.#heap[0];
  }

  pop(): ScheduledEvent | undefined {
    const top = this.#heap[0];
    if (top === undefined) return undefined;
    const last = this.#heap.pop() as ScheduledEvent;
    if (this.#heap.length > 0) {
      this.#heap[0] = last;
      this.#siftDown(0);
    }
    return top;
  }

  /**
   * Remove o que casar com `kind` e `subject`. É como um monstro que morre leva os eventos
   * dele junto — sem isso a fila cresceria com o vencimento de criaturas que não existem, e
   * cada uma custaria um despacho para o ruleset descobrir que não há ninguém ali.
   */
  cancel(kind: string, subject: string): number {
    const before = this.#heap.length;
    const kept = this.#heap.filter((e) => e.kind !== kind || e.subject !== subject);
    if (kept.length === before) return 0;
    this.#heap = [];
    for (const event of kept) this.#push(event);
    return before - kept.length;
  }

  /** Remove tudo de um subject, seja qual for o `kind`. */
  cancelSubject(subject: string): number {
    const before = this.#heap.length;
    const kept = this.#heap.filter((e) => e.subject !== subject);
    if (kept.length === before) return 0;
    this.#heap = [];
    for (const event of kept) this.#push(event);
    return before - kept.length;
  }

  /**
   * Empurra para `untilMs` tudo o que já venceu, descartando o atraso.
   *
   * Só é chamado quando um `advanceBy` estoura o orçamento de eventos — ver
   * `MAX_EVENTS_PER_ADVANCE`. É a mesma política do ADR 0018 aplicada a uma engasgada de
   * processo: o intervalo pulado é descartado, não vira dívida que explode no avanço
   * seguinte. Uma aplicação de recuperação, e o resto vai embora.
   */
  deferOverdue(untilMs: number): number {
    let deferred = 0;
    const rescheduled = this.#heap.map((event) => {
      if (event.dueAtMs >= untilMs) return event;
      deferred++;
      return { ...event, dueAtMs: untilMs };
    });
    if (deferred === 0) return 0;
    this.#heap = [];
    for (const event of rescheduled) this.#push(event);
    return deferred;
  }

  #push(event: ScheduledEvent): void {
    this.#heap.push(event);
    this.#siftUp(this.#heap.length - 1);
  }

  #siftUp(from: number): void {
    let index = from;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!comesFirst(this.#heap[index] as ScheduledEvent, this.#heap[parent] as ScheduledEvent)) {
        return;
      }
      this.#swap(index, parent);
      index = parent;
    }
  }

  #siftDown(from: number): void {
    let index = from;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (
        left < this.#heap.length &&
        comesFirst(this.#heap[left] as ScheduledEvent, this.#heap[smallest] as ScheduledEvent)
      ) {
        smallest = left;
      }
      if (
        right < this.#heap.length &&
        comesFirst(this.#heap[right] as ScheduledEvent, this.#heap[smallest] as ScheduledEvent)
      ) {
        smallest = right;
      }
      if (smallest === index) return;
      this.#swap(index, smallest);
      index = smallest;
    }
  }

  #swap(a: number, b: number): void {
    const temp = this.#heap[a] as ScheduledEvent;
    this.#heap[a] = this.#heap[b] as ScheduledEvent;
    this.#heap[b] = temp;
  }
}
