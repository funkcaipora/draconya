import {
  existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { charmSchema } from '../../packages/content/src/schemas.js';
import { readSourceCommit } from './env.js';
import { CANARY_CHARMS_LUA, readCharmCatalog } from './charms.js';
import { resetCatalogTypesForTest } from './registry.js';
import type { CatalogImportContext } from './registry.js';

const COMMIT = 'a'.repeat(40);

// Fixture SINTÉTICA no formato do `charmCategory_t`/`charm_t`/`CombatType_t` reais (ADR
// 0019/0038 d.7) — números conferidos contra `creatures_definitions.hpp`, nunca um arquivo
// copiado.
const CHARM_CATEGORY_HEADER_SOURCE = `
enum charmCategory_t {
	CHARM_ALL = 0,
	CHARM_MAJOR = 1,
	CHARM_MINOR = 2,
};
`;
const CHARM_TYPE_HEADER_SOURCE = `
enum charm_t {
	CHARM_UNDEFINED = 0,
	CHARM_OFFENSIVE = 1,
	CHARM_DEFENSIVE = 2,
	CHARM_PASSIVE = 3,
};
`;
const COMBAT_TYPE_HEADER_SOURCE = `
enum CombatType_t : uint32_t {
	COMBAT_PHYSICALDAMAGE = 0,
	COMBAT_FIREDAMAGE = 1,
	COMBAT_EARTHDAMAGE = 2,
	COMBAT_ENERGYDAMAGE = 3,
	COMBAT_HOLYDAMAGE = 10,
	COMBAT_DEATHDAMAGE = 11,
	COMBAT_NEUTRALDAMAGE = 13,
};
`;
const MAGIC_EFFECT_HEADER_SOURCE = `
enum MagicEffectClasses : uint8_t {
	CONST_ME_HITAREA = 0,
	CONST_ME_POFF = 1,
};
`;

const CHARMS_LUA = `
local charms = {
	[1] = {
		name = "Test Wound",
		category = CHARM_MAJOR,
		type = CHARM_OFFENSIVE,
		damageType = COMBAT_PHYSICALDAMAGE,
		percent = 5,
		chance = { 5, 10, 11 },
		effect = CONST_ME_HITAREA,
		points = { 240, 360, 1200 },
	},
	[2] = {
		name = "Test Carnage",
		category = CHARM_MAJOR,
		type = CHARM_OFFENSIVE,
		damageType = COMBAT_NEUTRALDAMAGE,
		percent = 15,
		chance = { 10, 20, 22 },
		points = { 600, 900, 3000 },
	},
	[9] = {
		name = "Test Dodge",
		category = CHARM_MAJOR,
		type = CHARM_DEFENSIVE,
		chance = { 5, 10, 11 },
		effect = CONST_ME_POFF,
		points = { 240, 360, 1200 },
	},
	[14] = {
		name = "Test Scavenge",
		category = CHARM_MINOR,
		type = CHARM_PASSIVE,
		chance = { 60, 90, 120 },
		points = { 100, 150, 225 },
	},
}
`;

// `charms.ts` aponta os headers em `src/creatures/creatures_definitions.hpp` e
// `src/utils/utils_definitions.hpp` — a fixture recria só a ÁRVORE que ele lê, sem copiar o
// arquivo real inteiro.
describe('charms.ts — o leitor de Charms do Canary (#602)', () => {
  it('converte category/type/damageType pelos enums reais, e larga effect (invariante 6)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'charms-canary-'));
    try {
      const creaturesDir = join(dir, 'src', 'creatures');
      const utilsDir = join(dir, 'src', 'utils');
      const scriptsDir = join(dir, 'data', 'scripts', 'systems');
      mkdirSync(creaturesDir, { recursive: true });
      mkdirSync(utilsDir, { recursive: true });
      mkdirSync(scriptsDir, { recursive: true });
      writeFileSync(
        join(creaturesDir, 'creatures_definitions.hpp'),
        [CHARM_CATEGORY_HEADER_SOURCE, CHARM_TYPE_HEADER_SOURCE, COMBAT_TYPE_HEADER_SOURCE].join('\n'),
      );
      writeFileSync(join(utilsDir, 'utils_definitions.hpp'), MAGIC_EFFECT_HEADER_SOURCE);
      writeFileSync(join(scriptsDir, 'bestiary_charms.lua'), CHARMS_LUA);

      const ctx: CatalogImportContext = {
        canaryDir: dir, forgottenServerDir: '/nao/existe', canaryCommit: COMMIT, forgottenServerCommit: '',
      };
      const catalog = readCharmCatalog(ctx);
      const entities = catalog.slices.get('charms');
      // Ordem de LEITURA (posição Lua 1, 2, 9, 14) — `sortById` só ordena na hora de ESCREVER
      // `generated/*.json` (`generated-writer.ts`), não aqui.
      expect(entities?.map((e) => e['id'])).toEqual(
        ['test-wound', 'test-carnage', 'test-dodge', 'test-scavenge'],
      );

      const wound = entities?.find((e) => e['id'] === 'test-wound');
      expect(wound).toMatchObject({
        name: 'Test Wound', canaryCharmId: 0, category: 'major', type: 'offensive',
        damageType: 'physical', percent: 5, chance: [5, 10, 11], points: [240, 360, 1200],
      });
      // `effect`/`messageCancel`/`messageServerLog`/`description` nunca saem (invariante 6).
      expect(wound).not.toHaveProperty('effect');
      expect(wound).not.toHaveProperty('description');

      const carnage = entities?.find((e) => e['id'] === 'test-carnage');
      expect(carnage?.['damageType']).toBe('neutral');

      const dodge = entities?.find((e) => e['id'] === 'test-dodge');
      expect(dodge).toMatchObject({ category: 'major', type: 'defensive' });
      expect(dodge).not.toHaveProperty('damageType');
      expect(dodge).not.toHaveProperty('percent');

      // Todo gerado valida contra o schema real de `@draconya/content`.
      for (const entity of entities ?? []) expect(() => charmSchema.parse(entity)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Contra o checkout real, quando ele está nesta máquina (`CANARY_DIR`) — pulado no CI.

const REAL_CANARY_DIR = process.env['CANARY_DIR'];
const HAS_REAL_CANARY = REAL_CANARY_DIR !== undefined && REAL_CANARY_DIR !== ''
  && existsSync(join(REAL_CANARY_DIR, CANARY_CHARMS_LUA));

describe.skipIf(!HAS_REAL_CANARY)('leitor contra o Canary real (CANARY_DIR)', () => {
  it('25 charms, todos válidos contra o schema; Wound/Carnage/Dodge/Scavenge batem com o Lua', () => {
    resetCatalogTypesForTest();
    const dir = REAL_CANARY_DIR as string;
    const ctx: CatalogImportContext = {
      canaryDir: dir, forgottenServerDir: '/nao/existe', canaryCommit: readSourceCommit(dir), forgottenServerCommit: '',
    };
    const catalog = readCharmCatalog(ctx);
    const entities = catalog.slices.get('charms');
    expect(entities).toHaveLength(25);
    expect(catalog.skipped).toEqual([]);
    for (const entity of entities ?? []) expect(() => charmSchema.parse(entity)).not.toThrow();

    const byId = new Map((entities ?? []).map((e) => [e['id'], e]));
    expect(byId.get('wound')).toMatchObject({
      category: 'major', type: 'offensive', damageType: 'physical', percent: 5,
      chance: [5, 10, 11], points: [240, 360, 1200],
    });
    expect(byId.get('carnage')).toMatchObject({ category: 'major', type: 'offensive', damageType: 'neutral' });
    expect(byId.get('dodge')).toMatchObject({ category: 'major', type: 'defensive' });
    expect(byId.get('scavenge')).toMatchObject({ category: 'minor', type: 'passive' });
  });
});
