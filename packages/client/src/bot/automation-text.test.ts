import { describe, expect, it } from 'vitest';
import type { BotAutomation } from '@draconya/content';
import type { AmmoDefinition, ItemDefinition } from '../state/hud.js';
import {
  MODEL_SUBTITLE, ammoName, automationProblem, automationSummary, blankAutomation,
  conditionSummary, itemName, itemsForParam,
} from './automation-text.js';

// O texto derivado das automações (AB-12, #427). Teste PURO: nada de React nem de store — prende
// o resumo gerado dos parâmetros, o nome do item/munição e a faixa morta que bloqueia o Salvar.

function item(over: Partial<ItemDefinition> & { id: string; name: string }): ItemDefinition {
  return { appearanceId: 1, weight: 1, slot: null, twoHanded: false, ...over };
}

function ammo(over: Partial<AmmoDefinition> & { id: string; name: string; family: string }): AmmoDefinition {
  return { attack: 20, price: 1, appearanceId: 1, requires: {}, ...over };
}

const ITEMS: readonly ItemDefinition[] = [
  item({ id: 'life-ring', name: 'Life Ring', slot: 'finger', kind: 'ring' }),
  item({ id: 'energy-ring', name: 'Energy Ring', slot: 'finger', kind: 'ring' }),
  item({ id: 'glacier-amulet', name: 'Glacier Amulet', slot: 'neck', kind: 'amulet' }),
  item({ id: 'steel-axe', name: 'Steel Axe', slot: 'hand', kind: 'weapon' }),
  item({ id: 'spike-sword', name: 'Spike Sword', slot: 'hand', kind: 'weapon', twoHanded: true }),
  item({ id: 'wooden-shield', name: 'Wooden Shield', slot: 'shield', kind: 'shield' }),
];

const AMMUNITION: readonly AmmoDefinition[] = [
  ammo({ id: 'arrow', name: 'Arrow', family: 'arrow' }),
  ammo({ id: 'burst-arrow', name: 'Burst Arrow', family: 'arrow', price: 5 }),
  ammo({ id: 'onyx-arrow', name: 'Onyx Arrow', family: 'arrow', price: 10 }),
  ammo({ id: 'bolt', name: 'Bolt', family: 'bolt' }),
];

const ammoAutomation: BotAutomation = {
  model: 'swap-ammo-by-targets',
  params: { ammoA: 'burst-arrow', ammoB: 'arrow' },
  enter: [{ kind: 'targets', op: '>=', count: 3 }],
  exit: [{ kind: 'targets', op: '<', count: 3 }],
};

const weaponShield: BotAutomation = {
  model: 'swap-weapon-shield-by-hp',
  params: { oneHanded: 'steel-axe', shield: 'wooden-shield', twoHanded: 'spike-sword' },
  enter: [{ kind: 'hp', op: '<', percent: 50 }],
  exit: [{ kind: 'hp', op: '>', percent: 80 }],
};

describe('conditionSummary — a forma humana da condição, por extenso (#437, RF-07)', () => {
  it('escreve HP, mana, alvos e vida do alvo com o operador por extenso', () => {
    expect(conditionSummary({ kind: 'hp', op: '<', percent: 50 })).toBe('HP menor que 50 %');
    expect(conditionSummary({ kind: 'mana', op: '>=', percent: 20 })).toBe('Mana maior ou igual a 20 %');
    expect(conditionSummary({ kind: 'targets', op: '>=', count: 3 })).toBe('alvos maior ou igual a 3');
    expect(conditionSummary({ kind: 'target-hp', op: '>', percent: 30 }))
      .toBe('Vida do alvo maior que 30 %');
  });
});

describe('automationSummary — derivado dos parâmetros (RF-03)', () => {
  it('swap-ammo-by-targets resolve a MUNIÇÃO pelo catálogo, não por texto fixo', () => {
    expect(automationSummary(ammoAutomation, ITEMS, AMMUNITION))
      .toBe('alvos maior ou igual a 3 → Burst Arrow · senão Arrow');
  });

  it('swap-weapon-shield-by-hp mostra o set defensivo e o ofensivo', () => {
    expect(automationSummary(weaponShield, ITEMS, AMMUNITION))
      .toBe('HP menor que 50 % → Escudo + Steel Axe · HP maior que 80 % → Spike Sword');
  });

  it('trocar a munição muda o resumo; id fora do catálogo sai cru, nunca inventado', () => {
    const changed: BotAutomation = { ...ammoAutomation, params: { ammoA: 'onyx-arrow', ammoB: 'arrow' } };
    expect(automationSummary(changed, ITEMS, AMMUNITION)).toContain('Onyx Arrow');
    expect(ammoName('gone-arrow', AMMUNITION)).toBe('gone-arrow');
  });

  it('renew-ring/amulet resumem o "quando acabar" — o item está no modal', () => {
    const ring: BotAutomation = {
      model: 'renew-ring', params: { itemId: 'life-ring' }, enter: [], exit: [],
    };
    expect(automationSummary(ring, ITEMS, AMMUNITION)).toBe('quando acabar');
  });
});

