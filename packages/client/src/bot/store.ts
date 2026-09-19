// O rascunho da configuração do bot, e o que o servidor disse dela (FUN-89, AB-10).
//
// **Salvar é uma INTENÇÃO.** O estado "salvo" só vira verdade quando o servidor confirma — e uma
// recusa NÃO descarta o que o jogador escreveu. Descartar seria a pior resposta possível a
// "corrija isto": apagar justamente o que precisa ser corrigido.
//
// Store própria pela mesma razão que a conta tem a dela (ADR 0007): editar o bot é uma sessão
// inteira de digitação, e o HP mexendo no meio não pode redesenhar um campo de texto.
//
// **Vocabulário v2 (AB-03/#418, ADR 0032 d.1).** As cinco categorias do bot v1 saíram: a barra
// de ações é a configuração, e ela é `sets[4] × slots[24]` com `activeSet`, `stance` e as
// automações. O rascunho lê a MESMA configuração que o servidor grava (ADR 0021), então migrar
// aqui foi obrigatório para a barra e o motor não divergirem sobre o que um slot significa.

import { BOT_SET_COUNT, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema } from '@draconya/content';
import type {
  BotConfigV2, BotPosture, BotSlot, BotStance, BotTargetPolicy, BotTargeting,
} from '@draconya/content';
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
  /** Os quatro conjuntos (loadouts) de 24 slots — a configuração inteira (ADR 0032 d.1/d.4). */
  readonly sets: BotConfigV2['sets'];
  /** Qual conjunto a barra desenha e o `use-slot` dispara. */
  readonly activeSet: BotConfigV2['activeSet'];
  /** A postura de combate (offensive/balanced/defensive). */
  readonly stance: BotStance;
  readonly automations: BotConfigV2['automations'];
  readonly targeting: BotTargeting;
  readonly exit: BotConfigV2['exit'];
  /**
   * O lure dinâmico (SV-09, §13.8): histerese min/max. `undefined` até o jogador tocar — é
   * assim que o bot básico continua sem lure algum.
   */
  readonly lure?: BotConfigV2['lure'];
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

