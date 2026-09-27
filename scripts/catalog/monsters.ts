// scripts/catalog/monsters.ts — o leitor de monstros do Canary (M35-01, #578; ADR 0037/0038).
//
//   pnpm catalog:import monsters          # escreve packages/content/staging/monsters/generated/*.json
//   pnpm catalog:import monsters --check  # regenera em memória e compara
//
// Lê `data-otservbr-global/monster/**/*.lua` como DADO (`lua-table.ts` avalia só expressão
// literal, nunca executa Lua) e converte cada arquivo para a forma do `monsterSchema` de
// `@draconya/content`. O que sai é número e fato — stats, flags, elemento, loot, Bestiário —,
// nunca uma linha de Lua reproduzida (ADR 0019 limite 1, ADR 0038 decisão 7).
//
// **Por que `staging/` e não `data/monsters/generated/`.** O `load.ts` do conteúdo lê
// `data/<tipo>/generated/` no boot, e um monstro gerado ainda não passa nele: o loot aponta item
// pelo slug do nome e o catálogo de itens do M34 (#573) ainda não existe para resolver, e a
// tabela de aparências (`data/appearances/baseline.json`) não tem linha para ele. Versionar a
// transcrição fora da árvore que o boot lê mantém o `--check` honesto sem derrubar o jogo; a
// primeira importação para `data/` — loot resolvido, aparência gravada, Bestiário mesclado — é o
// M35-03 (#580). O registro aponta `packages/content/staging/monsters` até lá.
//
// **O que fica de fora nesta issue, e aparece no relatório** (`docs/reference/catalog/
// monsters-report.md`): monstro com ataque além do `melee` simples, com magia de defesa ou com
// invocação — o mapeamento é do M35-02 (#579) —; aparência que o pacote 13.32 não desenha; e as
// pastas `familiars/`, `trainers/` e `traps/`, que não são caça.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { evaluateAssignments, MIXED_TABLE_ITEMS_KEY, type ConstantResolver, type LuaValue } from './lua-table.js';
import type { CatalogEntity, CatalogSource } from './generated-writer.js';
import { registerCatalogType, type CatalogImportContext, type CatalogImportResult } from './registry.js';
import type { SkippedEntity } from './report.js';
import { attrOptional, readXmlFile } from './xml.js';
import { repoRootFrom } from './env.js';

/** A raiz dos monstros dentro do checkout do Canary. */
export const CANARY_MONSTER_ROOT = 'data-otservbr-global/monster';

/** `items.xml` — de onde sai o NOME de uma linha de loot declarada só por `id`. */
export const CANARY_ITEMS_XML = 'data/items/items.xml';

/** A raiz dos monstros do TFS (a velocidade na escala clássica, ADR 0037 decisão 4). */
export const TFS_MONSTER_ROOT = 'data/monster';

/** Pastas que não são caça: o Draconya nunca gera monstro delas. */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['familiars', 'trainers', 'traps']);

/**
 * O raio de agressão do monstro do Canary: `Creature::canSee` com `MAP_MAX_VIEW_PORT_X`/`_Y` = 11
 * (`src/map/map_const.hpp`) — o Canary não sobrescreve `canSee` para monstro, e o Dragon autoral
 * já usa este número desde o #527. Não existe campo por monstro no Lua.
 */
export const CANARY_AGGRO_RADIUS = 11;

/** Cadência padrão quando o monstro não declara ataque nenhum — o `interval` que o Canary mais usa. */
const DEFAULT_ATTACK_INTERVAL_MS = 2000;

/** `MAX_LOOTCHANCE` do Canary: a chance do Lua é sobre 100 000. */
export const CANARY_LOOT_CHANCE_SCALE = 100_000;

/**
 * As 20 classes de Bestiário do Canary (`monster.Bestiary.class`), no vocabulário do Draconya
 * (`MONSTER_CLASSES`, `packages/content/src/schemas.ts`). A chave é o texto EXATO do Lua.
 */
export const BESTIARY_CLASS_MAP: ReadonlyMap<string, string> = new Map([
  ['Amphibic', 'amphibic'], ['Aquatic', 'aquatic'], ['Bird', 'bird'], ['Construct', 'construct'],
  ['Demon', 'demon'], ['Dragon', 'dragon'], ['Elemental', 'elemental'],
  ['Extra Dimensional', 'extra-dimensional'], ['Fey', 'fey'], ['Giant', 'giant'], ['Human', 'human'],
  ['Humanoid', 'humanoid'], ['Lycanthrope', 'lycanthrope'], ['Magical', 'magical'],
  ['Mammal', 'mammal'], ['Plant', 'plant'], ['Reptile', 'reptile'], ['Slime', 'slime'],
  ['Undead', 'undead'], ['Vermin', 'vermin'],
]);

/**
 * `BESTY_RACE_*` (`BestiaryType_t`, `src/creatures/creatures_definitions.hpp`) → a `race` do
 * `bestiaryEntrySchema`, que já usa o nome em minúsculas (`"dragon"`, do #520). Resolvida para
 * TEXTO direto no avaliador — o número do enum não interessa a ninguém do lado de cá.
 */
