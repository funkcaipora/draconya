import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlayerVitalsOverlay } from './PlayerVitalsOverlay.js';
import { arcDasharray } from './vital-arc.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import { INITIAL_ACCOUNT, account } from '../account/store.js';

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(PlayerVitalsOverlay));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD }));
  account.set(() => ({ ...INITIAL_ACCOUNT }));
});

describe('PlayerVitalsOverlay (#328, RC-15)', () => {
  it('reads the name from account and renders separate HP and mana fractions', async () => {
    hud.set(() => ({
      ...INITIAL_HUD, characterId: 'c1', health: 50, maxHealth: 100, mana: 20, maxMana: 80,
    }));
    account.set(() => ({
      ...INITIAL_ACCOUNT,
      characters: [{
        id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'hunt', sessionId: 's1',
      }],
    }));

    const html = await render();

    expect(html).toContain('class="player-vitals-name"');
    expect(html).toContain('>Aldric<');
    expect((html.match(/class="vital-arc(?: vital-arc-flip)?"/g) ?? [])).toHaveLength(2);
    expect(html).toContain('class="vital-arc vital-arc-flip"');
    expect(html).toContain(arcDasharray(0.5));
    expect(html).toContain(arcDasharray(0.25));
  });

  it('keeps both progress arcs empty and the name safe before the first HUD update', async () => {
    const html = await render();

    expect(html).toContain('>—<');
    expect(html).not.toContain('NaN');
    expect((html.match(/0\.00 490\.09/g) ?? [])).toHaveLength(2);
  });
});
