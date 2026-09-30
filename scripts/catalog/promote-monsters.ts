// scripts/catalog/promote-monsters.ts — `pnpm catalog:promote-monsters [--check]` (#580, ADR 0038
// decisão 2/3, `packages/content/CLAUDE.md` "O catálogo importado").
//
// `pnpm catalog:import monsters` (#578/#579) só escreve em `packages/content/staging/monsters/`
// — não é conteúdo carregado, porque o loot aponta item por slug e o catálogo de itens ainda não
// tinha entidade nenhuma promovida quando o leitor rodou. Este script é o passo SEGUINTE: separa
// cada entidade gerada em três destinos —
//
//   - o monstro em si (sem `bestiary` nem `outfitId`) vai para
//     `packages/content/data/monsters/generated/<fatia>.json`, no mesmo formato que
//     `packages/content/data/items/generated/*.json` já usa (ADR 0038 decisão 2);
//   - `bestiary` vira uma linha em `packages/content/data/bestiary/baseline.json` (`entries`);
//   - `outfitId` vira uma linha em `packages/content/data/appearances/baseline.json`
//     (`monsters`); `objectLooks` (#621, o `appearanceId` de cada `outfitItem`) vira as linhas de
//     `looks` do mesmo arquivo — a condição `outfit` só carrega a chave.
//
// Loot é validado contra o catálogo de itens REAL — `packages/content/data/items`, o que
// `loadContent` de fato carrega hoje. Desde a promoção de itens (#748, `promote-items.ts`) isso
// inclui `data/items/generated/`, que `readItemCatalog` (abaixo) já lê sem mudança nenhuma —
// `readEntitiesFrom(join(itemsDir, 'generated'))` sempre existiu aqui, escrito ANTES de haver o
// que promover, porque a convenção de três camadas (autoral/gerado/override) é a mesma de
// `packages/content/src/load.ts` para qualquer `data/<tipo>/`. Uma linha de `loot.items` cujo
// `itemId` não existe nesse catálogo, ou que pede `max > 1` de um item que não empilha
// (`rollModel: "canary"`, a mesma regra de `content.ts`), é removida e contada no relatório —
// nunca falha o boot em silêncio. Rat, Rotworm, Dragon e Dragon Lord nunca são promovidos POR
// ESTE SCRIPT — o #581 é quem os regenerou, uma única vez, direto em `generated/<fatia>.json`
// (Rat em `mammals.json`, Rotworm em `vermins.json`, Dragon e Dragon Lord em `dragons.json`),
// com override próprio (`data/monsters/overrides/`) para o que o Draconya ainda precisa manter
// diferente do Canary puro (`blockable`, até o #582+/M36-05 converter as duas hunts). Rodar este
// script de novo NUNCA sobrescreve essas quatro entradas — `preserveHandAuthored` as reconduz de
// volta à fatia a cada escrita, e `--check` as trata como parte do "em dia" pela mesma função.
//
// Determinístico e SEM depender de `CANARY_DIR`: a entrada é o que já está commitado em
// `staging/monsters/generated/` e `data/items/`, então rodar duas vezes no mesmo commit produz
// sempre a mesma saída — a mesma garantia que `generated-writer.ts` já dá para a importação.

