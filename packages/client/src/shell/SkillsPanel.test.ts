import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_HUD, hud } from '../state/hud.js';
import { SkillsPanel } from './SkillsPanel.js';

const STORAGE_KEY = 'draconya:shell:skillsPanel:visible';

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(SkillsPanel));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD }));
  vi.stubGlobal('localStorage', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SkillsPanel', () => {
  it('shows the six permitted server values in the fixed panel order', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      xp: 125_430, level: 42, health: 380, mana: 210, capacity: 4_150, staminaMs: 151_200_000,
    }));

    const html = await render();
    expect(html).toContain('ui-panel-title">Skills');
    expect(html).toContain('125.430');
    expect(html).toContain('42:00');
    expect(html).toContain('4.150 oz');
    const order = ['Experiência total', 'Level', 'Hit Points', 'Mana', 'Capacidade', 'Stamina']
      .map((label) => html.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('uses vital tones for current HP and mana without maximums or progress bars', async () => {
    hud.set(() => ({ ...INITIAL_HUD, health: 380, maxHealth: 420, mana: 210, maxMana: 260 }));

    const html = await render();
    expect(html).toContain('--stat-tone:var(--vital-hp)');
    expect(html).toContain('--stat-tone:var(--vital-mp)');
    expect(html).not.toContain('380 / 420');
    expect(html).not.toContain('210 / 260');
    expect(html).not.toContain('ui-stat-row-bar');
  });

  it('honors a persisted subset and never invents classic Tibia skills', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === STORAGE_KEY ? '["hp","stamina"]' : null),
      setItem: vi.fn(),
    });

    const html = await render();
    expect(html).toContain('Hit Points');
    expect(html).toContain('Stamina');
    expect(html).not.toContain('Experiência total');
    expect(html).not.toContain('Soul');
    expect(html).not.toContain('Speed');
    expect(html).not.toContain('Magic Level');
    expect(html).not.toContain('Sword Fighting');
    expect(html).not.toContain('Shielding');
  });

  it('is a collapsible dock panel with a dedicated customize action', async () => {
    const html = await render();
    expect(html).toContain('ui-panel--dock');
    expect(html).toContain('title="Personalizar skills"');
    expect(html).toContain('title="minimizar"');
  });

  it('wires the immediate customization modal and its two-column layout', async () => {
    const source = await readFile(new URL('./SkillsPanel.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('./shell.css', import.meta.url), 'utf8');

    expect(source).toContain('function SkillsCustomizeModal');
    expect(source).toContain('title="Personalizar skills"');
    expect(source).toContain("' de ' + String(SKILL_ORDER.length) + ' visíveis'");
    expect(source).toContain('onChange(selected.includes(id)');
    expect(source).toContain('>Padrão</Button>');
    expect(source).toContain('>Salvar</Button>');
    expect(source.lastIndexOf('{customizing &&')).toBeGreaterThan(source.lastIndexOf('</Panel>'));
    expect(css).toMatch(/\.skills-customize-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr;/s);
  });
});
