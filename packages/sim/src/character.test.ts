import { describe, expect, it } from 'vitest';
import { itemSchema } from '@draconya/content';
import type { Item, Vocation } from '@draconya/content';
import { CharacterRuntime } from './character.js';
import type { CharacterState, VocationChoiceOptions } from './character.js';

// A escolha de vocação (#154, ADR 0026 decisão 1): o portão, a arma, e o que sobrevive ao
// snapshot. Os stats NÃO mudam aqui — a tabela da vocação vale do próximo level em diante,
// e isso é `progression.test.ts`.

const define = (over: Record<string, unknown>): Item => ({
  ...itemSchema.parse({ id: 'x', name: 'X', kind: 'other', weight: 10, ...over }),
  appearanceId: 1,
});

const catalog = new Map<string, Item>([
  ['machete', define({ id: 'machete', kind: 'weapon', slot: 'hand', weight: 16.5, attack: 12 })],
  ['steel-axe', define({
    id: 'steel-axe', kind: 'weapon', slot: 'hand', weight: 41, attack: 21, requires: { vocationId: 'knight' },
  })],
  ['bow', define({
    id: 'bow', kind: 'weapon', slot: 'hand', weight: 31, twoHanded: true,
    weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' }, requires: { vocationId: 'paladin' },
  })],
  ['shield', define({ id: 'shield', kind: 'shield', slot: 'shield', weight: 40 })],
]);

const knight: Vocation = {
  id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25,
  startingWeaponItemId: 'steel-axe', spellSkill: 'magic',
};
const paladin: Vocation = { ...knight, id: 'paladin', name: 'Paladin', startingWeaponItemId: 'bow' };

const options = (over: Partial<VocationChoiceOptions> = {}): VocationChoiceOptions => ({
  catalog, vocationLevel: 8, instanceId: 'city-1:hero:vocation', ...over,
});

const state = (over: Partial<CharacterState> = {}): CharacterState => ({
  id: 'hero', position: { x: 0, y: 0, z: 7 },
  health: 150, maxHealth: 150, mana: 20, maxMana: 20,
  level: 8, xp: 0, goldDelta: 0, alive: true, capacity: 400,
  inventory: {
    backpack: [],
    equipped: { hand: { instanceId: 'hero:kit:1', itemId: 'machete', quantity: 1 } },
  },
  cooldowns: {},
  ...over,
});

describe('chooseVocation', () => {
  it('refuses below the vocation level, and refuses a second choice', () => {
    // Mutação que mata: trocar `<` por `<=` no portão de level (o 8 passaria a ser recusado).
    const young = new CharacterRuntime(state({ level: 7 }));
    expect(young.chooseVocation(knight, catalog.get('steel-axe') ?? null, options()))
      .toEqual({ ok: false, reason: 'level-too-low' });
    expect(young.vocationId).toBeNull();

    const hero = new CharacterRuntime(state());
    expect(hero.chooseVocation(knight, catalog.get('steel-axe') ?? null, options()).ok).toBe(true);
    expect(hero.chooseVocation(paladin, catalog.get('bow') ?? null, options())).toEqual({ ok: false, reason: 'already-chosen' });
    expect(hero.vocationId).toBe('knight');
  });

  it('puts the weapon in the hand and the machete back in the backpack, with the origin', () => {
    const hero = new CharacterRuntime(state());
    const result = hero.chooseVocation(knight, catalog.get('steel-axe') ?? null, options());
    expect(result).toEqual({ ok: true, weapon: 'equipped' });
    expect(hero.inventory.equippedAt('hand')).toEqual({
      instanceId: 'city-1:hero:vocation', itemId: 'steel-axe', quantity: 1, origin: 'vocation-choice',
    });
    expect(hero.inventory.backpack.map((item) => item.itemId)).toEqual(['machete']);
  });

  it('keeps the choice when the weapon does not fit the capacity: it goes to the loot box', () => {
    // A vocação não pode ser punida pela mochila. Mutação que mata: devolver `ok: false`
    // quando `add` recusa por peso.
    const heavy = new CharacterRuntime(state({ capacity: 20 }));
    const result = heavy.chooseVocation(knight, catalog.get('steel-axe') ?? null, options());
    expect(result).toEqual({ ok: true, weapon: 'in-loot-box' });
    expect(heavy.vocationId).toBe('knight');
    expect(heavy.lootBox.map((item) => item.itemId)).toEqual(['steel-axe']);
    expect(heavy.inventory.equippedAt('hand')?.itemId).toBe('machete');
  });

  it('leaves the bow in the backpack when a shield is worn (hands-full), and the choice still holds', () => {
    const shielded = new CharacterRuntime(state({
      inventory: {
        backpack: [],
        equipped: {
          hand: { instanceId: 'hero:kit:1', itemId: 'machete', quantity: 1 },
          shield: { instanceId: 'hero:shield', itemId: 'shield', quantity: 1 },
        },
      },
    }));
    const result = shielded.chooseVocation(paladin, catalog.get('bow') ?? null, options());
    expect(result).toEqual({ ok: true, weapon: 'in-backpack' });
    expect(shielded.vocationId).toBe('paladin');
    expect(shielded.inventory.backpack.map((item) => item.itemId)).toEqual(['bow']);
  });

  it('accepts a vocation without a starting weapon (test content)', () => {
    const hero = new CharacterRuntime(state());
    expect(hero.chooseVocation({ ...knight, startingWeaponItemId: undefined }, null, options()))
      .toEqual({ ok: true, weapon: 'none' });
    expect(hero.inventory.equippedAt('hand')?.itemId).toBe('machete');
  });

  it('survives the snapshot round trip: vocation and origin come back', () => {
    const hero = new CharacterRuntime(state());
    hero.chooseVocation(knight, catalog.get('steel-axe') ?? null, options());
    const restored = new CharacterRuntime(JSON.parse(JSON.stringify(hero.getState())) as CharacterState);
    expect(restored.vocationId).toBe('knight');
    expect(restored.inventory.equippedAt('hand')?.origin).toBe('vocation-choice');
    // E o snapshot anterior a #154 — sem `origin` — continua legível: ausente é loot.
    expect(restored.inventory.backpack[0]?.origin).toBeUndefined();
  });
});
