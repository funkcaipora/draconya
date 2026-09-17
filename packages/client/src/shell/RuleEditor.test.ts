import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { RuleEditor, blankRule, spellsFor, suppliesFor } from './RuleEditor.js';
import type { BotVocabulary } from '../state/hud.js';
import { botConfigSchema } from '@draconya/content';
import type { BotCategory, BotRule } from '@draconya/content';

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

async function render(
  category: BotCategory,
  level: number,
  options: {
    vocabulary?: BotVocabulary;
    vocationId?: string | null;
    vocationNames?: ReadonlyMap<string, string>;
    initial?: BotRule;
  } = {},
): Promise<string> {
  const activeVocabulary = options.vocabulary ?? vocabulary;
  const vocationId = options.vocationId ?? null;
  const initial = options.initial ?? blankRule(category, activeVocabulary, vocationId);
  if (initial === null) throw new Error('sem ação para a categoria');
  const { prelude } = await prerender(createElement(RuleEditor, {
    category, index: null, initial, vocabulary: activeVocabulary, level, vocationId,
    vocationNames: options.vocationNames ?? new Map(), onClose: () => undefined,
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

  // RF-06/RF-07: `Modal` de 480 px, meta "slot N/M" (N 1-based, M o teto da categoria) e o
  // rodapé com o aviso "Salvar manda agora · quem decide é o servidor" e Cancelar/Salvar.
  it('is a 480px Modal with the "slot N/M" meta and the footer note', async () => {
    const html = await render('rune', 30);
    expect(html).toContain('style="width:480px"');
    expect(html).toMatch(/ui-panel-meta">slot 1\/10</);
    expect(html).toContain('Salvar manda agora · quem decide é o servidor');
    expect(html).toContain('Cancelar');
    expect(html).toContain('>Salvar<');
  });

  // RF-08: condição e operador em `Select`, valor em `Input`, ação como lista de botões.
  it('uses Select for condition/operator, Input for the value, and a button list for the action', async () => {
    const html = await render('potion', 1);
    expect(html).toContain('ui-select');
    expect(html).toContain('ui-input');
    expect(html).not.toContain('aria-label="condição"');
    expect(html).not.toContain('aria-label="operador"');
    expect(html).not.toContain('aria-label="valor"');
    expect(html).not.toContain('<select aria-label="ação"');
    expect(html).not.toMatch(/<option[^>]*disabled/);
  });

  it('offers the rune in the rune category, locked below its level', async () => {
    // Mutação que mata: `locked: false` fixo para supply — o level 10 veria a runa aberta.
    const young = await render('rune', 10);
    expect(young).toContain('Avalanche Rune (14 gold)');
    expect(young).not.toContain('Poção de Vida');
    expect(young).toMatch(/<button[^>]*data-action-id="avalanche-rune"[^>]*disabled=""/);
    const veteran = await render('rune', 30);
    expect(veteran).not.toMatch(/<button[^>]*data-action-id="avalanche-rune"[^>]*disabled=""/);
    // E a poção nunca aparece trancada: `requires` vazio.
    const potion = await render('potion', 1);
    expect(potion).toContain('Poção de Vida');
    expect(potion).not.toContain('Avalanche');
    expect(potion).not.toMatch(/data-action-id="health-potion"[^>]*disabled=""/);
    // Level bem alto: a poção continua liberada.
    const veteranPotion = await render('potion', 99);
    expect(veteranPotion).not.toMatch(/data-action-id="health-potion"[^>]*disabled=""/);
  });

  it('offers only generic and current-vocation spells, with distinct labels', async () => {
    const vocational: BotVocabulary = {
      ...vocabulary,
      spells: [
        { id: 'flame-strike-generic', name: 'Flame Strike', manaCost: 20, minLevel: 1, vocationId: null, effect: 'damage', group: 'attack' },
        { id: 'flame-strike-sorcerer', name: 'Flame Strike', manaCost: 20, minLevel: 8, vocationId: 'sorcerer', effect: 'damage', group: 'attack' },
        { id: 'flame-strike-druid', name: 'Flame Strike', manaCost: 20, minLevel: 8, vocationId: 'druid', effect: 'damage', group: 'attack' },
      ],
    };
    const names = new Map([['sorcerer', 'Sorcerer'], ['druid', 'Druid']]);

    expect(spellsFor(vocational, 'sorcerer').map((spell) => spell.id))
      .toEqual(['flame-strike-generic', 'flame-strike-sorcerer']);
    expect(spellsFor(vocational, null).map((spell) => spell.id))
      .toEqual(['flame-strike-generic']);

    const html = await render('attack', 80, {
      vocabulary: vocational, vocationId: 'sorcerer', vocationNames: names,
    });
    expect(html).toContain('Flame Strike · attack (20 mana) · Genérica');
    expect(html).toContain('Flame Strike · attack (20 mana) · Sorcerer');
    expect(html).not.toContain('data-action-id="flame-strike-druid"');
    const labels = [...html.matchAll(/data-action-id="[^"]+"[^>]*>([^<]+)</g)].map((match) => match[1]);
    expect(new Set(labels).size).toBe(labels.length);

    const novice = await render('attack', 7, { vocabulary: vocational, vocationNames: names });
    expect(novice).toContain('data-action-id="flame-strike-generic"');
    expect(novice).not.toContain('data-action-id="flame-strike-sorcerer"');
    expect(novice).not.toContain('data-action-id="flame-strike-druid"');
  });

  it('keeps an old wrong-vocation rule visible and warns how to correct it', async () => {
    const vocational: BotVocabulary = {
      ...vocabulary,
      spells: [
        { id: 'flame-strike-sorcerer', name: 'Flame Strike', manaCost: 20, minLevel: 8, vocationId: 'sorcerer', effect: 'damage', group: 'attack' },
        { id: 'flame-strike-druid', name: 'Flame Strike', manaCost: 20, minLevel: 8, vocationId: 'druid', effect: 'damage', group: 'attack' },
      ],
    };
    const initial: BotRule = {
      enabled: true, when: { kind: 'targets', op: '>=', count: 1 },
      do: { kind: 'spell', spellId: 'flame-strike-druid' },
    };
    // O catálogo mudou a tela, não o contrato persistido: uma configuração existente ainda
    // passa pelo schema e o aviso dá ao jogador a chance de corrigi-la.
    expect(botConfigSchema.safeParse({
      version: 1, heal: [], potion: [], attack: [initial], rune: [], support: [],
    }).success).toBe(true);

    const html = await render('attack', 80, {
      vocabulary: vocational, vocationId: 'sorcerer', initial,
      vocationNames: new Map([['sorcerer', 'Sorcerer'], ['druid', 'Druid']]),
    });
    expect(html).toContain('Flame Strike · attack (20 mana)');
    expect(html).toContain('A regra usa Flame Strike, que não é da sua vocação.');
    expect(html).toMatch(/data-action-id="flame-strike-druid"[^>]*disabled=""/);
  });
});
