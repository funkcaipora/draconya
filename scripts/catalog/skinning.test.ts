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
  readGuaranteedBranches, readSkinningCatalog, readSkinningTable, resolveGuaranteedStages, resolveSkinnableCorpse,
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
		-- sem after: o Canary usaria o decayTo, que a importação não modela
		[250] = { value = CREATURE_SKINNING_CHANCE, newItem = 30 },
		-- o after não decai (sem duration no items.xml): o cadáver esfolado não sumiria
		[260] = { value = CREATURE_SKINNING_CHANCE, newItem = 30, after = 999 },
		-- test mismatch: a tabela é da faca, mas o ramo garantido do 2º estágio é da estaca
		[210] = { value = CREATURE_SKINNING_CHANCE, newItem = 30, after = 202 },
		-- test gifted: o ramo garantido do 2º estágio rende um item fora do catálogo
		[220] = { value = CREATURE_SKINNING_CHANCE, newItem = 30, after = 202 },
		-- test nodur: o 2º estágio tem ramo garantido e não decai (sem duration no items.xml)
		[230] = { value = CREATURE_SKINNING_CHANCE, newItem = 30, after = 202 },
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
	if item.itemid == 10 then
		-- sorteio inline: não é garantido
		if target.itemid == 33778 then
			local chance = math.random(1, 10000)
			if chance <= 8640 then
				player:addItem(33779, 1)
			else
				player:addItem(33780, 1)
			end
			return true
			-- transforma o alvo: não rende item
		elseif target.itemid == 11339 then
			target:transform(11331)
			player:say("You carve a solid bowl of the chunk of wood.", TALKTYPE_MONSTER_SAY)
			return true
		-- condição de quest: a condição com \`and\` nem casa com o padrão
		elseif target.itemid == 10735 and player:getStorageValue(1) == 1 then
			player:addItem(31, 1)
			return true
		-- armazenamento no corpo: o jogador só o recebe uma vez
		elseif target.itemid == 8181 then
			player:addItem(31, 1)
			player:setStorageValue(789100, 1)
			return true
		-- dois itens no corpo: não é um ramo simples
		elseif target.itemid == 8182 then
			player:addItem(31, 1)
			player:addItem(32, 1)
			return true
		-- o ramo garantido do 2º estágio do coelho de teste: fala, um item, return true
		elseif target.itemid == 201 then
			player:say("ok", TALKTYPE_MONSTER_SAY)
			player:addItem(31, 1)
			return true
		-- um item fora do catálogo no 2º estágio do gifted
		elseif target.itemid == 221 then
			player:addItem(99, 1)
			return true
		-- um 2º estágio que não decai
		elseif target.itemid == 231 then
			player:addItem(31, 1)
			return true
		-- um cadáver sem estágio da tabela, e com mais de um item de quantidade
		elseif target.itemid == 241 then
			player:addItem(31, 2)
			return true
		end
	end

	if item.itemid == 20 then
		if target.itemid == 211 then
			player:addItem(32, 1)
			return true
		end
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
	<item id="202" name="dead test rabbit"><attribute key="duration" value="300"/><attribute key="decayTo" value="203"/></item>
	<item id="203" name="dead test rabbit"><attribute key="duration" value="60"/><attribute key="decayTo" value="0"/></item>
	<item id="200" name="dead test rabbit"><attribute key="duration" value="10"/><attribute key="decayTo" value="201"/></item>
	<item id="201" name="dead test rabbit"><attribute key="duration" value="300"/><attribute key="decayTo" value="0"/></item>
	<item id="210" name="dead test mismatch"><attribute key="duration" value="10"/><attribute key="decayTo" value="211"/></item>
	<item id="211" name="dead test mismatch"><attribute key="duration" value="60"/><attribute key="decayTo" value="0"/></item>
	<item id="220" name="dead test gifted"><attribute key="duration" value="10"/><attribute key="decayTo" value="221"/></item>
	<item id="221" name="dead test gifted"><attribute key="duration" value="60"/><attribute key="decayTo" value="0"/></item>
	<item id="230" name="dead test nodur"><attribute key="duration" value="10"/><attribute key="decayTo" value="231"/></item>
	<item id="240" name="dead test lonely"><attribute key="duration" value="10"/><attribute key="decayTo" value="241"/></item>
	<item id="241" name="dead test lonely"><attribute key="duration" value="30"/><attribute key="decayTo" value="0"/></item>
	<item id="250" name="dead test noafter"><attribute key="duration" value="10"/><attribute key="decayTo" value="0"/></item>
	<item id="260" name="dead test open"><attribute key="duration" value="10"/><attribute key="decayTo" value="0"/></item>
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
  monsterIds: new Set([
    'test-drake', 'test-rabbit', 'test-demon', 'test-vampire', 'test-gap', 'test-shared',
    'test-noafter', 'test-open', 'test-mismatch', 'test-gifted', 'test-nodur', 'test-lonely',
  ]),
  itemIds: new Set(['test-knife', 'test-stake', 'test-leather', 'test-foot', 'test-dust', 'test-other-dust']),
};

describe('readSkinningTable', () => {
  it('lê as duas ferramentas, as chaves simples, as listas de prêmio e a escala do chanceRange', () => {
    const table = readSkinningTable(SKINNING_LUA);
    expect([...table.tools.keys()]).toEqual([10, 20]);
    expect(table.tools.get(10)?.get(100)).toEqual({ value: 25_000, newItem: 30, after: 102 });
    // A escultura de gelo é uma chave simples (sem `after`), e a lista de prêmios NÃO é.
    expect(table.tools.get(10)?.get(600)).toEqual({ value: 22_344, newItem: 601, after: undefined });
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
      // O `after` é o da entrada de CADA estágio (aqui os dois apontam para o mesmo `102`).
      stages: [
        { canaryItemId: 100, durationMs: 10_000, afterItemId: 102 },
        { canaryItemId: 101, durationMs: 300_000, afterItemId: 102 },
      ],
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
    // Um estágio esfolável sem `after`: o Canary cairia no decayTo, que a importação não modela.
    const noAfter = resolveSkinnableCorpse([{ itemId: 250, durationMs: 10_000 }], tools);
    expect(noAfter).toMatchObject({ problem: expect.stringContaining('after') as unknown });
  });
});

describe('readGuaranteedBranches e resolveGuaranteedStages', () => {
  it('lê só o ramo que rende item sem condição, com a ferramenta do `if` que o envolve', () => {
    expect(readGuaranteedBranches(SKINNING_LUA)).toEqual([
      { toolItemId: 10, targetItemId: 201, newItem: 31, quantity: 1 },
      { toolItemId: 10, targetItemId: 221, newItem: 99, quantity: 1 },
      { toolItemId: 10, targetItemId: 231, newItem: 31, quantity: 1 },
      { toolItemId: 10, targetItemId: 241, newItem: 31, quantity: 2 },
      { toolItemId: 20, targetItemId: 211, newItem: 32, quantity: 1 },
    ]);
  });

  it('o que o Lua condiciona, sorteia, transforma ou duplica NÃO é garantido', () => {
    // 33778 sorteia, 11339 transforma, 10735 tem `and` na condição, 8181 grava armazenamento e 8182 dá dois itens.
    const ids = readGuaranteedBranches(SKINNING_LUA).map((branch) => branch.targetItemId);
    for (const rejected of [33778, 11339, 10735, 8181, 8182]) expect(ids).not.toContain(rejected);
  });

  it('um ramo fora de qualquer `if item.itemid == F` não tem ferramenta e fica de fora', () => {
    expect(readGuaranteedBranches('if target.itemid == 9 then\n\tplayer:addItem(5, 1)\n\treturn true\nend\n')).toEqual([]);
  });

  it('a quantidade omitida é 1, e corpo numa linha só não é reconhecido', () => {
    const lua = 'if item.itemid == 1 then\n\tif target.itemid == 2 then\n\t\tplayer:addItem(7)\n\t\treturn true\n\tend\nend\n';
    expect(readGuaranteedBranches(lua)).toEqual([{ toolItemId: 1, targetItemId: 2, newItem: 7, quantity: 1 }]);
    expect(readGuaranteedBranches('if item.itemid == 1 then\n\tif target.itemid == 2 then player:addItem(7) return true end\nend\n'))
      .toEqual([]);
  });

  const branch = { toolItemId: 10, targetItemId: 201, newItem: 31, quantity: 1 };

  it('o estágio abre na soma das durações anteriores e dura o `duration` dele', () => {
    const chain = [
      { itemId: 200, durationMs: 10_000 }, { itemId: 201, durationMs: 300_000 }, { itemId: 202, durationMs: 60_000 },
    ];
    expect(resolveGuaranteedStages(chain, [branch])).toEqual([{ branch, startMs: 10_000, durationMs: 300_000 }]);
    // Sem ramo para nenhum estágio da cadeia, não há janela garantida.
    expect(resolveGuaranteedStages(chain, [{ ...branch, targetItemId: 999 }])).toEqual([]);
    expect(resolveGuaranteedStages(chain, [])).toEqual([]);
  });

  it('um estágio com ramo que não decai (sem duration) vira problema em vez de uma janela adivinhada', () => {
    const open = [{ itemId: 200, durationMs: 10_000 }, { itemId: 201, durationMs: undefined }];
    expect(resolveGuaranteedStages(open, [branch])).toMatchObject({ problem: expect.stringContaining('duration') as unknown });
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
    // Sem `after`, e com um `after` que não decai: o cadáver esfolado não teria vida a guardar.
    'mammals/test_noafter.lua': monster('Test Noafter', 250),
    'mammals/test_open.lua': monster('Test Open', 260),
    // O ramo garantido da estaca num cadáver cuja tabela é da faca; e um item garantido que o
    // catálogo não tem; e um estágio garantido que não decai; e um cadáver SÓ com estágio garantido.
    'mammals/test_mismatch.lua': monster('Test Mismatch', 210),
    'mammals/test_gifted.lua': monster('Test Gifted', 220),
    'mammals/test_nodur.lua': monster('Test Nodur', 230),
    'mammals/test_lonely.lua': monster('Test Lonely', 240),
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
      // A vida DEPOIS da tentativa é a do `after` (`102`: 300 s) mais o resto da cadeia (`103`: 60 s).
      stages: [
        { canaryItemId: 100, durationMs: 10_000, afterTtlMs: 360_000 },
        { canaryItemId: 101, durationMs: 300_000, afterTtlMs: 360_000 },
      ],
      source: { engine: 'canary', commit: COMMIT, path: CANARY_SKINNING_LUA },
    });
    // O coelho só tem sorteio no primeiro estágio; o segundo (`201`, 300 s) rende o pé SEM sorteio —
    // o ramo garantido da faca, que abre aos 10 s (a soma do estágio anterior).
    expect(entities.find((entity) => entity.id === 'test-rabbit')).toMatchObject({
      materialId: 'test-foot', stages: [{ canaryItemId: 200, durationMs: 10_000, afterTtlMs: 360_000 }],
      guaranteed: [{ canaryItemId: 201, startMs: 10_000, durationMs: 300_000, materialId: 'test-foot', quantity: 1 }],
    });
    // Quem não tem estágio garantido não leva o campo.
    expect(drake).not.toHaveProperty('guaranteed');
    // O monstro que compartilha o cadáver leva os MESMOS estágios (é o que o Scavenge compara).
    expect(entities.find((entity) => entity.id === 'test-shared')).toMatchObject({ stages: drake?.['stages'] });
    // Toda entidade gerada valida contra o schema real de `@draconya/content`.
    for (const entity of entities) expect(() => skinningSchema.parse(entity)).not.toThrow();
    expect(catalog.skinnableInCanary).toBe(12);
  });

  it('o que fica fora entra em `skipped` com o motivo, nunca em silêncio', () => {
    const skipped = readSkinningCatalog(canary(), DEPS).skipped;
    const reasonOf = (id: string) => skipped.find((entry) => entry.id === id)?.reason ?? '';
    expect(reasonOf('test-outsider')).toBe('monstro fora do catálogo do Draconya');
    expect(reasonOf('test-vampire')).toContain('material 99');
    expect(reasonOf('test-demon')).toContain('ferramenta, material ou chance diferentes');
    expect(reasonOf('test-gap')).toBe('');
    expect(reasonOf('test-noafter')).toContain('não declara `after`');
    expect(reasonOf('test-open')).toContain('o `after` 999 não tem duration');
    // O ramo garantido da estaca num cadáver da faca, o item fora do catálogo, o estágio que não
    // decai e o cadáver sem estágio da tabela: cada um com o seu motivo.
    expect(reasonOf('test-mismatch')).toContain('é da ferramenta 20, e a tabela deste cadáver é da 10');
    expect(reasonOf('test-gifted')).toContain('material garantido 99');
    expect(reasonOf('test-nodur')).toContain('não tem duration');
    expect(reasonOf('test-lonely')).toContain('só tem estágio de ramo garantido');
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
    // O ramo garantido sai nas notas com o estágio, o item, a quantidade e a ferramenta — e o
    // monstro que o recebeu.
    expect(notes).toContain('Ramos garantidos da ferramenta');
    expect(notes).toContain('201 → 31 ×1 (test-foot, ferramenta 10)');
    expect(notes).toContain('241 → 31 ×2');
    expect(notes).toContain('(1: test-rabbit)');
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

  it('o `skinning.lua` real tem UM ramo garantido: a faca no `4301`, 12172, sem condição', () => {
    const lua = readFileSync(join(ctx().canaryDir, CANARY_SKINNING_LUA), 'utf8');
    expect(readGuaranteedBranches(lua)).toEqual([{ toolItemId: 5908, targetItemId: 4301, newItem: 12172, quantity: 1 }]);
  });

  it('o Dragon, o Demon e o Rabbit reais batem com as cadeias do items.xml', () => {
    const catalog = readSkinningCatalog(ctx(), loadSkinningDeps(repoRoot));
    const byId = new Map((catalog.slices.get('skinning') ?? []).map((entity) => [entity.id, entity]));
    // O Dragon esfolado vira o `4026` (300 s) e depois o `4027` (60 s): 360 s, em qualquer idade.
    expect(byId.get('dragon')).toMatchObject({
      toolId: 'obsidian-knife', materialId: 'green-dragon-leather', chance: 25_000,
      stages: [
        { canaryItemId: 5973, durationMs: 10_000, afterTtlMs: 360_000 },
        { canaryItemId: 4025, durationMs: 300_000, afterTtlMs: 360_000 },
      ],
    });
    expect(byId.get('demon')).toMatchObject({ toolId: 'blessed-wooden-stake', materialId: 'demon-dust' });
    // O coelho: o sorteio é só do `6017` (10 s), e a faca no `4301` (300 s, a partir dos 10 s) rende o
    // pé de coelho SEM sorteio — o `elseif target.itemid == 4301` do Lua, que roda antes da tabela.
    for (const id of ['rabbit', 'killer-rabbit']) {
      expect(byId.get(id), id).toMatchObject({
        materialId: 'rabbits-foot', stages: [{ canaryItemId: 6017, durationMs: 10_000, afterTtlMs: 360_000 }],
        guaranteed: [{ canaryItemId: 4301, startMs: 10_000, durationMs: 300_000, materialId: 'rabbits-foot', quantity: 1 }],
      });
    }
    // E só os coelhos: nenhum outro monstro passa pelo `4301`.
    expect([...byId.values()].filter((entity) => 'guaranteed' in entity).map((entity) => entity.id).sort())
      .toEqual(['killer-rabbit', 'rabbit']);
    for (const entity of byId.values()) expect(() => skinningSchema.parse(entity)).not.toThrow();
    // Nenhum problema de tabela × cadeia entre os monstros reais: o único motivo de corte é o catálogo.
    expect(catalog.skipped.every((entry) => entry.reason === 'monstro fora do catálogo do Draconya')).toBe(true);
  });
});