const BESTIARY_RACE_CONSTANTS: Readonly<Record<string, string>> = {
  BESTY_RACE_AMPHIBIC: 'amphibic', BESTY_RACE_AQUATIC: 'aquatic', BESTY_RACE_BIRD: 'bird',
  BESTY_RACE_CONSTRUCT: 'construct', BESTY_RACE_DEMON: 'demon', BESTY_RACE_DRAGON: 'dragon',
  BESTY_RACE_ELEMENTAL: 'elemental', BESTY_RACE_FEY: 'fey', BESTY_RACE_GIANT: 'giant',
  BESTY_RACE_HUMAN: 'human', BESTY_RACE_HUMANOID: 'humanoid', BESTY_RACE_LYCANTHROPE: 'lycanthrope',
  BESTY_RACE_MAGICAL: 'magical', BESTY_RACE_MAMMAL: 'mammal', BESTY_RACE_PLANT: 'plant',
  BESTY_RACE_REPTILE: 'reptile', BESTY_RACE_SLIME: 'slime', BESTY_RACE_UNDEAD: 'undead',
  BESTY_RACE_VERMIN: 'vermin', BESTY_RACE_EXTRA_DIMENSIONAL: 'extra-dimensional',
  BESTY_RACE_INKBORN: 'inkborn',
};

/**
 * `COMBAT_*` (`CombatType_t`) → o `DamageType` do Draconya. Os quatro sem par (`UNDEFINED`,
 * `HEALING`, `AGONY`, `NEUTRAL`) resolvem para o próprio nome, e quem lê decide o que fazer — em
 * elemento de monstro, viram nota no relatório. Um `COMBAT_*` que o enum do Canary NÃO tem
 * (`COMBAT_LIFEDRAINDAMAGE`, real em `grimeleech.lua`) resolve para `nil`, como no Lua de
 * verdade: variável global inexistente é `nil`.
 */
const COMBAT_TYPE_CONSTANTS: Readonly<Record<string, string>> = {
  COMBAT_PHYSICALDAMAGE: 'physical', COMBAT_FIREDAMAGE: 'fire', COMBAT_EARTHDAMAGE: 'earth',
  COMBAT_ENERGYDAMAGE: 'energy', COMBAT_UNDEFINEDDAMAGE: 'COMBAT_UNDEFINEDDAMAGE',
  COMBAT_LIFEDRAIN: 'lifedrain', COMBAT_MANADRAIN: 'manadrain', COMBAT_HEALING: 'COMBAT_HEALING',
  COMBAT_DROWNDAMAGE: 'drown', COMBAT_ICEDAMAGE: 'ice', COMBAT_HOLYDAMAGE: 'holy',
  COMBAT_DEATHDAMAGE: 'death', COMBAT_AGONYDAMAGE: 'COMBAT_AGONYDAMAGE',
  COMBAT_NEUTRALDAMAGE: 'COMBAT_NEUTRALDAMAGE',
};

const DRACONYA_DAMAGE_TYPES: ReadonlySet<string> = new Set([
  'physical', 'energy', 'earth', 'fire', 'ice', 'holy', 'death', 'drown', 'lifedrain', 'manadrain', 'arcane',
]);

/** As moedas do Tibia e quanto cada uma vale em gold (gold ×1, platinum ×100, crystal ×10 000). */
export const COIN_VALUES: ReadonlyMap<string, number> = new Map([
  ['gold coin', 1], ['platinum coin', 100], ['crystal coin', 10_000],
]);

/**
 * O resolvedor de identificador para um `.lua` de monstro. `COMBAT_*` e `BESTY_RACE_*` saem
 * como texto (tabelas acima); qualquer outro identificador em MAIÚSCULAS (`CONST_ME_*`,
 * `CONST_ANI_*`, `CONDITION_*`) resolve para o próprio nome — é só a parte de ataque, que este
 * leitor não interpreta (M35-02), e travar o arquivo inteiro por um efeito visual seria perder o
 * monstro por nada.
 */
function monsterConstants(): ConstantResolver {
  return {
    resolve: (name) => {
      if (name.startsWith('COMBAT_')) return COMBAT_TYPE_CONSTANTS[name];
      const race = BESTIARY_RACE_CONSTANTS[name];
      if (race !== undefined) return race;
      return /^[A-Z][A-Z0-9_]*$/.test(name) ? name : undefined;
    },
  };
}

/**
 * O slug de um nome do Tibia: minúsculas, sem acento, sem apóstrofo, e todo o resto que não é
 * letra/dígito vira `-`. `"Dragon's Tail"` → `dragons-tail`, o mesmo id que o item autoral já tem.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------------------------
// Acesso tipado ao valor Lua avaliado.

type LuaRecord = { readonly [key: string]: LuaValue };

function isRecord(value: LuaValue | undefined): value is LuaRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A parte POSICIONAL de uma tabela: o array, ou o `$items` de uma tabela mista. */
function positionalOf(value: LuaValue | undefined): readonly LuaValue[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    const items = value[MIXED_TABLE_ITEMS_KEY];
    if (Array.isArray(items)) return items;
  }
  return [];
}

