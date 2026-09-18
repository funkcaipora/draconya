import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyMembers } from './PartyMembers.js';
import { INITIAL_HUD, hud } from '../state/hud.js';

// Companheiros durante a hunt (#197, #318): título e estrela já são da #311; aqui protegemos a
// estrutura das linhas e o rodapé sem apresentar dados que a sessão não transmite.

async function render(partyLootOpen = true): Promise<string> {
  const { prelude } = await prerender(createElement(PartyMembers, {
    partyLootOpen, onToggleLoot: () => {},
  }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me' }));
});

describe('PartyMembers', () => {
  it('without a party (state.party === null), renders nothing', async () => {
    hud.set((state) => ({ ...state, party: null }));
    expect(await render()).toBe('');
  });

  it('header shows "Party · N" with member count (R3-02, RF-01)', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'lead', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80 },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55 },
        { characterId: 'c', name: 'Cid', alive: false, healthPercent: 0 },
      ],
    } }));
    const html = await render();
    expect(html).toContain('Party · 3');
  });

  it('lists companions with HP, percent, and a fallen companion greyed', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'lead', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80 },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55 },
        { characterId: 'c', name: 'Cid', alive: false, healthPercent: 0 },
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
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100 },
      ],
    } }));
    const html = await render();
    expect(html).toContain('Party · 1');
  });

  it('leader star: renders <span class="party-leader-star">★</span> for leader whether leader is someone else or self (R3-13, RF-03)', async () => {
    // Leader is someone else
    hud.set((state) => ({ ...state, party: {
      leaderId: 'lead', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80 },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55 },
      ],
    } }));
    let html = await render();
    expect(html).toContain('<span class="party-leader-star">★</span><b>Ana</b>');
    expect(html).not.toContain('<span class="party-leader-star">★</span><b class="party-companion-self">você</b>');

    // Leader is self
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80 },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55 },
      ],
    } }));
    html = await render();
    expect(html).toContain('<span class="party-leader-star">★</span><b class="party-companion-self">você</b>');
    expect(html).not.toContain('<span class="party-leader-star">★</span><b>Ana</b>');
  });

  it('header has the "Party loot" toggle reflecting its state (R3-03, #316)', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'shared', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100 },
      ],
    } }));

    const open = await render(true);
    expect(open).toContain('title="Party loot"');
    expect(open).toMatch(/title="Party loot"[^>]*ui-icon-button-active/);

    const closed = await render(false);
    expect(closed).toContain('title="Party loot"');
    expect(closed).not.toMatch(/title="Party loot"[^>]*ui-icon-button-active/);
  });

  it('puts the note, mode, and leave button in the footer in that order', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'shared', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100 },
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

  it('does not invent unavailable party fields', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'split', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100 },
        { characterId: 'other', name: 'Outra', alive: true, healthPercent: 80 },
      ],
    } }));
    const html = await render();
    expect(html).not.toContain('party-companion-vocation');
    expect(html).not.toContain('Gasto:');
    expect(html).not.toContain('DPS');
    expect(html).not.toContain('HPS');
    expect(html).not.toContain('Remover da party');
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
