// O executor das cinco automações, com um atuador FALSO (AB-08).
//
// Nenhuma fixture de hunt aqui: a lógica pura se prova com um mapa slot→item e uma mochila em
// memória, e é por isso que `automation.ts` não conhece `Session` nem o ruleset.

import { describe, expect, it } from 'vitest';
import { botAutomationSchema } from '@draconya/content';
import type { BotAutomation, ItemSlot } from '@draconya/content';
import { compileAutomations } from './automation.js';
import type { AutomationActuator } from './automation.js';
import { CharacterRuntime } from './character.js';
import type { CarriedItem } from './inventory.js';
import type { BotView } from './bot.js';

const automation = (raw: unknown): BotAutomation => botAutomationSchema.parse(raw);

const view = (over: {
  health?: number; maxHealth?: number; mana?: number; maxMana?: number; targetCount?: number;
} = {}): BotView => ({
  self: new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: over.health ?? 100, maxHealth: over.maxHealth ?? 100,
    mana: over.mana ?? 100, maxMana: over.maxMana ?? 100,
    level: 1, xp: 0, vocationId: null, staminaMs: null, goldDelta: 0, alive: true, cooldowns: {},
  }),
  targetCount: over.targetCount ?? 0,
  target: null,
});

interface FakeOptions {
  readonly equipped?: Partial<Record<ItemSlot, string>>;
  readonly carried?: readonly string[];
  readonly slots?: Readonly<Record<string, ItemSlot>>;
  readonly twoHanded?: readonly string[];
  readonly refuseEquip?: readonly string[];
  /** A munição BÁSICA selecionada (abstrata, por família), se houver. */
  readonly selectedAmmo?: string;
  readonly refuseAmmo?: readonly string[];
}

/**
 * Um `Inventory` de mentira: mapa slot→item, mochila em memória e a mesma recusa `hands-full`
 * do inventário real (#152). Registra a ORDEM das operações, que é o que o swap de arma/escudo
 * precisa provar.
 */
function fake(options: FakeOptions = {}) {
  const slots = new Map<string, ItemSlot>(
    Object.entries(options.slots ?? {}) as [string, ItemSlot][],
  );
  const twoHanded = new Set(options.twoHanded ?? []);
  const refuse = new Set(options.refuseEquip ?? []);
  const refuseAmmo = new Set(options.refuseAmmo ?? []);
  const equipped = new Map<ItemSlot, CarriedItem>();
  const carried: CarriedItem[] = [];
  const log: string[] = [];
  let next = 0;
  let selectedAmmo = options.selectedAmmo ?? null;
  const newId = (itemId: string): string => `${itemId}#${next++}`;

  for (const [slot, itemId] of Object.entries(options.equipped ?? {}) as [ItemSlot, string][]) {
    equipped.set(slot, { instanceId: newId(itemId), itemId, quantity: 1 });
  }
  for (const itemId of options.carried ?? []) {
    carried.push({ instanceId: newId(itemId), itemId, quantity: 1 });
  }

  let ring: string | null = null;
  const actuator: AutomationActuator = {
    equippedItemId: (slot) => equipped.get(slot)?.itemId ?? null,
    equippedInstanceId: (slot) => equipped.get(slot)?.instanceId ?? null,
    carriedItem: (itemId) => carried.find((item) => item.itemId === itemId) ?? null,
    slotOf: (itemId) => slots.get(itemId) ?? null,
    equip: (instanceId) => {
      const index = carried.findIndex((item) => item.instanceId === instanceId);
      if (index < 0) return false;
      const item = carried[index] as CarriedItem;
      const slot = slots.get(item.itemId);
      if (slot === undefined || refuse.has(item.itemId)) return false;
      if (twoHanded.has(item.itemId) && equipped.has('shield')) return false;
      if (slot === 'shield') {
        const inHand = equipped.get('hand');
        if (inHand !== undefined && twoHanded.has(inHand.itemId)) return false;
      }
      const previous = equipped.get(slot) ?? null;
      equipped.set(slot, item);
      carried.splice(index, 1);
      if (previous !== null) carried.push(previous);
      log.push(`equip:${slot}:${item.itemId}`);
      return true;
    },
    unequip: (slot) => {
      const item = equipped.get(slot);
      if (item === undefined) return false;
      equipped.delete(slot);
      carried.push(item);
      log.push(`unequip:${slot}:${item.itemId}`);
      return true;
    },
    selectedAmmoId: () => selectedAmmo,
    selectAmmo: (ammoId) => {
      if (refuseAmmo.has(ammoId)) return false;
      selectedAmmo = ammoId;
      log.push(`select-ammo:${ammoId}`);
      return true;
    },
    rememberRing: (instanceId) => { ring = instanceId; },
    previousRing: () => ring,
  };

  return { actuator, equipped, carried, log };
}

