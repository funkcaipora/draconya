// scripts/catalog/promote-items.ts — `pnpm catalog:promote-items [--check]` (#748, ADR 0038
// decisão 2, `packages/content/AGENTS.md` "O catálogo importado" — o MESMO movimento que
// `promote-monsters.ts` (#580) já fez para monstro).
//
// `pnpm catalog:import items` (#573/#574) só escreve em `packages/content/staging/items/` — não
// é conteúdo carregado, porque 1947 itens sem reconciliação de cada um seria arriscar o boot
// (comentário de `items.ts`). Este script é o passo SEGUINTE: promove cada entidade gerada para
// `packages/content/data/items/generated/<fatia>.json`, no MESMO formato de array por fatia que
// `data/monsters/generated/*.json` já usa, com duas exclusões — cada uma contada e nunca em
// silêncio:
//
//   - **id que já existe como item AUTORAL** (`data/items/*.json`, os 73 de sempre, ADR 0014):
//     o autoral vence sempre — o id nunca muda e o número já foi conferido e reconciliado por
//     `reconcileAuthored` (override em `data/items/overrides/`). O gerado do mesmo slug nunca é
//     promovido, e a exclusão é documentada no relatório;
//   - **`appearanceId` fora do inventário do pacote de assets** (`data/packs/<pack>.json`, FUN-21):
//     o `id` do `<item>` do Canary É o `appearanceId` (o clientid do OTB — conferido em
//     `sword`/3264, o autoral existente), mas este checkout do Canary é mais novo que o pacote
//     13.32 e cita item que o pacote não tem (`gnomish-cuirass`/50276, por exemplo) — promovê-lo
//     desenharia o quadrado invisível da FUN-21 no primeiro load. A mesma conferência que
//     `buildContent`/`packProblems` fariam no boot, só que aqui a linha é EXCLUÍDA e contada em
//     vez de derrubar o carregamento.
//
// `appearanceId` é staging-only (`items.ts`, o mesmo recurso que `outfitId` usa em monstro): este
// script o EXTRAI para `data/appearances/baseline.json.items` e o REMOVE da entidade antes de
// escrever `data/items/generated/` — `itemSchema` não declara o campo (FUN-94: só a tabela de
// aparências aponta id de aparência).
//
// Determinístico e SEM depender de `CANARY_DIR`: a entrada é o que já está commitado em
// `staging/items/generated/`, `data/items/*.json` e `data/packs/`, então rodar duas vezes no
// mesmo commit produz sempre a mesma saída — a mesma garantia que `generated-writer.ts` já dá
// para a importação, e que `promote-monsters.ts` já dá para a promoção de monstro.

