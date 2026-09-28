import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSourceCommit } from './env.js';
import { getCatalogType } from './registry.js';
import { normalizeVocation } from './spells.js';

const COMMIT = 'd'.repeat(40);

let workdir: string | undefined;

afterEach(() => {
  if (workdir !== undefined) { rmSync(workdir, { recursive: true, force: true }); workdir = undefined; }
});

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// Fixtures SINTÉTICAS no formato do Canary — números e nomes inventados, nunca um arquivo real
// copiado (ADR 0019/0038 decisão 7). A conferência contra o checkout REAL (Avalanche, Fierce
// Berserk, Mass Healing) está no bloco `describe.skipIf(!HAS_CANARY)`, ao final deste arquivo.

const ATTACK_KNIGHT = `
local combat = Combat()
combat:setParameter(COMBAT_PARAM_TYPE, COMBAT_PHYSICALDAMAGE)

function onGetFormulaValues(player, skill, attack, factor)
	local skillTotal = skill * attack
	local levelTotal = player:getLevel() / 5
	return -(((skillTotal * 0.02) + 4) + levelTotal) * 1.28, -(((skillTotal * 0.04) + 9) + levelTotal) * 1.28
end
combat:setCallback(CALLBACK_PARAM_SKILLVALUE, "onGetFormulaValues")

local spell = Spell("instant")
function spell.onCastSpell(creature, var)
	return combat:execute(creature, var)
end

spell:group("attack")
spell:name("Test Knight Strike")
spell:words("test ico")
spell:level(16)
spell:mana(30)
spell:range(1)
spell:cooldown(6 * 1000)
spell:groupCooldown(2 * 1000)
spell:vocation("knight;true", "elite knight;true")
spell:register()
`;

/** Duas vocações — vira DUAS entidades, cada uma com sufixo (a mesma convenção de Flame Strike). */
const MULTI_VOCATION = `
local combat = Combat()
function onGetFormulaValues(player, level, maglevel)
	local min = (level / 5) + (maglevel * 1.4) + 8
	local max = (level / 5) + (maglevel * 2.2) + 13
	return -min, -max
end
combat:setCallback(CALLBACK_PARAM_LEVELMAGICVALUE, "onGetFormulaValues")

local spell = Spell("instant")
function spell.onCastSpell(creature, var)
	return combat:execute(creature, var)
end

spell:name("Test Bolt")
spell:group("attack")
spell:level(14)
spell:mana(20)
spell:range(3)
spell:cooldown(2 * 1000)
spell:groupCooldown(2 * 1000)
spell:vocation("sorcerer;true", "druid;true", "master sorcerer;true", "elder druid;true")
spell:register()
`;

/** Só Monk — fora do escopo do jogo, omitida em silêncio (nem gerada, nem no relatório). */
const MONK_ONLY = `
local spell = Spell("instant")
function spell.onCastSpell(creature, var) return true end
spell:name("Test Monk Only")
spell:group("attack")
spell:level(10)
spell:mana(10)
spell:cooldown(1000)
spell:vocation("monk;true", "exalted monk;true")
spell:register()
`;

/** Sem `onGetFormulaValues` — utilitária (invocação, buff…), fora do que este leitor extrai. */
const NO_FORMULA = `
local spell = Spell("instant")
function spell.onCastSpell(creature, var)
	return creature:conjureItem(3147, 3161, 4)
end
spell:name("Test Conjure")
spell:group("support")
spell:level(20)
spell:mana(50)
spell:cooldown(2000)
spell:vocation("druid;true", "elder druid;true")
spell:register()
`;

/** Assinatura de `onGetFormulaValues` fora das duas formas reconhecidas — vai para o relatório. */
const UNRECOGNIZED_FORMULA = `
local spell = Spell("instant")
function onGetFormulaValues(player, level)
	return -level, -level * 2
end
function spell.onCastSpell(creature, var) return true end
spell:name("Test Unrecognized")
spell:group("attack")
spell:level(30)
spell:mana(60)
spell:cooldown(3000)
spell:vocation("sorcerer;true")
spell:register()
`;

