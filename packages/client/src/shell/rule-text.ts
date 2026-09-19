// O texto de uma regra do bot (#162): a linha compacta do painel diz `HP ≤ 70 % → Cura`.
//
// Puro, e por isso testável sem React: o painel é `prerender` sem DOM, e o que se prende é
// que toda condição e toda ação do vocabulário viram texto — uma linha com id cru é uma linha
// que ninguém entende.

import type { BotAction, BotCondition, BotRule } from '@draconya/content';
import type { BotVocabulary } from '../state/hud.js';

export const CONDITION_TEXT: Readonly<Record<string, string>> = {
  hp: 'HP',
  mana: 'Mana',
  targets: 'Alvos',
  'target-hp': 'HP do alvo',
};

const OPERATOR_TEXT: Readonly<Record<string, string>> = {
  '<': '<', '<=': '≤', '>': '>', '>=': '≥',
};

export function conditionText(condition: BotCondition): string {
  const name = CONDITION_TEXT[condition.kind] ?? condition.kind;
  const op = OPERATOR_TEXT[condition.op] ?? condition.op;
  return 'percent' in condition
    ? `${name} ${op} ${String(condition.percent)} %`
    : `${name} ${op} ${String(condition.count)}`;
}

/** O nome da magia ou do supply, do catálogo; o id cru quando o catálogo não o tem. */
export function actionText(action: BotAction, vocabulary: BotVocabulary): string {
  if (action.kind === 'spell') {
    return vocabulary.spells.find((spell) => spell.id === action.spellId)?.name ?? action.spellId;
  }
  if (action.kind === 'supply') {
    return (vocabulary.supplies ?? []).find((supply) => supply.id === action.supplyId)?.name ?? action.supplyId;
  }
  return action.itemId;
}

export function ruleText(rule: BotRule, vocabulary: BotVocabulary): { readonly when: string; readonly do: string } {
  return { when: conditionText(rule.when), do: actionText(rule.do, vocabulary) };
}