function num(value: LuaValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function bool(value: LuaValue | undefined): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function str(value: LuaValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// ---------------------------------------------------------------------------------------------
// As entradas de fora do Lua: nomes de item, velocidade do TFS e o inventário do pacote.

/** `id → name` de todo `<item id="…" name="…">` do `items.xml` (faixas `fromid/toid` incluídas). */
export function readItemNames(itemsXmlPath: string): Map<number, string> {
  const root = readXmlFile(itemsXmlPath);
  const names = new Map<number, string>();
  for (const item of root.children) {
    if (item.tag !== 'item') continue;
    const name = attrOptional(item, 'name');
    if (name === undefined) continue;
    const id = attrOptional(item, 'id');
    if (id !== undefined) { names.set(Number(id), name); continue; }
    const from = Number(attrOptional(item, 'fromid'));
    const to = Number(attrOptional(item, 'toid'));
    if (Number.isInteger(from) && Number.isInteger(to)) {
      for (let current = from; current <= to; current += 1) names.set(current, name);
    }
  }
  return names;
}

function walk(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, suffix));
    else if (name.endsWith(suffix)) out.push(path);
  }
  return out;
}

/**
 * `nome em minúsculas → speed` de todo `<monster name="…" speed="…">` do TFS. Sem o checkout,
 * mapa vazio — e o leitor cai no `Canary × 2` para todo monstro (ADR 0037 decisão 4).
 */
export function readTfsSpeeds(forgottenServerDir: string): Map<string, number> {
  const speeds = new Map<string, number>();
  let files: string[];
  try {
    files = walk(join(forgottenServerDir, TFS_MONSTER_ROOT), '.xml');
  } catch {
    return speeds;
  }
  for (const file of files) {
    // Só a tag de abertura interessa, e ler o XML inteiro de 1100 arquivos por dois atributos
    // seria desperdício — a tag `<monster …>` é plana, sem aninhamento.
    const text = readFileSync(file, 'latin1');
    const tag = /<monster\s([^>]*)>/.exec(text)?.[1];
    if (tag === undefined) continue;
    const name = /\bname="([^"]+)"/.exec(tag)?.[1];
    const speed = /\bspeed="(\d+)"/.exec(tag)?.[1];
    if (name === undefined || speed === undefined) continue;
    speeds.set(name.toLowerCase(), Number(speed));
  }
  return speeds;
}

type IdRange = readonly [number, number];

/** As faixas de `outfit` de `packages/content/data/packs/<pack>.json`. */
export function readPackOutfits(packPath: string): IdRange[] {
  const pack = JSON.parse(readFileSync(packPath, 'utf8')) as { outfit?: IdRange[] };
  return pack.outfit ?? [];
}

function inRanges(id: number, ranges: readonly IdRange[]): boolean {
  return ranges.some(([from, to]) => id >= from && id <= to);
}

// ---------------------------------------------------------------------------------------------
// A conversão de UM arquivo.

export interface MonsterReaderDeps {
  readonly itemNames: ReadonlyMap<number, string>;
  readonly tfsSpeeds: ReadonlyMap<string, number>;
  readonly outfitRanges: readonly IdRange[];
}

export interface LootLine {
  readonly itemId: string;
  readonly chance: number;
  readonly min?: number;
  readonly max?: number;
}

export interface GoldRoll {
  readonly chance: number;
  readonly min: number;
  readonly max: number;
}

export interface BestiaryDraft {
  readonly class: string;
  readonly race: string;
  readonly raceId?: number;
  readonly toKill: number;
  readonly firstUnlock: number;
  readonly secondUnlock: number;
  readonly charmsPoints: number;
  readonly stars: number;
  readonly occurrence: number;
}

/** O que o leitor observou de um arquivo e não coube no schema — vira nota no relatório. */
export interface MonsterNotes {
  /** Linhas de moeda além da que virou `loot.gold` (o Draconya tem UM gold por tabela). */
  readonly droppedCoinLines: readonly string[];
  /** Elementos abaixo de −100 % recortados em −100 % (TODO #683: o schema aceita até −200 %). */
  readonly clampedWeaknesses: readonly string[];
  /** Elementos ≥ 100 % que viraram imunidade. */
  readonly elementImmunities: readonly string[];
  /** Elemento sem `DamageType` no Draconya (`COMBAT_HEALING`, `COMBAT_AGONYDAMAGE`, `nil`, …). */
  readonly unmappedElements: readonly string[];
  /** De onde saiu a velocidade. */
  readonly speedSource: 'tfs' | 'canary-x2';
  /** `defenses.mitigation` acima do teto 30 do schema, recortado. */
  readonly mitigationClamped: boolean;
  /** Campos do Lua lidos e deliberadamente ignorados nesta issue. */
  readonly ignoredFields: readonly string[];
}

