import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PartyModal, PartyRooms, ROOMS_POLL_MS, maxMembersOf, slotsLabel, startRoomsPolling, targetsLabel, vocationLabelOf,
} from './PartyModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_PARTY, PARTY_POLL_MS, party, setPartyClient } from '../party/store.js';
import type { PartyClient, PartyView, RoomView, SocialInviteView } from '../party/api.js';

// A superfície própria da party (#503): props iniciais `view`/`huntFilter`, home sem party com
// EXATAMENTE Criar/Buscar (e sem input de id), "Minha Party" com os DOIS toggles independentes
// e o publish espelhando o servidor, e a busca com vagas EXPLÍCITAS e nenhum `joinReason` —
// o servidor só manda salas elegíveis.

async function render(props: { view: 'home' | 'mine' | 'search'; huntFilter?: string; hunting?: boolean }): Promise<string> {
  const { prelude } = await prerender(createElement(PartyModal, {
    view: props.view,
    hunting: props.hunting ?? false,
    onClose: () => {},
    ...(props.huntFilter !== undefined ? { huntFilter: props.huntFilter } : {}),
  }));
  return new Response(prelude).text();
}

const formation = (over: Partial<PartyView> = {}): PartyView => ({
  id: 'p', leaderId: 'me', mode: 'split', huntId: null, difficulty: null,
  minLevel: null, vocationTargets: {}, shareCosts: false, splitLoot: false,
  openSlots: {}, members: [{ characterId: 'me', name: 'Eu' }],
  published: false, state: 'forming', sessionId: null, ...over,
});

const room = (over: Partial<RoomView> = {}): RoomView => ({
  partyId: 'party-9', huntId: 'arena', difficulty: 'bold',
  leader: { characterId: 'lead', name: 'Alice', level: 40 },
  vocations: ['knight'], vocationTargets: { knight: 2 },
  openSlots: { knight: 1 }, members: 1, maxMembers: 4, minLevel: 10, state: 'forming', ...over,
});

const catalogue: Catalogue = {
  hunts: [{
    id: 'arena', name: 'Arena', recommendedLevel: 1,
    difficulties: ['cautious', 'bold'], outfitIds: [], lootDrops: 1,
    difficultyDetails: [{ id: 'cautious', monsterCount: 2 }, { id: 'bold', monsterCount: 4 }],
    monsters: [], loot: [],
  }],
  monsters: [],
  bot: { vocabularyVersion: 1, slots: {}, spells: [], supplies: [] },
  items: [], ammunition: [],
  vocations: [
    { id: 'knight', name: 'Cavaleiro', healthPerLevel: 1, manaPerLevel: 1, capacityPerLevel: 1, startingWeaponItemId: 'sword' },
    { id: 'paladin', name: 'Paladino', healthPerLevel: 1, manaPerLevel: 1, capacityPerLevel: 1, startingWeaponItemId: 'bow' },
  ],
  vocationLevel: 8,
};

function fakeClient(over: Partial<PartyClient> = {}): PartyClient {
  const noop = async (): Promise<never> => { throw new Error('not used'); };
  return {
    create: noop, mine: noop, invite: noop, join: noop, leave: noop, kick: noop, configure: noop,
    start: noop, seek: noop, stopSeeking: noop, publish: noop, unpublish: noop,
    rooms: async () => [], decline: noop, ...over,
  };
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, characterId: 'me', catalogue }));
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
  setPartyClient(null);
});