/** Runa de ataque simples — mesma forma "magic". */
const RUNE_ATTACK = `
local combat = Combat()
function onGetFormulaValues(player, level, maglevel)
	local min = (level / 5) + (maglevel * 1.2) + 7
	local max = (level / 5) + (maglevel * 2.8) + 17
	return -min, -max
end
combat:setCallback(CALLBACK_PARAM_LEVELMAGICVALUE, "onGetFormulaValues")

local rune = Spell("rune")
function rune.onCastSpell(creature, var, isHotkey)
	return combat:execute(creature, var)
end
rune:group("attack")
rune:name("test rune")
rune:runeId(3161)
rune:charges(4)
rune:level(30)
rune:magicLevel(4)
rune:cooldown(2000)
rune:groupCooldown(2000)
rune:register()
`;

/** `house/*` — utilitário de casa, nunca magia de caça. */
const HOUSE_UTILITY = `
local spell = Spell("instant")
function spell.onCastSpell(creature, var) return true end
spell:name("House Door List")
spell:register()
`;

function fixture(): { canaryDir: string; commit: string } {
  workdir = mkdtempSync(join(tmpdir(), 'catalog-spells-'));
  const canary = join(workdir, 'canary');
  write(join(canary, 'data', 'scripts', 'spells', 'attack', 'test_knight_strike.lua'), ATTACK_KNIGHT);
  write(join(canary, 'data', 'scripts', 'spells', 'attack', 'test_bolt.lua'), MULTI_VOCATION);
  write(join(canary, 'data', 'scripts', 'spells', 'attack', 'test_monk_only.lua'), MONK_ONLY);
  write(join(canary, 'data', 'scripts', 'spells', 'support', 'test_conjure.lua'), NO_FORMULA);
  write(join(canary, 'data', 'scripts', 'spells', 'attack', 'test_unrecognized.lua'), UNRECOGNIZED_FORMULA);
  write(join(canary, 'data', 'scripts', 'spells', 'attack', 'practise_test_knight_strike.lua'), ATTACK_KNIGHT);
  write(join(canary, 'data', 'scripts', 'spells', 'house', 'house_door_list.lua'), HOUSE_UTILITY);
  write(join(canary, 'data', 'scripts', 'runes', 'test_rune.lua'), RUNE_ATTACK);
  write(join(canary, '.git', 'HEAD'), COMMIT);
  return { canaryDir: canary, commit: COMMIT };
}

function ctxFor(canaryDir: string): { canaryDir: string; forgottenServerDir: string; canaryCommit: string; forgottenServerCommit: string } {
  return { canaryDir, forgottenServerDir: '/nao/existe', canaryCommit: COMMIT, forgottenServerCommit: '' };
}

describe('normalizeVocation', () => {
  it('mapeia base e variante promovida para o mesmo id', () => {
    expect(normalizeVocation('knight;true')).toBe('knight');
    expect(normalizeVocation('elite knight;true')).toBe('knight');
    expect(normalizeVocation('royal paladin;true')).toBe('paladin');
  });

  it('devolve null para Monk e para nome desconhecido', () => {
    expect(normalizeVocation('monk;true')).toBeNull();
    expect(normalizeVocation('exalted monk;true')).toBeNull();
    expect(normalizeVocation('none')).toBeNull();
  });
});

