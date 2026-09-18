import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { LureTargetingModal } from './LureTargetingModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_BOT, bot, edit } from '../bot/store.js';

const catalogue: Catalogue = {
  hunts: [],
  monsters: [
    { id: 'rat', name: 'Rat' },
    { id: 'dragon', name: 'Dragon' },
    { id: 'demon', name: 'Demon' },
  ],
  ammunition: [],
  items: [],
  vocations: [],
  vocationLevel: 8,
  bot: {
    vocabularyVersion: 1,
    slots: { heal: 2, potion: 4, attack: 2, rune: 2, support: 2 },
    spells: [],
    supplies: [],
  },
};

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(LureTargetingModal, { onClose: () => {} }));
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue, level: 60 }));
  bot.set(() => ({ ...INITIAL_BOT }));
});

describe('LureTargetingModal', () => {
  it('returns empty string when catalogue is null', async () => {
    hud.set((state) => ({ ...state, catalogue: null }));
    const html = await render();
    expect(html).toBe('');
  });

  it('renders modal 620px "Lure e alvo" with policies, postures, buttons, and hint', async () => {
    const html = await render();
    expect(html).toContain('Lure e alvo');
    expect(html).toContain('width:620px');
    expect(html).toContain('Bot avançado');
    expect(html).toContain('Mais próximo');
    expect(html).toContain('Menor HP');
    expect(html).toContain('Maior HP');
    expect(html).toContain('Parado');
    expect(html).toContain('Seguir');
    expect(html).toContain('Manter distância');
    expect(html).toContain('correndo');
    expect(html).toContain('lutando');
    expect(html).toContain('⇄');
    expect(html).toContain('Cancelar');
    expect(html).toContain('Salvar');
  });

  it('não tem mais gate de level: nenhum aviso de recusa abaixo do 50 (AB-03)', async () => {
    hud.set((state) => ({ ...state, level: 10 }));
    const html = await render();
    expect(html).not.toContain('lure-locked');
    expect(html).not.toContain('o servidor recusa até lá');
  });

  it('validates hysteresis warning only when max < min (accepts max === min)', async () => {
    // default (min 4, max 8) -> good
    const defaultHtml = await render();
    expect(defaultHtml).toContain('Priorizado ganha antes da política · ignorar vence priorizar');
    expect(defaultHtml).not.toContain('Máximo precisa ser maior ou igual ao mínimo');

    // max === min (e.g. min 4, max 4) -> valid (not bad)
    edit((draft) => ({ ...draft, lure: { min: 4, max: 4 } }));
    const equalHtml = await render();
    expect(equalHtml).toContain('Priorizado ganha antes da política · ignorar vence priorizar');
    expect(equalHtml).not.toContain('Máximo precisa ser maior ou igual ao mínimo');

    // max < min (e.g. min 8, max 4) -> bad
    edit((draft) => ({ ...draft, lure: { min: 8, max: 4 } }));
    const badHtml = await render();
    expect(badHtml).toContain('Máximo precisa ser maior ou igual ao mínimo');
    expect(badHtml).not.toContain('Priorizado ganha antes da política · ignorar vence priorizar');
  });

  it('renders prioritized and ignored badges using monster names, not raw ids', async () => {
    edit((draft) => ({
      ...draft,
      targeting: {
        ...draft.targeting,
        prioritize: ['dragon'],
        ignore: ['rat'],
      },
    }));

    const html = await render();
    expect(html).toContain('Dragon');
    expect(html).toContain('aria-label="remover Dragon de priorizar"');
    expect(html).toContain('Rat');
    expect(html).toContain('aria-label="remover Rat de ignorar"');
  });

  it('shows "Distância (tiles)" input only when posture is keep-distance', async () => {
    // posture stand -> absent
    edit((draft) => ({ ...draft, targeting: { ...draft.targeting, posture: { kind: 'stand' } } }));
    const standHtml = await render();
    expect(standHtml).not.toContain('Distância (tiles)');

    // posture follow -> absent
    edit((draft) => ({ ...draft, targeting: { ...draft.targeting, posture: { kind: 'follow' } } }));
    const followHtml = await render();
    expect(followHtml).not.toContain('Distância (tiles)');

    // posture keep-distance -> present with distance input
    edit((draft) => ({
      ...draft,
      targeting: { ...draft.targeting, posture: { kind: 'keep-distance', tiles: 5 } },
    }));
    const keepDistanceHtml = await render();
    expect(keepDistanceHtml).toContain('Distância (tiles)');
    expect(keepDistanceHtml).toContain('value="5"');
  });
});