import {
  existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { repoRootFrom } from './env.js';
import {
  formatGeneratedSlice, listGeneratedSlices, writeGeneratedSlice, type CatalogEntity,
} from './generated-writer.js';
import { stripUnknownOutfits } from './monster-abilities.js';

/** Rat, Rotworm, Dragon e Dragon Lord — regenerados só pelo #581, nunca por esta promoção. Desde
 *  o #581 eles JÁ VIVEM em `generated/<fatia>.json` (`preserveHandAuthored` os mantém lá); este
 *  conjunto continua existindo para que uma reimportação futura do Canary NUNCA os sobrescreva
 *  em silêncio — a regeneração deles é sempre um ato deliberado, nunca automático.
 *  `dragon-lord-hatchling` entrou no #560: ganhou a MESMA cadeia hand-authored de estágios de
 *  campo que `dragon-lord` (`docs/reference/catalog/monsters-report.md`), e sem esta entrada a
 *  promoção normal a REESCREVIA com a fatia fresca — sem `stages` — na primeira reimportação. */
export const HAND_AUTHORED_MONSTER_IDS: ReadonlySet<string> = new Set([
  'rat', 'rotworm', 'dragon', 'dragon-lord', 'dragon-lord-hatchling',
]);

export interface ItemCatalogEntry {
  readonly stackable: boolean;
}

/** Uma decisão de exclusão de MONSTRO inteiro (nunca por causa de loot — isso é por linha). */
export interface SkippedPromotion {
  readonly id: string;
  readonly reason: string;
}

/** Uma linha de loot removida de um monstro promovido, e por quê. */
export interface DroppedLootLine {
  readonly monsterId: string;
  readonly itemId: string;
  readonly reason: string;
}

export interface PromotionResult {
  /** Fatia (nome do arquivo de `staging/monsters/generated/`) → monstros promovidos. */
  readonly slices: ReadonlyMap<string, CatalogEntity[]>;
  readonly bestiaryEntries: ReadonlyMap<string, Record<string, unknown>>;
  readonly appearanceEntries: ReadonlyMap<string, number>;
  /** `chave de objeto → appearanceId` (#621): as linhas de `appearances.looks`. */
  readonly lookEntries: ReadonlyMap<string, number>;
  /** Monstro → quantas entradas `outfit` saíram porque o monstro imitado não foi promovido (#621). */
  readonly strippedOutfits: ReadonlyMap<string, number>;
  readonly skipped: readonly SkippedPromotion[];
  readonly droppedLootLines: readonly DroppedLootLine[];
}

/** Lê `id`/`stackable` de todo `*.json` direto de `dir`, mais `generated/` e `overrides/`
 *  aplicados por cima — a MESMA convenção de três camadas que `packages/content/src/load.ts`
 *  usa para qualquer `data/<tipo>/` (autoral, gerado, correção). */
export function readItemCatalog(itemsDir: string): ReadonlyMap<string, ItemCatalogEntry> {
  const byId = new Map<string, Record<string, unknown>>();

  const readEntitiesFrom = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) continue;
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const entity of list) {
        if (typeof entity !== 'object' || entity === null) continue;
        const record = entity as Record<string, unknown>;
        const id = record['id'];
        if (typeof id === 'string') byId.set(id, record);
      }
    }
  };

  readEntitiesFrom(itemsDir);
  readEntitiesFrom(join(itemsDir, 'generated'));

  const overridesDir = join(itemsDir, 'overrides');
  let overrideNames: string[];
  try {
    overrideNames = readdirSync(overridesDir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    overrideNames = [];
  }
  for (const name of overrideNames) {
    const override = JSON.parse(readFileSync(join(overridesDir, name), 'utf8')) as {
      id?: string;
      patch?: Record<string, unknown>;
    };
    if (typeof override.id !== 'string') continue;
    const target = byId.get(override.id);
    if (target !== undefined && override.patch !== undefined) Object.assign(target, override.patch);
  }

  const catalog = new Map<string, ItemCatalogEntry>();
  for (const [id, entity] of byId) {
    catalog.set(id, { stackable: entity['stackable'] === true });
  }
  return catalog;
}

interface SummonEntry {
  readonly monsterId: string;
  readonly [field: string]: unknown;
}

/** `content.ts` recusa `summons.entries` com `monsterId` repetido — duas entradas do mesmo
 *  monstro dividiriam o mesmo `(kind, subject)` na fila do `sim`, e uma sobrescreveria o
 *  vencimento da outra. O Canary declara isso de propósito num punhado de monstros (tiers de
 *  chance diferentes para o MESMO alvo, ex.: `eshtaba-the-conjurer` invoca `dread-minion` com
 *  0.2 e depois com 0.3) — o `sim` de hoje não tem como representar duas entradas do mesmo id, e
 *  a saída honesta é deixar o monstro fora da promoção, não fundir as chances e inventar um
 *  número que o Canary não escreveu. */