export interface ConvertedMonster {
  readonly id: string;
  readonly folder: string;
  /** A entidade na forma do `monsterSchema`, mais `bestiary`/`outfitId` de staging. */
  readonly entity: CatalogEntity;
  /** Motivos para NÃO gerar (vazio = gerado). */
  readonly blockers: readonly string[];
  readonly notes: MonsterNotes;
}

/** Os campos que o leitor lê para `monsterSchema`; o resto vira `ignoredFields`. */
const READ_FIELDS: ReadonlySet<string> = new Set([
  'name', 'description', 'experience', 'outfit', 'raceId', 'Bestiary', 'health', 'maxHealth', 'race',
  'speed', 'manaCost', 'changeTarget', 'strategiesTarget', 'flags', 'loot', 'attacks', 'defenses',
  'elements', 'immunities', 'summon', 'maxSummons', 'summons', 'critChance',
]);

/** Campos que não entram NUNCA nesta issue, com o dono de cada um. */
const IGNORED_FIELD_OWNERS: Readonly<Record<string, string>> = {
  events: 'M44', voices: 'M44', light: 'M44', corpse: 'sem campo no schema',
  heals: '#683', reflects: '#683', bosstiary: 'sem sistema de Bosstiary', faction: 'sem facção',
  enemyFactions: 'sem facção',
};

/** A velocidade na escala do TFS (ADR 0037 d.4): o TFS quando tem o mesmo monstro, senão Canary × 2. */
export function tfsScaleSpeed(name: string, canarySpeed: number, tfsSpeeds: ReadonlyMap<string, number>): {
  readonly speed: number; readonly source: 'tfs' | 'canary-x2';
} {
  const tfs = tfsSpeeds.get(name.toLowerCase());
  return tfs === undefined ? { speed: canarySpeed * 2, source: 'canary-x2' } : { speed: tfs, source: 'tfs' };
}

/** A chance do Lua (sobre 100 000) como fração — exata o bastante para `round(× 100 000)` voltar. */
export function lootChance(raw: number): number {
  const clamped = Math.min(Math.max(raw, 0), CANARY_LOOT_CHANCE_SCALE);
  return clamped / CANARY_LOOT_CHANCE_SCALE;
}

/** O dano máximo do `melee` declarado por `skill`/`attack` (Canary `Weapons::getMaxMeleeDamage`). */
export function maxMeleeDamage(skill: number, attack: number): number {
  return Math.ceil(skill * (attack * 0.05) + attack * 0.5);
}

interface MeleeResult {
  readonly attack: { readonly min: number; readonly max: number } | number;
  readonly intervalMs: number;
}

/** O `melee` simples, ou os nomes de ataque que este leitor ainda não mapeia (M35-02). */
function readAttacks(attacks: readonly LuaValue[]): { melee: MeleeResult | undefined; unmapped: string[] } {
  const unmapped: string[] = [];
  let melee: MeleeResult | undefined;
  for (const raw of attacks) {
    if (!isRecord(raw)) { unmapped.push('(linha sem tabela)'); continue; }
    const name = str(raw['name']) ?? '(sem nome)';
    if (name !== 'melee') { unmapped.push(name); continue; }
    const chance = num(raw['chance']) ?? 100;
    // `melee` com condição (veneno no golpe), com `type` elemental, ou com chance < 100 não é o
    // golpe básico do `monsterSchema` — é uma ability, e ability é o M35-02.
    if (melee !== undefined || chance < 100 || raw['condition'] !== undefined || raw['type'] !== undefined) {
      unmapped.push('melee (condição/tipo/chance/duplicado)');
      continue;
    }
    const intervalMs = num(raw['interval']) ?? DEFAULT_ATTACK_INTERVAL_MS;
    const skill = num(raw['skill']);
    const attackValue = num(raw['attack']);
    if (skill !== undefined && attackValue !== undefined && skill > 0 && attackValue > 0) {
      melee = { attack: { min: 0, max: maxMeleeDamage(skill, attackValue) }, intervalMs };
      continue;
    }
    const a = Math.abs(num(raw['minDamage']) ?? 0);
    const b = Math.abs(num(raw['maxDamage']) ?? 0);
    melee = { attack: { min: Math.min(a, b), max: Math.max(a, b) }, intervalMs };
  }
  return { melee, unmapped };
}

interface LootResult {
  readonly gold: GoldRoll | undefined;
  readonly items: LootLine[];
  readonly droppedCoinLines: string[];
  readonly problems: string[];
  readonly extraKeys: Set<string>;
}

const LOOT_KEYS: ReadonlySet<string> = new Set(['id', 'name', 'chance', 'maxCount', 'minCount']);

