import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { AddAutomationModal } from './AddAutomationModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

// O catálogo de modelos (AB-12, #427), régua `docs/kit-reference/35-modal-add-automation.png`.
// `prerender` roda sem DOM: prende a lista vinda do catálogo (os cinco `label`, sem a sexta e sem
// a trava de level) e o `disabled` do modelo sem item. O clique é preso por inspeção de fonte.

const items = (): Catalogue['items'] => [
  { id: 'life-ring', name: 'Life Ring', appearanceId: 1, weight: 1, slot: 'finger', twoHanded: false, kind: 'ring' },
  { id: 'glacier-amulet', name: 'Glacier Amulet', appearanceId: 2, weight: 1, slot: 'neck', twoHanded: false, kind: 'amulet' },
  { id: 'burst-arrow', name: 'Burst Arrow', appearanceId: 3, weight: 1, slot: 'ammo', twoHanded: false, kind: 'ammo' },
  { id: 'arrow', name: 'Arrow', appearanceId: 4, weight: 1, slot: 'ammo', twoHanded: false, kind: 'ammo' },
  { id: 'steel-axe', name: 'Steel Axe', appearanceId: 5, weight: 1, slot: 'hand', twoHanded: false, kind: 'weapon' },
  { id: 'spike-sword', name: 'Spike Sword', appearanceId: 6, weight: 1, slot: 'hand', twoHanded: true, kind: 'weapon' },
  { id: 'wooden-shield', name: 'Wooden Shield', appearanceId: 7, weight: 1, slot: 'shield', twoHanded: false, kind: 'shield' },
];

const catalogue = (catalogueItems: Catalogue['items']): Catalogue => ({
  hunts: [],
  monsters: [],
  vocations: [],
  vocationLevel: 0,
  items: catalogueItems,
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

async function render(): Promise<string> {
  const { prelude } = await prerender(
    createElement(AddAutomationModal, { onPick: () => {}, onClose: () => {} }),
  );
  return new Response(prelude).text();
}

beforeEach(() => { hud.set(() => ({ ...INITIAL_HUD, catalogue: catalogue(items()) })); });

describe('AddAutomationModal — o catálogo v2 (RF-04/RF-05)', () => {
  it('lista os cinco modelos do catálogo, com o subtítulo de apresentação', async () => {
    const html = await render();
    for (const label of [
      'Renovar anel', 'Renovar colar', 'Trocar munição por alvos',
      'Trocar arma/escudo por vida', 'Trocar anel por vida',
    ]) {
      expect(html).toContain(label);
    }
    expect((html.match(/automation-option/g) ?? []).length).toBe(5);
    expect(html).toContain('Munição em área com muitos alvos');
  });

  it('não oferece "Comer comida" nem "LV 50"', async () => {
    const html = await render();
    expect(html).not.toContain('Comer comida');
    expect(html).not.toContain('LV 50');
  });

  it('o modelo sem o item exigido no catálogo fica disabled (DT-05)', async () => {
    hud.set((state) => ({
      ...state,
      catalogue: catalogue(items().filter((entry) => entry.slot !== 'shield')),
    }));
    const html = await render();
    expect((html.match(/automation-option[^>]*disabled/g) ?? []).length).toBe(1);
  });

  it('sem catálogo devolve null — nunca uma lista vazia', async () => {
    hud.set((state) => ({ ...state, catalogue: null }));
    const html = await render();
    expect(html).toBe('');
  });
});

describe('AddAutomationModal — a escolha (RF-04)', () => {
  it('ADICIONAR nasce desabilitado e chama onPick(model) ao escolher', async () => {
    const html = await render();
    expect(html).toMatch(/disabled[^>]*>Adicionar/);
    const source = await readFile(new URL('./AddAutomationModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('disabled={picked === null}');
    expect(source).toContain('onPick(picked)');
    expect(source).toContain('blankAutomation(entry.model, catalogue.items) === null');
  });
});
