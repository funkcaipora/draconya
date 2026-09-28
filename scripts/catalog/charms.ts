// scripts/catalog/charms.ts — o leitor de Charms do Canary (M39-02, #602; ADR 0037/0038, ADR
// 0053 d.3).
//
//   pnpm catalog:import charms          # escreve packages/content/data/charms/generated/*.json
//   pnpm catalog:import charms --check  # regenera em memória e compara, não escreve nada
//
// Lê `data/scripts/systems/bestiary_charms.lua` como DADO (`lua-table.ts` avalia só expressão
// literal, nunca executa Lua): o arquivo é `local charms = { [1] = {...}, [2] = {...}, ... }`,
// diferente do padrão `raiz.campo = valor` que `monsters.ts`/`npc-prices.ts` leem — mas
// `evaluateAssignments` já cobre essa forma (`applyLocal`, quando `rootName` recebe uma tabela
// inteira de uma vez): o resultado é `{ "1": {...}, "2": {...}, ... }`, uma entrada por posição.
//
// **Revisão de sistema, não sistema novo** (ADR 0053 §Contexto): o `main` do Canary já tem a
// forma de 2024 (major/minor, três tiers, echoes) — a regra de corte (ADR 0038 d.5) fala de
// SISTEMA posterior ao 13.32, e uma revisão de sistema que o 13.32 já tinha (Charms existem
// desde 8.6) segue o Canary `main` por precedência (ADR 0037 d.4).
//
// **25 charms, não 20** — a premissa da issue #602 ("20 charms") não se sustentou: o arquivo
// real (`things/sources/canary`, commit conferido em `env.ts`) declara 25 entradas, `[1]` a
// `[25]`. O número certo é o do arquivo, e o desvio fica registrado aqui e na spec da issue.
//
// **Só os sete campos que a Direção pede** (nome, category, type, damageType, percent, chance[3],
// points[3]) saem daqui — `description`, `messageCancel`, `messageServerLog` e `effect` (arte,
// invariante 6) ficam de fora. `effect` ainda PRECISA resolver durante a avaliação da tabela
// (senão o Lua inteiro falha por um identificador desconhecido), só não é copiado para a saída.
//
// **`damageType` usa um vocabulário PRÓPRIO deste catálogo**, não `DAMAGE_TYPES` de
// `@draconya/content` (`schemas.ts`): três charms (Carnage, Overpower, Overflux) usam
// `COMBAT_NEUTRALDAMAGE`, que não existe no vocabulário de dano do resto do conteúdo — "neutro"
// nunca apareceu em item nem monstro. Inventar um mapeamento para o vocabulário existente seria
// uma correção não pedida (fora do escopo do #602, que é só a economia); a resolução de como
// "neutral" se comporta em combate é do `combat-v4`, matéria do #603.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractEnum, CHARM_CATEGORY_ENUM, CHARM_CATEGORY_HEADER, CHARM_TYPE_ENUM, CHARM_TYPE_HEADER, COMBAT_TYPE_ENUM, COMBAT_TYPE_HEADER, MAGIC_EFFECT_ENUM, MAGIC_EFFECT_HEADER } from './enums.js';
import type { CatalogEntity, CatalogSource } from './generated-writer.js';
import { constantsFrom, evaluateAssignments, type LuaValue } from './lua-table.js';
import { slugify } from './monsters.js';
import { registerCatalogType, type CatalogImportContext, type CatalogImportResult } from './registry.js';
import type { SkippedEntity } from './report.js';

/** `data/scripts/systems/bestiary_charms.lua`, dentro do checkout do Canary. */
export const CANARY_CHARMS_LUA = 'data/scripts/systems/bestiary_charms.lua';

export const CHARM_CATEGORIES: ReadonlyMap<string, 'major' | 'minor'> = new Map([
  ['CHARM_MAJOR', 'major'],
  ['CHARM_MINOR', 'minor'],
]);

export const CHARM_TYPES: ReadonlyMap<string, 'offensive' | 'defensive' | 'passive'> = new Map([
  ['CHARM_OFFENSIVE', 'offensive'],
  ['CHARM_DEFENSIVE', 'defensive'],
  ['CHARM_PASSIVE', 'passive'],
]);

