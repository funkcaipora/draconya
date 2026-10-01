import { describe, expect, it } from 'vitest';
import {
  ammunitionSchema, appearancesSchema, botConditionSchema, botConfigV2Schema, botSetSchema,
  botTargetPolicySchema, huntSchema, itemSchema, loyaltySchema, monsterSchema, routeSchema, spellAreaSchema,
  spellFormulaSchema, tilemapSchema,
} from './schemas.js';

describe('routeSchema.spawnPoints — `monsters` com peso na mesma posição (#582)', () => {
  const route = (spawnPoints: unknown): unknown => ({
    id: 'r', mapId: 'm', tiles: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], spawnPoints,
  });

  it('aceita `monsters` com dois ou mais candidatos e peso default 1', () => {
    const parsed = routeSchema.parse(route([
      { routeIndex: 0, respawnDelayMs: 1000, monsters: [{ monsterId: 'dragon' }, { monsterId: 'dragon-lord', weight: 3 }] },
    ]));
    expect(parsed.spawnPoints[0]?.monsters).toEqual([
      { monsterId: 'dragon', weight: 1 }, { monsterId: 'dragon-lord', weight: 3 },
    ]);
  });

  it('recusa `monsterId` e `monsters` juntos no mesmo ponto', () => {
    expect(() => routeSchema.parse(route([
      { routeIndex: 0, respawnDelayMs: 1000, monsterId: 'dragon', monsters: [{ monsterId: 'dragon' }, { monsterId: 'wyvern' }] },
    ]))).toThrow(/exclusivos/);
  });

  it('recusa `monsters` com um candidato só — isso é `monsterId`', () => {
    expect(() => routeSchema.parse(route([
      { routeIndex: 0, respawnDelayMs: 1000, monsters: [{ monsterId: 'dragon' }] },
    ]))).toThrow();
  });
});

describe('routeSchema.spawnPoints — obrigatório declarar monstro e respawnDelayMs (#583)', () => {
  const route = (spawnPoints: unknown): unknown => ({
    id: 'r', mapId: 'm', tiles: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], spawnPoints,
  });

  it('recusa ponto sem `monsterId` nem `monsters` — não há mais composição de dificuldade como fallback', () => {
    expect(() => routeSchema.parse(route([{ routeIndex: 0, respawnDelayMs: 1000 }])))
      .toThrow(/monsterId.*OU.*monsters/);
  });

  it('recusa ponto sem `respawnDelayMs`', () => {
    expect(() => routeSchema.parse(route([{ routeIndex: 0, monsterId: 'rat' }])))
      .toThrow();
  });

  it('aceita ponto completo', () => {
    const parsed = routeSchema.parse(route([{ routeIndex: 0, monsterId: 'rat', respawnDelayMs: 2000 }]));
    expect(parsed.spawnPoints[0]).toMatchObject({ monsterId: 'rat', respawnDelayMs: 2000 });
  });
});

describe('spellAreaSchema — rows (#679)', () => {
  it('accepts odd widths, one per row', () => {
    expect(spellAreaSchema.parse({ shape: 'rows', widths: [1, 1, 3, 3, 3] }))
      .toEqual({ shape: 'rows', widths: [1, 1, 3, 3, 3] });
  });

  it('rejects an empty list, an even width and a zero width', () => {
    // Largura par não tem centro na linha da frente: o tile sairia deslocado para um lado.
    expect(() => spellAreaSchema.parse({ shape: 'rows', widths: [] })).toThrow();
    expect(() => spellAreaSchema.parse({ shape: 'rows', widths: [2] })).toThrow();
    expect(() => spellAreaSchema.parse({ shape: 'rows', widths: [0] })).toThrow();
    expect(() => spellAreaSchema.parse({ shape: 'rows', widths: [1, 4, 5] })).toThrow();
  });
});

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


describe('appearancesSchema — o projétil do supply (#478)', () => {
  const table = (supplies: unknown): unknown => ({ id: 'baseline', pack: 'tibia-test', supplies });

  it('aceita `missile` ao lado de `effect` numa runa, e os dois são independentes', () => {
    // A poção declara só `effect`; a runa de ataque declara os dois (#478). Mutação que mata:
    // remover `missile` do objeto de `supplies` — o Zod o descartaria em silêncio e o projétil
    // nunca chegaria ao host.
    const parsed = appearancesSchema.parse(table({
      'avalanche-rune': { effect: 41, missile: 29 },
      'health-potion': { effect: 14 },
    }));
    expect(parsed.supplies['avalanche-rune']).toEqual({ effect: 41, missile: 29 });
    expect(parsed.supplies['health-potion']).toEqual({ effect: 14 });
  });

  it('recusa `missile` não numérico: a linha é id de aparência, nunca caminho de arte', () => {
    // Invariante 6: o arquivo só carrega `appearanceId`. Um caminho de PNG é recusado aqui.
    expect(() => appearancesSchema.parse(table({ rune: { missile: 'sprites/rune.png' } }))).toThrow();
  });
});

