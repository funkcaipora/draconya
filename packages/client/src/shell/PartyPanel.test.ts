import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { PartyPanel } from './PartyPanel.js';
import { PartyMembers } from './PartyMembers.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { HuntListing } from '../state/hud.js';
import { INITIAL_PARTY, party } from '../party/store.js';
import type { PartyView } from '../party/api.js';

// A formação da party (#197, #311): quatro estados, um por vez. Título "Party" sem party e
// "Party · N" com party; estrela dourada de líder em span próprio; status de aprovação. Nome e
// expulsão (SV-22, #358) e o rótulo "Ousado · 4" do seletor de dificuldade (SV-19, #355) são
// desta issue.

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
    members: [{ characterId: 'me', name: 'Eu', approved: false }],
    published: false, minLevel: null, maxLevel: null, state: 'forming', sessionId: null, ...over,
  } }));
};

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me' }));
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
});

describe('PartyPanel', () => {
  it('without a party: shows "Party" header, create, or join by id (R3-02, RF-02)', async () => {
    const html = await render();
    expect(html).toContain('Party');
    expect(html).not.toMatch(/Party · \d+/);
    expect(html).toContain('Criar party');
    expect(html).toContain('Procurar party');
    expect(html).toContain('aria-label="id da party"');
    expect(html).not.toContain('Iniciar');
    party.set((state) => ({ ...state, seeking: true }));
    expect(await render()).toContain('Cancelar busca');
  });

  it('with a formed party: header shows "Party · N" with member count (R3-02, RF-02)', async () => {
    withParty({ members: [{ characterId: 'me', name: 'Eu', approved: false }, { characterId: 'b', name: 'Bob', approved: false }] });
    const html = await render();
    expect(html).toContain('Party · 2');
  });

  it('as a member: shows the leader by NAME (not raw id), approve when there is a proposal, star for leader, never propose or start', async () => {
    withParty({ leaderId: 'lead', huntId: 'arena', difficulty: 'bold', members: [{ characterId: 'lead', name: 'Alice', approved: true }, { characterId: 'me', name: 'Eu', approved: false }] });
    const html = await render();
    expect(html).toContain('<span class="party-leader-star">★</span>Alice');
    expect(html).toContain('>Aprovar<');
    expect(html).not.toContain('>Propor<');
    expect(html).not.toContain('>Iniciar<');
    expect(html).toContain('Proposta: Arena · Ousado');
  });

  it('shows approval status: "Aguardando aprovação" when pending, "Todos aprovaram" when ready (R3-12, RF-05)', async () => {
    withParty({ huntId: 'arena', difficulty: 'bold', members: [{ characterId: 'me', name: 'Eu', approved: true }, { characterId: 'b', name: 'Bob', approved: false }] });
    let html = await render();
    expect(html).toContain('Aguardando aprovação');
    expect(html).not.toContain('Todos aprovaram');

    withParty({ huntId: 'arena', difficulty: 'bold', members: [{ characterId: 'me', name: 'Eu', approved: true }, { characterId: 'b', name: 'Bob', approved: true }] });
    html = await render();
    expect(html).toContain('Todos aprovaram');
    expect(html).not.toContain('Aguardando aprovação');
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

  it('difficulty select labels each option with the monster count, "Ousado · 4" style (SV-19, #355)', async () => {
    withParty({ leaderId: 'me', huntId: 'arena', difficulty: 'bold', members: [{ characterId: 'me', name: 'Eu', approved: true }, { characterId: 'b', name: 'Bob', approved: false }] });
    const html = await render();
    // O select inicia em `hunts[0].difficulties[0]` ("cautious"), daí o `selected` nele —
    // é o rascunho de uma NOVA proposta, independente da já enviada (`current.difficulty`).
    expect(html).toContain('<option value="cautious" selected="">Cauteloso · 2</option>');
    expect(html).toContain('<option value="bold">Ousado · 4</option>');
  });

  it('difficulty select falls back to the plain label when a hunt has no difficultyDetails for it (old game node)', async () => {
    const bare: HuntListing[] = [{
      id: 'arena', name: 'Arena', recommendedLevel: 1, difficulties: ['cautious', 'bold'],
      difficultyDetails: [], outfitIds: [], lootDrops: 1, monsters: [], loot: [],
    }];
    party.set(() => ({ ...INITIAL_PARTY, characterId: 'me', party: {
      id: 'party-1', leaderId: 'me', mode: 'split', huntId: null, difficulty: null,
      members: [{ characterId: 'me', name: 'Eu', approved: false }, { characterId: 'b', name: 'Bob', approved: false }],
      published: false, minLevel: null, maxLevel: null, state: 'forming', sessionId: null,
    } }));
    const { prelude } = await prerender(createElement(PartyPanel, { hunts: bare }));
    const html = await new Response(prelude).text();
    expect(html).toContain('<option value="cautious" selected="">Cauteloso</option>');
    expect(html).not.toContain('Cauteloso · ');
  });

  it('shows member NAMES (not raw ids) and a kick "×" only for the leader, only on other members, never on self (SV-22, #358)', async () => {
    withParty({
      leaderId: 'me',
      members: [
        { characterId: 'me', name: 'Eu', approved: true },
        { characterId: 'b', name: 'Bob', approved: false },
      ],
    });
    const leaderHtml = await render();
    expect(leaderHtml).toContain('você');
    expect(leaderHtml).toContain('Bob');
    expect(leaderHtml).toContain('class="party-kick"');
    expect(leaderHtml).toContain('title="Remover da party"');
    expect((leaderHtml.match(/class="party-kick"/g) ?? []).length).toBe(1);

    // Membro comum vê nomes, mas nunca o botão de kick — nem no líder, nem em si mesmo.
    withParty({
      leaderId: 'lead',
      members: [
        { characterId: 'lead', name: 'Alice', approved: true },
        { characterId: 'me', name: 'Eu', approved: false },
      ],
    });
    const memberHtml = await render();
    expect(memberHtml).toContain('Alice');
    expect(memberHtml).toContain('você');
    expect(memberHtml).not.toContain('class="party-kick"');
  });

  it('the kick button disables while busy and calls partyActions.kick(targetId)', async () => {
    withParty({
      leaderId: 'me',
      members: [
        { characterId: 'me', name: 'Eu', approved: true },
        { characterId: 'b', name: 'Bob', approved: false },
      ],
    });
    party.set((state) => ({ ...state, busy: true }));
    const html = await render();
    expect(html).toMatch(/class="party-kick"[^>]*disabled/);
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
    const { prelude } = await prerender(createElement(PartyMembers, {
      partyLootOpen: true, onToggleLoot: () => {}, onManage: () => {},
    }));
    const html = await new Response(prelude).text();
    expect(html).toContain('Party · 3');
    expect(html).toContain('Compartilhado');
    expect(html).toContain('<span class="party-leader-star">★</span><b>Ana</b>');
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
    const { prelude } = await prerender(createElement(PartyMembers, {
      partyLootOpen: true, onToggleLoot: () => {}, onManage: () => {},
    }));
    const html = await new Response(prelude).text();
    expect(html).toContain('Dividido');
    expect(html).toContain('Party · 1');
  });
});
