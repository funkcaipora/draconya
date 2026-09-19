import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { FriendsModal } from './FriendsModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_FRIENDS, friends } from '../friends/store.js';
import { INITIAL_PARTY, party } from '../party/store.js';
import type { FriendView } from '../friends/api.js';
import type { PartyView } from '../party/api.js';

// Amigos (#404, D8 do ADR 0033): o subconjunto do kit social que o servidor já tem (#403) —
// listar com online/onde (RF-04), adicionar por nome (RF-04) e convidar para a party atual,
// desabilitado com o motivo quando não há party (RF-05).

const catalogue: Catalogue = {
  hunts: [], monsters: [], ammunition: [],
  bot: {
    vocabularyVersion: 1, advancedFromLevel: 50, slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [], supplies: [],
  },
  items: [],
  vocations: [
    { id: 'paladin', name: 'Paladino', healthPerLevel: 10, manaPerLevel: 15, capacityPerLevel: 20, startingWeaponItemId: 'bow' },
  ],
  vocationLevel: 8,
};

const friend = (over: Partial<FriendView> = {}): FriendView => ({
  characterId: 'f1', name: 'Seraphine', vocationId: 'paladin', level: 121, online: true, where: 'city', ...over,
});

const formation = (): PartyView => ({
  id: 'p', leaderId: 'me', mode: 'split', huntId: 'arena', difficulty: 'bold',
  members: [{ characterId: 'me', name: 'Eu', approved: false }],
  published: false, minLevel: null, maxLevel: null, state: 'forming', sessionId: null,
});

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(FriendsModal, { onClose: () => {} }));
  return new Response(prelude).text();
}

function buttonFor(html: string, text: string): string {
  const marker = html.indexOf(text);
  const start = html.lastIndexOf('<button', marker);
  const end = html.indexOf('</button>', marker);
  return html.slice(start, end + '</button>'.length);
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me', catalogue }));
  friends.set(() => ({ ...INITIAL_FRIENDS, characterId: 'me' }));
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
});

describe('FriendsModal (#404)', () => {
  it('lists friends with the online dot, "vocação · LV" and where they are (RF-04)', async () => {
    friends.set((state) => ({ ...state, friends: [
      friend(),
      friend({ characterId: 'f2', name: 'Tvk', vocationId: null, level: 168, online: true, where: 'hunt' }),
      friend({ characterId: 'f3', name: 'Cid', online: false, where: null }),
    ] }));
    const html = await render();

    expect(html).toContain('Amigos');
    expect(html).toContain('2 online');
    expect(html).toContain('friends-dot-online');
    expect(html).toContain('Seraphine');
    expect(html).toContain('Paladino · LV 121');
    expect(html).toContain('Tvk');
    expect(html).toContain('LV 168');
    expect(html).toContain('Cidade');
    expect(html).toContain('Em caçada');
    expect(html).toContain('offline');
    // Sem partido com o catálogo, a linha cai para "LV N" — nunca um nome inventado.
    expect(html).not.toContain('undefined');
  });

  it('renders the add-by-name form (RF-04)', async () => {
    friends.set((state) => ({ ...state, friends: [friend()] }));
    const html = await render();
    expect(html).toContain('Adicionar amigo');
    expect(html).toContain('Nome do personagem');
    expect(html).toContain('>Adicionar<');
  });

  it('offers "Convidar para Party" when there is a party (RF-04)', async () => {
    friends.set((state) => ({ ...state, friends: [friend()] }));
    party.set((state) => ({ ...state, party: formation() }));
    const html = await render();
    const invite = buttonFor(html, 'Convidar para Party');
    expect(invite).toContain('Convidar para Party');
    expect(invite).not.toContain('disabled');
  });

  it('disables the invite and explains why without a party (RF-05)', async () => {
    friends.set((state) => ({ ...state, friends: [friend()] }));
    const html = await render();
    const invite = buttonFor(html, 'Convidar para Party');
    expect(invite).toContain('disabled');
    expect(invite).toContain('Crie uma party primeiro.');
  });
});
