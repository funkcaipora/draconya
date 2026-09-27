import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readXmlFile, childrenOf } from './xml.js';
import { readSourceCommit } from './env.js';
import {
  AMMO_CANARY_IDS, applyAuthoredPrices, CANARY_NPC_DIR, EXCLUDED_NPC_FILES, readNpcShopPrices,
  SUPPLY_CANARY_IDS,
} from './npc-prices.js';
import type { CatalogImportContext } from './registry.js';

const COMMIT = 'a'.repeat(40);

// Fixture SINTÉTICA no formato do Canary — números inventados, nunca um arquivo real copiado
// (ADR 0019/0038 d.7).

/** Uma loja no formato DIRETO (a maioria dos NPCs reais). */
const DIRECT_SHOP_NPC = `
local internalNpcName = "Test Direct Trader"
local npcType = Game.createNpcType(internalNpcName)
local npcConfig = {}

npcConfig.name = internalNpcName

npcConfig.shop = {
	{ itemName = "test sword", clientId = 90001, buy = 85, sell = 10 },
	{ itemName = "test potion", clientId = 90002, buy = 60 },
	{ itemName = "bonebeast trophy", clientId = 90003, sell = 6000, storageKey = POINTSSTORAGE, storageValue = 40 },
}
`;

/** Uma loja com `sell` MAIOR para o mesmo item da anterior — prova que a agregação pega o maior. */
const HIGHER_SELL_NPC = `
local internalNpcName = "Test Higher Seller"
local npcConfig = {}
npcConfig.name = internalNpcName
npcConfig.shop = {
	{ itemName = "test sword", clientId = 90001, sell = 25 },
	{ itemName = "test potion", clientId = 90002, buy = 45 },
}
`;

/** Uma loja mais barata para o mesmo item — prova que a agregação pega o menor `buy`. */
const LOWER_SELL_NPC = `
local internalNpcName = "Test Lower Seller"
local npcConfig = {}
npcConfig.name = internalNpcName
npcConfig.shop = {
	{ itemName = "test sword", clientId = 90001, sell = 4 },
}
`;

/** O formato `itemsTable` + `for ... table.insert` (o padrão de `alexander.lua`, 24 NPCs reais). */
const ITEMS_TABLE_NPC = `
local internalNpcName = "Test General Store"
local npcConfig = {}
npcConfig.name = internalNpcName

local itemsTable = {
	["runes"] = {
		{ itemName = "test rune", clientId = 90004, buy = 40 },
	},
	["wands"] = {
		{ itemName = "test wand", clientId = 90005, buy = 5000 },
	},
}

npcConfig.shop = {}
for _, categoryTable in pairs(itemsTable) do
	for _, itemTable in pairs(categoryTable) do
		table.insert(npcConfig.shop, itemTable)
	end
end
`;

/** Um shop declarado por chamada de função — não é tabela literal, fica em `unparsedNpcFiles`. */
const UNPARSEABLE_NPC = `
local internalNpcName = "Test Dynamic Shop"
local npcConfig = {}
npcConfig.name = internalNpcName
npcConfig.shop = buildEquipmentShopFromItemsXml()
`;

/** Nah'Bob paga MUITO acima do resto (ADR 0037 d.4) — precisa ficar fora da agregação inteira. */
const NAH_BOB_NPC = `
local internalNpcName = "Nah'Bob"
local npcConfig = {}
npcConfig.name = internalNpcName
npcConfig.shop = {
	{ itemName = "test sword", clientId = 90001, sell = 99999 },
}
`;

/** Um NPC sem loja nenhuma — a maioria real (730/1035). */
const NO_SHOP_NPC = `
local internalNpcName = "Test Villager"
local npcConfig = {}
npcConfig.name = internalNpcName
`;

function withNpcDir(files: Readonly<Record<string, string>>, run: (canaryDir: string, ctx: CatalogImportContext) => void): void {
  const canaryDir = mkdtempSync(join(tmpdir(), 'draconya-npc-prices-test-'));
  try {
    const npcDir = join(canaryDir, CANARY_NPC_DIR);
    mkdirSync(npcDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(npcDir, name), content);
    }
    const ctx: CatalogImportContext = {
      canaryDir, forgottenServerDir: '/nao/existe', canaryCommit: COMMIT, forgottenServerCommit: '',
    };
    run(canaryDir, ctx);
  } finally {
    rmSync(canaryDir, { recursive: true, force: true });
  }
}

