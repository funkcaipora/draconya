import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { bestiaryEntrySchema, MONSTER_CLASSES, monsterSchema } from '../../packages/content/src/schemas.js';
import { readSourceCommit } from './env.js';
import type { CatalogEntity } from './generated-writer.js';
import {
  BESTIARY_CLASS_MAP, CANARY_LOOT_CHANCE_SCALE, convertMonster, listMonsterFiles, loadReaderDeps,
  lootChance, readMonsterCatalog, readTfsSpeeds, slugify, type MonsterReaderDeps,
} from './monsters.js';
import type { CatalogImportContext } from './registry.js';
import { ABILITY_KIND_SUPPORTED } from './monster-abilities.js';

/** A ability esperada, com o `kind` do #682 só quando o schema desta base o declara. */
function withKind(ability: Record<string, unknown>, kind: 'melee' | 'combat'): Record<string, unknown> {
  return ABILITY_KIND_SUPPORTED ? { ...ability, kind } : ability;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMIT = 'c'.repeat(40);

/** A entidade de staging sem os dois campos que o #580 separa — o que vai para `data/monsters`. */
function asMonster(entity: CatalogEntity): Record<string, unknown> {
  const { bestiary: _bestiary, outfitId: _outfitId, ...monster } = entity as Record<string, unknown>;
  return monster;
}

// Fixture SINTÉTICA no formato do Canary — números inventados, nunca um arquivo real copiado
// (ADR 0019/0038 d.7).
const DRAKE = `
local mType = Game.createMonsterType("Test Drake")
local monster = {}
monster.description = "a test drake"
monster.experience = 700
monster.outfit = { lookType = 34, lookHead = 0 }
monster.events = { "SomeEvent" }
monster.raceId = 34
monster.Bestiary = {
  class = "Dragon", race = BESTY_RACE_DRAGON, toKill = 1000, FirstUnlock = 50, SecondUnlock = 500,
  CharmsPoints = 25, Stars = 3, Occurrence = 0, Locations = "far \\z
    away",
}
monster.health = 1000
monster.maxHealth = 1000
monster.corpse = 1
monster.speed = 86
monster.changeTarget = { interval = 4000, chance = 10 }
monster.strategiesTarget = { nearest = 70, health = 10, damage = 10, random = 10 }
monster.flags = {
  pushable = false, staticAttackChance = 80, targetDistance = 1, runHealth = 300,
  isBlockable = false, canWalkOnEnergy = true, canWalkOnFire = false, canWalkOnPoison = true,
}
monster.loot = {
  { name = "gold coin", chance = 89920, maxCount = 102 },
  { name = "platinum coin", chance = 5000, maxCount = 2 },
  { name = "dragon ham", chance = 66270, maxCount = 2 },
  { id = 3449, chance = 8060, maxCount = 10 },
  { name = "Dragon's Tail", chance = 1 },
}
monster.attacks = {
  { name = "melee", interval = 2000, chance = 100, minDamage = 0, maxDamage = -120 },
}
monster.defenses = { defense = 30, armor = 25, mitigation = 0.99 }
monster.elements = {
  { type = COMBAT_PHYSICALDAMAGE, percent = 0 },
  { type = COMBAT_EARTHDAMAGE, percent = 80 },
  { type = COMBAT_FIREDAMAGE, percent = 100 },
  { type = COMBAT_ICEDAMAGE, percent = -10 },
  { type = COMBAT_DROWNDAMAGE, percent = -250 },
  { type = COMBAT_HOLYDAMAGE, percent = 150 },
}
monster.immunities = { { type = "paralyze", condition = true } }
mType:register(monster)
`;

const RAT = `
local mType = Game.createMonsterType("Test Rat")
local monster = {}
monster.experience = 5
monster.outfit = { lookType = 21 }
monster.Bestiary = { class = "Mammal", race = BESTY_RACE_MAMMAL, toKill = 250, FirstUnlock = 10,
  SecondUnlock = 100, CharmsPoints = 5, Stars = 1, Occurrence = 0 }
monster.health = 20
monster.maxHealth = 20
monster.speed = 67
monster.flags = { targetDistance = 0 }
monster.loot = { { name = "platinum coin", chance = 10000, maxCount = 3 } }
monster.attacks = { { name = "melee", interval = 2000, chance = 100, skill = 10, attack = 20 } }
monster.defenses = { defense = 5, armor = 1 }
monster.elements = {}
monster.immunities = {}
mType:register(monster)
`;

const SPITTER = `
local mType = Game.createMonsterType("Test Spitter")
local monster = {}
monster.outfit = { lookType = 21 }
monster.health = 50
monster.maxHealth = 50
monster.speed = 80
monster.attacks = {
  { name = "melee", interval = 2000, chance = 100, minDamage = 0, maxDamage = -10 },
  { name = "combat", interval = 2000, chance = 10, type = COMBAT_EARTHDAMAGE, minDamage = -5, maxDamage = -9, range = 7 },
}
monster.defenses = { defense = 1, armor = 1, { name = "speed", interval = 2000, chance = 10 } }
mType:register(monster)
`;

const FAMILIAR = `
local mType = Game.createMonsterType("Test Familiar")
local monster = {}
monster.outfit = { lookType = 21 }
monster.health = 50
monster.maxHealth = 50
monster.speed = 80
mType:register(monster)
`;

// Invoca um monstro que não é gerado (o Test Wraith está fora do pacote) — sai junto.
const SUMMONER = `
local mType = Game.createMonsterType("Test Summoner")
local monster = {}
monster.outfit = { lookType = 21 }
monster.health = 50
monster.maxHealth = 50
monster.speed = 80
monster.summon = { maxSummons = 2, summons = { { name = "Test Wraith", chance = 10, interval = 2000 } } }
mType:register(monster)
`;

// Invoca o Test Rat, que é gerado.
const RAT_CALLER = `
local mType = Game.createMonsterType("Test Rat Caller")
local monster = {}
monster.outfit = { lookType = 21 }
monster.health = 50
monster.maxHealth = 50
monster.speed = 80
monster.summon = { maxSummons = 1, summons = { { name = "Test Rat", chance = 20, interval = 3000, count = 1 } } }
mType:register(monster)
`;

const OUT_OF_PACK = `
local mType = Game.createMonsterType("Test Wraith")
local monster = {}
monster.outfit = { lookType = 9999 }
monster.health = 50
monster.maxHealth = 50
monster.speed = 80
mType:register(monster)
`;

const ITEMS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<items>
  <item id="3449" article="a" name="burst arrow" />
  <item fromid="10" toid="12" name="ranged thing" />
</items>
`;

const TFS_DRAKE = `<?xml version="1.0" encoding="UTF-8"?>
<monster name="Test Drake" nameDescription="a test drake" race="blood" experience="700" speed="170">
</monster>
`;

let workdir: string | undefined;

afterEach(() => {
  if (workdir !== undefined) { rmSync(workdir, { recursive: true, force: true }); workdir = undefined; }
});

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function fixture(withTfs: boolean): CatalogImportContext {
  workdir = mkdtempSync(join(tmpdir(), 'catalog-monsters-'));
  const canary = join(workdir, 'canary');
  const tfs = join(workdir, 'tfs');
  const monsters = join(canary, 'data-otservbr-global', 'monster');
  write(join(monsters, 'dragons', 'test_drake.lua'), DRAKE);
  write(join(monsters, 'mammals', 'test_rat.lua'), RAT);
  write(join(monsters, 'vermins', 'test_spitter.lua'), SPITTER);
  write(join(monsters, 'familiars', 'test_familiar.lua'), FAMILIAR);
  write(join(monsters, 'undeads', 'test_wraith.lua'), OUT_OF_PACK);
  write(join(monsters, 'undeads', 'test_summoner.lua'), SUMMONER);
  write(join(monsters, 'mammals', 'test_rat_caller.lua'), RAT_CALLER);
  write(join(canary, 'data', 'items', 'items.xml'), ITEMS_XML);
  if (withTfs) write(join(tfs, 'data', 'monster', 'monsters', 'test drake.xml'), TFS_DRAKE);
  return {
    canaryDir: canary, forgottenServerDir: tfs, canaryCommit: COMMIT,
    forgottenServerCommit: withTfs ? 'f'.repeat(40) : '',
  };
}

function deps(ctx: CatalogImportContext): MonsterReaderDeps {
  return loadReaderDeps(ctx, REPO_ROOT);
}

describe('slugify', () => {
  it('bate com os ids autorais: apóstrofo some, espaço vira hífen, acento cai', () => {
    expect(slugify("Dragon's Tail")).toBe('dragons-tail');
    expect(slugify('Dragon Lord')).toBe('dragon-lord');
    expect(slugify('Pássaro  do Mar')).toBe('passaro-do-mar');
  });
});

describe('lootChance', () => {
  it('é a fração sobre 100 000, e volta EXATA ao número do Lua', () => {
    expect(lootChance(89920)).toBe(0.8992);
    for (const raw of [1, 7, 110, 89920, 99999, 100000]) {
      expect(Math.round(lootChance(raw) * CANARY_LOOT_CHANCE_SCALE)).toBe(raw);
    }
  });
});

describe('MONSTER_CLASSES', () => {
  it('tem as 20 classes do Bestiário do Canary, e o leitor só produz valores dela', () => {
    expect(MONSTER_CLASSES).toHaveLength(20);
    for (const mapped of BESTIARY_CLASS_MAP.values()) {
      expect(MONSTER_CLASSES).toContain(mapped);
    }
    expect(BESTIARY_CLASS_MAP.get('Dragon')).toBe('dragon');
  });
});

describe('readTfsSpeeds', () => {
  it('lê o speed da tag <monster> por nome, em minúsculas', () => {
    const ctx = fixture(true);
    expect(readTfsSpeeds(ctx.forgottenServerDir)).toEqual(new Map([['test drake', 170]]));
  });

  it('sem checkout do TFS devolve mapa vazio, nunca lança', () => {
    expect(readTfsSpeeds('/nao/existe')).toEqual(new Map());
  });
});

describe('convertMonster (fixture sintética)', () => {
  it('mapeia stats, flags, elementos, loot e Bestiário do Test Drake', () => {
    const ctx = fixture(false);
    const text = readFileSync(join(ctx.canaryDir, 'data-otservbr-global/monster/dragons/test_drake.lua'), 'utf8');
    const converted = convertMonster(text, 'data-otservbr-global/monster/dragons/test_drake.lua', 'dragons', COMMIT, deps(ctx));

    expect(converted.blockers).toEqual([]);
    const entity = converted.entity as Record<string, unknown>;
    expect(entity).toMatchObject({
      id: 'test-drake', name: 'Test Drake', class: 'dragon', health: 1000, experience: 700,
      attack: { min: 0, max: 120 }, attackIntervalMs: 2000, armor: 25, defense: 30, defenseMitigation: 0.99,
      speed: 172, aggroRadius: 11, targetDistance: 1, blockable: false,
      canWalkOnFire: false, canWalkOnPoison: true, canWalkOnEnergy: true,
      targetChange: { intervalMs: 4000, chance: 0.1 },
      targetStrategy: { nearest: 70, health: 10, damage: 10, random: 10 },
      runOnHealth: 300, staticAttack: 0.8, outfitId: 34,
      source: { engine: 'canary', commit: COMMIT, path: 'data-otservbr-global/monster/dragons/test_drake.lua' },
      bestiary: {
        class: 'dragon', race: 'dragon', raceId: 34, toKill: 1000, firstUnlock: 50, secondUnlock: 500,
        charmsPoints: 25, stars: 3, occurrence: 0,
      },
    });
    // 100 % e acima viram imunidade (nunca `resistance = 1`, DT-02); abaixo de −100 % recorta
    // em −100 % até o #683.
    expect(entity['mitigation']).toEqual({
      resistances: { earth: 0.8, ice: -0.1, drown: -1 },
      immunities: ['fire', 'holy'],
    });
    expect(converted.notes.clampedWeaknesses).toEqual(['drown -250%']);
    expect(converted.notes.elementImmunities).toEqual(['fire 100%', 'holy 150%']);
  });

  it('loot: gold coin vira loot.gold, a moeda extra vai para o relatório, id resolve pelo items.xml', () => {
    const ctx = fixture(false);
    const text = readFileSync(join(ctx.canaryDir, 'data-otservbr-global/monster/dragons/test_drake.lua'), 'utf8');
    const converted = convertMonster(text, 'x/dragons/test_drake.lua', 'dragons', COMMIT, deps(ctx));
    expect(converted.entity['loot']).toEqual({
      rollModel: 'canary',
      gold: { chance: 0.8992, min: 1, max: 102 },
      items: [
        { itemId: 'dragon-ham', chance: 0.6627, min: 1, max: 2 },
        { itemId: 'burst-arrow', chance: 0.0806, min: 1, max: 10 },
        { itemId: 'dragons-tail', chance: 0.00001 },
      ],
    });
    expect(converted.notes.droppedCoinLines).toEqual(['platinum coin 1–2 @ 0.05']);
  });

  it('platinum sozinha vira gold ×100; melee por skill/attack usa a fórmula do Canary', () => {
    const ctx = fixture(false);
    const text = readFileSync(join(ctx.canaryDir, 'data-otservbr-global/monster/mammals/test_rat.lua'), 'utf8');
    const converted = convertMonster(text, 'x/mammals/test_rat.lua', 'mammals', COMMIT, deps(ctx));
    expect(converted.blockers).toEqual([]);
    expect(converted.entity).toMatchObject({
      id: 'test-rat', class: 'mammal', speed: 134, targetDistance: 1,
      attack: { min: 0, max: 20 },
      loot: { rollModel: 'canary', gold: { chance: 0.1, min: 100, max: 300 }, items: [] },
    });
    // O melee por skill/attack é mapeado (#684): nunca cai em "sem mapeador".
    expect(converted.notes.unmappedSpells).toEqual([]);
    expect(converted.notes.meleeVia).toEqual(['skill-attack']);
  });

  it('defesa sem mapeador e outfit fora do pacote bloqueiam a geração; o combat mapeia', () => {
    const ctx = fixture(false);
    const spitter = convertMonster(SPITTER, 'x/vermins/test_spitter.lua', 'vermins', COMMIT, deps(ctx));
    expect(spitter.blockers).toEqual([
      'sem mapeador: speed (speed de defesa sem speedChange positivo)',
    ]);
    expect(spitter.entity['abilities']).toEqual([
      withKind({ id: 'melee', cadenceMs: 2000, target: { range: 1 }, power: { min: 0, max: 10 }, damageType: 'physical' }, 'melee'),
      withKind({ id: 'earthstrike', cadenceMs: 2000, chance: 0.1, target: { range: 7 }, power: { min: 5, max: 9 }, damageType: 'earth' }, 'combat'),
    ]);
    const wraith = convertMonster(OUT_OF_PACK, 'x/undeads/test_wraith.lua', 'undeads', COMMIT, deps(ctx));
    expect(wraith.blockers).toEqual(['outfit 9999 fora do pacote 13.32']);
  });

  it('velocidade: o TFS quando tem o mesmo monstro, senão Canary × 2', () => {
    const ctx = fixture(true);
    const text = readFileSync(join(ctx.canaryDir, 'data-otservbr-global/monster/dragons/test_drake.lua'), 'utf8');
    const converted = convertMonster(text, 'x/dragons/test_drake.lua', 'dragons', COMMIT, deps(ctx));
    expect(converted.entity['speed']).toBe(170);
    expect(converted.notes.speedSource).toBe('tfs');
  });
});

describe('readMonsterCatalog (fixture sintética)', () => {
  it('fatia por pasta do Canary, pula familiars/, e manda o bloqueado ao relatório', () => {
    const ctx = fixture(false);
    expect(listMonsterFiles(ctx.canaryDir)).not.toContain('data-otservbr-global/monster/familiars/test_familiar.lua');
    const catalog = readMonsterCatalog(ctx, deps(ctx));

    expect([...catalog.slices.keys()].sort()).toEqual(['dragons', 'mammals']);
    expect(catalog.slices.get('dragons')?.map((entity) => entity.id)).toEqual(['test-drake']);
    expect(catalog.skipped.map((entity) => entity.id).sort()).toEqual(['test-spitter', 'test-summoner', 'test-wraith']);
    // A invocação de monstro não gerado leva o invocador junto; a de monstro gerado fica.
    expect(catalog.skipped.find((entity) => entity.id === 'test-summoner')?.reason).toBe('invoca monstro não gerado: test-wraith');
    expect(catalog.slices.get('mammals')?.find((entity) => entity.id === 'test-rat-caller')?.['summons']).toEqual({
      max: 1, entries: [{ monsterId: 'test-rat', intervalMs: 3000, chance: 0.2, count: 1 }],
    });
    expect(catalog.notes?.some((note) => note.startsWith('Cobertura (M35-02)'))).toBe(true);
    expect(catalog.notes?.some((note) => note.includes('`speed` 1 (speed de defesa sem speedChange positivo)'))).toBe(true);
    expect(catalog.notes?.some((note) => note.includes('Canary × 2'))).toBe(true);
  });

  it('toda entidade gerada passa no monsterSchema e no bestiaryEntrySchema', () => {
    const ctx = fixture(false);
    const catalog = readMonsterCatalog(ctx, deps(ctx));
    for (const entities of catalog.slices.values()) {
      for (const entity of entities) {
        expect(() => monsterSchema.parse(asMonster(entity))).not.toThrow();
        if (entity['bestiary'] !== undefined) expect(() => bestiaryEntrySchema.parse(entity['bestiary'])).not.toThrow();
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Contra o checkout real, quando ele está nesta máquina (`CANARY_DIR`) — pulado no CI.

const CANARY_DIR = process.env['CANARY_DIR'];
const HAS_CANARY = CANARY_DIR !== undefined && CANARY_DIR !== ''
  && existsSync(join(CANARY_DIR, 'data-otservbr-global', 'monster'));

describe.skipIf(!HAS_CANARY)('leitor contra o Canary real (CANARY_DIR)', () => {
  const ctx: CatalogImportContext = {
    canaryDir: CANARY_DIR ?? '', forgottenServerDir: '/nao/existe',
    canaryCommit: HAS_CANARY ? readSourceCommit(CANARY_DIR ?? '') : '', forgottenServerCommit: '',
  };

  function convertReal(path: string) {
    const full = join(ctx.canaryDir, 'data-otservbr-global/monster', path);
    return convertMonster(readFileSync(full, 'utf8'), `data-otservbr-global/monster/${path}`, path.split('/')[0] ?? '', ctx.canaryCommit, deps(ctx));
  }

  it('Dragon 172, Dragon Lord 200 e Rat 134 na escala do TFS; gold do Dragon exato; classe dragon', () => {
    const dragon = convertReal('dragons/dragon.lua');
    expect(dragon.entity['speed']).toBe(172);
    expect(dragon.entity['class']).toBe('dragon');
    const loot = dragon.entity['loot'] as { gold: { chance: number } };
    expect(Math.round(loot.gold.chance * CANARY_LOOT_CHANCE_SCALE)).toBe(89920);
    expect(convertReal('dragons/dragon_lord.lua').entity['speed']).toBe(200);
    expect(convertReal('mammals/rat.lua').entity['speed']).toBe(134);
  });

  it('o Dragon gerado bate com o dragon.json autoral do #520 — onda de fogo, bola e cura', () => {
    const dragon = convertReal('dragons/dragon.lua');
    expect(dragon.blockers).toEqual([]);
    const generated = monsterSchema.parse(asMonster(dragon.entity));
    const authored = monsterSchema.parse(JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/content/data/monsters/dragon.json'), 'utf8'),
    ) as unknown);
    // A ÚNICA diferença, e justificada: o Canary não declara `range` na onda (sem limite além da
    // vista, `Monster::canUseSpell`); o leitor usa o comprimento da onda (8), e o autoral usou 7.
    // Nenhum dos dois é número do Tibia — é o preenchimento que o schema exige.
    const firewave = generated.abilities?.find((ability) => ability.id === 'firewave');
    expect(firewave?.target.range).toBe(8);
    const aligned = generated.abilities?.map((ability) => {
      const { kind: _kind, ...rest } = ability as typeof ability & { kind?: string };
      return ability.id === 'firewave' ? { ...rest, target: { ...rest.target, range: 7 } } : rest;
    });
    expect(aligned).toEqual(authored.abilities);
    for (const field of [
      'class', 'health', 'experience', 'attack', 'attackIntervalMs', 'armor', 'defense', 'defenseMitigation',
      'damageType', 'mitigation', 'critChance', 'speed', 'aggroRadius', 'attackRange', 'targetDistance',
      'blockable', 'defenses', 'targetChange', 'targetStrategy', 'runOnHealth', 'staticAttack', 'summons',
    ] as const) {
      expect(generated[field], field).toEqual(authored[field]);
    }
  });

  it('o Slime invoca Slime (maxSummons 3, chance 10, intervalo 2000, até 3)', () => {
    const slime = convertReal('slimes/slime.lua');
    expect(slime.blockers).toEqual([]);
    expect(slime.entity['summons']).toEqual({
      max: 3, entries: [{ monsterId: 'slime', intervalMs: 2000, chance: 0.1, count: 3 }],
    });
  });

  it('as chaves de apresentação do Dragon resolvem para os ids que a tabela de aparências já tem', () => {
    const readerDeps = deps(ctx);
    const appearances = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/content/data/appearances/baseline.json'), 'utf8')) as {
      abilities: Record<string, { missile?: number; effect?: number }>;
    };
    const dragon = convertReal('dragons/dragon.lua');
    const uses = dragon.notes.presentation;
    expect(uses.map((use) => use.key).sort()).toEqual(['blueshimmer', 'fire', 'firearea', 'firearea']);
    for (const use of uses) {
      const id = use.role === 'missile' ? readerDeps.missileIds.get(use.constant) : readerDeps.effectIds.get(use.constant);
      expect(id, use.key).toBe(appearances.abilities[use.key]?.[use.role]);
    }
  });

  it('toda chance de loot lida volta EXATA ao inteiro do Lua, e todo gerado passa nos schemas', () => {
    const catalog = readMonsterCatalog(ctx, deps(ctx));
    for (const monster of catalog.converted) {
      const loot = monster.entity['loot'] as { gold?: { chance: number }; items?: { chance: number }[] } | undefined;
      for (const line of [...(loot?.items ?? []), ...(loot?.gold === undefined ? [] : [loot.gold])]) {
        const back = Math.round(line.chance * CANARY_LOOT_CHANCE_SCALE);
        expect(back / CANARY_LOOT_CHANCE_SCALE).toBe(line.chance);
      }
    }
    for (const entities of catalog.slices.values()) {
      for (const entity of entities) {
        const parsed = monsterSchema.safeParse(asMonster(entity));
        expect(parsed.success, `${entity.id}: ${parsed.error?.message ?? ''}`).toBe(true);
        // As regras que o `buildContent` confere além do schema (#518/CMB-07): id de ability
        // único e fora do `basic`, área de monstro só circle/wave/beam/rows, campo só círculo.
        const abilities = parsed.data?.abilities ?? [];
        expect(new Set(abilities.map((ability) => ability.id)).size, entity.id).toBe(abilities.length);
        for (const ability of abilities) {
          expect(ability.id).not.toBe('basic');
          if (ability.target.area !== undefined) expect(['circle', 'wave', 'beam', 'rows']).toContain(ability.target.area.shape);
          if (ability.field !== undefined) expect(ability.field.shape.shape).toBe('circle');
        }
        if (entity['bestiary'] !== undefined) {
          const entry = bestiaryEntrySchema.safeParse(entity['bestiary']);
          expect(entry.success, `${entity.id}: ${entry.error?.message ?? ''}`).toBe(true);
        }
      }
    }
  });
});
