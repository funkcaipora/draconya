import { describe, expect, it } from 'vitest';
import { botConditionSchema, botConfigV2Schema, botSetSchema, botTargetPolicySchema, huntSchema, itemSchema, spellFormulaSchema } from './schemas.js';

describe('spellFormulaSchema — a fórmula canônica do #474', () => {
  it('aplica o default do levelFactor (1/5) e os bases 0', () => {
    // O arquivo pode declarar só os coeficientes de skill; o resto é o default da referência.
    // Mutação que mata: remover o default e deixar `levelFactor` indefinido no cálculo.
    const parsed = spellFormulaSchema.parse({ skillMin: 1.403, skillMax: 2.203 });
    expect(parsed).toEqual({ levelFactor: 0.2, skillMin: 1.403, skillMax: 2.203, baseMin: 0, baseMax: 0 });
  });

  it('exige os coeficientes de skill', () => {
    expect(() => spellFormulaSchema.parse({ skillMin: 1 })).toThrow();
  });
});


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

describe('itemSchema — o consumível é só a blessing-charge (ADR 0026 d.3)', () => {
  const consumable = {
    id: 'blessing-charge', name: 'Carga de Bênção', kind: 'consumable',
    stackable: false, weight: 1, value: 0, effect: { kind: 'blessing' },
  };

  it('aceita o consumível sem group, sem restock, sem price e sem empilhar', () => {
    // O suprimento virou abstrato: só a bênção (M22) permanece como item consumível, e ela
    // não tem preço, grupo nem reposição. Mutação que mata: exigir `stackable`/`group`.
    const parsed = itemSchema.parse(consumable);
    expect(parsed.kind).toBe('consumable');
    expect(parsed.stackable).toBe(false);
    expect(itemSchema.parse(parsed)).toEqual(parsed);
  });

  it('recusa consumível sem `effect`', () => {
    const { effect: _effect, ...semEffect } = consumable;
    expect(() => itemSchema.parse(semEffect)).toThrow(/effect/);
  });

  it('recusa `effect` fora de `kind: consumable`', () => {
    // Zod descartaria em silêncio se o schema fosse aberto: o arquivo pareceria certo e o
    // campo não iria a lugar nenhum.
    const ring = { id: 'life-ring', name: 'Life Ring', kind: 'ring', weight: 1, value: 0 };
    expect(() => itemSchema.parse({ ...ring, effect: { kind: 'heal', amount: 1 } })).toThrow();
  });

  it('não existe mais `kind: ammo` nem os campos de consumível/ammo no item', () => {
    const ammo = {
      id: 'arrow', name: 'Arrow', kind: 'ammo', slot: 'ammo', stackable: true,
      weight: 0.7, value: 0, attack: 25, price: 1, ammunition: { family: 'arrow' },
    };
    expect(() => itemSchema.parse(ammo)).toThrow();
    const ring = { id: 'life-ring', name: 'Life Ring', kind: 'ring', weight: 1, value: 0 };
    expect(() => itemSchema.parse({ ...ring, price: 10 })).toThrow();
    expect(() => itemSchema.parse({ ...ring, group: 'potion' })).toThrow();
    expect(() => itemSchema.parse({ ...ring, restock: { batch: 1, min: 0 } })).toThrow();
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

  it('aceita `condition` (efeito presente/ausente) e o slot de `supply`', () => {
    expect(botConditionSchema.safeParse({ kind: 'condition', conditionId: 'haste', present: false })
      .success).toBe(true);

    // A ação de slot v2 é `spell | supply`; o `item` de slot saiu (ADR 0026 d.3).
    const supplySlot = set([
      { do: { kind: 'supply', supplyId: 'health-potion' }, when: [] },
      ...emptySlots().slice(1),
    ]);
    expect(botSetSchema.safeParse(supplySlot).success).toBe(true);
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
