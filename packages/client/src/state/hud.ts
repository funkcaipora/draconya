// Estado do HUD: o que uma pessoa lê como texto ou barra (FUN-22).
//
// A diferença para `world.ts` é a razão de os dois existirem: aqui há assinatura, porque HP e
// gold precisam chegar ao DOM; lá não há, porque posição de criatura não pode.
//
// A assinatura é por FATIA e não pelo estado inteiro. Notificar todo mundo a cada mudança
// devolveria o problema que o ADR 0007 evita: o painel de inventário re-renderizando porque a
// mana mexeu.

import type { S2CProps } from '@draconya/protocol';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  /** Socket aberto e estado recebido. */
  | 'connected'
  /** Caiu e vai voltar sozinho — reconectar é REANEXAR, não logar de novo. */
  | 'reconnecting'
  /** Desistiu, ou o servidor recusou de um jeito que tentar de novo não resolve. */
  | 'failed';

/** Uma linha de chat já pronta para desenhar. */
export interface ChatLine {
  readonly channel: string;
  readonly author: string;
  readonly text: string;
  readonly atMs: number;
}

export interface SystemLine {
  readonly level: 'info' | 'warning' | 'error';
  readonly text: string;
  readonly atMs: number;
}

/**
 * O que a hunt rendeu, como o servidor mandou (§16.1), e a lista curta do §16.2.
 *
 * **Derivados do protocolo, não redeclarados.** Uma cópia à mão aqui divergiria no primeiro
 * campo novo — e divergiria em SILÊNCIO, porque `decodeS2C` devolve `null` sem erro quando a
 * mensagem não bate. Alguns campos dos agregados são opcionais de propósito (FUN-78): um nó
 * `game` antigo, em deploy em rolagem, manda sem eles, e a janela mostra "—" no lugar. Zero
 * seria uma afirmação, e o servidor não afirmou nada.
 */
export type Aggregates = S2CProps<'session-state'>['aggregates'];
export type NotableEvent = S2CProps<'session-state'>['notableEvents'][number];

/**
 * Uma hunt como a tela de seleção a mostra (§14.3, FUN-79).
 *
 * Sem estimativa de XP/h nem de gold/h, e não por esquecimento: o campo não existe no
 * protocolo. Ver o comentário de `hunt-catalogue` lá.
 */
export type HuntListing = S2CProps<'hunt-catalogue'>['hunts'][number];

/**
 * O analisador (§16.1, §16.2, FUN-83).
 *
 * **`receivedAtMs` é o instante local em que este pacote chegou**, e é ele que faz o relógio
 * andar entre dois `session-state`. Sem isso, o tempo de hunt ficaria congelado entre uma
 * atualização e outra — e o "por hora", que é uma divisão por ele, ficaria congelado junto.
 */
export interface AnalyzerState {
  readonly sessionType: string | null;
  readonly aggregates: Aggregates | null;
  readonly notableEvents: readonly NotableEvent[];
  readonly receivedAtMs: number;
  /** A sessão já acabou? Aí o relógio PARA: o extrato é definitivo. */
  readonly ended: boolean;
}

export const INITIAL_ANALYZER: AnalyzerState = {
  sessionType: null,
  aggregates: null,
  notableEvents: [],
  receivedAtMs: 0,
  ended: false,
};

export interface HudState {
  readonly characterId: string | null;
  /** Versão de conteúdo fixada na sessão (invariante 7). Útil para depurar divergência. */
  readonly contentVersion: string | null;

  readonly health: number;
  readonly maxHealth: number;
  readonly mana: number;
  readonly maxMana: number;
  readonly level: number;
  readonly xp: number;
  readonly capacity: number;
  readonly gold: number;
  readonly staminaMs: number;

  /** Ida e volta medida pelo `ping`/`pong`, ou `null` enquanto não houve nenhum. */
  readonly latencyMs: number | null;

  /**
   * Estado da conexão, e ele PRECISA ser visível na tela.
   *
   * Um jogo idle silencioso é indistinguível de um jogo travado: sem indicador, o jogador não
   * tem como saber se a hunt está rendendo ou se o socket caiu há dez minutos.
   */
  readonly connection: ConnectionStatus;

  readonly chat: readonly ChatLine[];
  readonly systemMessages: readonly SystemLine[];