describe('catálogo "spells" (fixture sintética)', () => {
  it('gera a magia single-vocation sem sufixo, com skillAttack reconhecido', () => {
    const { canaryDir } = fixture();
    const type = getCatalogType('spells');
    if (type === undefined) throw new Error('tipo "spells" não registrado');
    const result = type.run(ctxFor(canaryDir));
    const knight = result.slices.get('knight')?.find((e) => e['id'] === 'test-knight-strike');
    expect(knight).toBeDefined();
    expect(knight?.['name']).toBe('Test Knight Strike');
    expect(knight?.['manaCost']).toBe(30);
    expect(knight?.['cooldownMs']).toBe(6000);
    expect(knight?.['groupCooldownMs']).toBe(2000);
    expect(knight?.['minLevel']).toBe(16);
    expect((knight?.['effect'] as Record<string, unknown>)['formula']).toEqual({
      levelFactor: 0.256, skillMin: 0, skillMax: 0, baseMin: 5.12, baseMax: 11.52,
      skillAttackMin: 0.0256, skillAttackMax: 0.0512,
    });
    expect(knight?.['source']).toEqual({ engine: 'canary', commit: COMMIT, path: 'data/scripts/spells/attack/test_knight_strike.lua' });
  });

  it('gera duas entidades com sufixo de vocação para o arquivo multi-vocação', () => {
    const { canaryDir } = fixture();
    const type = getCatalogType('spells');
    if (type === undefined) throw new Error('tipo "spells" não registrado');
    const result = type.run(ctxFor(canaryDir));
    expect(result.slices.get('sorcerer')?.map((e) => e['id'])).toContain('test-bolt-sorcerer');
    expect(result.slices.get('druid')?.map((e) => e['id'])).toContain('test-bolt-druid');
    const sorcerer = result.slices.get('sorcerer')?.find((e) => e['id'] === 'test-bolt-sorcerer');
    expect((sorcerer?.['effect'] as Record<string, unknown>)['formula']).toEqual({
      levelFactor: 0.2, skillMin: 1.4, skillMax: 2.2, baseMin: 8, baseMax: 13, scaling: 'magic',
    });
  });

  it('omite Monk-only, house/* e practise_* em silêncio — nem gerado, nem no relatório', () => {
    const { canaryDir } = fixture();
    const type = getCatalogType('spells');
    if (type === undefined) throw new Error('tipo "spells" não registrado');
    const result = type.run(ctxFor(canaryDir));
    const allIds = [...result.slices.values()].flat().map((e) => e['id']);
    expect(allIds).not.toContain('test-monk-only');
    expect(allIds).not.toContain('house-door-list');
    // practise_* nem chega a ser lido: nem gerado, nem pulado.
    expect(result.skipped.map((s) => s.id)).not.toContain('Test Knight Strike');
  });

  it('magia sem onGetFormulaValues não é gerada nem aparece no relatório', () => {
    const { canaryDir } = fixture();
    const type = getCatalogType('spells');
    if (type === undefined) throw new Error('tipo "spells" não registrado');
    const result = type.run(ctxFor(canaryDir));
    const allIds = [...result.slices.values()].flat().map((e) => e['id']);
    expect(allIds).not.toContain('test-conjure');
    expect(result.skipped.map((s) => s.name)).not.toContain('Test Conjure');
  });

  it('fórmula com assinatura não reconhecida vai para o relatório com o motivo', () => {
    const { canaryDir } = fixture();
    const type = getCatalogType('spells');
    if (type === undefined) throw new Error('tipo "spells" não registrado');
    const result = type.run(ctxFor(canaryDir));
    const allIds = [...result.slices.values()].flat().map((e) => e['id']);
    expect(allIds).not.toContain('test-unrecognized');
    const skipped = result.skipped.find((s) => s.name === 'Test Unrecognized');
    expect(skipped).toBeDefined();
    expect(skipped?.reason).toContain('assinatura não reconhecida');
  });

  it('é determinístico: duas rodadas da mesma fixture produzem o mesmo JSON', () => {
    const { canaryDir } = fixture();
    const type = getCatalogType('spells');
    if (type === undefined) throw new Error('tipo "spells" não registrado');
    const first = type.run(ctxFor(canaryDir));
    const second = type.run(ctxFor(canaryDir));
    expect(JSON.stringify([...first.slices.entries()])).toBe(JSON.stringify([...second.slices.entries()]));
  });
});

