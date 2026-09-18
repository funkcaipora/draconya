import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { ContainerWindow } from './ContainerWindow.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue, Inventory } from '../state/hud.js';

async function render(container: 'backpack' | 'satchel', collapsed = false): Promise<string> {
  const { prelude } = await prerender(createElement(ContainerWindow, { container, collapsed }));
  return new Response(prelude).text();
}

const catalogue: Catalogue = {
  hunts: [], monsters: [], ammunition: [], vocations: [], vocationLevel: 8,
  bot: { vocabularyVersion: 1, advancedFromLevel: 50, slots: {}, advancedOnly: { conditions: [], targetPolicies: [], postures: [] }, spells: [], supplies: [] },
  items: [
    { id: 'backpack', name: 'Backpack', appearanceId: 2854, weight: 18, slot: 'back', twoHanded: false },
    { id: 'cheese', name: 'Cheese', appearanceId: 3607, weight: 1, slot: null, twoHanded: false },
    { id: 'sword', name: 'Sword', appearanceId: 3264, weight: 10, slot: 'hand', twoHanded: false },
  ],
};
const cheese = { instanceId: 'c1', itemId: 'cheese', quantity: 7 };
const sword = { instanceId: 's1', itemId: 'sword', quantity: 1 };
const inventory = (over: Partial<Inventory> = {}): Inventory => ({
  backpack: [cheese, null, sword, ...Array<null>(22).fill(null)],
  satchel: Array<null>(10).fill(null),
  equipped: { back: { instanceId: 'b1', itemId: 'backpack', quantity: 1 } },
  capacity: { used: 10, total: 400 },
  ...over,
});

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue, inventory: inventory() }));
});

describe('ContainerWindow', () => {
  it('draws one place per position — 25 places, empty as a place, the stack with its count — and the title with the container', async () => {
    const html = await render('backpack');
    expect((html.match(/ui-slot--empty/g) ?? []).length).toBe(23);
    expect((html.match(/data-kind="loot"/g) ?? []).length).toBe(2);
    expect(html).toContain('<b class="ui-slot-count">7</b>');
    // RF-09: contagem em container aparece SEMPRE, inclusive quantity: 1
    expect(html).toContain('<b class="ui-slot-count">1</b>');
    expect(html).toContain('title="Vestir Sword"');
    expect(html).toContain('title="Cheese"');
    expect(html).toContain('2/25');
  });

  it('the satchel is a second window of the same shape, and says so when empty', async () => {
    const html = await render('satchel');
    expect((html.match(/ui-slot--empty/g) ?? []).length).toBe(10);
    expect(html).toContain('0/10');
  });

  it('without a backpack on the back the window says so; collapsed keeps the header; loading exists', async () => {
    hud.set((state) => ({ ...state, inventory: inventory({ backpack: [], equipped: {} }) }));
    expect(await render('backpack')).toContain('Sem mochila nas costas');
    const collapsed = await render('backpack', true);
    expect(collapsed).toContain('collapsed');
    expect(collapsed).toContain('<strong class="ui-panel-title">Mochila</strong>');
    hud.set((state) => ({ ...state, inventory: null }));
    expect(await render('backpack')).toContain('Carregando');
  });
});
