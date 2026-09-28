// scripts/catalog/monster-abilities.ts — os mapeadores de ataque, defesa e invocação do Canary
// para as formas do Draconya (M35-02, #579; ADR 0037/0038).
//
// Uma entrada de `monster.attacks`/`monster.defenses` do Canary é um "spell" com NOME: o nome
// decide o mecanismo (`Monsters::deserializeSpell`, `src/creatures/monsters/monsters.cpp`), e os
// campos (`interval`, `chance`, `range`, `radius`, `length`/`spread`, `target`, `effect`,
// `shootEffect`, `condition`, …) parametrizam. Este módulo tem UM mapeador por nome: o que ele
// devolve é a ability (`monsterAbilitySchema`) ou a defesa (`monsterDefenseSchema`) do Draconya,
// um DESCARTE justificado (o Canary não faz nada mecânico com o nome), ou o motivo de não mapear —
// e o monstro com qualquer motivo NÃO é gerado. O relatório conta os nomes sem mapeador.
//
// Só números e mecanismo lidos do Lua como dado e do comportamento descrito do C++ — nunca uma
// linha de nenhum dos dois reproduzida (ADR 0019 limite 1, ADR 0038 decisão 7).
//
// Dois campos dependem de PRs ainda abertas, e são preenchidos CONDICIONADOS ao schema da base:
// - `kind: 'melee' | 'combat'` (#682, PR #695): sai quando `monsterAbilitySchema` o declara;
// - a onda de monstro em `rows` (#679, PR #701): sai quando `spellAreaSchema` aceita `rows`.
//   Sem ele, a onda sai na forma `wave` antiga, que NÃO é a do Canary — TODO(#679).

import {
  damageOverTimeTotalMs, DRUNK_CONDITION_KEY, monsterAbilitySchema, SPEED_CONDITION_KEY,
  spellAreaSchema, type DamageOverTimeEffect,
} from '../../packages/content/src/schemas.js';
import { MIXED_TABLE_ITEMS_KEY, type LuaValue } from './lua-table.js';
import { meleePower, type MeleePowerVia } from './monster-melee.js';

/** O raio de agressão/visão do monstro do Canary (`MAP_MAX_VIEW_PORT_X`); ver `monsters.ts`. */
const CANARY_VIEW_RADIUS = 11;

/** O `interval` default de um `MonsterSpell` quando o Lua não declara. */
const DEFAULT_SPELL_INTERVAL_MS = 2000;

/** A duração default de `speed`/`drunk`/`outfit`/`invisible` em `deserializeSpell`. */
const DEFAULT_CONDITION_DURATION_MS = 10_000;

/** O tique default de uma condição de dano de monstro (`deserializeSpell`: `tickInterval = 2000`). */
const DEFAULT_CONDITION_TICK_MS = 2000;

/** `#682`: o schema da base declara `kind`? Sem ele, o campo não é escrito (strictObject). */
export const ABILITY_KIND_SUPPORTED = 'kind' in monsterAbilitySchema.shape;

/** `#679`: o schema da base aceita a forma `rows`? */
export const AREA_ROWS_SUPPORTED = spellAreaSchema.safeParse({ shape: 'rows', widths: [1] }).success;

type LuaRecord = { readonly [key: string]: LuaValue };

