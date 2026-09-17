import { describe, expect, it } from 'vitest';
import type { BotExitRule } from '@draconya/content';
import {
  DEFAULT_HP_BELOW_PERCENT, EXIT_RULE_KINDS, exitRuleLabel, exitRulesSummary, findExitRule,
  setHpBelowPercent, toggleExitRule,
} from './exit-rules.js';

// RF-01/RF-02: as três regras que `botExitRuleSchema` conhece, e SÓ elas — a quarta regra do
// protótipo (capacidade cheia) é M15/SV-06 e não existe no schema hoje.

describe('EXIT_RULE_KINDS (RF-01, RF-02, R4-11)', () => {
  it('tem exatamente as três regras do schema, na ordem do kit: gold → grupo → HP por último', () => {
    expect(EXIT_RULE_KINDS).toEqual(['out-of-gold', 'party-member-lost', 'hp-below']);
  });
});

describe('findExitRule', () => {
  const rules: readonly BotExitRule[] = [{ kind: 'out-of-gold' }, { kind: 'hp-below', percent: 20 }];

  it('acha a regra do kind pedido', () => {
    expect(findExitRule(rules, 'out-of-gold')).toEqual({ kind: 'out-of-gold' });
    expect(findExitRule(rules, 'hp-below')).toEqual({ kind: 'hp-below', percent: 20 });
  });

  it('devolve null quando o kind não está no rascunho', () => {
    expect(findExitRule(rules, 'party-member-lost')).toBeNull();
    expect(findExitRule([], 'hp-below')).toBeNull();
  });
});

describe('exitRuleLabel (RF-03)', () => {
  it('hp-below mostra o percentual CONFIGURADO quando a regra está no rascunho', () => {
    expect(exitRuleLabel('hp-below', { kind: 'hp-below', percent: 45 })).toBe('HP abaixo de 45 %');
  });

  it('hp-below mostra o DEFAULT quando a regra ainda não está no rascunho (desligada)', () => {
    expect(exitRuleLabel('hp-below', null)).toBe(`HP abaixo de ${String(DEFAULT_HP_BELOW_PERCENT)} %`);
  });

  it('as duas booleanas têm rótulo fixo, sem o id cru vazando para a tela', () => {
    expect(exitRuleLabel('out-of-gold', null)).toBe('Acabar o gold');
    expect(exitRuleLabel('out-of-gold', { kind: 'out-of-gold' })).toBe('Acabar o gold');
    expect(exitRuleLabel('party-member-lost', null)).toBe('Alguém do grupo sair');
    expect(exitRuleLabel('party-member-lost', { kind: 'party-member-lost' })).toBe('Alguém do grupo sair');
  });
});

describe('toggleExitRule (RF-03, RF-05)', () => {
  it('ligar hp-below sem percentual anterior nasce no DEFAULT (30, o do handoff)', () => {
    const result = toggleExitRule([], 'hp-below', true);
    expect(result).toEqual([{ kind: 'hp-below', percent: DEFAULT_HP_BELOW_PERCENT }]);
  });

  it('ligar hp-below com percentual explícito grava esse percentual', () => {
    const result = toggleExitRule([], 'hp-below', true, 15);
    expect(result).toEqual([{ kind: 'hp-below', percent: 15 }]);
  });

  it('ligar uma regra booleana não recebe percentual nenhum', () => {
    expect(toggleExitRule([], 'out-of-gold', true)).toEqual([{ kind: 'out-of-gold' }]);
    expect(toggleExitRule([], 'party-member-lost', true)).toEqual([{ kind: 'party-member-lost' }]);
  });

  it('desligar remove a regra da lista, sem deixar entrada morta (RF-05)', () => {
    const rules: readonly BotExitRule[] = [{ kind: 'hp-below', percent: 30 }, { kind: 'out-of-gold' }];
    expect(toggleExitRule(rules, 'hp-below', false)).toEqual([{ kind: 'out-of-gold' }]);
  });

  it('nunca duplica: ligar uma regra já ligada substitui a entrada, não acrescenta', () => {
    // Mutação que mata: usar `[...rules, ruleOf(...)]` sem filtrar antes — duas entradas do
    // mesmo kind quebrariam `findExitRule` (o primeiro `.find` venceria em silêncio).
    const rules: readonly BotExitRule[] = [{ kind: 'hp-below', percent: 30 }];
    const result = toggleExitRule(rules, 'hp-below', true, 60);
    expect(result).toHaveLength(1);
    expect(result).toEqual([{ kind: 'hp-below', percent: 60 }]);
  });

  it('desligar uma regra ausente não faz nada (idempotente)', () => {
    expect(toggleExitRule([], 'out-of-gold', false)).toEqual([]);
  });
});

describe('setHpBelowPercent (RF-04)', () => {
  it('reescreve só o percentual de hp-below, sem tocar out-of-gold/party-member-lost', () => {
    const rules: readonly BotExitRule[] = [
      { kind: 'hp-below', percent: 30 }, { kind: 'out-of-gold' }, { kind: 'party-member-lost' },
    ];
    const result = setHpBelowPercent(rules, 55);
    expect(result).toEqual([
      { kind: 'hp-below', percent: 55 }, { kind: 'out-of-gold' }, { kind: 'party-member-lost' },
    ]);
  });

  it('sem hp-below no rascunho, a lista fica como estava', () => {
    const rules: readonly BotExitRule[] = [{ kind: 'out-of-gold' }];
    expect(setHpBelowPercent(rules, 55)).toEqual(rules);
  });
});

describe('exitRulesSummary (RF-07)', () => {
  it('null quando nenhuma regra está ligada — o resumo some por inteiro', () => {
    expect(exitRulesSummary([])).toBeNull();
  });

  it('respeita a ordem FIXA de EXIT_RULE_KINDS, não a ordem de inserção no array exit', () => {
    // Mutação que mata: usar a ordem de `rules` em vez de `EXIT_RULE_KINDS` — ligar gold antes
    // de HP faria o resumo listar "acabar o gold · hp abaixo de..." em vez do inverso.
    const rules: readonly BotExitRule[] = [
      { kind: 'party-member-lost' }, { kind: 'out-of-gold' }, { kind: 'hp-below', percent: 30 },
    ];
    expect(exitRulesSummary(rules)).toBe('acabar o gold · alguém do grupo sair · hp abaixo de 30 %');
  });

  it('só lista as regras ligadas', () => {
    const rules: readonly BotExitRule[] = [{ kind: 'out-of-gold' }];
    expect(exitRulesSummary(rules)).toBe('acabar o gold');
  });
});
