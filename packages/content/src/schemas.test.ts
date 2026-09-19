import { describe, expect, it } from 'vitest';
import { botConditionSchema, botConfigV2Schema, botSetSchema, botTargetPolicySchema, huntSchema, itemSchema } from './schemas.js';

describe('huntSchema (#360)', () => {
  const validHunt = {
    id: 'rat-cellars',
    name: 'Rat Cellars',
    recommendedLevel: 1,
    mapId: 'rat-cellars',
    routeId: 'rat-cellars',
    difficulties: {
      cautious: {
        monsterCount: 2,
        composition: [{ monsterId: 'rat', weight: 1 }],
        respawnDelayMs: 30_000,
      },
    },
  };

  it('valida hunt válida sem exitDelayMs (opcional)', () => {
    const parsed = huntSchema.parse(validHunt);
    expect(parsed.exitDelayMs).toBeUndefined();
    expect(huntSchema.parse(parsed)).toEqual(parsed);
  });

  it('valida roundtrip de hunt com exitDelayMs positivo inteiro', () => {
    const raw = { ...validHunt, exitDelayMs: 5_000 };
    const parsed = huntSchema.parse(raw);
    expect(parsed.exitDelayMs).toBe(5_000);
    expect(huntSchema.parse(parsed)).toEqual(parsed);
  });

  it('rejeita exitDelayMs zero, negativo ou não inteiro', () => {
    expect(() => huntSchema.parse({ ...validHunt, exitDelayMs: 0 })).toThrow();
    expect(() => huntSchema.parse({ ...validHunt, exitDelayMs: -100 })).toThrow();
    expect(() => huntSchema.parse({ ...validHunt, exitDelayMs: 5.5 })).toThrow();
  });
});

describe('itemSchema — consumível exige a forma inteira (AB-01)', () => {
  const consumable = {
    id: 'health-potion', name: 'Poção de Vida', kind: 'consumable',
    stackable: true, weight: 2.7, value: 0, price: 45, group: 'potion',
    restock: { batch: 50, min: 10 }, effect: { kind: 'heal', amount: 80 },
  };

  it('aceita o consumível completo, e o roundtrip é estável', () => {
    const parsed = itemSchema.parse(consumable);
    expect(parsed.kind).toBe('consumable');
    expect(itemSchema.parse(parsed)).toEqual(parsed);
  });

  it('recusa consumível sem `group`, sem `restock`, sem `price` ou sem `effect`', () => {
    // As quatro lacunas que a `superRefine` existe para pegar: um schema de campo opcional
    // aceitaria todas, e o item chegaria ao runtime sem o que a reposição e o motor leem.
    const { group: _group, ...semGroup } = consumable;
    const { restock: _restock, ...semRestock } = consumable;
    const { price: _price, ...semPrice } = consumable;
    const { effect: _effect, ...semEffect } = consumable;
    expect(() => itemSchema.parse(semGroup)).toThrow(/group/);
    expect(() => itemSchema.parse(semRestock)).toThrow(/restock/);
    expect(() => itemSchema.parse(semPrice)).toThrow(/price/);
    expect(() => itemSchema.parse(semEffect)).toThrow(/effect/);
  });

  it('recusa consumível que não empilha', () => {
    expect(() => itemSchema.parse({ ...consumable, stackable: false })).toThrow(/stackable/);
  });

  it('recusa `group`/`restock`/`price`/`effect` fora de `kind: consumable`', () => {
    // Zod descartaria em silêncio se o schema fosse aberto: o arquivo pareceria certo e o
    // campo não iria a lugar nenhum.
    const ring = { id: 'life-ring', name: 'Life Ring', kind: 'ring', weight: 1, value: 0 };
    expect(() => itemSchema.parse({ ...ring, restock: { batch: 1, min: 0 } })).toThrow();
    expect(() => itemSchema.parse({ ...ring, group: 'potion' })).toThrow();
    expect(() => itemSchema.parse({ ...ring, price: 10 })).toThrow();
    expect(() => itemSchema.parse({ ...ring, effect: { kind: 'heal', amount: 1 } })).toThrow();
  });
});

describe('o vocabulário v2 do bot (AB-03, ADR 0032)', () => {
  const emptySlots = (): (unknown)[] => Array.from({ length: 24 }, () => null);
  const set = (slots = emptySlots()) => ({ slots });
  const config = (sets: unknown[] = [set(), set(), set(), set()]) => ({ version: 2, sets });

  it('aceita quatro conjuntos de 24 slots, e recusa 3 ou 25', () => {
    expect(botConfigV2Schema.safeParse(config()).success).toBe(true);
    expect(botConfigV2Schema.safeParse(config([set(), set(), set()])).success).toBe(false);
    expect(botConfigV2Schema.safeParse(config([{ slots: [...emptySlots(), null] }, set(), set(), set()]))
      .success).toBe(false);
  });

  it('recusa tecla repetida no conjunto com o path do slot, e recusa F13', () => {
    const duplicated = set([
      { do: { kind: 'spell', spellId: 'heal' }, when: [], hotkey: '1' },
      { do: { kind: 'spell', spellId: 'heal' }, when: [], hotkey: '1' },
      ...emptySlots().slice(2),
    ]);
    const bad = botSetSchema.safeParse(duplicated);
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.path).toEqual(['slots', 1, 'hotkey']);
    }

    const f13 = set([
      { do: { kind: 'spell', spellId: 'heal' }, when: [], hotkey: 'F13' },
      ...emptySlots().slice(1),
    ]);
    expect(botSetSchema.safeParse(f13).success).toBe(false);
  });

  it('aceita `condition` (efeito presente/ausente) e recusa reposição em slot de magia', () => {
    expect(botConditionSchema.safeParse({ kind: 'condition', conditionId: 'haste', present: false })
      .success).toBe(true);

    const restockOnSpell = set([
      { do: { kind: 'spell', spellId: 'heal' }, when: [], restock: { batch: 1, min: 0 } },
      ...emptySlots().slice(1),
    ]);
    const bad = botSetSchema.safeParse(restockOnSpell);
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.path).toEqual(['slots', 0, 'restock']);
    }
  });
});

describe('a política de alvo `follow` (AB-09, ADR 0032 d.5)', () => {
  it('aceita `follow` e recusa string fora da lista', () => {
    // O dropdown ALVO expõe `follow` — "o alvo que o jogador escolheu" —, e a política é
    // conteúdo: uma string que o compilador não conhece não pode entrar.
    expect(botTargetPolicySchema.parse('follow')).toBe('follow');
    expect(botTargetPolicySchema.safeParse('nearest').success).toBe(true);
    expect(botTargetPolicySchema.safeParse('mais-forte').success).toBe(false);
  });
});
