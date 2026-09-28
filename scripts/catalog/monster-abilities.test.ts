import { describe, expect, it } from 'vitest';
import { monsterAbilitySchema, monsterDefenseSchema } from '../../packages/content/src/schemas.js';
import type { LuaValue } from './lua-table.js';
import {
  ABILITY_KIND_SUPPORTED, AREA_ROWS_SUPPORTED, CANARY_FIELD_ITEMS, mapSpell, mapSummons, monsterWaveWidths,
  presentationKey, RANDOM_TOTAL_REASON, uniqueIds, type PresentationUse, type SpellMapping,
} from './monster-abilities.js';
import { slugify } from './monsters.js';

// Entradas SINTÉTICAS no formato do Canary — números inventados (ADR 0019/0038 d.7). As
// constantes chegam como texto, como o resolvedor do leitor as entrega (`COMBAT_*` já traduzido).

function map(raw: Record<string, LuaValue>, list: 'attacks' | 'defenses' = 'attacks'): SpellMapping {
  const presentation: PresentationUse[] = [];
  return mapSpell(raw, { monsterId: 'test-beast', list, presentation });
}

function abilityOf(mapping: SpellMapping): Record<string, unknown> {
  if (mapping.kind !== 'ability') throw new Error(`esperava ability, veio ${JSON.stringify(mapping)}`);
  const { kind: _kind, ...rest } = mapping.ability;
  // Toda ability gerada passa no schema da base (o `kind` só sai quando ele existe).
  expect(() => monsterAbilitySchema.parse(mapping.ability)).not.toThrow();
  return rest;
}

