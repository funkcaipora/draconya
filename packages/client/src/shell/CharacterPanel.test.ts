import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';
import { CharacterPanel } from './CharacterPanel.js';
import { INITIAL_HUD, hud } from '../state/hud.js';

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(CharacterPanel));
  return new Response(prelude).text();
}

describe('CharacterPanel', () => {
  it('shows experience, level, HP, mana, capacity and stamina — the six fields that arrive', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      xp: 125_430, level: 42, health: 380, maxHealth: 420, mana: 210, maxMana: 260,
      capacity: 4_150, staminaMs: 151_200_000, // 42 h
    }));
    const html = await render();
    expect(html).toContain('PERSONAGEM');
    expect(html).toContain('Experiência');
    expect(html).toContain('125.430');
    expect(html).toContain('Level');
    expect(html).toContain('380 / 420');
    expect(html).toContain('210 / 260');
    expect(html).toContain('4.150 oz');
    expect(html).toContain('42 h 0 min');
  });

  it('never shows a row for Soul, Speed, Magic Level or skills', async () => {
    hud.set(() => ({ ...INITIAL_HUD, level: 8 }));
    const html = await render();
    expect(html).not.toContain('Soul');
    expect(html).not.toContain('Speed');
    expect(html).not.toContain('Magic Level');
  });

  it('shows zero stamina as "0 s", never as "—" (the field is never optional)', async () => {
    hud.set(() => ({ ...INITIAL_HUD, staminaMs: 0 }));
    const html = await render();
    expect(html).toContain('0 s');
    expect(html).not.toContain('—');
  });

  it('has no percent bar (RF-02): the XP curve to the next level does not travel', async () => {
    hud.set(() => ({ ...INITIAL_HUD, level: 1 }));
    const html = await render();
    expect(html).not.toContain('ui-stat-row-bar');
  });

  it('is mountable with the header collapse toggle wired to Panel (RF-04)', async () => {
    hud.set(() => ({ ...INITIAL_HUD }));
    const html = await render();
    expect(html).toContain('ui-panel--dock');
    expect(html).toContain('minimizar');
  });
});
