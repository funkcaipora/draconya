import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { Inventory } from './Inventory.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue, Inventory as InventoryState } from '../state/hud.js';

/**
 * A árvore em HTML, sem DOM: `prerender` roda a função do componente e pula os efeitos — o
 * `ItemSprite` não chega a pedir o quadro ao pacote (não há pacote aqui), então o que
 * aparece é a INICIAL do nome e o `aria-label` do canvas. É o suficiente para prender o
 * defeito: com o equipado errado, a inicial era "I" de "item" e o tooltip dizia "Tirar
 * item"; com ele certo, é "S" de "Sword" e "Tirar Sword".
 *
 * É `react-dom/static`, e não `react-dom/server`, por causa do lint de fronteira: o glob
 * `server` que proíbe `packages/server` no cliente casa com o subpath do React também.
 */
async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(Inventory));
  return new Response(prelude).text();
}

const catalogue: Catalogue = {
  hunts: [],
  monsters: [],
  ammunition: [], vocations: [], vocationLevel: 8,
  bot: {
    vocabularyVersion: 1, advancedFromLevel: 50, slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [], supplies: [],
  },
  items: [
    { id: 'sword', name: 'Sword', appearanceId: 3264, weight: 10, slot: 'hand', twoHanded: false },
    { id: 'gold-coin', name: 'Gold Coin', appearanceId: 3031, weight: 0.1, slot: null, twoHanded: false },
  ],
};

const inventory = (over: Partial<InventoryState> = {}): InventoryState => ({
  backpack: [],
  satchel: [],
  equipped: {},
  capacity: { used: 10, total: 400 },
  ...over,
});

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
});

describe('o slot equipado (FUN-108)', () => {
  it('desenha o item VESTIDO pelo nome e pela aparência, não a inicial de "item"', async () => {
    // O item equipado NÃO está na mochila — o servidor o move ao equipar. Procurá-lo lá era
    // o defeito: o slot da mão saía com "I", `aria-label="item"` e "Tirar item".
    // Mutação que mata: resolver o equipado pela mochila (`backpack.find(instanceId)`) em
    // vez de por `inventory.equipped[slot].itemId` — o nome cai em "item".
    hud.set((state) => ({
      ...state,
      catalogue,
      inventory: inventory({
        equipped: { hand: { instanceId: 'i1', itemId: 'sword', quantity: 1 } },
      }),
    }));

    const html = await render();

    expect(html).toContain('title="Tirar Sword"');
    expect(html).toContain('aria-label="Sword"');
    expect(html).toContain('>S</span>');
    expect(html).not.toContain('Tirar item');
    expect(html).not.toContain('aria-label="item"');
  });

  it('o slot vazio é um lugar, não um botão', async () => {
    hud.set((state) => ({ ...state, catalogue, inventory: inventory() }));

    const html = await render();

    expect(html).toContain('aria-label="Mão (vazio)"');
    expect(html).not.toContain('Tirar');
  });

  it('a pilha vestida mostra a quantidade, que vem da MENSAGEM', async () => {
    // A quantidade do equipado viaja com ele (FUN-108); antes ela era `1` fixo porque o
    // slot não tinha de onde tirá-la. Mutação que mata: `quantity={1}` no slot vestido.
    hud.set((state) => ({
      ...state,
      catalogue,
      inventory: inventory({
        equipped: { ammo: { instanceId: 'i9', itemId: 'gold-coin', quantity: 40 } },
      }),
    }));

    expect(await render()).toContain('<span class="slot-count">40</span>');
  });

  it('item vestido que o catálogo não conhece cai no id, e não em "item"', async () => {
    // O `itemId` agora chega na mensagem, então o pior caso é o id cru — que ainda diz algo.
    hud.set((state) => ({
      ...state,
      catalogue,
      inventory: inventory({
        equipped: { head: { instanceId: 'i2', itemId: 'mystery-hat', quantity: 1 } },
      }),
    }));

    expect(await render()).toContain('title="Tirar mystery-hat"');
  });
});