describe('monsterWaveWidths (AreaCombat::setupArea(length, spread))', () => {
  it('a onda do Dragon (8, 3) é 1,1,3,3,3,5,5,5 da fileira mais perto para a mais longe', () => {
    expect(monsterWaveWidths(8, 3)).toEqual([1, 1, 3, 3, 3, 5, 5, 5]);
  });

  it('spread 0 é o raio reto; spread maior que o comprimento também é largura 1', () => {
    expect(monsterWaveWidths(5, 0)).toEqual([1, 1, 1, 1, 1]);
    expect(monsterWaveWidths(6, 8)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('comprimento que não é múltiplo do spread começa mais largo perto', () => {
    expect(monsterWaveWidths(4, 2)).toEqual([3, 3, 5, 5]);
  });
});

describe('presentationKey', () => {
  it('é o sufixo em minúsculas, com o alias autoral do Dragon', () => {
    expect(presentationKey('CONST_ANI_FIRE')).toBe('fire');
    expect(presentationKey('CONST_ME_FIREAREA')).toBe('firearea');
    expect(presentationKey('CONST_ME_MAGIC_RED')).toBe('magic-red');
    expect(presentationKey('CONST_ME_MAGIC_BLUE')).toBe('blueshimmer');
    expect(presentationKey('CONST_ME_NONE')).toBeUndefined();
    expect(presentationKey(false)).toBeUndefined();
  });
});

describe('mapSpell — ataques', () => {
  it('melee: min/max, ignora chance e type, e carrega o veneno do golpe (total fixo)', () => {
    const mapping = map({
      name: 'melee', interval: 2000, chance: 50, type: 'fire', minDamage: 0, maxDamage: -40,
      condition: { type: 'CONDITION_POISON', totalDamage: 20, interval: 4000 },
    });
    expect(mapping.kind === 'ability' && mapping.notes).toEqual(['melee.type ignorado (o Canary não lê type em melee)']);
    expect(abilityOf(mapping)).toEqual({
      id: 'melee', cadenceMs: 2000, target: { range: 1 }, power: { min: 0, max: 40 }, damageType: 'physical',
      condition: {
        key: 'poisoned', merge: 'strongest', durationMs: 4000 * 20,
        effect: { kind: 'damage-over-time', form: 'generated', totalDamage: 20, intervalMs: 4000, damageType: 'earth' },
      },
    });
    if (mapping.kind === 'ability') expect(mapping.ability['kind']).toBe(ABILITY_KIND_SUPPORTED ? 'melee' : undefined);
  });

  it('melee por skill/attack (#684): a faixa sai de meleePower, e o 0..0 do Canary é mapeado, não pulado', () => {
    const bySkill = map({ name: 'melee', interval: 2000, chance: 100, skill: 50, attack: 82 });
    expect(bySkill.kind === 'ability' && bySkill.meleeVia).toBe('skill-attack');
    expect(abilityOf(bySkill)).toMatchObject({ id: 'melee', power: { min: 0, max: 247 } });
    const negative = map({ name: 'melee', interval: 2000, chance: 100, skill: 70, attack: -100 });
    expect(negative.kind === 'ability' && negative.meleeVia).toBe('none');
    expect(abilityOf(negative)).toMatchObject({ id: 'melee', power: { min: 0, max: 0 } });
    const oneSide = map({ name: 'melee', interval: 2000, maxDamage: -90 });
    expect(oneSide.kind === 'ability' && oneSide.meleeVia).toBe('none');
    expect(abilityOf(oneSide)).toMatchObject({ id: 'melee', power: { min: 0, max: 0 } });
  });

  it('combat: bola no alvo, estouro no lançador, alvo único à distância, com as chaves de apresentação', () => {
    expect(abilityOf(map({
      name: 'combat', interval: 2000, chance: 15, type: 'fire', minDamage: -60, maxDamage: -140,
      range: 7, radius: 4, shootEffect: 'CONST_ANI_FIRE', effect: 'CONST_ME_FIREAREA', target: true,
    }))).toEqual({
      id: 'fireball', cadenceMs: 2000, chance: 0.15,
      target: { range: 7, area: { shape: 'circle', radius: 4, centered: 'target' } },
      power: { min: 60, max: 140 }, damageType: 'fire',
      presentation: { missileKey: 'fire', impactKey: 'firearea' },
    });
    // Sem `range`: o círculo no lançador alcança o próprio anel (raio 3 → 1 tile).
    expect(abilityOf(map({ name: 'combat', chance: 20, type: 'death', minDamage: -5, maxDamage: -9, radius: 3, target: false })))
      .toMatchObject({ id: 'deathburst', target: { range: 1, area: { shape: 'circle', radius: 3, centered: 'caster' } } });
    // Sem área, `target` não importa: o Canary faz `doCombat(creature, target)`. Sem `range`, a vista.
    expect(abilityOf(map({ name: 'combat', chance: 10, type: 'lifedrain', minDamage: -1, maxDamage: -2, target: false })))
      .toMatchObject({ id: 'lifedrainstrike', target: { range: 11 } });
  });

  it('combat em onda: rows (#679) quando a base aceita, senão a wave antiga com a nota; spread 0 é beam', () => {
    const wave = map({ name: 'combat', chance: 10, type: 'fire', minDamage: -1, maxDamage: -2, length: 8, spread: 3, target: false });
    if (AREA_ROWS_SUPPORTED) {
      expect(abilityOf(wave)).toMatchObject({ id: 'firewave', target: { range: 8, area: { shape: 'rows', widths: [1, 1, 3, 3, 3, 5, 5, 5] } } });
    } else {
      expect(abilityOf(wave)).toMatchObject({ id: 'firewave', target: { range: 8, area: { shape: 'wave', length: 8 } } });
      expect(wave.kind === 'ability' && wave.notes[0]).toContain('TODO #679');
    }
    const beam = map({ name: 'combat', chance: 10, type: 'energy', minDamage: -1, maxDamage: -2, length: 5, spread: 0, range: 3 });
    expect(abilityOf(beam)).toMatchObject({ id: 'energybeam', target: { range: 3 } });
  });

  it('combat que o Draconya não representa não mapeia', () => {
    expect(map({ name: 'combat', type: 'COMBAT_UNDEFINEDDAMAGE', minDamage: -1, maxDamage: -2 }).kind).toBe('unmapped');
    expect(map({ name: 'combat', type: 'fire', length: 5, spread: 3, target: true })).toMatchObject({
      kind: 'unmapped', reason: 'onda/raio com target = true (área direcional centrada no alvo)',
    });
  });

  it('speed paralisa com o speedChange como delta, piso −1000; drunk dura 10 s por padrão', () => {
    expect(abilityOf(map({ name: 'speed', interval: 2000, chance: 15, speedChange: -1500, range: 7, target: true, duration: 20000 })))
      .toEqual({
        id: 'paralyze', cadenceMs: 2000, chance: 0.15, target: { range: 7 }, power: 0, damageType: 'physical',
        condition: { key: 'speed', merge: 'replace', durationMs: 20000, effect: { kind: 'speed', type: 'paralyze', delta: -1000 } },
      });
    expect(abilityOf(map({ name: 'drunk', chance: 10, radius: 4, target: false })))
      .toMatchObject({ id: 'drunk', condition: { key: 'drunk', durationMs: 10000, effect: { kind: 'drunk' } } });
  });

  it('condition: total fixo vira DOT; total sorteado não mapeia; sem dano é só visual', () => {
    expect(abilityOf(map({ name: 'condition', type: 'CONDITION_FIRE', chance: 20, minDamage: -10, maxDamage: -10, radius: 4, target: true })))
      .toMatchObject({
        id: 'burning', power: 0, damageType: 'fire',
        condition: { key: 'burning', effect: { kind: 'damage-over-time', form: 'generated', totalDamage: 10, intervalMs: 2000 } },
      });
    expect(map({ name: 'condition', type: 'CONDITION_POISON', minDamage: -10, maxDamage: -30 }))
      .toEqual({ kind: 'unmapped', name: 'condition', reason: RANDOM_TOTAL_REASON });
    expect(map({ name: 'condition', type: 'CONDITION_ENERGY', radius: 3 }).kind).toBe('dropped');
  });

  it('firefield: o campo 2118 do Canary, centrado no alvo, com id por monstro', () => {
    const ability = abilityOf(map({ name: 'firefield', chance: 10, range: 7, radius: 4, shootEffect: 'CONST_ANI_FIRE', target: true }));
    expect(ability).toEqual({
      id: 'firefield', cadenceMs: 2000, chance: 0.1, target: { range: 7 }, power: 0, damageType: 'fire',
      presentation: { missileKey: 'fire' },
      field: {
        id: 'test-beast-firefield', durationMs: 200000, shape: { shape: 'circle', radius: 4, centered: 'target' },
        condition: CANARY_FIELD_ITEMS['firefield']?.condition,
        stages: CANARY_FIELD_ITEMS['firefield']?.stages,
      },
    });
    expect(map({ name: 'poisonfield', radius: 3, target: false })).toMatchObject({ kind: 'unmapped' });
  });

  it('outfit, effect e strength são descartados; magia com nome não mapeia', () => {
    expect(map({ name: 'outfit', outfitMonster: 'Rat', duration: 5000 }).kind).toBe('dropped');
    expect(map({ name: 'effect', effect: 'CONST_ME_POFF' }).kind).toBe('dropped');
    expect(map({ name: 'strength', effect: 'CONST_ME_POFF' }).kind).toBe('dropped');
    expect(map({ name: 'ice chain', chance: 10 })).toEqual({ kind: 'unmapped', name: 'ice chain', reason: 'magia com nome próprio (script Lua)' });
  });

  it('invisible FORA de defenses não mapeia (#559/#592) — o Canary só o usa em defesa própria', () => {
    expect(map({ name: 'invisible', duration: 3000 })).toEqual({
      kind: 'unmapped', name: 'invisible', reason: 'invisible fora de defenses',
    });
  });
});

describe('mapSpell — defesas', () => {
  it('cura própria e haste passam no monsterDefenseSchema', () => {
    const heal = map({ name: 'combat', interval: 2000, chance: 15, type: 'COMBAT_HEALING', minDamage: 40, maxDamage: 70, effect: 'CONST_ME_MAGIC_BLUE', target: false }, 'defenses');
    expect(heal).toEqual({
      kind: 'defense', notes: [],
      defense: { id: 'heal', cadenceMs: 2000, chance: 0.15, heal: { min: 40, max: 70 }, presentation: { impactKey: 'blueshimmer' } },
    });
    const haste = map({ name: 'speed', interval: 3000, chance: 30, speedChange: 400, duration: 8000 }, 'defenses');
    expect(haste.kind).toBe('defense');
    for (const mapping of [heal, haste]) {
      if (mapping.kind === 'defense') expect(() => monsterDefenseSchema.parse(mapping.defense)).not.toThrow();
    }
  });

  it('cura em área cura outras criaturas — não é a defesa do Draconya', () => {
    expect(map({ name: 'combat', type: 'COMBAT_HEALING', minDamage: 1, maxDamage: 2, radius: 4 }, 'defenses').kind).toBe('unmapped');
  });

  it('invisible (Killer Rabbit) vira self-buff em defenses, com o duration declarado (#559/#592)', () => {
    const invisible = map({ name: 'invisible', interval: 2000, chance: 30, effect: 'CONST_ME_MAGIC_BLUE' }, 'defenses');
    expect(invisible).toEqual({
      kind: 'defense', notes: [],
      defense: {
        id: 'invisible', cadenceMs: 2000, chance: 0.3,
        condition: { key: 'invisible', durationMs: 10_000, effect: { kind: 'invisible' } },
      },
    });
    if (invisible.kind === 'defense') expect(() => monsterDefenseSchema.parse(invisible.defense)).not.toThrow();

    const withDuration = map({ name: 'invisible', interval: 2000, chance: 30, duration: 5_000 }, 'defenses');
    expect(withDuration.kind === 'defense' && withDuration.defense['condition']).toEqual({
      key: 'invisible', durationMs: 5_000, effect: { kind: 'invisible' },
    });
  });
});

describe('uniqueIds e mapSummons', () => {
  it('o segundo id igual ganha sufixo', () => {
    expect(uniqueIds([{ id: 'fireball' }, { id: 'fireball' }, { id: 'melee' }]).map((entry) => entry.id))
      .toEqual(['fireball', 'fireball-2', 'melee']);
  });

  it('a invocação vira summons com chance em fração e count default 1; maxSummons 0 não invoca', () => {
    expect(mapSummons({ maxSummons: 2, summons: [{ name: 'Test Rat', chance: 10, interval: 2000 }] }, slugify)).toEqual({
      summons: { max: 2, entries: [{ monsterId: 'test-rat', intervalMs: 2000, chance: 0.1, count: 1 }] },
      summonedIds: ['test-rat'], problems: [],
    });
    expect(mapSummons({ maxSummons: 0, summons: [{ name: 'Test Rat', chance: 10, interval: 2000 }] }, slugify))
      .toEqual({ summonedIds: [], problems: [] });
  });
});
