import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyPanel } from './PartyPanel.js';
import { PartyMembers } from './PartyMembers.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { HuntListing } from '../state/hud.js';
import { INITIAL_PARTY, party } from '../party/store.js';
import type { PartyView } from '../party/api.js';

// A formação da party (#197): quatro estados, um por vez. `prerender` roda sem DOM — o que se
// prende é a estrutura e, sobretudo, que "Iniciar" só acende com todos aprovados.

const hunts: HuntListing[] = [{
  id: 'arena', name: 'Arena', recommendedLevel: 1, difficulties: ['cautious', 'bold'],
  difficultyDetails: [
    { id: 'cautious', monsterCount: 2 },
    { id: 'bold', monsterCount: 4 },
  ],
  outfitIds: [], lootDrops: 1, monsters: [], loot: [],
}];

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(PartyPanel, { hunts }));
  return new Response(prelude).text();
}
const withParty = (over: Partial<PartyView>) => {
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me', party: {
    id: 'party-1', leaderId: 'me', mode: 'split', huntId: null, difficulty: null,
    members: [{ characterId: 'me', name: 'Eu', approved: false }], ...over,
  } }));
};

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me' }));
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
});

describe('PartyPanel', () => {
  it('without a party: create, or join by id', async () => {
    const html = await render();
    expect(html).toContain('Criar party');
    expect(html).toContain('Procurar party');
    expect(html).toContain('aria-label="id da party"');
    expect(html).not.toContain('Iniciar');
    party.set((state) => ({ ...state, seeking: true }));
    expect(await render()).toContain('Cancelar busca');
  });

  it('as a member: approve when there is a proposal, never propose or start', async () => {
    withParty({ leaderId: 'lead', huntId: 'arena', difficulty: 'bold', members: [{ characterId: 'lead', name: 'lead', approved: true }, { characterId: 'me', name: 'Eu', approved: false }] });
    const html = await render();
    expect(html).toContain('★ lead');
    expect(html).toContain('>Aprovar<');
    expect(html).not.toContain('>Propor<');
    expect(html).not.toContain('>Iniciar<');
    expect(html).toContain('Proposta: Arena · Ousado');
  });

  it('as the leader: propose and invite, and Iniciar is disabled until everyone approved', async () => {
    // Mutação que mata: `everyoneApproved` ignorando um membro — o botão acenderia cedo.
    withParty({ huntId: 'arena', difficulty: 'bold', members: [{ characterId: 'me', name: 'Eu', approved: true }, { characterId: 'b', name: 'Bob', approved: false }] });
    const waiting = await render();
    expect(waiting).toContain('>Propor<');
    expect(waiting).toContain('aria-label="convidar"');
    expect(waiting).toMatch(/<button[^>]*disabled[^>]*>Iniciar<\/button>/);

    withParty({ huntId: 'arena', difficulty: 'bold', members: [{ characterId: 'me', name: 'Eu', approved: true }, { characterId: 'b', name: 'Bob', approved: true }] });
    const ready = await render();
    expect(ready).toMatch(/<button type="button">Iniciar<\/button>/);
    // Sozinho nunca inicia: party é de dois ou mais.
    withParty({ huntId: 'arena', difficulty: 'bold', members: [{ characterId: 'me', name: 'Eu', approved: true }] });
    expect(await render()).toMatch(/<button[^>]*disabled[^>]*>Iniciar<\/button>/);
  });

  it('renders monster count in the difficulty select options (SV-19, #355)', async () => {
    withParty({ leaderId: 'me', huntId: 'arena', difficulty: 'bold', members: [{ characterId: 'me', name: 'Eu', approved: true }, { characterId: 'b', name: 'Bob', approved: false }] });
    const html = await render();
    expect(html).toMatch(/<option value="cautious"[^>]*>Cauteloso · 2<\/option>/);
    expect(html).toContain('<option value="bold">Ousado · 4</option>');
  });

  it('renders member names and kick button only for leader on other members (#358)', async () => {
    // Como líder: vê nomes dos outros membros e o botão de kick '×' nos outros, mas não em si
    withParty({
      leaderId: 'me',
      members: [
        { characterId: 'me', name: 'Eu', approved: true },
        { characterId: 'b', name: 'Bob', approved: false },
      ],
    });
    const leaderHtml = await render();
    expect(leaderHtml).toContain('★ você');
    expect(leaderHtml).toContain('Bob');
    expect(leaderHtml).toContain('class="party-kick"');
    expect(leaderHtml).toContain('title="Remover da party"');
    const kickCountLeader = (leaderHtml.match(/class="party-kick"/g) ?? []).length;
    expect(kickCountLeader).toBe(1);

    // Como membro comum: vê nomes, mas NÃO vê botão de kick
    withParty({
      leaderId: 'lead',
      members: [
        { characterId: 'lead', name: 'Alice', approved: true },
        { characterId: 'me', name: 'Eu', approved: false },
      ],
    });
    const memberHtml = await render();
    expect(memberHtml).toContain('★ Alice');
    expect(memberHtml).toContain('você');
    expect(memberHtml).not.toContain('class="party-kick"');
  });

  it('while entering, the form is gone and the error, when any, is shown', async () => {
    party.set(() => ({ ...INITIAL_PARTY, characterId: 'me', entering: true, error: 'Alguém da party não está na cidade.' }));
    const html = await render();
    expect(html).toContain('Entrando na hunt…');
    expect(html).not.toContain('Criar party');
    expect(html).toContain('Alguém da party não está na cidade.');
  });

  it('PartyMembers lists the companions with HP, the mode as text, and the fallen one greyed', async () => {
    hud.set((state) => ({ ...state, party: { leaderId: 'lead', mode: 'shared', members: [
      { characterId: 'lead', name: 'Ana', alive: true, healthPercent: 80, vocationId: null },
      { characterId: 'me', name: 'Eu', alive: true, healthPercent: 55, vocationId: null },
      { characterId: 'c', name: 'Cid', alive: false, healthPercent: 0, vocationId: null },
    ] } }));
    const { prelude } = await prerender(createElement(PartyMembers));
    const html = await new Response(prelude).text();
    expect(html).toContain('Compartilhado');
    expect(html).toContain('★ Ana');
    expect(html).toContain('party-companion-self');
    expect(html).toContain('você');
    expect(html).toContain('80 %');
    expect(html).toContain('party-companion-down');
    expect(html).toContain('caiu');
  });

  it('PartyMembers shows "Dividido" for the split mode', async () => {
    hud.set((state) => ({ ...state, party: { leaderId: 'me', mode: 'split', members: [
      { characterId: 'me', name: 'Eu', alive: true, healthPercent: 100, vocationId: null },
    ] } }));
    const { prelude } = await prerender(createElement(PartyMembers));
    const html = await new Response(prelude).text();
    expect(html).toContain('Dividido');
  });
});
