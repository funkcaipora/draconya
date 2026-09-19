import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BotAutomation } from '@draconya/content';
import { AutomationConfigModal } from './AutomationConfigModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

// A configuração por modelo (AB-12, #427), réguas `docs/kit-reference/36..38`. `prerender` roda
// sem DOM: prende os rótulos e os campos de cada captura, as duas listas de condição (entrada OU /
// saída E), a faixa morta que bloqueia o Salvar e o "Carregando…" sem catálogo. O Salvar que manda
// `bot-config` é preso por inspeção de fonte.

const catalogue = (): Catalogue => ({
  hunts: [],
  monsters: [],
  vocations: [],
  vocationLevel: 0,
  items: [
    { id: 'life-ring', name: 'Life Ring', appearanceId: 1, weight: 1, slot: 'finger', twoHanded: false, kind: 'ring' },
    { id: 'energy-ring', name: 'Energy Ring', appearanceId: 2, weight: 1, slot: 'finger', twoHanded: false, kind: 'ring' },
    { id: 'glacier-amulet', name: 'Glacier Amulet', appearanceId: 3, weight: 1, slot: 'neck', twoHanded: false, kind: 'amulet' },
    { id: 'steel-axe', name: 'Steel Axe', appearanceId: 6, weight: 1, slot: 'hand', twoHanded: false, kind: 'weapon' },
    { id: 'spike-sword', name: 'Spike Sword', appearanceId: 7, weight: 1, slot: 'hand', twoHanded: true, kind: 'weapon' },
    { id: 'wooden-shield', name: 'Wooden Shield', appearanceId: 8, weight: 1, slot: 'shield', twoHanded: false, kind: 'shield' },
  ],
  ammunition: [
    { id: 'burst-arrow', name: 'Burst Arrow', family: 'arrow', attack: 30, price: 5, appearanceId: 4, requires: {} },
    { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 1, appearanceId: 5, requires: {} },
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

async function render(initial: BotAutomation, index: number | null = null): Promise<string> {
  const { prelude } = await prerender(
    createElement(AutomationConfigModal, { index, initial, onClose: () => {} }),
  );
  return new Response(prelude).text();
}

const renewRing: BotAutomation = {
  model: 'renew-ring', params: { itemId: 'life-ring' }, enter: [], exit: [],
};
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

beforeEach(() => { hud.set(() => ({ ...INITIAL_HUD, catalogue: catalogue() })); });

describe('AutomationConfigModal — renew-ring (RF-10)', () => {
  it('mostra ITEM e RENOVAR QUANDO, sem lista de condição', async () => {
    const html = await render(renewRing);
    expect(html).toContain('Renovar anel');
    expect(html).toContain('ITEM');
    expect(html).toContain('RENOVAR QUANDO');
    expect(html).toContain('Acabar (cargas 0)');
    expect(html).toContain('Life Ring');
    expect(html).not.toContain('ENTRAR QUANDO');
  });
});

describe('AutomationConfigModal — swap-ammo-by-targets (captura 37)', () => {
  it('tem os dois lados da troca, a munição do catálogo e o rótulo por extenso (#437)', async () => {
    const html = await render(ammo);
    expect(html).toContain('MUITOS ALVOS');
    expect(html).toContain('POUCOS ALVOS');
    expect(html).toContain('Burst Arrow');
    expect(html).toContain('Arrow');
    expect(html).toContain('Alvos maior ou igual a');
  });
});

describe('AutomationConfigModal — swap-weapon-shield-by-hp (captura 38, RF-07)', () => {
  it('tem o set defensivo/ofensivo e as duas listas de condição', async () => {
    const html = await render(weaponShield);
    expect(html).toContain('SET DEFENSIVO');
    expect(html).toContain('SET OFENSIVO');
    expect(html).toContain('EQUIPAR DEFENSIVO QUANDO');
    expect(html).toContain('VOLTAR AO OFENSIVO QUANDO');
    expect(html).toContain('50 %');
    expect(html).toContain('80 %');
    expect((html.match(/condition-list/g) ?? []).length).toBe(2);
  });
});

describe('AutomationConfigModal — a faixa morta bloqueia o Salvar (RF-09)', () => {
  it('saída de HP menor que a entrada mostra o motivo e desabilita', async () => {
    const deadBand: BotAutomation = {
      ...weaponShield,
      exit: [{ kind: 'hp', op: '>', percent: 40 }],
    };
    const html = await render(deadBand);
    expect(html).toContain('faixa morta');
    expect(html).toMatch(/disabled[^>]*>Salvar/);
  });
});

describe('AutomationConfigModal — sem catálogo (RF-11)', () => {
  it('diz Carregando… e não oferece lista de item', async () => {
    hud.set((state) => ({ ...state, catalogue: null }));
    const html = await render(renewRing);
    expect(html).toContain('Carregando…');
    expect(html).not.toContain('ui-select');
  });
});

describe('AutomationConfigModal — o Salvar manda bot-config (RF-08)', () => {
  it('chama putAutomation(index, draft) e fecha', async () => {
    const source = await readFile(new URL('./AutomationConfigModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('putAutomation(index, draft)');
    expect(source).toContain('automationProblem(draft, items, ammunition)');
  });
});
