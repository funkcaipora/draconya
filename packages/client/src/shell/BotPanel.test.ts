import { readFile } from 'node:fs/promises';
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
  hunts: [], monsters: [], items: [], vocations: [], vocationLevel: 8,
  bot: {
    vocabularyVersion: 1, // `heal` no teto (2 regras para 2 slots): prova que "+ regra" some quando a categoria
    // enche. `potion` continua com folga (0/4): prova que "+ regra" aparece com folga. As
    // outras três ficam em 0/0 (sem slot algum) para o único "+ regra" da tela ser o de `potion`
    // — isolando a asserção de contagem sem depender de quais ações cada categoria oferece.
    slots: { heal: 2, potion: 4, attack: 0, rune: 0, support: 0 },
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
  it('is a Panel dock "Bot" with the five categories, slot counters and one switch per rule', async () => {
    const html = await render();
    // RF-01: `Panel dock` com `title="Bot"`, classe própria `bot-panel` sobre a do primitivo.
    expect(html).toMatch(/class="ui-panel[^"]*ui-panel--dock[^"]*bot-panel"/);
    expect(html).toMatch(/ui-panel-title">Bot</);
    for (const name of ['Cura', 'Poções', 'Ataque', 'Runas e itens', 'Suporte']) expect(html).toContain(name);
    expect(html).toContain('2/2');
    expect(html).toContain('0/4');
    // RF-03: um `role="switch"` `ui-switch-traffic` por regra, `aria-checked` correto.
    expect((html.match(/role="switch"/g) ?? []).length).toBe(2);
    expect((html.match(/ui-switch-traffic/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('bot-rule-off');
    // A seta contígua na mesma string — envolvê-la num <span> quebraria esta asserção.
    expect(html).toContain('HP ≤ 70 % → Cura');
    // RF-04: "⌖ Lure e alvo" e "+ regra" (Button secondary) onde há folga (potion), ausente no teto (heal).
    expect((html.match(/ui-button-secondary/g) ?? []).length).toBe(2);
    expect(html).toContain('⌖ Lure e alvo');
    expect(html).toContain('+ regra');
    // Sem "fechar": o painel é fixo. Sem "Salvar": o interruptor salva sozinho.
    expect(html).not.toContain('fechar');
    expect(html).not.toContain('>Salvar<');
    // RF-10: nenhuma classe antiga.
    expect(html).not.toContain('bot-switch');
    expect(html).not.toContain('<select aria-label="ação"');
  });

  it('RF-02: the meta shows saving/saved conforme `save`, and nothing for idle/refused', async () => {
    bot.set((state) => ({ ...state, save: 'idle' }));
    expect(await render()).not.toContain('ui-panel-meta');
    bot.set((state) => ({ ...state, save: 'pending' }));
    expect(await render()).toMatch(/ui-panel-meta">salvando…</);
    bot.set((state) => ({ ...state, save: 'saved' }));
    expect(await render()).toMatch(/ui-panel-meta">salvo</);
    bot.set((state) => ({ ...state, save: 'refused', reason: 'Sem conexão.' }));
    const refused = await render();
    expect(refused).not.toContain('ui-panel-meta');
    expect(refused).toContain('Sem conexão.');
  });

  it('keeps the header when collapsed, and exists without a catalogue', async () => {
    const collapsed = await render({ collapsed: true });
    expect(collapsed).toContain('ui-panel--collapsed');
    expect(collapsed).toMatch(/ui-panel-title">Bot</);
    hud.set((state) => ({ ...state, catalogue: null }));
    const loading = await render();
    expect(loading).toContain('Carregando');
    expect(loading).toContain('bot-panel');
  });

  it('renders AdvancedSection only when catalogue has finger items', async () => {
    // With default catalogue (items: []), AdvancedSection is absent
    const htmlNoRings = await render();
    expect(htmlNoRings).not.toContain('Configurações avançadas');
    expect(htmlNoRings).not.toContain('Ring swap');

    // With finger items in catalogue, AdvancedSection appears
    const ringItem = {
      id: 'energy-ring', name: 'Energy Ring', appearanceId: 10, weight: 2,
      slot: 'finger', twoHanded: false,
    };
    hud.set((state) => ({
      ...state,
      catalogue: state.catalogue ? { ...state.catalogue, items: [ringItem] } : null,
    }));

    const htmlWithRings = await render();
    expect(htmlWithRings).toContain('Configurações avançadas');
    expect(htmlWithRings).toContain('Ring swap');
    expect(htmlWithRings).toContain('Nenhum anel configurado');
    // Sem gate de level (AB-03): a linha não tem mais o estado "bloqueada".
    expect(htmlWithRings).not.toContain('bot-advanced-row-locked');
  });

  it('shows ring swap summary text in AdvancedSection when configured', async () => {
    const ringItem = {
      id: 'life-ring', name: 'Life Ring', appearanceId: 11, weight: 2,
      slot: 'finger', twoHanded: false,
    };
    hud.set((state) => ({
      ...state,
      level: 60,
      catalogue: state.catalogue ? { ...state.catalogue, items: [ringItem] } : null,
    }));
    edit((draft) => ({
      ...draft,
      ringSwap: { itemId: 'life-ring', equipBelow: 40, removeAbove: 75, manaFloor: 15, restorePrevious: true },
    }));

    const html = await render();
    expect(html).toContain('Configurações avançadas');
    expect(html).toContain('Life Ring · HP &lt; 40 % → ≥ 75 %');
    expect(html).not.toContain('bot-advanced-row-locked'); // level 60 >= 50
  });

  it('wires the gear click to opening RingSwapModal', async () => {
    const source = await readFile(new URL('./BotPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onEditRingSwap={() => { setRingSwapOpen(true); }}');
    expect(source).toContain('ringSwapOpen && (');
    expect(source).toContain('<RingSwapModal');
    expect(source).toContain('onClose={() => { setRingSwapOpen(false); }}');
  });

  it('renders "⌖ Lure e alvo" button and wires opening modal', async () => {
    hud.set((state) => ({ ...state, level: 10 }));
    const html = await render();
    expect(html).toContain('⌖ Lure e alvo');

    const source = await readFile(new URL('./BotPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('setLureOpen(true)');
    expect(source).toContain('lureOpen && <LureTargetingModal');
    expect(source).toContain('onClose={() => { setLureOpen(false); }}');
  });
});
