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

// Amigos (#404, D8 do ADR 0035): o subconjunto do kit social que o servidor já tem (#403) —
// listar com online/onde (RF-04), adicionar por nome (RF-04) e convidar para a party atual.
//
// #502: "Convidar para Party" NÃO exige party — sem party e fora de hunt é convite SOCIAL
// (RF-01); com party e fora de hunt é o tradicional de sempre (RF-03); em hunt o botão
// desabilita com o motivo (RF-02), com party ou sem. O feedback do envio (notice de sucesso,
// recusa tipada) vem da store `party` e é renderizado aqui (RF-04).

const catalogue: Catalogue = {
  hunts: [], monsters: [], ammunition: [],
  bot: {
    vocabularyVersion: 1,
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
  minLevel: null, vocationTargets: {}, shareCosts: false, splitLoot: false,
  openSlots: {}, members: [{ characterId: 'me', name: 'Eu' }],
  published: false, state: 'forming', sessionId: null,
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

  // Era "offers ... while the active party is in a hunt" (#404): a partir da #502 a hunt bloqueia
  // TODO convite (RF-02) — o convidador não pode ser ponto de partida de party nenhuma.
  it('does not allow inviting during a hunt, even with a party (RF-02)', async () => {
    friends.set((state) => ({ ...state, friends: [friend()] }));
    party.set((state) => ({ ...state, party: formation() }));
    hud.set((state) => ({ ...state, analyzer: { ...state.analyzer, sessionType: 'hunt' } }));
    const html = await render();
    const invite = buttonFor(html, 'Convidar para Party');
    expect(invite).toContain('disabled');
    expect(invite).toContain('Em caçada você não pode convidar — saia da caçada para convidar.');
  });

  it('allows inviting WITHOUT a party outside a hunt — the social invite (RF-01)', async () => {
    friends.set((state) => ({ ...state, friends: [friend()] }));
    const html = await render();
    const invite = buttonFor(html, 'Convidar para Party');
    expect(invite).not.toContain('disabled');
    expect(html).not.toContain('Crie uma party primeiro.');
  });

  it('renders the party notice and the party refusal, in words (RF-04)', async () => {
    friends.set((state) => ({ ...state, friends: [friend()] }));
    party.set((state) => ({
      ...state,
      notice: 'Convite enviado.',
      error: 'Quem convida precisa estar fora da caçada.',
    }));
    const html = await render();
    expect(html).toContain('Convite enviado.');
    expect(html).toContain('Quem convida precisa estar fora da caçada.');
  });
});