/** Quatro conjuntos de 24 posições vazias, mais o `targeting`/`stance` de sempre. */
export function emptyDraft(): BotDraft {
  return {
    sets: Array.from({ length: BOT_SET_COUNT }, () => ({
      slots: Array.from({ length: BOT_SLOTS_PER_SET }, () => null as BotSlot | null),
    })),
    activeSet: 0,
    stance: 'balanced',
    automations: [],
    targeting: {
      policy: 'nearest',
      prioritize: [],
      ignore: [],
      posture: { kind: 'stand' },
    },
    exit: [],
    lure: undefined,
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
export function toConfig(draft: BotDraft): BotConfigV2 {
  return {
    version: BOT_VOCABULARY_VERSION,
    activeSet: draft.activeSet,
    sets: draft.sets,
    automations: draft.automations,
    stance: draft.stance,
    targeting: draft.targeting,
    exit: draft.exit,
    ...(draft.lure === undefined ? {} : { lure: draft.lure }),
  };
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

/** Quanto tempo a barra espera antes de mandar (#162): dois toques seguidos viram UMA mensagem. */
export const SAVE_DEBOUNCE_MS = 300;

/** Quem manda a configuração. Injetável: a barra liga ao socket, o teste anota. */
export type ConfigSender = (config: BotConfigV2) => boolean;

let sender: ConfigSender | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** A barra liga o socket aqui uma vez; a store não importa `net/` (ADR 0007 — o socket fica fora do render). */
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

/** Troca o conjunto ATIVO (CONJUNTO da barra, ADR 0032 d.4) e salva com debounce. */
export function setActiveSet(id: number): void {
  edit((draft) => ({ ...draft, activeSet: id }));
  scheduleSave();
}

/**
 * Liga/desliga a chave "automática" de UM slot do conjunto ativo (Shift+clique, UC-BAR-005) e
 * salva com debounce. Slot vazio não tem o que desligar: a intenção é ignorada.
 */
export function setSlotAuto(slot: number, auto: boolean): void {
  edit((draft) => {
    const set = draft.sets[draft.activeSet];
    const entry = set?.slots[slot];
    if (set === undefined || entry === null || entry === undefined) return draft;
    const slots = set.slots.map((current, index) => (index === slot ? { ...entry, auto } : current));
    const sets = draft.sets.map((current, index) => (index === draft.activeSet ? { slots } : current));
    return { ...draft, sets };
  });
  scheduleSave();
}

/**
 * Grava UM slot do conjunto e manda `bot-config` AGORA (o "Salvar" do `ActionConfigModal`,
 * AB-11/#426). Diferente do interruptor/`setSlotAuto`, que salva com debounce: o modal tem um
 * botão de Salvar explícito, e o jogador espera a intenção sair no clique. `null` limpa o slot.
 */
export function setSlot(set: number, index: number, slot: BotSlot | null): void {
  edit((draft) => ({
    ...draft,
    sets: draft.sets.map((current, i) => (i === set
      ? { slots: current.slots.map((entry, j) => (j === index ? slot : entry)) }
      : current)),
  }));
  flushSave();
}

/** Liga, desliga ou reescreve uma regra de saída (#260) e salva — o mesmo debounce do conjunto. */
export function setExitRule(kind: ExitRuleKind, on: boolean, percent = DEFAULT_HP_BELOW_PERCENT): void {
  edit((draft) => ({ ...draft, exit: toggleExitRule(draft.exit, kind, on, percent) }));
  scheduleSave();
}

/** Reescreve só o percentual de `hp-below` (#260) e salva; as outras regras de saída ficam como estavam. */
export function setExitHpBelowPercent(percent: number): void {
  edit((draft) => ({ ...draft, exit: setHpBelowPercent(draft.exit, percent) }));
  scheduleSave();
}

/**
 * O inverso de `toConfig`: a configuração como o servidor a guarda, de volta a rascunho — e a
 * volta inteira, `lure` inclusive, para `toConfig(draftFrom(c))` ser `c`.
 */
export function draftFrom(config: BotConfigV2): BotDraft {
  return {
    sets: config.sets,
    activeSet: config.activeSet,
    stance: config.stance,
    automations: config.automations,
    targeting: config.targeting,
    exit: config.exit,
    ...(config.lure === undefined ? {} : { lure: config.lure }),
  };
}

/** Edita o lure dinâmico (SV-09, §13.8) e salva com debounce. `undefined` volta o bot a não usar lure. */
export function setLure(lure: BotConfigV2['lure']): void {
  edit((draft) => ({ ...draft, lure }));
  scheduleSave();
}

/** Troca a política de escolha de alvo (§13.6) e salva com debounce. */
export function setTargetingPolicy(policy: BotTargetPolicy): void {
  edit((draft) => ({ ...draft, targeting: { ...draft.targeting, policy } }));
  scheduleSave();
}

/** Reescreve a lista de monstros priorizados (§13.6) e salva com debounce. */
export function setPrioritize(prioritize: readonly string[]): void {
  edit((draft) => ({ ...draft, targeting: { ...draft.targeting, prioritize: [...prioritize] } }));
  scheduleSave();
}

/** Reescreve a lista de monstros ignorados (§13.6) e salva com debounce. */
export function setIgnore(ignore: readonly string[]): void {
  edit((draft) => ({ ...draft, targeting: { ...draft.targeting, ignore: [...ignore] } }));
  scheduleSave();
}

/** Troca a postura (§13.6) — parado, seguir, ou manter distância (com `tiles`) — e salva com debounce. */
export function setPosture(posture: BotPosture): void {
  edit((draft) => ({ ...draft, targeting: { ...draft.targeting, posture } }));
  scheduleSave();
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
  const parsed = botConfigV2Schema.safeParse(raw);
  if (!parsed.success) return;
  bot.set((state) => {
    if (state.touched && state.save !== 'saved') return state;
    return { draft: draftFrom(parsed.data), save: 'saved', reason: null, touched: false };
  });
}
