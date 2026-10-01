// scripts/catalog/npc-prices.ts — o leitor de preço de NPC do Canary (M34-03, #574; ADR 0037/0038).
//
//   pnpm catalog:npc-prices          # regrava price em data/supplies/*.json e data/ammunition/*.json
//   pnpm catalog:npc-prices --check  # regenera em memória e compara, não escreve nada
//
// Lê `data-otservbr-global/npc/*.lua` como DADO (`lua-table.ts` avalia só expressão literal,
// nunca executa Lua) e agrega, por `clientId` — o MESMO id que `items.xml` usa como atributo
// `id` (conferido: health potion `id="266"` em `items.xml` e `clientId = 266` no shop) —, o
// MAIOR `sell` (o que o NPC paga ao jogador; vira `value` do item, ADR 0038) e o MENOR `buy`
// (o que o NPC cobra do jogador; vira `price` de supply/munição).
//
// **Duas formas de declarar o shop no Canary.** A maioria (278/1035) atribui
// `npcConfig.shop = { { itemName = ..., clientId = ..., buy = ..., sell = ... }, ... }` direto —
// capturada por `evaluateAssignments(source, 'npcConfig', ...).shop`. 24 NPCs (o general
// store/blacksmith, ex. `alexander.lua`) primeiro montam `local itemsTable = { categoria = {
// {...}, {...} }, ... }` e só depois um `for _, categoryTable in pairs(itemsTable) do
// table.insert(npcConfig.shop, item) end` que este leitor NÃO executa (não é dado literal,
// executar seria rodar Lua) — para esses, lemos `itemsTable` direto pelo mesmo mecanismo que já
// achata `local monster = { ... }` em `monsters.ts`, e achatamos toda categoria junto. 2 NPCs
// (`npcConfig.shop = buildEquipmentShopFromItemsXml()`, `= LootShopConfig`) usam uma chamada de
// função ou um identificador externo — nenhum dos dois é tabela literal — e ficam em
// `unparsedNpcFiles`. 2 NPCs (`squeekquek`, `larry`) têm `npcConfig.shop = {}` sem `itemsTable`
// nenhum: loja vazia de fato, zero entradas, sem erro.
//
// **Exclusão do Nah'Bob** (precedente do #524 — `packages/content/data/items/royal-helmet.json`
// e `boots-of-haste.json`, ADR 0037 d.4): o que ele paga é a economia própria do
// `data-otservbr-global`, não um fato do Tibia real — ele oferece 30000 pela Boots of Haste
// (TibiaWiki: "no buy/sell offers") e 1000 pela Spike Sword contra 240 nas outras 6 lojas que a
// vendem. Sem excluir, "maior sell" absorveria esse viés em qualquer item que ele compra, e
// contradiria o que o #524 já decidiu para esses dois itens.
//
// **Exclusão de entrada com `storageKey`**: preço condicionado a progresso de quest (ex.
// `{ itemName = "bonebeast trophy", clientId = 10244, sell = 6000, storageKey = POINTSSTORAGE,
// storageValue = 40 }`, `angus.lua`) não é preço geral do NPC — descartada da agregação; o resto
// da mesma loja continua valendo.
//
// **Supply e munição são autorais** (`packages/content/data/supplies/*.json`,
// `data/ammunition/*.json`) — schemas próprios (`supplySchema`/`ammunitionSchema`, não
// `itemSchema`), sem `generated/`/`overrides/`. O nome do arquivo está em português ("Poção de
// Vida") e não bate com o `itemName` em inglês do Canary ("health potion"), então a
// correspondência é uma tabela curada à mão (`SUPPLY_CANARY_IDS`/`AMMO_CANARY_IDS`), verificada
// uma a uma contra `items.xml` no teste que roda contra o Canary real.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateAssignments, type ConstantResolver, type LuaValue } from './lua-table.js';
import type { CatalogImportContext } from './registry.js';

/** A raiz dos NPCs dentro do checkout do Canary. */
export const CANARY_NPC_DIR = 'data-otservbr-global/npc';