/** O vocabulário DESTE catálogo — ver o comentário do cabeçalho sobre `neutral`. */
export const CHARM_DAMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ['COMBAT_PHYSICALDAMAGE', 'physical'],
  ['COMBAT_FIREDAMAGE', 'fire'],
  ['COMBAT_EARTHDAMAGE', 'earth'],
  ['COMBAT_ENERGYDAMAGE', 'energy'],
  ['COMBAT_ICEDAMAGE', 'ice'],
  ['COMBAT_HOLYDAMAGE', 'holy'],
  ['COMBAT_DEATHDAMAGE', 'death'],
  ['COMBAT_NEUTRALDAMAGE', 'neutral'],
]);

/** Monta o resolvedor de constantes: enum → valor, e valor → o nosso rótulo, os dois por nome. */
function buildConstants(canaryDir: string): {
  readonly resolve: (name: string) => number | string | undefined;
  readonly categoryOf: (value: number) => 'major' | 'minor' | undefined;
  readonly typeOf: (value: number) => 'offensive' | 'defensive' | 'passive' | undefined;
  readonly damageTypeOf: (value: number) => string | undefined;
} {
  const category = extractEnum(readFileSync(join(canaryDir, CHARM_CATEGORY_HEADER), 'utf8'), CHARM_CATEGORY_ENUM);
  const type = extractEnum(readFileSync(join(canaryDir, CHARM_TYPE_HEADER), 'utf8'), CHARM_TYPE_ENUM);
  const combat = extractEnum(readFileSync(join(canaryDir, COMBAT_TYPE_HEADER), 'utf8'), COMBAT_TYPE_ENUM);
  // CONST_ME_* precisa resolver para o Lua inteiro avaliar (o campo `effect` de cada charm),
  // mesmo que o valor nunca saia no JSON (invariante 6 — nada de arte aqui).
  const effect = extractEnum(readFileSync(join(canaryDir, MAGIC_EFFECT_HEADER), 'utf8'), MAGIC_EFFECT_ENUM);
  const merged = new Map<string, number>([...category, ...type, ...combat, ...effect]);

  const byValue = <T extends string>(source: ReadonlyMap<string, T>, enumMap: ReadonlyMap<string, number>) => {
    const table = new Map<number, T>();
    for (const [name, label] of source) {
      const value = enumMap.get(name);
      if (value !== undefined) table.set(value, label);
    }
    return table;
  };
  const categoryByValue = byValue(CHARM_CATEGORIES, category);
  const typeByValue = byValue(CHARM_TYPES, type);
  const damageByValue = byValue(CHARM_DAMAGE_TYPES, combat);

  return {
    resolve: constantsFrom(merged).resolve,
    categoryOf: (value) => categoryByValue.get(value),
    typeOf: (value) => typeByValue.get(value),
    damageTypeOf: (value) => damageByValue.get(value),
  };
}

function numberField(record: Readonly<Record<string, LuaValue>>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function numberArray(value: LuaValue | undefined): readonly number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length !== 3 || !value.every((entry) => typeof entry === 'number')) return undefined;
  return value as readonly number[];
}

export interface ConvertedCharm {
  readonly id: string;
  readonly entity: CatalogEntity;
  readonly blockers: readonly string[];
}

