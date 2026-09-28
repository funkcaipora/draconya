// scripts/catalog/imbuements.ts — o leitor de imbuements do Canary (M40-02, #605; ADR 0038,
// `docs/endgame-plan.md` §3 M40).
//
//   pnpm catalog:import imbuements          # escreve packages/content/data/imbuements/generated/*.json
//   pnpm catalog:import imbuements --check  # regenera em memória e compara
//
// Lê `data/XML/imbuements.xml` como DADO (`xml.ts`) e converte as 3 `<base>`, as 20 `<category>`
// e as 72 `<imbuement>` para três fatias PRÓPRIAS — não é o `itemSchema`/`monsterSchema` de
// nenhum outro tipo, é o primeiro leitor deste catálogo.
//
// **Por que `data/` direto, e não `staging/` como `items.ts`/`monsters.ts`/`ammo.ts`/`spells.ts`.**
// Os outros catálogos passam por `staging/` por dois motivos que não se aplicam aqui: reconciliar
// id que já existe como conteúdo AUTORAL (ADR 0014 — não existe imbuement autoral hoje) e cortar
// pelo pacote de arte (`appearanceId` fora do inventário de `data/packs/`, FUN-21 — imbuement não
// tem `appearanceId` próprio: o `iconid` do Canary é ponteiro de sprite, e fica de fora por
// inteiro, invariante 6). A "## Direção" desta issue (decidida em `docs/endgame-plan.md`) já
// manda a saída direto em `packages/content/data/imbuements/generated/`.
//
// **Material é resolvido contra o catálogo REAL de itens.** `packages/content/data/appearances/
// baseline.json.items` (slug → id do Canary) já cobre exatamente os itens que existem de
// verdade (73 autorais + 1858 promovidos = 1931 neste checkout — o "id do `<item>` do Canary É
// o `appearanceId`", comentário de `items.ts`/`promote-items.ts`); invertê-lo (id → slug) é o
// que `readItemSlugsByCanaryId` faz abaixo. Material cujo id não aparece nesse mapa NÃO derruba
// a entidade — só fica de fora de `materials`, e vira uma linha em `skipped` (relatório), nunca
// um erro (a "## Direção" é explícita: "material ausente → linha no relatório, não erro").
//
// **`scroll` nunca entra na entidade gerada.** É item da Loja (M22, fora do corte desta issue) —
// toda entrada com scroll vira uma linha em `skipped`, sempre, mesmo quando o scroll resolveria
// contra o catálogo de itens (não é sobre existir ou não; é sobre pertencer a outro sistema).
//
// **`iconid`/`storage` nunca entram na entidade.** `iconid` é a aparência/ícone do imbuement
// (invariante 6 — nada de arte em `content/`); `storage` é a chave de conquista que o Canary usa
// para lembrar que aquele tier foi alcançado (mecânica de UI/quest, fora do escopo "só dado"
// desta issue). Os dois aparecem nas notas do relatório, nunca na entidade.
//
// **`combat`/`skill` validados contra vocabulário fechado.** As strings cruas do Canary (`fire`,
// `earth`, ... para `combat`; `axe`, `lifeleech`, ... para `skill`) já são o vocabulário que
// `packages/content/src/schemas.ts` usa (`DAMAGE_TYPES`), mas este script NÃO importa
// `@draconya/content` — nenhum outro leitor de `scripts/catalog/` o faz, porque `scripts/` na
// raiz não é dependente do workspace (`pnpm-lock.yaml` não lista `@draconya/content` fora de
// `packages/*`). Uma entrada com valor fora do vocabulário conhecido vira `skipped` INTEIRA —
// nunca um campo com string não validada (DT-03 da spec).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRootFrom } from './env.js';
import type { CatalogEntity, CatalogSource } from './generated-writer.js';
import { slugify } from './monsters.js';
import { registerCatalogType, type CatalogImportContext, type CatalogImportResult } from './registry.js';
import type { SkippedEntity } from './report.js';
import {
  attr, attrNumber, attrNumberOptional, attrOptional, childrenOf, readXmlFile, type XmlElement,
} from './xml.js';

