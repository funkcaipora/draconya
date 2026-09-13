import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { VocationChoice } from './VocationChoice.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

// A escolha de vocação (#154): o diálogo existe pelo ESTADO — level, vocação e catálogo — e
// nunca por um número em código. `prerender` roda a função do componente sem DOM; o que se
// prende é se ele devolve algo e o que ele escreve.

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(VocationChoice));
  return new Response(prelude).text();
}

const catalogue: Catalogue = {
  hunts: [], monsters: [], ammunition: [],
  bot: {
    vocabularyVersion: 1, advancedFromLevel: 50, slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [], supplies: [],
  },
  items: [{ id: 'steel-axe', name: 'Steel Axe', appearanceId: 3264, weight: 41, slot: 'hand', twoHanded: false }],
  vocations: [
    { id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25, startingWeaponItemId: 'steel-axe' },
    { id: 'paladin', name: 'Paladin', healthPerLevel: 10, manaPerLevel: 15, capacityPerLevel: 20, startingWeaponItemId: 'bow' },
    { id: 'sorcerer', name: 'Sorcerer', healthPerLevel: 5, manaPerLevel: 30, capacityPerLevel: 10, startingWeaponItemId: 'wand-of-vortex' },
    { id: 'druid', name: 'Druid', healthPerLevel: 5, manaPerLevel: 30, capacityPerLevel: 10, startingWeaponItemId: 'snakebite-rod' },
  ],
  vocationLevel: 8,
};

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue, level: 8, vocationId: null }));
});

describe('VocationChoice', () => {
  it('shows the four cards at the vocation level, with gains and the starting weapon', async () => {
    const html = await render();
    expect(html).toContain('escolha de vocação');
    expect((html.match(/class="vocation-card"/g) ?? []).length).toBe(4);
    expect(html).toContain('+15 HP · +5 mana · +25 cap por level');
    // A arma vem do catálogo de itens; a que não está lá mostra o id, e o jogo segue.
    expect(html).toContain('Steel Axe');
    expect(html).toContain('snakebite-rod');
  });

  it('does not exist below the level, after the choice, without a catalogue, or from an older node', async () => {
    // Mutação que mata: trocar `level < vocationLevel` por `<=`, ou abrir com `vocationLevel` 0.
    hud.set((state) => ({ ...state, level: 7 }));
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, level: 8, vocationId: 'knight' }));
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, vocationId: null, catalogue: null }));
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, catalogue: { ...catalogue, vocationLevel: 0 } }));
    expect(await render()).toBe('');
  });

  it('never carries the level in code: raising vocationLevel in the catalogue moves the dialog', async () => {
    hud.set((state) => ({ ...state, level: 8, catalogue: { ...catalogue, vocationLevel: 10 } }));
    expect(await render()).toBe('');
    hud.set((state) => ({ ...state, level: 10 }));
    expect(await render()).toContain('vocation-card');
  });
});
