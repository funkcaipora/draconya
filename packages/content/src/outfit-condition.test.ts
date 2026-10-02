// A condição `outfit` no conteúdo (#621, M44-03, ADR 0041 d.1): o vocabulário, a chave reservada,
// a fusão do Canary, a referência por id (nunca arte — invariante 6), a imunidade, o parâmetro de
// monstro das duas magias/runas e o que o catálogo importado entrega.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateBotConfigV2 } from './bot.js';
import { buildContent, ContentError, placeholderAppearances } from './content.js';
import type { RawContent } from './content.js';
import { loadContent } from './load.js';
import { packProblems } from './pack.js';
import {
  appearancesSchema, BOT_SET_COUNT, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, botConfigV2Schema,
  CONDITION_IMMUNITIES, conditionSpecSchema, monsterSchema, OUTFIT_CONDITION_KEY, outfitLookSchema,
  spellEffectSchema, supplySchema,
} from './schemas.js';
import type { BotConfigV2 } from './schemas.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const disguise = (look: unknown, over: Record<string, unknown> = {}) => ({
  key: 'outfit', merge: 'strongest', durationMs: 4_000, effect: { kind: 'outfit', look }, ...over,
});

describe('o vocabulário da condição `outfit`', () => {
  it('a chave reservada é `outfit`, e `outfit` entrou nas imunidades de condição do monstro', () => {
    expect(OUTFIT_CONDITION_KEY).toBe('outfit');
    expect(CONDITION_IMMUNITIES).toContain('outfit');
    expect(monsterSchema.shape.conditionImmunities.parse(['outfit', 'paralyze'])).toEqual(['outfit', 'paralyze']);
  });

  it('o `look` nomeia monstro, item ou chave de objeto — uma forma de cada vez, nunca arte', () => {
    for (const look of [{ monsterId: 'rat' }, { itemId: 'worm' }, { objectKey: 'fallen-tree' }]) {
      expect(outfitLookSchema.safeParse(look).success, JSON.stringify(look)).toBe(true);
    }
    for (const look of [
      {}, { monsterId: '' }, { monsterId: 'rat', itemId: 'worm' }, { monsterId: 'rat', outfitId: 21 },
      { outfitId: 21 }, { appearanceId: 3976 }, { lookType: 21 },
    ]) {
      expect(outfitLookSchema.safeParse(look).success, JSON.stringify(look)).toBe(false);
    }
  });

  it('a condição exige a chave reservada, e só ela — nos dois sentidos', () => {
    expect(conditionSpecSchema.safeParse(disguise({ monsterId: 'rat' })).success).toBe(true);
    // Chave errada para o efeito `outfit`…
    expect(conditionSpecSchema.safeParse(disguise({ monsterId: 'rat' }, { key: 'disfarce' })).success).toBe(false);
    // …e a chave `outfit` para um efeito que não é `outfit`.
    expect(conditionSpecSchema.safeParse({
      key: 'outfit', merge: 'strongest', durationMs: 1_000, effect: { kind: 'buff' },
    }).success).toBe(false);
  });

  it('a fusão é a do Canary (`Condition::updateCondition`): `strongest`, e nenhuma outra', () => {
    for (const merge of ['replace', 'refresh']) {
      expect(conditionSpecSchema.safeParse(disguise({ monsterId: 'rat' }, { merge })).success, merge).toBe(false);
    }
    // Sem `merge` o default do schema é `refresh` — o conteúdo declara `strongest` de propósito.
    const { merge: _merge, ...withoutMerge } = disguise({ monsterId: 'rat' });
    expect(conditionSpecSchema.safeParse(withoutMerge).success).toBe(false);
  });

  it('Creature Illusion e Chameleon Rune são efeitos próprios, com só o prazo', () => {
    expect(spellEffectSchema.parse({ kind: 'illusion', durationMs: 180_000 })).toEqual({ kind: 'illusion', durationMs: 180_000 });
    expect(spellEffectSchema.safeParse({ kind: 'illusion' }).success).toBe(false);
    const rune = supplySchema.parse({
      id: 'chameleon-rune', name: 'Chameleon Rune', price: 210, group: 'support',
      effect: { kind: 'chameleon', durationMs: 200_000 },
    });
    expect(rune.effect).toEqual({ kind: 'chameleon', durationMs: 200_000 });
    expect(supplySchema.safeParse({ ...rune, effect: { kind: 'chameleon' } }).success).toBe(false);
  });
});