function isRecord(value: LuaValue | undefined): value is LuaRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: LuaValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function str(value: LuaValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A parte POSICIONAL de uma tabela: o array, ou o `$items` de uma tabela mista. */
export function positionalOf(value: LuaValue | undefined): readonly LuaValue[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    const items = value[MIXED_TABLE_ITEMS_KEY];
    if (Array.isArray(items)) return items;
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// Apresentação: constante do Canary → chave SEMÂNTICA (invariante 6).

/**
 * As chaves que o conteúdo autoral já usa com outro nome (`appearances.abilities`): o Dragon do
 * #520 chama o `CONST_ME_MAGIC_BLUE` de `blueshimmer`. O resto sai da regra de `presentationKey`.
 */
const PRESENTATION_KEY_ALIASES: Readonly<Record<string, string>> = {
  CONST_ME_MAGIC_BLUE: 'blueshimmer',
};

/**
 * A chave de apresentação de um `CONST_ME_*`/`CONST_ANI_*`: o sufixo em minúsculas, `_` → `-`
 * (`CONST_ANI_FIRE` → `fire`, `CONST_ME_FIREAREA` → `firearea`, `CONST_ME_MAGIC_RED` →
 * `magic-red`). `NONE`, `false` e ausente não têm chave. O id do pacote que a chave resolve mora
 * na tabela de aparências (`appearances.abilities`), que o #580 grava — o relatório lista o id do
 * Canary de cada chave usada.
 */
export function presentationKey(constant: LuaValue | undefined): string | undefined {
  const name = str(constant);
  if (name === undefined) return undefined;
  const alias = PRESENTATION_KEY_ALIASES[name];
  if (alias !== undefined) return alias;
  const match = /^CONST_(?:ME|ANI)_(.+)$/.exec(name);
  if (match === null || match[1] === 'NONE') return undefined;
  return (match[1] as string).toLowerCase().replace(/_/g, '-');
}

/** Uma chave usada, com a constante de origem — o relatório resolve o id por aqui. */
export interface PresentationUse {
  readonly key: string;
  readonly constant: string;
  readonly role: 'missile' | 'effect';
}

// ---------------------------------------------------------------------------------------------
// Geometria.

/**
 * As larguras por fileira da onda de monstro do Canary (`AreaCombat::setupArea(length, spread)`),
 * da mais PERTO (a fileira do `3`, ancorada um passo à frente) para a mais longe. `spread` 0 é o
 * raio reto, largura 1. Transcreve a CONTAGEM de tiles por fileira que o mecanismo produz, nunca
 * a matriz (ADR 0019): `length 8, spread 3` → `1, 1, 3, 3, 3, 5, 5, 5` — não o `1, 3, 3, 5, 5, …`
 * da `wave` antiga do Draconya.
 */
export function monsterWaveWidths(length: number, spread: number): number[] {
  const cols = spread === 0 ? 1 : ((length - (length % spread)) / spread) * 2 + 1;
  let colSpread = cols;
  const farToNear: number[] = [];
  for (let row = 1; row <= length; row += 1) {
    farToNear.push(colSpread - (cols - colSpread));
    if (spread > 0 && row % spread === 0) colSpread -= 1;
  }
  return farToNear.reverse();
}

/**
 * Até onde um círculo de monstro de raio `r` alcança a partir do centro, em Chebyshev — a tabela
 * de anéis do `AreaCombat::setupArea(radius)` (o raio 4 cobre até 2 tiles, o 8 até 6). Usado só
 * como ALCANCE de um círculo centrado no lançador sem `range` declarado.
 */
const MONSTER_RING_REACH = [0, 1, 1, 2, 3, 4, 5, 6];

function ringReach(radius: number): number {
  return MONSTER_RING_REACH[Math.min(radius, 8) - 1] ?? 0;
}

interface Geometry {
  readonly range: number;
  readonly area?: Record<string, unknown>;
  /** A forma do Canary cabe numa forma do Draconya que NÃO é a mesma — vira nota. */
  readonly approximation?: string;
}

/**
 * O alvo/área de uma entrada do Canary:
 * - `length` (> 0): onda/raio a partir do lançador, na direção do alvo; `spread` 0 é `beam`;
 * - `radius` (> 0): círculo, centrado no alvo com `target = true`, senão no lançador;
 * - nada: alvo único — o `doCombat(creature, target)` sem área do Canary, qualquer `target`.
 *
 * `range` 0 (ausente) no Canary é SEM limite além da vista (`sb.range != 0 && …`,
 * `Monster::canUseSpell`). O Draconya precisa de um número: o comprimento da onda/raio, o
 * alcance do anel para o círculo no lançador, e a vista (11) para o que mira o alvo.
 */
function geometryOf(raw: LuaRecord): Geometry | string {
  const length = num(raw['length']) ?? 0;
  const radius = num(raw['radius']) ?? 0;
  const declared = Math.min(num(raw['range']) ?? 0, CANARY_VIEW_RADIUS * 2);
  const targeted = raw['target'] === true;
  if (length > 0) {
    // `target = true` com `length`: o Canary centra a área DIRECIONAL no alvo (`castSpell` com
    // `needTarget`) — uma forma que o Draconya não tem (12 entradas no Canary).
    if (targeted) return 'onda/raio com target = true (área direcional centrada no alvo)';
    const spread = Math.max(0, num(raw['spread']) ?? 0);
    const range = declared > 0 ? declared : length;
    if (AREA_ROWS_SUPPORTED) {
      return { range, area: { shape: 'rows', widths: monsterWaveWidths(length, spread) } };
    }
    if (spread === 0) return { range, area: { shape: 'beam', length } };
    // TODO(#679): sem `rows` na base, a onda sai na `wave` antiga, com outra largura por fileira.
    return {
      range,
      area: { shape: 'wave', length },
      approximation: `onda length ${length} spread ${spread} → \`wave\` (TODO #679: rows ${monsterWaveWidths(length, spread).join(',')})`,
    };
  }
  if (radius > 0) {
    if (targeted) return { range: declared > 0 ? declared : CANARY_VIEW_RADIUS, area: { shape: 'circle', radius, centered: 'target' } };
    return { range: declared > 0 ? declared : Math.max(1, ringReach(radius)), area: { shape: 'circle', radius, centered: 'caster' } };
  }
  return { range: declared > 0 ? declared : CANARY_VIEW_RADIUS };
}

// ---------------------------------------------------------------------------------------------
// Tipos e condições.

/** `COMBAT_*` já resolvido pelo leitor (`monsters.ts`) → o `DamageType` do Draconya. */
const DRACONYA_DAMAGE_TYPES: ReadonlySet<string> = new Set([
  'physical', 'energy', 'earth', 'fire', 'ice', 'holy', 'death', 'drown', 'lifedrain', 'manadrain',
]);

/**
 * `CONDITION_*` de dano → a chave da condição e o elemento do Draconya (a tabela de
 * `docs/product/combat.md`, M31-02: `Combat::ConditionToDamageType`).
 */
export const DAMAGE_CONDITIONS: Readonly<Record<string, { readonly key: string; readonly damageType: string }>> = {
  CONDITION_POISON: { key: 'poisoned', damageType: 'earth' },
  CONDITION_FIRE: { key: 'burning', damageType: 'fire' },
  CONDITION_ENERGY: { key: 'electrified', damageType: 'energy' },
  CONDITION_BLEEDING: { key: 'bleeding', damageType: 'physical' },
  CONDITION_CURSED: { key: 'cursed', damageType: 'death' },
  CONDITION_DROWN: { key: 'drowning', damageType: 'drown' },
  CONDITION_FREEZING: { key: 'freezing', damageType: 'ice' },
  CONDITION_DAZZLED: { key: 'dazzled', damageType: 'holy' },
};

/**
 * A condição de dano de total FIXO, na forma `generated` (a lista decrescente do Canary; sem
 * `startDamage`, o default `max(1, ceil(total/20))` é o mesmo dos dois lados). `durationMs` é o
 * total da própria fila — no Canary os dois são o mesmo número (`setTicks(list × interval)`).
 */
function damageCondition(type: string, total: number, tickMs: number, startDamage?: number): Record<string, unknown> | string {
  const mapped = DAMAGE_CONDITIONS[type];
  if (mapped === undefined) return `condição sem mapeador: ${type}`;
  const effect: DamageOverTimeEffect = {
    kind: 'damage-over-time', form: 'generated', totalDamage: total, intervalMs: tickMs,
    damageType: mapped.damageType as DamageOverTimeEffect['damageType'],
    ...(startDamage === undefined ? {} : { startDamage }),
  };
  return { key: mapped.key, merge: 'strongest', durationMs: damageOverTimeTotalMs(effect), effect };
}

/**
 * A condição que `melee`/`combat` carregam em `condition = { type, totalDamage, interval }` — o
 * "combate que também envenena" (`readSpell`: `setConditionDamage(total, total, 0)`, total fixo).
 */
function attachedCondition(raw: LuaRecord): Record<string, unknown> | string | undefined {
  const condition = raw['condition'];
  if (!isRecord(condition)) return undefined;
  const type = str(condition['type']) ?? 'nil';
  const total = Math.abs(num(condition['totalDamage']) ?? 0);
  if (total === 0) return `condição ${type} sem totalDamage`;
  const tick = num(condition['interval']) ?? DEFAULT_CONDITION_TICK_MS;
  return damageCondition(type, total, tick);
}

// ---------------------------------------------------------------------------------------------
// Os mapeadores.

/** O resultado de UMA entrada. */
export type SpellMapping =
  | {
    readonly kind: 'ability'; readonly ability: Record<string, unknown>; readonly notes: readonly string[];
    /** Só no `melee`: de onde a faixa saiu (#684) — o relatório conta cada caso. */
    readonly meleeVia?: MeleePowerVia;
  }
  | { readonly kind: 'defense'; readonly defense: Record<string, unknown>; readonly notes: readonly string[] }
  /** O Canary não faz nada mecânico com o nome: descartado, com o motivo, e o monstro segue. */
  | { readonly kind: 'dropped'; readonly reason: string }
  /** Sem mapeador (ou mapeador que não cabe): o monstro NÃO é gerado. */
  | { readonly kind: 'unmapped'; readonly name: string; readonly reason: string };

export interface SpellContext {
  readonly monsterId: string;
  /** Onde a entrada está — o mesmo nome muda de sentido (a `speed` de ataque paralisa o alvo). */
  readonly list: 'attacks' | 'defenses';
  readonly presentation: PresentationUse[];
  /**
   * A constante existe no enum do Canary (`MagicEffectClasses`/`ShootType_t`)? Uma que não existe
   * é `nil` no Lua de verdade — sem efeito —, e não vira chave. Ausente: aceita toda constante.
   */
  readonly knownConstant?: (constant: string, role: 'missile' | 'effect') => boolean;
}

function unmapped(name: string, reason: string): SpellMapping {
  return { kind: 'unmapped', name, reason };
}

function cadence(raw: LuaRecord): number {
  const interval = num(raw['interval']) ?? DEFAULT_SPELL_INTERVAL_MS;
  return interval > 0 ? interval : DEFAULT_SPELL_INTERVAL_MS;
}

/** A chance do Lua (1–100, `std::min(chance, 100)`) como fração. Ausente é 100. */
function chanceOf(raw: LuaRecord): number {
  const chance = num(raw['chance']) ?? 100;
  return Math.min(Math.max(chance, 0), 100) / 100;
}

function presentationOf(raw: LuaRecord, ctx: SpellContext): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const read = (value: LuaValue | undefined, role: 'missile' | 'effect', field: 'missileKey' | 'impactKey'): void => {
    const constant = str(value);
    const key = presentationKey(value);
    if (constant === undefined || key === undefined) return;
    if (ctx.knownConstant !== undefined && !ctx.knownConstant(constant, role)) return;
    out[field] = key;
    ctx.presentation.push({ key, constant, role });
  };
  read(raw['shootEffect'] ?? raw['shooteffect'], 'missile', 'missileKey');
  read(raw['effect'], 'effect', 'impactKey');
  return Object.keys(out).length === 0 ? undefined : out;
}

function power(raw: LuaRecord): { min: number; max: number } {
  const a = Math.abs(num(raw['minDamage']) ?? 0);
  const b = Math.abs(num(raw['maxDamage']) ?? 0);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/**
 * Monta a ability na ordem de campos do conteúdo autoral (`dragon.json`), para o diff do gerado
 * contra o autoral ler limpo.
 */
function ability(fields: {
  id: string; cadenceMs: number; chance?: number; target: Geometry; power: { min: number; max: number } | number;
  damageType: string; kind?: 'melee' | 'combat'; presentation?: Record<string, string> | undefined;
  condition?: Record<string, unknown>; field?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    id: fields.id,
    cadenceMs: fields.cadenceMs,
    ...(fields.chance === undefined ? {} : { chance: fields.chance }),
    target: { range: fields.target.range, ...(fields.target.area === undefined ? {} : { area: fields.target.area }) },
    power: fields.power,
    damageType: fields.damageType,
    ...(fields.kind !== undefined && ABILITY_KIND_SUPPORTED ? { kind: fields.kind } : {}),
    ...(fields.presentation === undefined ? {} : { presentation: fields.presentation }),
    ...(fields.condition === undefined ? {} : { condition: fields.condition }),
    ...(fields.field === undefined ? {} : { field: fields.field }),
  };
}

/** O id da ability pela forma: `fire` + círculo no alvo = `fireball`, + onda = `firewave`. */
function shapeTag(geometry: Geometry): string {
  const area = geometry.area;
  if (area === undefined) return 'strike';
  switch (area['shape']) {
    case 'circle': return area['centered'] === 'caster' ? 'burst' : 'ball';
    case 'beam': return 'beam';
    case 'rows': return (area['widths'] as number[]).every((width) => width === 1) ? 'beam' : 'wave';
    default: return 'wave';
  }
}

/** `melee`: o golpe corpo a corpo. `chance` e `type` são IGNORADOS pelo Canary (`readSpell`). */
function mapMelee(raw: LuaRecord, ctx: SpellContext): SpellMapping {
  if (ctx.list === 'defenses') return unmapped('melee', 'melee em defenses');
  const notes: string[] = [];
  // A faixa, com a precedência e o arredondamento do Canary (#684): uma leitura só.
  const hit = meleePower(raw);
  if (raw['type'] !== undefined) notes.push('melee.type ignorado (o Canary não lê type em melee)');
  const condition = attachedCondition(raw);
  if (typeof condition === 'string') return unmapped('melee', condition);
  return {
    kind: 'ability',
    notes,
    meleeVia: hit.via,
    ability: ability({
      id: 'melee', cadenceMs: cadence(raw), target: { range: 1 }, power: { ...hit.power }, damageType: 'physical',
      kind: 'melee', presentation: presentationOf(raw, ctx), ...(condition === undefined ? {} : { condition }),
    }),
  };
}

/** `combat`: dano (ou cura, em `defenses`) de um tipo, com forma. */
function mapCombat(raw: LuaRecord, ctx: SpellContext): SpellMapping {
  const type = str(raw['type']) ?? 'nil';
  if (ctx.list === 'defenses') {
    if (type !== 'COMBAT_HEALING') return unmapped('combat', `combat ${type} em defenses (só cura é defesa)`);
    // Cura com `radius` > 1 cura TODA criatura na área, jogador inclusive; a defesa do Draconya
    // é cura PRÓPRIA.
    if ((num(raw['radius']) ?? 0) > 1 || (num(raw['length']) ?? 0) > 0) return unmapped('combat', 'cura em área (cura outras criaturas)');
    const heal = power(raw);
    const presentation = presentationOf(raw, ctx);
    return {
      kind: 'defense',
      notes: [],
      defense: {
        id: 'heal', cadenceMs: cadence(raw), chance: chanceOf(raw), heal,
        ...(presentation?.['impactKey'] === undefined ? {} : { presentation: { impactKey: presentation['impactKey'] } }),
      },
    };
  }
  if (!DRACONYA_DAMAGE_TYPES.has(type)) return unmapped('combat', `combat de tipo sem DamageType no Draconya: ${type}`);
  const geometry = geometryOf(raw);
  if (typeof geometry === 'string') return unmapped('combat', geometry);
  const condition = attachedCondition(raw);
  if (typeof condition === 'string') return unmapped('combat', condition);
  return {
    kind: 'ability',
    notes: geometry.approximation === undefined ? [] : [geometry.approximation],
    ability: ability({
      id: `${type}${shapeTag(geometry)}`, cadenceMs: cadence(raw), chance: chanceOf(raw), target: geometry,
      power: power(raw), damageType: type, kind: 'combat', presentation: presentationOf(raw, ctx),
      ...(condition === undefined ? {} : { condition }),
    }),
  };
}

/**
 * `speed`: paralisa (ataque, `speedChange` negativo) ou acelera (defesa). O `speedChange` é o
 * `delta` do Draconya sem conversão (CMB-11), com o piso `−1000` do `deserializeSpell`.
 */
function mapSpeed(raw: LuaRecord, ctx: SpellContext): SpellMapping {
  const speedChange = Math.max(num(raw['speedChange']) ?? 0, -1000);
  const durationMs = num(raw['duration']) || DEFAULT_CONDITION_DURATION_MS;
  const condition = {
    key: SPEED_CONDITION_KEY, merge: 'replace', durationMs,
    effect: { kind: 'speed', type: speedChange > 0 ? 'haste' : 'paralyze', delta: speedChange },
  };
  const presentation = presentationOf(raw, ctx);
  if (ctx.list === 'defenses') {
    if (speedChange <= 0) return unmapped('speed', 'speed de defesa sem speedChange positivo');
    return {
      kind: 'defense',
      notes: [],
      defense: {
        id: 'haste', cadenceMs: cadence(raw), chance: chanceOf(raw), condition,
        ...(presentation?.['impactKey'] === undefined ? {} : { presentation: { impactKey: presentation['impactKey'] } }),
      },
    };
  }
  const geometry = geometryOf(raw);
  if (typeof geometry === 'string') return unmapped('speed', geometry);
  return {
    kind: 'ability',
    notes: geometry.approximation === undefined ? [] : [geometry.approximation],
    ability: ability({
      id: speedChange > 0 ? 'haste' : 'paralyze', cadenceMs: cadence(raw), chance: chanceOf(raw), target: geometry,
      power: 0, damageType: 'physical', presentation, condition,
    }),
  };
}

/**
 * `condition`: só a condição de dano, sem golpe. `minDamage`/`maxDamage` são o TOTAL da condição
 * (`setConditionDamage`), e o Canary sorteia o total a cada aplicação (`ConditionDamage::init`,
 * `uniform_random(min, max)`) — o Draconya só tem total FIXO, então `min ≠ max` não mapeia.
 */
function mapCondition(raw: LuaRecord, ctx: SpellContext): SpellMapping {
  if (ctx.list === 'defenses') return unmapped('condition', 'condition em defenses');
  const type = str(raw['type']) ?? 'nil';
  const { min, max } = power(raw);
  // Sem dano, `ConditionDamage::init` não monta lista nenhuma e devolve `false`: a condição nunca
  // entra na criatura. Sobra só o efeito visual.
  if (max === 0) return { kind: 'dropped', reason: 'condition sem dano: só efeito visual (ConditionDamage::init sem lista)' };
  if (min !== max) return unmapped('condition', RANDOM_TOTAL_REASON);
  // `deserializeSpell`: `startDamage > minDamage` vira 0 (o default).
  const start = Math.abs(num(raw['startDamage']) ?? 0);
  const condition = damageCondition(type, max, DEFAULT_CONDITION_TICK_MS, start > 0 && start <= min ? start : undefined);
  if (typeof condition === 'string') return unmapped('condition', condition);
  const geometry = geometryOf(raw);
  if (typeof geometry === 'string') return unmapped('condition', geometry);
  const mapped = DAMAGE_CONDITIONS[type];
  return {
    kind: 'ability',
    notes: geometry.approximation === undefined ? [] : [geometry.approximation],
    ability: ability({
      id: mapped?.key ?? 'condition', cadenceMs: cadence(raw), chance: chanceOf(raw), target: geometry,
      power: 0, damageType: mapped?.damageType ?? 'physical', presentation: presentationOf(raw, ctx), condition,
    }),
  };
}

/** `drunk`: o desvio de passo (M31-03), `duration` default 10 s. */
function mapDrunk(raw: LuaRecord, ctx: SpellContext): SpellMapping {
  if (ctx.list === 'defenses') return unmapped('drunk', 'drunk em defenses');
  const geometry = geometryOf(raw);
  if (typeof geometry === 'string') return unmapped('drunk', geometry);
  return {
    kind: 'ability',
    notes: geometry.approximation === undefined ? [] : [geometry.approximation],
    ability: ability({
      id: 'drunk', cadenceMs: cadence(raw), chance: chanceOf(raw), target: geometry, power: 0, damageType: 'physical',
      presentation: presentationOf(raw, ctx),
      condition: {
        key: DRUNK_CONDITION_KEY, durationMs: num(raw['duration']) || DEFAULT_CONDITION_DURATION_MS,
        effect: { kind: 'drunk' },
      },
    }),
  };
}

/**
 * Os três campos que `deserializeSpell` cria (`COMBAT_PARAM_CREATEITEM`), com os números do
 * `items.xml` do Canary: duração do ITEM no chão e o dano do `field` (`ItemParse::
 * parseFieldCombatDamage` — `count`/`ticks`/`damage` viram rodadas iguais; `start` vira a lista
 * decrescente).
 *
 * `stages` (#591, fechando o TODO(#560) que este arquivo carregava): a cadeia `decayTo` real do
 * item, a MESMA que o Dragon Lord autoral já declara desde o #560 — agora emitida para TODO
 * monstro gerado que usa `firefield`/`poisonfield`/`energyfield`, não só ele. Só o fire field
 * tem cadeia de verdade no Canary (`items.xml:4212-4246`: 2118 dano20/200s → 2119 dano10/148s →
 * 2120 mudo/98s); poison (105) e energy (2122) têm `decayTo 0` DIRETO — um estágio só —, e
 * `stages` com um elemento é redundante com `durationMs`/`condition` do próprio `FieldSpec`
 * (`fieldStagesOf` normalizaria igual sem ele), mas é emitido explicitamente mesmo assim: um
 * consumidor que só lê `stages` (em vez de cair no fallback de `fieldStagesOf`) vê a cadeia real
 * dos três tipos, não só do fogo.
 */
export const CANARY_FIELD_ITEMS: Readonly<Record<string, {
  readonly itemId: number; readonly durationMs: number; readonly condition: Record<string, unknown>;
  readonly stages: readonly { readonly durationMs: number; readonly condition?: Record<string, unknown> }[];
}>> = {
  firefield: {
    itemId: 2118, durationMs: 200_000,
    condition: {
      key: 'burning', merge: 'strongest', durationMs: 70_000,
      effect: { kind: 'damage-over-time', form: 'rounds', rounds: [{ count: 7, intervalMs: 10_000, damage: 20 }], damageType: 'fire' },
    },
    stages: [
      {
        durationMs: 200_000,
        condition: {
          key: 'burning', merge: 'strongest', durationMs: 70_000,
          effect: { kind: 'damage-over-time', form: 'rounds', rounds: [{ count: 7, intervalMs: 10_000, damage: 20 }], damageType: 'fire' },
        },
      },
      {
        durationMs: 148_000,
        condition: {
          key: 'burning', merge: 'strongest', durationMs: 70_000,
          effect: { kind: 'damage-over-time', form: 'rounds', rounds: [{ count: 7, intervalMs: 10_000, damage: 10 }], damageType: 'fire' },
        },
      },
      { durationMs: 98_000 },
    ],
  },
  poisonfield: {
    itemId: 105, durationMs: 248_000,
    condition: damageCondition('CONDITION_POISON', 100, 5000, 5) as Record<string, unknown>,
    stages: [{ durationMs: 248_000, condition: damageCondition('CONDITION_POISON', 100, 5000, 5) as Record<string, unknown> }],
  },
  energyfield: {
    itemId: 2122, durationMs: 98_000,
    condition: {
      key: 'electrified', merge: 'strongest', durationMs: 10_000,
      effect: { kind: 'damage-over-time', form: 'rounds', rounds: [{ count: 1, intervalMs: 10_000, damage: 25 }], damageType: 'energy' },
    },
    stages: [{
      durationMs: 98_000,
      condition: {
        key: 'electrified', merge: 'strongest', durationMs: 10_000,
        effect: { kind: 'damage-over-time', form: 'rounds', rounds: [{ count: 1, intervalMs: 10_000, damage: 25 }], damageType: 'energy' },
      },
    }],
  },
};

/** `firefield`/`poisonfield`/`energyfield`: o campo no chão, centrado no alvo (CMB-07). */
function mapField(name: string, raw: LuaRecord, ctx: SpellContext): SpellMapping {
  const item = CANARY_FIELD_ITEMS[name];
  if (item === undefined || ctx.list === 'defenses') return unmapped(name, `${name} em ${ctx.list}`);
  if ((num(raw['length']) ?? 0) > 0) return unmapped(name, 'campo em onda (o campo do Draconya é só círculo)');
  // O `sim` centra o campo no ALVO principal (`#executeMonsterAbility`); o Canary sem `target`
  // cria o item em volta do lançador.
  if (raw['target'] !== true) return unmapped(name, 'campo centrado no lançador (o sim centra o campo no alvo)');
  const radius = Math.max(1, num(raw['radius']) ?? 1);
  const declared = num(raw['range']) ?? 0;
  const condition = item.condition;
  return {
    kind: 'ability',
    notes: [],
    ability: ability({
      id: name, cadenceMs: cadence(raw), chance: chanceOf(raw), target: { range: declared > 0 ? declared : CANARY_VIEW_RADIUS },
      power: 0, damageType: ((condition['effect'] as { damageType: string }).damageType), presentation: presentationOf(raw, ctx),
      field: {
        id: `${ctx.monsterId}-${name}`, durationMs: item.durationMs,
        shape: { shape: 'circle', radius, centered: 'target' }, condition, stages: item.stages,
      },
    }),
  };
}

/**
 * Nomes que o Canary lê e NÃO transformam em mecânica: `effect` e `strength` têm ramo vazio em
 * `deserializeSpell` (só o efeito visual), e `outfit` é a condição de aparência (#621) — nada
 * disso muda número de combate. Descartados com o motivo; o monstro segue.
 */
const PRESENTATION_ONLY: Readonly<Record<string, string>> = {
  effect: 'só efeito visual (ramo vazio em deserializeSpell)',
  strength: 'só efeito visual (ramo vazio em deserializeSpell)',
  outfit: 'condição de aparência, sem número de combate (#621)',
};

/** O motivo da `condition` de total sorteado — o relatório o usa para rever a meta. */
export const RANDOM_TOTAL_REASON = 'condition com total sorteado (min ≠ max): o schema só tem total fixo';

/** Nomes com mecanismo que o Draconya ainda não tem — e a issue dona. */
export const UNMAPPED_OWNERS: Readonly<Record<string, string>> = {
  invisible: '#559',
  fear: '#622',
  'soulwars fear': '#622',
  root: '#622',
};

/** Mapeia UMA entrada de `monster.attacks` ou `monster.defenses`. */
export function mapSpell(raw: LuaValue, ctx: SpellContext): SpellMapping {
  if (!isRecord(raw)) return unmapped('(linha sem tabela)', 'linha sem tabela');
  const name = str(raw['name']);
  if (name === undefined) {
    return str(raw['script']) === undefined
      ? unmapped('(sem nome)', 'entrada sem name')
      : unmapped(`script:${str(raw['script'])}`, 'magia por script');
  }
  switch (name) {
    case 'melee': return mapMelee(raw, ctx);
    case 'combat': return mapCombat(raw, ctx);
    case 'speed': return mapSpeed(raw, ctx);
    case 'condition': return mapCondition(raw, ctx);
    case 'drunk': return mapDrunk(raw, ctx);
    case 'firefield': case 'poisonfield': case 'energyfield': return mapField(name, raw, ctx);
    default: {
      const dropped = PRESENTATION_ONLY[name];
      if (dropped !== undefined) return { kind: 'dropped', reason: `${name}: ${dropped}` };
      const owner = UNMAPPED_OWNERS[name];
      // Qualquer outro nome é uma magia do `g_spells()` com nome próprio, definida em Lua
      // (`data-otservbr-global/scripts/spells/monster/`) — área e fórmula em script.
      return unmapped(name, owner === undefined ? 'magia com nome próprio (script Lua)' : `sem mecanismo (${owner})`);
    }
  }
}

/** Os ids ÚNICOS por monstro: o segundo `fireball` vira `fireball-2`. */
export function uniqueIds<T extends Record<string, unknown>>(entries: readonly T[]): T[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const id = String(entry['id']);
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    return count === 1 ? entry : { ...entry, id: `${id}-${count}` };
  });
}

