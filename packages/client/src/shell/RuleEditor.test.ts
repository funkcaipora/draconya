import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { RuleEditor, blankRule, suppliesFor } from './RuleEditor.js';
import type { BotVocabulary } from '../state/hud.js';

// A categoria `rune` lança supply de DANO (#165), e a de poção o que repõe — a divisão é pelo
// `effect` do catálogo, sem lista de ids em código. A runa com level tranca a opção abaixo
// dele; quem recusa é o servidor, a tela só evita configurar o que vai levar "não".

const vocabulary: BotVocabulary = {
  vocabularyVersion: 1, advancedFromLevel: 50,
  slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
  advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
  spells: [{ id: 'heal', name: 'Cura', manaCost: 20, minLevel: 1, vocationId: null, effect: 'heal', group: 'healing' }],
  supplies: [
    { id: 'health-potion', name: 'Poção de Vida', price: 45, effect: 'heal', requires: {} },
    { id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, effect: 'damage', requires: { level: 30, magicLevel: 4 } },
  ],
};

async function render(category: 'potion' | 'rune', level: number): Promise<string> {
  const initial = blankRule(category, vocabulary);
  if (initial === null) throw new Error('sem ação para a categoria');
  const { prelude } = await prerender(createElement(RuleEditor, {
    category, index: null, initial, vocabulary, level, onClose: () => undefined,
  }));
  return new Response(prelude).text();
}

describe('RuleEditor', () => {
  it('splits the supplies by effect: potions heal, runes deal damage', () => {
    expect(suppliesFor('potion', vocabulary)?.map((s) => s.id)).toEqual(['health-potion']);
    expect(suppliesFor('rune', vocabulary)?.map((s) => s.id)).toEqual(['avalanche-rune']);
    expect(suppliesFor('attack', vocabulary)).toBeNull();
    // A regra nova de runa nasce como supply, com "há alvo" — não "HP ≤ 50 %".
    expect(blankRule('rune', vocabulary)).toEqual({
      enabled: true,
      when: { kind: 'targets', op: '>=', count: 2 },
      do: { kind: 'supply', supplyId: 'avalanche-rune' },
    });
  });

  it('offers the rune in the rune category, locked below its level', async () => {
    // Mutação que mata: `locked: false` fixo para supply — o level 10 veria a runa aberta.
    const young = await render('rune', 10);
    expect(young).toContain('Avalanche Rune (14 gold)');
    expect(young).not.toContain('Poção de Vida');
    expect(young).toMatch(/<option[^>]*value="avalanche-rune"[^>]*disabled/);
    const veteran = await render('rune', 30);
    expect(veteran).not.toMatch(/<option[^>]*value="avalanche-rune"[^>]*disabled/);
    // E a poção nunca aparece trancada: `requires` vazio.
    const potion = await render('potion', 1);
    expect(potion).toContain('Poção de Vida');
    expect(potion).not.toContain('Avalanche');
    expect(potion).not.toMatch(/<option[^>]*disabled/);
  });
});
