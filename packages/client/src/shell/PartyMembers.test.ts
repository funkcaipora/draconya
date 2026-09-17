import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyMembers, vocationAbbreviation } from './PartyMembers.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

const mockCatalogue = {
  hunts: [], monsters: [], ammunition: [],
  bot: {
    vocabularyVersion: 1, advancedFromLevel: 50, slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [], supplies: [],
  },
  items: [],
  vocations: [
    { id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25, startingWeaponItemId: 'steel-axe' },
    { id: 'paladin', name: 'Paladin', healthPerLevel: 10, manaPerLevel: 15, capacityPerLevel: 20, startingWeaponItemId: 'bow' },
    { id: 'sorcerer', name: 'Sorcerer', healthPerLevel: 5, manaPerLevel: 30, capacityPerLevel: 10, startingWeaponItemId: 'wand-of-vortex' },
    { id: 'druid', name: 'Druid', healthPerLevel: 5, manaPerLevel: 30, capacityPerLevel: 10, startingWeaponItemId: 'snakebite-rod' },
  ],
  vocationLevel: 8,
} as unknown as Catalogue;

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(PartyMembers, {}));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me' }));
});

describe('vocationAbbreviation', () => {
  it('derives uppercase single letter vocation abbreviation from name (DT-01)', () => {
    expect(vocationAbbreviation('Knight')).toBe('K');
    expect(vocationAbbreviation('Paladin')).toBe('P');
    expect(vocationAbbreviation('druid')).toBe('D');
    expect(vocationAbbreviation('Sorcerer')).toBe('S');
  });
});

describe('PartyMembers', () => {
  it('renders nothing outside a party', async () => {
    expect(await render()).toBe('');
  });

  it('shows the leader star gold even when the leader is not you', async () => {
    hud.set((state) => ({
      ...state,
      party: {
        leaderId: 'other',
        mode: 'split',
        members: [
          { characterId: 'other', name: 'Aldric', alive: true, healthPercent: 90, vocationId: null },
          { characterId: 'me', name: 'Você mesmo', alive: true, healthPercent: 70, vocationId: null },
        ],
      },
    }));
    const html = await render();
    const starIndex = html.indexOf('party-leader-star');
    const nameIndex = html.indexOf('Aldric');
    expect(starIndex).toBeGreaterThan(-1);
    expect(starIndex).toBeLessThan(nameIndex);
  });

  it('footer has the note, the mode text and the leave button, in order', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'shared', members: [{ characterId: 'me', name: 'Você', alive: true, healthPercent: 100, vocationId: null }] },
    }));
    const html = await render();
    const noteIndex = html.indexOf('Parar no meio da caçada exige o sim de todos.');
    const modeIndex = html.indexOf('Compartilhado');
    const leaveIndex = html.indexOf('Sair da party');
    expect(noteIndex).toBeGreaterThan(-1);
    expect(modeIndex).toBeGreaterThan(noteIndex);
    expect(leaveIndex).toBeGreaterThan(modeIndex);
  });

  it('a fallen member is dimmed and shows "caiu"', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'me', mode: 'split', members: [{ characterId: 'b', name: 'Tvk', alive: false, healthPercent: 0, vocationId: null }] },
    }));
    const html = await render();
    expect(html).toContain('party-companion-down');
    expect(html).toContain('caiu');
  });

  it('never invents vocation, mana, spend, DPS/HPS or a kick button when fields are omitted/null', async () => {
    hud.set((state) => ({
      ...state,
      party: {
        leaderId: 'me',
        mode: 'split',
        members: [
          { characterId: 'me', name: 'Você', alive: true, healthPercent: 100, vocationId: null },
          { characterId: 'b', name: 'Tvk', alive: true, healthPercent: 80, vocationId: null },
        ],
      },
    }));
    const html = await render();
    expect(html).not.toContain('party-companion-vocation');
    expect(html).not.toContain('party-companion-voc');
    expect(html).not.toContain('party-companion-level');
    expect(html).not.toContain('kind="mp"');
    expect(html).not.toContain('Gasto:');
    expect(html).not.toContain('DPS');
    expect(html).not.toContain('HPS');
    expect(html).not.toMatch(/title="Remover da party"/);
  });

  it('renders vocation abbreviation with color class, level, and mana bar when provided', async () => {
    hud.set((state) => ({
      ...state,
      catalogue: mockCatalogue,
      party: {
        leaderId: 'me',
        mode: 'split',
        members: [
          {
            characterId: 'other',
            name: 'Aldric',
            alive: true,
            healthPercent: 90,
            vocationId: 'knight',
            level: 42,
            manaPercent: 60,
          },
        ],
      },
    }));
    const html = await render();
    expect(html).toContain('party-companion-voc-knight');
    expect(html).toContain('LV 42');
    expect(html).toContain('>K<');
    expect((html.match(/data-kind="mp"/g) ?? []).length).toBe(1);
    expect(html).toContain('60 %');
  });

  it('renders level without vocation abbreviation when vocationId is null', async () => {
    hud.set((state) => ({
      ...state,
      catalogue: mockCatalogue,
      party: {
        leaderId: 'me',
        mode: 'split',
        members: [
          {
            characterId: 'novice',
            name: 'Novato',
            alive: true,
            healthPercent: 100,
            vocationId: null,
            level: 15,
          },
        ],
      },
    }));
    const html = await render();
    expect(html).toContain('LV 15');
    expect(html).not.toContain('party-companion-voc');
  });

  it('renders without error and omits vocation, level, and mana when the three keys are undefined', async () => {
    hud.set((state) => ({
      ...state,
      catalogue: mockCatalogue,
      party: {
        leaderId: 'me',
        mode: 'split',
        members: [
          {
            characterId: 'legacy',
            name: 'OldTimer',
            alive: true,
            healthPercent: 75,
            vocationId: undefined as unknown as null,
            level: undefined,
            manaPercent: undefined,
          },
        ],
      },
    }));
    const html = await render();
    expect(html).toContain('OldTimer');
    expect(html).toContain('75 %');
    expect(html).not.toContain('party-companion-voc');
    expect(html).not.toContain('party-companion-level');
    expect(html).not.toContain('data-kind="mp"');
  });

  it('renders raw vocationId as fallback when vocation is not found in catalogue, without colored class', async () => {
    hud.set((state) => ({
      ...state,
      catalogue: mockCatalogue,
      party: {
        leaderId: 'me',
        mode: 'split',
        members: [
          {
            characterId: 'custom',
            name: 'CustomChar',
            alive: true,
            healthPercent: 80,
            vocationId: 'unknown-id',
            level: 50,
          },
        ],
      },
    }));
    const html = await render();
    expect(html).toContain('unknown-id');
    expect(html).not.toMatch(/party-companion-voc-/);
  });

  it('renders mana bar as 0% and "—" meta when member has fallen', async () => {
    hud.set((state) => ({
      ...state,
      catalogue: mockCatalogue,
      party: {
        leaderId: 'me',
        mode: 'split',
        members: [
          {
            characterId: 'fallen',
            name: 'Ghost',
            alive: false,
            healthPercent: 0,
            manaPercent: 50,
            vocationId: 'sorcerer',
            level: 30,
          },
        ],
      },
    }));
    const html = await render();
    expect(html).toContain('caiu');
    expect(html).toContain('—');
  });
});
