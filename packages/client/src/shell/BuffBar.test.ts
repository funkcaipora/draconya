import { createElement, type ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { BuffBar, statusBadgesOf } from './BuffBar.js';
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

  it('a luz (#623) tem badge dourada "Luz" com o tempo restante', async () => {
    hud.set((state) => ({
      ...state,
      conditions: [{
        kind: 'light', remainingMs: 370_000, light: { level: 6, color: 215, durationMs: 370_000 },
      }],
      conditionsReceivedAtMs: performance.now(),
    }));
    const html = await render(createElement(BuffBar));
    expect(html).toContain('ui-badge-gold');
    expect(html).toContain('Luz 6:10');
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

describe('os ícones de zona e de luta do mundo (OW-23, #846)', () => {
  it('na PZ acende a zona de proteção, com o selo sagrado', async () => {
    hud.set((state) => ({ ...state, zone: 'protection', inFight: false }));
    const html = await render(createElement(BuffBar));
    expect(html).toContain('ui-badge-holy');
    expect(html).toContain('Zona de proteção');
    expect(html).not.toContain('Em luta');
  });

  it('em luta fora da PZ acende "Em luta", com o selo de sangue', async () => {
    hud.set((state) => ({ ...state, zone: 'normal', inFight: true }));
    const html = await render(createElement(BuffBar));
    expect(html).toContain('ui-badge-blood');
    expect(html).toContain('Em luta');
    expect(html).not.toContain('Zona de proteção');
  });

  it('dentro da PZ a luta APAGA: o Canary tira as espadas quando o personagem pisa a zona protegida', async () => {
    hud.set((state) => ({ ...state, zone: 'protection', inFight: true }));
    const html = await render(createElement(BuffBar));
    // Mutação que mata: acender os dois — o jogador leria "em luta" dentro de uma zona onde a luta não o prende.
    expect(html).toContain('Zona de proteção');
    expect(html).not.toContain('Em luta');
  });

  it('o servidor que não diz (null) não acende nada, e a barra some inteira', async () => {
    hud.set((state) => ({ ...state, zone: null, inFight: null }));
    expect(await render(createElement(BuffBar))).toBe('');
  });

  it('no-pvp e no-logout não têm ícone: só a PZ tem o pombo', () => {
    expect(statusBadgesOf('no-pvp', false)).toEqual([]);
    expect(statusBadgesOf('no-logout', false)).toEqual([]);
    expect(statusBadgesOf('normal', false)).toEqual([]);
    expect(statusBadgesOf('protection', null).map((badge) => badge.id)).toEqual(['protection-zone']);
    expect(statusBadgesOf('normal', true).map((badge) => badge.id)).toEqual(['in-fight']);
  });

  it('os ícones ficam na mesma fileira das condições, antes delas', async () => {
    hud.set((state) => ({
      ...state,
      zone: 'protection',
      conditions: [{ kind: 'haste', remainingMs: 60_000 }],
      conditionsReceivedAtMs: performance.now(),
    }));
    const html = await render(createElement(BuffBar));
    expect(html.indexOf('Zona de proteção')).toBeGreaterThan(-1);
    expect(html.indexOf('Haste')).toBeGreaterThan(html.indexOf('Zona de proteção'));
  });
});