describe('blankAutomation — o rascunho novo de cada modelo (RF-04)', () => {
  it('preenche cada modelo com o primeiro id do catálogo exigido', () => {
    expect(blankAutomation('renew-ring', ITEMS, AMMUNITION)).toMatchObject({
      model: 'renew-ring', params: { itemId: 'life-ring' }, enter: [], exit: [],
    });
    expect(blankAutomation('renew-amulet', ITEMS, AMMUNITION)).toMatchObject({
      model: 'renew-amulet', params: { itemId: 'glacier-amulet' },
    });
    expect(blankAutomation('swap-ammo-by-targets', ITEMS, AMMUNITION)).toMatchObject({
      params: { ammoA: 'arrow', ammoB: 'burst-arrow' },
    });
    expect(blankAutomation('swap-weapon-shield-by-hp', ITEMS, AMMUNITION)).toMatchObject({
      params: { oneHanded: 'steel-axe', shield: 'wooden-shield', twoHanded: 'spike-sword' },
    });
    expect(blankAutomation('swap-ring', ITEMS, AMMUNITION)).toMatchObject({
      params: { itemId: 'life-ring', manaFloor: 0, restorePrevious: true },
    });
  });

  it('devolve null quando falta o id exigido — nunca um rascunho com id vazio', () => {
    const noShield = ITEMS.filter((entry) => entry.slot !== 'shield');
    expect(blankAutomation('swap-weapon-shield-by-hp', noShield, AMMUNITION)).toBeNull();
    const noFinger = ITEMS.filter((entry) => entry.slot !== 'finger');
    expect(blankAutomation('renew-ring', noFinger, AMMUNITION)).toBeNull();
    expect(blankAutomation('swap-ring', noFinger, AMMUNITION)).toBeNull();
    expect(blankAutomation('swap-ammo-by-targets', ITEMS, [])).toBeNull();
  });

  it('itemsForParam separa anel de colar, escudo e as duas mãos (a munição não passa aqui)', () => {
    expect(itemsForParam('renew-ring', 'itemId', ITEMS).map((i) => i.id)).toEqual(['life-ring', 'energy-ring']);
    expect(itemsForParam('renew-amulet', 'itemId', ITEMS).map((i) => i.id)).toEqual(['glacier-amulet']);
    expect(itemsForParam('swap-weapon-shield-by-hp', 'oneHanded', ITEMS).map((i) => i.id)).toEqual(['steel-axe']);
    expect(itemsForParam('swap-weapon-shield-by-hp', 'twoHanded', ITEMS).map((i) => i.id)).toEqual(['spike-sword']);
    expect(itemName('life-ring', ITEMS)).toBe('Life Ring');
  });
});

describe('automationProblem — a faixa morta bloqueia o Salvar (RF-09)', () => {
  it('swap-ring com saída de HP menor que a entrada tem motivo', () => {
    const ring: BotAutomation = {
      model: 'swap-ring',
      params: { itemId: 'life-ring', manaFloor: 0, restorePrevious: true },
      enter: [{ kind: 'hp', op: '<', percent: 50 }],
      exit: [{ kind: 'hp', op: '>', percent: 40 }],
    };
    expect(automationProblem(ring, ITEMS, AMMUNITION)).toContain('faixa morta');
  });

  it('saída maior que a entrada é válida', () => {
    const ring: BotAutomation = {
      model: 'swap-ring',
      params: { itemId: 'life-ring', manaFloor: 0, restorePrevious: true },
      enter: [{ kind: 'hp', op: '<', percent: 50 }],
      exit: [{ kind: 'hp', op: '>', percent: 80 }],
    };
    expect(automationProblem(ring, ITEMS, AMMUNITION)).toBeNull();
  });

  it('renew-ring sem condição é válido (o gatilho é o slot vazio)', () => {
    const ring: BotAutomation = {
      model: 'renew-ring', params: { itemId: 'life-ring' }, enter: [], exit: [],
    };
    expect(automationProblem(ring, ITEMS, AMMUNITION)).toBeNull();
  });

  it('item fora do catálogo bloqueia com o id cru', () => {
    const gone: BotAutomation = {
      model: 'renew-ring', params: { itemId: 'ring-that-left' }, enter: [], exit: [],
    };
    expect(automationProblem(gone, ITEMS, AMMUNITION)).toContain('ring-that-left');
  });

  it('munição fora do catálogo bloqueia com o id cru', () => {
    const gone: BotAutomation = {
      ...ammoAutomation, params: { ammoA: 'gone-arrow', ammoB: 'arrow' },
    };
    expect(automationProblem(gone, ITEMS, AMMUNITION)).toContain('gone-arrow');
  });
});

describe('MODEL_SUBTITLE — decoração sem o mock do kit (RF-05)', () => {
  it('não tem "Comer comida" nem "LV 50"', () => {
    const values = Object.values(MODEL_SUBTITLE);
    expect(values).not.toContain('Comer comida');
    expect(values.some((value) => value?.includes('LV 50'))).toBe(false);
    expect((MODEL_SUBTITLE as Record<string, string | undefined>)['comer-comida']).toBeUndefined();
  });
});
