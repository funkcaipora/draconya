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
//
// **Cancelamento preguiçoso (OW-06, #827, ADR 0060 d.5c).** O mundo tem centenas de criaturas
// numa fila só, e cancelar filtrando e reempilhando o heap inteiro custa O(n log n) por morte —
// o Canary cancela evento do dispatcher por id, sem varrer nada. Acima de `indexAbove` eventos a
// fila passa a guardar um índice de pares `(kind, subject)` e cancela por LÁPIDE: o evento fica
// no heap, morto, e quem o encontra no topo o descarta. Abaixo disso — a hunt tem dezenas de
// eventos — não existe índice nenhum: ele custa ~100 bytes por par e uns 40 ns por evento, que é
// mais do que a remoção direta de dezenas de eventos gasta, e a instância é a base econômica do
// jogo (a fila dela fica byte a byte, em CPU e em memória, como era).

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

/**
 * Como a fila desempata eventos com o mesmo `(dueAtMs, priority)`.
 *
 * - `'insertion'` (o default, e o ÚNICO que a instância usa): pela ordem em que foram agendados.
 *   `(dueAtMs, priority, seq)`, byte a byte como sempre foi.
 * - `'stable'` (só o mundo): `(dueAtMs, priority, subject, kind, seq)`. A ordem não depende de
 *   QUANDO o evento entrou na fila, e é o que faz um timer reinserido ao acordar um monstro
 *   dormente cair no mesmo lugar em que estaria se nunca tivesse saído (ADR 0060 d.5c). O `seq`
 *   continua no fim só para a ordem seguir total quando o mesmo `(subject, kind)` tem dois
 *   eventos no mesmo instante e prioridade — e nesse caso eles são indistinguíveis.
 */
export type TieBreak = 'insertion' | 'stable';

export interface ScheduleOptions {
  readonly tieBreak?: TieBreak;
  /**
   * A partir de quantos eventos a fila passa a indexar os pares e a cancelar por lápide
   * (`DEFAULT_INDEX_ABOVE`). Volta a remover direto quando a fila encolhe a um quarto disso.
   * Existe para o teste, que precisa dos dois regimes com poucas dezenas de eventos; `0` indexa
   * sempre.
   */
  readonly indexAbove?: number;
}

export interface ScheduleState {
  /** Em ordem de vencimento, SEM lápides. Ver `getState`. */
  readonly events: readonly ScheduledEvent[];
  readonly nextSeq: number;
  /**
   * A ordem de desempate com que a fila foi montada. Ausente quer dizer `'insertion'`: a chave
   * só é gravada no `'stable'`, e o snapshot da instância fica byte a byte como era. Gravar a
   * escolha no próprio estado é o que impede um snapshot do mundo de ser restaurado, por
   * descuido de quem chama, com a ordem da instância.
   */
  readonly tieBreak?: 'stable';
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
 * O `comesFirst` do `'stable'`: instante, prioridade, subject, kind e só então a sequência.
 *
 * `<` em string compara por unidade de código UTF-16, sem locale nenhum — dois nós em
 * ambientes diferentes ordenam igual, que é o que `localeCompare` não garante.
 */
export function comesFirstStable(a: ScheduledEvent, b: ScheduledEvent): boolean {
  if (a.dueAtMs !== b.dueAtMs) return a.dueAtMs < b.dueAtMs;
  if (a.priority !== b.priority) return a.priority < b.priority;
  if (a.subject !== b.subject) return a.subject < b.subject;
  if (a.kind !== b.kind) return a.kind < b.kind;
  return a.seq < b.seq;
}

/**
 * O tamanho da fila a partir do qual o índice paga o que custa. Remover direto é O(n) com n em
 * dezenas na hunt (~1 µs); o índice é O(1), mas custa memória por par e um acesso a `Map` por
 * evento. O mundo, com centenas de criaturas a vários timers cada, passa disso com folga.
 */
export const DEFAULT_INDEX_ABOVE = 1024;

/**
 * Abaixo disto a varredura de slots ociosos não compensa o custo. O limiar seguinte é o dobro
 * do que sobrou, então a varredura é O(1) amortizado por slot criado.
 */
const MIN_SLOT_SWEEP = 64;

/**
 * Contabilidade de um par `(kind, subject)`: o que permite cancelar sem varrer o heap.
 *
 * É a "geração" do par, só que o relógio dela é o próprio `seq` — que já é único e crescente
 * por agendamento —, e não um contador à parte que o evento precisaria carregar: cancelar grava
 * em `floorSeq` o próximo `seq` a ser dado, e todo evento do par com `seq` menor que isso é
 * lápide. Os agendados depois têm `seq` maior ou igual, então nascem vivos sem ninguém precisar
 * "descancelar" nada. O evento continua com as cinco chaves de sempre: o par dele se acha pelo
 * `kind` e pelo `subject`.
 */
class Slot {
  floorSeq = 0;
  /** Eventos do par ainda na fila e vivos. É o que `cancel` devolve. */
  live = 0;
  /** Lápides do par ainda no heap, esperando o topo ou a compactação. */
  stale = 0;
  /** O slot de outro `kind` do mesmo subject: a lista que `Schedule.#index` percorre. */
  next: Slot | undefined = undefined;
  readonly kind: string;

