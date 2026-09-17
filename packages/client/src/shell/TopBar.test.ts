import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { TopBar } from './TopBar.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_ACCOUNT, account } from '../account/store.js';
import type { Creature } from '../state/world.js';
import { world } from '../state/world.js';

// A casca do design (#251, #351, D3/D8/D9): identidade, "VOCAÇÃO · LV N", a pill de gold, o
// wordmark com contagem de jogadores (SV-15) e os seis ícones PNG — nenhum emoji, nenhum ícone para
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
  world.selfId = null;
  world.creatures.clear();
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
    expect(html).not.toContain('item-sprite');
    expect(html).toContain('>Aldric<');
    // A ordem é "VOCAÇÃO · LV N" (DT-04): vocação primeiro. `react-dom/static` insere um
    // comentário de fronteira entre os dois `{}` adjacentes, então o texto não fica contíguo.
    const vocationIndex = html.indexOf('Knight');
    const levelIndex = html.indexOf('LV 12');
    expect(vocationIndex).toBeGreaterThan(0);
    expect(levelIndex).toBeGreaterThan(vocationIndex);
    expect(html).toContain('2.134.760');
    const statusIndex = html.indexOf('role="status"');
    const lastIconIndex = html.lastIndexOf('topbar-icon-button');
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
    expect((html.match(/topbar-icon-button/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((html.match(/data-window="/g) ?? []).length).toBe(6);
    for (const label of ['Hunts', 'Bot', 'Inventário', 'Analisador', 'Cyclopedia', 'Chat']) {
      expect(html).toContain(`title="${label}"`);
    }
    for (const label of ['Loja', 'Guild', 'Amigos', 'Prey', 'Configurações']) {
      expect(html).not.toContain(`title="${label}"`);
    }
  });

  it('renders formatted number "1.284 players online" inside .topbar-online when onlinePlayers is 1284', async () => {
    hud.set((state) => ({ ...state, onlinePlayers: 1284 }));
    const html = await render();
    expect(html).toContain('DRACONYA');
    expect(html).toContain('class="topbar-online"');
    expect(html).toContain('1.284 players online');
  });

  it('renders "0 players online" inside .topbar-online when onlinePlayers is 0', async () => {
    hud.set((state) => ({ ...state, onlinePlayers: 0 }));
    const html = await render();
    expect(html).toContain('0 players online');
  });

  it('renders "—" inside .topbar-online when onlinePlayers is null', async () => {
    hud.set((state) => ({ ...state, onlinePlayers: null }));
    const html = await render();
    expect(html).toContain('<span class="topbar-online">—</span>');
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

  it('renders the outfit sprite inside .topbar-portrait when world.selfId and the creature exist', async () => {
    hud.set(() => ({ ...INITIAL_HUD, characterId: 'c1' }));
    account.set(() => ({
      ...INITIAL_ACCOUNT,
      characters: [{ id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'hunt', sessionId: 's1' }],
    }));
    world.selfId = 1;
    world.creatures.set(1, {
      id: 1,
      name: 'Aldric',
      kind: 'player',
      tile: { x: 0, y: 0 },
      position: { x: 0, y: 0, z: 7 },
      step: null,
      moving: false,
      stepProgress: 0,
      targetTile: null,
      direction: 'south',
      appearanceId: 128,
      colors: { head: 10, body: 20, legs: 30, feet: 40 },
      health: 100,
      maxHealth: 100,
    } as unknown as Creature);
    const html = await render();
    expect(html).toContain('class="topbar-portrait"');
    expect(html).toContain('class="item-sprite"');
    expect(html).toMatch(/class="topbar-portrait"[^>]*>\s*<span class="item-sprite"/);
  });

  it('keeps the plain initial when the world does not have the self creature yet (city loading, entry)', async () => {
    hud.set(() => ({ ...INITIAL_HUD, characterId: 'c1' }));
    account.set(() => ({
      ...INITIAL_ACCOUNT,
      characters: [{ id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'city', sessionId: null }],
    }));
    world.selfId = null;
    const html = await render();
    expect(html).not.toContain('item-sprite');
    expect(html).toContain('>A<');
  });

  it('keeps the plain initial when selfId is set but the creature has not arrived yet (race)', async () => {
    hud.set(() => ({ ...INITIAL_HUD, characterId: 'c1' }));
    account.set(() => ({
      ...INITIAL_ACCOUNT,
      characters: [{ id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'city', sessionId: null }],
    }));
    world.selfId = 1;
    world.creatures.clear();
    const html = await render();
    expect(html).not.toContain('item-sprite');
    expect(html).toContain('>A<');
  });
});
