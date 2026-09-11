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
}

export interface BotState {
  readonly draft: BotDraft;
  readonly save: SaveState;
  /** O motivo da recusa, em palavras do servidor. `null` quando não há. */
  readonly reason: string | null;
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
  };
}

export const INITIAL_BOT: BotState = { draft: emptyDraft(), save: 'idle', reason: null };

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
  }));
}

/** Muda o rascunho. Qualquer mudança tira o "salvo" da tela: o que está lá deixou de valer. */
export function edit(produce: (draft: BotDraft) => BotDraft): void {
  bot.set((state) => ({ ...state, draft: produce(state.draft), save: 'idle', reason: null }));
}

/** O inverso de `toConfig`: a configuração como o servidor a guarda, de volta a rascunho. */
export function draftFrom(config: BotConfig): BotDraft {
  const rules = {} as Record<BotCategory, readonly BotRule[]>;
  for (const category of BOT_CATEGORIES) rules[category] = config[category];
  return { rules, exit: config.exit, targeting: config.targeting };
}

/** Um rascunho em que ninguém escreveu nada: o que `emptyDraft()` devolve, campo a campo. */
export function isPristine(draft: BotDraft): boolean {
  return JSON.stringify(draft) === JSON.stringify(emptyDraft());
}

/**
 * A configuração EM VIGOR chegou do servidor, no `session-state` (FUN-111).
 *
 * Ela vira o rascunho só quando o rascunho não tem nada a perder: pristino (a tela acabou de
 * abrir) ou salvo (o que está nela É o que o servidor tem). Um rascunho editado e não salvo
 * fica — uma reconexão no meio da digitação não pode apagar o que o jogador escreveu, pela
 * mesma razão que uma recusa não apaga (`botResult`). Configuração que não passa no schema
 * — um vocabulário que este cliente não fala — é ignorada, e a tela continua como estava.
 */
export function loadConfig(raw: unknown): void {
  const parsed = botConfigSchema.safeParse(raw);
  if (!parsed.success) return;
  bot.set((state) => {
    if (state.save !== 'saved' && !isPristine(state.draft)) return state;
    return { draft: draftFrom(parsed.data), save: 'saved', reason: null };
  });
}
