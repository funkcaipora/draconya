import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HuntsModal, attemptEnter, enterHuntMessage, filterHunts, findPartyDecision, pullLabel, resolveSelection,
} from './HuntsModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue, HuntListing } from '../state/hud.js';
import { INITIAL_PARTY, party } from '../party/store.js';
import type { PartyView } from '../party/api.js';

// "Escolha uma caçada" (#259, duas colunas desde a #503). `prerender` roda a árvore sem DOM e
// sem eventos — um clique real não dispara (mesmo limite de VocationChoice.test.ts). A decisão
// em si (que hunt, que pull, se a intenção é enviada e se o modal fecha) mora em funções puras
// exportadas e testadas direto; aqui só se prende a ESTRUTURA e o que essas funções produzem
// por padrão. A formação embutida SAIU (#503): o modal não renderiza PartyPanel, e as duas
// pontes de party ("Encontrar Party", "Iniciar com o time") são testadas em party-start.test.ts
// e pela decisão pura `findPartyDecision`.

const hunts: HuntListing[] = [
  {
    id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1,
    difficulties: ['cautious', 'bold', 'reckless'], outfitIds: [21], lootDrops: 2,
    difficultyDetails: [], monsters: [], loot: [],
  },
  {
    id: 'dragon-lair', name: 'Covil dos Dragões', recommendedLevel: 60,
    difficulties: ['cautious', 'bold'], outfitIds: [], lootDrops: 7,
    difficultyDetails: [{ id: 'cautious', monsterCount: 3 }, { id: 'bold', monsterCount: 6 }],
    monsters: [], loot: [],
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

  it('RF-01: lists every hunt of the catalogue with sprite, name, "level N+" and pulls/drops', async () => {
    const html = await render({ hunting: false });
    for (const hunt of hunts) {
      expect(html).toContain(hunt.name);
      expect(html).toContain(`level ${String(hunt.recommendedLevel)}+`);
      expect(html).toContain(`${String(hunt.difficulties.length)} tamanhos de pull · ${String(hunt.lootDrops)} drops de loot`);
    }
    // O sprite: com `outfitIds`, a inicial cai enquanto não há pacote (mesmo padrão de
    // OutfitSprite.test.ts); sem `outfitIds`, cai igual — as duas linhas mostram `item-sprite`.
    expect((html.match(/class="item-sprite"/g) ?? []).length).toBe(hunts.length);
  });

  it('RF-02: never shows XP/h, gold/h, monsters or possible loot (D8)', async () => {
    const html = await render({ hunting: false });
    expect(html).not.toMatch(/XP\/h|gold\/h/);
    expect(html).not.toContain('Loot possível');
  });

  it('RF-01: the formation column is GONE — no PartyPanel, no third column, no "Criar party"', async () => {
    const html = await render({ hunting: false });
    expect(html).not.toContain('Criar party');
    expect(html).not.toContain('Procurar party');
    // Estrutura: duas colunas (lista + detalhe), sem moldura vazia de formação.
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

  it('the first hunt and its first difficulty are selected by default (ui-button-primary)', async () => {
    const html = await render({ hunting: false });
    const detailIndex = html.indexOf('hunts-modal-detail');
    expect(detailIndex).toBeGreaterThan(-1);
    expect(html.slice(detailIndex)).toMatch(/class="[^"]*ui-button-primary[^"]*">Cauteloso</);
  });

  it('an empty catalogue.hunts shows the "no hunt" message, without pull buttons', async () => {
    hud.set((state) => ({ ...state, catalogue: { ...catalogue, hunts: [] } }));
    const html = await render({ hunting: false });
    expect(html).toContain('Nenhuma caçada disponível neste servidor.');
    expect(html).not.toContain('hunts-modal-pulls');
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
    expect(resolveSelection(hunts, 'dragon-lair', null))
      .toEqual({ hunt: hunts[1], difficulty: 'cautious' });
  });
});

describe('resolveSelection (RF-03)', () => {
  it('falls back to hunts[0] and its first difficulty with no selection at all', () => {
    expect(resolveSelection(hunts, null, null)).toEqual({ hunt: hunts[0], difficulty: 'cautious' });
  });

  it('honors the selected hunt id, and its own first difficulty when no pull chosen', () => {
    expect(resolveSelection(hunts, 'dragon-lair', null)).toEqual({ hunt: hunts[1], difficulty: 'cautious' });
  });

  it('honors a chosen pull that belongs to the selected hunt', () => {
    expect(resolveSelection(hunts, 'rat-cellars', 'reckless')).toEqual({ hunt: hunts[0], difficulty: 'reckless' });
  });

  it('falls back to the hunt\'s first difficulty when the chosen pull no longer belongs to it', () => {
    // Mutação que mata: ignorar `hunt.difficulties.includes(pull)` — "reckless" não existe em
    // dragon-lair, e aceitá-lo mandaria uma dificuldade que a hunt não define.
    expect(resolveSelection(hunts, 'dragon-lair', 'reckless')).toEqual({ hunt: hunts[1], difficulty: 'cautious' });
  });

  it('falls back to hunts[0] when the selected id no longer exists (reconnect swapped the catalogue)', () => {
    expect(resolveSelection(hunts, 'an-old-hunt-gone-after-reconnect', null)).toEqual({ hunt: hunts[0], difficulty: 'cautious' });
  });

  it('returns null hunt and null difficulty for an empty catalogue', () => {
    expect(resolveSelection([], null, null)).toEqual({ hunt: null, difficulty: null });
  });
});

describe('enterHuntMessage (RF-04)', () => {
  it('builds the enter-hunt intent from the selected hunt and difficulty', () => {
    expect(enterHuntMessage(hunts[0]!, 'bold')).toEqual({ type: 'enter-hunt', huntId: 'rat-cellars', difficulty: 'bold' });
  });

  it('is null without a hunt or without a difficulty', () => {
    expect(enterHuntMessage(null, 'bold')).toBeNull();
    expect(enterHuntMessage(hunts[0]!, null)).toBeNull();
  });
});

describe('attemptEnter (RF-04, RF-09)', () => {
  it('returns true and closes the modal when send() returns true', () => {
    const onClose = vi.fn();
    expect(attemptEnter({ type: 'enter-hunt', huntId: 'rat-cellars', difficulty: 'bold' }, () => true, onClose)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns false and does NOT close the modal when send() returns false', () => {
    const onClose = vi.fn();
    expect(attemptEnter({ type: 'enter-hunt', huntId: 'rat-cellars', difficulty: 'bold' }, () => false, onClose)).toBe(false);
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

describe('pullLabel (SV-19)', () => {
  it('appends the monster count from difficultyDetails when present', () => {
    expect(pullLabel(hunts[1]!, 'cautious')).toBe('Cauteloso · 3');
    expect(pullLabel(hunts[1]!, 'bold')).toBe('Ousado · 6');
  });

  it('falls back to only the localized name without a count, never "· undefined"', () => {
    // rat-cellars tem `difficultyDetails: []` — o catálogo de um nó anterior à SV-19.
    expect(pullLabel(hunts[0]!, 'reckless')).toBe('Agressivo');
    expect(pullLabel(hunts[0]!, 'reckless')).not.toContain('undefined');
  });

  it('falls back to the raw difficulty id when it has no localized text', () => {
    expect(pullLabel(hunts[0]!, 'custom')).toBe('custom');
  });
});
