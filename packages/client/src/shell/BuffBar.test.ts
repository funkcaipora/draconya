import { createElement, type ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { BuffBar } from './BuffBar.js';
import { INITIAL_HUD, hud } from '../state/hud.js';

async function render(element: ReactElement): Promise<string> {
  const { prelude } = await prerender(element);
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => INITIAL_HUD);
});

describe('a barra de condições ativas BuffBar (#348, SV-12)', () => {
  it('com conditions vazio, renderiza vazio / null', async () => {
    hud.set((state) => ({ ...state, conditions: [], conditionsReceivedAtMs: 0 }));
    const html = await render(createElement(BuffBar));
    expect(html).toBe('');
  });

  it('mostra condição haste com badge e tempo formatado', async () => {
    hud.set((state) => ({
      ...state,
      conditions: [{ kind: 'haste', remainingMs: 134_000 }],
      conditionsReceivedAtMs: performance.now(),
    }));
    const html = await render(createElement(BuffBar));
    expect(html).toContain('ui-badge-haste');
    expect(html).toContain('Haste 2:14');
  });

  it('renderiza o tom e rótulo corretos para cada tipo de condição', async () => {
    hud.set((state) => ({
      ...state,
      conditions: [
        { kind: 'haste', remainingMs: 60_000 },
        { kind: 'buff', remainingMs: 60_000 },
        { kind: 'mana-shield', remainingMs: 60_000 },
        { kind: 'heal-over-time', remainingMs: 60_000 },
      ],
      conditionsReceivedAtMs: performance.now(),
    }));
    const html = await render(createElement(BuffBar));
    expect(html).toContain('ui-badge-haste');
    expect(html).toContain('Haste');
    expect(html).toContain('ui-badge-gold');
    expect(html).toContain('Bônus ativo');
    expect(html).toContain('ui-badge-energy');
    expect(html).toContain('Escudo mágico');
    expect(html).toContain('ui-badge-ice');
    expect(html).toContain('Cura contínua');
  });

  it('não renderiza condição expirada (remaining <= 0)', async () => {
    hud.set((state) => ({
      ...state,
      conditions: [{ kind: 'haste', remainingMs: 0 }],
      conditionsReceivedAtMs: performance.now(),
    }));
    const html = await render(createElement(BuffBar));
    expect(html).not.toContain('ui-badge-haste');
  });
});
