import { describe, expect, it, vi } from 'vitest';
import { NEUTRAL_RATES, compileItem, itemSchema } from '@draconya/content';
import type { Item, ItemLoss, ItemSlot, Progression } from '@draconya/content';
import { CharacterRuntime } from './character.js';
import type { CharacterState } from './character.js';
import { CANARY_SLOT_ORDER } from './inventory.js';
import type { CarriedItem, EquipmentObserver } from './inventory.js';
import {
  LOSS_ROLL_RESOLUTION, consumeLossAmulet, lossPercentFor, loseItemsOnDeath,
} from './item-loss.js';
import { Rng } from './rng.js';

// A perda de item na morte (#571, ADR 0042 decisão 4): `Blessings.PlayerDeath`/`DropLoot` do
// Canary. Os números são os de `data/libs/systems/blessing.lua:36-46` — 100/70/45/25/10/0 por
// contagem de bênçãos, e um décimo disso para o que não é container.

const define = (over: Record<string, unknown>): Item => ({
  ...compileItem(itemSchema.parse({ id: 'x', name: 'X', kind: 'other', weight: 1, value: 0, ...over })),
  appearanceId: 1,
});

const catalog = new Map<string, Item>([
  ['backpack', define({ id: 'backpack', kind: 'container', slot: 'back', initialSlots: 20 })],
  ['bag', define({ id: 'bag', kind: 'container', slot: 'back', initialSlots: 8 })],
  ['helmet', define({ id: 'helmet', kind: 'armor', slot: 'head', armor: 2 })],
  ['plate', define({ id: 'plate', kind: 'armor', slot: 'chest', armor: 9 })],
  ['sword', define({ id: 'sword', kind: 'weapon', slot: 'hand', attack: 20 })],
  ['boots', define({ id: 'boots', kind: 'armor', slot: 'feet' })],
  ['ring', define({ id: 'ring', kind: 'ring', slot: 'finger' })],
  ['quiver', define({ id: 'quiver', kind: 'shield', slot: 'shield', quiver: true })],
  ['plain-amulet', define({ id: 'plain-amulet', kind: 'amulet', slot: 'neck' })],
  ['amulet-of-loss', define({
    id: 'amulet-of-loss', kind: 'amulet', slot: 'neck', charges: 1, protectsOnDeath: true,
  })],
  ['potion-stack', define({ id: 'potion-stack', kind: 'other', stackable: true })],
]);

// O que o Canary declara, e o que `baseline.json` entrega quando o dono ligar (`enabled: true`).
const CANARY_RULES: ItemLoss = {
  enabled: true,
  lossPercentByBlessings: [100, 70, 45, 25, 10, 0, 0, 0],
  nonContainerDivisor: 10,
  replacementContainerId: 'bag',
};

const progressionOf = (itemLoss: ItemLoss | undefined, withAdventurer = true): Progression => ({
  id: 'baseline',
  startingHealth: 150, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
  vocationLevel: 8, startingKit: [], satchelInitialSlots: 10, containerRow: 5,
  startingSpeed: 300, speedPerLevel: 2,
  regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
  regeneration: { requiresFood: false },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: {
    flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.08, promotionReduction: 0.3,
    ...(itemLoss === undefined ? {} : { itemLoss }),
  },
  ...(withAdventurer
    ? {
      blessingPricing: {
        freeBelowLevel: 21, flatUntilLevel: 30, flatPrice: 2000, highFromLevel: 120, midOffset: 20,
        midMultiplier: 200, midEnhancedMultiplier: 260, highBase: 20_000, highEnhancedBase: 26_000,
        highMultiplier: 75, highEnhancedMultiplier: 100,
      },
    }
    : {}),
  experienceBonusByLevel: [],
  skillMultipliers: {},
  mitigation: { multiplier: 1.3, primaryShield: 2.05, secondaryShield: 1.25 },
  rates: NEUTRAL_RATES,
});

const carried = (itemId: string, instanceId: string, quantity = 1): CarriedItem =>
  ({ instanceId, itemId, quantity });