function readLoot(loot: readonly LuaValue[], itemNames: ReadonlyMap<number, string>): LootResult {
  const items: LootLine[] = [];
  const coins: { name: string; value: number; chance: number; min: number; max: number }[] = [];
  const problems: string[] = [];
  const extraKeys = new Set<string>();
  for (const raw of loot) {
    if (!isRecord(raw)) { problems.push('linha de loot sem tabela'); continue; }
    for (const key of Object.keys(raw)) if (!LOOT_KEYS.has(key)) extraKeys.add(key);
    const id = num(raw['id']);
    const name = str(raw['name']) ?? (id === undefined ? undefined : itemNames.get(id));
    if (name === undefined) {
      problems.push(`loot sem nome resolvível (id ${id ?? '?'})`);
      continue;
    }
    const chanceRaw = num(raw['chance']) ?? 0;
    const min = Math.max(1, num(raw['minCount']) ?? 1);
    const max = Math.max(min, num(raw['maxCount']) ?? 1);
    const coinValue = COIN_VALUES.get(name.toLowerCase());
    if (coinValue !== undefined) {
      coins.push({ name: name.toLowerCase(), value: coinValue, chance: lootChance(chanceRaw), min, max });
      continue;
    }
    const line: LootLine = min === 1 && max === 1
      ? { itemId: slugify(name), chance: lootChance(chanceRaw) }
      : { itemId: slugify(name), chance: lootChance(chanceRaw), min, max };
    items.push(line);
  }
  // O Draconya tem UM `loot.gold` por tabela; o Canary declara até três linhas de moeda. Fica a
  // de gold coin quando existe (é a comum), senão a primeira; as outras vão para o relatório.
  // Ver o risco registrado na PR do #578 e no comentário do #685.
  const chosen = coins.find((coin) => coin.value === 1) ?? coins[0];
  const droppedCoinLines = coins.filter((coin) => coin !== chosen)
    .map((coin) => `${coin.name} ${coin.min}–${coin.max} @ ${coin.chance}`);
  const gold = chosen === undefined
    ? undefined
    : { chance: chosen.chance, min: chosen.min * chosen.value, max: chosen.max * chosen.value };
  return { gold, items, droppedCoinLines, problems, extraKeys };
}

interface MitigationResult {
  readonly resistances: Record<string, number>;
  readonly immunities: string[];
  readonly clamped: string[];
  readonly elementImmunities: string[];
  readonly unmapped: string[];
}

function readElements(elements: readonly LuaValue[], immunitiesRaw: readonly LuaValue[]): MitigationResult {
  const resistances: Record<string, number> = {};
  const immunities = new Set<string>();
  const clamped: string[] = [];
  const elementImmunities: string[] = [];
  const unmapped: string[] = [];
  for (const raw of elements) {
    if (!isRecord(raw)) continue;
    const type = str(raw['type']);
    const percent = num(raw['percent']) ?? 0;
    if (percent === 0) continue;
    if (type === undefined || !DRACONYA_DAMAGE_TYPES.has(type)) {
      unmapped.push(`${type ?? 'nil'} ${percent}%`);
      continue;
    }
    if (percent >= 100) {
      // Resistência de 100 % é recusada pelo schema (DT-02: imunidade é EXPLÍCITA); acima de 100
      // o Canary chega a curar, e o piso de dano do Draconya não tem como representar isso —
      // imunidade é o mais perto (#683).
      immunities.add(type);
      elementImmunities.push(`${type} ${percent}%`);
      continue;
    }
    if (percent < -100) {
      // TODO(#683): o schema passa a aceitar fraqueza até −200 %; até lá, recorta em −100 %.
      clamped.push(`${type} ${percent}%`);
      resistances[type] = -1;
      continue;
    }
    resistances[type] = percent / 100;
  }
  // `immunities` do Lua com `combat = true` é imunidade de DANO (a forma antiga); `condition = true`
  // (paralyze, invisible, outfit, drunk, bleed) é imunidade de CONDIÇÃO, sem campo no schema.
  for (const raw of immunitiesRaw) {
    if (!isRecord(raw)) continue;
    const type = str(raw['type']);
    if (bool(raw['combat']) !== true || type === undefined) continue;
    const damageType = type === 'poison' ? 'earth' : type;
    if (DRACONYA_DAMAGE_TYPES.has(damageType)) {
      immunities.add(damageType);
      delete resistances[damageType];
    }
  }
  return { resistances, immunities: [...immunities].sort(), clamped, elementImmunities, unmapped };
}

function readBestiary(raw: LuaValue | undefined, raceId: number | undefined): BestiaryDraft | string | undefined {
  if (!isRecord(raw)) return undefined;
  const className = str(raw['class']);
  const mapped = className === undefined ? undefined : BESTIARY_CLASS_MAP.get(className);
  if (mapped === undefined) return `classe de Bestiário desconhecida: ${className ?? 'nil'}`;
  const race = str(raw['race']);
  if (race === undefined) return 'Bestiário sem race';
  const draft: BestiaryDraft = {
    class: mapped,
    race,
    ...(raceId === undefined ? {} : { raceId }),
    toKill: num(raw['toKill']) ?? 0,
    firstUnlock: num(raw['FirstUnlock']) ?? 0,
    secondUnlock: num(raw['SecondUnlock']) ?? 0,
    charmsPoints: num(raw['CharmsPoints']) ?? 0,
    stars: num(raw['Stars']) ?? 0,
    occurrence: num(raw['Occurrence']) ?? 0,
  };
  return draft;
}