/** Nah'Bob paga preço fora da economia real do Tibia (ver o cabeçalho deste arquivo). */
export const EXCLUDED_NPC_FILES: ReadonlySet<string> = new Set(['nah_bob.lua']);

/** Uma observação de preço, com de onde ela veio — para o relatório e para depuração. */
export interface ShopPriceObservation {
  readonly amount: number;
  readonly itemName: string;
  readonly npcFile: string;
}

export interface UnparsedNpcFile {
  readonly file: string;
  readonly reason: string;
}

export interface NpcShopAggregate {
  /** `clientId` → maior `sell` observado (vira `value` do item, ADR 0038). */
  readonly sellMaxByClientId: ReadonlyMap<number, ShopPriceObservation>;
  /** `clientId` → menor `buy` observado (vira `price` de supply/munição). */
  readonly buyMinByClientId: ReadonlyMap<number, ShopPriceObservation>;
  readonly npcFilesRead: number;
  readonly shopEntriesRead: number;
  readonly shopEntriesExcludedStorageKey: number;
  readonly unparsedNpcFiles: readonly UnparsedNpcFile[];
}

/**
 * Qualquer identificador não reconhecido resolve para `0` — não pelo VALOR (nunca lido: só
 * `storageKey`/`storageValue` e variações de nome de categoria aparecem aqui, e a entrada com
 * `storageKey` é descartada por inteiro, nunca por seu valor resolvido), mas para que a tabela
 * inteira avalie sem lançar. Sem isto, `storageKey = tomes` (identificador de `local tomes =
 * Storage.Quest.U8_54.TheNewFrontier.TomeofKnowledge` — uma cadeia de `MemberExpression` que
 * `applyLocal` já ignora silenciosamente, então `tomes` nunca vira um local conhecido) derrubaria
 * a loja inteira do NPC por causa de UM item com desconto de quest.
 */
function priceConstants(): ConstantResolver {
  return { resolve: () => 0 };
}

interface RawShopEntry {
  readonly itemName: string;
  readonly clientId: number;
  readonly buy?: number;
  readonly sell?: number;
}

/** Conta descartes por `storageKey` por referência — `collectEntries` percorre recursivamente. */
interface CollectStats {
  excludedStorageKey: number;
}

function collectEntries(value: LuaValue, entries: RawShopEntry[], stats: CollectStats): void {
  if (Array.isArray(value)) {
    for (const element of value) collectEntry(element, entries, stats);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const category of Object.values(value)) collectEntries(category, entries, stats);
  }
}

function collectEntry(entry: LuaValue, entries: RawShopEntry[], stats: CollectStats): void {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return;
  const record = entry as Record<string, LuaValue>;
  if (record['storageKey'] !== undefined) {
    stats.excludedStorageKey += 1;
    return;
  }
  const itemName = record['itemName'];
  const clientId = record['clientId'];
  if (typeof itemName !== 'string' || typeof clientId !== 'number') return;
  const buy = record['buy'];
  const sell = record['sell'];
  entries.push({
    itemName, clientId,
    ...(typeof buy === 'number' ? { buy } : {}),
    ...(typeof sell === 'number' ? { sell } : {}),
  });
}

