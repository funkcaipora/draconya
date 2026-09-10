import { describe, expect, it } from 'vitest';
import { itemSchema } from '@draconya/content';
import type { Item } from '@draconya/content';
import { Inventory, MAX_STACK } from './inventory.js';
import type { CarriedItem, Wearer } from './inventory.js';

const define = (over: Record<string, unknown>): Item => itemSchema.parse({
  id: 'x', name: 'X', appearanceId: 1, kind: 'other', weight: 10, ...over,
});

const catalog = new Map<string, Item>([
  ['sword', define({ id: 'sword', kind: 'weapon', slot: 'hand', weight: 50, attack: 24 })],
  ['armor', define({ id: 'armor', kind: 'armor', slot: 'chest', weight: 90, armor: 4 })],
  ['helmet', define({ id: 'helmet', kind: 'armor', slot: 'head', weight: 20, armor: 2 })],
  ['arrow', define({ id: 'arrow', kind: 'ammunition', slot: 'ammo', weight: 1, stackable: true })],
  ['rock', define({ id: 'rock', kind: 'other', weight: 5 })],
  ['great-sword', define({
    id: 'great-sword', kind: 'weapon', slot: 'hand', weight: 60, attack: 40,
    requires: { level: 20 },
  })],
  ['druid-staff', define({
    id: 'druid-staff', kind: 'weapon', slot: 'hand', weight: 30, attack: 12,
    requires: { vocationId: 'druid' },
  })],
]);

const carried = (itemId: string, instanceId = itemId, quantity = 1): CarriedItem =>
  ({ instanceId, itemId, quantity });

const wearer = (over: Partial<Wearer> = {}): Wearer => ({
  level: over.level ?? 30,
  vocationId: over.vocationId ?? null,
  capacity: over.capacity ?? 400,
});

describe('capacidade é PESO, no paradigma do Tibia (§21.5)', () => {
  it('recusa o que não cabe, e não guarda pela metade', () => {
    // Recusar em vez de estourar: o item que não cabe vai para a Caixa de Loot da Sessão, que
    // é issue própria. Guardar parte dele seria inventar meia espada.
    const inventory = new Inventory();
    const apertado = wearer({ capacity: 100 });

    expect(inventory.add(carried('armor'), catalog, apertado).ok).toBe(true);
    expect(inventory.add(carried('sword'), catalog, apertado))
      .toEqual({ ok: false, reason: 'over-capacity' });
    expect(inventory.backpack).toHaveLength(1);
  });

  it('o que está EQUIPADO conta no peso', () => {
    // Senão a estratégia ótima é equipar tudo para carregar o dobro, e a capacidade deixa de
    // significar o que ela diz.
    const inventory = new Inventory();
    const quem = wearer({ capacity: 200 });
    inventory.add(carried('armor'), catalog, quem);
    expect(inventory.weight(catalog)).toBe(90);

    inventory.equip('armor', quem, catalog);
    expect(inventory.weight(catalog)).toBe(90);
  });

  it('cabe exatamente no limite — a recusa é por passar, não por chegar', () => {
    const inventory = new Inventory();
    expect(inventory.add(carried('armor'), catalog, wearer({ capacity: 90 })).ok).toBe(true);
  });
});

describe('empilhar', () => {
  it('item empilhável junta na mesma linha', () => {
    const inventory = new Inventory();
    inventory.add(carried('arrow', 'a1', 40), catalog, wearer());
    inventory.add(carried('arrow', 'a2', 30), catalog, wearer());

    expect(inventory.backpack).toHaveLength(1);
    expect(inventory.backpack[0]?.quantity).toBe(70);
  });

  it('item NÃO empilhável vira linha nova, sempre', () => {
    // Duas espadas são duas identidades, e é a identidade que carrega a proveniência (FUN-76).
    // Juntá-las num contador apagaria de onde cada uma veio.
    const inventory = new Inventory();
    inventory.add(carried('sword', 's1'), catalog, wearer());
    inventory.add(carried('sword', 's2'), catalog, wearer());
    expect(inventory.backpack.map((i) => i.instanceId)).toEqual(['s1', 's2']);
  });

  it('o teto de pilha é 100, e pilha cheia começa outra', () => {
    const inventory = new Inventory();
    inventory.add(carried('arrow', 'a1', MAX_STACK), catalog, wearer({ capacity: 1_000 }));
    inventory.add(carried('arrow', 'a2', 10), catalog, wearer({ capacity: 1_000 }));

    expect(inventory.backpack.map((i) => i.quantity)).toEqual([MAX_STACK, 10]);
  });

  it('recusa uma pilha maior que o teto de uma vez', () => {
    expect(new Inventory().add(carried('arrow', 'a', 101), catalog, wearer({ capacity: 1_000 })))
      .toEqual({ ok: false, reason: 'stack-too-large' });
  });
});

