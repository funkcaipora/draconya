import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { account, INITIAL_ACCOUNT } from '../account/store.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { bonusPercent } from './bestiary-progress.js';
import { CharacterModal } from './CharacterModal.js';

const BESTIARY = { milestones: [10, 50, 200], xpBonusPercentPerMilestone: 1.5 };

const CATALOGUE_WITH_BESTIARY = {
  hunts: [], monsters: [], ammunition: [], items: [],
  vocations: [
    { id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25, startingWeaponItemId: 'steel-axe' },
  ],
  vocationLevel: 8,
  bestiary: BESTIARY,
  bot: {
    vocabularyVersion: 1, advancedFromLevel: 50, slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [], supplies: [],
  },
} as unknown as Catalogue;

const CATALOGUE_WITHOUT_BESTIARY = {
  ...CATALOGUE_WITH_BESTIARY,
  bestiary: undefined,
} as unknown as Catalogue;

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(CharacterModal, { onClose: () => {} }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD }));
  account.set(() => ({ ...INITIAL_ACCOUNT }));
});

describe('CharacterModal', () => {
  it('renders the only supported tab, identity, current vital bars, and existing attributes', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      characterId: 'c1', level: 42, xp: 125_430,
      health: 380, maxHealth: 420, mana: 210, maxMana: 260,
      capacity: 4_150, staminaMs: 151_200_000, vocationId: 'knight',
      catalogue: CATALOGUE_WITH_BESTIARY,
    }));
    account.set(() => ({
      ...INITIAL_ACCOUNT,
      characters: [{ id: 'c1', name: 'Aldric', level: 42, xp: 0, gold: 0, vocation: 'knight', state: 'hunt', sessionId: 's1' }],
    }));

    const html = await render();
    expect((html.match(/role="tab"/g) ?? []).length).toBe(1);
    expect(html).toContain('Personagem');
    expect(html).not.toContain('Outfit');
    expect(html).toContain('OUTFIT');
    expect(html).toContain('Aldric');
    expect(html).toContain('Knight');
    expect(html).toContain('LV 42');
    expect(html).not.toContain('Ignis');
    expect(html).toContain('data-kind="hp"');
    expect(html).toContain('data-kind="mp"');
    expect(html).toContain('380 / 420');
    expect(html).toContain('210 / 260');
    expect(html).toContain('125.430');
    expect(html).toContain('4.150 oz');
    expect(html).toContain('42 h 0 min');
    expect(html).not.toContain('data-kind="exp"');
    expect(html).not.toContain('ui-stat-row-bar');
    expect(html).not.toContain('Velocidade');
    expect(html).not.toContain('Magic level');
    expect(html).not.toContain('Regeneração');
  });

  it('shows only level when vocation is absent and keeps a safe name fallback', async () => {
    hud.set(() => ({ ...INITIAL_HUD, characterId: 'c1', level: 3, catalogue: CATALOGUE_WITHOUT_BESTIARY }));

    const html = await render();
    expect(html).toContain('>c1<');
    expect(html).toContain('LV 3');
    expect(html).not.toContain(' · LV 3');
  });

  it('shows zero stamina as "0 s", never as a missing value', async () => {
    hud.set(() => ({ ...INITIAL_HUD, staminaMs: 0, catalogue: CATALOGUE_WITHOUT_BESTIARY }));

    const html = await render();
    expect(html).toContain('0 s');
    expect(html).not.toContain('Stamina</span><b>—');
  });

  it('uses the real Bestiary bonus formula, including the interval before counts arrive', async () => {
    const counts = { rat: 60 };
    hud.set(() => ({ ...INITIAL_HUD, catalogue: CATALOGUE_WITH_BESTIARY, bestiary: counts }));

    const html = await render();
    const expected = bonusPercent(counts, BESTIARY.milestones, BESTIARY.xpBonusPercentPerMilestone);
    expect(html).toContain('Progressão e bônus');
    expect(html).toContain('Bestiário · Bônus de XP PvE');
    expect(html).toContain('+' + expected.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' %');

    hud.set(() => ({ ...INITIAL_HUD, catalogue: CATALOGUE_WITH_BESTIARY, bestiary: null }));
    const beforeCounts = await render();
    expect(beforeCounts).toContain('+0 %');
  });

  it('omits the bonus box when the server has no Bestiary configuration', async () => {
    hud.set(() => ({ ...INITIAL_HUD, catalogue: CATALOGUE_WITHOUT_BESTIARY, bestiary: { rat: 60 } }));

    const html = await render();
    expect(html).not.toContain('Progressão e bônus');
    expect(html).not.toContain('Bônus de XP PvE');
  });

  it('never invents guild or premium bonuses', async () => {
    hud.set(() => ({ ...INITIAL_HUD, catalogue: CATALOGUE_WITH_BESTIARY, bestiary: { rat: 60 } }));

    const html = await render();
    expect(html).not.toMatch(/guild|premium/i);
  });
});