function hasDuplicateSummonTarget(entity: Record<string, unknown>): boolean {
  const summons = entity['summons'] as { entries?: readonly SummonEntry[] } | undefined;
  const entries = summons?.entries ?? [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.monsterId)) return true;
    seen.add(entry.monsterId);
  }
  return false;
}

interface LootLine {
  readonly itemId?: string;
  readonly supplyId?: string;
  readonly ammunitionId?: string;
  readonly max?: number;
  readonly [field: string]: unknown;
}

interface LootTable {
  readonly rollModel?: string;
  readonly gold?: unknown;
  readonly items?: readonly LootLine[];
  readonly [field: string]: unknown;
}

/** Filtra `loot.items` contra o catálogo de itens — a mesma regra que `content.ts` reprovaria no
 *  boot (item fantasma, ou pilha maior que 1 de item que não empilha num `rollModel: "canary"`),
 *  só que aqui a linha é REMOVIDA e contada em vez de derrubar o carregamento. */
function resolveLoot(
  monsterId: string,
  loot: LootTable | undefined,
  items: ReadonlyMap<string, ItemCatalogEntry>,
  dropped: DroppedLootLine[],
): LootTable {
  if (loot === undefined) return { items: [] };
  const canary = loot.rollModel === 'canary';
  const kept: LootLine[] = [];
  for (const line of loot.items ?? []) {
    if (line.itemId === undefined) {
      // supplyId/ammunitionId: fora do corte desta issue (o Canary só produz itemId de verdade;
      // ver `packages/content/CLAUDE.md` "Loot" — supply/munição são abstrações do Draconya).
      kept.push(line);
      continue;
    }
    const item = items.get(line.itemId);
    if (item === undefined) {
      dropped.push({ monsterId, itemId: line.itemId, reason: 'item ausente do catálogo (packages/content/data/items)' });
      continue;
    }
    if (canary && (line.max ?? 1) > 1 && !item.stackable) {
      dropped.push({
        monsterId,
        itemId: line.itemId,
        reason: `max ${line.max} pede pilha, e o item não empilha (rollModel "canary" daria 1)`,
      });
      continue;
    }
    kept.push(line);
  }
  return { ...loot, items: kept };
}

/** Roda a promoção inteira em memória — nunca escreve nada. `--check` e a escrita real chamam
 *  a mesma função, para nunca haver duas fontes de verdade sobre o que "promovido" significa. */
export function computePromotion(repoRoot: string): PromotionResult {
  const stagingDir = join(repoRoot, 'packages/content/staging/monsters/generated');
  const itemsDir = join(repoRoot, 'packages/content/data/items');
  const itemCatalog = readItemCatalog(itemsDir);

  const slices = new Map<string, CatalogEntity[]>();
  const bestiaryEntries = new Map<string, Record<string, unknown>>();
  const appearanceEntries = new Map<string, number>();
  const lookEntries = new Map<string, number>();
  const skipped: SkippedPromotion[] = [];
  const droppedLootLines: DroppedLootLine[] = [];

  const sliceNames = existsSync(stagingDir)
    ? readdirSync(stagingDir).filter((n) => n.endsWith('.json')).sort()
    : [];

  for (const name of sliceNames) {
    const slice = name.slice(0, -'.json'.length);
    const raw = JSON.parse(readFileSync(join(stagingDir, name), 'utf8')) as Record<string, unknown>[];
    const promoted: CatalogEntity[] = [];
    for (const entity of raw) {
      const id = entity['id'];
      if (typeof id !== 'string') continue;
      if (HAND_AUTHORED_MONSTER_IDS.has(id)) {
        skipped.push({ id, reason: 'hand-authored — regenerado só pelo #581, nunca por esta promoção' });
        continue;
      }
      if (hasDuplicateSummonTarget(entity)) {
        skipped.push({
          id,
          reason: 'summons.entries repete o mesmo monsterId com chances diferentes — o sim só aceita uma entrada por id (content.ts)',
        });
        continue;
      }
      const { bestiary, outfitId, objectLooks, ...monster } = entity;
      if (typeof outfitId === 'number') appearanceEntries.set(id, outfitId);
      for (const [key, appearanceId] of Object.entries((objectLooks ?? {}) as Record<string, number>)) {
        const existing = lookEntries.get(key);
        if (existing !== undefined && existing !== appearanceId) {
          throw new Error(`appearances.looks "${key}": dois monstros pedem ids diferentes (${String(existing)} e ${String(appearanceId)})`);
        }
        lookEntries.set(key, appearanceId);
      }
      if (bestiary !== undefined && typeof bestiary === 'object') {
        bestiaryEntries.set(id, bestiary as Record<string, unknown>);
      }
      const loot = resolveLoot(id, monster['loot'] as LootTable | undefined, itemCatalog, droppedLootLines);
      promoted.push({ ...monster, loot } as unknown as CatalogEntity);
    }
    slices.set(slice, promoted);
  }

  // O `outfit` de monstro nomeia o monstro imitado por id, e o boot recusa id que não existe
  // (#621): o conjunto que existe DEPOIS da promoção é o promovido mais os quatro autorais (que já
  // moram em `generated/` e nunca saem daqui). A entrada cujo alvo ficou de fora sai — só ela, e a
  // contagem vai para o relatório —, porque a troca é puramente visual.
  const known = new Set<string>(HAND_AUTHORED_MONSTER_IDS);
  for (const entities of slices.values()) for (const entity of entities) known.add(entity.id);
  const strippedOutfits = new Map<string, number>();
  for (const entities of slices.values()) {
    for (const entity of entities) {
      const record = entity as unknown as Record<string, unknown>;
      const removed = stripUnknownOutfits(record, known);
      if (removed > 0) strippedOutfits.set(entity.id, removed);
    }
  }

  return {
    slices, bestiaryEntries, appearanceEntries, lookEntries, strippedOutfits, skipped, droppedLootLines,
  };
}

