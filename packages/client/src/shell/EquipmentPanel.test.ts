import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { EquipmentPanel } from './EquipmentPanel.js';
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
  const { prelude } = await prerender(createElement(EquipmentPanel));
  return new Response(prelude).text();
}

const catalogue: Catalogue = {
  hunts: [],
  monsters: [],
  vocations: [], vocationLevel: 8,
  ammunition: [
    { id: 'arrow', name: 'Arrow', family: 'arrow', attack: 25, price: 0, appearanceId: 3447, requires: {} },
    { id: 'sniper-arrow', name: 'Sniper Arrow', family: 'arrow', attack: 28, price: 5, appearanceId: 7364, requires: { level: 20 } },
  ],
  bot: {
    vocabularyVersion: 1, slots: {},
    spells: [], supplies: [],
  },
  items: [
    { id: 'sword', name: 'Sword', appearanceId: 3264, weight: 10, slot: 'hand', twoHanded: false },
    { id: 'gold-coin', name: 'Gold Coin', appearanceId: 3031, weight: 0.1, slot: null, twoHanded: false },
    { id: 'bow', name: 'Bow', appearanceId: 3350, weight: 31, slot: 'hand', twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } },
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

  it('o slot vazio é um lugar com aria-label, não um botão de tirar', async () => {
    hud.set((state) => ({ ...state, catalogue, inventory: inventory() }));

    const html = await render();

    expect(html).toContain('aria-label="Mão (vazio)"');
    expect(html).not.toContain('Tirar');
  });

  it('o slot vazio mostra o rótulo do lugar em texto, maiúsculo (#250)', async () => {
    hud.set((state) => ({ ...state, catalogue, inventory: inventory() }));
    const html = await render();
    expect(html).toContain('class="ui-slot ui-slot--empty"');
    expect(html).toContain('title="Mão"');
    expect(html).toContain('aria-label="Mão (vazio)"');
    expect(html).toContain('>MÃO<');
    expect(html).not.toContain('role="img"');
  });

  it('o rótulo do slot vazio é cortado em 4 letras, mas aria-label e title ficam com o nome inteiro (#253, DT-02)', async () => {
    hud.set((state) => ({ ...state, catalogue, inventory: inventory() }));
    const html = await render();
    expect(html).toContain('title="Pescoço"');
    expect(html).toContain('aria-label="Pescoço (vazio)"');
    expect(html).toContain('>PESC<');
    expect(html).not.toContain('>PESCOÇO<');
  });

  it('traceja os sete lugares do kit e mantém mão/peito/escudo sólidos (#307, RF-01)', async () => {
    hud.set((state) => ({ ...state, catalogue, inventory: inventory() }));
    const html = await render();
    // Tracejados: head, neck, back, legs, feet, finger, ammo
    for (const slot of ['head', 'neck', 'back', 'legs', 'feet', 'finger', 'ammo']) {
      const match = html.match(new RegExp(`<li class="slot-${slot}"><button[^>]*class="([^"]*)"`));
      expect(match?.[1]).toContain('ui-slot--dashed');
    }
    // Sólidos: hand, chest, shield
    for (const slot of ['hand', 'chest', 'shield']) {
      const match = html.match(new RegExp(`<li class="slot-${slot}"><button[^>]*class="([^"]*)"`));
      expect(match?.[1]).not.toContain('ui-slot--dashed');
      expect(match?.[1]).toContain('ui-slot');
    }
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

    expect(await render()).toContain('<b class="ui-slot-count">40</b>');
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

describe('a coluna da direita (#161)', () => {
  it('mostra a capacidade do hud sob os dez slots, com rótulo Cap e números pt-BR, sem gold (#307, RF-08)', async () => {
    hud.set((state) => ({ ...state, catalogue, gold: 1234, inventory: inventory({ capacity: { used: 612, total: 3715 } }) }));
    const html = await render();
    expect((html.match(/class="slot-/g) ?? []).length).toBe(10);
    expect(html).toContain('>Cap<');
    expect(html).toContain('612 / 3.715 oz');
    expect(html).not.toContain('capacity-gold');
    expect(html).not.toContain('1.234');
  });

  it('com um bow na mão, o escudo vira o seletor de munição — a grátis quando não há escolha, a escolhida quando há', async () => {
    // Mutação que mata: ignorar `weapon.kind` (o escudo continua slot), ou mostrar a escolhida
    // com `ammo.arrow` nulo em vez de cair na grátis.
    hud.set((state) => ({
      ...state, catalogue,
      inventory: inventory({ equipped: { hand: { instanceId: 'b1', itemId: 'bow', quantity: 1 } } }),
    }));
    const free = await render();
    // #218: o seletor é o slot ESCUDO (`slot-shield`) com o contorno tracejado próprio
    // (`slot-ammo-picker`); a classe `slot-ammo` continua sendo só do slot `ammo` de verdade.
    expect(free).toContain('class="slot-shield"');
    expect(free).toContain('slot-ammo-picker');
    expect(free).toContain('class="slot-ammo"');
    expect(free).toContain('munição: Arrow · grátis');
    expect(free).not.toContain('Escudo (vazio)');
    hud.set((state) => ({ ...state, ammo: { arrow: 'sniper-arrow', bolt: null } }));
    const chosen = await render();
    expect(chosen).toContain('munição: Sniper Arrow · 5 gold/tiro');
    // Sem bow, o escudo é um slot.
    hud.set((state) => ({ ...state, inventory: inventory() }));
    expect(await render()).toContain('Escudo (vazio)');
  });

  it('minimizado mantém o cabeçalho e não desmonta', async () => {
    hud.set((state) => ({ ...state, catalogue, inventory: inventory() }));
    const { prelude } = await prerender(createElement(EquipmentPanel, { collapsed: true }));
    const html = await new Response(prelude).text();
    expect(html).toContain('collapsed');
    expect(html).toContain('<strong class="ui-panel-title">Set</strong>');
  });
});