describe('catálogo "runes" (fixture sintética)', () => {
  it('gera a runa sem restrição de vocação na fatia "general"', () => {
    const { canaryDir } = fixture();
    const type = getCatalogType('runes');
    if (type === undefined) throw new Error('tipo "runes" não registrado');
    const result = type.run(ctxFor(canaryDir));
    const rune = result.slices.get('general')?.find((e) => e['id'] === 'test-rune');
    expect(rune).toBeDefined();
    // Runa não carrega `scaling` — escala SEMPRE pelo magic level, o campo é redundante ali.
    expect((rune?.['effect'] as Record<string, unknown>)['formula']).toEqual({
      levelFactor: 0.2, skillMin: 1.2, skillMax: 2.8, baseMin: 7, baseMax: 17,
    });
  });
});

// ------------------------------------------------------------------------------------------
// Contra o checkout REAL do Canary, quando ele está nesta máquina (`CANARY_DIR`) — pulado no CI.
// É o que a issue #595 pede como conferência: Avalanche, Fierce Berserk ("exori gran") e a
// ausência de reconhecimento de Mass Healing (TARGETCREATURE, fora das duas formas).

const CANARY_DIR = process.env['CANARY_DIR'];
const HAS_CANARY = CANARY_DIR !== undefined && CANARY_DIR !== '' && existsSync(join(CANARY_DIR, 'data', 'scripts', 'spells'));

describe.skipIf(!HAS_CANARY)('leitor contra o Canary real (CANARY_DIR)', () => {
  function realCtx(): { canaryDir: string; forgottenServerDir: string; canaryCommit: string; forgottenServerCommit: string } {
    return {
      canaryDir: CANARY_DIR ?? '', forgottenServerDir: '/nao/existe',
      canaryCommit: HAS_CANARY ? readSourceCommit(CANARY_DIR ?? '') : '', forgottenServerCommit: '',
    };
  }

  it('Avalanche (runa): mesmos coeficientes de avalanche-rune.json', () => {
    const type = getCatalogType('runes');
    if (type === undefined) throw new Error('tipo "runes" não registrado');
    const result = type.run(realCtx());
    const avalanche = [...result.slices.values()].flat().find((e) => e['id'] === 'avalanche-rune' || e['name'] === 'avalanche rune');
    expect(avalanche).toBeDefined();
    // Bit a bit igual a `packages/content/data/supplies/avalanche-rune.json` — sem `scaling`.
    expect((avalanche?.['effect'] as Record<string, unknown>)['formula']).toEqual({
      levelFactor: 0.2, skillMin: 1.2, skillMax: 2.8, baseMin: 7, baseMax: 17,
    });
  });

  it('Fierce Berserk ("exori gran"): mesmos coeficientes de fierce-berserk.json', () => {
    const type = getCatalogType('spells');
    if (type === undefined) throw new Error('tipo "spells" não registrado');
    const result = type.run(realCtx());
    const fierce = [...result.slices.values()].flat().find((e) => e['name'] === 'Fierce Berserk');
    expect(fierce).toBeDefined();
    expect((fierce?.['effect'] as Record<string, unknown>)['formula']).toEqual({
      levelFactor: 0.22, skillMin: 1.21, skillMax: 3.3, baseMin: 0, baseMax: 0, attackMin: 2.42, attackMax: 6.6,
    });
  });

  it('Mass Healing: não reconhecida (TARGETCREATURE, fora das duas formas) — sem entrada gerada', () => {
    const type = getCatalogType('spells');
    if (type === undefined) throw new Error('tipo "spells" não registrado');
    const result = type.run(realCtx());
    const generated = [...result.slices.values()].flat().find((e) => e['name'] === 'Mass Healing');
    expect(generated).toBeUndefined();
  });
});