/**
 * Substitui, em `parsed[key]`, tudo que esta promoção é dona por `updates` — e mantém intocado
 * só o que NÃO é dela (hoje, as linhas de `HAND_AUTHORED_MONSTER_IDS`). Um merge aditivo simples
 * deixaria para trás a linha de um monstro que deixou de ser promovido entre duas rodadas (por
 * exemplo, um `summons.entries` com id repetido descoberto depois — ver `hasDuplicateSummonTarget`
 * — some de `slices`, mas ficaria preso em `bestiary`/`appearances` para sempre). Recomputar do
 * zero, sempre, é o que torna `--check` confiável: o arquivo é sempre "o que esta rodada produz",
 * nunca "o que uma rodada produziu um dia mais o que esta acrescentou".
 */
function mergeJsonMap(path: string, key: string, updates: ReadonlyMap<string, unknown>): void {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const target = parsed[key];
  const preserved: Record<string, unknown> = {};
  if (typeof target === 'object' && target !== null) {
    for (const [id, value] of Object.entries(target as Record<string, unknown>)) {
      if (HAND_AUTHORED_MONSTER_IDS.has(id)) preserved[id] = value;
    }
  }
  const merged: Record<string, unknown> = { ...preserved };
  for (const [id, value] of updates) merged[id] = value;
  const sorted: Record<string, unknown> = {};
  for (const id of Object.keys(merged).sort((a, b) => a.localeCompare(b))) sorted[id] = merged[id];
  parsed[key] = sorted;
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
}

