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
  it('shows the ten permitted server values in the fixed panel order', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      xp: 125_430, level: 42, health: 380, mana: 210, capacity: 4_150, staminaMs: 151_200_000,
      speed: 118,
      skills: {
        melee: { level: 25, percent: 50 },
        distance: { level: 18, percent: 70 },
        magic: { level: 15, percent: 35 },
      },
    }));

    const html = await render();
    expect(html).toContain('ui-panel-title">Skills');
    expect(html).toContain('125.430');
    expect(html).toContain('42:00');
    expect(html).toContain('4.150 oz');
    const order = [
      'Experiência total', 'Level', 'Hit Points', 'Mana', 'Capacidade', 'Speed', 'Stamina',
      'Magic Level', 'Corpo a Corpo', 'Distância',
    ].map((label) => html.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('uses vital tones for current HP and mana without maximums or progress bars', async () => {
    // Isola HP/mana: com as dez linhas visíveis, magic/melee/distance sempre desenham a barra
    // (mesmo em 0%), e essa asserção é especificamente sobre HP/mana não terem uma.
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === STORAGE_KEY ? '["hp","mana"]' : null),
      setItem: vi.fn(),
    });
    hud.set(() => ({ ...INITIAL_HUD, health: 380, maxHealth: 420, mana: 210, maxMana: 260 }));

    const html = await render();
    expect(html).toContain('--stat-tone:var(--vital-hp)');
    expect(html).toContain('--stat-tone:var(--vital-mp)');
    expect(html).not.toContain('380 / 420');
    expect(html).not.toContain('210 / 260');
    expect(html).not.toContain('ui-stat-row-bar');
  });

  it('shows speed as a plain integer with no progress bar', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === STORAGE_KEY ? '["speed"]' : null),
      setItem: vi.fn(),
    });
    hud.set(() => ({ ...INITIAL_HUD, speed: 118 }));

    const html = await render();
    expect(html).toContain('Speed');
    expect(html).toContain('118');
    expect(html).not.toContain('ui-stat-row-bar');
  });

  it('shows magic level with the vital-mp tone and a percent progress bar', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === STORAGE_KEY ? '["magic"]' : null),
      setItem: vi.fn(),
    });
    hud.set(() => ({
      ...INITIAL_HUD,
      skills: { ...INITIAL_HUD.skills, magic: { level: 15, percent: 35 } },
    }));

    const html = await render();
    expect(html).toContain('Magic Level');
    expect(html).toContain('15');
    expect(html).toContain('--stat-tone:var(--vital-mp)');
    expect(html).toContain('ui-stat-row-bar');
    expect(html).toMatch(/width:\s*35%/);
  });

  it('shows melee and distance with level and a percent bar, without a vital tone', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => key === STORAGE_KEY ? '["melee","distance"]' : null),
      setItem: vi.fn(),
    });
    hud.set(() => ({
      ...INITIAL_HUD,
      skills: {
        ...INITIAL_HUD.skills,
        melee: { level: 25, percent: 50 },
        distance: { level: 18, percent: 70 },
      },
    }));

    const html = await render();
    expect(html).toContain('Corpo a Corpo');
    expect(html).toContain('25');
    expect(html).toContain('Distância');
    expect(html).toContain('18');
    expect(html).toMatch(/width:\s*50%/);
    expect(html).toMatch(/width:\s*70%/);
    expect(html).not.toContain('--stat-tone');
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
    expect(html).not.toContain('Speed');
    expect(html).not.toContain('Magic Level');
    expect(html).not.toContain('Corpo a Corpo');
    expect(html).not.toContain('Distância');
    // Skills clássicas do Tibia que este jogo nunca teve (ADR 0026 decisão 4): nenhuma
    // preferência salva pode fazê-las aparecer, porque elas não existem em `SKILL_ORDER`.
    expect(html).not.toContain('Soul');
    expect(html).not.toContain('Sword Fighting');
    expect(html).not.toContain('Shielding');
  });

  it('defaults to all ten skills, including the newly added ones, when storage is empty', async () => {
    const html = await render();
    for (const label of ['Speed', 'Magic Level', 'Corpo a Corpo', 'Distância']) {
      expect(html).toContain(label);
    }
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