/** `imbuements.xml` — 3 `<base>`, 20 `<category>`, 72 `<imbuement>` (conferido nesta issue). */
export const CANARY_IMBUEMENTS_XML = 'data/XML/imbuements.xml';

/** `packages/content/data/appearances/baseline.json`, relativo à raiz do repositório. */
const APPEARANCES_PATH = 'packages/content/data/appearances/baseline.json';

/** `combat` de `damage`/`reduction` — o mesmo vocabulário de `DAMAGE_TYPES`
 *  (`packages/content/src/schemas.ts:26-29`), sem importar o schema (ver cabeçalho). */
const EXPECTED_COMBAT_TYPES: ReadonlySet<string> = new Set([
  'physical', 'energy', 'earth', 'fire', 'ice', 'holy', 'death', 'drown', 'lifedrain', 'manadrain', 'arcane',
]);

/** `skill` de `type="skill"` — as 10 chaves que este checkout do Canary declara. */
const EXPECTED_SKILL_VALUES: ReadonlySet<string> = new Set([
  'axe', 'club', 'sword', 'shield', 'distance', 'fist', 'magicpoints', 'lifeleech', 'manaleech', 'critical',
]);

/**
 * Inverte `appearances.json.items` (slug → id do Canary) em id → slug — o catálogo REAL de
 * itens por id do Canary. Só leitura; nunca escreve de volta (o mesmo contrato de `env.ts`).
 */
export function readItemSlugsByCanaryId(repoRoot: string): ReadonlyMap<number, string> {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, APPEARANCES_PATH), 'utf8'),
  ) as { items?: Record<string, number> };
  const byId = new Map<number, string>();
  for (const [slug, id] of Object.entries(raw.items ?? {})) byId.set(id, slug);
  return byId;
}

function source(path: string, commit: string): CatalogSource {
  return { engine: 'canary', commit, path };
}

/** Uma das 3 `<base>` (Basic/Intricate/Powerful). */
export function convertBase(el: XmlElement, path: string, commit: string): CatalogEntity {
  return {
    id: attr(el, 'id'),
    name: attr(el, 'name'),
    price: attrNumber(el, 'price'),
    protectionPrice: attrNumber(el, 'protectionPrice'),
    percent: attrNumber(el, 'percent'),
    removeCost: attrNumber(el, 'removecost'),
    durationSeconds: attrNumber(el, 'duration'),
    source: source(path, commit),
  };
}

/** Uma das 20 `<category>`. */
export function convertCategory(el: XmlElement, path: string, commit: string): CatalogEntity {
  return {
    id: attr(el, 'id'),
    name: attr(el, 'name'),
    aggressive: attr(el, 'agressive') === '1',
    source: source(path, commit),
  };
}

interface ConvertedImbuement {
  readonly entity: CatalogEntity | undefined;
  readonly skipped: readonly SkippedEntity[];
}

/** `<attribute key="effect" ...>` → o `effect` tipado da entidade, ou um motivo de exclusão
 *  quando o `type`/`combat`/`value` não bate com o vocabulário conhecido (DT-03). */
