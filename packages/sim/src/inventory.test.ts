import { describe, expect, it } from 'vitest';
import { itemSchema } from '@draconya/content';
import type { Item } from '@draconya/content';
import { Inventory, MAX_STACK } from './inventory.js';
import type { CarriedItem, ContainerRules, Wearer } from './inventory.js';

// A aparência é resolvida por `buildContent` a partir de `appearances/baseline.json` (FUN-94),
// então o schema não a produz e ela entra aqui à mão. O que este teste exercita é peso, slot e
// empilhamento — arte não muda nenhum dos três.
const define = (over: Record<string, unknown>): Item => ({
  ...itemSchema.parse({ id: 'x', name: 'X', kind: 'other', weight: 10, ...over }),
  appearanceId: 1,
});

const catalog = new Map<string, Item>([
  ['sword', define({ id: 'sword', kind: 'weapon', slot: 'hand', weight: 50, attack: 24 })],
  ['armor', define({ id: 'armor', kind: 'armor', slot: 'chest', weight: 90, armor: 4 })],
  ['helmet', define({ id: 'helmet', kind: 'armor', slot: 'head', weight: 20, armor: 2 })],
  // Empilhável: o queijo — munição deixou de ser item (ADR 0026), e o schema já não a aceita.
  ['arrow', define({ id: 'arrow', kind: 'other', weight: 1, stackable: true })],
  ['rock', define({ id: 'rock', kind: 'other', weight: 5 })],
  ['bow', define({ id: 'bow', kind: 'weapon', slot: 'hand', weight: 31, twoHanded: true, weapon: { kind: 'distance', range: 6, ammoFamily: 'arrow' } })],
  ['shield', define({ id: 'shield', kind: 'shield', slot: 'shield', weight: 40 })],
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

/**
 * Sem mochila nas costas e sem lugar inicial: tudo vai para a bolsa, que cresce de um em um.
 * É o inventário "plano" de antes de #160, e os testes de peso, pilha e equipar continuam
 * falando só de peso, pilha e equipar. Os containers têm o bloco deles no fim.
 */
const rules: ContainerRules = { backpackSlots: 0, satchelSlots: 0, row: 1 };

describe('capacidade é PESO, no paradigma do Tibia (§21.5)', () => {
  it('recusa o que não cabe, e não guarda pela metade', () => {
    // Recusar em vez de estourar: o item que não cabe vai para a Caixa de Loot da Sessão, que
    // é issue própria. Guardar parte dele seria inventar meia espada.
    const inventory = new Inventory();
    const apertado = wearer({ capacity: 100 });

    expect(inventory.add(carried('armor'), catalog, apertado, rules).ok).toBe(true);
    expect(inventory.add(carried('sword'), catalog, apertado, rules))
      .toEqual({ ok: false, reason: 'over-capacity' });
    expect([...inventory.items()]).toHaveLength(1);
  });

  it('o que está EQUIPADO conta no peso', () => {
    // Senão a estratégia ótima é equipar tudo para carregar o dobro, e a capacidade deixa de
    // significar o que ela diz.
    const inventory = new Inventory();
    const quem = wearer({ capacity: 200 });
    inventory.add(carried('armor'), catalog, quem, rules);
    expect(inventory.weight(catalog)).toBe(90);

    inventory.equip('armor', quem, catalog);
    expect(inventory.weight(catalog)).toBe(90);
  });

  it('cabe exatamente no limite — a recusa é por passar, não por chegar', () => {
    const inventory = new Inventory();
    expect(inventory.add(carried('armor'), catalog, wearer({ capacity: 90 }), rules).ok).toBe(true);
  });
});

describe('empilhar', () => {
  it('item empilhável junta na mesma linha', () => {
    const inventory = new Inventory();
    inventory.add(carried('arrow', 'a1', 40), catalog, wearer(), rules);
    inventory.add(carried('arrow', 'a2', 30), catalog, wearer(), rules);

    expect([...inventory.items()]).toHaveLength(1);
    expect([...inventory.items()][0]?.quantity).toBe(70);
  });

  it('item NÃO empilhável vira linha nova, sempre', () => {
    // Duas espadas são duas identidades, e é a identidade que carrega a proveniência (FUN-76).
    // Juntá-las num contador apagaria de onde cada uma veio.
    const inventory = new Inventory();
    inventory.add(carried('sword', 's1'), catalog, wearer(), rules);
    inventory.add(carried('sword', 's2'), catalog, wearer(), rules);
    expect([...inventory.items()].map((i) => i.instanceId)).toEqual(['s1', 's2']);
  });

  it('o teto de pilha é 100, e pilha cheia começa outra', () => {
    const inventory = new Inventory();
    inventory.add(carried('arrow', 'a1', MAX_STACK), catalog, wearer({ capacity: 1_000 }), rules);
    inventory.add(carried('arrow', 'a2', 10), catalog, wearer({ capacity: 1_000 }), rules);

    expect([...inventory.items()].map((i) => i.quantity)).toEqual([MAX_STACK, 10]);
  });

  it('recusa uma pilha maior que o teto de uma vez', () => {
    expect(new Inventory().add(carried('arrow', 'a', 101), catalog, wearer({ capacity: 1_000 }), rules))
      .toEqual({ ok: false, reason: 'stack-too-large' });
  });
});

describe('equipar (§21.4)', () => {
  const comEspada = () => {
    const inventory = new Inventory();
    inventory.add(carried('sword'), catalog, wearer(), rules);
    return inventory;
  };

  it('veste o que está na mochila, e o item sai dela', () => {
    const inventory = comEspada();
    expect(inventory.equip('sword', wearer(), catalog).ok).toBe(true);
    expect(inventory.equippedAt('hand')?.instanceId).toBe('sword');
    expect([...inventory.items()]).toHaveLength(0);
  });

  it('o que sai do corpo VOLTA para a mochila, e o peso não muda', () => {
    // A troca não pode estourar a capacidade, e não estoura — é por isso que não há
    // conferência de peso ao equipar.
    const inventory = comEspada();
    inventory.add(carried('great-sword'), catalog, wearer(), rules);
    inventory.equip('sword', wearer(), catalog);
    const antes = inventory.weight(catalog);

    inventory.equip('great-sword', wearer(), catalog);

    expect(inventory.equippedAt('hand')?.instanceId).toBe('great-sword');
    expect([...inventory.items()].map((i) => i.instanceId)).toEqual(['sword']);
    expect(inventory.weight(catalog)).toBe(antes);
  });

  it('recusa item que não se veste', () => {
    const inventory = new Inventory();
    inventory.add(carried('rock'), catalog, wearer(), rules);
    expect(inventory.equip('rock', wearer(), catalog))
      .toEqual({ ok: false, reason: 'not-equippable' });
  });

  it('recusa por level, e aceita quando ele chega', () => {
    const inventory = new Inventory();
    inventory.add(carried('great-sword'), catalog, wearer(), rules);
    expect(inventory.equip('great-sword', wearer({ level: 19 }), catalog))
      .toEqual({ ok: false, reason: 'level-too-low' });
    expect(inventory.equip('great-sword', wearer({ level: 20 }), catalog).ok).toBe(true);
  });

  it('recusa por vocação — e o personagem sem vocação nenhuma também', () => {
    // O personagem nasce sem vocação e escolhe no level 8 (§7.4), então item de vocação é
    // inacessível até lá por construção — sem regra escrita em outro lugar.
    const inventory = new Inventory();
    inventory.add(carried('druid-staff'), catalog, wearer(), rules);
    expect(inventory.equip('druid-staff', wearer({ vocationId: null }), catalog))
      .toEqual({ ok: false, reason: 'wrong-vocation' });
    expect(inventory.equip('druid-staff', wearer({ vocationId: 'knight' }), catalog).ok)
      .toBe(false);
    expect(inventory.equip('druid-staff', wearer({ vocationId: 'druid' }), catalog).ok)
      .toBe(true);
  });

  it('as duas mãos (#152): bow com escudo vestido é recusado, e escudo com bow na mão também', () => {
    const inventory = new Inventory();
    inventory.add(carried('bow'), catalog, wearer({ capacity: 1_000 }), rules);
    inventory.add(carried('shield'), catalog, wearer({ capacity: 1_000 }), rules);
    expect(inventory.equip('shield', wearer(), catalog).ok).toBe(true);
    expect(inventory.equip('bow', wearer(), catalog)).toEqual({ ok: false, reason: 'hands-full' });
    // Tira o escudo, veste o bow, e agora é o escudo que não entra.
    expect(inventory.unequip('shield', rules).ok).toBe(true);
    expect(inventory.equip('bow', wearer(), catalog).ok).toBe(true);
    expect(inventory.equip('shield', wearer(), catalog)).toEqual({ ok: false, reason: 'hands-full' });
    // Uma arma de UMA mão convive com o escudo.
    inventory.add(carried('sword'), catalog, wearer({ capacity: 1_000 }), rules);
    expect(inventory.equip('sword', wearer(), catalog).ok).toBe(true);
    expect(inventory.equip('shield', wearer(), catalog).ok).toBe(true);
  });

  it('`weapon()` é a definição da arma na mão, ou null desarmado (#152)', () => {
    const inventory = comEspada();
    expect(inventory.weapon(catalog, wearer())).toBeNull();
    inventory.equip('sword', wearer(), catalog);
    expect(inventory.weapon(catalog, wearer())?.id).toBe('sword');
  });

  it('a arma que exige vocação ou level que o portador não tem é lida como mão vazia (#152)', () => {
    // `equip` recusa, mas a mão não é preenchida só por `equip`: um snapshot anterior à regra
    // chega por `fromState` sem passar por ela. O combate lê pela definição, e é aqui que a
    // arma de druida na mão de quem não tem vocação vira desarmado — alcance, ataque e modo
    // de bater juntos, e não só um deles.
    const staffInHand = Inventory.fromState({
      backpack: [], equipped: { hand: carried('druid-staff') },
    });
    expect(staffInHand.weapon(catalog, wearer())).toBeNull();
    expect(staffInHand.weaponAttack(catalog, wearer())).toBeNull();
    expect(staffInHand.weapon(catalog, wearer({ vocationId: 'druid' }))?.id).toBe('druid-staff');

    const greatSwordInHand = Inventory.fromState({
      backpack: [], equipped: { hand: carried('great-sword') },
    });
    expect(greatSwordInHand.weaponAttack(catalog, wearer({ level: 19 }))).toBeNull();
    expect(greatSwordInHand.weaponAttack(catalog, wearer({ level: 20 }))).toBe(40);
  });

  it('recusa equipar o que ele não tem', () => {
    expect(new Inventory().equip('sword', wearer(), catalog))
      .toEqual({ ok: false, reason: 'not-carried' });
  });

  it('desequipar devolve para a mochila; slot vazio é recusa', () => {
    const inventory = comEspada();
    inventory.equip('sword', wearer(), catalog);

    expect(inventory.unequip('hand', rules).ok).toBe(true);
    expect([...inventory.items()].map((i) => i.instanceId)).toEqual(['sword']);
    expect(inventory.equippedAt('hand')).toBeNull();
    expect(inventory.unequip('hand', rules)).toEqual({ ok: false, reason: 'not-carried' });
  });
});

describe('o que o combate lê', () => {
  it('sem arma, o ataque é NULO — e não zero', () => {
    // Zero faria o personagem desarmado não machucar nada, e desarmado é como todo personagem
    // começa. Quem sabe quanto o punho bate é o conteúdo (`combat.player.attackPower`).
    expect(new Inventory().weaponAttack(catalog, wearer())).toBeNull();
  });

  it('com arma, o ataque é o DELA', () => {
    const inventory = new Inventory();
    inventory.add(carried('sword'), catalog, wearer(), rules);
    inventory.equip('sword', wearer(), catalog);
    expect(inventory.weaponAttack(catalog, wearer())).toBe(24);
  });

  it('a armadura SOMA o que está vestido', () => {
    const inventory = new Inventory();
    inventory.add(carried('armor'), catalog, wearer(), rules);
    inventory.add(carried('helmet'), catalog, wearer(), rules);
    inventory.equip('armor', wearer(), catalog);
    inventory.equip('helmet', wearer(), catalog);
    expect(inventory.armor(catalog)).toBe(6);
  });
});

describe('estado', () => {
  it('atravessa ida e volta pelo JSON sem perder nada', () => {
    const inventory = new Inventory();
    inventory.add(carried('sword'), catalog, wearer(), rules);
    inventory.add(carried('arrow', 'a', 50), catalog, wearer(), rules);
    inventory.equip('sword', wearer(), catalog);

    const voltou = Inventory.fromState(JSON.parse(JSON.stringify(inventory.getState())));
    expect(voltou.getState()).toEqual(inventory.getState());
    expect(voltou.equippedAt('hand')?.instanceId).toBe('sword');
  });

  it('sem estado, nasce vazio', () => {
    expect(Inventory.fromState(undefined).getState()).toEqual({ backpack: [], satchel: [], equipped: {} });
  });
});

describe('mochila e bolsa posicionais (#160, ADR 0026 decisão 6)', () => {
  const backpack = define({ id: 'backpack', kind: 'container', slot: 'back', weight: 18, initialSlots: 20 });
  const cheese = define({ id: 'cheese', kind: 'other', weight: 1, stackable: true });
  const withContainers = new Map<string, Item>([...catalog, ['backpack', backpack], ['cheese', cheese]]);
  const huntera: ContainerRules = { backpackSlots: 20, satchelSlots: 10, row: 5 };
  const rich = wearer({ capacity: 100_000 });

  /** Nasce com a mochila nas costas e os tamanhos do Huntera. */
  const born = (): Inventory => {
    const inventory = Inventory.fromState({
      backpack: [], equipped: { back: { instanceId: 'kit:back', itemId: 'backpack', quantity: 1 } },
    });
    inventory.ensureContainers(huntera);
    return inventory;
  };
  const rock = (n: number): CarriedItem => carried('rock', `rock-${String(n)}`);

  it('nasce com 20 lugares na mochila e 10 na bolsa, todos vazios', () => {
    const inventory = born();
    expect(inventory.backpack).toHaveLength(20);
    expect(inventory.satchel).toHaveLength(10);
    expect(inventory.backpack.every((p) => p === null)).toBe(true);
    // Idempotente, e nunca encolhe.
    inventory.ensureContainers({ backpackSlots: 10, satchelSlots: 5, row: 5 });
    expect(inventory.backpack).toHaveLength(20);
  });

  it('empilha antes de ocupar lugar, e o 21º item distinto abre uma linha de 5', () => {
    // Mutação que mata: recusar por lugar em vez de crescer, ou crescer de um em um.
    const inventory = born();
    inventory.add(carried('cheese', 'c1', 3), withContainers, rich, huntera);
    inventory.add(carried('cheese', 'c2', 4), withContainers, rich, huntera);
    expect(inventory.backpack[0]).toMatchObject({ instanceId: 'c1', quantity: 7 });
    expect(inventory.backpack[1]).toBeNull();
    for (let i = 1; i <= 19; i += 1) inventory.add(rock(i), withContainers, rich, huntera);
    expect(inventory.backpack).toHaveLength(20);
    expect(inventory.backpack.every((p) => p !== null)).toBe(true);
    expect(inventory.add(rock(20), withContainers, rich, huntera).ok).toBe(true);
    expect(inventory.backpack).toHaveLength(25);
    expect(inventory.backpack[20]?.instanceId).toBe('rock-20');
  });

  it('só o PESO recusa; lugar nunca — e a recusa vai para quem chama decidir a Caixa', () => {
    const inventory = born();
    for (let i = 1; i <= 40; i += 1) expect(inventory.add(rock(i), withContainers, rich, huntera).ok).toBe(true);
    expect(inventory.backpack).toHaveLength(40);
    expect(inventory.add(rock(41), withContainers, wearer({ capacity: 10 }), huntera))
      .toEqual({ ok: false, reason: 'over-capacity' });
  });

  it('remover apara as linhas vazias do fim até o tamanho inicial, nunca abaixo', () => {
    const inventory = born();
    for (let i = 1; i <= 21; i += 1) inventory.add(rock(i), withContainers, rich, huntera);
    expect(inventory.backpack).toHaveLength(25);
    expect(inventory.remove('rock-21')?.instanceId).toBe('rock-21');
    expect(inventory.backpack).toHaveLength(20);
    inventory.remove('rock-1');
    expect(inventory.backpack).toHaveLength(20);
    expect(inventory.backpack[0]).toBeNull();
  });

  it('sem mochila nas costas o loot vai para a bolsa', () => {
    const inventory = Inventory.fromState({ backpack: [], equipped: {} });
    inventory.ensureContainers({ ...huntera, backpackSlots: 0 });
    expect(inventory.add(rock(1), withContainers, rich, huntera).ok).toBe(true);
    expect(inventory.satchel[0]?.instanceId).toBe('rock-1');
    expect(inventory.backpack).toHaveLength(0);
  });

  it('move: troca, empilha até o teto deixando o resto, veste para um slot, desveste para um lugar — tudo ou nada', () => {
    const inventory = born();
    inventory.add(rock(1), withContainers, rich, huntera);
    inventory.add(carried('sword', 's1'), withContainers, rich, huntera);
    inventory.add(carried('cheese', 'c1', 60), withContainers, rich, huntera);
    // rock-1 em 0, s1 em 1, c1 em 2. Troca 0 ↔ 1.
    expect(inventory.move({ container: 'backpack', index: 0 }, { container: 'backpack', index: 1 }, withContainers, rich, huntera).ok).toBe(true);
    expect(inventory.backpack[0]?.instanceId).toBe('s1');
    expect(inventory.backpack[1]?.instanceId).toBe('rock-1');
    // Para a bolsa vazia.
    expect(inventory.move({ container: 'backpack', index: 1 }, { container: 'satchel', index: 3 }, withContainers, rich, huntera).ok).toBe(true);
    expect(inventory.satchel[3]?.instanceId).toBe('rock-1');
    expect(inventory.backpack[1]).toBeNull();
    // Pilha: 60 + 60 com teto 100 → destino 100, origem 20.
    inventory.add(carried('cheese', 'c2', 60), withContainers, rich, huntera);
    const c2 = inventory.backpack.findIndex((p) => p?.instanceId === 'c2');
    expect(inventory.move({ container: 'backpack', index: c2 }, { container: 'backpack', index: 2 }, withContainers, rich, huntera).ok).toBe(true);
    expect(inventory.backpack[2]?.quantity).toBe(100);
    expect(inventory.backpack[c2]?.quantity).toBe(20);
    // Veste a espada a partir do lugar 0; a mão estava vazia, o lugar fica vazio.
    expect(inventory.move({ container: 'backpack', index: 0 }, { slot: 'hand' }, withContainers, rich, huntera).ok).toBe(true);
    expect(inventory.equippedAt('hand')?.instanceId).toBe('s1');
    expect(inventory.backpack[0]).toBeNull();
    // Desveste PARA o lugar 5 da bolsa.
    expect(inventory.move({ slot: 'hand' }, { container: 'satchel', index: 5 }, withContainers, rich, huntera).ok).toBe(true);
    expect(inventory.satchel[5]?.instanceId).toBe('s1');
    expect(inventory.equippedAt('hand')).toBeNull();
  });

  it('move recusa sem mutar: lugar inexistente, lugar vazio, slot que não veste', () => {
    const inventory = born();
    inventory.add(rock(1), withContainers, rich, huntera);
    const before = inventory.getState();
    expect(inventory.move({ container: 'backpack', index: 0 }, { container: 'backpack', index: 99 }, withContainers, rich, huntera))
      .toEqual({ ok: false, reason: 'no-such-place' });
    expect(inventory.move({ container: 'backpack', index: 7 }, { container: 'backpack', index: 0 }, withContainers, rich, huntera))
      .toEqual({ ok: false, reason: 'empty-place' });
    expect(inventory.move({ container: 'backpack', index: 0 }, { slot: 'hand' }, withContainers, rich, huntera))
      .toEqual({ ok: false, reason: 'not-equippable' });
    // Para o próprio lugar: nada muda, e não é recusa.
    expect(inventory.move({ container: 'backpack', index: 0 }, { container: 'backpack', index: 0 }, withContainers, rich, huntera).ok).toBe(true);
    expect(inventory.getState()).toEqual(before);
  });

  it('a mochila só sai vazia, e `equip` de um item da bolsa devolve o anterior ao lugar dele', () => {
    const inventory = born();
    inventory.add(rock(1), withContainers, rich, huntera);
    expect(inventory.unequip('back', huntera)).toEqual({ ok: false, reason: 'backpack-not-empty' });
    expect(inventory.move({ slot: 'back' }, { container: 'satchel', index: 0 }, withContainers, rich, huntera))
      .toEqual({ ok: false, reason: 'backpack-not-empty' });
    inventory.remove('rock-1');
    expect(inventory.unequip('back', huntera).ok).toBe(true);
    // Sem mochila: a bolsa recebe. Vestir da bolsa e trocar de arma: a anterior volta ao LUGAR.
    inventory.add(carried('sword', 's1'), withContainers, rich, huntera);
    inventory.add(carried('great-sword', 'g1'), withContainers, rich, huntera);
    const s1 = inventory.satchel.findIndex((p) => p?.instanceId === 's1');
    const g1 = inventory.satchel.findIndex((p) => p?.instanceId === 'g1');
    expect(inventory.equip('s1', rich, withContainers).ok).toBe(true);
    expect(inventory.equip('g1', rich, withContainers).ok).toBe(true);
    expect(inventory.satchel[g1]?.instanceId).toBe('s1');
    expect(inventory.satchel[s1]).toBeNull();
  });

  it('lê o estado v1 (lista plana, sem bolsa) e devolve v2; ensureContainers completa os 20', () => {
    // O snapshot anterior a #160 é reconhecível: sem `null`, sem `satchel`. Sem bump de
    // `SNAPSHOT_FORMAT_VERSION`. Mutação que mata: `fromState` exigir `satchel`.
    const inventory = Inventory.fromState({
      backpack: [carried('rock', 'r1'), carried('sword', 's1')],
      equipped: { back: { instanceId: 'kit:back', itemId: 'backpack', quantity: 1 } },
    } as never);
    expect(inventory.backpack).toHaveLength(2);
    inventory.ensureContainers(huntera);
    expect(inventory.backpack).toHaveLength(20);
    expect(inventory.backpack[0]?.instanceId).toBe('r1');
    expect(inventory.satchel).toHaveLength(10);
    const state = JSON.parse(JSON.stringify(inventory.getState())) as ReturnType<Inventory['getState']>;
    expect(state.backpack).toHaveLength(20);
    expect(state.satchel).toHaveLength(10);
    expect(Inventory.fromState(state).getState()).toEqual(inventory.getState());
  });
});
