import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bestiaryEntrySchema, MONSTER_CLASSES, MONSTER_FACTIONS, monsterSchema,
} from '../../packages/content/src/schemas.js';
import { extractEnum } from './enums.js';
import { readSourceCommit } from './env.js';
import type { CatalogEntity } from './generated-writer.js';
import {
  BESTIARY_CLASS_MAP, CANARY_LOOT_CHANCE_SCALE, convertMonster, corpseAnimatableWindows,
  corpseTtlMsFromChain, FACTION_CONSTANTS, listMonsterFiles, loadReaderDeps, lootChance,
  readCorpseDecayChains, readCorpseItemFlags, readFamiliarLooktypes, readMonsterCatalog, readTfsSpeeds,
  slugify, type CorpseItemFlags, type DecayStage, type MonsterReaderDeps,
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

// O familiar (#599): o `lookType` fica COMENTADO no Lua do Canary (quem o define é a magia, por
// vocação), e as três magias por nome — `summon challenge`, `ice strike` e `sudden death rune` — são
// as que o leitor precisou aprender. Números inventados, o formato é o do arquivo real.
const FAMILIAR = `
local mType = Game.createMonsterType("Test Familiar")
local monster = {}
monster.description = "a test familiar"
monster.experience = 0
monster.outfit = {
  --lookType = 993,
  lookHead = 0,
}
monster.health = 500
monster.maxHealth = 500
monster.corpse = 0
monster.speed = 154
monster.manaCost = 300
monster.flags = {
  summonable = false, attackable = true, hostile = false, pushable = false, staticAttackChance = 90,
  targetDistance = 4, runHealth = 0, isBlockable = false, familiar = true,
}
monster.attacks = {
  { name = "melee", interval = 2000, chance = 100, minDamage = 0, maxDamage = -20 },
  { name = "sudden death rune", interval = 2000, chance = 17, minDamage = -30, maxDamage = -35, range = 7, target = false },
  { name = "ice strike", interval = 2000, chance = 17, minDamage = -30, maxDamage = -35, range = 5, target = true },
  { name = "summon challenge", interval = 2000, chance = 40, target = false },
}
monster.defenses = {
  defense = 55, armor = 55,
  { name = "combat", interval = 2000, chance = 75, type = COMBAT_HEALING, minDamage = 60, maxDamage = 60, effect = CONST_ME_MAGIC_GREEN, target = false },
}
monster.immunities = {
  { type = "paralyze", condition = true },
  { type = "invisible", condition = true },
}
mType:register(monster)
`;

// O familiar do Monk: converteria sem bloqueio nenhum, e o recorte (ADR 0051) o barra à parte.
const MONK_FAMILIAR = `
local mType = Game.createMonsterType("Monk familiar")
local monster = {}
monster.outfit = { lookType = 1818, lookHead = 0 }
monster.health = 500
monster.maxHealth = 500
monster.speed = 154
monster.manaCost = 200
monster.flags = { familiar = true, hostile = false }
mType:register(monster)
`;

// `data/libs/systems/familiar.lua`: as chaves são expressões (`VOCATION.BASE_ID.X`) que o avaliador
// literal não resolve, então o leitor casa só os pares `{ id = N, name = "…" }`.
const FAMILIAR_LUA = `
FAMILIAR_ID = {
  [VOCATION.BASE_ID.SORCERER] = { id = 994, name = "Sorcerer familiar" },
  [VOCATION.BASE_ID.DRUID] = { id = 993, name = "Test Familiar" },
  [VOCATION.BASE_ID.MONK] = { id = 1818, name = "Monk familiar" },
}
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

// O que a Convince Creature Rune aceita (#600): `flags.convinceable` e o `manaCost` que ela debita.
const CONVINCEABLE = `
local mType = Game.createMonsterType("Test Skeleton")
local monster = {}
monster.outfit = { lookType = 21 }
monster.health = 50
monster.maxHealth = 50
monster.corpse = 1
monster.speed = 80
monster.manaCost = 300
monster.flags = { summonable = true, convinceable = true, targetDistance = 1 }
mType:register(monster)
`;

// Um boss sintético (#629): o bloco `monster.bosstiary` do Canary, sem `Bestiary` (boss não tem
// ficha de Bestiário).
const BOSS = (bosstiary: string) => `
local mType = Game.createMonsterType("Test Boss")
local monster = {}
monster.experience = 900
monster.outfit = { lookType = 21 }
${bosstiary}
monster.health = 5000
monster.maxHealth = 5000
monster.speed = 100
monster.attacks = { { name = "melee", interval = 2000, chance = 100, minDamage = 0, maxDamage = -50 } }
monster.defenses = { defense = 5, armor = 5 }
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
  <item id="1" article="a" name="dead test drake">
    <attribute key="duration" value="10"/>
    <attribute key="decayTo" value="2"/>
  </item>
  <item id="2" article="a" name="dead test drake">
    <attribute key="duration" value="5"/>
    <attribute key="decayTo" value="0"/>
  </item>
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
  write(join(monsters, 'familiars', 'monk_familiar.lua'), MONK_FAMILIAR);
  write(join(canary, 'data', 'libs', 'systems', 'familiar.lua'), FAMILIAR_LUA);
  write(join(monsters, 'undeads', 'test_wraith.lua'), OUT_OF_PACK);
  write(join(monsters, 'undeads', 'test_summoner.lua'), SUMMONER);
  write(join(monsters, 'mammals', 'test_rat_caller.lua'), RAT_CALLER);
  write(join(monsters, 'undeads', 'test_skeleton.lua'), CONVINCEABLE);
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

describe('readCorpseDecayChains / corpseTtlMsFromChain (#585)', () => {
  it('lê duration/decayTo do items.xml, e soma a cadeia inteira em ms', () => {
    const ctx = fixture(false);
    const chains = readCorpseDecayChains(join(ctx.canaryDir, 'data/items/items.xml'));
    expect(chains.get(1)).toEqual({ durationSeconds: 10, decayTo: 2 });
    expect(chains.get(2)).toEqual({ durationSeconds: 5, decayTo: 0 });
    expect(corpseTtlMsFromChain(1, chains)).toBe(15000);
  });

  it('id sem cadeia (ou monstro sem `corpse`) devolve undefined', () => {
    const chains: Map<number, DecayStage> = new Map();
    expect(corpseTtlMsFromChain(undefined, chains)).toBeUndefined();
    expect(corpseTtlMsFromChain(9999, chains)).toBeUndefined();
  });

  it('ciclo no decayTo não trava, e devolve undefined em vez de somar para sempre', () => {
    const chains: Map<number, DecayStage> = new Map([
      [1, { durationSeconds: 10, decayTo: 2 }],
      [2, { durationSeconds: 10, decayTo: 1 }],
    ]);
    expect(corpseTtlMsFromChain(1, chains)).toBeUndefined();
  });

  it('item sem `decayTo` é o último estágio, e a soma para nele', () => {
    const chains: Map<number, DecayStage> = new Map([[1, { durationSeconds: 42 }]]);
    expect(corpseTtlMsFromChain(1, chains)).toBe(42000);
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
      // `monster.corpse = 1` (#585): 1 (duration 10 → decayTo 2) → 2 (duration 5 → decayTo 0),
      // 10 + 5 = 15 s = 15000 ms.
      corpseTtlMs: 15000,
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
    // #559/#592: `immunities[].condition = true` (paralyze) vira `conditionImmunities`, não mais
    // uma entrada muda em `ignoredFields`.
    expect(entity['conditionImmunities']).toEqual(['paralyze']);
    expect(converted.notes.ignoredFields.some((field) => field.startsWith('immunities.condition'))).toBe(false);
  });

  describe('imunidade de condição do Canary → `conditionImmunities` (#559, ADR 0041)', () => {
    // A tabela é a de `luaMonsterTypeConditionImmunities` (`monster_type_functions.cpp:915-968`).
    const withImmunities = (lua: string) => {
      const ctx = fixture(false);
      const text = RAT.replace('monster.immunities = {}', `monster.immunities = ${lua}`);
      return convertMonster(text, 'x/mammals/test_rat.lua', 'mammals', COMMIT, deps(ctx));
    };

    it('os nomes de ELEMENTO e `bleed` viram a imunidade à DOT que o elemento gera; paralyze/drunk/invisible ficam', () => {
      const converted = withImmunities(`{
        { type = "paralyze", condition = true }, { type = "drunk", condition = true },
        { type = "invisible", condition = true }, { type = "bleed", condition = true },
        { type = "fire", condition = true }, { type = "ice", condition = true },
        { type = "poison", condition = true }, { type = "energy", condition = true },
        { type = "holy", condition = true }, { type = "death", condition = true },
        { type = "drown", condition = true },
      }`);
      expect([...(converted.entity['conditionImmunities'] as string[])].sort()).toEqual([
        'bleeding', 'burning', 'cursed', 'dazzled', 'drowning', 'drunk', 'electrified', 'freezing',
        'invisible', 'paralyze', 'poison',
      ]);
      // Todo valor que o importador escreve é aceito pelo schema — o `promote` não estoura.
      expect(() => monsterSchema.shape.conditionImmunities.parse(converted.entity['conditionImmunities']))
        .not.toThrow();
    });

    it('sinônimos: `earth` = `poison`, `physical` = `bleed`, `invisibility` = `invisible` (o mesmo `if` do Canary)', () => {
      const converted = withImmunities(`{
        { type = "earth", condition = true }, { type = "physical", condition = true },
        { type = "invisibility", condition = true },
      }`);
      expect(converted.entity['conditionImmunities']).toEqual(['bleeding', 'invisible', 'poison']);
    });

    it('`condition = false` não é imunidade — o Canary lista `{ type = "bleed", condition = false }` em 1632 monstros', () => {
      const converted = withImmunities(`{
        { type = "bleed", condition = false }, { type = "paralyze", condition = false },
      }`);
      expect(converted.entity['conditionImmunities']).toBeUndefined();
    });

    it('`outfit` (sem condição no Draconya até o M44-03) é REPORTADO por nome, não descartado em silêncio', () => {
      const converted = withImmunities('{ { type = "outfit", condition = true }, { type = "fire", condition = true } }');
      expect(converted.entity['conditionImmunities']).toEqual(['burning']);
      expect(converted.notes.ignoredFields).toContain(
        'immunities.condition.outfit (sem imunidade de condição no schema)',
      );
    });

    it('imunidade de DANO e de CONDIÇÃO para o MESMO nome são leituras independentes', () => {
      const converted = withImmunities('{ { type = "fire", combat = true }, { type = "fire", condition = true } }');
      expect((converted.entity['mitigation'] as { immunities: string[] }).immunities).toEqual(['fire']);
      expect(converted.entity['conditionImmunities']).toEqual(['burning']);
    });
  });

  describe('facção (`monster.faction`/`enemyFactions`, #619)', () => {
    const withFaction = (lua: string) => {
      const ctx = fixture(false);
      const text = RAT.replace('monster.immunities = {}', `monster.immunities = {}\n${lua}`);
      return convertMonster(text, 'x/mammals/test_rat.lua', 'mammals', COMMIT, deps(ctx));
    };

    it('lê a facção e as inimigas como nomes de `MONSTER_FACTIONS`, na ordem em que o Lua as declara', () => {
      const converted = withFaction('monster.faction = FACTION_DEEPLING\nmonster.enemyFactions = { FACTION_PLAYER, FACTION_DEATHLING }');
      expect(converted.blockers).toEqual([]);
      expect(converted.entity['faction']).toBe('deepling');
      expect(converted.entity['enemyFactions']).toEqual(['player', 'deathling']);
      // Todo valor escrito é aceito pelo schema — a promoção não estoura.
      expect(() => monsterSchema.parse(asMonster(converted.entity))).not.toThrow();
      // O campo lido não vai mais para o relatório de "ignorados".
      expect(converted.notes.ignoredFields.some((field) => field.startsWith('faction'))).toBe(false);
      expect(converted.notes.ignoredFields.some((field) => field.startsWith('enemyFactions'))).toBe(false);
    });

    it('a Lion nomeia SÓ os Usurpers (sem `player`): o leitor não acrescenta o jogador', () => {
      const converted = withFaction('monster.faction = FACTION_LION\nmonster.enemyFactions = { FACTION_LIONUSURPERS }');
      expect(converted.entity['faction']).toBe('lion');
      expect(converted.entity['enemyFactions']).toEqual(['lion-usurpers']);
    });

    it('sem facção o monstro fica SEM os dois campos — `FACTION_DEFAULT` não é escrito', () => {
      expect(withFaction('').entity['faction']).toBeUndefined();
      expect(withFaction('').entity['enemyFactions']).toBeUndefined();
      const explicit = withFaction('monster.faction = FACTION_DEFAULT');
      expect(explicit.entity['faction']).toBeUndefined();
      expect(explicit.blockers).toEqual([]);
    });

    it('uma constante `FACTION_*` que o Canary não tem HOJE bloqueia o monstro, em vez de ser lida em silêncio', () => {
      const converted = withFaction('monster.faction = FACTION_FUTURE\nmonster.enemyFactions = { FACTION_PLAYER, FACTION_OTHER }');
      expect(converted.blockers).toEqual([
        'facção desconhecida: FACTION_FUTURE', 'facção inimiga desconhecida: FACTION_OTHER',
      ]);
    });

    it('`FACTION_CONSTANTS` cobre o `Faction_t` do Canary, na ordem do enum (só com o checkout real)', () => {
      const canary = process.env['CANARY_DIR'];
      if (canary === undefined || canary === '' || !existsSync(join(canary, 'src/game/game_definitions.hpp'))) return;
      const enumValues = extractEnum(readFileSync(join(canary, 'src/game/game_definitions.hpp'), 'utf8'), 'Faction_t');
      const { FACTION_LAST: _sentinel, ...real } = Object.fromEntries(enumValues);
      // O índice de `MONSTER_FACTIONS` é o valor do enum: o desempate do `sim` soma `valor × 100`.
      expect(Object.keys(FACTION_CONSTANTS).map((name) => [name, MONSTER_FACTIONS.indexOf(FACTION_CONSTANTS[name] as never)]))
        .toEqual(Object.entries(real));
    });
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
    // Test Rat não declara `monster.corpse` (#585): sem cadeia para seguir, sem `corpseTtlMs` —
    // o default seguro de monstro sem cadáver.
    expect(converted.entity['corpseTtlMs']).toBeUndefined();
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


// ---------------------------------------------------------------------------------------------
// Convince Creature e Animate Dead (#600): `convinceable`, `manaCost` e as janelas do cadáver.

/** Um varint protobuf de até 32 bits. */
const varint = (value: number): number[] => {
  const out: number[] = [];
  let rest = value;
  while (rest > 0x7f) { out.push((rest & 0x7f) | 0x80); rest = Math.floor(rest / 128); }
  out.push(rest);
  return out;
};
const pbField = (field: number, wire: number, payload: readonly number[]): number[] =>
  [...varint(field * 8 + wire), ...payload];
const pbBytes = (field: number, bytes: readonly number[]): number[] =>
  pbField(field, 2, [...varint(bytes.length), ...bytes]);

/** Um `Appearance` de objeto (campo 1 do `Appearances`) com as flags que a Animate Dead lê. */
function appearanceBytes(id: number, flags: { corpse?: boolean; playerCorpse?: boolean; unmove?: boolean }): number[] {
  const flagBytes = [
    // Uma submensagem e um varint que o leitor NÃO conhece (`bank`, `clip`): pulados por wire type.
    ...pbBytes(1, pbField(1, 0, [5])),
    ...pbField(2, 0, [1]),
    ...(flags.unmove === true ? pbField(14, 0, [1]) : []),
    ...(flags.corpse === true ? pbField(42, 0, [1]) : []),
    ...(flags.playerCorpse === true ? pbField(43, 0, [1]) : []),
  ];
  return pbBytes(1, [...pbField(1, 0, varint(id)), ...pbBytes(3, flagBytes)]);
}

/** O `appearances.dat` sintético: dois cadáveres, um item comum e um OUTFIT (campo 2, ignorado). */
function writeAppearances(path: string): void {
  const bytes = [
    ...appearanceBytes(1, { corpse: true, unmove: true }),
    ...appearanceBytes(2, { corpse: true }),
    ...appearanceBytes(3, { playerCorpse: true }),
    ...appearanceBytes(4, {}),
    // Um outfit com o mesmo id 1: NÃO pode sobrescrever o objeto 1.
    ...pbBytes(2, [...pbField(1, 0, [1]), ...pbBytes(3, pbField(42, 0, [1]))]),
  ];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(bytes));
}

describe('readCorpseItemFlags (#600, `appearances.dat`)', () => {
  it('lê corpse/player_corpse e unmove só dos OBJETOS, pulando o resto por wire type', () => {
    workdir = mkdtempSync(join(tmpdir(), 'catalog-appearances-'));
    const path = join(workdir, 'appearances.dat');
    writeAppearances(path);
    expect(readCorpseItemFlags(path)).toEqual(new Map([
      [1, { movable: false }],
      [2, { movable: true }],
      [3, { movable: true }],
    ]));
  });

  it('arquivo ausente devolve mapa vazio, nunca lança nem inventa um cadáver movível', () => {
    expect(readCorpseItemFlags('/nao/existe/appearances.dat')).toEqual(new Map());
  });
});

describe('corpseAnimatableWindows (#600)', () => {
  const chain = (...stages: [number, number | undefined][]): Map<number, DecayStage> =>
    new Map(stages.map(([seconds, decayTo], index) => [
      index + 1, decayTo === undefined ? { durationSeconds: seconds } : { durationSeconds: seconds, decayTo },
    ]));
  const flags = (movable: readonly boolean[]): Map<number, CorpseItemFlags> =>
    new Map(movable.map((value, index) => [index + 1, { movable: value }]));

  it('o estágio recém-abatido é `unmove`: a janela abre no primeiro decaimento e vai até o fim da cadeia', () => {
    // 10 s (unmove) → 300 s → 300 s → 60 s (todos movíveis): o caso de 610 dos 1.028 monstros.
    const chains = chain([10, 2], [300, 3], [300, 4], [60, 0]);
    expect(corpseAnimatableWindows(1, chains, flags([false, true, true, true])))
      .toEqual([{ fromMs: 10_000, untilMs: 670_000 }]);
    expect(corpseTtlMsFromChain(1, chains)).toBe(670_000);
  });

  it('o primeiro estágio já movível abre a janela em zero', () => {
    expect(corpseAnimatableWindows(1, chain([5, 2], [10, 0]), flags([true, true])))
      .toEqual([{ fromMs: 0, untilMs: 15_000 }]);
  });

  it('estágios movíveis separados por um imóvel viram DUAS janelas', () => {
    expect(corpseAnimatableWindows(1, chain([10, 2], [20, 3], [30, 0]), flags([true, false, true])))
      .toEqual([{ fromMs: 0, untilMs: 10_000 }, { fromMs: 30_000, untilMs: 60_000 }]);
  });

  it('sem estágio movível, sem flags, sem cadeia ou sem `corpse`: undefined (nunca animável)', () => {
    expect(corpseAnimatableWindows(1, chain([10, 0]), flags([false]))).toBeUndefined();
    expect(corpseAnimatableWindows(1, chain([10, 0]), new Map())).toBeUndefined();
    expect(corpseAnimatableWindows(9, chain([10, 0]), flags([true]))).toBeUndefined();
    expect(corpseAnimatableWindows(undefined, chain([10, 0]), flags([true]))).toBeUndefined();
  });

  it('ciclo no decayTo termina sem repetir janela', () => {
    const cyclic: Map<number, DecayStage> = new Map([
      [1, { durationSeconds: 10, decayTo: 2 }], [2, { durationSeconds: 10, decayTo: 1 }],
    ]);
    expect(corpseAnimatableWindows(1, cyclic, flags([true, true]))).toEqual([{ fromMs: 0, untilMs: 20_000 }]);
  });
});

describe('convertMonster: convinceable, manaCost e corpseAnimatable (#600)', () => {
  it('traz `convinceable`, o `manaCost` do monstro e a janela do cadáver; `summonable` NÃO sai', () => {
    const ctx = fixture(false);
    writeAppearances(join(ctx.canaryDir, 'data', 'items', 'appearances.dat'));
    const converted = convertMonster(CONVINCEABLE, 'x/undeads/test_skeleton.lua', 'undeads', COMMIT, deps(ctx));

    expect(converted.blockers).toEqual([]);
    // `monster.corpse = 1`: 1 (10 s, unmove) → 2 (5 s, movível) → fim.
    expect(converted.entity).toMatchObject({
      id: 'test-skeleton', convinceable: true, manaCost: 300, corpseTtlMs: 15_000,
      corpseAnimatable: [{ fromMs: 10_000, untilMs: 15_000 }],
    });
    expect(converted.entity['summonable']).toBeUndefined();
    expect(() => monsterSchema.parse(asMonster(converted.entity))).not.toThrow();
  });

  it('monstro sem os campos não ganha nenhum (`manaCost` 0 não é escrito, sem `.dat` não há janela)', () => {
    const ctx = fixture(false);
    const text = CONVINCEABLE.replace('monster.manaCost = 300', 'monster.manaCost = 0')
      .replace('convinceable = true', 'convinceable = false');
    const converted = convertMonster(text, 'x/undeads/test_skeleton.lua', 'undeads', COMMIT, deps(ctx));
    expect(converted.entity['convinceable']).toBeUndefined();
    expect(converted.entity['manaCost']).toBeUndefined();
    // O fixture não escreveu `appearances.dat`: sem o dado do Canary, nunca animável.
    expect(converted.entity['corpseAnimatable']).toBeUndefined();
    expect(converted.entity['corpseTtlMs']).toBe(15_000);
  });
});

describe('o Bosstiary do Canary (#629)', () => {
  const convertBoss = (bosstiary: string) => {
    const ctx = fixture(false);
    return convertMonster(BOSS(bosstiary), 'x/bosses/test_boss.lua', 'bosses', COMMIT, deps(ctx));
  };

  it.each([
    ['RARITY_BANE', 'bane'], ['RARITY_ARCHFOE', 'archfoe'], ['RARITY_NEMESIS', 'nemesis'],
  ])('%s vira a raridade %s, com o raceId e a flag boss (o isBoss do Canary)', (constant, rarity) => {
    const converted = convertBoss(`monster.bosstiary = { bossRaceId = 5555, bossRace = ${constant} }`);
    expect(converted.blockers).toEqual([]);
    expect(converted.entity['boss']).toBe(true);
    expect(converted.entity['bosstiary']).toEqual({ rarity, raceId: 5555 });
    // O bloco vai para `data/` como está (é campo do `monsterSchema`), e o boss não tem `class`.
    expect(converted.entity['bestiary']).toBeUndefined();
    expect(() => monsterSchema.parse(asMonster(converted.entity))).not.toThrow();
    // Lido, não mais "ignorado por falta de sistema".
    expect(converted.notes.ignoredFields.some((field) => field.startsWith('bosstiary'))).toBe(false);
  });

  it('monstro sem bloco bosstiary não é boss, e o schema o aceita sem os dois campos', () => {
    const converted = convertBoss('');
    expect(converted.blockers).toEqual([]);
    expect(converted.entity['boss']).toBeUndefined();
    expect(converted.entity['bosstiary']).toBeUndefined();
  });

  it('bloqueia o boss sem raridade conhecida ou sem bossRaceId — o Canary o registra pela metade', () => {
    // Sem `bossRace` o Canary nem o marca como boss; sem `bossRaceId` o `raceid` fica 0 e
    // `IOBosstiary::addBosstiaryKill` devolve cedo: o boss nunca contaria abate.
    expect(convertBoss('monster.bosstiary = { bossRaceId = 5555 }').blockers)
      .toEqual(['raridade de Bosstiary desconhecida: nil']);
    expect(convertBoss('monster.bosstiary = { bossRaceId = 5555, bossRace = RARITY_LEGENDARY }').blockers)
      .toEqual(['raridade de Bosstiary desconhecida: RARITY_LEGENDARY']);
    expect(convertBoss('monster.bosstiary = { bossRace = RARITY_BANE }').blockers)
      .toEqual(['bosstiary sem bossRaceId']);
    expect(convertBoss('monster.bosstiary = 3').blockers).toEqual(['bosstiary não é uma tabela']);
  });
});

describe('o familiar de vocação (#599, M38-02, ADR 0057 d.3)', () => {
  const familiar = () => {
    const ctx = fixture(false);
    const text = readFileSync(join(ctx.canaryDir, 'data-otservbr-global/monster/familiars/test_familiar.lua'), 'utf8');
    return convertMonster(text, 'data-otservbr-global/monster/familiars/test_familiar.lua', 'familiars', COMMIT, deps(ctx));
  };

  it('readFamiliarLooktypes casa só os pares `{ id, name }` do FAMILIAR_ID, e nunca lança', () => {
    const ctx = fixture(false);
    expect(readFamiliarLooktypes(join(ctx.canaryDir, 'data/libs/systems/familiar.lua'))).toEqual(new Map([
      ['Sorcerer familiar', 994], ['Test Familiar', 993], ['Monk familiar', 1818],
    ]));
    expect(readFamiliarLooktypes('/nao/existe')).toEqual(new Map());
  });

  it('o lookType comentado vem da tabela por nome, e `familiar`/`manaCost` saem; `summonable` NÃO', () => {
    const converted = familiar();
    expect(converted.blockers).toEqual([]);
    expect(converted.entity).toMatchObject({
      id: 'test-familiar', familiar: true, manaCost: 300, outfitId: 993,
      // 154 do Canary × 2, porque o fixture não tem o monstro no TFS.
      speed: 308, targetDistance: 4, staticAttack: 0.9, blockable: false,
      conditionImmunities: ['invisible', 'paralyze'],
    });
    // O Canary declara `summonable = false` nos quatro: a Summon Creature não os invoca.
    expect(converted.entity['summonable']).toBeUndefined();
    // Passa no `monsterSchema` (o `.refine` de summonable/manaCost não cobra nada de um familiar).
    expect(() => monsterSchema.parse(asMonster(converted.entity))).not.toThrow();
  });

  it('sem a tabela do FAMILIAR_ID o familiar cai no bloqueio de sempre (sem lookType)', () => {
    const ctx = fixture(false);
    const text = readFileSync(join(ctx.canaryDir, 'data-otservbr-global/monster/familiars/test_familiar.lua'), 'utf8');
    const { familiarLooktypes: _unused, ...withoutTable } = deps(ctx);
    const converted = convertMonster(text, 'x/familiars/test_familiar.lua', 'familiars', COMMIT, withoutTable);
    expect(converted.blockers).toEqual(['sem aparência (lookType 0)']);
  });

  it('as três magias por nome viram ability: SD rune e ice strike (dano da entrada) e summon challenge', () => {
    const abilities = familiar().entity['abilities'] as readonly Record<string, unknown>[];
    const byId = (id: string) => abilities.find((ability) => ability['id'] === id);
    // `Monster::getCombatValues`: o dano é o `minDamage`/`maxDamage` da ENTRADA, não a fórmula de
    // level/magic level da magia registrada.
    expect(byId('suddendeath')).toMatchObject({
      cadenceMs: 2000, chance: 0.17, target: { range: 7 }, power: { min: 30, max: 35 }, damageType: 'death',
      presentation: { missileKey: 'suddendeath', impactKey: 'mortarea' },
    });
    // O `spell:range(3)` do `ice_strike.lua` vale por cima do `range = 5` do monstro (`canThrowSpell`).
    expect(byId('icestrike')).toMatchObject({
      chance: 0.17, target: { range: 3 }, power: { min: 30, max: 35 }, damageType: 'ice',
      presentation: { missileKey: 'smallice', impactKey: 'iceattack' },
    });
    expect(familiar().notes.spellNotes.some((note) => note.startsWith('ice strike: alcance 5 → 3'))).toBe(true);
    // `AREA_CIRCLE2X2` centrado no lançador (21 tiles) = o círculo de raio 4 da tabela de anéis de
    // MONSTRO; 8 s de provocação (`doChallengeCreature(creature, target, 8000)`); sem dano.
    expect(byId('summon-challenge')).toEqual({
      id: 'summon-challenge', cadenceMs: 2000, chance: 0.4,
      target: { range: 11, area: { shape: 'circle', radius: 4, centered: 'caster' } },
      power: 0, damageType: 'physical', presentation: { impactKey: 'blueshimmer' },
      challenge: { durationMs: 8000 },
    });
  });
});

describe('readMonsterCatalog (fixture sintética)', () => {
  it('fatia por pasta do Canary, lê familiars/ (#599), e manda o bloqueado ao relatório', () => {
    const ctx = fixture(false);
    expect(listMonsterFiles(ctx.canaryDir)).toContain('data-otservbr-global/monster/familiars/test_familiar.lua');
    const catalog = readMonsterCatalog(ctx, deps(ctx));

    expect([...catalog.slices.keys()].sort()).toEqual(['dragons', 'familiars', 'mammals', 'undeads']);
    expect(catalog.slices.get('dragons')?.map((entity) => entity.id)).toEqual(['test-drake']);
    // O familiar do Monk é lido e barrado pelo recorte, com o motivo no relatório.
    expect(catalog.slices.get('familiars')?.map((entity) => entity.id)).toEqual(['test-familiar']);
    expect(catalog.skipped.map((entity) => entity.id).sort())
      .toEqual(['monk-familiar', 'test-spitter', 'test-summoner', 'test-wraith']);
    expect(catalog.skipped.find((entity) => entity.id === 'monk-familiar')?.reason)
      .toBe('vocação Monk fora do corte (ADR 0051: sistemas mais novos que o 13.32)');
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

  it('o Dragon gerado bate com o dragon promovido em data/monsters/generated/dragons.json (#581) — onda de fogo, bola e cura', () => {
    const dragon = convertReal('dragons/dragon.lua');
    expect(dragon.blockers).toEqual([]);
    const generated = monsterSchema.parse(asMonster(dragon.entity));
    // O `dragon.json` autoral saiu no #581 — Dragon/Dragon Lord/Rat/Rotworm passaram a viver
    // direto em `generated/<fatia>.json`, regenerados uma única vez por aquela issue e
    // preservados verbatim por `preserveHandAuthored` (`promote-monsters.ts`) daí em diante.
    // Este teste compara a mesma coisa que sempre comparou — a conversão FRESCA do Canary contra
    // o congelado — só que lendo do lugar novo.
    const dragonsSlice = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/content/data/monsters/generated/dragons.json'), 'utf8'),
    ) as readonly Record<string, unknown>[];
    const authoredRaw = dragonsSlice.find((entity) => entity['id'] === 'dragon');
    if (authoredRaw === undefined) throw new Error('dragon não está em generated/dragons.json');
    const authored = monsterSchema.parse(authoredRaw);
    // O Canary não declara `range` na onda (sem limite além da vista, `Monster::canUseSpell`); o
    // leitor usa o comprimento da onda (8) para preencher o que o schema exige — nem número do
    // Tibia, nem divergência: o congelado em `generated/dragons.json` saiu do MESMO leitor (#581),
    // então bate exatamente, sem ajuste nenhum.
    const firewave = generated.abilities?.find((ability) => ability.id === 'firewave');
    expect(firewave?.target.range).toBe(8);
    expect(generated.abilities).toEqual(authored.abilities);
    for (const field of [
      'class', 'health', 'experience', 'attack', 'attackIntervalMs', 'armor', 'defense', 'defenseMitigation',
      'damageType', 'mitigation', 'critChance', 'speed', 'aggroRadius', 'attackRange', 'targetDistance',
      'blockable', 'defenses', 'targetChange', 'targetStrategy', 'runOnHealth', 'staticAttack', 'summons',
    ] as const) {
      expect(generated[field], field).toEqual(authored[field]);
    }
  });

  it('Convince e Animate Dead (#600): o Skeleton é convencível (mana 300) e só animável 10 s depois da morte', () => {
    const skeleton = convertReal('undeads/skeleton.lua');
    expect(skeleton.blockers).toEqual([]);
    // `skeleton.lua`: `monster.manaCost = 300`, `flags.convinceable = true`; `monster.corpse = 5972`
    // (10 s, `unmove` no `appearances.dat`) → 4024 (300 s) → … → 670 s de cadeia inteira.
    expect(skeleton.entity).toMatchObject({
      convinceable: true, manaCost: 300, corpseTtlMs: 670_000,
      corpseAnimatable: [{ fromMs: 10_000, untilMs: 670_000 }],
    });
    // O Dragon não é convencível (`dragon.lua` não declara), e o cadáver dele também nasce `unmove`.
    const dragon = convertReal('dragons/dragon.lua');
    expect(dragon.entity['convinceable']).toBeUndefined();
    expect(dragon.entity['corpseAnimatable']).toEqual([{ fromMs: 10_000, untilMs: 670_000 }]);
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
