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

  it('the right column is set → satchel → backpack → analyzer, always mounted, in that order (#307, RF-05)', async () => {
    const html = await render();
    const right = html.slice(html.indexOf('janelas à direita'));
    const order = ['ui-panel-title">Set', 'ui-panel-title">Bolsa', 'ui-panel-title">Mochila']
      .map((marker) => right.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Sem `inventory` ainda, as três existem dizendo que carregam — nunca somem.
    expect((right.match(/Carregando/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  // RF-02 (#252): o chat nasce aberto — é onde chegam as recusas do servidor
  // (`system-message`), e uma janela que abre fechada esconderia a primeira da sessão.
  it('the chat is mounted from the start (DEFAULT_WINDOWS.chat)', async () => {
    const html = await render();
    expect(html).toContain('aria-label="chat"');
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

  // #258 (D6): o analisador deixou de ser `{open.analyzer && <Analyzer />}` — montado/desmontado
  // pela barra do topo — e virou uma seção FIXA, como `BotPanel`/`EquipmentPanel`. Mutação que
  // mata: voltar a montá-lo condicionalmente em `Shell.tsx` faria este teste continuar passando
  // (a janela nasce aberta, `DEFAULT_WINDOWS.analyzer: true`) — quem prova "nunca desmonta" é
  // `Analyzer.test.ts` (`collapsed={true}` ainda com o cabeçalho no HTML); aqui só se prova que
  // o `Panel dock` "Analisador de caçada" está na coluna certa, depois de mochila e bolsa.
  it('the analyzer is a fixed "Analisador de caçada" panel in the right column, with an active session', async () => {
    const aggregates: Aggregates = {
      durationMs: 0, xpGained: 0, goldGained: 0, goldSpent: 0, kills: 0, deaths: 0,
    };
    hud.set((state) => ({
      ...state,
      analyzer: { sessionType: 'hunt', aggregates, notableEvents: [], receivedAtMs: 0, ended: false },
    }));
    const html = await render();
    const right = html.slice(html.indexOf('janelas à direita'));
    const backpackIndex = right.indexOf('ui-panel-title">Mochila');
    const analyzerIndex = right.indexOf('ui-panel-title">Analisador de caçada');
    expect(backpackIndex).toBeGreaterThan(0);
    expect(analyzerIndex).toBeGreaterThan(backpackIndex);
  });
});
