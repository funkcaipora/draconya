import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Catalogue, HuntListing } from '../state/hud.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import { HuntDetailsModal } from './HuntDetailsModal.js';
import { setCurrentHunt } from './current-hunt.js';

const hunts: HuntListing[] = [
  { id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1, difficulties: ['cautious', 'bold'], outfitIds: [], lootDrops: 2 },
];

const catalogue: Catalogue = {
  hunts, monsters: [], ammunition: [],
  bot: { vocabularyVersion: 1, advancedFromLevel: 50, slots: {}, advancedOnly: { conditions: [], targetPolicies: [], postures: [] }, spells: [], supplies: [] },
  items: [], vocations: [], vocationLevel: 8,
};

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(HuntDetailsModal, { open: true, onClose: () => {} }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue }));
  setCurrentHunt(null);
});

describe('HuntDetailsModal', () => {
  it('shows the true hunt identity, recommended level, and difficulty names when known', async () => {
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const html = await render();
    expect(html).toContain('Rat Cellars');
    expect(html).toContain('Nível recomendado');
    expect(html).toContain('1+');
    expect(html).toContain('Dificuldades');
    expect(html).toContain('Cauteloso · Ousado');
  });

  it('explains the omission, without inventing hunt identity, when the active hunt is unknown', async () => {
    const html = await render();
    expect(html).toContain('Esta caçada foi aberta antes desta sessão do navegador');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('ui-stat-row');
  });

  it('uses the same omission while the catalogue has not arrived', async () => {
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    hud.set((state) => ({ ...state, catalogue: null }));
    const html = await render();
    expect(html).toContain('Esta caçada foi aberta antes desta sessão do navegador');
    expect(html).not.toContain('Rat Cellars');
  });

  it('never renders product-banned or unavailable kit sections', async () => {
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const html = await render();
    for (const absent of ['Seu recorde', 'Loot possível', 'PEGAR', 'VENDER', 'XP/h', 'gp/h']) {
      expect(html).not.toContain(absent);
    }
  });
});
