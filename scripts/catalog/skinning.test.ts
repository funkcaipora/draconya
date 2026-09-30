import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SKINNING_CHANCE_SCALE, skinningSchema } from '../../packages/content/src/schemas.js';
import { readSourceCommit } from './env.js';
import type { DecayStage } from './monsters.js';
import type { CatalogImportContext } from './registry.js';
import {
  CANARY_SKINNING_CHANCE_SCALE, CANARY_SKINNING_LUA, corpseChain, loadSkinningDeps, monsterCorpseId,
  readSkinningCatalog, readSkinningTable, resolveSkinnableCorpse,
} from './skinning.js';
import type { SkinningReaderDeps } from './skinning.js';

const COMMIT = 'd'.repeat(40);

// Fixture SINTÉTICA no formato do `skinning.lua` e do `items.xml` reais — números inventados,
// nunca um arquivo copiado (ADR 0019/0038 d.7). Duas ferramentas (10 e 20), um cadáver de dois
// estágios (`100` → `101`, ambos chave), um que só o primeiro estágio é chave, um cadáver de mapa
// sem monstro, as duas formas de lista de prêmio e uma escultura de gelo.
const SKINNING_LUA = `
local CREATURE_SKINNING_CHANCE = 25000
local config = {
	[10] = {
		-- test drake
		[100] = { value = CREATURE_SKINNING_CHANCE, newItem = 30, after = 102 },
		[101] = { value = CREATURE_SKINNING_CHANCE, newItem = 30, after = 102 }, -- after being killed
		-- test rabbit: só o primeiro estágio
		[200] = { value = CREATURE_SKINNING_CHANCE, newItem = 31, after = 202 },
		-- cadáver de mapa: nenhum monstro tem
		[300] = { value = CREATURE_SKINNING_CHANCE, newItem = 30, after = 301 },
		-- um monstro que o catálogo não tem
		[400] = { value = CREATURE_SKINNING_CHANCE, newItem = 30, after = 402 },
		-- uma lista de prêmios
		[500] = {
			{ value = 5000, newItem = 40 },
			{ value = 10000, newItem = 41 },
		},
		-- escultura de gelo
		[600] = { value = 22344, newItem = 601 },
	},
	[20] = {
		[700] = { value = 1000, newItem = 32, after = 702 },
		[701] = { value = 1000, newItem = 33, after = 702 }, -- outro material no 2º estágio
		[800] = { value = CREATURE_SKINNING_CHANCE, newItem = 99, after = 802 }, -- material fora do catálogo
	},
}

local skinning = Action()
function skinning.onUse(player, item, fromPosition, target, toPosition, isHotkey)
	local charmMType, chanceRange = player:getCharmMonsterType(CHARM_SCAVENGE), 100000
	if target.itemid == 4301 then
		return true
	end
end
`;

const ITEMS_XML = `<?xml version="1.0"?>
<items>
	<item id="10" article="an" name="test knife"/>
	<item id="20" article="a" name="test stake"/>
	<item id="30" name="test leather"/>
	<item id="31" name="test foot"/>
	<item id="32" name="test dust"/>
	<item id="33" name="test other dust"/>
	<item id="99" name="test missing"/>
	<item id="100" name="dead test drake"><attribute key="duration" value="10"/><attribute key="decayTo" value="101"/></item>
	<item id="101" name="dead test drake"><attribute key="duration" value="300"/><attribute key="decayTo" value="102"/></item>
	<item id="102" name="dead test drake"><attribute key="duration" value="300"/><attribute key="decayTo" value="103"/></item>
	<item id="103" name="dead test drake"><attribute key="duration" value="60"/><attribute key="decayTo" value="0"/></item>
	<item id="200" name="dead test rabbit"><attribute key="duration" value="10"/><attribute key="decayTo" value="201"/></item>
	<item id="201" name="dead test rabbit"><attribute key="duration" value="300"/><attribute key="decayTo" value="0"/></item>
	<item id="400" name="dead outsider"><attribute key="duration" value="10"/><attribute key="decayTo" value="0"/></item>
	<item id="700" name="dead test demon"><attribute key="duration" value="10"/><attribute key="decayTo" value="701"/></item>
	<item id="701" name="dead test demon"><attribute key="duration" value="300"/><attribute key="decayTo" value="0"/></item>
	<item id="800" name="dead test vampire"><attribute key="duration" value="10"/><attribute key="decayTo" value="0"/></item>
	<item id="900" name="dead test gap"><attribute key="duration" value="10"/><attribute key="decayTo" value="901"/></item>
	<item id="901" name="dead test gap"><attribute key="duration" value="10"/><attribute key="decayTo" value="902"/></item>
	<item id="902" name="dead test gap"><attribute key="duration" value="10"/><attribute key="decayTo" value="0"/></item>
</items>
`;

