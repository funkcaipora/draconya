import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsCustomizeModal, SkillsPanel } from './SkillsPanel.js';
import type { SkillsPanelProps } from './SkillsPanel.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import * as skillsPref from './skills-preference.js';

let mockVisibleOverride: readonly skillsPref.SkillId[] | null = null;

vi.mock('./skills-preference.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./skills-preference.js')>();
  return {
    ...actual,
    loadVisibleSkills: vi.fn(() => mockVisibleOverride ?? actual.loadVisibleSkills()),
  };
});

async function renderPanel(props: SkillsPanelProps = {}): Promise<string> {
  const { prelude } = await prerender(createElement(SkillsPanel, props));
  return new Response(prelude).text();
}

async function renderModal(props: Partial<Parameters<typeof SkillsCustomizeModal>[0]> = {}): Promise<string> {
  const fullProps = {
    open: true,
    onClose: () => {},
    visible: skillsPref.SKILL_ORDER,
    onApply: () => {},
    ...props,
  };
  const { prelude } = await prerender(createElement(SkillsCustomizeModal, fullProps));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD }));
  mockVisibleOverride = null;
});

describe('SkillsPanel', () => {
  it('renders title "Skills" and all 6 skill labels by default', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      xp: 125_430,
      level: 42,
      health: 380,
      mana: 210,
      capacity: 4_150,
      staminaMs: 150_000_000,
    }));
    const html = await renderPanel();
    expect(html).toContain('Skills');
    expect(html).toContain('Experiência total');
    expect(html).toContain('125.430');
    expect(html).toContain('Level');
    expect(html).toContain('42');
    expect(html).toContain('Hit Points');
    expect(html).toContain('380');
    expect(html).toContain('Mana');
    expect(html).toContain('210');
    expect(html).toContain('Capacidade');
    expect(html).toContain('4.150 oz');
    expect(html).toContain('Stamina');
    expect(html).toContain('41:40');
  });

  it('renders HP and Mana as single values with vital tones', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      health: 380,
      maxHealth: 420,
      mana: 210,
      maxMana: 260,
    }));
    const html = await renderPanel();
    // Single value, not "380 / 420"
    expect(html).not.toContain('380 / 420');
    expect(html).not.toContain('210 / 260');
    expect(html).toContain('var(--vital-hp)');
    expect(html).toContain('var(--vital-mp)');
  });

  it('renders stamina in clock format (0ms -> "0:00")', async () => {
    hud.set(() => ({ ...INITIAL_HUD, staminaMs: 0 }));
    const html = await renderPanel();
    expect(html).toContain('0:00');
    expect(html).not.toContain('0 s');
    expect(html).not.toContain('—');
  });

  it('renders capacity with "oz"', async () => {
    hud.set(() => ({ ...INITIAL_HUD, capacity: 500 }));
    const html = await renderPanel();
    expect(html).toContain('500 oz');
  });

  it('has no percent bar (ui-stat-row-bar)', async () => {
    hud.set(() => ({ ...INITIAL_HUD, level: 50 }));
    const html = await renderPanel();
    expect(html).not.toContain('ui-stat-row-bar');
  });

  it('never contains Sword Fighting, Shielding, Soul, or Speed', async () => {
    const html = await renderPanel();
    expect(html).not.toContain('Sword Fighting');
    expect(html).not.toContain('Shielding');
    expect(html).not.toContain('Soul');
    expect(html).not.toContain('Speed');
  });

  it('contains the customize settings button ⚙', async () => {
    const html = await renderPanel();
    expect(html).toContain('Personalizar skills');
    expect(html).toContain('⚙');
  });

  it('does not render hidden skills when preference excludes them', async () => {
    mockVisibleOverride = ['hp', 'mana'];
    const html = await renderPanel();
    expect(html).toContain('Hit Points');
    expect(html).toContain('Mana');
    expect(html).not.toContain('Experiência total');
    expect(html).not.toContain('Level');
    expect(html).not.toContain('Capacidade');
    expect(html).not.toContain('Stamina');
  });
});

describe('SkillsCustomizeModal', () => {
  it('renders modal title, checkboxes for all 6 skills, counter meta, and note', async () => {
    const html = await renderModal({
      visible: ['exp', 'level', 'hp', 'mana'],
    });
    expect(html).toContain('Personalizar skills');
    expect(html).toContain('4 de 6 visíveis');
    expect(html).toContain('A ordem do painel segue a ordem desta lista.');
    expect(html).toContain('Padrão');
    expect(html).toContain('Salvar');

    // All 6 skill labels present as checkboxes
    for (const label of Object.values(skillsPref.SKILL_LABELS)) {
      expect(html).toContain(label);
    }
  });

  it('renders when customizing is active on SkillsPanel', async () => {
    const html = await renderPanel({ customizing: true });
    expect(html).toContain('Personalizar skills');
    expect(html).toContain('6 de 6 visíveis');
    expect(html).toContain('A ordem do painel segue a ordem desta lista.');
  });
});
