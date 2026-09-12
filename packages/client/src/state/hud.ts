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
 * O que este servidor tem: hunts (FUN-79) e vocabulário do bot (FUN-89).
 *
 * Uma coisa só porque chega numa mensagem só — as duas telas perguntam "o que existe aqui", e
 * mudam pela mesma razão: a versão de conteúdo, fixada na sessão (invariante 7).
 *
 * A hunt vem sem estimativa de XP/h nem de gold/h, e não por esquecimento: o campo não existe
 * no protocolo. Ver o comentário de `catalogue` lá.
 */
export type Catalogue = S2CProps<'catalogue'>;
export type HuntListing = Catalogue['hunts'][number];
export type BotVocabulary = Catalogue['bot'];
export type ItemDefinition = Catalogue['items'][number];
export type MonsterListing = Catalogue['monsters'][number];
/** Os marcos e o bônus por marco (§18). Ausente do catálogo: o servidor não tem Bestiário. */
export type BestiaryConfig = NonNullable<Catalogue['bestiary']>;

/**
 * O Bestiário do personagem (§18, FUN-113): `id do monstro → abates`, permanente.
 *
 * Derivado do protocolo, como os agregados. É o valor INTEIRO que o servidor manda — um
 * contador que nunca desce —, então a tela não soma nada: cada mensagem substitui a anterior.
 */
export type BestiaryCounts = Readonly<S2CProps<'bestiary'>['counts']>;

/**
 * O que o personagem carrega e veste (§21.5, FUN-90).
 *
 * `null` até chegar. Uma mochila que abre vazia mente: "ainda não sei" e "não tem nada" são
 * coisas diferentes, e a primeira é o estado normal do primeiro segundo de conexão.
 */
export type Inventory = S2CProps<'inventory'>;

/**
 * O analisador (§16.1, §16.2, FUN-83).
 *
 * **`receivedAtMs` é o instante local em que este pacote chegou**, e é ele que faz o relógio
 * andar entre duas entregas — `session-state` ou `analyzer` (FUN-110), que o recarimba junto
 * com os números. Sem isso, o tempo de hunt ficaria congelado entre uma
 * atualização e outra — e o "por hora", que é uma divisão por ele, ficaria congelado junto.
 *
 * **É `performance.now()`, o relógio de `applyMessage`, e não `Date.now()`.** Quem lê este
 * campo tem que subtrair do MESMO relógio: misturar os dois deu "496968 h" na janela, que é
 * a época Unix em horas — o sintoma de subtrair um instante monotônico de um de calendário.
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
  /** A munição escolhida por família (#152): `null` é a grátis. Chega em `player-stats`. */
  readonly ammo: { readonly arrow: string | null; readonly bolt: string | null };

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
   * O que existe para caçar e para configurar (FUN-79, FUN-89). Chega uma vez, depois do
   * `welcome`.
   *
   * `null` até chegar — e as telas mostram isso como "carregando", não como "não há nada".
   * Vazio e ausente são coisas diferentes, e colapsá-los faria a tela mentir durante o
   * primeiro segundo de toda conexão.
   */
  readonly catalogue: Catalogue | null;

  /** A mochila, o equipado e o peso — tudo calculado pelo servidor (FUN-90). */
  readonly inventory: Inventory | null;

  /**
   * Abates por monstro (§18, FUN-113). Chega no attach e sempre que um contador muda.
   *
   * `null` até chegar, pela mesma razão do inventário: um Bestiário que abre em zero afirma
   * "nunca matou nada", e o servidor ainda não disse isso — é o primeiro segundo de toda
   * conexão, e um nó anterior à FUN-113 nunca manda. Monstro sem entrada é zero de verdade:
   * o `sim` não grava zero para todo monstro do conteúdo.
   */
  readonly bestiary: BestiaryCounts | null;
}

export const INITIAL_HUD: HudState = {
  characterId: null,
  contentVersion: null,
  health: 0, maxHealth: 0,
  mana: 0, maxMana: 0,
  level: 0, xp: 0,
  capacity: 0, gold: 0, staminaMs: 0,
  ammo: { arrow: null, bolt: null },
  latencyMs: null,
  connection: 'idle',
  chat: [],
  systemMessages: [],
  analyzer: INITIAL_ANALYZER,
  catalogue: null,
  inventory: null,
  bestiary: null,
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
