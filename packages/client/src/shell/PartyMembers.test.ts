import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyMembers, vocationAbbreviation } from './PartyMembers.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

// Companheiros durante a hunt (#197, #318): título e estrela já são da #311; vocação, level e
// mana chegaram com o SV-11 (#347) — aqui protegemos a estrutura das linhas, o rodapé e os
// campos condicionais sem apresentar dado que a sessão não transmitiu (D8).

const mockCatalogue = {
  hunts: [], monsters: [],
  bot: {
    vocabularyVersion: 1, slots: {},
    spells: [], supplies: [],
  },
  items: [],
  vocations: [
    { id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25, startingWeaponItemId: 'steel-axe' },
    { id: 'sorcerer', name: 'Sorcerer', healthPerLevel: 5, manaPerLevel: 30, capacityPerLevel: 10, startingWeaponItemId: 'wand-of-vortex' },
  ],
  vocationLevel: 8,
} as unknown as Catalogue;

async function render(partyLootOpen = true): Promise<string> {
  const { prelude } = await prerender(createElement(PartyMembers, {
    partyLootOpen, onToggleLoot: () => {}, onManage: () => {},
  }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me' }));
});

describe('vocationAbbreviation', () => {
  it('derives the uppercase first letter of the vocation NAME, not the id (DT-01)', () => {
    expect(vocationAbbreviation('Knight')).toBe('K');
    expect(vocationAbbreviation('sorcerer')).toBe('S');
  });
});

describe('PartyMembers', () => {
  it('without a party (state.party === null), renders nothing', async () => {
    hud.set((state) => ({ ...state, party: null }));
    expect(await render()).toBe('');
  });

  it('header shows "Party · N" with member count (R3-02, RF-01)', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'lead', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80, vocationId: null },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55, vocationId: null },
        { characterId: 'c', name: 'Cid', alive: false, healthPercent: 0, vocationId: null },
      ],
    } }));
    const html = await render();
    expect(html).toContain('Party · 3');
  });

  it('lists companions with HP, percent, and a fallen companion greyed', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'lead', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80, vocationId: null },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55, vocationId: null },
        { characterId: 'c', name: 'Cid', alive: false, healthPercent: 0, vocationId: null },
      ],
    } }));
    const html = await render();
    expect(html).toContain('80 %');
    expect(html).toContain('party-companion-self');
    expect(html).toContain('você');
    expect(html).toContain('party-companion-down');
    expect(html).toContain('caiu');
  });

  it('shows "Dividido" for split mode', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'split', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100, vocationId: null },
      ],
    } }));
    const html = await render();
    expect(html).toContain('Party · 1');
  });

  it('leader star: renders <span class="party-leader-star">★</span> for leader whether leader is someone else or self (R3-13, RF-03)', async () => {
    // Leader is someone else
    hud.set((state) => ({ ...state, party: {
      leaderId: 'lead', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80, vocationId: null },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55, vocationId: null },
      ],
    } }));
    let html = await render();
    expect(html).toContain('<span class="party-leader-star">★</span><b>Ana</b>');
    expect(html).not.toContain('<span class="party-leader-star">★</span><b class="party-companion-self">você</b>');

    // Leader is self
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80, vocationId: null },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55, vocationId: null },
      ],
    } }));
    html = await render();
    expect(html).toContain('<span class="party-leader-star">★</span><b class="party-companion-self">você</b>');
    expect(html).not.toContain('<span class="party-leader-star">★</span><b>Ana</b>');
  });

  it('header has the "Party loot" toggle reflecting its state (R3-03, #316)', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'shared', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100, vocationId: null },
      ],
    } }));

    const open = await render(true);
    expect(open).toContain('title="Party loot"');
    expect(open).toMatch(/title="Party loot"[^>]*ui-icon-button-active/);

    const closed = await render(false);
    expect(closed).toContain('title="Party loot"');
    expect(closed).not.toMatch(/title="Party loot"[^>]*ui-icon-button-active/);
  });

  it('header has the "Gerenciar party" gear (R3-12, #320)', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'shared', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100, vocationId: null },
      ],
    } }));
    const html = await render();
    expect(html).toContain('title="Gerenciar party"');
  });

  it('puts the note, mode, and leave button in the footer in that order', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'shared', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100, vocationId: null },
      ],
    } }));
    const html = await render();
    const noteIndex = html.indexOf('Parar no meio da caçada exige o sim de todos.');
    const modeIndex = html.indexOf('Compartilhado');
    const leaveIndex = html.indexOf('Sair da party');
    expect(noteIndex).toBeGreaterThan(-1);
    expect(modeIndex).toBeGreaterThan(noteIndex);
    expect(leaveIndex).toBeGreaterThan(modeIndex);
    expect(html).toContain('ui-button-danger');
    expect(html).toContain('party-footer-leave');
  });

  it('does not invent gasto, DPS/HPS, or a kick button — those belong to other issues/panels', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'split', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100, vocationId: null },
        { characterId: 'other', name: 'Outra', alive: true, healthPercent: 80, vocationId: null },
      ],
    } }));
    const html = await render();
    expect(html).not.toContain('Gasto:');
    expect(html).not.toContain('DPS');
    expect(html).not.toContain('HPS');
    expect(html).not.toContain('Remover da party');
  });

  it('omits the vocation and level badges, and the mana bar, when the fields are null/undefined (D8, SV-11 #347)', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'split', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100, vocationId: null },
      ],
    } }));
    const html = await render();
    expect(html).not.toContain('party-companion-voc');
    expect(html).not.toContain('party-companion-level');
    expect(html).not.toContain('data-kind="mp"');
  });

  it('renders the vocation abbreviation with a color class and title, plus level and a mana bar, in header order (SV-11, #347)', async () => {
    hud.set((state) => ({
      ...state,
      catalogue: mockCatalogue,
      party: {
        leaderId: 'lead', mode: 'split', members: [
          { characterId: 'other', name: 'Aldric', alive: true, healthPercent: 90, vocationId: 'knight', level: 42, manaPercent: 60 },
        ],
      },
    }));
    const html = await render();
    expect(html).toContain('party-companion-voc-knight');
    expect(html).toContain('title="Knight"');
    expect(html).toContain('>K<');
    expect(html).toContain('LV 42');
    expect((html.match(/data-kind="mp"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="Mana de Aldric"');
    expect(html).toContain('60 %');

    // A ordem dentro do cabeçalho é nome, vocação, level.
    const nameIndex = html.indexOf('>Aldric<');
    const vocIndex = html.indexOf('party-companion-voc-knight');
    const levelIndex = html.indexOf('party-companion-level');
    expect(nameIndex).toBeGreaterThan(-1);
    expect(vocIndex).toBeGreaterThan(nameIndex);
    expect(levelIndex).toBeGreaterThan(vocIndex);
  });

  it('renders the level badge without a vocation badge when vocationId is null', async () => {
    hud.set((state) => ({
      ...state,
      catalogue: mockCatalogue,
      party: {
        leaderId: 'me', mode: 'split', members: [
          { characterId: 'me', name: 'Novato', alive: true, healthPercent: 100, vocationId: null, level: 15 },
        ],
      },
    }));
    const html = await render();
    expect(html).toContain('LV 15');
    expect(html).not.toContain('party-companion-voc');
  });

  it('falls back to the raw vocationId, without a color class, when the catalogue does not recognize it', async () => {
    hud.set((state) => ({
      ...state,
      catalogue: mockCatalogue,
      party: {
        leaderId: 'me', mode: 'split', members: [
          { characterId: 'me', name: 'CustomChar', alive: true, healthPercent: 80, vocationId: 'unknown-id', level: 50 },
        ],
      },
    }));
    const html = await render();
    expect(html).toContain('unknown-id');
    expect(html).not.toMatch(/party-companion-voc-\w/);
  });

  it('mana bar reads 0% and the meta shows "—" (never a fabricated zero) for a fallen member', async () => {
    hud.set((state) => ({
      ...state,
      catalogue: mockCatalogue,
      party: {
        leaderId: 'me', mode: 'split', members: [
          { characterId: 'me', name: 'Ghost', alive: false, healthPercent: 0, manaPercent: 50, vocationId: 'sorcerer', level: 30 },
        ],
      },
    }));
    const html = await render();
    expect(html).toContain('caiu');
    expect((html.match(/data-kind="mp"/g) ?? []).length).toBe(1);
    expect(html).toContain('—');
  });

  it('keeps the kit row spacing and fallen opacity in the stylesheet', async () => {
    const css = await readFile(new URL('./shell.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.party-companion\s*\{[\s\S]*padding: 6px 0 5px;[\s\S]*border-bottom: 1px solid rgba\(255, 255, 255, \.04\);/);
    expect(css).toMatch(/\.party-companion-down\s*\{\s*opacity: 0\.55;\s*\}/);
  });

  it('wires leaveHunt(sendIntent) to the "Sair da party" button onClick', async () => {
    const source = await readFile(new URL('./PartyMembers.tsx', import.meta.url), 'utf8');
    expect(source).toContain('leaveHunt(sendIntent)');
    expect(source).toMatch(/onClick=\{[^}]*leaveHunt\(sendIntent\)[^}]*\}/);
  });
});
