import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyMembers } from './PartyMembers.js';
import { INITIAL_HUD, hud } from '../state/hud.js';

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(PartyMembers, {}));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me' }));
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

  it('never invents vocation, mana, spend, DPS/HPS or a kick button', async () => {
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
    expect(html).not.toContain('kind="mp"');
    expect(html).not.toContain('Gasto:');
    expect(html).not.toContain('DPS');
    expect(html).not.toContain('HPS');
    expect(html).not.toMatch(/title="Remover da party"/);
  });
});