describe('renew-ring e renew-amulet (ADR 0032 d.8)', () => {
  it('renova o anel quando o slot finger está vazio', () => {
    const { actuator } = fake({ carried: ['life-ring'], slots: { 'life-ring': 'finger' } });
    const [renew] = compileAutomations([
      automation({ model: 'renew-ring', params: { itemId: 'life-ring' } }),
    ]).list;

    expect(renew?.run(view(), actuator))
      .toEqual({ kind: 'applied', event: 'ring-equipped', detail: 'life-ring' });
    expect(actuator.equippedItemId('finger')).toBe('life-ring');
  });

  it('NÃO age com outro anel no dedo: o gatilho é o slot vazio, não o anel configurado', () => {
    const { actuator } = fake({
      equipped: { finger: 'other-ring' },
      carried: ['life-ring'],
      slots: { 'life-ring': 'finger' },
    });
    const [renew] = compileAutomations([
      automation({ model: 'renew-ring', params: { itemId: 'life-ring' } }),
    ]).list;

    expect(renew?.run(view(), actuator)).toEqual({ kind: 'idle' });
    expect(actuator.equippedItemId('finger')).toBe('other-ring');
  });

  it('renova o colar quando a carga esgotou e o slot neck está vazio', () => {
    const { actuator } = fake({
      carried: ['glacier-amulet'], slots: { 'glacier-amulet': 'neck' },
    });
    const [renew] = compileAutomations([
      automation({ model: 'renew-amulet', params: { itemId: 'glacier-amulet' } }),
    ]).list;

    expect(renew?.run(view(), actuator))
      .toEqual({ kind: 'applied', event: 'amulet-equipped', detail: 'glacier-amulet' });
    expect(actuator.equippedItemId('neck')).toBe('glacier-amulet');
  });
});

describe('swap-ammo-by-targets (ADR 0032 d.9)', () => {
  const swap = (over: Record<string, unknown>) => automation({
    model: 'swap-ammo-by-targets',
    params: { ammoA: 'burst-arrow', ammoB: 'arrow' },
    ...over,
  });

  it('≥ N alvos vai para A e abaixo volta para B', () => {
    const [run] = compileAutomations([swap({
      enter: [{ kind: 'targets', op: '>=', count: 3 }],
      exit: [{ kind: 'targets', op: '<', count: 3 }],
    })]).list;
    const { actuator } = fake({ selectedAmmo: 'arrow' });

    expect(run?.run(view({ targetCount: 3 }), actuator))
      .toEqual({ kind: 'applied', event: 'ammo-swapped', detail: 'burst-arrow' });
    expect(actuator.selectedAmmoId()).toBe('burst-arrow');
    expect(run?.run(view({ targetCount: 2 }), actuator))
      .toEqual({ kind: 'applied', event: 'ammo-swapped', detail: 'arrow' });
    expect(actuator.selectedAmmoId()).toBe('arrow');
  });

  it('entrada é OU: duas condições, uma verdadeira basta', () => {
    const [run] = compileAutomations([swap({
      enter: [{ kind: 'targets', op: '>=', count: 5 }, { kind: 'hp', op: '<', percent: 10 }],
      exit: [{ kind: 'targets', op: '<', count: 5 }, { kind: 'hp', op: '>', percent: 90 }],
    })]).list;
    const { actuator } = fake({ selectedAmmo: 'arrow' });

    // Sem alvos, mas com HP baixo: a segunda condição da entrada basta.
    expect(run?.run(view({ targetCount: 0, health: 5 }), actuator))
      .toMatchObject({ kind: 'applied', detail: 'burst-arrow' });
    // Saída é E: com alvos de volta, `targets < 5` é falso e NÃO sai, mesmo com HP alto.
    expect(run?.run(view({ targetCount: 6, health: 95 }), actuator)).toEqual({ kind: 'idle' });
    // As duas verdadeiras: sai.
    expect(run?.run(view({ targetCount: 4, health: 95 }), actuator))
      .toMatchObject({ kind: 'applied', detail: 'arrow' });
  });

  it('entrada vazia nunca entra e saída vazia nunca sai (DT-01)', () => {
    const [never] = compileAutomations([swap({
      enter: [], exit: [{ kind: 'targets', op: '<', count: 3 }],
    })]).list;
    const [stuck] = compileAutomations([swap({
      enter: [{ kind: 'targets', op: '>=', count: 3 }], exit: [],
    })]).list;

    const first = fake({ selectedAmmo: 'arrow' });
    expect(never?.run(view({ targetCount: 9 }), first.actuator)).toEqual({ kind: 'idle' });

    const second = fake({ selectedAmmo: 'arrow' });
    expect(stuck?.run(view({ targetCount: 3 }), second.actuator)).toMatchObject({ kind: 'applied' });
    expect(stuck?.run(view({ targetCount: 0 }), second.actuator)).toEqual({ kind: 'idle' });
    expect(second.actuator.selectedAmmoId()).toBe('burst-arrow');
  });

  it('munição indisponível vira `ammo-unavailable` e NÃO interrompe', () => {
    const [run] = compileAutomations([swap({
      enter: [{ kind: 'targets', op: '>=', count: 3 }],
      exit: [],
    })]).list;
    const { actuator } = fake({ selectedAmmo: 'arrow', refuseAmmo: ['burst-arrow'] });
    expect(run?.run(view({ targetCount: 3 }), actuator))
      .toEqual({ kind: 'blocked', reason: 'ammo-unavailable', itemId: 'burst-arrow' });
  });
});