function convertEffect(attrEl: XmlElement | undefined): Record<string, unknown> | string {
  if (attrEl === undefined) return 'sem <attribute key="effect"> (dado incompleto)';
  const kind = attrOptional(attrEl, 'type');
  if (kind === 'damage' || kind === 'reduction') {
    const combat = attrOptional(attrEl, 'combat');
    const percent = attrNumberOptional(attrEl, 'value');
    if (combat === undefined || !EXPECTED_COMBAT_TYPES.has(combat)) {
      return `effect ${kind}: combat "${combat ?? 'ausente'}" fora do vocabulário conhecido (EXPECTED_COMBAT_TYPES)`;
    }
    if (percent === undefined) return `effect ${kind}: sem "value" numérico`;
    return { type: kind, combat, percent };
  }
  if (kind === 'skill') {
    const skill = attrOptional(attrEl, 'value');
    const bonus = attrNumberOptional(attrEl, 'bonus');
    if (skill === undefined || !EXPECTED_SKILL_VALUES.has(skill)) {
      return `effect skill: valor "${skill ?? 'ausente'}" fora do vocabulário conhecido (EXPECTED_SKILL_VALUES)`;
    }
    if (bonus === undefined) return 'effect skill: sem "bonus" numérico';
    const chance = attrNumberOptional(attrEl, 'chance');
    return chance === undefined ? { type: kind, skill, bonus } : { type: kind, skill, bonus, chance };
  }
  if (kind === 'speed' || kind === 'capacity') {
    const amount = attrNumberOptional(attrEl, 'value');
    if (amount === undefined) return `effect ${kind}: sem "value" numérico`;
    return { type: kind, amount };
  }
  if (kind === 'paralysis') {
    const chance = attrNumberOptional(attrEl, 'chance');
    if (chance === undefined) return 'effect paralysis: sem "chance" numérico';
    return { type: kind, chance, pvpDeflect: attrOptional(attrEl, 'pvpDeflect') === '1' };
  }
  return `effect: type "${kind ?? 'ausente'}" fora do vocabulário conhecido (damage/reduction/skill/speed/capacity/paralysis)`;
}

/**
 * Converte UM `<imbuement>`. Nunca lança por dado do Canary: um `effect`/`combat`/`skill` fora
 * do vocabulário conhecido descarta a entidade INTEIRA (com o motivo em `skipped`); material
 * ausente e scroll NUNCA descartam a entidade — só ficam de fora dela (ver cabeçalho).
 */
export function convertImbuement(
  el: XmlElement, path: string, commit: string, itemSlugsByCanaryId: ReadonlyMap<number, string>,
): ConvertedImbuement {
  const name = attr(el, 'name');
  const baseId = attr(el, 'base');
  const id = `${slugify(name)}-${baseId}`;
  const src = source(path, commit);
  const skipped: SkippedEntity[] = [];

  const attributes = childrenOf(el, 'attribute');
  const effectEl = attributes.find((a) => attrOptional(a, 'key') === 'effect');
  const effect = convertEffect(effectEl);
  if (typeof effect === 'string') {
    return { entity: undefined, skipped: [{ id, name, reason: effect, source: src }] };
  }

  const description = attributes.find((a) => attrOptional(a, 'key') === 'description')
    ?.attributes['value'] ?? '';

  const materials: Record<string, unknown>[] = [];
  for (const itemAttr of attributes.filter((a) => attrOptional(a, 'key') === 'item')) {
    const canaryId = attrNumber(itemAttr, 'value');
    const count = attrNumber(itemAttr, 'count');
    const slug = itemSlugsByCanaryId.get(canaryId);
    if (slug === undefined) {
      skipped.push({
        id: `${id}:item:${canaryId}`,
        name: `${name} (tier ${baseId}) — material`,
        reason: `material ausente do catálogo de itens (id do Canary ${canaryId}, count ${count})`,
        source: src,
      });
      continue;
    }
    materials.push({ itemId: slug, count });
  }

  const scrollAttr = attributes.find((a) => attrOptional(a, 'key') === 'scroll');
  if (scrollAttr !== undefined) {
    const scrollId = attr(scrollAttr, 'value');
    skipped.push({
      id: `${id}:scroll:${scrollId}`,
      name: `${name} (tier ${baseId}) — scroll`,
      reason: 'scroll — fora do catálogo (item da Loja, M22)',
      source: src,
    });
  }

  const categoryId = attr(el, 'category');
  const premium = attr(el, 'premium') === '1';
  const subgroupRaw = attrOptional(el, 'subgroup')?.trim();

  const entity: Record<string, unknown> = {
    id, name, description, categoryId, baseId, premium,
    ...(subgroupRaw !== undefined && subgroupRaw !== '' ? { subgroup: subgroupRaw } : {}),
    effect,
    materials,
    source: src,
  };
  return { entity: entity as CatalogEntity, skipped };
}

