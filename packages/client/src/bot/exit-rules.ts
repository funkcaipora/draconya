// As três regras de saída que o servidor conhece (#260; `botExitRuleSchema`,
// `packages/content/src/schemas.ts:932-945`), na ORDEM do kit (#309, ADR 0030, R4-11/R5-05):
// gold, grupo, HP por último — `data.js:75` do handoff lista `out-of-gold, out-of-capacity,
// party-member-lost, hp-below`; tirando a quarta (ver abaixo), sobra essa ordem. A quarta regra
// do protótipo (capacidade cheia) NÃO existe no schema — ela só entra no M15 (SV-06,
// `content`+`sim`); até lá o popover não a oferece, porque oferecer uma regra que o servidor
// recusaria é configurar o jogador para um "não" (o mesmo motivo de FUN-89 para o resto do
// vocabulário do bot).
//
// Puro, sem `bot/store.ts` — o mesmo motivo de `shell/rule-text.ts` ser separado do painel:
// texto e derivação se testam sem loja nenhuma.

import type { BotExitRule } from '@draconya/content';

export const EXIT_RULE_KINDS = ['out-of-gold', 'party-member-lost', 'hp-below'] as const;
export type ExitRuleKind = (typeof EXIT_RULE_KINDS)[number];

/** O percentual com que `hp-below` nasce ao ser ligada pela primeira vez (o do handoff). */
export const DEFAULT_HP_BELOW_PERCENT = 30;

const FIXED_LABEL: Record<Exclude<ExitRuleKind, 'hp-below'>, string> = {
  'out-of-gold': 'Acabar o gold',
  'party-member-lost': 'Alguém do grupo sair',
};

/** A regra de um `kind`, se estiver no rascunho. Nunca há duas do mesmo `kind` — `toggleExitRule` garante. */
export function findExitRule(rules: readonly BotExitRule[], kind: ExitRuleKind): BotExitRule | null {
  return rules.find((rule) => rule.kind === kind) ?? null;
}

/** O texto da linha: fixo para as duas booleanas, com o percentual configurado (ou o default) para `hp-below`. */
export function exitRuleLabel(kind: ExitRuleKind, rule: BotExitRule | null): string {
  if (kind === 'hp-below') {
    const percent = rule !== null && rule.kind === 'hp-below' ? rule.percent : DEFAULT_HP_BELOW_PERCENT;
    return `HP abaixo de ${String(percent)} %`;
  }
  return FIXED_LABEL[kind];
}

function ruleOf(kind: ExitRuleKind, percent: number): BotExitRule {
  if (kind === 'hp-below') return { kind: 'hp-below', percent };
  if (kind === 'out-of-gold') return { kind: 'out-of-gold' };
  return { kind: 'party-member-lost' };
}

/**
 * Liga, desliga ou substitui a regra de um `kind` — nunca duas entradas do mesmo `kind` no
 * rascunho. `percent` só importa quando `hp-below` está LIGANDO; as outras o ignoram.
 */
export function toggleExitRule(
  rules: readonly BotExitRule[], kind: ExitRuleKind, on: boolean, percent = DEFAULT_HP_BELOW_PERCENT,
): BotExitRule[] {
  const without = rules.filter((rule) => rule.kind !== kind);
  return on ? [...without, ruleOf(kind, percent)] : without;
}

/** Reescreve só o percentual de `hp-below`; as outras regras do rascunho ficam como estavam. */
export function setHpBelowPercent(rules: readonly BotExitRule[], percent: number): BotExitRule[] {
  return rules.map((rule) => (rule.kind === 'hp-below' ? { ...rule, percent } : rule));
}

/**
 * "Saindo sozinho: …" — sempre na ordem de `EXIT_RULE_KINDS`, nunca a ordem em que o jogador
 * ligou cada uma (o array de `exit` não tem prioridade — qualquer regra ligada encerra a hunt
 * sozinha, ao contrário das categorias do bot, em que a ordem É a prioridade). `null` quando
 * nenhuma está ligada: o resumo some por inteiro, em vez de "Saindo sozinho:" vazio.
 */
export function exitRulesSummary(rules: readonly BotExitRule[]): string | null {
  const on = EXIT_RULE_KINDS.filter((kind) => findExitRule(rules, kind) !== null);
  if (on.length === 0) return null;
  return on.map((kind) => exitRuleLabel(kind, findExitRule(rules, kind)).toLowerCase()).join(' · ');
}
