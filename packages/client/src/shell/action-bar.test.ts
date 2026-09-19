import { describe, expect, it } from 'vitest';
import type { BotConfigV2, BotSlot } from '@draconya/content';
import type { Catalogue, Inventory, SlotState } from '../state/hud.js';
import {
  hotkeyForKey, lureCaption, policyLabel, slotForHotkey, slotKey, slotTitle, slotView,
} from './action-bar.js';

// O view-model da barra é PURO (DT-03): nada de DOM, nada de store — o que os testes prendem é
// a decisão. A fiação (clique/teclado) é presa por inspeção de fonte em `ActionBar.test.ts`.

const catalogue = (over: Partial<Catalogue> = {}): Catalogue => ({
  hunts: [],
  monsters: [],
  items: [{
    id: 'health-potion', name: 'Poção de Vida', appearanceId: 266, weight: 2.7,
    slot: null, twoHanded: false, kind: 'consumable', shortLabel: 'HP', group: 'potion',
  }],
  vocations: [],
  vocationLevel: 0,
  bot: {
    vocabularyVersion: 2,
    setCount: 4,
    slotsPerSet: 24,
    setNames: ['Energia', 'Fogo', 'Gelo', 'Sagrado'],
    hotkeys: ['1', 'F1'],
    groups: ['potion', 'attack'],
    spells: [{
      id: 'heal', name: 'Cura', manaCost: 20, minLevel: 1, vocationId: null,
      effect: 'heal', group: 'healing',
    }],
    automations: [],
  },
  ...over,
});

const inventory = (): Inventory => ({
  backpack: [{ instanceId: 'i1', itemId: 'health-potion', quantity: 5 }],
  satchel: [{ instanceId: 'i2', itemId: 'health-potion', quantity: 3 }],
  equipped: {},
  capacity: { used: 0, total: 100 },
});

const spellSlot = (over: Partial<BotSlot> = {}): BotSlot => ({
  do: { kind: 'spell', spellId: 'heal' }, when: [], auto: true, hotkey: '1', ...over,
});
const itemSlot = (over: Partial<BotSlot> = {}): BotSlot => ({
  do: { kind: 'item', itemId: 'health-potion' }, when: [], auto: true, ...over,
});

function setsWith(slot: BotSlot | null, set = 0, index = 0): BotConfigV2['sets'] {
  return Array.from({ length: 4 }, (_, s) => ({
    slots: Array.from({ length: 24 }, (_, i) => (s === set && i === index ? slot : null)),
  }));
}

describe('slotForHotkey', () => {
  it('mapeia Digit1..Digit0 e F1..F12 para a tecla do conteúdo', () => {
    expect(hotkeyForKey('Digit1')).toBe('1');
    expect(hotkeyForKey('Digit0')).toBe('0');
    expect(hotkeyForKey('F1')).toBe('F1');
    expect(hotkeyForKey('F12')).toBe('F12');
    expect(hotkeyForKey('KeyA')).toBeNull();
    expect(hotkeyForKey('Enter')).toBeNull();
  });

  it('devolve o slot do conjunto ATIVO cuja tecla bate', () => {
    const sets = setsWith(spellSlot({ hotkey: 'F1' }), 1, 7);
    expect(slotForHotkey(sets, 1, 'F1')).toEqual({ set: 1, slot: 7 });
    // O mesmo conjunto não tem `Digit1`: a tecla não dispara nada.
    expect(slotForHotkey(sets, 1, 'Digit1')).toBeNull();
  });

  it('tecla fora do vocabulário ou conjunto inexistente devolve null', () => {
    const sets = setsWith(spellSlot({ hotkey: '1' }));
    expect(slotForHotkey(sets, 0, 'KeyZ')).toBeNull();
    expect(slotForHotkey(sets, 9, 'Digit1')).toBeNull();
  });

  it('slot sem tecla não responde a tecla nenhuma', () => {
    const sets = setsWith({ do: { kind: 'spell', spellId: 'heal' }, when: [], auto: true });
    expect(slotForHotkey(sets, 0, 'Digit1')).toBeNull();
  });

  it('slotKey é a chave canônica `${set}:${slot}`', () => {
    expect(slotKey(2, 13)).toBe('2:13');
  });
});

