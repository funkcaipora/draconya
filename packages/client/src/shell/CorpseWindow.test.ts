// A janela do cadáver (#722, ADR 0048 d.4). Como `ContainerWindow.test.ts`: `prerender` não
// dispara evento nenhum, então o que este arquivo prende é ESTRUTURA — o que `hud.corpse` faz a
// tela mostrar —, não o clique em si (`sendIntent` é lido por leitura de fonte, como
// `Viewport.test.ts` faz para o clique no mundo).

import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import { CorpseWindow } from './CorpseWindow.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';

async function render(): Promise<string> {
  const { prelude } = await prerender(createElement(CorpseWindow));
  return new Response(prelude).text();
}

async function source(): Promise<string> {
  return readFile(new URL('./CorpseWindow.tsx', import.meta.url), 'utf8');
}

const catalogue: Catalogue = {
  hunts: [], monsters: [], ammunition: [], vocations: [], vocationLevel: 8,
  bot: { vocabularyVersion: 1, slots: {}, spells: [], supplies: [] },
  items: [
    { id: 'gem', name: 'Gem', appearanceId: 5, weight: 1, slot: null, twoHanded: false },
  ],
};

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue, corpse: null }));
});

describe('CorpseWindow (#722, ADR 0048 d.4)', () => {
  it('não desenha nada sem cadáver aberto', async () => {
    expect(await render()).toBe('');
  });

  it('mostra o ouro, os itens do catálogo e o botão "Pegar tudo"', async () => {
    hud.set((state) => ({
      ...state,
      corpse: { groundItemId: 7, gold: 12, items: [{ instanceId: 'i1', itemId: 'gem', quantity: 2 }] },
    }));
    const html = await render();
    expect(html).toContain('class="corpse-window-gold">12');
    expect(html).toContain('gp</p>');
    expect(html).toContain('title="Pegar Gem"');
    expect(html).toContain('<b class="ui-slot-count">2</b>');
    expect(html).toContain('Pegar tudo');
    expect(html).toContain('Cadáver');
  });

  it('cadáver vazio diz "Nada mais aqui" e não mostra "Pegar tudo"', async () => {
    hud.set((state) => ({ ...state, corpse: { groundItemId: 7, gold: 0, items: [] } }));
    const html = await render();
    expect(html).toContain('Nada mais aqui');
    expect(html).not.toContain('Pegar tudo');
    expect(html).not.toContain('gp');
  });

  it('item sem gold ainda mostra "Pegar tudo" — há o que coletar', async () => {
    hud.set((state) => ({
      ...state,
      corpse: { groundItemId: 7, gold: 0, items: [{ instanceId: 'i1', itemId: 'gem', quantity: 1 }] },
    }));
    expect(await render()).toContain('Pegar tudo');
  });

  it('o clique num item manda take-loot com o instanceId, ignorando o filtro', async () => {
    const code = await source();
    expect(code).toContain(
      "sendIntent({ type: 'take-loot', groundItemId, instanceId: item.instanceId });",
    );
  });

  it('"Pegar tudo" manda take-loot com instanceId: null — o clique do Quick Loot', async () => {
    const code = await source();
    expect(code).toContain(
      "sendIntent({ type: 'take-loot', groundItemId, instanceId: null });",
    );
  });

  it('fechar limpa hud.corpse sem mandar nada ao servidor (DT-03)', async () => {
    const code = await source();
    expect(code).toContain('hud.set((state) => ({ ...state, corpse: null }))');
  });
});