describe('o monstro: `illusionable`, o ataque e a defesa `outfit`', () => {
  const rat = {
    id: 'rat', name: 'Rat', recommendedLevel: 1, health: 20, experience: 5, attack: 6, armor: 0,
    attackIntervalMs: 2000, speed: 300, aggroRadius: 4, loot: { items: [] },
  };
  const raw = (monsters: readonly unknown[], over: Partial<RawContent> = {}): RawContent => {
    const base: RawContent = {
      monsters, hunts: [], vocations: [],
      progression: [{
        id: 'baseline', startingHealth: 150, startingMana: 60, startingCapacity: 400,
        healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8, startingSpeed: 300, speedPerLevel: 0,
        regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
        xp: { kind: 'power', base: 20, exponent: 2 },
        deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.56, promotionReduction: 0.3 },
      }],
      combat: [{
        id: 'baseline', dodgeMultiplier: 0.5,
        armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0, manadrain: 0, arcane: 0 },
        minimumDamageFraction: 0.1,
        player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 4, dodgeChance: 0.05 },
      }],
      stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
      party: [{ id: 'baseline', maxMembers: 4 }],
      bot: [{
        id: 'baseline', vocabularyVersion: BOT_VOCABULARY_VERSION, categoryCooldownMs: 1_000,
        slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
      }],
      spells: [], skills: [
        { id: 'melee', name: 'Corpo a Corpo', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5 },
        { id: 'distance', name: 'Distância', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'distance-hit', points: 1 }, damagePerLevel: 0 },
      ],
      weaponFamilies: [
        { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
        { id: 'sword', name: 'Sword', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
        { id: 'distance', name: 'Distance', kind: 'distance', skillId: 'distance', range: 6, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
      ],
      items: [{ id: 'worm', name: 'Worm', kind: 'other', weight: 1, value: 0 }],
      ...over,
    };
    return { appearances: [placeholderAppearances(base)], ...base };
  };
  const ability = (look: unknown) => ({
    id: 'outfit', cadenceMs: 2_000, chance: 0.1, target: { range: 11 }, power: 0, condition: disguise(look),
  });
  const defense = (look: unknown) => ({ id: 'outfit', cadenceMs: 4_000, chance: 0.3, condition: disguise(look) });

  it('`illusionable` é `false` por padrão — o default do Canary — e `true` quando declarado', () => {
    const content = buildContent(raw([rat, { ...rat, id: 'wolf', name: 'Wolf', illusionable: true }]));
    expect(content.monsters.get('rat')?.illusionable).toBe(false);
    expect(content.monsters.get('wolf')?.illusionable).toBe(true);
  });

  it('aceita o ataque e a defesa `outfit` apontando monstro, item e chave de objeto', () => {
    const wolf = { ...rat, id: 'wolf', name: 'Wolf' };
    const content = buildContent(raw([
      rat, wolf,
      { ...rat, id: 'mimic', name: 'Mimic', abilities: [ability({ monsterId: 'wolf' }), { ...ability({ itemId: 'worm' }), id: 'outfit-2' }, { ...ability({ objectKey: 'fallen-tree' }), id: 'outfit-3' }], defenses: [defense({ monsterId: 'rat' })] },
    ]));
    expect(content.monsters.get('mimic')?.abilities.map((entry) => entry.id))
      .toEqual(['outfit', 'outfit-2', 'outfit-3']);
    expect(content.monsters.get('mimic')?.defenses[0]?.condition?.effect).toEqual({ kind: 'outfit', look: { monsterId: 'rat' } });
  });

  it('recusa no boot o `outfit` que aponta monstro ou item que não existe', () => {
    expect(() => buildContent(raw([{ ...rat, abilities: [ability({ monsterId: 'ghost' })] }])))
      .toThrow(/ability "outfit" veste o outfit de monstro "ghost", que não existe no catálogo/);
    expect(() => buildContent(raw([{ ...rat, defenses: [defense({ itemId: 'ghost' })] }])))
      .toThrow(/defense "outfit" veste o outfit de item "ghost", que não existe no catálogo/);
    expect(() => buildContent(raw([{ ...rat, defenses: [defense({ monsterId: 'ghost' })] }]))).toThrow(ContentError);
  });

  it('`objectKey` sem linha em `appearances.looks` é MUDO, nunca erro — a condição vale, só não desenha', () => {
    expect(() => buildContent(raw([{ ...rat, abilities: [ability({ objectKey: 'not-in-the-table' })] }]))).not.toThrow();
  });

  it('a defesa aceita `outfit` como self-buff', () => {
    expect(() => buildContent(raw([rat, { ...rat, id: 'wolf', name: 'Wolf', defenses: [defense({ monsterId: 'rat' })] }]))).not.toThrow();
  });

  it('o monstro imune a `outfit` é aceito, e a linha de `looks` passa pelo inventário do pacote', () => {
    expect(() => buildContent(raw([{ ...rat, conditionImmunities: ['outfit'] }]))).not.toThrow();
    const table = appearancesSchema.parse({
      id: 'baseline', pack: 'p', monsters: {}, looks: { 'fallen-tree': 3976, worm: 99999 },
    });
    const pack = {
      id: 'p', version: 'v', object: [[3976, 3976]], outfit: [[1, 1]], effect: [[1, 1]], missile: [[1, 1]],
    };
    expect(packProblems(table, pack as Parameters<typeof packProblems>[1]))
      .toEqual(['appearances.looks.worm: object 99999 não existe no pacote p']);
  });
});