describe('slotView', () => {
  it('slot nulo é vazio: null, nada inventado', () => {
    expect(slotView(null, catalogue(), inventory(), null)).toBeNull();
  });

  it('magia: rótulo do catálogo e sem contagem', () => {
    const view = slotView(spellSlot(), catalogue(), inventory(), null);
    expect(view).toMatchObject({ label: 'Cura', hotkey: '1', count: undefined, cooldownMs: 0, blocked: false });
    // O catálogo v2 não carrega elemento — nada de cor inventada.
    expect(view?.element).toBeUndefined();
  });

  it('item: rótulo curto e a contagem somada do inventário (mochila + bolsa)', () => {
    const view = slotView(itemSlot(), catalogue(), inventory(), null);
    expect(view).toMatchObject({ label: 'HP', count: 8 });
  });

  it('item fora do inventário: contagem undefined, nunca 0 presumido', () => {
    const empty: Inventory = { backpack: [], satchel: [], equipped: {}, capacity: { used: 0, total: 100 } };
    expect(slotView(itemSlot(), catalogue(), empty, null)?.count).toBeUndefined();
  });

  it('cooldown e bloqueio vêm do slot-state', () => {
    const state: SlotState = { set: 0, slot: 0, state: 'cooldown', remainingMs: 1500 };
    const view = slotView(spellSlot(), catalogue(), inventory(), state);
    expect(view?.cooldownMs).toBe(1500);
    expect(view?.blocked).toBe(false);
    expect(slotView(spellSlot(), catalogue(), inventory(), { set: 0, slot: 0, state: 'blocked', remainingMs: 0 })?.blocked)
      .toBe(true);
  });
});

describe('slotTitle', () => {
  it('inclui o motivo do servidor quando veio, e o limpa quando null', () => {
    const view = slotView(spellSlot(), catalogue(), inventory(), null);
    expect(view).not.toBeNull();
    expect(slotTitle(view!, 'Sem mana.')).toContain('Sem mana.');
    expect(slotTitle(view!, null)).not.toContain('Sem mana.');
  });

  it('mostra o cooldown restante e o bloqueio', () => {
    const view = slotView(spellSlot(), catalogue(), inventory(), { set: 0, slot: 0, state: 'blocked', remainingMs: 0 });
    expect(slotTitle(view!, 'sem estoque')).toContain('bloqueado');
    expect(slotTitle(view!, null)).toContain('Cura');
  });
});

describe('lureCaption', () => {
  it('sem lure usa o default do kit (MIN 4 · MAX 8) e a postura', () => {
    expect(lureCaption(undefined, { kind: 'stand' })).toBe('MIN 4 · MAX 8 · PARADO NA ROTA');
    expect(lureCaption(undefined, { kind: 'follow' })).toBe('MIN 4 · MAX 8 · SEGUIR ALVO');
  });

  it('com lure usa os números do jogador e a postura de distância', () => {
    expect(lureCaption({ min: 2, max: 6 }, { kind: 'keep-distance', tiles: 3 }))
      .toBe('MIN 2 · MAX 6 · MANTER DISTÂNCIA');
  });
});

describe('policyLabel', () => {
  it('nomeia a política, e o follow usa o alvo vivo quando o servidor disse qual é', () => {
    expect(policyLabel('nearest', null)).toBe('Mais próximo');
    expect(policyLabel('lowest-hp', null)).toBe('Menor HP');
    expect(policyLabel('follow', null)).toBe('Seguir alvo');
    expect(policyLabel('follow', 'Dragon')).toBe('Seguir Dragon');
  });
});
