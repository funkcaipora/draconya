import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BotAutomation } from '@draconya/content';
import { AutomationsPanel } from './AutomationsPanel.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_BOT, bot } from '../bot/store.js';

// O painel AUTOMAÇÕES (AB-12, #427), régua `docs/kit-reference/10-hud-hunt.png`. `prerender` roda
// sem DOM: o que se prende é a ESTRUTURA — as linhas com interruptor/nome/resumo/⚙/×, o
// "Carregando…" sem catálogo e o painel igual na Cidade e na caçada. A fiação (toggle/×/modais) é
// presa por inspeção de fonte, porque `prerender` não dispara evento.

const catalogue = (): Catalogue => ({
  hunts: [],
  monsters: [],
  vocations: [],
  vocationLevel: 0,
  items: [
    { id: 'life-ring', name: 'Life Ring', appearanceId: 1, weight: 1, slot: 'finger', twoHanded: false, kind: 'ring' },
    { id: 'burst-arrow', name: 'Burst Arrow', appearanceId: 2, weight: 1, slot: 'ammo', twoHanded: false, kind: 'ammo' },
    { id: 'arrow', name: 'Arrow', appearanceId: 3, weight: 1, slot: 'ammo', twoHanded: false, kind: 'ammo' },
    { id: 'steel-axe', name: 'Steel Axe', appearanceId: 4, weight: 1, slot: 'hand', twoHanded: false, kind: 'weapon' },
    { id: 'spike-sword', name: 'Spike Sword', appearanceId: 5, weight: 1, slot: 'hand', twoHanded: true, kind: 'weapon' },
    { id: 'wooden-shield', name: 'Wooden Shield', appearanceId: 6, weight: 1, slot: 'shield', twoHanded: false, kind: 'shield' },
  ],
  bot: {
    vocabularyVersion: 2,
    spells: [],
    automations: [
      { model: 'renew-ring', label: 'Renovar anel', params: [{ name: 'itemId', kind: 'item' }] },
      { model: 'renew-amulet', label: 'Renovar colar', params: [{ name: 'itemId', kind: 'item' }] },
      { model: 'swap-ammo-by-targets', label: 'Trocar munição por alvos', params: [{ name: 'ammoA', kind: 'item' }, { name: 'ammoB', kind: 'item' }] },
      { model: 'swap-weapon-shield-by-hp', label: 'Trocar arma/escudo por vida', params: [{ name: 'oneHanded', kind: 'item' }, { name: 'shield', kind: 'item' }, { name: 'twoHanded', kind: 'item' }] },
      { model: 'swap-ring', label: 'Trocar anel por vida', params: [{ name: 'itemId', kind: 'item' }, { name: 'manaFloor', kind: 'number' }, { name: 'restorePrevious', kind: 'boolean' }] },
    ],
  },
});

const ammo: BotAutomation = {
  model: 'swap-ammo-by-targets',
  params: { ammoA: 'burst-arrow', ammoB: 'arrow' },
  enter: [{ kind: 'targets', op: '>=', count: 3 }],
  exit: [{ kind: 'targets', op: '<', count: 3 }],
};
const weaponShield: BotAutomation = {
  model: 'swap-weapon-shield-by-hp',
  params: { oneHanded: 'steel-axe', shield: 'wooden-shield', twoHanded: 'spike-sword' },
  enter: [{ kind: 'hp', op: '<', percent: 50 }],
  exit: [{ kind: 'hp', op: '>', percent: 80 }],
};

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(AutomationsPanel, {}));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue: catalogue() }));
  bot.set(() => ({ ...INITIAL_BOT, draft: { ...INITIAL_BOT.draft, automations: [ammo, weaponShield] } }));
});

describe('AutomationsPanel — as linhas do kit (RF-02)', () => {
  it('uma linha por automação: toggle · nome · resumo · ⚙ · ×', async () => {
    const html = await render();
    expect((html.match(/role="switch"/g) ?? []).length).toBe(2);
    expect(html).toContain('Trocar munição por alvos');
    expect(html).toContain('Trocar arma/escudo por vida');
    expect(html).toContain('≥ 3 alvos → Burst Arrow · senão Arrow');
    expect(html).toContain('HP &lt; 50 % → Escudo + Steel Axe · HP &gt; 80 % → Spike Sword');
    expect((html.match(/⚙/g) ?? []).length).toBe(2);
    expect((html.match(/×/g) ?? []).length).toBe(2);
    expect(html).toContain('+ Adicionar');
  });

  it('não traz a sexta automação nem a trava de level do kit', async () => {
    const html = await render();
    expect(html).not.toContain('Comer comida');
    expect(html).not.toContain('LV 50');
  });
});

describe('AutomationsPanel — sem catálogo (RF-11)', () => {
  it('diz Carregando… e não inventa linha', async () => {
    hud.set((state) => ({ ...state, catalogue: null }));
    const html = await render();
    expect(html).toContain('Carregando…');
    expect(html).not.toContain('automation-row');
  });
});

describe('AutomationsPanel — vale o tempo todo (RF-13, ADR 0032 d.5)', () => {
  it('monta o MESMO painel na Cidade e na caçada', async () => {
    hud.set((state) => ({ ...state, analyzer: { ...state.analyzer, sessionType: 'city' } }));
    const city = await render();
    hud.set((state) => ({ ...state, analyzer: { ...state.analyzer, sessionType: 'hunt' } }));
    const hunt = await render();
    expect(city).toBe(hunt);
    expect(city).toContain('Trocar munição por alvos');
  });
});

describe('AutomationsPanel — a fiação (RF-08)', () => {
  it('liga o remetente e chama as ações da store e os dois modais', async () => {
    const source = await readFile(new URL('./AutomationsPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('setConfigSender');
    expect(source).toContain('toggleAutomation');
    expect(source).toContain('removeAutomation');
    expect(source).toContain('AddAutomationModal');
    expect(source).toContain('AutomationConfigModal');
  });
});
