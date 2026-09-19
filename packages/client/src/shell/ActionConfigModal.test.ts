import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BotSlot } from '@draconya/content';
import { ActionConfigModal } from './ActionConfigModal.js';
import { INITIAL_HUD, hud } from '../state/hud.js';
import type { Catalogue } from '../state/hud.js';
import { INITIAL_BOT, bot, edit } from '../bot/store.js';

// O modal de configuração de slot (AB-11/#426, redesenhado em #437 na régua da imagem do
// "Configurar ação" do cliente Tibia — anexa à issue #435, ADR 0033): abas, lista e painel de
// detalhe. `prerender` roda sem DOM: o que se prende é a ESTRUTURA — abas, lista com
// `aria-pressed`/`is-locked`, o painel de detalhe (`bot/action-detail.test.ts` prende a
// FORMATAÇÃO em separado) e o Salvar bloqueado com motivo. A ação é magia ou SUPRIMENTO abstrato.

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
    groups: ['potion', 'healing', 'attack'],
    spells: [
      {
        id: 'heal', name: 'Cura', manaCost: 20, minLevel: 1, vocationId: null,
        effect: 'heal', group: 'healing', cooldownMs: 1000, detail: { amount: 40 },
      },
      {
        id: 'advanced-spell', name: 'Magia Avançada', manaCost: 50, minLevel: 20, vocationId: null,
        effect: 'damage', group: 'attack', cooldownMs: 2000,
        detail: { basePower: 60, damageType: 'fire' },
      },
    ],
    supplies: [
      {
        id: 'health-potion', name: 'Poção de Vida', price: 20, effect: 'heal',
        group: 'potion', requires: {}, groupCooldownMs: 1000, detail: { amount: 150 },
      },
      {
        id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, effect: 'damage',
        group: 'attack', requires: { level: 25 }, groupCooldownMs: 2000,
        detail: {
          basePower: 60, range: 4, damageType: 'ice',
          area: { shape: 'circle', radius: 3, centered: 'target' },
        },
      },
    ],
    automations: [],
    spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
  },
});

const spellSlot = (over: Partial<BotSlot> = {}): BotSlot => ({
  do: { kind: 'spell', spellId: 'heal' }, when: [], auto: true, hotkey: 'F1', ...over,
});
const supplySlot = (over: Partial<BotSlot> = {}): BotSlot => ({
  do: { kind: 'supply', supplyId: 'health-potion' }, when: [], auto: true, ...over,
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

/** `true` quando a aba `label` (o texto do botão `role="tab"`) está `aria-selected="true"`. */
function tabSelected(html: string, label: string): boolean {
  const textAt = html.indexOf(`>${label}<`);
  const buttonAt = html.lastIndexOf('<button', textAt);
  return html.slice(buttonAt, textAt).includes('aria-selected="true"');
}

beforeEach(() => {
  hud.set(() => ({ ...INITIAL_HUD, catalogue: catalogue(), level: 10, skills: INITIAL_HUD.skills }));
  bot.set(() => INITIAL_BOT);
});

describe('ActionConfigModal — o cabeçalho', () => {
  it('mostra a faixa e a meta com o número REAL do slot', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    expect(html).toContain('CONFIGURAR AÇÃO · SLOT 1');
    expect(html).toContain('Barra de ações · slot 1');
  });

  it('oferece o Atalho do catálogo, com a opção sem tecla, e o interruptor automática', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    expect(html).toContain('F1');
    expect(html).toContain('sem tecla');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('automática');
  });
});

describe('ActionConfigModal — abas Magias/Runas/Itens (RF-03)', () => {
  it('as três abas existem como role="tab"', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    expect((html.match(/role="tab"/g) ?? []).length).toBe(3);
    expect(html).toContain('>Magias<');
    expect(html).toContain('>Runas<');
    expect(html).toContain('>Itens<');
  });

  it('slot de magia abre na aba Magias', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    expect(tabSelected(html, 'Magias')).toBe(true);
  });

  it('slot de suprimento de ataque (runa) abre na aba Runas', async () => {
    withSlot(0, supplySlot({ do: { kind: 'supply', supplyId: 'avalanche-rune' } }));
    const html = await render(0);
    expect(tabSelected(html, 'Runas')).toBe(true);
  });

  it('slot de suprimento sem grupo attack (poção) abre na aba Itens', async () => {
    withSlot(0, supplySlot());
    const html = await render(0);
    expect(tabSelected(html, 'Itens')).toBe(true);
  });

  it('slot vazio abre na aba Magias', async () => {
    const html = await render(6);
    expect(tabSelected(html, 'Magias')).toBe(true);
  });
});

