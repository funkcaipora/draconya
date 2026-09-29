import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { Vitals } from './Vitals.js';
import { INITIAL_HUD, hud } from '../state/hud.js';

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(Vitals));
  return new Response(prelude).text();
}

describe('Vitals', () => {
  it('mostra "valor / máximo" formatado em pt-BR dentro das barras de HP e Mana (#304, R6-01)', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      health: 3165,
      maxHealth: 3165,
      mana: 785,
      maxMana: 1000,
    }));
    const html = await render();
    expect(html).toContain('3.165 / 3.165');
    expect(html).toContain('785 / 1.000');
  });

  it('com max 0 mostra "0 / 0", nunca NaN/Infinity', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      health: 0,
      maxHealth: 0,
      mana: 0,
      maxMana: 0,
    }));
    const html = await render();
    expect(html).toContain('0 / 0');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });

  it('mantém as classes bar-hp e bar-mana para estilização pelo CSS', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      health: 100,
      maxHealth: 100,
      mana: 50,
      maxMana: 50,
    }));
    const html = await render();
    expect(html).toContain('bar-hp');
    expect(html).toContain('bar-mana');
  });
});