describe('readNpcShopPrices', () => {
  it('shop direto: agrega o MAIOR sell e o MENOR buy entre NPCs', () => {
    withNpcDir({ 'direct.lua': DIRECT_SHOP_NPC, 'higher.lua': HIGHER_SELL_NPC, 'lower.lua': LOWER_SELL_NPC }, (_dir, ctx) => {
      const aggregate = readNpcShopPrices(ctx);
      expect(aggregate.sellMaxByClientId.get(90001)).toMatchObject({ amount: 25, itemName: 'test sword', npcFile: 'higher.lua' });
      expect(aggregate.buyMinByClientId.get(90001)).toMatchObject({ amount: 85, itemName: 'test sword', npcFile: 'direct.lua' });
      expect(aggregate.buyMinByClientId.get(90002)).toMatchObject({ amount: 45, npcFile: 'higher.lua' });
    });
  });

  it('entrada com storageKey é descartada da agregação, o resto da loja continua valendo', () => {
    withNpcDir({ 'direct.lua': DIRECT_SHOP_NPC }, (_dir, ctx) => {
      const aggregate = readNpcShopPrices(ctx);
      expect(aggregate.sellMaxByClientId.has(90003)).toBe(false);
      expect(aggregate.shopEntriesExcludedStorageKey).toBe(1);
      expect(aggregate.buyMinByClientId.get(90001)?.amount).toBe(85);
    });
  });

  it('fallback itemsTable: lê a tabela sem executar o laço table.insert', () => {
    withNpcDir({ 'general-store.lua': ITEMS_TABLE_NPC }, (_dir, ctx) => {
      const aggregate = readNpcShopPrices(ctx);
      expect(aggregate.buyMinByClientId.get(90004)).toMatchObject({ amount: 40, itemName: 'test rune' });
      expect(aggregate.buyMinByClientId.get(90005)).toMatchObject({ amount: 5000, itemName: 'test wand' });
    });
  });

  it('Nah\'Bob é excluído mesmo pagando o maior preço da fixture', () => {
    withNpcDir({ 'direct.lua': DIRECT_SHOP_NPC, 'nah_bob.lua': NAH_BOB_NPC }, (_dir, ctx) => {
      expect(EXCLUDED_NPC_FILES.has('nah_bob.lua')).toBe(true);
      const aggregate = readNpcShopPrices(ctx);
      expect(aggregate.sellMaxByClientId.get(90001)?.amount).toBe(10);
    });
  });

  it('shop declarado por chamada de função vai para unparsedNpcFiles, sem lançar', () => {
    withNpcDir({ 'dynamic.lua': UNPARSEABLE_NPC }, (_dir, ctx) => {
      const aggregate = readNpcShopPrices(ctx);
      expect(aggregate.unparsedNpcFiles).toHaveLength(1);
      expect(aggregate.unparsedNpcFiles[0]?.file).toBe('dynamic.lua');
    });
  });

  it('NPC sem loja nenhuma: zero entradas, sem erro', () => {
    withNpcDir({ 'villager.lua': NO_SHOP_NPC }, (_dir, ctx) => {
      const aggregate = readNpcShopPrices(ctx);
      expect(aggregate.shopEntriesRead).toBe(0);
      expect(aggregate.unparsedNpcFiles).toHaveLength(0);
    });
  });
});

