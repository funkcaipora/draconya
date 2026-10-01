// A compra mínima por gold na Cidade (#631, ADR 0059 d.2): só `purchasable`, ao `buyPrice`, uma
// unidade na mochila, e a conferência inteira vem ANTES de mexer em gold ou inventário.

import type { Item } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import type { CharacterState } from './character.js';
import type { ContainerRules } from './inventory.js';
import { buyItem } from './purchase.js';

const item = (over: Record<string, unknown> = {}): Item => ({
  id: 'exercise-sword', name: 'exercise sword', kind: 'other', weight: 10, value: 0, stackable: false,
  twoHanded: false, charges: 500, exercise: { skillId: 'sword' }, purchasable: true, buyPrice: 347_222,
  ...over,
}) as unknown as Item;

const rules: ContainerRules = { backpackSlots: 20, satchelSlots: 10, row: 4 };

const hero = (over: Partial<CharacterState> = {}): CharacterRuntime => new CharacterRuntime({
  id: 'hero', position: { x: 1, y: 1, z: 7 }, health: 150, maxHealth: 150, mana: 55, maxMana: 55,
  level: 20, xp: 0, gold: 1_000_000, goldDelta: 0, alive: true, cooldowns: {}, capacity: 400,
  inventory: { backpack: [], equipped: {} },
  ...over,
});

const catalogOf = (...items: Item[]): ReadonlyMap<string, Item> => new Map(items.map((entry) => [entry.id, entry]));

describe('buyItem (#631, ADR 0059 d.2)', () => {
  it('debita o buyPrice em goldDelta e põe UMA instância nova, de origem `purchase`, na mochila', () => {
    const sword = item();
    const character = hero();
    const result = buyItem(character, sword, { catalog: catalogOf(sword), rules, instanceId: 'city:hero:buy:1' });
    expect(result).toEqual({ ok: true, instanceId: 'city:hero:buy:1', price: 347_222 });
    expect(character.goldDelta).toBe(-347_222);
    expect(character.inventory.carried('city:hero:buy:1')).toMatchObject({
      itemId: 'exercise-sword', quantity: 1, origin: 'purchase',
    });
    // A arma nova é "cheia": nenhum overlay de cargas (ausente é o total da definição).
    expect(character.inventory.carried('city:hero:buy:1')?.overlay).toBeUndefined();
  });

  it('o saldo é `gold + goldDelta`: um gasto anterior da mesma sessão já baixou o que sobra', () => {
    const sword = item({ buyPrice: 600_000 });
    const character = hero({ gold: 1_000_000, goldDelta: -500_000 });
    const result = buyItem(character, sword, { catalog: catalogOf(sword), rules, instanceId: 'a' });
    expect(result).toEqual({ ok: false, reason: 'not-enough-gold' });
    expect(character.goldDelta).toBe(-500_000);
    expect(character.inventory.carried('a')).toBeNull();
  });

  it('gold exato basta (não é estritamente maior), e zera o saldo', () => {
    const sword = item({ buyPrice: 1_000_000 });
    const character = hero({ gold: 1_000_000 });
    expect(buyItem(character, sword, { catalog: catalogOf(sword), rules, instanceId: 'a' }).ok).toBe(true);
    expect(character.gold + character.goldDelta).toBe(0);
  });

  it('item que não é purchasable — ou nem existe — não está à venda', () => {
    const rock = item({ id: 'rock', purchasable: undefined, buyPrice: undefined });
    const character = hero();
    expect(buyItem(character, rock, { catalog: catalogOf(rock), rules, instanceId: 'a' }))
      .toEqual({ ok: false, reason: 'not-for-sale' });
    expect(buyItem(character, undefined, { catalog: catalogOf(), rules, instanceId: 'a' }))
      .toEqual({ ok: false, reason: 'not-for-sale' });
    expect(character.goldDelta).toBe(0);
  });

  it('o peso que não cabe recusa a compra INTEIRA — nem gold nem item mudam', () => {
    const heavy = item({ weight: 401 });
    const character = hero({ capacity: 400 });
    const result = buyItem(character, heavy, { catalog: catalogOf(heavy), rules, instanceId: 'a' });
    expect(result).toEqual({ ok: false, reason: 'over-capacity' });
    expect(character.goldDelta).toBe(0);
    expect(character.inventory.carried('a')).toBeNull();
  });

  it('duas compras são duas identidades — não empilham, mesmo sendo o mesmo item', () => {
    const sword = item({ buyPrice: 100 });
    const character = hero();
    buyItem(character, sword, { catalog: catalogOf(sword), rules, instanceId: 'a' });
    buyItem(character, sword, { catalog: catalogOf(sword), rules, instanceId: 'b' });
    expect(character.inventory.carried('a')?.quantity).toBe(1);
    expect(character.inventory.carried('b')?.quantity).toBe(1);
    expect(character.goldDelta).toBe(-200);
  });
});