describe('PartyModal (#503)', () => {
  it('home without a party offers EXACTLY Criar Party and Buscar Party, with no id input (RF-04)', async () => {
    const html = await render({ view: 'home' });
    expect(html).toContain('Criar Party');
    expect(html).toContain('Buscar Party');
    expect(html).not.toContain('aria-label="id da party"');
    expect(html).not.toContain('aria-label="convidar por id"');
  });

  it('home with a formation opens it instead of offering a second create (RF-04)', async () => {
    party.set((state) => ({ ...state, party: formation() }));
    const html = await render({ view: 'home' });
    expect(html).toContain('Abrir minha party');
    expect(html).not.toContain('Criar Party');
  });

  it('the initial view comes from props: search shows the rooms, mine shows the roster', async () => {
    party.set((state) => ({ ...state, party: formation({ members: [{ characterId: 'me', name: 'Eu' }, { characterId: 'b', name: 'Bob' }] }) }));
    expect(await render({ view: 'search' })).toContain('aria-label="salas públicas"');
    expect(await render({ view: 'mine' })).toContain('aria-label="membros da party"');
    expect(await render({ view: 'mine' })).toContain('Party · 2');
  });

  it('mine shows the read-only summary for a member, with both switches disabled (RF-05)', async () => {
    party.set((state) => ({
      ...state,
      party: formation({
        leaderId: 'lead', huntId: 'arena', difficulty: 'bold', minLevel: 12,
        vocationTargets: { knight: 2 }, shareCosts: true,
        openSlots: { knight: 1 },
        members: [{ characterId: 'lead', name: 'Ana' }, { characterId: 'me', name: 'Eu' }],
      }),
    }));
    const html = await render({ view: 'mine' });
    expect(html).toContain('Sala do líder');
    expect(html).toContain('Caçada: Arena');
    expect(html).toContain('Tamanho do pull: Ousado');
    expect(html).toContain('Level mínimo: 12');
    expect(html).toContain('Composição: Cavaleiro 2');
    expect(html).toContain('Vagas abertas: Cavaleiro ×1');
    expect(html).toMatch(/title="Compartilhar custos"[^>]*disabled/);
    expect(html).toMatch(/title="Compartilhar lucros"[^>]*disabled/);
    expect(html).not.toContain('aria-label="caçada"');
  });

  it('mine shows the leader draft: selects, minLevel and steppers per catalogue vocation (RF-05)', async () => {
    party.set((state) => ({
      ...state,
      party: formation({
        huntId: 'arena', difficulty: 'bold', minLevel: 5,
        vocationTargets: { knight: 2, paladin: 1 }, openSlots: { knight: 1, paladin: 1 },
      }),
    }));
    const html = await render({ view: 'mine' });
    expect(html).toContain('aria-label="caçada"');
    expect(html).toContain('aria-label="dificuldade"');
    expect(html).toContain('aria-label="level mínimo da sala"');
    expect(html).toContain('<option value="bold" selected="">Ousado · 4</option>');
    expect(html).toContain('aria-label="menos Cavaleiro"');
    expect(html).toContain('aria-label="mais Paladino"');
    // O total é o do estado real, e a contagem é o TOTAL desejado por vocação (não vagas).
    expect(html).toContain('>2</span>');
    expect(html).toContain('Soma da composição: 3');
  });

  it('the two toggles are independent: each click sends ONLY its own patch (RF-05)', async () => {
    const source = await readFile(new URL('./PartyModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('void partyActions.configure({ shareCosts: on })');
    expect(source).toContain('void partyActions.configure({ splitLoot: on })');
    // Mutação que mata: um clique acendendo os dois eixos (o `mode` legado acoplado).
    expect(source).not.toMatch(/configure\(\{ shareCosts: on, splitLoot/);
  });

  it('publish ("Abrir vagas") is disabled without the server prerequisites, and flips when they are met (RF-06)', async () => {
    party.set((state) => ({ ...state, party: formation() }));
    const unconfigured = await render({ view: 'mine' });
    expect(unconfigured).toMatch(/<button[^>]*disabled[^>]*>Abrir vagas<\/button>/);

    party.set((state) => ({
      ...state,
      party: formation({
        huntId: 'arena', difficulty: 'bold', minLevel: 5, openSlots: { knight: 2 },
      }),
    }));
    const ready = await render({ view: 'mine' });
    expect(ready).toContain('>Abrir vagas</button>');

    party.set((state) => ({ ...state, party: formation({ huntId: 'arena', difficulty: 'bold', minLevel: 5, published: true, openSlots: { knight: 2 } }) }));
    const openRoom = await render({ view: 'mine' });
    expect(openRoom).toContain('>Fechar vagas</button>');
    expect(openRoom).toContain('Sala aberta — aparece em Buscar Party.');
  });

  it('without the catalogue.party.maxMembers field there is no local sum cap and no invented 8 (D8)', async () => {
    expect(maxMembersOf(catalogue)).toBeNull();
    const withField = { ...catalogue, party: { maxMembers: 4 } } as unknown as Catalogue;
    expect(maxMembersOf(withField)).toBe(4);
    party.set((state) => ({ ...state, party: formation({ huntId: 'arena', difficulty: 'bold', minLevel: 5 }) }));
    const html = await render({ view: 'mine' });
    expect(html).toContain('Soma da composição: 0');
    expect(html).not.toMatch(/de 8|de 4/);
  });

  it('with the catalogue.party.maxMembers field the steppers respect the cap', async () => {
    const capped = { ...catalogue, party: { maxMembers: 4 } } as unknown as Catalogue;
    hud.set((state) => ({ ...state, catalogue: capped }));
    party.set((state) => ({
      ...state,
      party: formation({
        huntId: 'arena', difficulty: 'bold', minLevel: 5, vocationTargets: { knight: 4 },
      }),
    }));
    const html = await render({ view: 'mine' });
    expect(html).toContain('Soma da composição: 4 de 4');
    // O + de qualquer vocação fica desabilitado com o teto atingido.
    expect((html.match(/aria-label="mais [^"]*" disabled=""/g) ?? []).length).toBe(2);
  });

  it('search renders each room with explicit openSlots and NEVER a disabled join (RF-07)', async () => {
    const roomsList = await prerender(createElement(PartyRooms, {
      rooms: [
        room(),
        room({
          partyId: 'party-10', openSlots: { paladin: 2 }, vocationTargets: { paladin: 2 },
          leader: { characterId: 'l2', name: 'Bia', level: 55 }, minLevel: 30,
        }),
      ],
      busy: false,
      onJoin: () => {},
    })).then((out) => new Response(out.prelude).text());

    expect(roomsList).toContain('aria-label="salas públicas"');
    expect(roomsList).toContain('Alice · LV 40 · 1/4');
    expect(roomsList).toContain('Bia · LV 55 · 1/4');
    // As vagas por vocação são EXPLÍCITAS, não um members/max.
    expect(roomsList).toContain('aria-label="vagas da sala de Alice"');
    expect(roomsList).toContain('Cavaleiro ×1');
    expect(roomsList).toContain('Paladino ×2');
    expect(roomsList).toContain('Arena · Ousado · level 10+');
    // Nenhum "Entrar" desabilitado: o servidor só mandou salas elegíveis (RF-07).
    expect(roomsList).not.toMatch(/<button[^>]*disabled[^>]*>Entrar<\/button>/);
    expect((roomsList.match(/>Entrar<\/button>/g) ?? []).length).toBe(2);
  });

  it('search shows the empty state and keeps the join-by-id OUT of the main action (RF-04)', async () => {
    const html = await render({ view: 'search' });
    expect(html).toContain('aria-label="salas públicas"');
    expect(html).toContain('Nenhuma sala elegível agora.');
    expect(html).toContain('aria-label="id da party"');
  });

  it('search prefills the hunt filter by ID and allows clearing it (RF-02, §7)', async () => {
    const html = await render({ view: 'search', huntFilter: 'arena' });
    expect(html).toContain('<option value="arena" selected="">Arena</option>');
    expect(html).toContain('<option value="">Todas as caçadas</option>');

    // Filtro de hunt que o catálogo atual não tem (reconexão trocou a lista): a opção crua
    // permanece, e "Todas as caçadas" limpa o filtro.
    const stale = await render({ view: 'search', huntFilter: 'old-hunt' });
    expect(stale).toContain('<option value="old-hunt" selected="">old-hunt</option>');
  });

  it('search never shows joinReason: no "Sala cheia", no "Fora da faixa" (RF-07)', async () => {
    const source = await readFile(new URL('./PartyModal.tsx', import.meta.url), 'utf8');
    // Mutação que mata: re-adicionar a função (o julgamento de lotação/faixa no cliente).
    expect(source).not.toMatch(/function joinReason/);
    expect(source).not.toContain('Sala cheia');
    const html = await render({ view: 'search' });
    expect(html).not.toContain('Sala cheia');
    expect(html).not.toContain('Fora da faixa');
  });

  it('polls rooms with the candidate in the query, and stops on cleanup (RF-08, RF-10)', async () => {
    vi.useFakeTimers();
    try {
      const rooms = vi.fn<PartyClient['rooms']>().mockResolvedValue([]);
      setPartyClient(fakeClient({ rooms }));
      const set = vi.fn();
      const stop = startRoomsPolling({ characterId: 'me', huntId: 'arena' }, set);

      await vi.advanceTimersByTimeAsync(ROOMS_POLL_MS);
      expect(rooms).toHaveBeenCalledTimes(2);
      expect(rooms).toHaveBeenNthCalledWith(1, { characterId: 'me', huntId: 'arena' });
      expect(rooms).toHaveBeenNthCalledWith(2, { characterId: 'me', huntId: 'arena' });

      stop();
      await vi.advanceTimersByTimeAsync(ROOMS_POLL_MS * 3);
      expect(rooms).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('RF-10: only Shell.tsx schedules the /mine cadence — the modal never polls it', async () => {
    const shell = await readFile(new URL('./Shell.tsx', import.meta.url), 'utf8');
    expect(shell).toContain('setInterval(() => { void partyActions.refresh(); }, PARTY_POLL_MS)');
    for (const name of ['PartyModal.tsx', 'HuntsModal.tsx', 'PartyActions.tsx', 'PartyMembers.tsx']) {
      const source = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
      expect(source, name).not.toContain('PARTY_POLL_MS');
      expect(source, name).not.toContain('partyActions.refresh');
    }
    // A store define a constante; ninguém além do Shell agenda com ela.
    expect(PARTY_POLL_MS).toBe(ROOMS_POLL_MS);
  });

  it('entering shows the entering note instead of any view', async () => {
    party.set((state) => ({ ...state, entering: true }));
    const html = await render({ view: 'mine' });
    expect(html).toContain('Entrando na hunt…');
    expect(html).not.toContain('aria-label="membros da party"');
  });
});

describe('party view labels (#503)', () => {
  it('labels vocations from the catalogue, falling back to the raw id and to "Sem vocação"', () => {
    const vocations = [{ id: 'knight', name: 'Cavaleiro' }];
    expect(vocationLabelOf('knight', vocations)).toBe('Cavaleiro');
    expect(vocationLabelOf('unknown', vocations)).toBe('unknown');
    expect(vocationLabelOf('none', vocations)).toBe('Sem vocação');
  });

  it('slotsLabel shows only the OPEN slots, with the multiplier form', () => {
    const vocations = [{ id: 'knight', name: 'Cavaleiro' }, { id: 'paladin', name: 'Paladino' }];
    expect(slotsLabel({ knight: 2, paladin: 0, none: 1 }, vocations)).toBe('Cavaleiro ×2 · Sem vocação ×1');
    expect(slotsLabel({}, vocations)).toBe('');
  });

  it('targetsLabel shows the TOTAL desired per vocation', () => {
    const vocations = [{ id: 'knight', name: 'Cavaleiro' }];
    expect(targetsLabel({ knight: 2, paladin: 1 }, vocations)).toBe('Cavaleiro 2 · paladin 1');
  });

  it('social invites stay typed for the sub-issue C union', () => {
    const social: SocialInviteView = { inviteId: 'i1', leaderId: 'lead', leaderName: 'Ana', createdAtMs: 1 };
    expect(social.inviteId).toBe('i1');
  });
});