describe('applyAuthoredPrices', () => {
  function withRepoRoot(run: (repoRoot: string) => void): void {
    const repoRoot = mkdtempSync(join(tmpdir(), 'draconya-npc-prices-repo-test-'));
    try {
      run(repoRoot);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  }

  it('regrava price quando o buyMin do Canary diverge do autoral, e é idempotente', () => {
    withRepoRoot((repoRoot) => {
      const suppliesDir = join(repoRoot, 'packages/content/data/supplies');
      mkdirSync(suppliesDir, { recursive: true });
      const suppliesPath = join(suppliesDir, 'health-potion.json');
      writeFileSync(suppliesPath, JSON.stringify({ id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion' }, null, 2));

      const aggregate = {
        sellMaxByClientId: new Map(),
        buyMinByClientId: new Map([[SUPPLY_CANARY_IDS['health-potion'] as number, { amount: 50, itemName: 'health potion', npcFile: 'test.lua' }]]),
        npcFilesRead: 1, shopEntriesRead: 1, shopEntriesExcludedStorageKey: 0, unparsedNpcFiles: [],
      };

      const first = applyAuthoredPrices(repoRoot, aggregate, { check: false });
      expect(first.changes).toHaveLength(1);
      expect(first.changes[0]).toMatchObject({ slug: 'health-potion', oldPrice: 45, newPrice: 50 });
      const written = JSON.parse(readFileSync(suppliesPath, 'utf8'));
      expect(written.price).toBe(50);
      expect(written.name).toBe('Poção de Vida'); // preserva o resto do arquivo

      const second = applyAuthoredPrices(repoRoot, aggregate, { check: false });
      expect(second.changes).toHaveLength(0); // idempotente
    });
  });

  it('--check não escreve nada', () => {
    withRepoRoot((repoRoot) => {
      const suppliesDir = join(repoRoot, 'packages/content/data/supplies');
      mkdirSync(suppliesDir, { recursive: true });
      const suppliesPath = join(suppliesDir, 'mana-potion.json');
      writeFileSync(suppliesPath, JSON.stringify({ id: 'mana-potion', price: 50 }, null, 2));
      const aggregate = {
        sellMaxByClientId: new Map(),
        buyMinByClientId: new Map([[SUPPLY_CANARY_IDS['mana-potion'] as number, { amount: 56, itemName: 'mana potion', npcFile: 'test.lua' }]]),
        npcFilesRead: 1, shopEntriesRead: 1, shopEntriesExcludedStorageKey: 0, unparsedNpcFiles: [],
      };
      const outcome = applyAuthoredPrices(repoRoot, aggregate, { check: true });
      expect(outcome.changes).toHaveLength(1);
      const untouched = JSON.parse(readFileSync(suppliesPath, 'utf8'));
      expect(untouched.price).toBe(50);
    });
  });

  it('slug sem buyMin correspondente vai para unresolved, nunca vira 0 em silêncio', () => {
    withRepoRoot((repoRoot) => {
      const suppliesDir = join(repoRoot, 'packages/content/data/supplies');
      mkdirSync(suppliesDir, { recursive: true });
      writeFileSync(join(suppliesDir, 'health-potion.json'), JSON.stringify({ id: 'health-potion', price: 45 }));
      const aggregate = {
        sellMaxByClientId: new Map(), buyMinByClientId: new Map(),
        npcFilesRead: 0, shopEntriesRead: 0, shopEntriesExcludedStorageKey: 0, unparsedNpcFiles: [],
      };
      const outcome = applyAuthoredPrices(repoRoot, aggregate, { check: true });
      expect(outcome.unresolved.some((u) => u.includes('health-potion'))).toBe(true);
      expect(outcome.changes).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Contra o checkout real, quando ele está nesta máquina (`CANARY_DIR`) — pulado no CI.

const REAL_CANARY_DIR = process.env['CANARY_DIR'];
const HAS_REAL_CANARY = REAL_CANARY_DIR !== undefined && REAL_CANARY_DIR !== ''
  && existsSync(join(REAL_CANARY_DIR, CANARY_NPC_DIR));

describe.skipIf(!HAS_REAL_CANARY)('leitor contra o Canary real (CANARY_DIR)', () => {
  const dir = HAS_REAL_CANARY ? (REAL_CANARY_DIR as string) : '';
  const commit = HAS_REAL_CANARY ? readSourceCommit(dir) : '';
  const ctx: CatalogImportContext = { canaryDir: dir, forgottenServerDir: '/nao/existe', canaryCommit: commit, forgottenServerCommit: '' };

  function itemNameOf(clientId: number): string | undefined {
    const root = readXmlFile(join(dir, 'data/items/items.xml'));
    const item = childrenOf(root, 'item').find((el) => el.attributes['id'] === String(clientId));
    return item?.attributes['name'];
  }

  it('os clientId de SUPPLY_CANARY_IDS/AMMO_CANARY_IDS batem o itemName esperado em items.xml', () => {
    for (const [slug, clientId] of Object.entries({ ...SUPPLY_CANARY_IDS, ...AMMO_CANARY_IDS })) {
      const expected = slug.replace(/-/g, ' ');
      expect(itemNameOf(clientId), `${slug} → clientId ${clientId}`).toBe(expected);
    }
  });

  it('sword (3264): maior sell é 25, igual ao sword.json autoral', () => {
    const aggregate = readNpcShopPrices(ctx);
    expect(aggregate.sellMaxByClientId.get(3264)?.amount).toBe(25);
  });

  it('health potion (266): menor buy é 50', () => {
    const aggregate = readNpcShopPrices(ctx);
    expect(aggregate.buyMinByClientId.get(266)?.amount).toBe(50);
  });
});
