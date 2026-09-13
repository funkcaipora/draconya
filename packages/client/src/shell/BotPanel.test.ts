import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { BotPanel } from './BotPanel.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_BOT, bot, edit } from '../bot/store.js';

// O painel fixo do bot (#162): `prerender` roda o componente sem DOM; o que se prende é a
// estrutura — cinco categorias com `n/slots`, um interruptor com estado por regra, o texto da
// linha, e a existência do painel minimizado e sem catálogo.

async function render(props: { collapsed?: boolean } = {}): Promise<string> {
  const { prelude } = await prerender(createElement(BotPanel, props));
  return new Response(prelude).text();
}

const catalogue: Catalogue = {
  hunts: [], monsters: [], ammunition: [], items: [], vocations: [], vocationLevel: 8,
  bot: {
    vocabularyVersion: 1, advancedFromLevel: 50,
    slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [{ id: 'heal', name: 'Cura', manaCost: 20, minLevel: 1, vocationId: null, effect: 'heal', group: 'healing' }],
    supplies: [{ id: 'health-potion', name: 'Poção de Vida', price: 45, effect: 'heal', requires: {} }],
  },
};

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue, level: 10 }));
  bot.set(() => ({ ...INITIAL_BOT }));
  edit((draft) => ({
    ...draft,
    rules: {
      ...draft.rules,
      heal: [
        { when: { kind: 'hp', op: '<=', percent: 70 }, do: { kind: 'spell', spellId: 'heal' } },
        { enabled: false, when: { kind: 'hp', op: '<=', percent: 30 }, do: { kind: 'spell', spellId: 'heal' } },
      ],
    },
  }));
});

describe('BotPanel', () => {
  it('is a section with the five categories, the slot counters, and one switch per rule', async () => {
    const html = await render();
    expect(html).toContain('aria-label="bot"');
    for (const name of ['Cura', 'Poções', 'Ataque', 'Runas e itens', 'Suporte']) expect(html).toContain(name);
    expect(html).toContain('2/3');
    expect(html).toContain('0/4');
    // Dois interruptores: um ligado, um desligado — e a linha desligada marcada.
    expect((html.match(/role="switch"/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('bot-rule-off');
    expect(html).toContain('HP ≤ 70 % → Cura');
    // Sem "fechar": o painel é fixo. Sem "Salvar": o interruptor salva sozinho.
    expect(html).not.toContain('fechar');
    expect(html).not.toContain('>Salvar<');
  });

  it('keeps the header when collapsed, and exists without a catalogue', async () => {
    const collapsed = await render({ collapsed: true });
    expect(collapsed).toContain('collapsed');
    expect(collapsed).toContain('<strong>Bot</strong>');
    hud.set((state) => ({ ...state, catalogue: null }));
    const loading = await render();
    expect(loading).toContain('Carregando');
    expect(loading).toContain('aria-label="bot"');
  });
});