describe('equipar (§21.4)', () => {
  const comEspada = () => {
    const inventory = new Inventory();
    inventory.add(carried('sword'), catalog, wearer());
    return inventory;
  };

  it('veste o que está na mochila, e o item sai dela', () => {
    const inventory = comEspada();
    expect(inventory.equip('sword', wearer(), catalog).ok).toBe(true);
    expect(inventory.equippedAt('hand')?.instanceId).toBe('sword');
    expect(inventory.backpack).toHaveLength(0);
  });

  it('o que sai do corpo VOLTA para a mochila, e o peso não muda', () => {
    // A troca não pode estourar a capacidade, e não estoura — é por isso que não há
    // conferência de peso ao equipar.
    const inventory = comEspada();
    inventory.add(carried('great-sword'), catalog, wearer());
    inventory.equip('sword', wearer(), catalog);
    const antes = inventory.weight(catalog);

    inventory.equip('great-sword', wearer(), catalog);

    expect(inventory.equippedAt('hand')?.instanceId).toBe('great-sword');
    expect(inventory.backpack.map((i) => i.instanceId)).toEqual(['sword']);
    expect(inventory.weight(catalog)).toBe(antes);
  });

  it('recusa item que não se veste', () => {
    const inventory = new Inventory();
    inventory.add(carried('rock'), catalog, wearer());
    expect(inventory.equip('rock', wearer(), catalog))
      .toEqual({ ok: false, reason: 'not-equippable' });
  });

  it('recusa por level, e aceita quando ele chega', () => {
    const inventory = new Inventory();
    inventory.add(carried('great-sword'), catalog, wearer());
    expect(inventory.equip('great-sword', wearer({ level: 19 }), catalog))
      .toEqual({ ok: false, reason: 'level-too-low' });
    expect(inventory.equip('great-sword', wearer({ level: 20 }), catalog).ok).toBe(true);
  });

  it('recusa por vocação — e o personagem sem vocação nenhuma também', () => {
    // O personagem nasce sem vocação e escolhe no level 8 (§7.4), então item de vocação é
    // inacessível até lá por construção — sem regra escrita em outro lugar.
    const inventory = new Inventory();
    inventory.add(carried('druid-staff'), catalog, wearer());
    expect(inventory.equip('druid-staff', wearer({ vocationId: null }), catalog))
      .toEqual({ ok: false, reason: 'wrong-vocation' });
    expect(inventory.equip('druid-staff', wearer({ vocationId: 'knight' }), catalog).ok)
      .toBe(false);
    expect(inventory.equip('druid-staff', wearer({ vocationId: 'druid' }), catalog).ok)
      .toBe(true);
  });

  it('recusa equipar o que ele não tem', () => {
    expect(new Inventory().equip('sword', wearer(), catalog))
      .toEqual({ ok: false, reason: 'not-carried' });
  });

  it('desequipar devolve para a mochila; slot vazio é recusa', () => {
    const inventory = comEspada();
    inventory.equip('sword', wearer(), catalog);

    expect(inventory.unequip('hand').ok).toBe(true);
    expect(inventory.backpack.map((i) => i.instanceId)).toEqual(['sword']);
    expect(inventory.equippedAt('hand')).toBeNull();
    expect(inventory.unequip('hand')).toEqual({ ok: false, reason: 'not-carried' });
  });
});

describe('o que o combate lê', () => {
  it('sem arma, o ataque é NULO — e não zero', () => {
    // Zero faria o personagem desarmado não machucar nada, e desarmado é como todo personagem
    // começa. Quem sabe quanto o punho bate é o conteúdo (`combat.player.attackPower`).
    expect(new Inventory().weaponAttack(catalog)).toBeNull();
  });

  it('com arma, o ataque é o DELA', () => {
    const inventory = new Inventory();
    inventory.add(carried('sword'), catalog, wearer());
    inventory.equip('sword', wearer(), catalog);
    expect(inventory.weaponAttack(catalog)).toBe(24);
  });

  it('a armadura SOMA o que está vestido', () => {
    const inventory = new Inventory();
    inventory.add(carried('armor'), catalog, wearer());
    inventory.add(carried('helmet'), catalog, wearer());
    inventory.equip('armor', wearer(), catalog);
    inventory.equip('helmet', wearer(), catalog);
    expect(inventory.armor(catalog)).toBe(6);
  });
});

describe('estado', () => {
  it('atravessa ida e volta pelo JSON sem perder nada', () => {
    const inventory = new Inventory();
    inventory.add(carried('sword'), catalog, wearer());
    inventory.add(carried('arrow', 'a', 50), catalog, wearer());
    inventory.equip('sword', wearer(), catalog);

    const voltou = Inventory.fromState(JSON.parse(JSON.stringify(inventory.getState())));
    expect(voltou.getState()).toEqual(inventory.getState());
    expect(voltou.equippedAt('hand')?.instanceId).toBe('sword');
  });

  it('sem estado, nasce vazio', () => {
    expect(Inventory.fromState(undefined).getState()).toEqual({ backpack: [], equipped: {} });
  });
});
