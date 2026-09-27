// scripts/catalog/ammo.ts — o leitor de munição do Canary (M34-04, #575; ADR 0037/0038).
//
//   pnpm catalog:import ammo          # escreve packages/content/staging/ammunition/generated/*.json
//   pnpm catalog:import ammo --check  # regenera em memória e compara
//
// Lê `data/items/items.xml` como DADO (`xml.ts`) e converte cada `<item>` com
// `primarytype: "ammunition"` para a forma do `ammunitionSchema` de `@draconya/content` — NUNCA
// `itemSchema`: munição é abstrata (ADR 0026 d.3/ADR 0032 d.7), sem peso, pilha nem instância, e
// os dois schemas não têm nada em comum além do `id`/`name`.
//
// **Por que `staging/` e não `data/ammunition/` direto.** Os 5 arquivos autorais
// (`arrow`, `burst-arrow`, `sniper-arrow`, `onyx-arrow`, `power-bolt`) já existem, e o preço
// deles já é regravado por `npc-prices.ts` (#574, `AMMO_CANARY_IDS`) — este importador NÃO toca
// nenhum dos dois. O que ele gera são os OUTROS ~24 `<item>` de munição do `items.xml` (flecha
// elemental, flecha envenenada, virotes avançados, …) que ainda não têm arquivo autoral: como em
// `items.ts` (#573), a promoção de um deles para `data/ammunition/` é decisão à parte — este
// importador só levanta o candidato, com o preço já resolvido quando um NPC vende.
//
// **Preço é OBRIGATÓRIO no `ammunitionSchema`** (`price: z.number().int().positive()`, sem
// fallback grátis — ADR 0026 d.3): munição sem NENHUM NPC vendendo (`buyMinByClientId` sem
// entrada) não tem como gerar uma linha válida, e vira `blocker` em vez de um preço inventado.
//
// **Munição elemental** (flash/shiver/flamming/earth/envenomed arrow): o `element<tipo>` do
// Canary substitui o físico — `attack` continua sendo o número do tiro, e `damageType` vira o
// elemento (`ELEMENT_ATTR_TO_DAMAGE`, o mesmo mapa de `items.ts`). Mais de um elemento no mesmo
// item é dado quebrado, e vira `blocker`.

import { join } from 'node:path';
import type { CatalogEntity, CatalogSource } from './generated-writer.js';
import { attributesOf, ELEMENT_ATTR_TO_DAMAGE } from './items.js';
import { slugify } from './monsters.js';
import { readNpcShopPrices, type ShopPriceObservation } from './npc-prices.js';
import { registerCatalogType, type CatalogImportContext, type CatalogImportResult } from './registry.js';
import type { SkippedEntity } from './report.js';
import { attrOptional, childrenOf, readXmlFile, type XmlElement } from './xml.js';

/** `items.xml` — a mesma fonte de `items.ts`, filtrada por `primarytype: "ammunition"`. */
export const CANARY_ITEMS_XML = 'data/items/items.xml';

/** Os 5 slugs autorais que `npc-prices.ts` (#574) já precifica — nunca gerados aqui de novo. */
export const AUTHORED_AMMO_SLUGS: ReadonlySet<string> = new Set([
  'arrow', 'burst-arrow', 'sniper-arrow', 'onyx-arrow', 'power-bolt',
]);

function value(attrs: ReadonlyMap<string, XmlElement>, key: string): string | undefined {
  return attrs.get(key)?.attributes['value'];
}