/** Um personagem com o que cada teste pede vestido e dentro da mochila/bolsa. */
function hero(
  equipped: Partial<Record<ItemSlot, CarriedItem>>,
  over: { backpack?: (CarriedItem | null)[]; satchel?: (CarriedItem | null)[]; level?: number;
    vocationId?: string | null } = {},
): CharacterRuntime {
  const state: CharacterState = {
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: 100, maxHealth: 100, mana: 0, maxMana: 0,
    level: over.level ?? 50, xp: 0,
    // `null` é "sem vocação", e `??` o trocaria pelo default.
    vocationId: over.vocationId === undefined ? 'knight' : over.vocationId,
    goldDelta: 0, alive: true, capacity: 10_000, cooldowns: {},
    inventory: {
      backpack: over.backpack ?? [],
      satchel: over.satchel ?? [],
      equipped,
    },
  };
  return new CharacterRuntime(state);
}

/** A "mão cheia": todos os slots do Canary ocupados, com a mochila carregando duas coisas. */
function fullyDressed(): CharacterRuntime {
  return hero(
    {
      head: carried('helmet', 'i:helmet'),
      neck: carried('plain-amulet', 'i:amulet'),
      back: carried('backpack', 'i:backpack'),
      chest: carried('plate', 'i:plate'),
      hand: carried('sword', 'i:sword'),
      shield: carried('quiver', 'i:quiver'),
      // O slot `legs` fica vazio de propósito: vazio não consome sorteio.
      feet: carried('boots', 'i:boots'),
      finger: carried('ring', 'i:ring'),
    },
    {
      backpack: [carried('potion-stack', 'i:potions', 30), null, carried('sword', 'i:spare-sword')],
      satchel: [carried('helmet', 'i:satchel-helmet')],
    },
  );
}

/** O `Rng` real, com o sorteio de perda forçado a um número — o que mede a fronteira exata. */
function rigged(rolls: number | readonly number[]) {
  const rng = Rng.fromSeed('item-loss');
  const queue = typeof rolls === 'number' ? null : [...rolls];
  const spy = vi.spyOn(rng, 'integer').mockImplementation(() => {
    if (queue === null) return rolls as number;
    return queue.shift() ?? LOSS_ROLL_RESOLUTION;
  });
  return { rng, spy };
}

const context = (
  character: CharacterRuntime, rng: Rng, blessings: number,
  progression: Progression = progressionOf(CANARY_RULES),
) => {
  let seq = 0;
  return {
    progression, items: catalog, blessings, rng,
    newInstanceId: () => `s:${character.id}:${String(seq++)}`,
  };
};

describe('lossPercentFor — a tabela por contagem de bênçãos (Blessings.LossPercent)', () => {
  it('é 100/70/45/25/10 e zera a partir da quinta bênção', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((count) => lossPercentFor(CANARY_RULES, count)))
      .toEqual([100, 70, 45, 25, 10, 0, 0, 0]);
  });

  it('contagem além do fim da tabela usa a última entrada', () => {
    expect(lossPercentFor(CANARY_RULES, 12)).toBe(0);
    expect(lossPercentFor({ ...CANARY_RULES, lossPercentByBlessings: [80, 40] }, 5)).toBe(40);
  });
});

