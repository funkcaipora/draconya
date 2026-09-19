import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BotSlot } from '@draconya/content';
import { ActionConfigModal } from './ActionConfigModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_BOT, bot, edit } from '../bot/store.js';

// O modal de configuração de slot (AB-11, #426), régua `docs/kit-reference/34-modal-action-config.png`.
// `prerender` roda sem DOM: o que se prende é a ESTRUTURA — título, cabeçalho, selects, condições
// e o Salvar bloqueado com motivo. A escolha em si (clicar num select) é presa pelo teste puro de
// `action-config.test.ts`. A ação é magia ou SUPRIMENTO abstrato (sem item, sem reposição).

const catalogue = (): Catalogue => ({
  hunts: [],
  monsters: [],
  ammunition: [],
  vocations: [],
  vocationLevel: 0,
  items: [],
  bot: {
    vocabularyVersion: 2,
    setCount: 4,
    slotsPerSet: 24,
    setNames: ['Energia', 'Fogo', 'Gelo', 'Sagrado'],
    hotkeys: ['1', 'F1'],
    groups: ['potion', 'healing'],
    spells: [{
      id: 'heal', name: 'Cura', manaCost: 20, minLevel: 1, vocationId: null,
      effect: 'heal', group: 'healing',
    }],
    supplies: [{
      id: 'health-potion', name: 'Poção de Vida', price: 20, effect: 'heal',
      group: 'potion', requires: {},
    }],
    automations: [],
  },
});

const spellSlot = (over: Partial<BotSlot> = {}): BotSlot => ({
  do: { kind: 'spell', spellId: 'heal' }, when: [], auto: true, hotkey: 'F1', ...over,
});
const supplySlot = (): BotSlot => ({
  do: { kind: 'supply', supplyId: 'health-potion' }, when: [], auto: true,
});

/** Põe um slot no conjunto 0, sem tocar nos outros 23. */
function withSlot(index: number, slot: BotSlot | null, set = 0): void {
  edit((draft) => ({
    ...draft,
    sets: draft.sets.map((current, s) => (s !== set ? current : ({
      slots: current.slots.map((entry, i) => (i === index ? slot : entry)),
    }))),
  }));
}

async function render(index: number, set = 0): Promise<string> {
  const { prelude } = await prerender(
    createElement(ActionConfigModal, { set, index, onClose: () => {} }),
  );
  return new Response(prelude).text();
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue: catalogue() }));
  bot.set(() => INITIAL_BOT);
});

describe('ActionConfigModal — o cabeçalho (RF-01/RF-02)', () => {
  it('mostra a faixa e a meta com o número REAL do slot, não o NAN do kit', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    expect(html).toContain('CONFIGURAR AÇÃO · SLOT 1');
    expect(html).toContain('Barra de ações · slot 1');
    expect(html).not.toContain('NAN');
  });

  it('slot de magia traz slot de 36 px, nome, legenda e automática ligada', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    expect(html).toContain('ui-slot');
    expect(html).toContain('Cura');
    expect(html).toContain('magia · gasta 20 mana');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('automática');
  });

  it('oferece TIPO, AÇÃO e ATALHO do catálogo, com a opção sem tecla', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    expect((html.match(/ui-select-sm/g) ?? []).length).toBe(3);
    expect(html).toContain('Magia');
    expect(html).toContain('Suprimento');
    expect(html).toContain('F1');
    expect(html).toContain('sem tecla');
  });
});

describe('ActionConfigModal — slot vazio (RF-09)', () => {
  it('abre com ação —, Salvar desabilitado e a mensagem de escolher ação', async () => {
    const html = await render(6);
    expect(html).toContain('CONFIGURAR AÇÃO · SLOT 7');
    expect(html).toContain('Barra de ações · slot 7');
    expect(html).toContain('—');
    expect(html).toContain('Escolha uma ação.');
    expect(html).toMatch(/disabled[^>]*>Salvar/);
  });
});

describe('ActionConfigModal — condições em E (RF-04)', () => {
  it('carrega a condição atual como o jogador a lê', async () => {
    withSlot(0, spellSlot({ when: [{ kind: 'targets', op: '>=', count: 2 }] }));
    const html = await render(0);
    expect(html).toContain('Nº de alvos ≥ 2');
    expect(html).toContain('+ CONDIÇÃO');
  });
});

describe('ActionConfigModal — suprimento abstrato (RF-07)', () => {
  it('slot de suprimento mostra o nome e o preço em gold, sem LEVAR/REPOR', async () => {
    withSlot(0, supplySlot());
    const html = await render(0);
    expect(html).toContain('Poção de Vida');
    expect(html).toContain('suprimento · 20 gold');
    expect(html).not.toContain('LEVAR/REPOR');
    expect(html).not.toContain('Repor abaixo de');
  });

  it('slot de magia também não mostra seção de reposição', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    expect(html).not.toContain('LEVAR/REPOR');
    expect(html).not.toContain('Levar');
  });
});

describe('ActionConfigModal — o Salvar bloqueado tem motivo (RF-05/RF-06)', () => {
  it('valor de HP fora de faixa mostra o motivo e bloqueia', async () => {
    withSlot(0, spellSlot({ when: [{ kind: 'hp', op: '>=', percent: 150 }] }));
    const html = await render(0);
    expect(html).toContain('fora de faixa');
    expect(html).toMatch(/disabled[^>]*>Salvar/);
  });

  it('tecla repetida no conjunto nomeia o slot em conflito e bloqueia', async () => {
    withSlot(0, spellSlot({ hotkey: 'F1' }));
    withSlot(2, spellSlot({ hotkey: 'F1' }));
    const html = await render(0);
    expect(html).toContain('A tecla F1 já está no slot 3 deste conjunto.');
    expect(html).toMatch(/disabled[^>]*>Salvar/);
  });
});

describe('ActionConfigModal — sem catálogo (RF-10)', () => {
  it('diz Carregando… e não oferece lista de ação inventada', async () => {
    hud.set((state) => ({ ...state, catalogue: null }));
    const html = await render(0);
    expect(html).toContain('Carregando…');
    expect(html).not.toContain('ui-select');
  });
});
