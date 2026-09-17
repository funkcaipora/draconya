import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { TopBar } from './TopBar.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_ACCOUNT, account } from '../account/store.js';

// A casca do design (#251, D3/D8/D9): identidade, "VOCAÇÃO · LV N", a pill de gold, o
// wordmark sem contagem de jogadores e os seis ícones PNG — nenhum emoji, nenhum ícone para
// sistema inexistente. `prerender` roda a árvore inteira sem DOM.

const OPEN = { hunts: true, bot: true, inventory: true, analyzer: true, bestiary: false, chat: true };
const NOOP_TOGGLE = (): void => {};

async function render(open = OPEN): Promise<string> {
  const { prelude } = await prerender(createElement(TopBar, { open, toggle: NOOP_TOGGLE }));
  return new Response(prelude).text();
}

const catalogue: Catalogue = {
  hunts: [], monsters: [], ammunition: [],
  bot: {
    vocabularyVersion: 1, advancedFromLevel: 50, slots: {},
    advancedOnly: { conditions: [], targetPolicies: [], postures: [] },
    spells: [], supplies: [],
  },
  items: [],
  vocations: [
    { id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25, startingWeaponItemId: 'steel-axe' },
  ],
  vocationLevel: 8,
};

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD }));
  account.set(() => ({ ...INITIAL_ACCOUNT }));
});

describe('TopBar', () => {
  it('shows the portrait, name, "VOCAÇÃO · LV N", the gold pill and the connection badge after the icons', async () => {
    hud.set(() => ({
      ...INITIAL_HUD, characterId: 'c1', level: 12, gold: 2_134_760, vocationId: 'knight', catalogue,
    }));
    account.set(() => ({
      ...INITIAL_ACCOUNT,
      characters: [{ id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'hunt', sessionId: 's1' }],
    }));
    const html = await render();
    expect(html).toContain('class="topbar-portrait"');
    expect(html).toContain('>A<'); // a inicial do nome
    expect(html).toContain('>Aldric<');
    // A ordem é "VOCAÇÃO · LV N" (DT-04): vocação primeiro. `react-dom/static` insere um
    // comentário de fronteira entre os dois `{}` adjacentes, então o texto não fica contíguo.
    const vocationIndex = html.indexOf('Knight');
    const levelIndex = html.indexOf('LV 12');
    expect(vocationIndex).toBeGreaterThan(0);
    expect(levelIndex).toBeGreaterThan(vocationIndex);
    expect(html).toContain('2.134.760');
    const statusIndex = html.indexOf('role="status"');
    const lastIconIndex = html.lastIndexOf('ui-icon-button-lg');
    expect(statusIndex).toBeGreaterThan(0);
    expect(statusIndex).toBeGreaterThan(lastIconIndex);
  });

  it('shows only "LV N", without "VOCAÇÃO ·", when vocationId is null (D8)', async () => {
    hud.set(() => ({ ...INITIAL_HUD, characterId: 'c1', level: 3, vocationId: null, catalogue }));
    const html = await render();
    expect(html).toContain('LV 3');
    expect(html).not.toContain(' · LV 3');
  });

  it('shows the six window icons, and no icon for a system that does not exist', async () => {
    const html = await render();
    expect((html.match(/ui-icon-button-lg/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((html.match(/data-window="/g) ?? []).length).toBe(6);
    for (const label of ['Hunts', 'Bot', 'Inventário', 'Analisador', 'Cyclopedia', 'Chat']) {
      expect(html).toContain(`title="${label}"`);
    }
    for (const label of ['Loja', 'Guild', 'Amigos', 'Prey', 'Configurações']) {
      expect(html).not.toContain(`title="${label}"`);
    }
  });

  it('never renders a permanent text label under a nav icon (R1-10) — only the title tooltip', async () => {
    const html = await render();
    expect(html).not.toContain('topbar-icon-label');
    // O tooltip nativo continua presente para cada ícone (kit: IconButton usa só `title`).
    for (const label of ['Hunts', 'Bot', 'Inventário', 'Analisador', 'Cyclopedia', 'Chat']) {
      expect(html).toContain(`title="${label}"`);
    }
  });

  it('centers the "DRACONYA" wordmark without any player count', async () => {
    const html = await render();
    expect(html).toContain('DRACONYA');
    expect(html).not.toContain('online');
  });

  it('never renders an emoji', async () => {
    const html = await render();
    const emojiRange = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emojiRange.test(html)).toBe(false);
  });

  it('falls back to "—" for the name and "?" for the portrait before the welcome arrives', async () => {
    hud.set(() => ({ ...INITIAL_HUD, characterId: null }));
    const html = await render();
    expect(html).toContain('>—<');
    expect(html).toContain('>?<');
  });

  it('every window icon carries aria-pressed (#306)', async () => {
    const html = await render();
    expect((html.match(/aria-pressed="(true|false)"/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
