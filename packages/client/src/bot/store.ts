// O rascunho da configuração do bot, e o que o servidor disse dela (FUN-89).
//
// **Salvar é uma INTENÇÃO.** O estado "salvo" só vira verdade quando o servidor confirma — e uma
// recusa NÃO descarta o que o jogador escreveu. Descartar seria a pior resposta possível a
// "corrija isto": apagar justamente o que precisa ser corrigido.
//
// Store própria pela mesma razão que a conta tem a dela (ADR 0007): editar o bot é uma sessão
// inteira de digitação, e o HP mexendo no meio não pode redesenhar um campo de texto.

import { BOT_CATEGORIES, BOT_VOCABULARY_VERSION, botConfigSchema } from '@draconya/content';
import type { BotCategory, BotConfig, BotRule } from '@draconya/content';
import { createStore } from '../state/hud.js';
import { DEFAULT_HP_BELOW_PERCENT, setHpBelowPercent, toggleExitRule } from './exit-rules.js';
import type { ExitRuleKind } from './exit-rules.js';

export type SaveState =
  /** Nada foi mandado desde a última mudança. */
  | 'idle'
  /** Mandado, esperando o servidor. */
  | 'pending'
  | 'saved'
  | 'refused';

export interface BotDraft {
  readonly rules: Readonly<Record<BotCategory, readonly BotRule[]>>;
  readonly exit: BotConfig['exit'];
  readonly targeting: BotConfig['targeting'];
  /**
   * O bot AVANÇADO (§13.2, FUN-87): `lure` e `ringSwap`, que nenhuma tela edita ainda. Passam
   * OPACOS pelo rascunho — do servidor (`loadConfig`) de volta ao servidor (`toConfig`) — para
   * um "Salvar" de quem só mexeu na cura não apagar o anel que a hunt está trocando. Sem isto,
   * a tela carregava uma cópia com perda e a chamava de "salvo".
   */
  readonly advanced: Pick<BotConfig, 'lure' | 'ringSwap'>;
}

export interface BotState {
  readonly draft: BotDraft;
  readonly save: SaveState;
  /** O motivo da recusa, em palavras do servidor. `null` quando não há. */
  readonly reason: string | null;
  /**
   * Se o jogador ESCREVEU no rascunho desde a última vez que ele bateu com o servidor. É o que
   * `loadConfig` consulta antes de substituir: um rascunho tocado e não salvo fica, mesmo que
   * o jogador o tenha apagado até ficar igual ao vazio — "vazio" e "intocado" não são a mesma
   * coisa, e comparar a forma confundia os dois.
   */
  readonly touched: boolean;
}

/** Um rascunho vazio: cinco categorias sem regra nenhuma. */
export function emptyDraft(): BotDraft {
  const rules = Object.fromEntries(
    BOT_CATEGORIES.map((category) => [category, [] as readonly BotRule[]]),
  ) as Record<BotCategory, readonly BotRule[]>;
  return {
    rules,
    exit: [],
    targeting: {
      policy: 'nearest',
      prioritize: [],
      ignore: [],
      posture: { kind: 'stand' },
    },
    advanced: {},
  };
}

export const INITIAL_BOT: BotState = {
  draft: emptyDraft(), save: 'idle', reason: null, touched: false,
};

export const bot = createStore<BotState>(INITIAL_BOT);

/**
 * O que o rascunho vira na hora de mandar.
 *
 * A ORDEM dos slots É a prioridade (§13.4): o primeiro de cima é o que executa. Por isso a
 * lista viaja como está — reordenar aqui mudaria o comportamento sem o jogador ter pedido.
 */
export function toConfig(draft: BotDraft): BotConfig {
  return {
    version: BOT_VOCABULARY_VERSION,
    targeting: draft.targeting,
    exit: draft.exit,
    ...draft.advanced,
    ...Object.fromEntries(
      BOT_CATEGORIES.map((category) => [category, draft.rules[category]]),
    ),
  } as BotConfig;
}

/** O servidor respondeu (FUN-89). O rascunho FICA em qualquer um dos dois casos. */
export function botResult(ok: boolean, reason: string | null): void {
  bot.set((state) => ({
    ...state,
    save: ok ? 'saved' : 'refused',
    reason: ok ? null : reason,
    // Aceito é "bate com o servidor": o que está no rascunho é o que ele tem. Recusado
    // continua tocado — é justamente o que o jogador precisa corrigir.
    touched: ok ? false : state.touched,
  }));
}

/** Muda o rascunho. Qualquer mudança tira o "salvo" da tela: o que está lá deixou de valer. */
export function edit(produce: (draft: BotDraft) => BotDraft): void {
  bot.set((state) => ({
    ...state, draft: produce(state.draft), save: 'idle', reason: null, touched: true,
  }));
}

/** Quanto tempo o painel espera antes de mandar (#162): dois toques seguidos viram UMA mensagem. */
export const SAVE_DEBOUNCE_MS = 300;

/** Quem manda a configuração. Injetável: o painel liga ao socket, o teste anota. */
export type ConfigSender = (config: BotConfig) => boolean;

