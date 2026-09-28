import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HuntsModal, attemptEnter, enterHuntMessage, filterHunts, findPartyDecision, resolveSelection,
} from './HuntsModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue, HuntListing } from '../state/hud.js';
import { INITIAL_PARTY, party } from '../party/store.js';
import type { PartyView } from '../party/api.js';

// "Escolha uma caçada" (#259, UMA coluna desde o #584 — ADR 0039, fim do pull por dificuldade).
// `prerender` roda a árvore sem DOM e sem eventos — um clique real não dispara (mesmo limite de
// VocationChoice.test.ts). A decisão em si (que hunt, se a intenção é enviada e se o modal
// fecha) mora em funções puras exportadas e testadas direto; aqui só se prende a ESTRUTURA e o
// que essas funções produzem por padrão. A formação embutida SAIU (#503): o modal não renderiza
// PartyPanel, e as duas pontes de party ("Encontrar Party", "Iniciar com o time") são testadas
// em party-start.test.ts e pela decisão pura `findPartyDecision`.

const hunts: HuntListing[] = [
  {
    id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1,
    difficulties: ['default'], outfitIds: [21], lootDrops: 2,
    difficultyDetails: [], monsters: [{ id: 'rat', name: 'Rato' }], loot: [],
  },
  {
    id: 'dragon-lair', name: 'Covil dos Dragões', recommendedLevel: 60,
    difficulties: ['default'], outfitIds: [], lootDrops: 7,
    difficultyDetails: [], monsters: [], loot: [],
  },
];

const catalogue: Catalogue = {
  hunts, monsters: [],
  bot: { vocabularyVersion: 1, slots: {}, spells: [], supplies: [] },
  items: [], ammunition: [], vocations: [], vocationLevel: 8,
};

const forming = (over: Partial<PartyView> = {}): PartyView => ({
  id: 'p', leaderId: 'me', mode: 'split', huntId: null, difficulty: null,
  minLevel: null, vocationTargets: {}, shareCosts: false, splitLoot: false,
  openSlots: {}, members: [{ characterId: 'me', name: 'Eu' }, { characterId: 'b', name: 'Bob' }],
  published: false, state: 'forming', sessionId: null, ...over,
});

async function render(props: { hunting: boolean; onClose?: () => void }): Promise<string> {
  const { prelude } = await prerender(createElement(HuntsModal, { onClose: () => {}, ...props }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue, level: 10, characterId: 'me' }));
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
});

