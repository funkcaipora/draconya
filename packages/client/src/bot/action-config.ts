// O rascunho de UM slot da barra de ações e a validação que o `ActionConfigModal` (AB-11, #426)
// usa antes de mandar `bot-config`. PURO: sem React, sem store e sem socket — o mesmo molde de
// `action-bar.ts` e `exit-rules.ts`.
//
// **A tela não decide elegibilidade, cooldown nem estoque** (invariante 4): ela monta o
// vocabulário fechado do conteúdo e valida só o que o jogador consegue ver — faixa de um valor
// e unicidade de tecla no conjunto. Quem decide se a configuração vale é o servidor, e a recusa
// chega tipada em `bot-config-result`.
//
// **Adaptação de forma (AB-10/#425).** O vocabulário v2 real (`BotVocabulary` em `state/hud.ts`)
// não publica os tipos de condição nem os efeitos — o catálogo de efeitos chega com o motor
// (AB-07). Por isso os tipos oferecidos saem de `BOT_CONDITION_KINDS_V2` (a fonte única em
// `@draconya/content`), e `condition` fica de fora enquanto não houver efeito para escolher: a
// tela não inventa lista.

import { BOT_CONDITION_KINDS_V2 } from '@draconya/content';
import type {
  BotActionV2, BotConditionKindV2, BotConditionV2, BotConfigV2, BotHotkey, BotOperator, BotSlot,
} from '@draconya/content';

/** Um conjunto da configuração v2 — a assinatura de `hotkeyConflict`/`draftProblem`. */
export type BotSet = BotConfigV2['sets'][number];

/**
 * O rascunho local de um slot. `do: null` é o slot vazio — o schema do slot não aceita ausência
 * de ação, então a ausência vive aqui e `slotFromDraft` é quem materializa (DT-01).
 */
export interface SlotDraft {
  readonly do: BotActionV2 | null;
  readonly when: readonly BotConditionV2[];
  readonly hotkey?: BotHotkey;
  readonly auto: boolean;
}

/**
 * Os tipos de condição que a tela oferece. `condition` (efeito presente/ausente) só entra quando
 * o catálogo expuser os efeitos: sem eles não há `conditionId` para escolher, e uma lista
 * inventada faria o jogador configurar o que o servidor não conhece.
 */
export const OFFERED_CONDITION_KINDS: readonly BotConditionKindV2[] =
  BOT_CONDITION_KINDS_V2.filter((kind) => kind !== 'condition');

/** O rótulo de cada tipo de condição na tela (o kit: "Nº de alvos", "Mana"). */
export const CONDITION_KIND_LABELS: Readonly<Record<BotConditionKindV2, string>> = {
  hp: 'HP',
  mana: 'Mana',
  targets: 'Nº de alvos',
  'target-hp': 'Vida do alvo',
  condition: 'Condição',
};

/** Os quatro comparadores do §13.3, na forma que a tela lê. */
export const OPERATOR_OPTIONS: ReadonlyArray<{ readonly value: BotOperator; readonly label: string }> = [
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
];

const OPERATOR_LABELS: Readonly<Record<BotOperator, string>> = {
  '<': '<', '<=': '≤', '>': '>', '>=': '≥',
};

/** Os limites de um valor de condição: percentual 0–100; contagem de alvos ≥ 0. */
export function conditionBounds(kind: BotConditionKindV2): { readonly min: number; readonly max: number | null } {
  return kind === 'targets' || kind === 'condition' ? { min: 0, max: null } : { min: 0, max: 100 };
}

/** O número que a condição compara — `percent` ou `count`, conforme o tipo. */
export function conditionValue(condition: BotConditionV2): number {
  if (condition.kind === 'targets') return condition.count;
  if (condition.kind === 'condition') return condition.present ? 1 : 0;
  return condition.percent;
}

/** A condição em uma frase ("Nº de alvos ≥ 2", "Mana ≥ 20 %"), como o jogador a lê. */
export function conditionText(condition: BotConditionV2): string {
  if (condition.kind === 'condition') {
    return `Condição ${condition.present ? 'ativa' : 'inativa'}`;
  }
  const suffix = condition.kind === 'targets' ? '' : ' %';
  return `${CONDITION_KIND_LABELS[condition.kind]} ${OPERATOR_LABELS[condition.op]} ${String(conditionValue(condition))}${suffix}`;
}

/** Uma condição nova, já com valor no meio da faixa (ou 1 alvo, quando não há teto). */
export function blankConditionV2(kind: BotConditionKindV2): BotConditionV2 {
  if (kind === 'targets') return { kind: 'targets', op: '>=', count: 1 };
  if (kind === 'condition') return { kind: 'condition', conditionId: '', present: true };
  return { kind, op: '>=', percent: 50 };
}

/** O rascunho que abre o modal: o slot atual, ou um vazio (`do: null`). */
export function draftFromSlot(slot: BotSlot | null): SlotDraft {
  if (slot === null) return { do: null, when: [], auto: true };
  return {
    do: slot.do,
    when: slot.when,
    auto: slot.auto,
    ...(slot.hotkey === undefined ? {} : { hotkey: slot.hotkey }),
  };
}

/**
 * Materializa o slot no Salvar. `null` quando ainda não há ação — o modal mantém o Salvar
 * bloqueado nesse caso. O suprimento é abstrato: não há `restock` a carregar.
 */
export function slotFromDraft(draft: SlotDraft): BotSlot | null {
  if (draft.do === null) return null;
  return {
    do: draft.do,
    when: [...draft.when],
    auto: draft.auto,
    ...(draft.hotkey === undefined ? {} : { hotkey: draft.hotkey }),
  };
}

/**
 * A MESMA regra do `botSetSchema.superRefine` (#418): a tecla é única DENTRO do conjunto. O
 * servidor continua autoritativo, mas o jogador não deve descobrir a duplicata por uma recusa
 * depois de salvar (DT-02). Ignora o próprio slot editado.
 */
export function hotkeyConflict(set: BotSet, index: number, hotkey: BotHotkey): number | null {
  const at = set.slots.findIndex((slot, i) => i !== index && slot?.hotkey === hotkey);
  return at === -1 ? null : at;
}

/**
 * O motivo pelo qual o Salvar está bloqueado, ou `null` quando o rascunho pode ir. Cada regra
 * espelha o que o `botConfigSchema` recusaria — o cliente não manda config que ele mesmo já
 * sabe inválida.
 */
export function draftProblem(draft: SlotDraft, set: BotSet, index: number): string | null {
  if (draft.do === null) return 'Escolha uma ação.';
  for (const condition of draft.when) {
    if (condition.kind === 'condition') continue;
    const { min, max } = conditionBounds(condition.kind);
    const value = conditionValue(condition);
    if (value < min || (max !== null && value > max)) {
      return `Valor fora de faixa: use entre ${String(min)}${max === null ? '' : ` e ${String(max)}`}.`;
    }
  }
  if (draft.hotkey !== undefined) {
    const conflict = hotkeyConflict(set, index, draft.hotkey);
    if (conflict !== null) return `A tecla ${draft.hotkey} já está no slot ${String(conflict + 1)} deste conjunto.`;
  }
  return null;
}