describe('huntSchema (#360)', () => {
  const validHunt = {
    id: 'rat-cellars',
    name: 'Rat Cellars',
    recommendedLevel: 1,
    mapId: 'rat-cellars',
    routeId: 'rat-cellars',
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

describe('itemSchema — ML especializado por elemento (#680)', () => {
  const wand = { id: 'eldritch-wand', name: 'Eldritch Wand', kind: 'weapon', slot: 'hand', weight: 20, value: 0 };

  it('aceita pontos por elemento das oito chaves do Canary', () => {
    const parsed = itemSchema.parse({ ...wand, bonuses: { specializedMagicLevel: { fire: 1, energy: 1 } } });
    expect(parsed.bonuses?.specializedMagicLevel).toEqual({ fire: 1, energy: 1 });
  });

  it('recusa elemento sem `<elemento>magiclevelpoints` no Canary, e ponto não positivo', () => {
    expect(() => itemSchema.parse({ ...wand, bonuses: { specializedMagicLevel: { arcane: 1 } } })).toThrow();
    expect(() => itemSchema.parse({ ...wand, bonuses: { specializedMagicLevel: { fire: 0 } } })).toThrow();
  });
});

describe('itemSchema — o consumível é a comida (ADR 0026 d.3, emenda #570)', () => {
  // A carga de bênção (`kind: 'blessing'`) foi REMOVIDA pelo #570: bênção virou serviço de
  // Cidade (ADR 0052), nunca item de mochila. A comida é o consumível real que sobrou, e o
  // catálogo passa a ter EMPILHÁVEL como o comum, não a exceção.
  const consumable = {
    id: 'cheese', name: 'Queijo', kind: 'consumable',
    stackable: true, weight: 1, value: 0, effect: { kind: 'food', durationMs: 12_000 },
  };

  it('aceita o consumível sem group, sem restock e sem price', () => {
    // O suprimento virou abstrato: só comida permanece como item consumível, e ela não tem
    // preço, grupo nem reposição. Mutação que mata: exigir `group`.
    const parsed = itemSchema.parse(consumable);
    expect(parsed.kind).toBe('consumable');
    expect(parsed.stackable).toBe(true);
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

describe('itemSchema — `use.keyId` só em `use.tool: "key"` (#732, ADR 0050 d.6 T2)', () => {
  const key = {
    id: 'brass-key', name: 'Brass Key', kind: 'other' as const, weight: 1, value: 0,
    use: { tool: 'key' as const, keyId: 42 },
  };

  it('aceita a chave com `keyId`', () => {
    const parsed = itemSchema.parse(key);
    expect(parsed.use).toEqual({ tool: 'key', keyId: 42 });
  });

  it('aceita `use.tool: "key"` sem `keyId` (chave que não se pode ligar a uma porta específica)', () => {
    const { use: _use, ...rest } = key;
    const parsed = itemSchema.parse({ ...rest, use: { tool: 'key' } });
    expect(parsed.use).toEqual({ tool: 'key' });
  });

  it('recusa `keyId` numa ferramenta que não é chave — machete não precisa de id nenhum', () => {
    const { use: _use, ...rest } = key;
    expect(() => itemSchema.parse({ ...rest, use: { tool: 'machete', keyId: 1 } })).toThrow(/keyId/);
  });
});

describe('tilemapSchema.interactables — `reward` só em `kind: "chest"` (#733, ADR 0050 d.6 T2)', () => {
  const mapOf = (interactable: Record<string, unknown>): Record<string, unknown> => ({
    id: 'm', z: 0, grid: ['...'], interactables: [{
      at: { x: 0, y: 0, z: 0 }, initialState: 'default', appearanceKey: 'chest-1', ...interactable,
    }],
  });

  it('aceita `reward` num baú', () => {
    const parsed = tilemapSchema.parse(mapOf({ kind: 'chest', uid: 1, reward: { itemId: 'sword' } }));
    // `quantity` tem default 1 — um baú sem quantidade declarada dá exatamente uma unidade.
    expect(parsed.interactables[0]?.reward).toEqual({ itemId: 'sword', quantity: 1 });
  });

  it('aceita quantidade explícita', () => {
    const parsed = tilemapSchema.parse(
      mapOf({ kind: 'chest', uid: 1, reward: { itemId: 'sword', quantity: 3 } }),
    );
    expect(parsed.interactables[0]?.reward).toEqual({ itemId: 'sword', quantity: 3 });
  });

  it('recusa `reward` fora de `chest` — uma porta não entrega item', () => {
    expect(() => tilemapSchema.parse(
      mapOf({ kind: 'quest-door', initialState: 'closed', reward: { itemId: 'sword' } }),
    )).toThrow(/reward/);
  });

  it('baú sem `reward` é válido — nem todo baú deste recorte já tem prêmio configurado', () => {
    const parsed = tilemapSchema.parse(mapOf({ kind: 'chest', uid: 1 }));
    expect(parsed.interactables[0]?.reward).toBeUndefined();
  });
});

// A proveniência de uma entidade GERADA pelo importador de catálogo (ADR 0038 decisão 2, #572):
// `itemSchema`/`monsterSchema`/`ammunitionSchema` são `z.strictObject` — sem um `source` EXPLÍCITO,
// a primeira entidade que #573 (itens) ou M35 (monstros) gerar derrubaria o boot inteiro.
describe('o campo "source" da entidade GERADA (ADR 0038 decisão 2)', () => {
  const source = { engine: 'canary' as const, commit: 'a'.repeat(40), path: 'items.xml' };

  it('itemSchema aceita `source` — a forma que scripts/catalog/generated-writer.ts escreve', () => {
    const item = {
      id: 'imported-a', name: 'Imported A', kind: 'other', weight: 1, value: 1, source,
    };
    expect(itemSchema.parse(item).source).toEqual(source);
  });

  it('monsterSchema aceita `source`', () => {
    const monster = {
      id: 'imported-rat', name: 'Imported Rat', recommendedLevel: 1, health: 20, experience: 5,
      attack: 5, armor: 0, attackIntervalMs: 2000, speed: 172, aggroRadius: 11,
      source: { ...source, path: 'monster/rodents/rat.lua' },
    };
    expect(monsterSchema.parse(monster).source).toEqual({ ...source, path: 'monster/rodents/rat.lua' });
  });

  it('ammunitionSchema aceita `source`', () => {
    const ammo = {
      id: 'imported-arrow', name: 'Imported Arrow', family: 'arrow', attack: 5, price: 1, source,
    };
    expect(ammunitionSchema.parse(ammo).source).toEqual(source);
  });

  it('`source` continua opcional — item autoral (sem importador) não precisa dele', () => {
    const item = { id: 'backpack', name: 'Backpack', kind: 'container', weight: 1, value: 0 };
    expect(itemSchema.parse(item).source).toBeUndefined();
  });

  it('`source` incompleto (sem "commit") é recusado — proveniência não é "o que der"', () => {
    const item = {
      id: 'imported-a', name: 'Imported A', kind: 'other', weight: 1, value: 1,
      source: { engine: 'canary', path: 'items.xml' },
    };
    expect(() => itemSchema.parse(item)).toThrow();
  });
});

// `pushable`/`canPushCreatures`/`canPushItems` (M29-08, #544): empurrar criatura, monstro
// empurrável e esmagamento. Os defaults são os do Canary (`monsters.hpp:137-139`), e um monstro
// sem os três campos precisa continuar bit a bit idêntico ao de antes desta issue.
describe('monsterSchema — pushable/canPushCreatures/canPushItems (M29-08, #544)', () => {
  const base = {
    id: 'rat', name: 'Rat', health: 20, experience: 5,
    attack: 5, armor: 0, attackIntervalMs: 2000, speed: 172, aggroRadius: 11,
  };

  it('ausentes: `pushable` é `true`, `canPushCreatures`/`canPushItems` são `false` — os defaults do Canary', () => {
    const parsed = monsterSchema.parse(base);
    expect(parsed.pushable).toBe(true);
    expect(parsed.canPushCreatures).toBe(false);
    expect(parsed.canPushItems).toBe(false);
  });

  it('declarados explicitamente, os três valores sobrevivem à validação', () => {
    const parsed = monsterSchema.parse({
      ...base, pushable: false, canPushCreatures: true, canPushItems: true,
    });
    expect(parsed.pushable).toBe(false);
    expect(parsed.canPushCreatures).toBe(true);
    expect(parsed.canPushItems).toBe(true);
  });
});

describe('loyaltySchema — a tabela de idade da conta (#628, ADR 0052 d.5)', () => {
  const base = {
    id: 'baseline', enabled: true, pointsPerCreationDay: 1, bonusPercentageMultiplier: 1,
    tiers: [{ minPoints: 360, percent: 5 }, { minPoints: 720, percent: 10 }],
  };

  it('aceita degraus em ordem crescente de minPoints', () => {
    expect(loyaltySchema.safeParse(base).success).toBe(true);
  });

  it('recusa degraus fora de ordem ou repetidos — o laço do Canary fica com o ÚLTIMO que cabe', () => {
    // Fora de ordem daria o percentual do degrau ERRADO em silêncio: 720 pontos cairiam no de 5 %.
    expect(loyaltySchema.safeParse({
      ...base, tiers: [{ minPoints: 720, percent: 10 }, { minPoints: 360, percent: 5 }],
    }).success).toBe(false);
    expect(loyaltySchema.safeParse({
      ...base, tiers: [{ minPoints: 360, percent: 5 }, { minPoints: 360, percent: 10 }],
    }).success).toBe(false);
  });

  it('recusa tabela vazia, percentual não inteiro ou zero, e multiplicador negativo', () => {
    expect(loyaltySchema.safeParse({ ...base, tiers: [] }).success).toBe(false);
    expect(loyaltySchema.safeParse({ ...base, tiers: [{ minPoints: 360, percent: 5.5 }] }).success).toBe(false);
    expect(loyaltySchema.safeParse({ ...base, tiers: [{ minPoints: 360, percent: 0 }] }).success).toBe(false);
    expect(loyaltySchema.safeParse({ ...base, bonusPercentageMultiplier: -1 }).success).toBe(false);
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
