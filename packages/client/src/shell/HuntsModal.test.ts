import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HuntsModal, attemptEnter, enterHuntMessage, pullLabel, resolveSelection } from './HuntsModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue, HuntListing } from '../state/hud.js';
import { INITIAL_PARTY, party } from '../party/store.js';

// "Escolha uma caçada" (#259). `prerender` roda a árvore sem DOM e sem eventos — um clique real
// não dispara (mesmo limite de VocationChoice.test.ts). A decisão em si (que hunt, que pull, se
// a intenção é enviada e se o modal fecha) mora em funções puras exportadas e testadas direto;
// aqui só se prende a ESTRUTURA e o que essas funções produzem por padrão.

const hunts: HuntListing[] = [
  {
    id: 'rat-cellars', name: 'Rat Cellars', recommendedLevel: 1,
    difficulties: ['cautious', 'bold', 'reckless'],
    difficultyDetails: [
      { id: 'cautious', monsterCount: 2 },
      { id: 'bold', monsterCount: 5 },
      { id: 'reckless', monsterCount: 8 },
    ],
    outfitIds: [21], lootDrops: 2, monsters: [], loot: [],
  },
  {
    id: 'dragon-lair', name: 'Covil dos Dragões', recommendedLevel: 60,
    difficulties: ['cautious', 'bold'],
    difficultyDetails: [
      { id: 'cautious', monsterCount: 1 },
      { id: 'bold', monsterCount: 3 },
    ],
    outfitIds: [], lootDrops: 7, monsters: [], loot: [],
  },
];

const catalogue: Catalogue = {
  hunts, monsters: [], ammunition: [],
  bot: { vocabularyVersion: 1, advancedFromLevel: 50, slots: {}, advancedOnly: { conditions: [], targetPolicies: [], postures: [] }, spells: [], supplies: [] },
  items: [], vocations: [], vocationLevel: 8,
};

async function render(props: { hunting: boolean; onClose?: () => void }): Promise<string> {
  const { prelude } = await prerender(createElement(HuntsModal, { onClose: () => {}, ...props }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue, level: 10, characterId: 'me' }));
  party.set(() => ({ ...INITIAL_PARTY, characterId: 'me' }));
});

describe('HuntsModal', () => {
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

  it('RF-06: the right column is the same PartyPanel ("Criar party" is present)', async () => {
    const html = await render({ hunting: false });
    expect(html).toContain('Criar party');
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
    expect(html.slice(detailIndex)).toMatch(/class="[^"]*ui-button-primary[^"]*">Cauteloso · 2</);
  });

  it('an empty catalogue.hunts shows the "no hunt" message, without pull buttons', async () => {
    hud.set((state) => ({ ...state, catalogue: { ...catalogue, hunts: [] } }));
    const html = await render({ hunting: false });
    expect(html).toContain('Nenhuma caçada disponível neste servidor.');
    expect(html).not.toContain('hunts-modal-pulls');
  });

  it('catalogue === null shows "Carregando…"', async () => {
    hud.set((state) => ({ ...state, catalogue: null }));
    const html = await render({ hunting: false });
    expect(html).toContain('Carregando…');
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

describe('attemptEnter (RF-04)', () => {
  it('closes the modal only when send() returns true', () => {
    const onClose = vi.fn();
    attemptEnter({ type: 'enter-hunt', huntId: 'rat-cellars', difficulty: 'bold' }, () => true, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close the modal when send() returns false (no connection)', () => {
    const onClose = vi.fn();
    attemptEnter({ type: 'enter-hunt', huntId: 'rat-cellars', difficulty: 'bold' }, () => false, onClose);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('never calls send(), nor closes, with a null message', () => {
    const send = vi.fn(() => true);
    const onClose = vi.fn();
    attemptEnter(null, send, onClose);
    expect(send).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('pullLabel (SV-19, #355)', () => {
  it('appends · N when monsterCount is present', () => {
    expect(pullLabel(hunts[0]!, 'bold')).toBe('Ousado · 5');
    expect(pullLabel(hunts[0]!, 'cautious')).toBe('Cauteloso · 2');
    expect(pullLabel(hunts[0]!, 'reckless')).toBe('Agressivo · 8');
  });

  it('falls back to just difficulty name when difficultyDetails is empty or missing that difficulty', () => {
    const huntWithoutDetails: HuntListing = {
      ...hunts[0]!,
      difficultyDetails: [],
    };
    expect(pullLabel(huntWithoutDetails, 'bold')).toBe('Ousado');

    const huntWithMissingDiff: HuntListing = {
      ...hunts[0]!,
      difficultyDetails: [{ id: 'cautious', monsterCount: 2 }],
    };
    expect(pullLabel(huntWithMissingDiff, 'reckless')).toBe('Agressivo');
  });

  it('falls back to raw difficulty key when unknown to DIFFICULTY_TEXT', () => {
    const customHunt: HuntListing = {
      ...hunts[0]!,
      difficulties: ['nightmare'],
      difficultyDetails: [{ id: 'nightmare', monsterCount: 10 }],
    };
    expect(pullLabel(customHunt, 'nightmare')).toBe('nightmare · 10');
  });
});