function formatReport(repoRoot: string, result: PromotionResult): string {
  const promotedCount = [...result.slices.values()].reduce((sum, entities) => sum + entities.length, 0);
  const lines = [
    '# Relatório de promoção — monsters (#580)',
    '',
    'Separa `packages/content/staging/monsters/generated/*.json` (a transcrição pura do Canary, '
      + '#578/#579) em `data/monsters/generated/` + `data/bestiary/baseline.json` + '
      + '`data/appearances/baseline.json`, e valida `loot.items` contra o catálogo de itens REAL '
      + '(`packages/content/data/items`, autoral + `generated/` — o que `loadContent` de fato '
      + 'carrega hoje; a promoção de itens é `promote-items.ts`, #748).',
    '',
    `${promotedCount} monstro(s) promovido(s) em ${result.slices.size} fatia(s):`,
    '',
  ];
  for (const [slice, entities] of [...result.slices.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- \`${slice}.json\`: ${entities.length}`);
  }
  lines.push('', `## Não promovidos (${result.skipped.length})`, '');
  if (result.skipped.length === 0) {
    lines.push('Nenhum — todo monstro gerado foi promovido.');
  } else {
    lines.push('| id | motivo |', '|---|---|');
    for (const item of [...result.skipped].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`| ${item.id} | ${item.reason} |`);
    }
  }
  lines.push(
    '',
    `## Entradas \`outfit\` removidas (${[...result.strippedOutfits.values()].reduce((sum, n) => sum + n, 0)})`,
    '',
  );
  if (result.strippedOutfits.size === 0) {
    lines.push('Nenhuma — todo monstro imitado por um `outfit` foi promovido.');
  } else {
    lines.push(
      'Ataque/defesa `outfit` cujo monstro imitado não foi promovido (#621): a condição o nomeia por id, '
        + 'e o boot recusa id que não existe. Sai só a entrada — a troca é puramente visual.',
      '',
      '| monstro | entradas removidas |',
      '|---|---|',
    );
    for (const [id, count] of [...result.strippedOutfits.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`| ${id} | ${count} |`);
    }
  }
  lines.push(
    '',
    `## Linhas de loot removidas (${result.droppedLootLines.length})`,
    '',
    'Item referenciado por `loot.items` que não existe no catálogo real, ou que excede a pilha '
      + 'de um item que não empilha. A linha inteira é removida — nunca creditada como item '
      + 'fantasma (§"Loot" de `packages/content/CLAUDE.md`).',
    '',
  );
  if (result.droppedLootLines.length === 0) {
    lines.push('Nenhuma.');
  } else {
    const byItem = new Map<string, number>();
    for (const drop of result.droppedLootLines) byItem.set(drop.itemId, (byItem.get(drop.itemId) ?? 0) + 1);
    lines.push(
      `${byItem.size} item(ns) distinto(s) referenciado(s) e ausente(s) do catálogo real.`,
      '',
      '| item | ocorrências | motivo (da primeira ocorrência) |',
      '|---|---|---|',
    );
    const firstReasonOf = new Map<string, string>();
    for (const drop of result.droppedLootLines) {
      if (!firstReasonOf.has(drop.itemId)) firstReasonOf.set(drop.itemId, drop.reason);
    }
    for (const [itemId, count] of [...byItem.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`| ${itemId} | ${count} | ${firstReasonOf.get(itemId) ?? ''} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Uma entidade de `HAND_AUTHORED_MONSTER_IDS` já commitada em `generated/<fatia>.json` nunca sai
 * de `computePromotion` — mas, desde o #581, ela PODE morar na mesma fatia que o resto (Rat em
 * `mammals.json`, Dragon e Dragon Lord em `dragons.json`, …), colocada lá por aquela issue, não
 * por esta promoção. Sem preservá-la aqui, a próxima `pnpm catalog:promote-monsters` a apagaria
 * — o mesmo problema que `mergeJsonMap` já resolve para `bestiary`/`appearances`, só que para um
 * ARRAY em vez de um mapa por id. `fresh` nunca contém um id de `HAND_AUTHORED_MONSTER_IDS`
 * (ver `computePromotion`), então a união abaixo nunca duplica: é sempre fresh + o que já está
 * no disco para esses ids, e mais nada.
 */
function preserveHandAuthored(fresh: readonly CatalogEntity[], onDisk: readonly CatalogEntity[]): CatalogEntity[] {
  const preserved = onDisk.filter((entity) => HAND_AUTHORED_MONSTER_IDS.has(entity.id));
  return [...fresh, ...preserved];
}

/** Escreve a promoção inteira em disco: `data/monsters/generated/`, os dois `baseline.json` e o
 *  relatório. Idempotente — rodar duas vezes no mesmo commit produz o mesmo byte a byte, desde
 *  que o que já está em disco para um id de `HAND_AUTHORED_MONSTER_IDS` não mude entre as duas
 *  rodadas (#581 é quem muda isso — nunca esta escrita). */
export function writePromotion(repoRoot: string): PromotionResult {
  const result = computePromotion(repoRoot);
  const monstersGeneratedDir = join(repoRoot, 'packages/content/data/monsters/generated');
  mkdirSync(monstersGeneratedDir, { recursive: true });
  const committedBefore = listGeneratedSlices(monstersGeneratedDir);
  for (const [slice, entities] of result.slices) {
    const onDisk = committedBefore.get(slice) ?? [];
    writeGeneratedSlice(join(monstersGeneratedDir, `${slice}.json`), preserveHandAuthored(entities, onDisk));
  }
  mergeJsonMap(
    join(repoRoot, 'packages/content/data/bestiary/baseline.json'),
    'entries',
    result.bestiaryEntries,
  );
  mergeJsonMap(
    join(repoRoot, 'packages/content/data/appearances/baseline.json'),
    'monsters',
    result.appearanceEntries,
  );
  mergeJsonMap(
    join(repoRoot, 'packages/content/data/appearances/baseline.json'),
    'looks',
    result.lookEntries,
  );
  const reportPath = join(repoRoot, 'docs/reference/catalog/monsters-promotion-report.md');
  mkdirSync(join(reportPath, '..'), { recursive: true });
  writeFileSync(reportPath, formatReport(repoRoot, result));
  return result;
}

export interface CheckOutcome {
  readonly slice: string;
  readonly status: 'fresh' | 'stale';
  readonly detail?: string;
}

/** Recomputa em memória e compara com `data/monsters/generated/` — nunca escreve nada. Uma
 *  fatia com id de `HAND_AUTHORED_MONSTER_IDS` já commitado (Rat, Rotworm, Dragon, Dragon Lord,
 *  desde o #581) é comparada com esse id devolvido a `fresh` também — `preserveHandAuthored` é
 *  a MESMA função que `writePromotion` usa para escrever, para as duas nunca divergirem sobre o
 *  que "em dia" significa. */
export function checkPromotion(repoRoot: string): CheckOutcome[] {
  const result = computePromotion(repoRoot);
  const committed = listGeneratedSlices(join(repoRoot, 'packages/content/data/monsters/generated'));
  const sliceNames = new Set([...result.slices.keys(), ...committed.keys()]);
  const outcomes: CheckOutcome[] = [];
  for (const slice of [...sliceNames].sort((a, b) => a.localeCompare(b))) {
    const fresh = result.slices.get(slice);
    if (fresh === undefined) {
      outcomes.push({
        slice, status: 'stale', detail: `generated/${slice}.json está commitado, mas a promoção não produz mais essa fatia`,
      });
      continue;
    }
    const onDisk = committed.get(slice);
    if (onDisk === undefined) {
      outcomes.push({ slice, status: 'stale', detail: `generated/${slice}.json não existe — rode pnpm catalog:promote-monsters` });
      continue;
    }
    const expected = preserveHandAuthored(fresh, onDisk);
    outcomes.push(formatGeneratedSlice(expected) === formatGeneratedSlice(onDisk)
      ? { slice, status: 'fresh' }
      : { slice, status: 'stale', detail: 'a fatia recomputada difere da versionada' });
  }
  return outcomes;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { check: { type: 'boolean' } }, strict: true });
  const repoRoot = repoRootFrom(import.meta.url);
  if (values.check === true) {
    const outcomes = checkPromotion(repoRoot);
    let stale = false;
    for (const outcome of outcomes) {
      if (outcome.status === 'fresh') {
        console.log(`monsters/generated/${outcome.slice}.json: confere com a promoção`);
      } else {
        stale = true;
        console.error(`monsters/generated/${outcome.slice}.json: DESATUALIZADO — ${outcome.detail ?? ''}`);
      }
    }
    process.exit(stale ? 1 : 0);
  }
  const result = writePromotion(repoRoot);
  const promotedCount = [...result.slices.values()].reduce((sum, entities) => sum + entities.length, 0);
  console.log(`promovido(s) ${promotedCount} monstro(s) em ${result.slices.size} fatia(s)`);
  console.log(`  não promovido(s): ${result.skipped.length}`);
  console.log(`  linha(s) de loot removida(s): ${result.droppedLootLines.length}`);
  console.log('  relatório: docs/reference/catalog/monsters-promotion-report.md');
}