describe('o parâmetro de monstro da Creature Illusion no bot (`validateBotConfigV2`)', () => {
  const rat = {
    id: 'rat', name: 'Rat', recommendedLevel: 1, health: 20, experience: 5, attack: 6, armor: 0,
    attackIntervalMs: 2000, speed: 300, aggroRadius: 4, loot: { items: [] },
  };
  const monsters = [
    { ...rat, illusionable: true },
    { ...rat, id: 'boss', name: 'Boss' },
    { ...rat, id: 'pet', name: 'Pet', summonable: true, manaCost: 50 },
  ];
  const spells = [
    {
      id: 'illusion', name: 'Creature Illusion', manaCost: 100, cooldownMs: 2_000, group: 'support',
      groupCooldownMs: 2_000, effect: { kind: 'illusion', durationMs: 180_000 },
    },
    { id: 'heal', name: 'Heal', manaCost: 20, cooldownMs: 1_000, effect: { kind: 'heal', amount: 60 } },
    { id: 'summon', name: 'Summon', manaCost: 0, cooldownMs: 1_000, effect: { kind: 'summon' } },
  ];
  const content = buildContent((() => {
    const base: RawContent = {
      monsters, hunts: [], vocations: [],
      progression: [{
        id: 'baseline', startingHealth: 150, startingMana: 60, startingCapacity: 400,
        healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8, startingSpeed: 300, speedPerLevel: 0,
        regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
        xp: { kind: 'power', base: 20, exponent: 2 },
        deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.56, promotionReduction: 0.3 },
      }],
      combat: [{
        id: 'baseline', dodgeMultiplier: 0.5,
        armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0, manadrain: 0, arcane: 0 },
        minimumDamageFraction: 0.1,
        player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 4, dodgeChance: 0.05 },
      }],
      stamina: [{ id: 'baseline', maxMs: 86_400_000, recoveryRatio: 1 }],
      party: [{ id: 'baseline', maxMembers: 4 }],
      bot: [{
        id: 'baseline', vocabularyVersion: BOT_VOCABULARY_VERSION, categoryCooldownMs: 1_000,
        slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
      }],
      spells,
      skills: [
        { id: 'melee', name: 'Corpo a Corpo', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5 },
        { id: 'distance', name: 'Distância', startingLevel: 10, curve: { base: 2, factor: 1 }, gain: { on: 'distance-hit', points: 1 }, damagePerLevel: 0 },
      ],
      weaponFamilies: [
        { id: 'fist', name: 'Fist', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
        { id: 'sword', name: 'Sword', kind: 'melee', skillId: 'melee', range: 1, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
        { id: 'distance', name: 'Distance', kind: 'distance', skillId: 'distance', range: 6, damageType: 'physical', resource: 'none', formula: { levelFactor: 0, spread: 0 } },
      ],
      items: [],
    };
    return { appearances: [placeholderAppearances(base)], ...base };
  })());

  const config = (action: Record<string, unknown>): BotConfigV2 => botConfigV2Schema.parse({
    version: BOT_VOCABULARY_VERSION, activeSet: 0,
    sets: Array.from({ length: BOT_SET_COUNT }, (_, set) => ({
      slots: Array.from({ length: BOT_SLOTS_PER_SET }, (__, slot) => (
        set === 0 && slot === 0 ? { do: action, auto: false } : null
      )),
    })),
  });

  it('a ilusão com um monstro `illusionable` é válida', () => {
    expect(validateBotConfigV2(config({ kind: 'spell', spellId: 'illusion', monsterId: 'rat' }), content)).toEqual([]);
  });

  it('a ilusão SEM monstro, com monstro que não existe ou que não é ilusionável, é recusada com o motivo', () => {
    expect(validateBotConfigV2(config({ kind: 'spell', spellId: 'illusion' }), content))
      .toEqual(['conjunto 1, slot 1: magia "illusion" imita um monstro e precisa de "monsterId"']);
    expect(validateBotConfigV2(config({ kind: 'spell', spellId: 'illusion', monsterId: 'ghost' }), content))
      .toEqual(['conjunto 1, slot 1: monstro "ghost" não existe']);
    expect(validateBotConfigV2(config({ kind: 'spell', spellId: 'illusion', monsterId: 'boss' }), content))
      .toEqual(['conjunto 1, slot 1: monstro "boss" não pode ser imitado']);
  });

  it('o `monsterId` de uma magia que não tem parâmetro é recusado; a invocação segue como era', () => {
    expect(validateBotConfigV2(config({ kind: 'spell', spellId: 'heal', monsterId: 'rat' }), content))
      .toEqual(['conjunto 1, slot 1: "monsterId" só vale numa magia que invoca ou imita um monstro']);
    expect(validateBotConfigV2(config({ kind: 'spell', spellId: 'summon', monsterId: 'pet' }), content)).toEqual([]);
    // Cada magia confere a PRÓPRIA flag: o invocável não é imitável, e o imitável não é invocável.
    expect(validateBotConfigV2(config({ kind: 'spell', spellId: 'illusion', monsterId: 'pet' }), content))
      .toEqual(['conjunto 1, slot 1: monstro "pet" não pode ser imitado']);
    expect(validateBotConfigV2(config({ kind: 'spell', spellId: 'summon', monsterId: 'rat' }), content))
      .toEqual(['conjunto 1, slot 1: monstro "rat" não é invocável']);
  });
});