  /** O analisador. Fatia própria para a janela não re-renderizar quando o HP mexe. */
  readonly analyzer: AnalyzerState;

  /**
   * O que existe para caçar (FUN-79). Chega uma vez, logo depois do `welcome`.
   *
   * Vazio até chegar — e a tela mostra isso como "carregando", não como "não há hunt".
   */
  readonly hunts: readonly HuntListing[];
}

export const INITIAL_HUD: HudState = {
  characterId: null,
  contentVersion: null,
  health: 0, maxHealth: 0,
  mana: 0, maxMana: 0,
  level: 0, xp: 0,
  capacity: 0, gold: 0, staminaMs: 0,
  latencyMs: null,
  connection: 'idle',
  chat: [],
  systemMessages: [],
  analyzer: INITIAL_ANALYZER,
  hunts: [],
};

/**
 * A derivada "por hora" (§16.1), calculada NO CLIENTE.
 *
 * O servidor não manda número redundante (FUN-78): mandar `xpGained` e `xpPerHour` é mandar o
 * mesmo número duas vezes, e os dois divergem na primeira pausa entre calcular e enviar.
 *
 * Duração zero devolve zero, e não infinito: uma hunt que acabou de começar não rendeu "infinito
 * por hora", ela ainda não tem taxa.
 */
export function perHour(value: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return (value * 3_600_000) / durationMs;
}

/**
 * Teto de linhas guardadas. Chat de MMORPG roda o dia inteiro; sem teto, o array cresce até a
 * aba engasgar, e o sintoma aparece horas depois como "o jogo fica lento com o tempo".
 */
export const MAX_LINES = 200;

export interface Store<T> {
  get(): T;
  /** Substitui o estado. O produtor devolve o novo a partir do atual. */
  set(produce: (current: T) => T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let current = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => current,
    set(produce) {
      const next = produce(current);
      // Produzir o mesmo objeto significa "nada mudou". Notificar assim mesmo faria toda
      // fatia recalcular à toa, que é o custo que este módulo existe para não ter.
      if (Object.is(next, current)) return;
      current = next;
      // Cópia da lista: um ouvinte que se desinscreve durante a notificação não pode
      // corromper a iteração em curso.
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const hud = createStore<HudState>(INITIAL_HUD);

export interface SliceOptions {
  /**
   * Janela mínima entre avisos, em ms. `0` avisa em toda mudança.
   *
   * Serve a valor contínuo: numa luta, o HP muda 60 vezes por segundo numa barra que anda 3
   * pixels. O primeiro aviso sai na hora — travar o início atrasaria a reação visível — e os
   * seguintes são agrupados, com o ÚLTIMO valor sempre entregue no fim da janela.
   */
  readonly throttleMs?: number;
}

/**
 * Assina uma fatia. Só avisa quando o valor SELECIONADO muda.
 *
 * É aqui que "fatia estreita" deixa de ser recomendação: um assinante de `hp` não é avisado
 * quando a mana muda, porque a comparação acontece depois do seletor, não antes.
 */
export function subscribeSlice<T, S>(
  store: Store<T>,
  select: (state: T) => S,
  onChange: () => void,
  options: SliceOptions = {},
): () => void {
  const throttleMs = options.throttleMs ?? 0;
  let last = select(store.get());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastEmitMs = Number.NEGATIVE_INFINITY;

  const emit = (): void => {
    lastEmitMs = Date.now();
    timer = null;
    onChange();
  };

  const unsubscribe = store.subscribe(() => {
    const next = select(store.get());
    if (Object.is(next, last)) return;
    last = next;

    if (throttleMs <= 0) {
      onChange();
      return;
    }
    // Já existe um aviso agendado: o valor novo entra nele. Quem lê chama o seletor de novo
    // e recebe o mais recente, então agrupar não perde atualização — só perde a intermediária.
    if (timer !== null) return;

    const sinceLast = Date.now() - lastEmitMs;
    if (sinceLast >= throttleMs) {
      emit();
      return;
    }
    timer = setTimeout(emit, throttleMs - sinceLast);
  });

  return () => {
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
  };
}

/** Acrescenta ao fim respeitando o teto, sem mutar o array anterior. */
export function appendCapped<T>(lines: readonly T[], line: T): readonly T[] {
  const next = [...lines, line];
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}
