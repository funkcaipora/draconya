import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { TopBar } from './TopBar.js';
import type { ChatBadgeTier } from './chat-badge.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_ACCOUNT, account } from '../account/store.js';
import { world } from '../state/world.js';
import type { Creature } from '../state/world.js';

// A casca do design (#251, D3/D8/D9): identidade, "VOCAÇÃO · LV N", a pill de gold, o
// wordmark com a contagem de jogadores (SV-15, #351) e os cinco ícones PNG na ordem do kit —
// nenhum emoji, nenhum ícone para sistema inexistente. `prerender` roda a árvore inteira sem
// DOM e pula os efeitos, então o retrato (SV-14, #350) só troca para o sprite quando a
// criatura já está em `world` ANTES da renderização — o `setInterval` do polling nunca dispara
// aqui, como em `BattlePanel.test.ts`.

const OPEN = { character: false, hunts: true, bot: true, inventory: true, analyzer: true, bestiary: false, social: false, chat: true };
const NOOP_TOGGLE = (): void => {};

async function render(open = OPEN, chatBadge: ChatBadgeTier | null = null): Promise<string> {
  const { prelude } = await prerender(createElement(TopBar, {
    open, toggle: NOOP_TOGGLE, chatBadge,
  }));
  return new Response(prelude).text();
}

function buttonFor(html: string, id: string): string {
  const marker = html.indexOf(`data-window="${id}"`);
  const start = html.lastIndexOf('<button', marker);
  const end = html.indexOf('</button>', marker);
  return html.slice(start, end + '</button>'.length);
}

function creature(id: number, over: Partial<Creature> = {}): Creature {
  return {
    id,
    appearanceId: 128,
    name: 'Aldric',
    health: 100,
    maxHealth: 100,
    position: { x: 0, y: 0, z: 7 },
    step: null,
    ...over,
  };
}