  constructor(kind: string) {
    this.kind = kind;
  }
}

/**
 * Heap binário mínimo. Não é sofisticação prematura: uma hunt cheia carrega da ordem de cem
 * eventos, e inserir em vetor ordenado custa cem comparações onde o heap custa sete. O custo
 * de tick é o número que a FUN-46 cobra, e é aqui que ele mora agora.
 */
export class Schedule {
  #heap: ScheduledEvent[] = [];
  #nextSeq = 0;
  readonly #stable: boolean;
  readonly #indexAbove: number;
  /**
   * `subject` → o primeiro slot dele; os outros `kind` do subject vêm encadeados em `Slot.next`.
   * `null` enquanto a fila é pequena: nesse regime NÃO há lápide e `#live`, `#stale` e os
   * contadores de slot não valem nada. Um subject tem meia dúzia de `kind`, no máximo: percorrer
   * a lista poupa um `Map` interno por criatura que nasce e uma segunda busca por agendamento.
   */
  #index: Map<string, Slot> | null = null;
  /** Eventos vivos no heap (só no regime indexado). `#live + #stale === #heap.length`. */
  #live = 0;
  /** Lápides no heap (só no regime indexado). */
  #stale = 0;
  #slotCount = 0;
  #sweepAt = MIN_SLOT_SWEEP;

  constructor(options: ScheduleOptions = {}) {
    this.#stable = options.tieBreak === 'stable';
    this.#indexAbove = options.indexAbove ?? DEFAULT_INDEX_ABOVE;
  }

  /**
   * A ordem vem de `options`, depois do próprio estado (que só a grava quando é `'stable'`), e
   * por fim o default. Quem restaura um snapshot do mundo não precisa saber qual é.
   */
  static fromState(state: ScheduleState = EMPTY_SCHEDULE, options: ScheduleOptions = {}): Schedule {
    const schedule = new Schedule({
      ...options,
      tieBreak: options.tieBreak ?? state.tieBreak ?? 'insertion',
    });
    // Reconstrói o heap em vez de confiar na ordem gravada: o vetor do snapshot está ordenado
    // por vencimento (é o que se lê), e ordenado não é a mesma coisa que "é um heap válido"
    // para todo formato — reempilhar custa O(n) e dispensa a confiança.
    for (const event of state.events) schedule.#add(event);
    schedule.#nextSeq = state.nextSeq;
    return schedule;
  }

  get tieBreak(): TieBreak {
    return this.#stable ? 'stable' : 'insertion';
  }

  /** Eventos que ainda vão despachar. Lápide não conta: é a verdade, não o tamanho do vetor. */
  get size(): number {
    return this.#index === null ? this.#heap.length : this.#live;
  }

  /**
   * Lápides esperando no heap. Existe para métrica e teste, como `Session.pendingEvents`: é o
   * que mostra que a compactação roda quando passa da metade e não depois.
   */
  get tombstones(): number {
    return this.#stale;
  }

  /** A fila está no regime indexado (cancelamento por lápide)? Métrica e teste. */
  get indexed(): boolean {
    return this.#index !== null;
  }

