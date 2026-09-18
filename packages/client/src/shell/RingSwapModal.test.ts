import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { RingSwapModal } from './RingSwapModal.js';
import type { ItemDefinition } from '../state/hud.js';

const items: ItemDefinition[] = [
  { id: 'sword', name: 'Sword', appearanceId: 1, weight: 10, slot: 'hand', twoHanded: false },
  { id: 'life-ring', name: 'Life Ring', appearanceId: 2, weight: 2, slot: 'finger', twoHanded: false },
  { id: 'energy-ring', name: 'Energy Ring', appearanceId: 3, weight: 2, slot: 'finger', twoHanded: false },
];

async function render(props: Partial<Parameters<typeof RingSwapModal>[0]> = {}): Promise<string> {
  const fullProps = {
    initial: undefined,
    items,
    onClose: () => {},
    ...props,
  };
  const { prelude } = await prerender(createElement(RingSwapModal, fullProps));
  return new Response(prelude).text();
}

describe('RingSwapModal', () => {
  it('renders modal title, meta, buttons and diagram', async () => {
    const html = await render();
    expect(html).toContain('Ring swap');
    expect(html).toContain('Bot avançado');
    expect(html).toContain('Cancelar');
    expect(html).toContain('Salvar');
    expect(html).toContain('sem anel');
    expect(html).toContain('com anel');
    expect(html).toContain('⇄');
  });

  it('renders ring select with only finger rings and action on remove select', async () => {
    const html = await render();
    expect(html).toContain('Life Ring');
    expect(html).toContain('Energy Ring');
    expect(html).not.toContain('Sword');
    expect(html).toContain('Restaurar o anel anterior');
    expect(html).toContain('Deixar o dedo vazio');
  });

  it('renders percentage inputs with values', async () => {
    const html = await render({
      initial: { itemId: 'energy-ring', equipBelow: 40, removeAbove: 70, manaFloor: 15, restorePrevious: false },
    });
    expect(html).toContain('HP abaixo de');
    expect(html).toContain('HP acima de');
    expect(html).toContain('Ou mana abaixo de (piso)');
    expect(html).toContain('value="40"');
    expect(html).toContain('value="70"');
    expect(html).toContain('value="15"');
  });

  it('shows bad threshold warning when removeAbove <= equipBelow', async () => {
    const bad = await render({
      initial: { itemId: 'energy-ring', equipBelow: 60, removeAbove: 50, manaFloor: 10, restorePrevious: true },
    });
    expect(bad).toContain('Retirar precisa ser maior que equipar — sem faixa morta o anel troca a cada golpe.');
    expect(bad).not.toContain('Salvar manda agora');

    const equal = await render({
      initial: { itemId: 'energy-ring', equipBelow: 50, removeAbove: 50, manaFloor: 10, restorePrevious: true },
    });
    expect(equal).toContain('Retirar precisa ser maior que equipar — sem faixa morta o anel troca a cada golpe.');

    const good = await render({
      initial: { itemId: 'energy-ring', equipBelow: 50, removeAbove: 60, manaFloor: 10, restorePrevious: true },
    });
    expect(good).toContain('Salvar manda agora · quem decide é o servidor');
    expect(good).not.toContain('sem faixa morta');
  });

  it('não tem mais gate de level: nenhum aviso de recusa (AB-03)', async () => {
    const html = await render();
    expect(html).not.toContain('ring-swap-locked');
    expect(html).not.toContain('o servidor recusa até lá');
  });
});
