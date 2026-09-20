import { describe, expect, it } from 'vitest';
import { compileItem, itemSchema } from '@draconya/content';
import type { Item, Vocation } from '@draconya/content';
import { CharacterRuntime } from './character.js';
import type { CharacterState, VocationChoiceOptions } from './character.js';

// A escolha de vocação (#154, ADR 0026 decisão 1): o portão, a arma, e o que sobrevive ao
// snapshot. Os stats NÃO mudam aqui — a tabela da vocação vale do próximo level em diante,
// e isso é `progression.test.ts`.

const define = (over: Record<string, unknown>): Item => ({
  ...compileItem(itemSchema.parse({ id: 'x', name: 'X', kind: 'other', weight: 10, value: 0, ...over })),
  appearanceId: 1,
});

const catalog = new Map<string, Item>([
  ['machete', define({ id: 'machete', kind: 'weapon', slot: 'hand', weight: 16.5, value: 0, attack: 12 })],
  ['steel-axe', define({
    id: 'steel-axe', kind: 'weapon', slot: 'hand', weight: 41, value: 0, attack: 21, requires: { vocationId: 'knight' },
  })],
  ['bow', define({
    id: 'bow', kind: 'weapon', slot: 'hand', weight: 31, value: 0, twoHanded: true,
    weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' }, requires: { vocationId: 'paladin' },
  })],
  ['shield', define({ id: 'shield', kind: 'shield', slot: 'shield', weight: 40 })],
]);

const knight: Vocation = {
  id: 'knight', name: 'Knight', healthPerLevel: 15, manaPerLevel: 5, capacityPerLevel: 25,
  startingWeaponItemId: 'steel-axe', spellSkill: 'magic', startingKit: [],
};
const paladin: Vocation = { ...knight, id: 'paladin', name: 'Paladin', startingWeaponItemId: 'bow' };

const options = (over: Partial<VocationChoiceOptions> = {}): VocationChoiceOptions => ({
  catalog, vocationLevel: 8, instanceId: 'city-1:hero:vocation',
  rules: { backpackSlots: 0, satchelSlots: 0, row: 1 }, ...over,
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
    expect([...hero.inventory.items()].map((item) => item.itemId)).toEqual(['machete']);
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
    expect([...shielded.inventory.items()].map((item) => item.itemId)).toEqual(['bow']);
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
    expect([...restored.inventory.items()][0]?.origin).toBeUndefined();
  });
});

describe('chooseVocation com o kit completo da vocação (#496)', () => {
  const kitOptions = (over: Partial<VocationChoiceOptions> = {}): VocationChoiceOptions => options({
    kitItems: [
      { item: catalog.get('steel-axe') as Item }, { item: catalog.get('shield') as Item },
    ],
    ...over,
  });

  it('equips the weapon AND the shield, each with its own identity and origin', () => {
    // Mutação que mata: reusar o `instanceId` da arma para o escudo — numa cópia da Cidade
    // dois personagens compartilham `session.id`, e a segunda peça colidiria na chave
    // primária de `item_instance`.
    const hero = new CharacterRuntime(state());
    const result = hero.chooseVocation(knight, null, kitOptions());
    expect(result).toEqual({
      ok: true, weapon: 'none',
      kit: [
        { itemId: 'steel-axe', status: 'equipped' }, { itemId: 'shield', status: 'equipped' },
      ],
    });
    expect(hero.inventory.equippedAt('hand')).toEqual({
      instanceId: 'city-1:hero:vocation:steel-axe', itemId: 'steel-axe', quantity: 1, origin: 'vocation-choice',
    });
    expect(hero.inventory.equippedAt('shield')).toEqual({
      instanceId: 'city-1:hero:vocation:shield', itemId: 'shield', quantity: 1, origin: 'vocation-choice',
    });
    // A machete voltou para a mochila na troca da mão.
    expect([...hero.inventory.items()].map((item) => item.itemId)).toEqual(['machete']);
  });

  it('leaves the shield in the backpack when the bow takes both hands, and the choice still holds', () => {
    // A ordem do kit é contrato: a arma veste ANTES do escudo, então o impedido é o escudo.
    const hero = new CharacterRuntime(state());
    const bow = catalog.get('bow') as Item;
    const result = hero.chooseVocation(paladin, null, kitOptions({
      kitItems: [{ item: bow }, { item: catalog.get('shield') as Item }],
    }));
    expect(result).toEqual({
      ok: true, weapon: 'none',
      kit: [{ itemId: 'bow', status: 'equipped' }, { itemId: 'shield', status: 'in-backpack' }],
    });
    expect(hero.vocationId).toBe('paladin');
    expect(hero.inventory.equippedAt('hand')?.itemId).toBe('bow');
    expect(hero.inventory.equippedAt('shield')).toBeNull();
    expect([...hero.inventory.items()].map((item) => item.itemId)).toEqual(['machete', 'shield']);
    // O escudo impedido não perdeu a proveniência: ele é do kit também.
    expect([...hero.inventory.items()].find((item) => item.itemId === 'shield')?.origin)
      .toBe('vocation-choice');
  });

  it('sends the piece that does not fit the capacity to the loot box, and equips what fits', () => {
    // A vocação não pode ser punida pela mochila — nem pela metade: o que coube veste, o que
    // não coube vai para a Caixa, e a escolha vale inteira.
    const hero = new CharacterRuntime(state({ capacity: 60 }));
    const result = hero.chooseVocation(knight, null, kitOptions());
    expect(result).toEqual({
      ok: true, weapon: 'none',
      kit: [{ itemId: 'steel-axe', status: 'equipped' }, { itemId: 'shield', status: 'in-loot-box' }],
    });
    expect(hero.vocationId).toBe('knight');
    expect(hero.lootBox.map((item) => item.itemId)).toEqual(['shield']);
    expect(hero.inventory.equippedAt('hand')?.itemId).toBe('steel-axe');
  });

  it('keeps the legacy single-weapon path when there is no kit (test content and old calls)', () => {
    const hero = new CharacterRuntime(state());
    expect(hero.chooseVocation(knight, catalog.get('steel-axe') ?? null, options()))
      .toEqual({ ok: true, weapon: 'equipped' });
    expect(hero.inventory.equippedAt('hand')?.instanceId).toBe('city-1:hero:vocation');
  });
});

describe('settleGoldDelta', () => {
  it('keeps the available balance while turning an accepted delta into its base', () => {
    const hero = new CharacterRuntime(state({ gold: 12_000, goldDelta: -955 }));

    hero.settleGoldDelta();

    expect(hero.gold).toBe(11_045);
    expect(hero.goldDelta).toBe(0);
    expect(hero.getState()).toMatchObject({ gold: 11_045, goldDelta: 0 });
  });
});
