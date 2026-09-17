import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyMembers } from './PartyMembers.js';
import { INITIAL_HUD, hud } from '../state/hud.js';

// Companheiros durante a hunt (#197, #311): título com contagem de membros, estrela do líder
// sempre dourada em span próprio, modo como texto e botão "Sair da party".

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me' }));
});

describe('PartyMembers', () => {
  it('without a party (state.party === null), renders nothing', async () => {
    hud.set((state) => ({ ...state, party: null }));
    const { prelude } = await prerender(createElement(PartyMembers));
    expect(await new Response(prelude).text()).toBe('');
  });

  it('header shows "Party · N" with member count (R3-02, RF-01)', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'lead', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80 },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55 },
        { characterId: 'c', name: 'Cid', alive: false, healthPercent: 0 },
      ],
    } }));
    const { prelude } = await prerender(createElement(PartyMembers));
    const html = await new Response(prelude).text();
    expect(html).toContain('Party · 3');
  });

  it('lists companions with HP, percent, mode as text, and fallen companion greyed', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'lead', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80 },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55 },
        { characterId: 'c', name: 'Cid', alive: false, healthPercent: 0 },
      ],
    } }));
    const { prelude } = await prerender(createElement(PartyMembers));
    const html = await new Response(prelude).text();
    expect(html).toContain('Compartilhado');
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
    const { prelude } = await prerender(createElement(PartyMembers));
    const html = await new Response(prelude).text();
    expect(html).toContain('Dividido');
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
    let { prelude } = await prerender(createElement(PartyMembers));
    let html = await new Response(prelude).text();
    expect(html).toContain('<span class="party-leader-star">★</span>Ana');
    expect(html).not.toContain('<span class="party-leader-star">★</span>você');

    // Leader is self
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'shared', members: [
        { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80 },
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55 },
      ],
    } }));
    ({ prelude } = await prerender(createElement(PartyMembers)));
    html = await new Response(prelude).text();
    expect(html).toContain('<span class="party-leader-star">★</span>você');
    expect(html).not.toContain('<span class="party-leader-star">★</span>Ana');
  });

  it('renders button "Sair da party" with danger variant (R3-11, RF-04)', async () => {
    hud.set((state) => ({ ...state, party: {
      leaderId: 'me', mode: 'shared', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100 },
      ],
    } }));
    const { prelude } = await prerender(createElement(PartyMembers));
    const html = await new Response(prelude).text();
    expect(html).toContain('Sair da party');
    expect(html).toContain('ui-button-danger');
    expect(html).toContain('party-leave');
  });

  it('wires leaveHunt(sendIntent) to the "Sair da party" button onClick', async () => {
    const source = await readFile(new URL('./PartyMembers.tsx', import.meta.url), 'utf8');
    expect(source).toContain('leaveHunt(sendIntent)');
    expect(source).toMatch(/onClick=\{[^}]*leaveHunt\(sendIntent\)[^}]*\}/);
  });
});