const monster = (name: string, corpse: number | undefined, extra = ''): string => `
local mType = Game.createMonsterType("${name}")
local monster = {}
monster.name = "${name}"
${corpse === undefined ? '' : `monster.corpse = ${String(corpse)}`}
${extra}
mType:register(monster)
`;

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function fixture(files: Readonly<Record<string, string>>): CatalogImportContext {
  const dir = mkdtempSync(join(tmpdir(), 'skinning-canary-'));
  dirs.push(dir);
  const write = (path: string, text: string): void => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write(CANARY_SKINNING_LUA, SKINNING_LUA);
  write('data/items/items.xml', ITEMS_XML);
  for (const [path, text] of Object.entries(files)) write(`data-otservbr-global/monster/${path}`, text);
  return { canaryDir: dir, forgottenServerDir: '/nao/existe', canaryCommit: COMMIT, forgottenServerCommit: '' };
}

const DEPS: SkinningReaderDeps = {
  monsterIds: new Set(['test-drake', 'test-rabbit', 'test-demon', 'test-vampire', 'test-gap', 'test-shared']),
  itemIds: new Set(['test-knife', 'test-stake', 'test-leather', 'test-foot', 'test-dust', 'test-other-dust']),
};

describe('readSkinningTable', () => {
  it('lê as duas ferramentas, as chaves simples, as listas de prêmio e a escala do chanceRange', () => {
    const table = readSkinningTable(SKINNING_LUA);
    expect([...table.tools.keys()]).toEqual([10, 20]);
    expect(table.tools.get(10)?.get(100)).toEqual({ value: 25_000, newItem: 30 });
    // A escultura de gelo é uma chave simples (sem `after`), e a lista de prêmios NÃO é.
    expect(table.tools.get(10)?.get(600)).toEqual({ value: 22_344, newItem: 601 });
    expect(table.nonCreatureKeys).toEqual([500]);
    expect(table.chanceScale).toBe(SKINNING_CHANCE_SCALE);
    expect(table.chanceScale).toBe(CANARY_SKINNING_CHANCE_SCALE);
    expect(table.newItemMentions).toBeGreaterThan(5);
  });
});

describe('corpseChain e resolveSkinnableCorpse', () => {
  const chains: ReadonlyMap<number, DecayStage> = new Map([
    [100, { durationSeconds: 10, decayTo: 101 }], [101, { durationSeconds: 300, decayTo: 102 }],
    [102, { durationSeconds: 300, decayTo: 0 }],
  ]);

  it('segue o decayTo estágio a estágio, e para no último (sem duration, ou decayTo 0)', () => {
    expect(corpseChain(100, chains)).toEqual([
      { itemId: 100, durationMs: 10_000 }, { itemId: 101, durationMs: 300_000 }, { itemId: 102, durationMs: 300_000 },
    ]);
    // Um id sem `duration` é o último estágio, e o leitor o reporta sem duração.
    expect(corpseChain(555, chains)).toEqual([{ itemId: 555, durationMs: undefined }]);
  });

  it('um ciclo no decayTo não trava', () => {
    const loop: ReadonlyMap<number, DecayStage> = new Map([
      [1, { durationSeconds: 1, decayTo: 2 }], [2, { durationSeconds: 1, decayTo: 1 }],
    ]);
    expect(corpseChain(1, loop)).toHaveLength(2);
  });

  it('a janela é o prefixo da cadeia cujos ids são chave; os outros estágios ficam de fora', () => {
    const { tools } = readSkinningTable(SKINNING_LUA);
    const resolved = resolveSkinnableCorpse(corpseChain(100, chains), tools);
    expect(resolved).toMatchObject({
      toolItemId: 10, entry: { value: 25_000, newItem: 30 },
      stages: [{ canaryItemId: 100, durationMs: 10_000 }, { canaryItemId: 101, durationMs: 300_000 }],
    });
  });

  it('cadeia sem estágio chave não é esfolável', () => {
    const { tools } = readSkinningTable(SKINNING_LUA);
    expect(resolveSkinnableCorpse([{ itemId: 9_999, durationMs: 1_000 }], tools)).toBeUndefined();
  });

  it('ferramenta, material ou chance diferentes entre estágios, ou janela com buraco, viram problema', () => {
    const { tools } = readSkinningTable(SKINNING_LUA);
    // 700 (poeira) e 701 (OUTRO material) na estaca: o Canary teria dois materiais para o cadáver.
    const mixed = resolveSkinnableCorpse([
      { itemId: 700, durationMs: 10_000 }, { itemId: 701, durationMs: 300_000 },
    ], tools);
    expect(mixed).toHaveProperty('problem');
    // Um estágio esfolável DEPOIS de um que não é: a janela não é contínua.
    const gap = resolveSkinnableCorpse([
      { itemId: 100, durationMs: 1_000 }, { itemId: 555, durationMs: 1_000 }, { itemId: 101, durationMs: 1_000 },
    ], tools);
    expect(gap).toMatchObject({ problem: expect.stringContaining('não é contínua') as unknown });
    // Um estágio esfolável sem duration no items.xml (não decai): a janela não fecha.
    const open = resolveSkinnableCorpse([{ itemId: 100, durationMs: undefined }], tools);
    expect(open).toMatchObject({ problem: expect.stringContaining('duration') as unknown });
  });
});