import {
  existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { repoRootFrom } from './env.js';
import {
  formatGeneratedSlice, listGeneratedSlices, writeGeneratedSlice, type CatalogEntity,
} from './generated-writer.js';

/** Uma entidade gerada excluída da promoção — por colisão de id com o autoral. */
export interface SkippedByAuthored {
  readonly id: string;
  readonly reason: string;
}

/** Uma entidade gerada excluída por violar uma regra de conteúdo (`buildContent`, `content.ts`). */
export interface SkippedByContentRule {
  readonly id: string;
  readonly reason: string;
}

interface StagingWeapon {
  readonly kind?: string;
  readonly ammoFamily?: string;
}

interface StagingItem {
  readonly kind?: string;
  readonly slot?: string;
  readonly stackable?: boolean;
  readonly defense?: number;
  readonly imbuementSlots?: number;
  readonly weapon?: StagingWeapon;
}

/**
 * Confere UMA entidade gerada contra o subconjunto de regras de `buildContent` (`content.ts`)
 * que o importador de itens (`items.ts`) já demonstrou poder violar — quest/decoração classificada
 * fora de `kind: 'shield'` mas com `defense` residual do Canary ("rusted shield"), arma sem
 * `slot` (a maioria das armas do Canary não declara `<attribute key="slot" value="hand">`) que
 * também carrega `imbuementslot`, e arma de distância sem lançador reconhecido. A mesma disciplina
 * de `resolveLoot`/`hasDuplicateSummonTarget` em `promote-monsters.ts`: a entidade INTEIRA é
 * excluída e contada, nunca escrita quebrada — nunca falha o boot em silêncio, e nunca corrige o
 * dado calando o motivo.
 */
export function violatesContentRules(item: StagingItem): string | undefined {
  if (item.imbuementSlots !== undefined && (item.slot === undefined || item.stackable === true)) {
    return 'imbuementSlots só vale em item que se veste e não empilha (content.ts)';
  }
  const melee = item.kind === 'weapon' && (item.weapon?.kind ?? 'melee') === 'melee';
  if ((item.defense ?? 0) > 0 && item.kind !== 'shield' && !melee) {
    return 'defense só vale em escudo ou arma corpo a corpo (content.ts)';
  }
  if (item.weapon?.kind === 'distance' && item.weapon.ammoFamily === undefined) {
    return 'arma de distância precisa de "ammoFamily" (content.ts)';
  }
  return undefined;
}

/** Uma entidade gerada excluída por `appearanceId` fora do pacote conferido. */
export interface SkippedByAppearance {
  readonly id: string;
  readonly appearanceId: number | undefined;
  readonly reason: string;
}

export interface ItemPromotionResult {
  /** Fatia (nome do arquivo de `staging/items/generated/`) → itens promovidos. */
  readonly slices: ReadonlyMap<string, CatalogEntity[]>;
  readonly appearanceEntries: ReadonlyMap<string, number>;
  readonly skippedByAuthored: readonly SkippedByAuthored[];
  readonly skippedByAppearance: readonly SkippedByAppearance[];
  readonly skippedByContentRule: readonly SkippedByContentRule[];
}

/** Todo `id` de item AUTORAL — arquivo `*.json` direto de `itemsDir`, nunca `generated/` nem
 *  `overrides/` (a mesma leitura top-level que `readItemCatalog` de `promote-monsters.ts` faz). */
export function readAuthoredItemIds(itemsDir: string): ReadonlySet<string> {
  const ids = new Set<string>();
  let names: string[];
  try {
    names = readdirSync(itemsDir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return ids;
  }
  for (const name of names) {
    const path = join(itemsDir, name);
    if (statSync(path).isDirectory()) continue;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const id = parsed['id'];
    if (typeof id === 'string') ids.add(id);
  }
  return ids;
}

/** Os intervalos `object` do pacote que `appearances/baseline.json.pack` aponta — `undefined`
 *  quando a tabela ou o inventário não existem (conteúdo de teste, sem arte nenhuma: nada é
 *  excluído por aparência, porque não há pacote contra o qual conferir). */
export function readPackObjectRanges(repoRoot: string): readonly (readonly [number, number])[] | undefined {
  const appearancesPath = join(repoRoot, 'packages/content/data/appearances/baseline.json');
  let pack: unknown;
  try {
    pack = JSON.parse(readFileSync(appearancesPath, 'utf8'));
  } catch {
    return undefined;
  }
  const packId = (pack as Record<string, unknown>)['pack'];
  if (typeof packId !== 'string') return undefined;
  const packPath = join(repoRoot, 'packages/content/data/packs', `${packId}.json`);
  let inventory: unknown;
  try {
    inventory = JSON.parse(readFileSync(packPath, 'utf8'));
  } catch {
    return undefined;
  }
  const ranges = (inventory as Record<string, unknown>)['object'];
  if (!Array.isArray(ranges)) return undefined;
  return ranges as readonly (readonly [number, number])[];
}

function inRanges(id: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (const [lo, hi] of ranges) if (id >= lo && id <= hi) return true;
  return false;
}

/** Roda a promoção inteira em memória — nunca escreve nada. `--check` e a escrita real chamam a
 *  mesma função, para nunca haver duas fontes de verdade sobre o que "promovido" significa. */
export function computeItemPromotion(repoRoot: string): ItemPromotionResult {
  const stagingDir = join(repoRoot, 'packages/content/staging/items/generated');
  const authoredIds = readAuthoredItemIds(join(repoRoot, 'packages/content/data/items'));
  const packRanges = readPackObjectRanges(repoRoot);

  const slices = new Map<string, CatalogEntity[]>();
  const appearanceEntries = new Map<string, number>();
  const skippedByAuthored: SkippedByAuthored[] = [];
  const skippedByAppearance: SkippedByAppearance[] = [];
  const skippedByContentRule: SkippedByContentRule[] = [];

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
      if (authoredIds.has(id)) {
        skippedByAuthored.push({
          id, reason: 'id já existe como item autoral (data/items/*.json) — o autoral vence (ADR 0014)',
        });
        continue;
      }
      const { appearanceId, ...item } = entity;
      const appearance = typeof appearanceId === 'number' ? appearanceId : undefined;
      if (appearance === undefined) {
        skippedByAppearance.push({
          id, appearanceId: undefined, reason: 'sem appearanceId (não deveria acontecer — items.ts sempre grava um)',
        });
        continue;
      }
      if (packRanges !== undefined && !inRanges(appearance, packRanges)) {
        skippedByAppearance.push({
          id, appearanceId: appearance,
          reason: `appearanceId ${appearance} não existe no inventário do pacote (data/packs/) — o Canary é mais novo que o pacote conferido`,
        });
        continue;
      }
      const contentRuleViolation = violatesContentRules(item as StagingItem);
      if (contentRuleViolation !== undefined) {
        skippedByContentRule.push({ id, reason: contentRuleViolation });
        continue;
      }
      appearanceEntries.set(id, appearance);
      promoted.push(item as unknown as CatalogEntity);
    }
    slices.set(slice, promoted);
  }

  return {
    slices, appearanceEntries, skippedByAuthored, skippedByAppearance, skippedByContentRule,
  };
}