describe('HuntsModal', () => {
  it('renders the name search and the visible-hunts count', async () => {
    const html = await render({ hunting: false });

    expect(html).toContain('placeholder="⌕ Buscar uma caçada ou criatura"');
    expect(html).toContain('2 caçadas disponíveis');
  });

  it('RF-01: lists every hunt of the catalogue with sprite, name, "level N+" and the monster composition', async () => {
    const html = await render({ hunting: false });
    for (const hunt of hunts) {
      expect(html).toContain(hunt.name);
      expect(html).toContain(`level ${String(hunt.recommendedLevel)}+`);
    }
    // rat-cellars tem monstros no catálogo: a linha mostra o nome deles, não uma contagem
    // de "tamanhos de pull" — esse eixo não existe mais (#584, ADR 0039).
    expect(html).toContain('Rato · 2 drops de loot');
    // dragon-lair não tem monstros no catálogo de teste: cai só para os drops.
    expect(html).toContain('7 drops de loot');
    // O sprite: com `outfitIds`, a inicial cai enquanto não há pacote (mesmo padrão de
    // OutfitSprite.test.ts); sem `outfitIds`, cai igual — as duas linhas mostram `item-sprite`.
    expect((html.match(/class="item-sprite"/g) ?? []).length).toBe(hunts.length);
  });

  it('RF-06: never shows a pull-size/difficulty selector — that surface moved to HuntDetailsModal', async () => {
    const html = await render({ hunting: false });
    expect(html).not.toContain('tamanhos de pull');
    expect(html).not.toContain('hunts-modal-detail');
    expect(html).not.toContain('hunts-modal-pulls');
    expect(html).not.toContain('Cauteloso');
    expect(html).not.toContain('Ousado');
    expect(html).not.toContain('Agressivo');
  });

  it('RF-02: never shows XP/h, gold/h or possible loot (D8)', async () => {
    const html = await render({ hunting: false });
    expect(html).not.toMatch(/XP\/h|gold\/h/);
    expect(html).not.toContain('Loot possível');
  });

  it('RF-01: the formation column is GONE — no PartyPanel, no third column, no "Criar party"', async () => {
    const html = await render({ hunting: false });
    expect(html).not.toContain('Criar party');
    expect(html).not.toContain('Procurar party');
    expect(html).not.toContain('party-panel');
    // Mutação que mata: re-adicionar o import/render de PartyPanel.
    const source = await readFile(new URL('./HuntsModal.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('PartyPanel');
    expect(source).not.toContain('PartyPanel.js');
  });

  it('RF-02: "Encontrar Party" is visible and disabled without a selection (empty catalogue)', async () => {
    hud.set((state) => ({ ...state, catalogue: { ...catalogue, hunts: [] } }));
    const html = await render({ hunting: false });
    expect(html).toContain('Encontrar Party');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Encontrar Party<\/button>/);
  });

  it('RF-02: "Encontrar Party" is enabled with a hunt and wired to onFindParty by the selected ID', async () => {
    const source = await readFile(new URL('./HuntsModal.tsx', import.meta.url), 'utf8');
    // A fiação manda o ID, nunca o nome — `findPartyDecision` decide, o clique repassa.
    expect(source).toContain('onFindParty?.(findParty.huntId)');
    const html = await render({ hunting: false });
    expect(html).toContain('>Encontrar Party</button>');
  });

  it('findPartyDecision (RF-02) decides by ID, never by name', () => {
    expect(findPartyDecision(hunts[0]!)).toEqual({ enabled: true, huntId: 'rat-cellars' });
    expect(findPartyDecision(null)).toEqual({ enabled: false, huntId: null });
    // O id 'rat-cellars' não é o nome 'Rat Cellars' — filtro por nome moraria na busca errada.
    expect(findPartyDecision(hunts[0]!).huntId).not.toBe(hunts[0]!.name);
  });

  it('RF-03: "Iniciar com o time" appears with a forming party, disabled for a non-leader', async () => {
    party.set(() => ({ ...INITIAL_PARTY, characterId: 'me', party: forming({ leaderId: 'lead' }) }));
    const html = await render({ hunting: false });
    expect(html).toContain('Iniciar com o time');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Iniciar com o time<\/button>/);
    expect(html).toContain('Só o líder inicia com o time.');
  });

  it('RF-03: "Iniciar com o time" is enabled for the leader, and never rendered without a forming party', async () => {
    party.set(() => ({ ...INITIAL_PARTY, characterId: 'me', party: forming() }));
    const html = await render({ hunting: false });
    expect(html).toContain('>Iniciar com o time</button>');

    // Sem party, e com a party já caçando: o botão some (o eixo da hunt é do rodapé do painel).
    party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
    expect(await render({ hunting: false })).not.toContain('Iniciar com o time');
    party.set(() => ({ ...INITIAL_PARTY, characterId: 'me', party: forming({ state: 'hunting', sessionId: 's1' }) }));
    expect(await render({ hunting: true })).not.toContain('Iniciar com o time');
  });

  it('RF-03: the wiring goes configure-then-start, never an enter-hunt intent for the team', async () => {
    const source = await readFile(new URL('./HuntsModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('startWithTeam(formation, me');
    expect(source).toContain('partyActions.configure(teamStart.patch)');
    expect(source).toContain('partyActions.start()');
    // O clique do time NÃO manda `enter-hunt` — essa intenção só existe no `enter` solo.
    expect(source).not.toContain("type: 'enter-hunt', huntId: teamStart");
  });

  it('RF-05: hunting=false shows "Entrar na caçada" and the recommendation note', async () => {
    const html = await render({ hunting: false });
    expect(html).toContain('Entrar na caçada');
    expect(html).toContain('Level recomendado é conselho, não trava');
    expect(html).not.toContain('Trocar de caçada');
  });

  it('RF-05: hunting=true shows "Trocar de caçada" and the instance-ends warning', async () => {
    const html = await render({ hunting: true });
    expect(html).toContain('Trocar de caçada');
    expect(html).toContain('sair e entrar de novo · a instância atual é encerrada');
    expect(html).not.toContain('>Entrar na caçada<');
  });

  it('the first hunt is selected by default, and "Entrar" is enabled without any pull choice', async () => {
    const html = await render({ hunting: false });
    expect(html).toContain('hunts-modal-row-selected');
    expect(html).toMatch(/<button[^>]*class="[^"]*ui-button-primary[^"]*"[^>]*>Entrar na caçada<\/button>/);
  });

  it('an empty catalogue.hunts shows the "no hunt" message', async () => {
    hud.set((state) => ({ ...state, catalogue: { ...catalogue, hunts: [] } }));
    const html = await render({ hunting: false });
    expect(html).toContain('Nenhuma caçada disponível neste servidor.');
    expect(html).not.toContain('Buscar uma caçada ou criatura');
  });

  it('catalogue === null shows "Carregando…"', async () => {
    hud.set((state) => ({ ...state, catalogue: null }));
    const html = await render({ hunting: false });
    expect(html).toContain('Carregando…');
    expect(html).not.toContain('Buscar uma caçada ou criatura');
  });
});

describe('filterHunts (RF-08)', () => {
  it('returns every hunt in the same order for empty or whitespace-only search', () => {
    expect(filterHunts(hunts, '')).toEqual(hunts);
    expect(filterHunts(hunts, '   ')).toEqual(hunts);
  });

  it('matches a name substring without differentiating case', () => {
    expect(filterHunts(hunts, 'DRAG')).toEqual([hunts[1]]);
  });

  it('returns an empty list when no name matches', () => {
    expect(filterHunts(hunts, 'hydra')).toEqual([]);
  });

  it('does not replace the selection when the filter hides it', () => {
    expect(filterHunts(hunts, 'rat')).toEqual([hunts[0]]);
    expect(resolveSelection(hunts, 'dragon-lair')).toEqual({ hunt: hunts[1] });
  });
});

describe('resolveSelection (RF-03)', () => {
  it('falls back to hunts[0] with no selection at all', () => {
    expect(resolveSelection(hunts, null)).toEqual({ hunt: hunts[0] });
  });

  it('honors the selected hunt id', () => {
    expect(resolveSelection(hunts, 'dragon-lair')).toEqual({ hunt: hunts[1] });
  });

  it('falls back to hunts[0] when the selected id no longer exists (reconnect swapped the catalogue)', () => {
    expect(resolveSelection(hunts, 'an-old-hunt-gone-after-reconnect')).toEqual({ hunt: hunts[0] });
  });

  it('returns a null hunt for an empty catalogue', () => {
    expect(resolveSelection([], null)).toEqual({ hunt: null });
  });
});

describe('enterHuntMessage (RF-04)', () => {
  it('builds the enter-hunt intent from the selected hunt, without a difficulty field (#584)', () => {
    expect(enterHuntMessage(hunts[0]!)).toEqual({ type: 'enter-hunt', huntId: 'rat-cellars' });
  });

  it('is null without a hunt', () => {
    expect(enterHuntMessage(null)).toBeNull();
  });
});

describe('attemptEnter (RF-04, RF-09)', () => {
  it('returns true and closes the modal when send() returns true', () => {
    const onClose = vi.fn();
    expect(attemptEnter({ type: 'enter-hunt', huntId: 'rat-cellars' }, () => true, onClose)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns false and does NOT close the modal when send() returns false', () => {
    const onClose = vi.fn();
    expect(attemptEnter({ type: 'enter-hunt', huntId: 'rat-cellars' }, () => false, onClose)).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns false, never calls send(), nor closes, with a null message', () => {
    const send = vi.fn(() => true);
    const onClose = vi.fn();
    expect(attemptEnter(null, send, onClose)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