function numberValue(attrs: ReadonlyMap<string, XmlElement>, key: string): number | undefined {
  const raw = value(attrs, key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface ConvertedAmmo {
  readonly id: string;
  readonly entity: CatalogEntity;
  readonly blockers: readonly string[];
}

/** `value` da munição — o MENOR `buy` observado para o `id` do Canary (o preço do tiro). */
export interface AmmoPriceLookup {
  readonly buyMinByClientId: ReadonlyMap<number, ShopPriceObservation>;
}

/**
 * Converte UM `<item>` de munição. `undefined` quando não é munição (`primarytype` diferente de
 * `"ammunition"`) ou sem `id`/`name` (faixa `fromid`/`toid`). Nunca lança por dado do item: tudo
 * que impede a geração vira `blockers`.
 */
export function convertAmmo(
  item: XmlElement, path: string, commit: string, prices?: AmmoPriceLookup,
): ConvertedAmmo | undefined {
  const id = attrOptional(item, 'id');
  const name = attrOptional(item, 'name');
  if (id === undefined || name === undefined) return undefined;
  const attrs = attributesOf(item);
  if (value(attrs, 'primarytype') !== 'ammunition') return undefined;

  const scriptEl = attrs.get('script');
  const scriptAttrs = scriptEl === undefined ? new Map<string, XmlElement>() : attributesOf(scriptEl);
  const source: CatalogSource = { engine: 'canary', commit, path };
  const slug = slugify(name);
  const blockers: string[] = [];

  const ammotype = value(attrs, 'ammotype');
  if (ammotype !== 'arrow' && ammotype !== 'bolt') {
    return {
      id: slug, blockers: [`ammotype "${ammotype ?? 'nenhum'}" fora de arrow/bolt (AMMO_FAMILIES)`],
      entity: { id: slug, name, source },
    };
  }
  if (AUTHORED_AMMO_SLUGS.has(slug)) {
    return {
      id: slug, blockers: ['já autoral — preço regravado por npc-prices.ts (#574), nunca gerado aqui'],
      entity: { id: slug, name, source },
    };
  }

  const entity: Record<string, unknown> = { id: slug, name, family: ammotype };

  const attack = numberValue(attrs, 'attack');
  entity['attack'] = attack ?? 0;

  // Elemento (flash/shiver/flamming/earth/envenomed arrow): o `element<tipo>` SUBSTITUI o físico
  // — `attack` continua o número do tiro, só o `damageType` muda.
  const foundElements = [...ELEMENT_ATTR_TO_DAMAGE.entries()]
    .map(([attr, type]) => ({ type, amount: numberValue(attrs, attr) }))
    .filter((entry): entry is { type: string; amount: number } => entry.amount !== undefined && entry.amount > 0);
  if (foundElements.length > 1) {
    blockers.push(`mais de um elemento na munição (${foundElements.map((f) => f.type).join(', ')})`);
  } else if (foundElements.length === 1 && foundElements[0] !== undefined && foundElements[0].type !== 'physical') {
    entity['damageType'] = foundElements[0].type;
  }

  // Preço (§20.1/ADR 0026 d.3): OBRIGATÓRIO, sem fallback grátis. Sem NPC vendendo, a munição
  // não tem como gerar uma linha válida — vira blocker, nunca um preço inventado.
  const canaryId = Number(id);
  const buyObservation = prices?.buyMinByClientId.get(canaryId);
  if (buyObservation === undefined) {
    blockers.push('sem NPC vendendo (buyMinByClientId) — munição sem fallback grátis, ADR 0026 d.3');
  } else {
    entity['price'] = buyObservation.amount;
  }

  const maxHitChance = numberValue(attrs, 'maxhitchance');
  if (maxHitChance !== undefined) entity['maxHitChance'] = maxHitChance;
  const hitChance = numberValue(attrs, 'hitchance') ?? numberValue(attrs, 'hitChance');
  if (hitChance !== undefined) entity['hitChance'] = hitChance;

  const level = numberValue(scriptAttrs, 'level');
  if (level !== undefined) entity['requires'] = { level };

  entity['source'] = source;
  return { id: slug, blockers, entity: entity as CatalogEntity };
}

export interface AmmoCatalog extends CatalogImportResult {
  readonly converted: readonly ConvertedAmmo[];
}

/** Lê o `items.xml` inteiro e converte cada `<item>` de munição. */
export function readAmmoCatalog(
  ctx: CatalogImportContext, prices?: AmmoPriceLookup,
): AmmoCatalog {
  const root = readXmlFile(join(ctx.canaryDir, CANARY_ITEMS_XML));
  const converted: ConvertedAmmo[] = [];
  for (const item of childrenOf(root, 'item')) {
    const result = convertAmmo(item, CANARY_ITEMS_XML, ctx.canaryCommit, prices);
    if (result !== undefined) converted.push(result);
  }

  const entities: CatalogEntity[] = [];
  const skipped: SkippedEntity[] = [];
  const seen = new Set<string>();
  let duplicateSlugs = 0;
  for (const item of converted) {
    const name = typeof item.entity['name'] === 'string' ? item.entity['name'] : item.id;
    if (item.blockers.length > 0) {
      skipped.push({ id: item.id, name, reason: item.blockers.join('; '), source: item.entity.source });
      continue;
    }
    if (seen.has(item.id)) {
      duplicateSlugs += 1;
      skipped.push({ id: item.id, name, reason: 'id duplicado (outro item já gerou este slug)', source: item.entity.source });
      continue;
    }
    seen.add(item.id);
    entities.push(item.entity);
  }

  const slices = new Map<string, CatalogEntity[]>([['ammunition', entities]]);
  const notes: string[] = [
    `${converted.length} \`<item>\` de munição lidos; ${skipped.length} fora do corte, `
    + `${duplicateSlugs} por slug duplicado.`,
    `Os 5 slugs autorais (${[...AUTHORED_AMMO_SLUGS].join(', ')}) nunca são gerados aqui — o `
    + 'preço deles é regravado por `npc-prices.ts` (#574, `AMMO_CANARY_IDS`).',
    'Preço (`price`): o menor `buy` de `data-otservbr-global/npc/*.lua` por `id` do Canary; sem '
    + 'NPC vendendo, o item fica de fora (munição não tem preço grátis, ADR 0026 d.3).',
  ];

  return { slices, skipped, notes, converted };
}

registerCatalogType({
  id: 'ammo',
  dataDir: 'packages/content/staging/ammunition',
  run: (ctx) => {
    const prices = readNpcShopPrices(ctx);
    return readAmmoCatalog(ctx, prices);
  },
});