describe('ActionConfigModal — a lista (RF-04)', () => {
  it('a ação do rascunho vem com aria-pressed="true", e só ela', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(1);
    const pressedAt = html.indexOf('aria-pressed="true"');
    const nextButtonEnd = html.indexOf('</button>', pressedAt);
    expect(html.slice(pressedAt, nextButtonEnd)).toContain('Cura');
  });

  it('entrada acima do level do personagem ganha is-locked mas continua no listbox', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    // Level do personagem é 10 (beforeEach); "Magia Avançada" exige 20.
    expect(html).toContain('is-locked');
    expect(html).toContain('Magia Avançada');
  });

  it('sem entrada acima do level, is-locked não aparece', async () => {
    hud.set((state) => ({ ...state, level: 99 }));
    withSlot(0, spellSlot());
    const html = await render(0);
    expect(html).not.toContain('is-locked');
  });
});

describe('ActionConfigModal — o painel de detalhe (RF-05/RF-06)', () => {
  it('mostra o título, o requisito Lv. X+ e as linhas do detalhe', async () => {
    withSlot(0, spellSlot());
    const html = await render(0);
    expect(html).toContain('Lv. 1+');
    expect(html).toContain('Cura');
    expect(html).toContain('20 mana');
    expect(html).toContain('1s');
  });

  it('slot vazio mostra "Escolha uma ação na lista."', async () => {
    const html = await render(6);
    expect(html).toContain('Escolha uma ação na lista.');
  });

  it('ação fora do catálogo (invariante 7) volta ao "Escolha uma ação na lista."', async () => {
    withSlot(0, spellSlot({ do: { kind: 'spell', spellId: 'gone-spell' } }));
    const html = await render(0);
    expect(html).toContain('Escolha uma ação na lista.');
    expect(html).not.toMatch(/aria-pressed="true"/);
  });
});

describe('ActionConfigModal — condições em E', () => {
  it('a lista de condições e o "+ Adicionar condição" aparecem', async () => {
    withSlot(0, spellSlot({ when: [{ kind: 'targets', op: '>=', count: 2 }] }));
    const html = await render(0);
    expect(html).toContain('+ Adicionar condição');
    expect(html).toContain('Todas as condições precisam bater');
  });
});

describe('ActionConfigModal — suprimento abstrato', () => {
  it('slot de suprimento mostra o custo em gold', async () => {
    withSlot(0, supplySlot());
    const html = await render(0);
    expect(html).toContain('Poção de Vida');
    expect(html).toContain('20 gold');
  });
});

describe('ActionConfigModal — o Salvar bloqueado tem motivo', () => {
  it('slot vazio: Salvar desabilitado com "Escolha uma ação."', async () => {
    const html = await render(6);
    expect(html).toContain('Escolha uma ação.');
    expect(html).toMatch(/disabled[^>]*>Salvar/);
  });

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

  it('slot preenchido oferece Limpar; o vazio não tem o que limpar', async () => {
    withSlot(0, spellSlot());
    expect(await render(0)).toContain('Limpar');
    expect(await render(6)).not.toContain('Limpar');
  });
});

describe('ActionConfigModal — sem catálogo (RF-09)', () => {
  it('diz Carregando… e não oferece lista de ação inventada', async () => {
    hud.set((state) => ({ ...state, catalogue: null }));
    const html = await render(0);
    expect(html).toContain('Carregando…');
    expect(html).not.toContain('ui-select');
  });
});

describe('ActionConfigModal — trocar de aba não limpa o rascunho (seção 7 da spec de #435)', () => {
  it('a aba escolhida é o único estado que a troca de Tabs altera (por fonte)', async () => {
    const source = await readFile(new URL('./ActionConfigModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onChange={(item) => { setPickedTab(item as ActionTab); }}');
    // A ação escolhida (`draft.do`) só muda ao clicar num item da LISTA, nunca ao trocar de aba.
    expect(source).not.toMatch(/onChange=\{[^}]*setDraft\(withDo\(draft, null\)\)/);
  });
});
