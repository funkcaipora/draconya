import { describe, expect, it } from 'vitest';
import type { BotConfigV2, BotSlot } from '@draconya/content';
import {
  BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema, botSlotSchema,
} from '@draconya/content';
import { compileBot } from './bot.js';
import type { BotView, CooldownOfAction } from './bot.js';
import { CharacterRuntime } from './character.js';

// O compilador não lê conteúdo: o grupo e a chave de cooldown chegam prontos pelo `cooldownOf`.
// Este mapa é o conteúdo de mentira dos testes — os números do grupo são o que está sob teste.
const GROUPS: Readonly<Record<string, string>> = {
  cure: 'healing', forte: 'healing', media: 'healing', fraca: 'healing',
  wave: 'attack', finish: 'attack', bolt: 'attack',
  haste: 'support',
  'health-potion': 'potion',
};
const cooldownOf: CooldownOfAction = (action) => {
  const id = action.kind === 'spell' ? action.spellId : action.itemId;
  const group = GROUPS[id];
  return group === undefined
    ? { group: `${action.kind}:${id}`, cooldownKey: `${action.kind}:${id}` }
    : { group, cooldownKey: `group:${group}` };
};

const hero = (health: number, maxHealth = 100, mana = 100, maxMana = 100) =>
  new CharacterRuntime({
    id: 'hero', position: { x: 1, y: 1, z: 7 },
    health, maxHealth, mana, maxMana, level: 1, xp: 0, vocationId: null,
    staminaMs: null, goldDelta: 0, alive: true, cooldowns: {},
  });

const view = (over: Partial<BotView> = {}): BotView => ({
  self: hero(100), targetCount: 0, target: null, ...over,
});

/** Um conjunto da barra: 24 posições, com as dadas na frente e o resto vazio. */
const slotsOf = (given: readonly (Partial<BotSlot> | null)[]): (BotSlot | null)[] => {
  const slots = given.map((slot) => (slot === null ? null : botSlotSchema.parse(slot)));
  while (slots.length < BOT_SLOTS_PER_SET) slots.push(null);
  return slots;
};

const emptySet = () => ({ slots: slotsOf([]) });

const config = (active: readonly (Partial<BotSlot> | null)[], over: Partial<BotConfigV2> = {}): BotConfigV2 =>
  // Pelo SCHEMA, e não por literal: é o schema que sabe preencher os defaults. Um literal aqui
  // obriga toda fixture a acompanhar cada campo novo, que é trabalho que o parse já faz.
  botConfigV2Schema.parse({
    version: BOT_VOCABULARY_VERSION,
    activeSet: 0,
    sets: [{ slots: slotsOf(active) }, emptySet(), emptySet(), emptySet()],
    ...over,
  });

const spell = (id: string, when: Partial<BotSlot>['when'] = []): Partial<BotSlot> => ({
  do: { kind: 'spell', spellId: id }, when,
});

const item = (id: string, when: Partial<BotSlot>['when'] = []): Partial<BotSlot> => ({
  do: { kind: 'item', itemId: id }, when,
});

describe('as condições viram predicado (FUN-80, RG-006)', () => {
  it('hp e mana comparam PERCENTUAL, não valor absoluto', () => {
    const bot = compileBot(config([spell('cure', [{ kind: 'hp', op: '<=', percent: 50 }])]), cooldownOf);
    const slots = bot.groups.get('healing') ?? [];

    expect(slots[0]?.when(view({ self: hero(40, 100) }))).toBe(true);
    // 400 de 1000 é o MESMO 40%, e a regra vale igual.
    expect(slots[0]?.when(view({ self: hero(400, 1000) }))).toBe(true);
    expect(slots[0]?.when(view({ self: hero(60, 100) }))).toBe(false);
  });

  it('target-hp sem alvo é FALSA, e não um erro', () => {
    const bot = compileBot(config([
      spell('finish', [{ kind: 'target-hp', op: '<=', percent: 30 }]),
    ]), cooldownOf);
    const slot = bot.groups.get('attack')?.[0];

    expect(slot?.when(view({ target: null }))).toBe(false);
    expect(slot?.when(view({ target: { health: 20, maxHealth: 100 } }))).toBe(true);
  });

  it('maxHealth zero não divide por zero', () => {
    const bot = compileBot(config([spell('cure', [{ kind: 'hp', op: '<=', percent: 50 }])]), cooldownOf);
    expect(() => bot.groups.get('healing')?.[0]?.when(view({ self: hero(0, 0) }))).not.toThrow();
  });

  it('duas condições usam E (RG-006): todas precisam ser verdadeiras', () => {
    // "HP <= 50 E mana <= 20": com HP baixo e mana cheia o slot NÃO é elegível.
    const bot = compileBot(config([
      spell('cure', [
        { kind: 'hp', op: '<=', percent: 50 },
        { kind: 'mana', op: '<=', percent: 20 },
      ]),
    ]), cooldownOf);
    const when = bot.groups.get('healing')?.[0]?.when;

    expect(when?.(view({ self: hero(40, 100, 100, 100) }))).toBe(false);
    expect(when?.(view({ self: hero(40, 100, 10, 100) }))).toBe(true);
    expect(when?.(view({ self: hero(90, 100, 10, 100) }))).toBe(false);
  });

  it('`when: []` é elegível sempre (RG-007)', () => {
    const bot = compileBot(config([spell('cure')]), cooldownOf);
    expect(bot.groups.get('healing')?.[0]?.when(view())).toBe(true);
  });

  it('`condition` presente/ausente lê o KEY semântico do efeito', () => {
    // "Castar haste só sem haste": `present: false` é falso com o efeito ativo e verdadeiro sem
    // ele; `present: true` é o inverso. Ler o `spellId` em vez do key reprova aqui.
    const sem = compileBot(config([
      spell('haste', [{ kind: 'condition', conditionId: 'haste', present: false }]),
    ]), cooldownOf);
    const com = compileBot(config([
      spell('haste', [{ kind: 'condition', conditionId: 'haste', present: true }]),
    ]), cooldownOf);
    const whenSem = sem.groups.get('support')?.[0]?.when;
    const whenCom = com.groups.get('support')?.[0]?.when;

    const limpo = view({ self: hero(100) });
    expect(whenSem?.(limpo)).toBe(true);
    expect(whenCom?.(limpo)).toBe(false);

    const comHaste = view({ self: hero(100) });
    comHaste.self.conditions.apply({ key: 'haste', spellId: 'haste', expiresAtMs: 2_000 });
    expect(whenSem?.(comHaste)).toBe(false);
    expect(whenCom?.(comHaste)).toBe(true);
  });
});