export interface ImbuementCatalog extends CatalogImportResult {
  readonly bases: readonly CatalogEntity[];
  readonly categories: readonly CatalogEntity[];
  readonly imbuements: readonly CatalogEntity[];
}

/**
 * Raiz do repositório (`packages/content/data/appearances/baseline.json` mora ali, nunca dentro
 * do `canaryDir` — as duas raízes não têm relação entre si, e `CatalogImportContext` não carrega
 * a raiz do repo). Resolvida a partir de `import.meta.url` deste arquivo, o mesmo mecanismo de
 * `env.ts#repoRootFrom`.
 */
const REPO_ROOT = repoRootFrom(import.meta.url);

/**
 * Lê o `imbuements.xml` inteiro e converte as 3 fatias. `repoRoot` é injetável só para teste
 * (fixture sintética de `appearances.json` sem tocar o checkout real) — a chamada de produção
 * (`registerCatalogType` abaixo) sempre usa `REPO_ROOT`.
 */
export function readImbuementCatalog(ctx: CatalogImportContext, repoRoot: string = REPO_ROOT): ImbuementCatalog {
  const root = readXmlFile(join(ctx.canaryDir, CANARY_IMBUEMENTS_XML));
  const itemSlugsByCanaryId = readItemSlugsByCanaryId(repoRoot);

  const bases = childrenOf(root, 'base').map((el) => convertBase(el, CANARY_IMBUEMENTS_XML, ctx.canaryCommit));
  const categories = childrenOf(root, 'category')
    .map((el) => convertCategory(el, CANARY_IMBUEMENTS_XML, ctx.canaryCommit));

  const imbuements: CatalogEntity[] = [];
  const skipped: SkippedEntity[] = [];
  let missingMaterialCount = 0;
  let scrollCount = 0;
  let discardedEntries = 0;
  for (const el of childrenOf(root, 'imbuement')) {
    const converted = convertImbuement(el, CANARY_IMBUEMENTS_XML, ctx.canaryCommit, itemSlugsByCanaryId);
    if (converted.entity === undefined) {
      discardedEntries += 1;
    } else {
      imbuements.push(converted.entity);
    }
    for (const line of converted.skipped) {
      skipped.push(line);
      if (line.reason.startsWith('material ausente')) missingMaterialCount += 1;
      if (line.reason.startsWith('scroll')) scrollCount += 1;
    }
  }

  const slices = new Map<string, CatalogEntity[]>([
    ['bases', bases],
    ['categories', categories],
    ['imbuements', imbuements],
  ]);
  const notes: string[] = [
    `${bases.length} base(s), ${categories.length} categoria(s), ${imbuements.length} imbuement(s) `
    + `gerado(s); ${discardedEntries} entrada(s) descartada(s) por efeito fora do vocabulário conhecido.`,
    `${missingMaterialCount} material(is) sem correspondente no catálogo real de itens `
    + '(`packages/content/data/appearances/baseline.json.items` invertido) — a entidade é gerada '
    + 'do mesmo jeito, só o material fica de fora (ver linhas abaixo).',
    `${scrollCount} scroll(s) — sempre fora da entidade gerada, item da Loja (M22).`,
    '`iconid` (aparência do imbuement) e `storage` (chave de conquista do Canary) nunca entram '
    + 'na entidade gerada — invariante 6 e "só dado" desta issue, respectivamente.',
  ];

  return {
    slices, skipped, notes, bases, categories, imbuements,
  };
}

registerCatalogType({
  id: 'imbuements',
  dataDir: 'packages/content/data/imbuements',
  run: readImbuementCatalog,
});