/** Lê TODO `data-otservbr-global/npc/*.lua` e agrega o preço de cada `clientId`. */
export function readNpcShopPrices(ctx: CatalogImportContext): NpcShopAggregate {
  const dir = join(ctx.canaryDir, CANARY_NPC_DIR);
  const files = readdirSync(dir).filter((file) => file.endsWith('.lua')).sort();
  const sellMax = new Map<number, ShopPriceObservation>();
  const buyMin = new Map<number, ShopPriceObservation>();
  const unparsed: UnparsedNpcFile[] = [];
  const resolver = priceConstants();
  let entriesRead = 0;
  let excludedStorageKey = 0;

  for (const file of files) {
    if (EXCLUDED_NPC_FILES.has(file)) continue;
    const source = readFileSync(join(dir, file), 'utf8');
    const entries: RawShopEntry[] = [];
    const stats: CollectStats = { excludedStorageKey: 0 };
    try {
      const npc = evaluateAssignments(source, 'npcConfig', resolver);
      if (npc['shop'] !== undefined) collectEntries(npc['shop'], entries, stats);
      if (entries.length === 0) {
        // `npcConfig.shop` vazio (`= {}`) OU ausente: tenta o fallback do `itemsTable` local
        // (DT-03) — sem custo quando o arquivo não o declara (`evaluateAssignments` devolve `{}`).
        const items = evaluateAssignments(source, 'itemsTable', resolver);
        collectEntries(items, entries, stats);
      }
    } catch (erro) {
      unparsed.push({ file, reason: (erro as Error).message });
      continue;
    }
    entriesRead += entries.length;
    excludedStorageKey += stats.excludedStorageKey;
    for (const entry of entries) {
      if (entry.sell !== undefined) {
        const current = sellMax.get(entry.clientId);
        if (current === undefined || entry.sell > current.amount) {
          sellMax.set(entry.clientId, { amount: entry.sell, itemName: entry.itemName, npcFile: file });
        }
      }
      if (entry.buy !== undefined) {
        const current = buyMin.get(entry.clientId);
        if (current === undefined || entry.buy < current.amount) {
          buyMin.set(entry.clientId, { amount: entry.buy, itemName: entry.itemName, npcFile: file });
        }
      }
    }
  }

  return {
    sellMaxByClientId: sellMax,
    buyMinByClientId: buyMin,
    npcFilesRead: files.length,
    shopEntriesRead: entriesRead,
    shopEntriesExcludedStorageKey: excludedStorageKey,
    unparsedNpcFiles: unparsed,
  };
}

// -------------------------------------------------------------------------------------------
// Aplicação em supply e munição — os dois schemas 100% autorais que `items.ts` não toca.

/** slug do arquivo autoral em `data/supplies/` → `clientId` do Canary (= `id` de `items.xml`). */
export const SUPPLY_CANARY_IDS: Readonly<Record<string, number>> = {
  'small-health-potion': 7876,
  'health-potion': 266,
  'strong-health-potion': 236,
  'great-health-potion': 239,
  'supreme-health-potion': 23375,
  'mana-potion': 268,
  'strong-mana-potion': 237,
  'great-mana-potion': 238,
  'great-spirit-potion': 7642,
  'explosion-rune': 3200,
  'ultimate-healing-rune': 3160,
  'avalanche-rune': 3161,
  'stone-shower-rune': 3175,
  'thunderstorm-rune': 3202,
  'intense-healing-rune': 3152,
  'fireball-rune': 3189,
  'icicle-rune': 3158,
  'light-magic-missile-rune': 3174,
  'light-stone-shower-rune': 21351,
  'stalagmite-rune': 3179,
  // Runas de campo e parede do jogador (#591) — `runeId` de cada script em
  // `data/scripts/runes/*.lua` (o mesmo `id` que `items.xml` usa).
  'fire-field-rune': 3188,
  'poison-field-rune': 3172,
  'energy-field-rune': 3164,
  'fire-wall-rune': 3190,
  'poison-wall-rune': 3176,
  'energy-wall-rune': 3166,
  'magic-wall-rune': 3180,
  'wild-growth-rune': 3156,
  'destroy-field-rune': 3148,
  'fire-bomb-rune': 3192,
  'poison-bomb-rune': 3173,
  'energy-bomb-rune': 3149,
  // As duas runas de invocação (#600) — `runeId` de `convince_creature.lua`/`animate_dead_rune.lua`.
  'convince-creature-rune': 3177,
  'animate-dead-rune': 3203,
};

/** slug do arquivo autoral em `data/ammunition/` → `clientId` do Canary. */
export const AMMO_CANARY_IDS: Readonly<Record<string, number>> = {
  arrow: 3447,
  'burst-arrow': 3449,
  'sniper-arrow': 7364,
  'onyx-arrow': 7365,
  'power-bolt': 3450,
};

export interface AuthoredPriceChange {
  readonly path: string;
  readonly slug: string;
  readonly oldPrice: number;
  readonly newPrice: number;
  readonly source: ShopPriceObservation;
}

function readJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/**
 * Troca só o VALOR do campo `"price": <número>,` no TEXTO bruto do arquivo, preservando toda a
 * formatação autoral (indentação, campo em linha única como `amountRange`, quebra de linha
 * final) — reescrever com `JSON.stringify` de novo produziria um diff enorme e sem relação com a
 * mudança real (reindentação de campo que ninguém tocou). Só existe UM `"price"` de topo em cada
 * arquivo de supply/munição (confirmado pelo schema — `supplySchema`/`ammunitionSchema` não têm
 * `price` aninhado em nenhum outro lugar), então a primeira ocorrência é a certa.
 */
function replacePriceField(source: string, newPrice: number): string {
  const pattern = /"price":\s*-?\d+(\.\d+)?/;
  if (!pattern.test(source)) throw new Error('campo "price" não encontrado no arquivo — formato inesperado');
  return source.replace(pattern, `"price": ${newPrice}`);
}

/**
 * Regrava `price` em cada `data/supplies/<slug>.json`/`data/ammunition/<slug>.json` cujo `buyMin`
 * do Canary diverge do valor autoral atual. `check: true` só compara (nunca escreve) — o mesmo
 * contrato de `checkImport` em `import.ts`. Um slug da tabela sem `buyMin` correspondente (nenhum
 * NPC vende) entra em `unresolved`, nunca é tratado como `0` em silêncio — supply/munição sempre
 * tiveram um preço de referência (TibiaWiki/kit level 200), e apagá-lo sem fonte seria pior que
 * deixar o provisório.
 */
export function applyAuthoredPrices(
  repoRoot: string, aggregate: NpcShopAggregate, options: { readonly check: boolean },
): { readonly changes: readonly AuthoredPriceChange[]; readonly unresolved: readonly string[] } {
  const changes: AuthoredPriceChange[] = [];
  const unresolved: string[] = [];
  const groups: readonly { readonly ids: Readonly<Record<string, number>>; readonly dir: string }[] = [
    { ids: SUPPLY_CANARY_IDS, dir: 'packages/content/data/supplies' },
    { ids: AMMO_CANARY_IDS, dir: 'packages/content/data/ammunition' },
  ];
  for (const group of groups) {
    for (const [slug, clientId] of Object.entries(group.ids)) {
      const observation = aggregate.buyMinByClientId.get(clientId);
      if (observation === undefined) {
        unresolved.push(`${slug} (clientId ${clientId}): nenhum NPC com "buy" encontrado`);
        continue;
      }
      const path = join(repoRoot, group.dir, `${slug}.json`);
      const data = readJsonFile(path);
      const oldPrice = data['price'];
      if (typeof oldPrice !== 'number') {
        unresolved.push(`${slug}: ${path} sem campo "price" numérico`);
        continue;
      }
      if (oldPrice === observation.amount) continue;
      changes.push({ path, slug, oldPrice, newPrice: observation.amount, source: observation });
      if (!options.check) {
        const source = readFileSync(path, 'utf8');
        writeFileSync(path, replacePriceField(source, observation.amount));
      }
    }
  }
  return { changes, unresolved };
}

/**
 * `docs/reference/catalog/npc-prices-report.md` — o mesmo espírito de `report.ts` (ADR 0038
 * decisão 5): o que a agregação viu, o que ela ignorou de propósito e o que mudou. Sem
 * data/hora — reimportar o MESMO commit do Canary produz o MESMO relatório (idempotência).
 */