describe('o catálogo real entrega a condição `outfit`', () => {
  const content = loadContent(DATA);

  it('Creature Illusion (druida e feiticeiro) e a Chameleon Rune, com os números do Canary', () => {
    for (const id of ['creature-illusion-druid', 'creature-illusion-sorcerer']) {
      const spell = content.spells.get(id);
      expect(spell, id).toMatchObject({
        name: 'Creature Illusion', minLevel: 23, manaCost: 100, group: 'support',
        cooldownMs: 2_000, groupCooldownMs: 2_000, effect: { kind: 'illusion', durationMs: 180_000 },
      });
    }
    expect(content.spells.get('creature-illusion-druid')?.vocationId).toBe('druid');
    expect(content.spells.get('creature-illusion-sorcerer')?.vocationId).toBe('sorcerer');
    expect(content.supplies.get('chameleon-rune')).toMatchObject({
      price: 210, group: 'support', cooldownMs: 2_000, groupCooldownMs: 2_000,
      requires: { level: 27, magicLevel: 4 }, effect: { kind: 'chameleon', durationMs: 200_000 },
    });
  });

  it('o rato, o dragão e o Dragon Lord são ilusionáveis (override) e o rotworm não — como o Canary', () => {
    for (const id of ['rat', 'dragon', 'dragon-lord', 'dragon-lord-hatchling']) {
      expect(content.monsters.get(id)?.illusionable, id).toBe(true);
    }
    expect(content.monsters.get('rotworm')?.illusionable).toBe(false);
  });

  it('o ataque `outfit` importado sai como condição não agressiva de poder zero, e a imunidade chega', () => {
    const outfitAbilities = [...content.monsters.values()].flatMap((monster) => monster.abilities
      .filter((entry) => entry.condition?.effect.kind === 'outfit').map((entry) => ({ monster, entry })));
    const outfitDefenses = [...content.monsters.values()].flatMap((monster) => monster.defenses
      .filter((entry) => entry.condition?.effect.kind === 'outfit'));
    expect(outfitAbilities.length).toBeGreaterThan(40);
    expect(outfitDefenses.length).toBeGreaterThan(20);
    for (const { entry } of outfitAbilities) {
      expect(entry.power).toEqual({ min: 0, max: 0 });
      expect(entry.condition?.merge).toBe('strongest');
    }
    expect([...content.monsters.values()].filter((monster) => monster.conditionImmunities.includes('outfit')).length)
      .toBeGreaterThan(30);
  });

  it('as chaves de objeto das ilusões têm a aparência em `appearances.looks`, dentro do pacote (packProblems)', () => {
    const table = content.appearances?.looks ?? {};
    expect(Object.keys(table).length).toBeGreaterThan(0);
    for (const monster of content.monsters.values()) {
      for (const entry of [...monster.abilities, ...monster.defenses]) {
        const effect = entry.condition?.effect;
        if (effect?.kind !== 'outfit' || !('objectKey' in effect.look)) continue;
        expect(table[effect.look.objectKey], `${monster.id} → ${effect.look.objectKey}`).toBeGreaterThan(0);
      }
    }
  });
});