describe('o grupo e a ordem da barra (RP-002, AB-07)', () => {
  it('agrupa pelo GRUPO do conteúdo, não pela categoria v1', () => {
    const bot = compileBot(config([
      spell('cure'),
      spell('wave'),
      item('health-potion'),
    ]), cooldownOf);

    expect([...bot.groups.keys()]).toEqual(['healing', 'attack', 'potion']);
  });

  it('preserva a ordem da barra DENTRO do grupo (RP-002)', () => {
    // Fileira 1 da esquerda para a direita: `forte` antes de `media` antes de `fraca`.
    const bot = compileBot(config([
      spell('forte'),
      spell('wave'),
      spell('media'),
      spell('fraca'),
    ]), cooldownOf);
    const healing = bot.groups.get('healing') ?? [];

    expect(healing.map((s) => (s.act.kind === 'spell' ? s.act.spellId : '')))
      .toEqual(['forte', 'media', 'fraca']);
  });

  it('ação sem grupo no conteúdo cai num grupo sintético individual (DT-06)', () => {
    const bot = compileBot(config([spell('orfa'), spell('orfa2')]), cooldownOf);

    expect([...bot.groups.keys()]).toEqual(['spell:orfa', 'spell:orfa2']);
  });

  it('`enabled: false` e `auto: false` não entram no automático (RP-004/AB-09)', () => {
    const bot = compileBot(config([
      { do: { kind: 'spell', spellId: 'forte' }, enabled: false },
      { do: { kind: 'spell', spellId: 'media' }, auto: false },
      spell('fraca'),
    ]), cooldownOf);
    const healing = bot.groups.get('healing') ?? [];

    expect(healing.map((s) => (s.act.kind === 'spell' ? s.act.spellId : ''))).toEqual(['fraca']);
  });

  it('o conjunto ATIVO é o que compila; os outros não entram', () => {
    const bot = compileBot(config([spell('cure')], {
      sets: [emptySet(), { slots: slotsOf([spell('wave')]) }, emptySet(), emptySet()],
      activeSet: 1,
    }), cooldownOf);

    expect([...bot.groups.keys()]).toEqual(['attack']);
  });
});

describe('a ponte `swap-ring` até o AB-08 (DT-04)', () => {
  it('a automação swap-ring vira o ringSwap que o ruleset lê', () => {
    const bot = compileBot(config([], {
      automations: [{
        model: 'swap-ring',
        params: { itemId: 'life-ring', manaFloor: 30, restorePrevious: true },
        enter: [{ kind: 'hp', op: '<', percent: 40 }],
        exit: [{ kind: 'hp', op: '>', percent: 70 }],
      }],
    }), cooldownOf);

    expect(bot.ringSwap).toEqual({
      itemId: 'life-ring', equipBelow: 40, removeAbove: 70, manaFloor: 30, restorePrevious: true,
    });
  });

  it('sem automação swap-ring não há ponte', () => {
    expect(compileBot(config([]), cooldownOf).ringSwap).toBeUndefined();
  });
});

describe('compilar é o que torna a avaliação barata', () => {
  it('a ação devolvida é a MESMA referência do slot compilado', () => {
    const bot = compileBot(config([spell('cure')]), cooldownOf);
    const slot = bot.groups.get('healing')?.[0];

    expect(slot?.act).toBe(bot.groups.get('healing')?.[0]?.act);
  });

  it('a view é reaproveitada: mudar o campo muda o resultado, sem recompilar', () => {
    const bot = compileBot(config([spell('cure', [{ kind: 'hp', op: '<=', percent: 50 }])]), cooldownOf);
    const when = bot.groups.get('healing')?.[0]?.when;
    const v = view({ self: hero(40) });

    expect(when?.(v)).toBe(true);
    v.self = hero(90);
    expect(when?.(v)).toBe(false);
  });
});