/**
 * Substitui, em `appearances/baseline.json.items`, toda linha cujo id é (ou já FOI) produzido por
 * `staging/items/generated/` por `updates` — e mantém intocado o resto (os 73 autorais, e
 * qualquer linha futura de outra origem). "Ids que já foram produzidos" é o que já está
 * commitado em `data/items/generated/` ANTES desta escrita: é o que torna `--check` confiável
 * sem precisar de uma lista fixa como `HAND_AUTHORED_MONSTER_IDS` (aqui a exclusão muda de rodada
 * para rodada, conforme o pacote e o catálogo autoral crescem) — a mesma ideia de
 * `promote-monsters.ts`, computada a partir do que já está no disco em vez de uma constante.
 */
function mergeItemAppearances(
  appearancesPath: string, previouslyGeneratedIds: ReadonlySet<string>, updates: ReadonlyMap<string, number>,
): void {
  const parsed = JSON.parse(readFileSync(appearancesPath, 'utf8')) as Record<string, unknown>;
  const target = parsed['items'];
  const preserved: Record<string, unknown> = {};
  if (typeof target === 'object' && target !== null) {
    for (const [id, value] of Object.entries(target as Record<string, unknown>)) {
      if (!previouslyGeneratedIds.has(id)) preserved[id] = value;
    }
  }
  const merged: Record<string, unknown> = { ...preserved };
  for (const [id, value] of updates) merged[id] = value;
  const sorted: Record<string, unknown> = {};
  for (const id of Object.keys(merged).sort((a, b) => a.localeCompare(b))) sorted[id] = merged[id];
  parsed['items'] = sorted;
  writeFileSync(appearancesPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function formatReport(result: ItemPromotionResult): string {
  const promotedCount = [...result.slices.values()].reduce((sum, entities) => sum + entities.length, 0);
  const lines = [
    '# Relatório de promoção — items (#748)',
    '',
    'Separa `packages/content/staging/items/generated/*.json` (a transcrição pura do Canary, '
      + '#573/#574) em `data/items/generated/` + `data/appearances/baseline.json.items` — o mesmo '
      + 'movimento que `promote-monsters.ts` (#580) já fez para monstro. Duas exclusões, cada uma '
      + 'contada: id que colide com item AUTORAL (o autoral vence, ADR 0014) e `appearanceId` fora '
      + 'do inventário do pacote de assets conferido (FUN-21).',
    '',
    `${promotedCount} item(ns) promovido(s) em ${result.slices.size} fatia(s):`,
    '',
  ];
  for (const [slice, entities] of [...result.slices.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- \`${slice}.json\`: ${entities.length}`);
  }
  lines.push(
    '',
    `## Excluídos por colisão com item autoral (${result.skippedByAuthored.length})`,
    '',
  );
  if (result.skippedByAuthored.length === 0) {
    lines.push('Nenhum.');
  } else {
    lines.push('| id | motivo |', '|---|---|');
    for (const item of [...result.skippedByAuthored].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`| ${item.id} | ${item.reason} |`);
    }
  }
  lines.push(
    '',
    `## Excluídos por aparência fora do pacote (${result.skippedByAppearance.length})`,
    '',
  );
  if (result.skippedByAppearance.length === 0) {
    lines.push('Nenhum.');
  } else {
    lines.push('| id | appearanceId | motivo |', '|---|---|---|');
    for (const item of [...result.skippedByAppearance].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`| ${item.id} | ${item.appearanceId ?? '(ausente)'} | ${item.reason} |`);
    }
  }
  lines.push(
    '',
    `## Excluídos por regra de conteúdo (${result.skippedByContentRule.length})`,
    '',
    'A mesma conferência que `buildContent` (`content.ts`) faria no boot — item de decoração/'
      + 'quest com `defense` residual do Canary fora de `kind: shield`, arma sem `slot` (a maioria '
      + 'das armas do Canary não declara `<attribute key="slot" value="hand">`) que também carrega '
      + '`imbuementslot`, e arma de distância sem `ammoFamily` reconhecida. A linha inteira é '
      + 'excluída — nunca escrita quebrada, e nunca corrigida em silêncio.',
    '',
  );
  if (result.skippedByContentRule.length === 0) {
    lines.push('Nenhum.');
  } else {
    lines.push('| id | motivo |', '|---|---|');
    for (const item of [...result.skippedByContentRule].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`| ${item.id} | ${item.reason} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/** Escreve a promoção inteira em disco: `data/items/generated/`, `appearances/baseline.json` e o
 *  relatório. Idempotente — rodar duas vezes no mesmo commit produz o mesmo byte a byte. */
export function writeItemPromotion(repoRoot: string): ItemPromotionResult {
  const itemsGeneratedDir = join(repoRoot, 'packages/content/data/items/generated');
  // "O que já era nosso" — computado ANTES de sobrescrever, para a fusão de `appearances.items`
  // saber o que apagar quando um item deixa de ser promovido entre duas rodadas.
  const previouslyGeneratedIds = new Set<string>();
  for (const entities of listGeneratedSlices(itemsGeneratedDir).values()) {
    for (const entity of entities) previouslyGeneratedIds.add(entity.id);
  }

  const result = computeItemPromotion(repoRoot);
  mkdirSync(itemsGeneratedDir, { recursive: true });
  for (const [slice, entities] of result.slices) {
    writeGeneratedSlice(join(itemsGeneratedDir, `${slice}.json`), entities);
  }
  mergeItemAppearances(
    join(repoRoot, 'packages/content/data/appearances/baseline.json'),
    previouslyGeneratedIds,
    result.appearanceEntries,
  );
  const reportPath = join(repoRoot, 'docs/reference/catalog/items-promotion-report.md');
  mkdirSync(join(reportPath, '..'), { recursive: true });
  writeFileSync(reportPath, formatReport(result));
  return result;
}

export interface CheckOutcome {
  readonly slice: string;
  readonly status: 'fresh' | 'stale';
  readonly detail?: string;
}

/** Recomputa em memória e compara com `data/items/generated/` — nunca escreve nada. */
export function checkItemPromotion(repoRoot: string): CheckOutcome[] {
  const result = computeItemPromotion(repoRoot);
  const committed = listGeneratedSlices(join(repoRoot, 'packages/content/data/items/generated'));
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
      outcomes.push({ slice, status: 'stale', detail: `generated/${slice}.json não existe — rode pnpm catalog:promote-items` });
      continue;
    }
    outcomes.push(formatGeneratedSlice(fresh) === formatGeneratedSlice(onDisk)
      ? { slice, status: 'fresh' }
      : { slice, status: 'stale', detail: 'a fatia recomputada difere da versionada' });
  }
  return outcomes;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { check: { type: 'boolean' } }, strict: true });
  const repoRoot = repoRootFrom(import.meta.url);
  if (values.check === true) {
    const outcomes = checkItemPromotion(repoRoot);
    let stale = false;
    for (const outcome of outcomes) {
      if (outcome.status === 'fresh') {
        console.log(`items/generated/${outcome.slice}.json: confere com a promoção`);
      } else {
        stale = true;
        console.error(`items/generated/${outcome.slice}.json: DESATUALIZADO — ${outcome.detail ?? ''}`);
      }
    }
    process.exit(stale ? 1 : 0);
  }
  const result = writeItemPromotion(repoRoot);
  const promotedCount = [...result.slices.values()].reduce((sum, entities) => sum + entities.length, 0);
  console.log(`promovido(s) ${promotedCount} item(ns) em ${result.slices.size} fatia(s)`);
  console.log(`  excluído(s) por colisão com autoral: ${result.skippedByAuthored.length}`);
  console.log(`  excluído(s) por aparência fora do pacote: ${result.skippedByAppearance.length}`);
  console.log(`  excluído(s) por regra de conteúdo: ${result.skippedByContentRule.length}`);
  console.log('  relatório: docs/reference/catalog/items-promotion-report.md');
}