describe('swap-weapon-shield-by-hp (ADR 0032 d.9)', () => {
  const slots = { 'spike-sword': 'hand', 'wooden-shield': 'shield', bow: 'hand' } as const;
  const [run] = compileAutomations([automation({
    model: 'swap-weapon-shield-by-hp',
    params: { oneHanded: 'spike-sword', shield: 'wooden-shield', twoHanded: 'bow' },
    enter: [{ kind: 'hp', op: '<', percent: 40 }],
    exit: [{ kind: 'hp', op: '>', percent: 70 }],
  })]).list;

  it('HP baixo veste uma mão + escudo desequipando ANTES (a ordem evita hands-full)', () => {
    const { actuator, log } = fake({
      equipped: { hand: 'bow' },
      carried: ['spike-sword', 'wooden-shield'],
      slots, twoHanded: ['bow'],
    });

    expect(run?.run(view({ health: 30 }), actuator))
      .toEqual({
        kind: 'applied', event: 'weapon-shield-swapped', detail: 'spike-sword+wooden-shield',
      });
    expect(actuator.equippedItemId('hand')).toBe('spike-sword');
    expect(actuator.equippedItemId('shield')).toBe('wooden-shield');
    expect(log).toEqual([
      'unequip:hand:bow', 'equip:hand:spike-sword', 'equip:shield:wooden-shield',
    ]);
  });

  it('HP alto volta para as duas mãos, na ordem inversa', () => {
    const { actuator, log } = fake({
      equipped: { hand: 'spike-sword', shield: 'wooden-shield' },
      carried: ['bow'], slots, twoHanded: ['bow'],
    });

    expect(run?.run(view({ health: 80 }), actuator))
      .toEqual({ kind: 'applied', event: 'weapon-shield-swapped', detail: 'bow' });
    expect(actuator.equippedItemId('hand')).toBe('bow');
    expect(actuator.equippedItemId('shield')).toBeNull();
    expect(log).toEqual([
      'unequip:shield:wooden-shield', 'unequip:hand:spike-sword', 'equip:hand:bow',
    ]);
  });
});