export function formatNpcPricesReport(
  aggregate: NpcShopAggregate, changes: readonly AuthoredPriceChange[], unresolved: readonly string[], canaryCommit: string,
): string {
  const lines: string[] = [
    '# Relatório de importação — preço de NPC (M34-03/#574)',
    '',
    `Fonte: \`canary\` em \`${canaryCommit}\`.`,
    '',
    `${aggregate.npcFilesRead} arquivo(s) de NPC lidos, ${aggregate.shopEntriesRead} entrada(s) de loja `
    + `agregadas, ${aggregate.shopEntriesExcludedStorageKey} descartada(s) por \`storageKey\` (preço condicionado a `
    + 'quest — DT-02).',
    '',
    '## Exclusões',
    '',
    '- Nah\'Bob (`nah_bob.lua`) — economia própria do `data-otservbr-global`, não fato do Tibia real '
    + '(precedente #524, ADR 0037 d.4; DT-01).',
  ];
  if (aggregate.unparsedNpcFiles.length > 0) {
    lines.push('', '## Arquivos fora do corte', '', '| arquivo | motivo |', '|---|---|');
    for (const entry of [...aggregate.unparsedNpcFiles].sort((a, b) => a.file.localeCompare(b.file))) {
      lines.push(`| \`${entry.file}\` | ${entry.reason} |`);
    }
  }
  lines.push('', '## Preço de supply/munição (autoral)', '');
  if (changes.length === 0) {
    lines.push('Nenhuma mudança nesta importação — o dado commitado já confere com o Canary.');
  } else {
    lines.push('| slug | preço anterior | preço novo | fonte |', '|---|---|---|---|');
    for (const change of [...changes].sort((a, b) => a.slug.localeCompare(b.slug))) {
      lines.push(`| \`${change.slug}\` | ${change.oldPrice} | ${change.newPrice} | \`${change.source.npcFile}\` |`);
    }
  }
  if (unresolved.length > 0) {
    lines.push('', '## Sem preço resolvido', '', ...unresolved.map((reason) => `- ${reason}`));
  }
  lines.push('');
  return lines.join('\n');
}

// -------------------------------------------------------------------------------------------
// CLI — `pnpm catalog:npc-prices [--check]`.

if (import.meta.main) {
  const { existsSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { parseArgs } = await import('node:util');
  const { readSourceCommit, resolveCanaryDir, resolveForgottenServerDir, sourceAvailable } = await import('./env.js');

  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { check: { type: 'boolean' }, 'canary-dir': { type: 'string' } },
    strict: true,
  });
  const canaryDir = values['canary-dir'] === undefined ? resolveCanaryDir(ROOT) : resolve(ROOT, values['canary-dir']);
  const check = values.check === true;

  if (!existsSync(canaryDir)) {
    const message = `catalog:npc-prices: ${canaryDir} não está nesta máquina (CANARY_DIR em scripts/catalog/env.ts)`;
    if (check) {
      console.log(`${message} — pulado`);
      process.exit(0);
    }
    console.error(`${message} — não há como importar o que não existe.`);
    process.exit(1);
  }

  const ctx: CatalogImportContext = {
    canaryDir,
    forgottenServerDir: resolveForgottenServerDir(ROOT),
    canaryCommit: readSourceCommit(canaryDir),
    forgottenServerCommit: sourceAvailable(resolveForgottenServerDir(ROOT)) ? readSourceCommit(resolveForgottenServerDir(ROOT)) : '',
  };
  const aggregate = readNpcShopPrices(ctx);
  const { changes, unresolved } = applyAuthoredPrices(ROOT, aggregate, { check });
  const { mkdirSync } = await import('node:fs');
  const reportPath = join(ROOT, 'docs', 'reference', 'catalog', 'npc-prices-report.md');
  const report = formatNpcPricesReport(aggregate, changes, unresolved, ctx.canaryCommit);
  const committedReport = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : null;
  const reportStale = committedReport !== report;
  if (!check) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, report);
  }

  console.log(
    `npc-prices: ${aggregate.npcFilesRead} arquivo(s) de NPC, ${aggregate.shopEntriesRead} entrada(s) de loja `
    + `(${aggregate.shopEntriesExcludedStorageKey} descartada(s) por storageKey), `
    + `${aggregate.unparsedNpcFiles.length} arquivo(s) fora do corte.`,
  );
  for (const change of changes) {
    const verb = check ? 'DESATUALIZADO' : 'atualizado';
    console.log(`  ${change.slug}: price ${change.oldPrice} → ${change.newPrice} (${verb}, fonte: ${change.source.npcFile})`);
  }
  for (const reason of unresolved) console.log(`  sem preço: ${reason}`);
  if (check && reportStale) console.error(`  ${reportPath}: DESATUALIZADO`);

  process.exit(check && (changes.length > 0 || reportStale) ? 1 : 0);
}