const catalogue: Catalogue = {
  hunts: [], monsters: [],
  bot: {
    vocabularyVersion: 1, slots: {},
    spells: [], supplies: [],
  },
  items: [],
  ammunition: [],
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
  it('shows the portrait, name, "VOCAÇÃO · LV N" and the gold pill', async () => {
    hud.set(() => ({
      ...INITIAL_HUD, characterId: 'c1', level: 12, gold: 2_134_760, vocationId: 'knight', catalogue,
    }));
    account.set(() => ({
      ...INITIAL_ACCOUNT,
      characters: [{ id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'hunt', sessionId: 's1' }],
    }));
    const html = await render();
    expect(html).toContain('class="topbar-portrait"');
    expect(html).toMatch(/<button[^>]*class="topbar-portrait"[^>]*data-window="character"/);
    expect(html).toContain('>A<'); // a inicial do nome
    expect(html).toContain('>Aldric<');
    // A ordem é "VOCAÇÃO · LV N" (DT-04): vocação primeiro. `react-dom/static` insere um
    // comentário de fronteira entre os dois `{}` adjacentes, então o texto não fica contíguo.
    const vocationIndex = html.indexOf('Knight');
    const levelIndex = html.indexOf('LV 12');
    expect(vocationIndex).toBeGreaterThan(0);
    expect(levelIndex).toBeGreaterThan(vocationIndex);
    expect(html).toContain('2.134.760');
  });

  it('does not render the connection status after it moved to the world overlay', async () => {
    const html = await render();
    expect(html).not.toContain('role="status"');
  });

  it('shows only "LV N", without "VOCAÇÃO ·", when vocationId is null (D8)', async () => {
    hud.set(() => ({ ...INITIAL_HUD, characterId: 'c1', level: 3, vocationId: null, catalogue }));
    const html = await render();
    expect(html).toContain('LV 3');
    expect(html).not.toContain(' · LV 3');
  });

  it('shows exactly six window icons, in the kit order, and none for Bot/Inventory/inexistent systems', async () => {
    const html = await render();
    expect((html.match(/ui-icon-button-lg/g) ?? []).length).toBe(6);
    // Seis ícones de navegação e o retrato clicável carregam data-window.
    expect((html.match(/data-window="/g) ?? []).length).toBe(7);
    const order = ['Personagem', 'Hunts', 'Analisador', 'Cyclopedia', 'Amigos', 'Chat'];
    const indexes = order.map((label) => html.indexOf(`title="${label}"`));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
    for (const label of ['Bot', 'Inventário', 'Loja', 'Guild', 'Prey', 'Configurações']) {
      expect(html).not.toContain(`title="${label}"`);
    }
  });

  it('the "Amigos" icon is the social one, after Cyclopedia and before Chat (RF-08, #404)', async () => {
    const html = await render();
    expect(html).toContain('data-window="social"');
    const social = buttonFor(html, 'social');
    expect(social).toContain('title="Amigos"');
    expect(social).toContain('aria-pressed="false"');
    expect(html.indexOf('title="Cyclopedia"')).toBeLessThan(html.indexOf('title="Amigos"'));
    expect(html.indexOf('title="Amigos"')).toBeLessThan(html.indexOf('title="Chat"'));
  });

  it('never renders a permanent text label under a nav icon (R1-10) — only the title tooltip', async () => {
    const html = await render();
    expect(html).not.toContain('topbar-icon-label');
    // O tooltip nativo continua presente para cada ícone (kit: IconButton usa só `title`).
    for (const label of ['Personagem', 'Hunts', 'Analisador', 'Cyclopedia', 'Amigos', 'Chat']) {
      expect(html).toContain(`title="${label}"`);
    }
  });

  it('shows the gold badge only on Chat', async () => {
    const html = await render(OPEN, 'gold');

    expect(buttonFor(html, 'chat')).toContain('topbar-icon-button-badge-gold');
    expect(buttonFor(html, 'analyzer')).not.toContain('topbar-icon-button-badge-gold');
  });

  it('shows the danger dot only on Chat', async () => {
    const html = await render(OPEN, 'danger');

    expect(buttonFor(html, 'chat')).toContain('topbar-icon-badge-dot');
    expect(buttonFor(html, 'analyzer')).not.toContain('topbar-icon-badge-dot');
  });

  it('shows no badge when Chat has no unseen system message', async () => {
    const html = await render(OPEN, null);

    expect(buttonFor(html, 'chat')).not.toContain('topbar-icon-button-badge-gold');
    expect(buttonFor(html, 'chat')).not.toContain('topbar-icon-badge-dot');
  });

  it('shows "—" in .topbar-online while onlinePlayers is null (SV-15, #351)', async () => {
    const html = await render();
    expect(html).toContain('DRACONYA');
    expect(html).toContain('<span class="topbar-online">—</span>');
  });

  it('shows the pt-BR formatted count in .topbar-online once it arrives (SV-15, #351)', async () => {
    hud.set((state) => ({ ...state, onlinePlayers: 1_234 }));
    const html = await render();
    expect(html).toContain('<span class="topbar-online">1.234 players online</span>');
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

  it('shows the outfit sprite in the portrait once the own creature is in the world (SV-14, #350)', async () => {
    hud.set(() => ({ ...INITIAL_HUD, characterId: 'c1' }));
    account.set(() => ({
      ...INITIAL_ACCOUNT,
      characters: [{ id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'hunt', sessionId: 's1' }],
    }));
    world.selfId = 1;
    world.creatures.set(1, creature(1, { colors: { head: 10, body: 20, legs: 30, feet: 40 } }));
    const html = await render();
    // O sprite substitui a inicial DENTRO do mesmo botão — o retrato continua sendo
    // `.topbar-portrait` (props/onClick intocados), só o conteúdo muda.
    expect(html).toMatch(/class="topbar-portrait"[^>]*>\s*<span class="item-sprite"/);
  });

  it('keeps the plain initial in the portrait while the own creature has not arrived in the world (SV-14, #350)', async () => {
    hud.set(() => ({ ...INITIAL_HUD, characterId: 'c1' }));
    account.set(() => ({
      ...INITIAL_ACCOUNT,
      characters: [{ id: 'c1', name: 'Aldric', level: 12, xp: 0, gold: 0, vocation: 'knight', state: 'city', sessionId: null }],
    }));
    // world.selfId continua null (beforeEach) — a corrida entre welcome e session-state.
    const html = await render();
    expect(html).not.toContain('item-sprite');
    expect(html).toContain('>A<');
  });

  it('every window icon carries aria-pressed (#306)', async () => {
    const html = await render();
    expect((html.match(/aria-pressed="(true|false)"/g) ?? []).length).toBe(6);
  });
});