/** Converte UMA entrada (`charms["1"]`, …) já avaliada pelo Lua. `undefined`: não é um registro. */
export function convertCharm(
  canaryCharmId: number, raw: LuaValue, resolved: ReturnType<typeof buildConstants>, source: CatalogSource,
): ConvertedCharm | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Readonly<Record<string, LuaValue>>;
  const name = record['name'];
  if (typeof name !== 'string' || name.length === 0) return undefined;
  const slug = slugify(name);
  const blockers: string[] = [];

  const categoryValue = numberField(record, 'category');
  const category = categoryValue === undefined ? undefined : resolved.categoryOf(categoryValue);
  if (category === undefined) blockers.push(`category "${String(record['category'])}" não reconhecida (CHARM_MAJOR/CHARM_MINOR)`);

  const typeValue = numberField(record, 'type');
  const type = typeValue === undefined ? undefined : resolved.typeOf(typeValue);
  if (type === undefined) blockers.push(`type "${String(record['type'])}" não reconhecido (CHARM_OFFENSIVE/DEFENSIVE/PASSIVE)`);

  const chance = numberArray(record['chance']);
  if (chance === undefined) blockers.push('chance ausente ou não é um vetor de 3 números (tiers 1/2/3)');

  const points = numberArray(record['points']);
  if (points === undefined) blockers.push('points ausente ou não é um vetor de 3 números (tiers 1/2/3)');

  const entity: Record<string, unknown> = {
    id: slug,
    name,
    canaryCharmId,
    ...(category === undefined ? {} : { category }),
    ...(type === undefined ? {} : { type }),
    ...(chance === undefined ? {} : { chance }),
    ...(points === undefined ? {} : { points }),
    source,
  };

  const damageTypeValue = numberField(record, 'damageType');
  if (damageTypeValue !== undefined) {
    const damageType = resolved.damageTypeOf(damageTypeValue);
    if (damageType === undefined) blockers.push(`damageType "${damageTypeValue}" não reconhecido`);
    else entity['damageType'] = damageType;
  }

  const percent = numberField(record, 'percent');
  if (percent !== undefined) entity['percent'] = percent;

  return { id: slug, blockers, entity: entity as CatalogEntity };
}

export interface CharmCatalog extends CatalogImportResult {
  readonly converted: readonly ConvertedCharm[];
}

export function readCharmCatalog(ctx: CatalogImportContext): CharmCatalog {
  const path = CANARY_CHARMS_LUA;
  const source = readFileSync(join(ctx.canaryDir, path), 'utf8');
  const resolved = buildConstants(ctx.canaryDir);
  const table = evaluateAssignments(source, 'charms', { resolve: resolved.resolve });

  const converted: ConvertedCharm[] = [];
  // As chaves são "1".."25" — a posição Lua (1-based); `Game.createBestiaryCharm(charmId - 1)`
  // no próprio arquivo confirma que o `charmRune_t` em uso no motor é a posição MENOS 1.
  const positions = Object.keys(table)
    .map((key) => Number(key))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  for (const position of positions) {
    const raw = table[String(position)];
    const catalogSource: CatalogSource = { engine: 'canary', commit: ctx.canaryCommit, path };
    const result = convertCharm(position - 1, raw, resolved, catalogSource);
    if (result !== undefined) converted.push(result);
  }

  const entities: CatalogEntity[] = [];
  const skipped: SkippedEntity[] = [];
  const seen = new Set<string>();
  for (const charm of converted) {
    const name = typeof charm.entity['name'] === 'string' ? charm.entity['name'] : charm.id;
    if (charm.blockers.length > 0) {
      skipped.push({ id: charm.id, name, reason: charm.blockers.join('; '), source: charm.entity.source });
      continue;
    }
    if (seen.has(charm.id)) {
      skipped.push({ id: charm.id, name, reason: 'id duplicado (outro charm já gerou este slug)', source: charm.entity.source });
      continue;
    }
    seen.add(charm.id);
    entities.push(charm.entity);
  }

  const slices = new Map<string, CatalogEntity[]>([['charms', entities]]);
  const notes = [
    `${converted.length} charms lidos de \`${path}\`; ${skipped.length} fora do corte.`,
    'A issue #602 previa 20 charms; o arquivo real do Canary `main` declara 25 — o número que '
    + 'saiu daqui é o do arquivo, não o da premissa original.',
    '`damageType` usa um vocabulário próprio deste catálogo, incluindo `neutral` '
    + '(Carnage/Overpower/Overflux) — ausente do vocabulário de dano do resto do conteúdo '
    + '(`DAMAGE_TYPES`); a resolução em combate fica para o `combat-v4` (#603).',
    '`effect`/`messageCancel`/`messageServerLog`/`description` do Canary não saem aqui '
    + '(invariante 6 e a Direção da issue, que só pede os sete campos mecânicos).',
  ];

  return { slices, skipped, notes, converted };
}

registerCatalogType({
  id: 'charms',
  dataDir: 'packages/content/data/charms',
  run: (ctx) => readCharmCatalog(ctx),
});