// ---------------------------------------------------------------------------------------------
// Invocação.

export interface SummonMapping {
  readonly summons?: { readonly max: number; readonly entries: readonly Record<string, unknown>[] };
  /** Os ids invocados — o catálogo confere que cada um foi gerado. */
  readonly summonedIds: readonly string[];
  readonly problems: readonly string[];
}

/**
 * `monster.summon = { maxSummons, summons = { { name, interval, chance, count } } }`
 * (`registerMonsterType.summon` → `addSummon(name, interval, chance, count = 1)`). A chance é
 * 1–100 (`monsterSummonEntrySchema` guarda fração). `maxSummons` 0 é nenhuma invocação.
 */
export function mapSummons(raw: LuaValue | undefined, slug: (name: string) => string): SummonMapping {
  if (!isRecord(raw)) return { summonedIds: [], problems: [] };
  const max = num(raw['maxSummons']) ?? 0;
  const problems: string[] = [];
  const entries: Record<string, unknown>[] = [];
  for (const entry of positionalOf(raw['summons'])) {
    if (!isRecord(entry)) { problems.push('invocação sem tabela'); continue; }
    const name = str(entry['name']);
    if (name === undefined) { problems.push('invocação sem name'); continue; }
    const interval = num(entry['interval']) ?? 0;
    if (interval <= 0) { problems.push(`invocação ${name} sem interval`); continue; }
    entries.push({
      monsterId: slug(name),
      intervalMs: interval,
      chance: Math.min(Math.max(num(entry['chance']) ?? 0, 0), 100) / 100,
      count: Math.max(1, num(entry['count']) ?? 1),
    });
  }
  if (max <= 0 || entries.length === 0) return { summonedIds: [], problems };
  return { summons: { max, entries }, summonedIds: entries.map((entry) => String(entry['monsterId'])), problems };
}