describe('swap-ring (ADR 0032 d.9, o ring swap do §13.8)', () => {
  const params = { itemId: 'life-ring', manaFloor: 30, restorePrevious: true };
  const ring = (over: Record<string, unknown> = {}) => automation({
    model: 'swap-ring',
    params: { ...params, ...over },
    enter: [{ kind: 'hp', op: '<', percent: 40 }, { kind: 'targets', op: '>=', count: 3 }],
    exit: [{ kind: 'hp', op: '>', percent: 70 }, { kind: 'targets', op: '<', count: 2 }],
  });
  const slots = { 'life-ring': 'finger', 'other-ring': 'finger' } as const;

  it('HP baixo equipa e guarda o anel anterior; HP alto devolve o anterior', () => {
    const [run] = compileAutomations([ring()]).list;
    const { actuator } = fake({
      equipped: { finger: 'other-ring' }, carried: ['life-ring'], slots,
    });

    expect(run?.run(view({ health: 30 }), actuator))
      .toEqual({ kind: 'applied', event: 'ring-equipped', detail: 'life-ring' });
    expect(actuator.previousRing()).not.toBeNull();
    expect(run?.run(view({ health: 80 }), actuator))
      .toEqual({ kind: 'applied', event: 'ring-removed', detail: '' });
    expect(actuator.equippedItemId('finger')).toBe('other-ring');
  });

  it('entra pelo segundo gatilho (≥ N alvos) e a saída em E segura com alvos', () => {
    const [run] = compileAutomations([ring()]).list;
    const { actuator } = fake({
      equipped: { finger: 'other-ring' }, carried: ['life-ring'], slots,
    });

    expect(run?.run(view({ health: 100, targetCount: 3 }), actuator))
      .toMatchObject({ kind: 'applied', detail: 'life-ring' });
    // HP alto, mas ainda há 3 alvos: `targets < 2` é falso, então a saída em E não dispara.
    expect(run?.run(view({ health: 95, targetCount: 3 }), actuator)).toEqual({ kind: 'idle' });
    expect(actuator.equippedItemId('finger')).toBe('life-ring');
  });

  it('mana abaixo do piso não equipa, e derruba o anel já equipado', () => {
    const [run] = compileAutomations([ring()]).list;
    const cold = fake({ carried: ['life-ring'], slots });
    expect(run?.run(view({ health: 30, mana: 10 }), cold.actuator)).toEqual({ kind: 'idle' });

    const wearing = fake({ equipped: { finger: 'life-ring' }, carried: [], slots });
    expect(run?.run(view({ health: 95, mana: 10 }), wearing.actuator))
      .toMatchObject({ kind: 'applied', event: 'ring-removed' });
    expect(wearing.actuator.equippedItemId('finger')).toBeNull();
  });

  it('restorePrevious: false deixa o dedo vazio ao sair', () => {
    const [run] = compileAutomations([ring({ restorePrevious: false })]).list;
    const { actuator } = fake({
      equipped: { finger: 'other-ring' }, carried: ['life-ring'], slots,
    });

    expect(run?.run(view({ health: 30 }), actuator)).toMatchObject({ kind: 'applied' });
    expect(run?.run(view({ health: 80 }), actuator)).toMatchObject({ kind: 'applied' });
    expect(actuator.equippedItemId('finger')).toBeNull();
  });
});

describe('desligada e item ausente (RF-08/RF-09)', () => {
  it('automação desligada não vira executor', () => {
    const compiled = compileAutomations([
      automation({ model: 'renew-ring', params: { itemId: 'life-ring' }, enabled: false }),
    ]);
    expect(compiled.list).toHaveLength(0);
  });

  it('item ausente informa o motivo e NÃO interrompe a automação seguinte', () => {
    const compiled = compileAutomations([
      automation({ model: 'renew-ring', params: { itemId: 'life-ring' } }),
      automation({ model: 'renew-amulet', params: { itemId: 'glacier-amulet' } }),
    ]);
    const { actuator } = fake({
      carried: ['glacier-amulet'], slots: { 'glacier-amulet': 'neck' },
    });

    const outcomes = compiled.list.map((item) => item.run(view(), actuator));
    expect(outcomes[0])
      .toEqual({ kind: 'blocked', reason: 'missing-item', itemId: 'life-ring' });
    expect(outcomes[1]).toMatchObject({ kind: 'applied', detail: 'glacier-amulet' });
  });

  it('equip recusado vira `not-equippable`', () => {
    const [run] = compileAutomations([
      automation({ model: 'renew-ring', params: { itemId: 'life-ring' } }),
    ]).list;
    const { actuator } = fake({
      carried: ['life-ring'], slots: { 'life-ring': 'finger' }, refuseEquip: ['life-ring'],
    });
    expect(run?.run(view(), actuator))
      .toEqual({ kind: 'blocked', reason: 'not-equippable', itemId: 'life-ring' });
  });
});