describe('monsterCorpseId', () => {
  it('lê a atribuição de topo, nunca um comentário nem outro campo', () => {
    expect(monsterCorpseId('monster.corpse = 5973\n')).toBe(5973);
    expect(monsterCorpseId('-- monster.corpse = 1\nmonster.corpse=2')).toBe(2);
    expect(monsterCorpseId('-- monster.corpse = 1\n')).toBeUndefined();
    expect(monsterCorpseId('monster.corpseTime = 3\n')).toBeUndefined();
    expect(monsterCorpseId('monster.description = "x"\n')).toBeUndefined();
  });
});

describe('readSkinningCatalog (fixture sintética)', () => {
  const canary = (): CatalogImportContext => fixture({
    'reptiles/test_drake.lua': monster('Test Drake', 100),
    'mammals/test_rabbit.lua': monster('Test Rabbit', 200),
    // O MESMO cadáver do Drake: compartilha os estágios (o Bruiser do Minotaur).
    'reptiles/test_shared.lua': monster('Test Shared', 100),
    // O `Test Drake` de novo, em outra pasta: o primeiro arquivo (na ordem) vence.
    'zoo/test_drake.lua': monster('Test Drake', 100),
    // Cadáver que não é chave: nenhuma entrada.
    'mammals/test_plain.lua': monster('Test Plain', 9_999),
    // Sem `monster.corpse`: nunca é esfolável.
    'mammals/test_ghost.lua': monster('Test Ghost', undefined),
    // Um monstro fora do catálogo do Draconya.
    'mammals/test_outsider.lua': monster('Test Outsider', 400),
    // Estaca com o material fora do catálogo de itens.
    'undeads/test_vampire.lua': monster('Test Vampire', 800),
    // Dois materiais nos estágios do mesmo cadáver.
    'demons/test_demon.lua': monster('Test Demon', 700),
    // Um buraco na janela: 900 não é chave.
    'demons/test_gap.lua': monster('Test Gap', 900),
    // Pasta que o catálogo pula.
    'familiars/test_familiar.lua': monster('Test Familiar', 100),
  });

  it('gera uma entidade por monstro esfolável do catálogo, com a janela, o material e a chance', () => {
    const catalog = readSkinningCatalog(canary(), DEPS);
    const entities = catalog.slices.get('skinning') ?? [];
    expect(entities.map((entity) => entity.id).sort()).toEqual(['test-drake', 'test-rabbit', 'test-shared']);
    const drake = entities.find((entity) => entity.id === 'test-drake');
    expect(drake).toEqual({
      id: 'test-drake', toolId: 'test-knife', materialId: 'test-leather', chance: 25_000,
      stages: [{ canaryItemId: 100, durationMs: 10_000 }, { canaryItemId: 101, durationMs: 300_000 }],
      source: { engine: 'canary', commit: COMMIT, path: CANARY_SKINNING_LUA },
    });
    // O coelho só é esfolável no primeiro estágio.
    expect(entities.find((entity) => entity.id === 'test-rabbit')).toMatchObject({
      materialId: 'test-foot', stages: [{ canaryItemId: 200, durationMs: 10_000 }],
    });
    // O monstro que compartilha o cadáver leva os MESMOS estágios (é o que o Scavenge compara).
    expect(entities.find((entity) => entity.id === 'test-shared')).toMatchObject({ stages: drake?.['stages'] });
    // Toda entidade gerada valida contra o schema real de `@draconya/content`.
    for (const entity of entities) expect(() => skinningSchema.parse(entity)).not.toThrow();
    expect(catalog.skinnableInCanary).toBe(7);
  });

  it('o que fica fora entra em `skipped` com o motivo, nunca em silêncio', () => {
    const skipped = readSkinningCatalog(canary(), DEPS).skipped;
    const reasonOf = (id: string) => skipped.find((entry) => entry.id === id)?.reason ?? '';
    expect(reasonOf('test-outsider')).toBe('monstro fora do catálogo do Draconya');
    expect(reasonOf('test-vampire')).toContain('material 99');
    expect(reasonOf('test-demon')).toContain('ferramenta, material ou chance diferentes');
    expect(reasonOf('test-gap')).toBe('');
    // O `test-drake` duplicado não vira uma segunda entidade.
    expect(skipped.filter((entry) => entry.id === 'test-drake')).toHaveLength(1);
    expect(reasonOf('test-drake')).toContain('duplicado');
    // A pasta que o catálogo pula (`familiars/`) nunca é lida.
    expect(skipped.some((entry) => entry.id === 'test-familiar')).toBe(false);
  });

  it('as notas dizem o que a tabela declara e o que nenhum monstro alcança', () => {
    const notes = readSkinningCatalog(canary(), DEPS).notes?.join('\n') ?? '';
    expect(notes).toContain('chanceRange');
    expect(notes).toContain('confere com `SKINNING_CHANCE_SCALE`');
    expect(notes).toContain('300 (?, test-knife)');
    expect(notes).toContain('600 (?, test-knife)');
    expect(notes).toContain('500 (?)');
    expect(notes).toContain('target.itemid == 4301');
  });

  it('é determinístico: a mesma fonte dá o mesmo resultado, na mesma ordem', () => {
    const ctx = canary();
    expect(readSkinningCatalog(ctx, DEPS)).toEqual(readSkinningCatalog(ctx, DEPS));
  });

  it('ferramenta fora do catálogo de itens tira a entrada com o motivo', () => {
    const deps: SkinningReaderDeps = { ...DEPS, itemIds: new Set(['test-leather', 'test-foot']) };
    const catalog = readSkinningCatalog(canary(), deps);
    expect(catalog.slices.get('skinning')).toEqual([]);
    expect(catalog.skipped.find((entry) => entry.id === 'test-drake')?.reason).toContain('ferramenta 10');
  });
});

