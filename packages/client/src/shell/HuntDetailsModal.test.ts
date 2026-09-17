import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { HuntDetailsModal } from './HuntDetailsModal.js';
import { currentHunt, setCurrentHunt } from './current-hunt.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue, HuntListing } from '../state/hud.js';

const hunt: HuntListing = {
  id: 'rat-cellars',
  name: 'Rat Cellars',
  recommendedLevel: 1,
  difficulties: ['cautious', 'bold', 'reckless'],
  difficultyDetails: [
    { id: 'cautious', monsterCount: 2 },
    { id: 'bold', monsterCount: 5 },
    { id: 'reckless', monsterCount: 8 },
  ],
  outfitIds: [21],
  lootDrops: 2,
  monsters: [],
  loot: [],
};

const catalogue: Catalogue = {
  hunts: [hunt],
  monsters: [],
  ammunition: [],
  bot: {
    vocabularyVersion: 1,
    advancedFromLevel: 50,
    slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [],
    supplies: [],
  },
  items: [],
  vocations: [],
  vocationLevel: 8,
};

async function render(props: { open: boolean; onClose?: () => void }): Promise<string> {
  const { prelude } = await prerender(createElement(HuntDetailsModal, { onClose: () => {}, ...props }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue }));
  setCurrentHunt(null);
});

describe('HuntDetailsModal (#325)', () => {
  it('RF-05: with known hunt, renders hunt name, recommended level and difficulties', async () => {
    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const html = await render({ open: true });

    expect(html).toContain(hunt.name);
    expect(html).toContain(`${String(hunt.recommendedLevel)}+`);
    expect(html).toContain('Ousado');
    expect(html).toContain('Cauteloso · Ousado · Agressivo');
    expect(html).toContain('ui-stat-row');
  });

  it('RF-06: with currentHunt null, renders omission paragraph and no h2 or stat rows', async () => {
    setCurrentHunt(null);
    const html = await render({ open: true });

    expect(html).toContain('Esta caçada foi aberta antes desta sessão do navegador');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('ui-stat-row');
  });

  it('RF-07 & RF-08: in neither state does the HTML contain forbidden strings', async () => {
    const forbidden = ['Seu recorde', 'Loot possível', 'PEGAR', 'VENDER', 'XP/h', 'gp/h', 'gold/h'];

    setCurrentHunt(null);
    const htmlEmpty = await render({ open: true });
    for (const phrase of forbidden) {
      expect(htmlEmpty).not.toContain(phrase);
    }

    setCurrentHunt({ huntId: 'rat-cellars', difficulty: 'bold' });
    const htmlKnown = await render({ open: true });
    for (const phrase of forbidden) {
      expect(htmlKnown).not.toContain(phrase);
    }
  });

  it('renders nothing when open is false', async () => {
    const html = await render({ open: false });
    expect(html).toBe('');
  });
});