let sender: ConfigSender | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** O painel liga o socket aqui uma vez; a store não importa `net/` (ADR 0007 — o socket fica fora do render). */
export function setConfigSender(next: ConfigSender | null): void {
  sender = next;
}

/**
 * Agenda um `bot-config` com o rascunho atual (#162, DT-01): o interruptor salva sozinho, sem
 * botão. Debounce porque o servidor grava a configuração INTEIRA (ADR 0021) — três toques em
 * 300 ms são uma gravação, não três. Sem conexão a mensagem não sai: o rascunho fica `touched`
 * e o próximo toque agenda de novo.
 */
export function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushSave();
  }, SAVE_DEBOUNCE_MS);
}

/** Manda agora o que está agendado (o "Salvar" do editor, e o teste). */
export function flushSave(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
  bot.set((state) => ({ ...state, save: 'pending', reason: null }));
  const sent = sender?.(toConfig(bot.get().draft)) ?? false;
  if (!sent) {
    bot.set((state) => ({ ...state, save: 'refused', reason: 'Sem conexão. Tente de novo.' }));
  }
}

/** Liga ou desliga uma regra (#162) e salva. A regra fica no slot; só sai da avaliação. */
export function toggleRule(category: BotCategory, index: number): void {
  edit((draft) => ({
    ...draft,
    rules: {
      ...draft.rules,
      [category]: draft.rules[category].map((rule, i) => (i === index ? { ...rule, enabled: rule.enabled === false } : rule)),
    },
  }));
  scheduleSave();
}

/** Move uma regra uma posição (#162): reordenar é configurar, e salva. */
export function moveRule(category: BotCategory, index: number, by: number): void {
  edit((draft) => {
    const list = [...draft.rules[category]];
    const to = index + by;
    if (to < 0 || to >= list.length) return draft;
    const [moved] = list.splice(index, 1);
    if (moved !== undefined) list.splice(to, 0, moved);
    return { ...draft, rules: { ...draft.rules, [category]: list } };
  });
  scheduleSave();
}

/** Tira uma regra (#162) e salva. */
export function removeRule(category: BotCategory, index: number): void {
  edit((draft) => ({
    ...draft,
    rules: { ...draft.rules, [category]: draft.rules[category].filter((_, i) => i !== index) },
  }));
  scheduleSave();
}

/** Liga, desliga ou reescreve uma regra de saída (#260) e salva — o mesmo debounce do interruptor de regra. */
export function setExitRule(kind: ExitRuleKind, on: boolean, percent = DEFAULT_HP_BELOW_PERCENT): void {
  edit((draft) => ({ ...draft, exit: toggleExitRule(draft.exit, kind, on, percent) }));
  scheduleSave();
}

/** Reescreve só o percentual de `hp-below` (#260) e salva; as outras regras de saída ficam como estavam. */
export function setExitHpBelowPercent(percent: number): void {
  edit((draft) => ({ ...draft, exit: setHpBelowPercent(draft.exit, percent) }));
  scheduleSave();
}

/** Escreve (ou acrescenta, com `index === null`) uma regra inteira (#162) e salva agora: é o "Salvar" do editor. */
export function putRule(category: BotCategory, index: number | null, rule: BotRule): void {
  edit((draft) => ({
    ...draft,
    rules: {
      ...draft.rules,
      [category]: index === null
        ? [...draft.rules[category], rule]
        : draft.rules[category].map((r, i) => (i === index ? rule : r)),
    },
  }));
  flushSave();
}

/**
 * O inverso de `toConfig`: a configuração como o servidor a guarda, de volta a rascunho — e a
 * volta inteira, `lure` e `ringSwap` inclusive, para `toConfig(draftFrom(c))` ser `c`.
 */
export function draftFrom(config: BotConfig): BotDraft {
  const rules = {} as Record<BotCategory, readonly BotRule[]>;
  for (const category of BOT_CATEGORIES) rules[category] = config[category];
  return {
    rules,
    exit: config.exit,
    targeting: config.targeting,
    advanced: {
      ...(config.lure === undefined ? {} : { lure: config.lure }),
      ...(config.ringSwap === undefined ? {} : { ringSwap: config.ringSwap }),
    },
  };
}

/**
 * A configuração EM VIGOR chegou do servidor, no `session-state` (FUN-111).
 *
 * Ela vira o rascunho só quando o rascunho não tem nada a perder: intocado (a tela acabou de
 * abrir) ou salvo (o que está nela É o que o servidor tem). Um rascunho tocado e não salvo —
 * editado, pendente ou recusado — fica: uma reconexão no meio da digitação não pode apagar o
 * que o jogador escreveu, pela mesma razão que uma recusa não apaga (`botResult`).
 * Configuração que não passa no schema — um vocabulário que este cliente não fala — é
 * ignorada, e a tela continua como estava.
 */
export function loadConfig(raw: unknown): void {
  const parsed = botConfigSchema.safeParse(raw);
  if (!parsed.success) return;
  bot.set((state) => {
    if (state.touched && state.save !== 'saved') return state;
    return { draft: draftFrom(parsed.data), save: 'saved', reason: null, touched: false };
  });
}
