import { describe, expect, it } from 'vitest';
import { actionText, conditionText, ruleText } from './rule-text.js';
import type { BotVocabulary } from '../state/hud.js';

// A linha compacta do painel (#162) diz o que a regra faz sem id cru.

const vocabulary: BotVocabulary = {
  vocabularyVersion: 1, advancedFromLevel: 50, slots: {},
  advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
  spells: [{ id: 'heal', name: 'Cura', manaCost: 20, minLevel: 1, vocationId: null, effect: 'heal', group: 'healing' }],
  supplies: [{ id: 'health-potion', name: 'Poção de Vida', price: 45, effect: 'heal' }],
};

describe('ruleText', () => {
  it('turns every condition and action of the vocabulary into words', () => {
    expect(conditionText({ kind: 'hp', op: '<=', percent: 70 })).toBe('HP ≤ 70 %');
    expect(conditionText({ kind: 'mana', op: '>', percent: 30 })).toBe('Mana > 30 %');
    expect(conditionText({ kind: 'targets', op: '>=', count: 2 })).toBe('Alvos ≥ 2');
    expect(conditionText({ kind: 'target-hp', op: '<', percent: 50 })).toBe('HP do alvo < 50 %');
    expect(actionText({ kind: 'spell', spellId: 'heal' }, vocabulary)).toBe('Cura');
    expect(actionText({ kind: 'supply', supplyId: 'health-potion' }, vocabulary)).toBe('Poção de Vida');
    // O id que o catálogo não tem aparece cru — melhor que sumir.
    expect(actionText({ kind: 'spell', spellId: 'exura' }, vocabulary)).toBe('exura');
    expect(ruleText({ when: { kind: 'hp', op: '<=', percent: 70 }, do: { kind: 'spell', spellId: 'heal' } }, vocabulary))
      .toEqual({ when: 'HP ≤ 70 %', do: 'Cura' });
  });
});