/** O nome do `Game.createMonsterType("…")` — a chave única de registro do Canary. */
export function monsterTypeName(source: string): string | undefined {
  return /Game\.createMonsterType\(\s*"([^"]+)"/.exec(source)?.[1];
}

/**
 * Converte UM arquivo `.lua` de monstro. Nunca lança por dado do monstro: tudo que impede a
 * geração vira `blockers`, e o que foi lido mas não coube vira `notes`.
 */
export function convertMonster(
  sourceText: string, path: string, folder: string, commit: string, deps: MonsterReaderDeps,
): ConvertedMonster {
  const typeName = monsterTypeName(sourceText);
  const fallbackId = slugify(path.split('/').pop()?.replace(/\.lua$/, '') ?? path);
  const source: CatalogSource = { engine: 'canary', commit, path };
  const emptyNotes: MonsterNotes = {
    droppedCoinLines: [], clampedWeaknesses: [], elementImmunities: [], unmappedElements: [],
    speedSource: 'canary-x2', mitigationClamped: false, ignoredFields: [],
  };
  if (typeName === undefined) {
    return {
      id: fallbackId, folder, entity: { id: fallbackId, name: fallbackId, source },
      blockers: ['sem Game.createMonsterType("…")'], notes: emptyNotes,
    };
  }
  const id = slugify(typeName);
  let raw: Record<string, LuaValue>;
  try {
    raw = evaluateAssignments(sourceText, 'monster', monsterConstants());
  } catch (erro) {
    return {
      id, folder, entity: { id, name: typeName, source },
      blockers: [`Lua não avaliável como dado: ${(erro as Error).message}`], notes: emptyNotes,
    };
  }

  const blockers: string[] = [];
  const name = str(raw['name']) ?? typeName;

  // Aparência: só outfit (`lookType`) do pacote 13.32. `lookTypeEx` é monstro desenhado como
  // ITEM, e a tabela de aparências do Draconya só resolve outfit para monstro.
  const outfit = isRecord(raw['outfit']) ? raw['outfit'] : {};
  const lookType = num(outfit['lookType']) ?? 0;
  const lookTypeEx = num(outfit['lookTypeEx']) ?? 0;
  if (lookType === 0) {
    blockers.push(lookTypeEx > 0 ? `aparência por item (lookTypeEx ${lookTypeEx}) — só outfit é resolvido` : 'sem aparência (lookType 0)');
  } else if (!inRanges(lookType, deps.outfitRanges)) {
    blockers.push(`outfit ${lookType} fora do pacote 13.32`);
  }

  const attacks = readAttacks(positionalOf(raw['attacks']));
  if (attacks.unmapped.length > 0) {
    blockers.push(`ataque sem mapeador (M35-02): ${[...new Set(attacks.unmapped)].sort().join(', ')}`);
  }
  const defensesRaw = raw['defenses'];
  const defenseSpells = positionalOf(defensesRaw).map((spell) => (isRecord(spell) ? str(spell['name']) ?? '?' : '?'));
  if (defenseSpells.length > 0) {
    blockers.push(`defesa com magia sem mapeador (M35-02): ${[...new Set(defenseSpells)].sort().join(', ')}`);
  }
  const summonTable = raw['summon'];
  const summonEntries = isRecord(summonTable) ? positionalOf(summonTable['summons']) : [];
  if (summonEntries.length > 0 || positionalOf(raw['summons']).length > 0) {
    blockers.push('invocação (M35-02)');
  }

  const defenses = isRecord(defensesRaw) ? defensesRaw : {};
  const mitigationRaw = num(defenses['mitigation']) ?? 0;
  const mitigationClamped = mitigationRaw > 30;

  const elements = readElements(positionalOf(raw['elements']), positionalOf(raw['immunities']));
  const loot = readLoot(positionalOf(raw['loot']), deps.itemNames);
  for (const problem of loot.problems) blockers.push(problem);

  const canarySpeed = num(raw['speed']) ?? 0;
  const speed = tfsScaleSpeed(name, canarySpeed, deps.tfsSpeeds);
  if (speed.speed <= 0) blockers.push('speed 0 (monstro imóvel) — o schema exige velocidade positiva');

  const health = num(raw['maxHealth']) ?? num(raw['health']) ?? 0;
  if (health <= 0) blockers.push('sem vida (maxHealth 0)');

  const bestiary = readBestiary(raw['Bestiary'], num(raw['raceId']));
  if (typeof bestiary === 'string') blockers.push(bestiary);

  const flags = isRecord(raw['flags']) ? raw['flags'] : {};
  const changeTarget = isRecord(raw['changeTarget']) ? raw['changeTarget'] : {};
  const strategies = isRecord(raw['strategiesTarget']) ? raw['strategiesTarget'] : {};

  const ignoredFields = Object.keys(raw)
    .filter((field) => !READ_FIELDS.has(field))
    .map((field) => `${field}${IGNORED_FIELD_OWNERS[field] === undefined ? '' : ` (${IGNORED_FIELD_OWNERS[field]})`}`)
    .sort();
  for (const key of [...loot.extraKeys].sort()) ignoredFields.push(`loot.${key}`);
  if (positionalOf(raw['immunities']).some((entry) => isRecord(entry) && bool(entry['condition']) === true)) {
    ignoredFields.push('immunities.condition (sem imunidade de condição no schema)');
  }
  for (const flag of ['pushable', 'canPushItems', 'canPushCreatures']) {
    if (flags[flag] !== undefined) ignoredFields.push(`flags.${flag} (sem campo no schema)`);
  }

  const entity: Record<string, unknown> = {
    id,
    name,
    ...(typeof bestiary === 'object' ? { class: bestiary.class } : {}),
    health,
    experience: num(raw['experience']) ?? 0,
    attack: attacks.melee?.attack ?? 0,
    armor: num(defenses['armor']) ?? 0,
    defense: num(defenses['defense']) ?? 0,
    damageType: 'physical',
    mitigation: { resistances: elements.resistances, immunities: elements.immunities },
    defenseMitigation: Math.min(Math.max(mitigationRaw, 0), 30),
    ...(num(raw['critChance']) === undefined ? {} : { critChance: num(raw['critChance']) }),
    canWalkOnFire: bool(flags['canWalkOnFire']) ?? true,
    canWalkOnPoison: bool(flags['canWalkOnPoison']) ?? true,
    canWalkOnEnergy: bool(flags['canWalkOnEnergy']) ?? true,
    attackIntervalMs: attacks.melee?.intervalMs ?? DEFAULT_ATTACK_INTERVAL_MS,
    speed: speed.speed,
    aggroRadius: CANARY_AGGRO_RADIUS,
    attackRange: 1,
    targetDistance: Math.max(1, num(flags['targetDistance']) ?? 1),
    blockable: bool(flags['isBlockable']) ?? false,
    loot: {
      // `rollModel: 'canary'` (#685): a tabela gerada rola do jeito do Canary. O schema ainda não
      // declara o campo — o `lootTableSchema` é `z.object` e o descarta ao validar — até o #685.
      rollModel: 'canary',
      ...(loot.gold === undefined ? {} : { gold: loot.gold }),
      items: loot.items,
    },
  };
  const changeInterval = num(changeTarget['interval']) ?? 0;
  if (changeInterval > 0) {
    entity['targetChange'] = { intervalMs: changeInterval, chance: (num(changeTarget['chance']) ?? 0) / 100 };
  }
  const weights = {
    nearest: num(strategies['nearest']) ?? 0,
    health: num(strategies['health']) ?? 0,
    damage: num(strategies['damage']) ?? 0,
    random: num(strategies['random']) ?? 0,
  };
  if (weights.nearest + weights.health + weights.damage + weights.random > 0) entity['targetStrategy'] = weights;
  const runHealth = num(flags['runHealth']) ?? 0;
  if (runHealth > 0) entity['runOnHealth'] = runHealth;
  const staticChance = num(flags['staticAttackChance']);
  if (staticChance !== undefined) entity['staticAttack'] = Math.min(Math.max(staticChance, 0), 100) / 100;
  if (attacks.melee === undefined && attacks.unmapped.length === 0) {
    entity['_open'] = 'Sem ataque no Canary: attack 0 e attackIntervalMs 2000 são o preenchimento do schema, não um número do Tibia.';
  }
  entity['source'] = source;
  // Staging (#580 separa): a ficha de Bestiário e o outfit não moram na entidade de `data/`.
  if (typeof bestiary === 'object') entity['bestiary'] = bestiary;
  if (lookType > 0) entity['outfitId'] = lookType;

  return {
    id,
    folder,
    entity: entity as CatalogEntity,
    blockers,
    notes: {
      droppedCoinLines: loot.droppedCoinLines,
      clampedWeaknesses: elements.clamped,
      elementImmunities: elements.elementImmunities,
      unmappedElements: elements.unmapped,
      speedSource: speed.source,
      mitigationClamped,
      ignoredFields,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// O catálogo inteiro.

export interface MonsterCatalog extends CatalogImportResult {
  readonly converted: readonly ConvertedMonster[];
}

/** Os `.lua` de monstro do checkout, relativos à raiz do Canary, sem as pastas de fora. */
export function listMonsterFiles(canaryDir: string): string[] {
  const root = join(canaryDir, CANARY_MONSTER_ROOT);
  return walk(root, '.lua')
    .map((file) => relative(canaryDir, file).split(sep).join('/'))
    .filter((path) => !SKIPPED_FOLDERS.has(folderOf(path)));
}

function folderOf(path: string): string {
  return path.slice(CANARY_MONSTER_ROOT.length + 1).split('/')[0] ?? '';
}

function countBy(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([value, count]) => `${value} (${count})`)
    .join(', ');
}

/** Lê o catálogo inteiro. Puro sobre as entradas: mesmo checkout, mesmo resultado. */
export function readMonsterCatalog(ctx: CatalogImportContext, deps: MonsterReaderDeps): MonsterCatalog {
  const converted: ConvertedMonster[] = [];
  for (const path of listMonsterFiles(ctx.canaryDir)) {
    const text = readFileSync(join(ctx.canaryDir, path), 'utf8');
    converted.push(convertMonster(text, path, folderOf(path), ctx.canaryCommit, deps));
  }

  const slices = new Map<string, CatalogEntity[]>();
  const skipped: SkippedEntity[] = [];
  const seen = new Set<string>();
  const generated: ConvertedMonster[] = [];
  for (const monster of converted) {
    const source = monster.entity.source;
    const name = typeof monster.entity['name'] === 'string' ? monster.entity['name'] : monster.id;
    if (monster.blockers.length > 0) {
      skipped.push({ id: monster.id, name, reason: monster.blockers.join('; ').replace(/\|/g, '/').replace(/\s+/g, ' '), source });
      continue;
    }
    if (seen.has(monster.id)) {
      skipped.push({ id: monster.id, name, reason: 'id duplicado (outro arquivo já gerou este nome)', source });
      continue;
    }
    seen.add(monster.id);
    generated.push(monster);
    const slice = slices.get(monster.folder) ?? [];
    slice.push(monster.entity);
    slices.set(monster.folder, slice);
  }

  const notes: string[] = [];
  const tfs = generated.filter((monster) => monster.notes.speedSource === 'tfs').length;
  notes.push(
    `Velocidade (ADR 0037 d.4): ${tfs} gerado(s) com o speed do TFS, ${generated.length - tfs} com Canary × 2`
    + `${ctx.forgottenServerCommit === '' ? ' — o checkout do TFS não estava nesta máquina, então todo monstro caiu no × 2' : ` (TFS em \`${ctx.forgottenServerCommit}\`)`}.`,
  );
  const withCoins = converted.filter((monster) => monster.notes.droppedCoinLines.length > 0);
  const generatedWithCoins = generated.filter((monster) => monster.notes.droppedCoinLines.length > 0);
  notes.push(
    `Moeda: ${withCoins.length} arquivo(s) lido(s) têm mais de uma linha de moeda; o Draconya tem um \`loot.gold\` por tabela `
    + `e fica a de gold coin (senão a primeira). Entre os gerados: ${generatedWithCoins.length}`
    + `${generatedWithCoins.length === 0 ? '' : ` — ${generatedWithCoins.map((m) => `\`${m.id}\` (descartado: ${m.notes.droppedCoinLines.join('; ')})`).join(', ')}`}.`,
  );
  const clamped = generated.filter((monster) => monster.notes.clampedWeaknesses.length > 0);
  notes.push(
    `Fraqueza abaixo de −100 % recortada em −100 % (TODO #683): ${clamped.length === 0 ? 'nenhum gerado' : clamped.map((m) => `\`${m.id}\` (${m.notes.clampedWeaknesses.join(', ')})`).join(', ')}.`,
  );
  const immune = generated.filter((monster) => monster.notes.elementImmunities.length > 0).length;
  notes.push(`Elemento ≥ 100 % virou imunidade em ${immune} monstro(s) gerado(s).`);
  const unmappedElements = generated.flatMap((monster) => monster.notes.unmappedElements);
  if (unmappedElements.length > 0) notes.push(`Elemento sem tipo de dano no Draconya (descartado): ${countBy(unmappedElements)}.`);
  const mitigation = generated.filter((monster) => monster.notes.mitigationClamped).map((m) => `\`${m.id}\``);
  if (mitigation.length > 0) notes.push(`\`defenses.mitigation\` acima de 30 recortada: ${mitigation.join(', ')}.`);
  notes.push(`Campos lidos e ignorados nesta issue (arquivos gerados): ${countBy(generated.flatMap((m) => m.notes.ignoredFields)) || 'nenhum'}.`);
  notes.push(`Pastas fora do catálogo: ${[...SKIPPED_FOLDERS].sort().map((folder) => `\`${folder}/\``).join(', ')}.`);

  return { slices, skipped, notes, converted };
}

/** As entradas que o leitor busca fora do Lua, a partir do contexto e do repositório. */
export function loadReaderDeps(ctx: CatalogImportContext, repoRoot: string): MonsterReaderDeps {
  return {
    itemNames: readItemNames(join(ctx.canaryDir, CANARY_ITEMS_XML)),
    tfsSpeeds: ctx.forgottenServerCommit === '' ? new Map() : readTfsSpeeds(ctx.forgottenServerDir),
    outfitRanges: readPackOutfits(join(repoRoot, 'packages', 'content', 'data', 'packs', 'tibia-1332.json')),
  };
}

registerCatalogType({
  id: 'monsters',
  // Staging até o #580 — ver o cabeçalho deste arquivo.
  dataDir: 'packages/content/staging/monsters',
  run: (ctx) => readMonsterCatalog(ctx, loadReaderDeps(ctx, repoRootFrom(import.meta.url))),
});
