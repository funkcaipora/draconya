import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyInviteDialog } from './PartyInviteDialog.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import { INITIAL_PARTY, party } from '../party/store.js';

// O diálogo de convite de party (#404, D7 do ADR 0035): montado incondicionalmente pelo `Shell`,
// ele aparece em QUALQUER tela — Cidade ou hunt — porque quem convida pode já estar caçando.
// Quem decide se há o que desenhar é `party.invites` (RF-06).

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(PartyInviteDialog));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me' }));
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
});

describe('PartyInviteDialog (#404)', () => {
  it('renders nothing without an invite (RF-06)', async () => {
    expect(await render()).not.toContain('Convite para Party');
  });

  it('shows the invite with Accept/Decline in the City (hud.party null) (RF-06)', async () => {
    party.set((state) => ({ ...state, invites: [
      { partyId: 'p9', leaderId: 'lead', leaderName: 'Alice', huntId: 'arena', state: 'forming' },
    ] }));
    const html = await render();
    expect(html).toContain('Convite para Party — Alice convidou você');
    expect(html).toContain('>Aceitar<');
    expect(html).toContain('>Recusar<');
  });

  it('shows the invite during a hunt (hud.party filled) (RF-06)', async () => {
    hud.set((state) => ({
      ...state,
      party: { leaderId: 'lead', mode: 'shared', members: [
        { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100, vocationId: null },
      ] },
    }));
    party.set((state) => ({ ...state, invites: [
      { partyId: 'p9', leaderId: 'lead', leaderName: 'Alice', huntId: 'arena', state: 'hunting' },
    ] }));
    const html = await render();
    expect(html).toContain('Convite para Party — Alice convidou você');
  });

  it('shows only the first invite when more than one is pending', async () => {
    party.set((state) => ({ ...state, invites: [
      { partyId: 'p1', leaderId: 'a', leaderName: 'Alice', huntId: 'arena', state: 'forming' },
      { partyId: 'p2', leaderId: 'b', leaderName: 'Bob', huntId: 'arena', state: 'forming' },
    ] }));
    const html = await render();
    expect(html).toContain('Alice convidou você');
    expect(html).not.toContain('Bob convidou você');
  });
});
