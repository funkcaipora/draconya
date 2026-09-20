import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import { Shell } from './Shell.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Aggregates } from '../state/hud.js';

// A geografia (§5.3, ADR 0026 d.7, #161, #307): set, bolsa e mochila FIXOS à direita, nessa ordem,
// antes do analisador e do Bestiário. `prerender` roda a árvore inteira sem DOM e sem efeitos
// — o viewport monta vazio, e o que se prende é a ordem das seções.

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(Shell));
  return new Response(prelude).text();
}

function buttonFor(html: string, id: string): string {
  const marker = html.indexOf(`data-window="${id}"`);
  const start = html.lastIndexOf('<button', marker);
  const end = html.indexOf('</button>', marker);
  return html.slice(start, end + '</button>'.length);
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD }));
});

describe('Shell', () => {
it('always mounts the player vitals overlay inside the world stage (#328, RC-15)', async () => {
    const html = await render();
    const stageIndex = html.indexOf('class="world-stage"');
    const vitalsIndex = html.indexOf('class="player-vitals"', stageIndex);
    const topbarIndex = html.indexOf('class="topbar"', stageIndex);
    expect(stageIndex).toBeGreaterThanOrEqual(0);
    expect(vitalsIndex).toBeGreaterThan(stageIndex);
    expect(topbarIndex).toBeGreaterThan(vitalsIndex);
  });

  it('the right column is set → satchel → backpack, always mounted, in that order (#307, RF-05)', async () => {
    const html = await render();
    const right = html.slice(html.indexOf('janelas à direita'));
    const order = ['ui-panel-title">Set', 'ui-panel-title">Bolsa', 'ui-panel-title">Mochila']
      .map((marker) => right.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Sem `inventory` ainda, as três existem dizendo que carregam — nunca somem.
    expect((right.match(/Carregando/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the chat closed from the start (DEFAULT_WINDOWS.chat)', async () => {
    const html = await render();
    expect(html).not.toContain('aria-label="chat"');
  });

  it('shows a gold Chat badge for an unseen warning while the chat is closed', async () => {
    hud.set((state) => ({
      ...state,
      systemMessages: [{ level: 'warning', text: 'warning', atMs: 5 }],
    }));

    const html = await render();
    const chat = buttonFor(html, 'chat');
    expect(chat).toContain('topbar-icon-button-badge-gold');
    expect(chat).not.toContain('topbar-icon-badge-dot');
  });

  it('shows a danger dot for an unseen error while the chat is closed', async () => {
    hud.set((state) => ({
      ...state,
      systemMessages: [{ level: 'error', text: 'error', atMs: 5 }],
    }));

    const html = await render();
    const chat = buttonFor(html, 'chat');
    expect(chat).toContain('topbar-icon-badge-dot');
    expect(chat).not.toContain('topbar-icon-button-badge-gold');
  });

  // RC-04 (#317): Skills é FIXO na coluna esquerda, sem guarda de open — não há ícone próprio
  // na barra do topo para condicioná-lo.
  it('windows-left always mounts SkillsPanel, unconditionally of open.*', async () => {
    const html = await render();
    const left = html.slice(html.indexOf('janelas à esquerda'), html.indexOf('janelas à direita'));
    expect(left).toContain('Skills');
  });

  // RC-06 (#319): Personagem saiu da coluna e só monta como modal sob open.character.
  it('does not leave a fixed CharacterPanel in the left column and gates CharacterModal by open.character', async () => {
    const html = await render();
    const left = html.slice(html.indexOf('janelas à esquerda'), html.indexOf('janelas à direita'));
    expect(left).not.toContain('PERSONAGEM');
    expect(html).not.toContain('aria-label="Personagem"');

    const source = await readFile(new URL('./Shell.tsx', import.meta.url), 'utf8');
    expect(source).toContain('{open.character && <CharacterModal');
    expect(source).not.toContain('<CharacterPanel');
  });

  it('windows-right renders .vitals as the first child, before the set (#253, RF-01)', async () => {
    // As vitais migraram do topo para o alto da coluna direita (ADR 0029 D3). Mutação que mata:
    // montar `<Vitals />` depois de `<EquipmentPanel />`, ou não montá-la em `Shell.tsx`.
    const html = await render();
    const right = html.slice(html.indexOf('janelas à direita'));
    const vitalsIndex = right.indexOf('class="vitals"');
    const setIndex = right.indexOf('ui-panel-title">Set');
    expect(vitalsIndex).toBeGreaterThan(0);
    expect(setIndex).toBeGreaterThan(vitalsIndex);
  });

  // #315: o Analisador deixou a coluna direita e virou janela FLUTUANTE fora das colunas.
  // Mutação que mata: voltar a montá-lo como `Panel dock` dentro de `.windows-right`.
  it('mounts the analyzer as a floating window, with an active session', async () => {
    const aggregates: Aggregates = {
      durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0,
    };
    hud.set((state) => ({
      ...state,
      analyzer: { sessionType: 'hunt', aggregates, notableEvents: [], receivedAtMs: 0, ended: false, party: undefined },
    }));
    const html = await render();
    expect(html).toContain('ui-floating-window--analyzer');
    expect(html).toContain('ui-panel-title">Analisador de caçada');

    const source = await readFile(new URL('./Shell.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<Analyzer open={open.analyzer}');
    expect(source).not.toContain('<Analyzer collapsed=');
  });

  // #316: "Party loot" é janela flutuante fora das colunas e só existe durante a hunt.
  it('mounts the Party loot floating window during a hunt, never in the city', async () => {
    hud.set((state) => ({
      ...state,
      analyzer: { ...state.analyzer, sessionType: 'hunt' },
      party: { leaderId: 'me', mode: 'shared', members: [] },
      partyBag: { gold: 1, items: [], weight: 0, capacity: 10 },
    }));
    const hunt = await render();
    expect(hunt).toContain('vendido e dividido ao fim');
    expect(hunt).toContain('party-loot-grid');

    hud.set((state) => ({ ...state, analyzer: { ...state.analyzer, sessionType: 'city' } }));
    expect(await render()).not.toContain('vendido e dividido ao fim');
  });

  // #320: a engrenagem do painel da party abre o modal "Gerenciar party".
  it('wires the party gear to the Manage party modal', async () => {
    const source = await readFile(new URL('./Shell.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onManage={() => { setPartyModalOpen(true); }}');
    expect(source).toContain('{partyModalOpen && (');
  });

  // #348, SV-12: a BuffBar mostra as condições ativas sobre o mundo, logo depois do WorldOverlay.
  it('mounts the BuffBar with the active conditions, after the world overlay and before the top bar', async () => {
    hud.set(() => ({
      ...INITIAL_HUD,
      conditions: [{ kind: 'haste', remainingMs: 60_000 }],
      conditionsReceivedAtMs: performance.now(),
    }));
    const html = await render();
    const overlayIndex = html.indexOf('class="world-overlay"');
    const buffBarIndex = html.indexOf('class="buff-bar"');
    const topbarIndex = html.indexOf('class="topbar"');
    expect(buffBarIndex).toBeGreaterThan(overlayIndex);
    expect(topbarIndex).toBeGreaterThan(buffBarIndex);
    expect(html).toContain('Haste');
  });

  // #420: o remetente de `bot-config` tem UM dono só — a casca —, senão o cleanup de um painel
  // condicional zeraria o do outro.
  it('installs the bot-config sender once, as the single owner of the store singleton', async () => {
    const source = await readFile(new URL('./Shell.tsx', import.meta.url), 'utf8');
    expect(source).toContain('setConfigSender');
    expect(source).toContain("type: 'bot-config'");
  });
});
