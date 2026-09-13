import { describe, expect, it } from 'vitest';
import { clickIntent, dropIntent, parsePlace, serializePlace } from './drag-intent.js';
import type { Inventory } from '../state/hud.js';

// A decisão de qual intenção um gesto manda (#161). Os seis pares, a origem vazia, o mesmo
// lugar — e nada de validação de jogo aqui (invariante 4): quem decide se cabe é o servidor.

const sword = { instanceId: 's1', itemId: 'sword', quantity: 1 };
const rock = { instanceId: 'r1', itemId: 'rock', quantity: 1 };
const inventory: Inventory = {
  backpack: [sword, null, rock],
  satchel: [null, rock],
  equipped: { hand: { instanceId: 'h1', itemId: 'machete', quantity: 1 } },
  capacity: { used: 10, total: 400 },
};

describe('dropIntent', () => {
  it('place → place is move-item, place → slot is equip, slot → place is move-item from the slot', () => {
    expect(dropIntent({ container: 'backpack', index: 0 }, { container: 'satchel', index: 0 }, inventory))
      .toEqual({ type: 'move-item', from: { container: 'backpack', index: 0 }, to: { container: 'satchel', index: 0 } });
    expect(dropIntent({ container: 'backpack', index: 0 }, { slot: 'hand' }, inventory))
      .toEqual({ type: 'equip', instanceId: 's1' });
    expect(dropIntent({ slot: 'hand' }, { container: 'backpack', index: 1 }, inventory))
      .toEqual({ type: 'move-item', from: { slot: 'hand' }, to: { container: 'backpack', index: 1 } });
    // Um item que não veste ainda manda `equip`: a recusa é do servidor, não da tela.
    expect(dropIntent({ container: 'backpack', index: 2 }, { slot: 'head' }, inventory))
      .toEqual({ type: 'equip', instanceId: 'r1' });
  });

  it('sends nothing for an empty origin, the same place, slot → slot, or an empty slot', () => {
    expect(dropIntent({ container: 'backpack', index: 1 }, { container: 'satchel', index: 0 }, inventory)).toBeNull();
    expect(dropIntent({ container: 'backpack', index: 0 }, { container: 'backpack', index: 0 }, inventory)).toBeNull();
    expect(dropIntent({ slot: 'hand' }, { slot: 'head' }, inventory)).toBeNull();
    expect(dropIntent({ slot: 'head' }, { container: 'backpack', index: 1 }, inventory)).toBeNull();
    expect(dropIntent({ container: 'backpack', index: 99 }, { slot: 'hand' }, inventory)).toBeNull();
  });
});

describe('clickIntent', () => {
  it('a place equips, a slot unequips, empty is nothing', () => {
    expect(clickIntent({ container: 'backpack', index: 0 }, inventory)).toEqual({ type: 'equip', instanceId: 's1' });
    expect(clickIntent({ slot: 'hand' }, inventory)).toEqual({ type: 'unequip', slot: 'hand' });
    expect(clickIntent({ container: 'backpack', index: 1 }, inventory)).toBeNull();
    expect(clickIntent({ slot: 'head' }, inventory)).toBeNull();
  });
});

describe('the dataTransfer payload', () => {
  it('round trips a place and never carries the item', () => {
    for (const place of [{ container: 'backpack' as const, index: 7 }, { container: 'satchel' as const, index: 0 }, { slot: 'hand' }]) {
      const text = serializePlace(place);
      expect(text).not.toContain('instanceId');
      expect(parsePlace(text)).toEqual(place);
    }
    expect(parsePlace('chest:1')).toBeNull();
    expect(parsePlace('backpack:-1')).toBeNull();
    expect(parsePlace('backpack:x')).toBeNull();
    expect(parsePlace('slot:')).toBeNull();
    expect(parsePlace('')).toBeNull();
  });
});