// ---------------------------------------------------------------------------------------------
// Contra o checkout real, quando ele está nesta máquina (`CANARY_DIR`) — pulado no CI.

const REAL_CANARY_DIR = process.env['CANARY_DIR'];
const HAS_REAL_CANARY = REAL_CANARY_DIR !== undefined && REAL_CANARY_DIR !== ''
  && existsSync(join(REAL_CANARY_DIR, CANARY_SKINNING_LUA));

describe.skipIf(!HAS_REAL_CANARY)('o leitor contra o Canary real (CANARY_DIR)', () => {
  const ctx = (): CatalogImportContext => {
    const dir = REAL_CANARY_DIR as string;
    return { canaryDir: dir, forgottenServerDir: '/nao/existe', canaryCommit: readSourceCommit(dir), forgottenServerCommit: '' };
  };
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  it('a tabela real: 62 chaves simples, 2 listas de prêmio, chanceRange 100000, 87 menções de newItem', () => {
    const table = readSkinningTable(readFileSync(join(ctx().canaryDir, CANARY_SKINNING_LUA), 'utf8'));
    expect(table.tools.get(5908)?.size).toBe(52);
    expect(table.tools.get(5942)?.size).toBe(10);
    expect([...table.nonCreatureKeys].sort((a, b) => a - b)).toEqual([10426, 12816]);
    expect(table.chanceScale).toBe(100_000);
    expect(table.newItemMentions).toBe(87);
  });

  it('o Dragon, o Demon e o Rabbit reais batem com as cadeias do items.xml', () => {
    const catalog = readSkinningCatalog(ctx(), loadSkinningDeps(repoRoot));
    const byId = new Map((catalog.slices.get('skinning') ?? []).map((entity) => [entity.id, entity]));
    expect(byId.get('dragon')).toMatchObject({
      toolId: 'obsidian-knife', materialId: 'green-dragon-leather', chance: 25_000,
      stages: [{ canaryItemId: 5973, durationMs: 10_000 }, { canaryItemId: 4025, durationMs: 300_000 }],
    });
    expect(byId.get('demon')).toMatchObject({ toolId: 'blessed-wooden-stake', materialId: 'demon-dust' });
    expect(byId.get('rabbit')).toMatchObject({
      materialId: 'rabbits-foot', stages: [{ canaryItemId: 6017, durationMs: 10_000 }],
    });
    for (const entity of byId.values()) expect(() => skinningSchema.parse(entity)).not.toThrow();
    // Nenhum problema de tabela × cadeia entre os monstros reais: o único motivo de corte é o catálogo.
    expect(catalog.skipped.every((entry) => entry.reason === 'monstro fora do catálogo do Draconya')).toBe(true);
  });
});
