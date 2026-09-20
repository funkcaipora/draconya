import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BotSlot } from '@draconya/content';
import { ActionBar } from './ActionBar.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_BOT, bot, edit } from '../bot/store.js';
import type { BotDraft } from '../bot/store.js';

// A barra 2 × 12 (AB-10). `prerender` roda sem DOM: o que se prende é a ESTRUTURA — 24 slots de
// 36 px, vazio sem dado, rótulo/tecla quando há, CONJUNTO/ALVO e a legenda. A fiação do
// clique/teclado é presa por inspeção de fonte (DT-03, mesmo limite de HuntActions.test.ts).
// Suprimento é abstrato: o slot mostra nome/tecla, nunca contagem de pilha.

const catalogue = (): Catalogue => ({
  hunts: [],
  monsters: [],
  ammunition: [],
  items: [],
  vocations: [],
  vocationLevel: 0,
  bot: {
    vocabularyVersion: 2,
    setCount: 4,
    slotsPerSet: 24,
    setNames: ['Energia', 'Fogo', 'Gelo', 'Sagrado'],
    hotkeys: ['1', 'F1'],
    groups: ['potion', 'attack'],
    spells: [
      { id: 'heal', name: 'Cura', manaCost: 20, minLevel: 1, vocationId: null, effect: 'heal', group: 'healing' },
      { id: 'strike', name: 'Strike', manaCost: 10, minLevel: 1, vocationId: null, effect: 'damage', group: 'attack' },
    ],
    supplies: [{
      id: 'health-potion', name: 'Poção de Vida', price: 20, effect: 'heal',
      group: 'potion', requires: {},
    }],
    automations: [],
  },
});

const spell = (spellId: string, hotkey?: BotSlot['hotkey']): BotSlot => ({
  do: { kind: 'spell', spellId }, when: [], auto: true,
  ...(hotkey === undefined ? {} : { hotkey }),
});
const supply = (): BotSlot => ({ do: { kind: 'supply', supplyId: 'health-potion' }, when: [], auto: true });

function withSlots(set: number, entries: ReadonlyArray<[number, BotSlot]>): BotDraft {
  const draft = INITIAL_BOT.draft;
  const sets = draft.sets.map((current, s) => s !== set
    ? current
    : { slots: current.slots.map((slot, i) => entries.find(([at]) => at === i)?.[1] ?? slot) });
  return { ...draft, sets };
}

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(ActionBar));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue: catalogue() }));
  bot.set(() => INITIAL_BOT);
});

describe('ActionBar — a fileira de 124 px (RF-01..RF-04)', () => {
  it('monta 24 slots de 36 px na ordem 0..23', async () => {
    edit((draft) => ({ ...withSlots(0, [[0, spell('heal', '1')], [1, supply()]]), activeSet: draft.activeSet }));
    const html = await render();
    expect((html.match(/class="ui-slot[ "]/g) ?? []).length).toBe(24);
    expect((html.match(/--slot-size:36px/g) ?? []).length).toBe(24);
    expect(html.indexOf('Cura')).toBeGreaterThan(-1);
    expect(html.indexOf('Cura')).toBeLessThan(html.indexOf('Poção de Vida'));
  });

  it('slot sem dado é vazio e tracejado; nada de rótulo/contagem/elemento inventado', async () => {
    const html = await render();
    expect(html).toContain('ui-slot--empty');
    expect(html).toContain('ui-slot--dashed');
    expect(html).not.toContain('ui-slot-count');
    expect(html).not.toContain('LV 50');
  });

  it('slot com dado mostra rótulo e tecla, mas nenhuma contagem de pilha', async () => {
    edit((draft) => ({ ...withSlots(0, [[0, spell('heal', '1')], [1, supply()]]), activeSet: draft.activeSet }));
    const html = await render();
    expect(html).toContain('Cura');
    expect(html).toContain('Poção de Vida');
    expect(html).toContain('ui-slot-hotkey');
    expect(html).toContain('>1<');
    expect(html).not.toContain('ui-slot-count');
  });

  it('renderiza na Cidade e na caçada', async () => {
    hud.set((state) => ({ ...state, analyzer: { ...state.analyzer, sessionType: 'city' } }));
    expect((await render()).match(/class="ui-slot[ "]/g) ?? []).toHaveLength(24);
    hud.set((state) => ({ ...state, analyzer: { ...state.analyzer, sessionType: 'hunt' } }));
    expect((await render()).match(/class="ui-slot[ "]/g) ?? []).toHaveLength(24);
  });
});

describe('ActionBar — CONJUNTO, ALVO, ⌖ e a legenda (RF-08..RF-12)', () => {
  it('oferece CONJUNTO com os nomes do catálogo e ALVO com as políticas', async () => {
    const html = await render();
    expect(html).toContain('Conjunto');
    for (const name of ['Energia', 'Fogo', 'Gelo', 'Sagrado']) expect(html).toContain(name);
    expect(html).toContain('Alvo');
    expect(html).toContain('Mais próximo');
    expect(html).toContain('Seguir alvo');
    expect(html).toContain('⌖ LURE · FOLLOW');
  });

  it('a legenda mostra mín/máx e a postura do bot', async () => {
    expect(await render()).toContain('MIN 4 · MAX 8');
  });

  it('o conjunto ATIVO carrega os slots dele, sem tocar nos outros', async () => {
    edit((draft) => ({
      ...withSlots(1, [[0, spell('strike')]]),
      activeSet: 1,
    }));
    const html = await render();
    expect(html).toContain('Strike');
    expect(html).not.toContain('Cura');
  });

  it('o motivo do slot-state bloqueado vai ao title do slot (RF-02)', async () => {
    // É o caminho que explica por que a runa não rodou: o host manda a frase em palavras no
    // `slot-state`, e a barra a leva ao tooltip — sem `slot-result` nenhum.
    edit((draft) => ({ ...withSlots(0, [[0, spell('heal')]]), activeSet: draft.activeSet }));
    hud.set((state) => ({
      ...state,
      slotStates: {
        '0:0': { set: 0, slot: 0, state: 'blocked', remainingMs: 0, reason: 'Magic level insuficiente.' },
      },
    }));
    expect(await render()).toContain('Magic level insuficiente.');
  });
});

describe('ActionBar — "Salva automaticamente" reflete o estado (RF-10)', () => {
  it('pending diz salvando…, saved diz salvo', async () => {
    bot.set((state) => ({ ...state, save: 'pending' }));
    expect(await render()).toContain('salvando…');
    bot.set((state) => ({ ...state, save: 'saved' }));
    const html = await render();
    expect(html).toContain('Salva automaticamente');
    expect(html).toContain('salvo');
  });
});

describe('ActionBar — a fiação é presa por fonte (RF-05..RF-07)', () => {
  it('a barra manda bot-config (CONJUNTO/ALVO) e lê event.shiftKey para desligar o automático', async () => {
    const source = await readFile(new URL('./ActionBar.tsx', import.meta.url), 'utf8');
    expect(source).toContain('setActiveSet');
    expect(source).toContain('setTargetingPolicy');
    expect(source).toContain('setSlotAuto');
    expect(source).toContain('event.shiftKey');
    // O remetente é da `Shell` (dono único do singleton): a barra não o instala nem o limpa.
    expect(source).not.toContain('setConfigSender');
  });

  it('o hook de teclado manda use-slot com o conjunto ativo', async () => {
    const source = await readFile(new URL('./useActionKeys.ts', import.meta.url), 'utf8');
    expect(source).toContain("type: 'use-slot'");
    expect(source).toContain('slotForHotkey');
    expect(source).toContain('sendIntent');
  });
});