describe('loseItemsOnDeath — desligado é "nunca perde item" (a regra provisória do dono)', () => {
  it('com `enabled: false` a morte não toca em inventário, extrato nem sorteio', () => {
    const character = fullyDressed();
    const before = JSON.stringify(character.inventory.getState());
    const { rng, spy } = rigged(1);

    const outcome = loseItemsOnDeath(
      character, context(character, rng, 0, progressionOf({ ...CANARY_RULES, enabled: false })),
    );

    expect(outcome).toEqual({ lost: [], protectedBy: null, replacement: null });
    expect(JSON.stringify(character.inventory.getState())).toBe(before);
    expect(character.removedInstances).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('sem o bloco `itemLoss` no conteúdo, também não — e não entrega bag a quem não tem mochila', () => {
    const character = hero({ chest: carried('plate', 'i:plate') });
    const { rng, spy } = rigged(1);

    const outcome = loseItemsOnDeath(character, context(character, rng, 0, progressionOf(undefined)));

    expect(outcome.replacement).toBeNull();
    expect(character.inventory.equippedAt('back')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('loseItemsOnDeath — sem bênção, a mochila se perde (100%) e leva o que carrega', () => {
  it('a mochila, o conteúdo dela e o que o sorteio pegou saem; a bolsa NUNCA sai', () => {
    const character = fullyDressed();
    // Sorteio 1 para todo mundo: a chance mínima que ainda cai. Tudo que tem sorteio é perdido.
    const { rng } = rigged(1);

    const outcome = loseItemsOnDeath(character, context(character, rng, 0));

    const lostIds = outcome.lost.map((entry) => entry.item.instanceId);
    // Slots vestidos, na ordem do Canary — a mochila leva junto o que estava dentro dela,
    // logo depois dela (a ordem dos containers é a do vetor).
    expect(lostIds).toEqual([
      'i:helmet', 'i:amulet',
      'i:backpack', 'i:potions', 'i:spare-sword',
      'i:plate', 'i:sword', 'i:quiver', 'i:boots', 'i:ring',
    ]);
    expect(outcome.lost.find((entry) => entry.item.instanceId === 'i:potions')?.from)
      .toBe('backpack-contents');
    expect(outcome.lost.find((entry) => entry.item.instanceId === 'i:backpack')?.from).toBe('back');
    // A bolsa é do PERSONAGEM (vetor fixo), não do item — sobrevive à perda da mochila.
    expect([...character.inventory.satchel].filter((entry) => entry !== null).map((entry) => entry?.instanceId))
      .toEqual(['i:satchel-helmet']);
    // Tudo o que saiu vai para a lista que o extrato drena — é o que o `jobs` apaga do banco.
    expect(character.removedInstances).toEqual(lostIds);
  });

  it('quem ficou sem mochila ganha uma bag nova, vestida, com os lugares dela e origem própria', () => {
    const character = fullyDressed();
    const { rng } = rigged(1);

    const outcome = loseItemsOnDeath(character, context(character, rng, 0));

    expect(outcome.replacement).toEqual({
      instanceId: 's:hero:0', itemId: 'bag', quantity: 1, origin: 'death-replacement',
    });
    expect(character.inventory.equippedAt('back')).toEqual(outcome.replacement);
    // Os 20 lugares da mochila que se foi NÃO sobram: a bag traz os 8 dela, vazios.
    expect(character.inventory.backpack).toEqual(new Array(8).fill(null));
    expect(character.inventory.getState().equipped.head).toBeUndefined();
  });

  it('a mochila é a única a perder com a chance CHEIA — o resto rola com um décimo dela', () => {
    // 100% no container, 10% no resto: com sorteio 1000, só a mochila e os de chance 1000/10000
    // caem. O boundary é `roll <= chance × 100`: 1000 cai, 1001 não.
    const dressed = (): CharacterRuntime => fullyDressed();

    const atBoundary = dressed();
    loseItemsOnDeath(atBoundary, context(atBoundary, rigged(1000).rng, 0));
    // Todos os 8 slots vestidos perdem: 1000 ≤ 1000 (não container) e ≤ 10000 (container).
    expect(atBoundary.inventory.equippedAt('head')).toBeNull();
    expect(atBoundary.inventory.equippedAt('chest')).toBeNull();

    const justAbove = dressed();
    const outcome = loseItemsOnDeath(justAbove, context(justAbove, rigged(1001).rng, 0));
    // 1001 > 1000: os que NÃO são container escapam. A mochila (e a aljava, container no
    // cliente) continuam com a chance cheia e caem.
    expect(outcome.lost.filter((entry) => entry.from !== 'backpack-contents').map((entry) => entry.item.instanceId))
      .toEqual(['i:backpack', 'i:quiver']);
    expect(justAbove.inventory.equippedAt('head')?.instanceId).toBe('i:helmet');
    expect(justAbove.inventory.equippedAt('chest')?.instanceId).toBe('i:plate');
  });
});

describe('loseItemsOnDeath — a chance cai com as bênçãos, e cai na fronteira EXATA', () => {
  it('uma bênção: container 70%, resto 7% — o sorteio 7000 cai, o 7001 não', () => {
    const drop = (roll: number): string[] => {
      const character = fullyDressed();
      const outcome = loseItemsOnDeath(character, context(character, rigged(roll).rng, 1));
      return outcome.lost.filter((entry) => entry.from !== 'backpack-contents')
        .map((entry) => entry.item.instanceId);
    };
    expect(drop(7000)).toContain('i:backpack');
    expect(drop(7000)).toContain('i:quiver');
    expect(drop(7001)).not.toContain('i:backpack');
    expect(drop(7001)).not.toContain('i:quiver');
    // 7% para o resto = 700: 700 cai, 701 não.
    expect(drop(700)).toContain('i:helmet');
    expect(drop(701)).not.toContain('i:helmet');
  });

  it.each([
    [2, 4500, 450], [3, 2500, 250], [4, 1000, 100],
  ])('com %i bênções: container até %i, resto até %i (em 10 000)', (blessings, container, other) => {
    const at = (roll: number): CharacterRuntime => {
      const character = fullyDressed();
      loseItemsOnDeath(character, context(character, rigged(roll).rng, blessings));
      return character;
    };
    expect(at(container).inventory.equippedAt('shield')).toBeNull();
    expect(at(container + 1).inventory.equippedAt('shield')?.instanceId).toBe('i:quiver');
    expect(at(other).inventory.equippedAt('head')).toBeNull();
    expect(at(other + 1).inventory.equippedAt('head')?.instanceId).toBe('i:helmet');
  });

  it('a aljava conta como container (a flag do cliente, não do items.xml), e a espada não', () => {
    const character = hero({ hand: carried('sword', 'i:sword'), shield: carried('quiver', 'i:quiver') });
    // Sorteio 5000, uma bênção (70% → container 7000, resto 700): a aljava cai, a espada não.
    const outcome = loseItemsOnDeath(character, context(character, rigged(5000).rng, 1));
    expect(outcome.lost.map((entry) => entry.item.instanceId)).toEqual(['i:quiver']);
  });

  it('consome UM sorteio por item vestido, na ordem do Canary — e nenhum por slot vazio', () => {
    const character = fullyDressed();
    const { rng, spy } = rigged(9999);

    loseItemsOnDeath(character, context(character, rng, 0));

    // Oito peças vestidas (`legs` vazio): oito sorteios de 1 a 10 000 (`math.random(100 × 100)`).
    expect(spy).toHaveBeenCalledTimes(8);
    for (const call of spy.mock.calls) expect(call).toEqual([1, LOSS_ROLL_RESOLUTION]);
    // A ordem é a de `CANARY_SLOT_ORDER`: head, neck, back, chest, hand, shield, legs, feet, finger.
    expect(CANARY_SLOT_ORDER).toEqual([
      'head', 'neck', 'back', 'chest', 'hand', 'shield', 'legs', 'feet', 'finger', 'ammo',
    ]);
  });

  it('a sequência do Rng depende de QUANTOS itens estão vestidos, não do que caiu antes', () => {
    // Cada peça sorteia mesmo quando a anterior caiu: perder a mochila no meio da varredura não
    // adianta nem atrasa o sorteio da armadura. Mutação que mata: `break` após a primeira perda.
    const character = fullyDressed();
    const { rng, spy } = rigged([1, 1, 1, 10_000, 10_000, 10_000, 10_000, 10_000]);
    loseItemsOnDeath(character, context(character, rng, 0));
    expect(spy).toHaveBeenCalledTimes(8);
  });

  it('distribuição real: sem bênção, ~10% dos itens que não são container caem (100% / 10)', () => {
    let lost = 0;
    const trials = 20_000;
    for (let seed = 0; seed < trials; seed++) {
      const character = hero({ chest: carried('plate', 'i:plate'), back: carried('backpack', 'i:bp') });
      const outcome = loseItemsOnDeath(
        character, context(character, Rng.fromSeed(`trial-${String(seed)}`), 0),
      );
      if (outcome.lost.some((entry) => entry.item.instanceId === 'i:plate')) lost++;
      // A mochila cai SEMPRE (100% × container, sorteio ≤ 10 000).
      expect(outcome.lost.some((entry) => entry.item.instanceId === 'i:bp')).toBe(true);
    }
    expect(lost / trials).toBeGreaterThan(0.09);
    expect(lost / trials).toBeLessThan(0.11);
  });

  it('a mesma semente dá a mesma perda: o sorteio é determinístico', () => {
    const run = (): string[] => {
      const character = fullyDressed();
      return loseItemsOnDeath(character, context(character, Rng.fromSeed('same'), 3)).lost
        .map((entry) => entry.item.instanceId);
    };
    expect(run()).toEqual(run());
  });
});

describe('loseItemsOnDeath — quem está protegido não sorteia nada', () => {
  it('com cinco bênçãos nada se perde e NENHUM sorteio é consumido', () => {
    const character = fullyDressed();
    const before = JSON.stringify(character.inventory.getState());
    const { rng, spy } = rigged(1);

    const outcome = loseItemsOnDeath(character, context(character, rng, 5));

    expect(outcome.lost).toEqual([]);
    expect(outcome.protectedBy).toBe('blessings');
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(character.inventory.getState())).toBe(before);
    expect(character.removedInstances).toEqual([]);
  });

  it('o Amulet of Loss VESTIDO protege tudo, mesmo sem bênção nenhuma', () => {
    const character = fullyDressed();
    character.inventory.destroy('neck');
    character.inventory.grantEquipped('neck', carried('amulet-of-loss', 'i:aol'));
    const before = JSON.stringify(character.inventory.getState());
    const { rng, spy } = rigged(1);

    const outcome = loseItemsOnDeath(character, context(character, rng, 0));

    expect(outcome.lost).toEqual([]);
    expect(outcome.protectedBy).toBe('amulet');
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(character.inventory.getState())).toBe(before);
  });

  it('o colar na MOCHILA, fora do pescoço, não protege — o Canary confere só o slot do colar', () => {
    const withAmuletInBag = hero(
      { back: carried('backpack', 'i:bp'), chest: carried('plate', 'i:plate') },
      { backpack: [carried('amulet-of-loss', 'i:aol')] },
    );

    const outcome = loseItemsOnDeath(withAmuletInBag, context(withAmuletInBag, rigged(1).rng, 0));

    expect(outcome.protectedBy).toBeNull();
    expect(outcome.lost.map((entry) => entry.item.instanceId)).toContain('i:bp');
  });

  it('o colar comum no pescoço não protege — só quem declara `protectsOnDeath`', () => {
    const character = fullyDressed();
    const outcome = loseItemsOnDeath(character, context(character, rigged(1).rng, 0));
    expect(outcome.protectedBy).toBeNull();
    expect(outcome.lost.map((entry) => entry.item.instanceId)).toContain('i:amulet');
  });

  it('protegido, quem estava sem mochila AINDA ganha a bag — está fora dos ramos da perda', () => {
    const character = hero({ chest: carried('plate', 'i:plate') });

    const outcome = loseItemsOnDeath(character, context(character, rigged(1).rng, 5));

    expect(outcome.lost).toEqual([]);
    expect(outcome.replacement?.itemId).toBe('bag');
    expect(character.inventory.equippedAt('back')?.itemId).toBe('bag');
    expect(character.inventory.backpack).toHaveLength(8);
  });

  it('quem já tem mochila e não perdeu nada não ganha bag', () => {
    const character = hero({ back: carried('backpack', 'i:bp') });
    // Chance zero em toda a tabela: protegido pelas bênçãos, e a mochila fica.
    const outcome = loseItemsOnDeath(character, context(character, rigged(1).rng, 5));
    expect(outcome.replacement).toBeNull();
    expect(character.inventory.equippedAt('back')?.instanceId).toBe('i:bp');
  });
});

describe('loseItemsOnDeath — o inventário avisa quem observa o equipamento', () => {
  it('o anel perdido é desvestido pelo observer (cancela o prazo) e a bag entra como vestida', () => {
    const character = hero({ finger: carried('ring', 'i:ring'), back: carried('backpack', 'i:bp') });
    const events: string[] = [];
    const observer: EquipmentObserver = {
      onEquip: (slot, item) => events.push(`equip:${slot}:${item.itemId}`),
      onUnequip: (slot, item) => events.push(`unequip:${slot}:${item.itemId}`),
    };
    character.inventory.setEquipmentObserver(observer);

    loseItemsOnDeath(character, context(character, rigged(1).rng, 0));

    expect(events).toEqual(['unequip:back:backpack', 'unequip:finger:ring', 'equip:back:bag']);
  });
});

describe('consumeLossAmulet — a morte gasta UM colar vestido (Player::death)', () => {
  const withAmulet = (over: { level?: number; vocationId?: string | null } = {}): CharacterRuntime =>
    hero({ neck: carried('amulet-of-loss', 'i:aol') }, over);

  it('consome o colar e o registra para o `jobs` apagar — protegendo ou não', () => {
    const character = withAmulet();
    const consumed = consumeLossAmulet(character, { progression: progressionOf(CANARY_RULES), items: catalog });
    expect(consumed?.instanceId).toBe('i:aol');
    expect(character.inventory.equippedAt('neck')).toBeNull();
    expect(character.removedInstances).toEqual(['i:aol']);
  });

  it('não consome o colar comum, nem quando o pescoço está vazio', () => {
    const plain = hero({ neck: carried('plain-amulet', 'i:amulet') });
    expect(consumeLossAmulet(plain, { progression: progressionOf(CANARY_RULES), items: catalog })).toBeNull();
    expect(plain.inventory.equippedAt('neck')?.instanceId).toBe('i:amulet');
    const bare = hero({});
    expect(consumeLossAmulet(bare, { progression: progressionOf(CANARY_RULES), items: catalog })).toBeNull();
  });

  it('desligado (`enabled: false`) o colar NÃO é gasto: gastá-lo seria perder item', () => {
    const character = withAmulet();
    const off = progressionOf({ ...CANARY_RULES, enabled: false });
    expect(consumeLossAmulet(character, { progression: off, items: catalog })).toBeNull();
    expect(character.inventory.equippedAt('neck')?.instanceId).toBe('i:aol');
  });

  it('abaixo do level do Adventurer\'s Blessing, com vocação, o colar fica (`willNotLoseBless`)', () => {
    // Nível 20 com vocação: 20 < 21. O Canary confere DEPOIS da penalidade — o level que
    // chega aqui já é o rebaixado.
    const kept = withAmulet({ level: 20, vocationId: 'knight' });
    expect(consumeLossAmulet(kept, { progression: progressionOf(CANARY_RULES), items: catalog })).toBeNull();
    expect(kept.inventory.equippedAt('neck')?.instanceId).toBe('i:aol');
  });

  it('no level 21, ou sem vocação, ou sem Adventurer no conteúdo, o colar se consome', () => {
    const at21 = withAmulet({ level: 21, vocationId: 'knight' });
    expect(consumeLossAmulet(at21, { progression: progressionOf(CANARY_RULES), items: catalog })).not.toBeNull();
    const noVocation = withAmulet({ level: 5, vocationId: null });
    expect(consumeLossAmulet(noVocation, { progression: progressionOf(CANARY_RULES), items: catalog })).not.toBeNull();
    const noPricing = withAmulet({ level: 5, vocationId: 'knight' });
    expect(consumeLossAmulet(noPricing, { progression: progressionOf(CANARY_RULES, false), items: catalog }))
      .not.toBeNull();
  });
});