  /** Pares `(kind, subject)` com contabilidade guardada. Idem: métrica e teste do vazamento. */
  get trackedSlots(): number {
    return this.#slotCount;
  }

  /**
   * Ordenado por vencimento, e não a ordem interna do heap — e sem lápide: o snapshot descreve
   * o que VAI acontecer, e um evento cancelado nunca vai.
   *
   * O snapshot é lido por gente investigando "por que a hunt parou", e um vetor em ordem de
   * heap não responde nada. Custa um `sort` a cada dez segundos.
   */
  getState(): ScheduleState {
    const events =
      this.#index === null ? [...this.#heap] : this.#heap.filter((event) => !this.#isStale(event));
    events.sort((a, b) => (this.#before(a, b) ? -1 : 1));
    return this.#stable
      ? { events, nextSeq: this.#nextSeq, tieBreak: 'stable' }
      : { events, nextSeq: this.#nextSeq };
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
    this.#add(event);
    return event;
  }

  peek(): ScheduledEvent | undefined {
    if (this.#index !== null) this.#discardStaleTop();
    return this.#heap[0];
  }

  pop(): ScheduledEvent | undefined {
    if (this.#index === null) {
      const top = this.#heap[0];
      if (top === undefined) return undefined;
      this.#removeTop();
      return top;
    }
    for (;;) {
      const top = this.#heap[0];
      if (top === undefined) return undefined;
      const slot = this.#slotOf(top);
      this.#removeTop();
      if (top.seq < slot.floorSeq) {
        // Lápide: sai sem despachar.
        slot.stale--;
        this.#stale--;
        continue;
      }
      slot.live--;
      this.#live--;
      this.#dropIndexIfSmall();
      return top;
    }
  }

  /**
   * Cancela o que casar com `kind` e `subject`. É como um monstro que morre leva os eventos
   * dele junto — sem isso a fila cresceria com o vencimento de criaturas que não existem, e
   * cada uma custaria um despacho para o ruleset descobrir que não há ninguém ali.
   *
   * Na fila pequena remove direto. Na indexada é O(1): vira lápide, e o heap só é tocado
   * quando elas passam da metade dele (ver `#compactIfMostlyStale`) — o que dá O(1) amortizado.
   */
  cancel(kind: string, subject: string): number {
    if (this.#index === null) {
      return this.#removeWhere((event) => event.kind === kind && event.subject === subject);
    }
    const slot = this.#findSlot(kind, subject);
    if (slot === undefined || slot.live === 0) return 0;
    const cancelled = this.#tombstone(slot);
    this.#compactIfMostlyStale();
    this.#dropIndexIfSmall();
    return cancelled;
  }

  /**
   * Quando vence o evento `kind`/`subject` ainda na fila, ou `null` se não há nenhum (nunca foi
   * agendado, já venceu ou foi cancelado). Havendo mais de um, o que vence primeiro.
   *
   * Varredura linear do heap: roda só em evento raro (o desequip de um anel com prazo, #689),
   * nunca por tick. É o que deixa a fila como verdade única do prazo — a instância não guarda
   * `dueAtMs` nenhum. No regime indexado o "não há nenhum" é O(1), e a lápide é ignorada: um
   * evento cancelado não tem prazo.
   */
  dueAtOf(kind: string, subject: string): number | null {
    let floorSeq = 0;
    if (this.#index !== null) {
      const slot = this.#findSlot(kind, subject);
      if (slot === undefined || slot.live === 0) return null;
      floorSeq = slot.floorSeq;
    }
    let dueAt: number | null = null;
    for (const event of this.#heap) {
      if (event.kind !== kind || event.subject !== subject || event.seq < floorSeq) continue;
      if (dueAt === null || event.dueAtMs < dueAt) dueAt = event.dueAtMs;
    }
    return dueAt;
  }

  /** Cancela tudo de um subject, seja qual for o `kind`. */
  cancelSubject(subject: string): number {
    if (this.#index === null) return this.#removeWhere((event) => event.subject === subject);
    let cancelled = 0;
    for (let slot = this.#index.get(subject); slot !== undefined; slot = slot.next) {
      if (slot.live > 0) cancelled += this.#tombstone(slot);
    }
    if (cancelled > 0) {
      this.#compactIfMostlyStale();
      this.#dropIndexIfSmall();
    }
    return cancelled;
  }

  /**
   * Empurra para `untilMs` tudo o que já venceu, descartando o atraso.
   *
   * Só é chamado quando um `advanceBy` estoura o orçamento de eventos — ver
   * `MAX_EVENTS_PER_ADVANCE`. É a mesma política do ADR 0018 aplicada a uma engasgada de
   * processo: o intervalo pulado é descartado, não vira dívida que explode no avanço
   * seguinte. Uma aplicação de recuperação, e o resto vai embora.
   *
   * O heap é reconstruído de qualquer jeito quando há o que empurrar, então é de graça levar as
   * lápides embora junto.
   */
  deferOverdue(untilMs: number): number {
    const indexed = this.#index !== null;
    let deferred = 0;
    for (const event of this.#heap) {
      if (event.dueAtMs < untilMs && !(indexed && this.#isStale(event))) deferred++;
    }
    if (deferred === 0) return 0;
    const rescheduled: ScheduledEvent[] = [];
    for (const event of this.#heap) {
      if (indexed) {
        const slot = this.#slotOf(event);
        if (event.seq < slot.floorSeq) {
          slot.stale--;
          continue;
        }
      }
      rescheduled.push(event.dueAtMs >= untilMs ? event : { ...event, dueAtMs: untilMs });
    }
    this.#heap = rescheduled;
    this.#stale = 0;
    this.#heapify();
    return deferred;
  }

  /** Empilha o evento e, no regime indexado, conta-o no par dele; a fila cresceu demais? Indexa. */
  #add(event: ScheduledEvent): void {
    this.#heap.push(event);
    this.#siftUp(this.#heap.length - 1);
    if (this.#index !== null) {
      this.#slotFor(event.kind, event.subject).live++;
      this.#live++;
    } else if (this.#heap.length > this.#indexAbove) {
      this.#buildIndex();
    }
  }

  /** A fila passou de `indexAbove`: conta o que já está nela. Sem lápide ainda: tudo é vivo. */
  #buildIndex(): void {
    this.#index = new Map();
    this.#slotCount = 0;
    this.#sweepAt = MIN_SLOT_SWEEP;
    this.#stale = 0;
    for (const event of this.#heap) this.#slotFor(event.kind, event.subject).live++;
    this.#live = this.#heap.length;
  }

  /**
   * A fila encolheu a um quarto do limiar: larga o índice, levando as lápides junto. O quarto,
   * e não o próprio limiar, é a histerese: uma fila que oscila em torno de `indexAbove` não pode
   * construir e destruir o índice a cada evento.
   */
  #dropIndexIfSmall(): void {
    if (this.#index === null || this.#live >= this.#indexAbove >> 2) return;
    if (this.#stale > 0) this.#compact();
    this.#index = null;
    this.#live = 0;
    this.#slotCount = 0;
  }

  #findSlot(kind: string, subject: string): Slot | undefined {
    let slot = (this.#index as Map<string, Slot>).get(subject);
    while (slot !== undefined && slot.kind !== kind) slot = slot.next;
    return slot;
  }

  /** O slot de um evento que está no heap: existe, porque o evento o mantém fora da varredura. */
  #slotOf(event: ScheduledEvent): Slot {
    return this.#findSlot(event.kind, event.subject) as Slot;
  }

  #isStale(event: ScheduledEvent): boolean {
    return event.seq < this.#slotOf(event).floorSeq;
  }

  #slotFor(kind: string, subject: string): Slot {
    const index = this.#index as Map<string, Slot>;
    const head = index.get(subject);
    for (let known = head; known !== undefined; known = known.next) {
      if (known.kind === kind) return known;
    }
    // Varre ANTES de criar: o slot recém-criado está ocioso até o evento entrar, e a varredura o
    // levaria embora — e levaria `head` junto, se ele estiver ocioso.
    if (this.#slotCount >= this.#sweepAt) {
      this.#sweepIdleSlots();
      return this.#slotFor(kind, subject);
    }
    const slot = new Slot(kind);
    slot.next = head;
    index.set(subject, slot);
    this.#slotCount++;
    return slot;
  }

  /**
   * Esquece os pares sem nada vivo e sem lápide. Sem isto o mapa cresceria um subject por
   * monstro que já nasceu, para sempre. O slot ocioso NÃO é apagado no `pop`, de propósito: o
   * ciclo típico é o timer vencer e se reagendar no mesmo despacho, e apagar e recriar o slot a
   * cada passo seria o custo que este mecanismo existe para tirar.
   */
  #sweepIdleSlots(): void {
    const index = this.#index as Map<string, Slot>;
    for (const [subject, head] of index) {
      let kept: Slot | undefined;
      for (let slot: Slot | undefined = head; slot !== undefined; ) {
        const next: Slot | undefined = slot.next;
        if (slot.live > 0 || slot.stale > 0) {
          slot.next = kept;
          kept = slot;
        } else {
          this.#slotCount--;
        }
        slot = next;
      }
      if (kept === undefined) index.delete(subject);
      else if (kept !== head) index.set(subject, kept);
    }
    this.#sweepAt = Math.max(MIN_SLOT_SWEEP, this.#slotCount * 2);
  }

  /** Vira lápide tudo o que está vivo no par. Devolve quantos eram. */
  #tombstone(slot: Slot): number {
    const cancelled = slot.live;
    // Todo evento do par agendado até aqui tem `seq` < `#nextSeq`; os próximos terão `>=`.
    slot.floorSeq = this.#nextSeq;
    slot.live = 0;
    slot.stale += cancelled;
    this.#live -= cancelled;
    this.#stale += cancelled;
    return cancelled;
  }

  /**
   * Compacta quando mais da metade do heap é lápide. É o que mantém o custo amortizado: a
   * reconstrução é O(n) e só roda depois de pelo menos n/2 cancelamentos.
   */
  #compactIfMostlyStale(): void {
    if (this.#stale * 2 > this.#heap.length) this.#compact();
  }

  #compact(): void {
    const kept: ScheduledEvent[] = [];
    for (const event of this.#heap) {
      const slot = this.#slotOf(event);
      if (event.seq < slot.floorSeq) slot.stale--;
      else kept.push(event);
    }
    this.#heap = kept;
    this.#stale = 0;
    this.#heapify();
  }

  /** Lápide no topo não é evento: sai sem despachar. */
  #discardStaleTop(): void {
    for (;;) {
      const top = this.#heap[0];
      if (top === undefined) return;
      const slot = this.#slotOf(top);
      if (top.seq >= slot.floorSeq) return;
      this.#removeTop();
      slot.stale--;
      this.#stale--;
    }
  }

  /** Remove direto o que casar (regime pequeno) e devolve quantos eram. */
  #removeWhere(matches: (event: ScheduledEvent) => boolean): number {
    const before = this.#heap.length;
    const kept = this.#heap.filter((event) => !matches(event));
    if (kept.length === before) return 0;
    this.#heap = kept;
    this.#heapify();
    return before - kept.length;
  }

  /** Tira o topo do heap, vivo ou lápide. Quem chama ajusta os contadores. */
  #removeTop(): void {
    const last = this.#heap.pop() as ScheduledEvent;
    if (this.#heap.length > 0) {
      this.#heap[0] = last;
      this.#siftDown(0);
    }
  }

  /** `a` vence antes de `b`, na ordem de desempate desta fila. */
  #before(a: ScheduledEvent, b: ScheduledEvent): boolean {
    return this.#stable ? comesFirstStable(a, b) : comesFirst(a, b);
  }

  /** Reempilha o vetor inteiro em O(n) (Floyd). */
  #heapify(): void {
    for (let index = (this.#heap.length >> 1) - 1; index >= 0; index--) this.#siftDown(index);
  }

  #siftUp(from: number): void {
    let index = from;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.#before(this.#heap[index] as ScheduledEvent, this.#heap[parent] as ScheduledEvent)) {
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
        this.#before(this.#heap[left] as ScheduledEvent, this.#heap[smallest] as ScheduledEvent)
      ) {
        smallest = left;
      }
      if (
        right < this.#heap.length &&
        this.#before(this.#heap[right] as ScheduledEvent, this.#heap[smallest] as ScheduledEvent)
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
