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
// **Ataque, defesa e invocação** passam pelos mapeadores de `monster-abilities.ts` (M35-02, #579).
//
// **O que fica de fora, e aparece no relatório** (`docs/reference/catalog/monsters-report.md`):
// monstro com ataque/defesa sem mapeador ou que invoca um monstro não gerado; aparência que o
// pacote 13.32 não desenha; e as pastas `trainers/` e `traps/`, que não são caça. A pasta
// `familiars/` entrou no #599 (M38-02): os quatro familiares de vocação, menos o do Monk.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { evaluateAssignments, MIXED_TABLE_ITEMS_KEY, type ConstantResolver, type LuaValue } from './lua-table.js';
import type { CatalogEntity, CatalogSource } from './generated-writer.js';
import { registerCatalogType, type CatalogImportContext, type CatalogImportResult } from './registry.js';
import type { SkippedEntity } from './report.js';
import { attrNumberOptional, attrOptional, readXmlFile } from './xml.js';
import {
  ABILITY_KIND_SUPPORTED, AREA_ROWS_SUPPORTED, mapSpell, mapSummons, RANDOM_TOTAL_REASON, uniqueIds,
  type PresentationUse,
} from './monster-abilities.js';
import type { MeleePowerVia } from './monster-melee.js';
import { extractEnum, MAGIC_EFFECT_ENUM, MAGIC_EFFECT_HEADER, SHOOT_TYPE_ENUM } from './enums.js';
import { repoRootFrom } from './env.js';
import { Reader, WIRE_LENGTH, WIRE_VARINT } from '../../packages/client/src/assets/protobuf.js';

/** A raiz dos monstros dentro do checkout do Canary. */
export const CANARY_MONSTER_ROOT = 'data-otservbr-global/monster';

/** `FAMILIAR_ID` — o `lookType` de cada familiar, por nome (#599). */
export const CANARY_FAMILIAR_LUA = 'data/libs/systems/familiar.lua';

/** `items.xml` — de onde sai o NOME de uma linha de loot declarada só por `id`. */
export const CANARY_ITEMS_XML = 'data/items/items.xml';

/**
 * `appearances.dat` do Canary — o MESMO arquivo que o servidor carrega para saber, por item,
 * `isCorpse`/`isMovable` (`items.cpp`: flags `corpse`/`player_corpse` e `unmove` da aparência). É de
 * onde sai a Animate Dead (#600): o `items.xml` não diz se um estágio do cadáver é movível.
 */
export const CANARY_APPEARANCES_DAT = 'data/items/appearances.dat';

/** A raiz dos monstros do TFS (a velocidade na escala clássica, ADR 0037 decisão 4). */
export const TFS_MONSTER_ROOT = 'data/monster';

/**
 * Pastas que não são caça: o Draconya nunca gera monstro delas. `familiars/` deixou de estar aqui
 * no #599 (M38-02, ADR 0057 d.3) — os familiares de vocação são invocação do jogador, e a magia os
 * lança pelo `monsterId`.
 */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['trainers', 'traps']);

/**
 * Monstros lidos e barrados por decisão de recorte, com o motivo que vai para o relatório. O Monk e
 * tudo que a ele pertence é mais novo que o pacote 13.32 (ADR 0051, decisão do dono de 2026-09-25 e
 * 2026-09-29): o familiar dele (`monk_familiar.lua`) converteria sem bloqueio nenhum, e por isso
 * precisa de uma linha explícita aqui — senão entraria no catálogo de graça.
 */
export const OUT_OF_CUT_MONSTERS: ReadonlyMap<string, string> = new Map([
  ['monk-familiar', 'vocação Monk fora do corte (ADR 0051: sistemas mais novos que o 13.32)'],
]);

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
 * `RARITY_*` (`BosstiaryRarity_t`, `src/io/io_bosstiary.hpp`) → a raridade do Bosstiary no
 * vocabulário do Draconya (`BOSSTIARY_RARITIES`, `packages/content/src/schemas.ts`, #629). O
 * `BOSS_INVALID` do Canary é só marcador de leitura do servidor e nenhum monstro o declara.
 */
export const BOSSTIARY_RARITY_CONSTANTS: Readonly<Record<string, string>> = {
  RARITY_BANE: 'bane', RARITY_ARCHFOE: 'archfoe', RARITY_NEMESIS: 'nemesis',
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
 * `FACTION_*` (`Faction_t`, `src/game/game_definitions.hpp:44-53`) → o nome da facção no
 * `MONSTER_FACTIONS` do conteúdo (#619). Resolvida para TEXTO direto no avaliador, como
 * `BESTY_RACE_*`: o número do enum só importa dentro do `sim` (o desempate do alvo), e lá ele é o
 * índice de `MONSTER_FACTIONS`. `FACTION_LAST` é sentinela do C++ e nenhum Lua a usa.
 */
export const FACTION_CONSTANTS: Readonly<Record<string, string>> = {
  FACTION_DEFAULT: 'default', FACTION_PLAYER: 'player', FACTION_LION: 'lion',
  FACTION_LIONUSURPERS: 'lion-usurpers', FACTION_MARID: 'marid', FACTION_EFREET: 'efreet',
  FACTION_DEEPLING: 'deepling', FACTION_DEATHLING: 'deathling', FACTION_ANUMA: 'anuma',
  FACTION_FAFNAR: 'fafnar',
};

/** Os nomes de facção que o conteúdo conhece — o que `FACTION_CONSTANTS` resolve. */
const KNOWN_FACTIONS: ReadonlySet<string> = new Set(Object.values(FACTION_CONSTANTS));

/**
 * O resolvedor de identificador para um `.lua` de monstro. `COMBAT_*`, `BESTY_RACE_*` e
 * `FACTION_*` saem como texto (tabelas acima); qualquer outro identificador em MAIÚSCULAS (`CONST_ME_*`,
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
      const faction = FACTION_CONSTANTS[name];
      if (faction !== undefined) return faction;
      const rarity = BOSSTIARY_RARITY_CONSTANTS[name];
      if (rarity !== undefined) return rarity;
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

/** Um estágio da cadeia de decaimento de UM item do `items.xml` (`durationSeconds` em SEGUNDOS,
 * como o próprio atributo `duration` — a conversão para ms é de quem soma a cadeia). */
export interface DecayStage {
  readonly durationSeconds: number;
  readonly decayTo?: number;
}

/**
 * `id → estágio de decaimento` de todo `<item id="…" duration="…">` do `items.xml` — a MESMA
 * árvore que `readItemNames` já abre, numa segunda passada (#585). Item sem `duration` não
 * decai e não entra no mapa: um `corpse` que aponte para ele produz cadeia de zero estágios,
 * não um estágio com duração 0.
 */
export function readCorpseDecayChains(itemsXmlPath: string): Map<number, DecayStage> {
  const root = readXmlFile(itemsXmlPath);
  const stages = new Map<number, DecayStage>();
  for (const item of root.children) {
    if (item.tag !== 'item') continue;
    const id = attrOptional(item, 'id');
    if (id === undefined) continue;
    let durationSeconds: number | undefined;
    let decayTo: number | undefined;
    for (const attribute of item.children) {
      if (attribute.tag !== 'attribute') continue;
      const key = attrOptional(attribute, 'key');
      if (key === 'duration') durationSeconds = attrNumberOptional(attribute, 'value');
      if (key === 'decayTo') decayTo = attrNumberOptional(attribute, 'value');
    }
    if (durationSeconds === undefined) continue;
    stages.set(Number(id), decayTo === undefined ? { durationSeconds } : { durationSeconds, decayTo });
  }
  return stages;
}

/** Limite de estágios ao seguir uma cadeia — nenhuma cadeia real do Canary chega perto disto;
 * só protege contra um `decayTo` que aponte de volta para um id já visitado. */
const MAX_DECAY_STAGES = 32;

/**
 * Soma, em MILISSEGUNDOS, a cadeia de decaimento a partir de `corpseId` até o último estágio
 * sem `decayTo` (ou com `decayTo === 0`) — `undefined` se `corpseId` não tem estágio nenhum
 * (monstro sem cadáver resolvível: sem `monster.corpse`, ou apontando para um id fora do
 * `items.xml`). `durationSeconds` é somado em segundos e só multiplicado por 1000 no final —
 * a mesma fórmula do Canary (`item.cpp`, `newDuration = it.decayTime * 1000`).
 */
export function corpseTtlMsFromChain(
  corpseId: number | undefined, chains: ReadonlyMap<number, DecayStage>,
): number | undefined {
  if (corpseId === undefined) return undefined;
  let current: number | undefined = corpseId;
  let totalSeconds = 0;
  const visited = new Set<number>();
  for (let step = 0; step < MAX_DECAY_STAGES; step += 1) {
    if (current === undefined || current === 0) break;
    if (visited.has(current)) return undefined;
    visited.add(current);
    const stage = chains.get(current);
    if (stage === undefined) return step === 0 ? undefined : totalSeconds * 1000;
    totalSeconds += stage.durationSeconds;
    current = stage.decayTo;
  }
  return totalSeconds > 0 ? totalSeconds * 1000 : undefined;
}

/**
 * Um item que o Canary trata como CADÁVER (`ItemType::isCorpse`): `movable` é `isMovable()`, o
 * inverso da flag `unmove`. Só entram os ids com a flag `corpse`/`player_corpse` (3.640 dos 42 mil
 * itens) — o resto nunca é consultado.
 */
export interface CorpseItemFlags {
  readonly movable: boolean;
}

/** Campos de `AppearanceFlags` (`appearances.proto` do Canary) que a Animate Dead consulta. */
const FLAG_UNMOVE = 14;
const FLAG_CORPSE = 42;
const FLAG_PLAYER_CORPSE = 43;

/**
 * `id → CorpseItemFlags` de todo objeto de `appearances.dat` com a flag de cadáver. Lê só os três
 * campos varint acima e PULA o resto por wire type — o mesmo cuidado do leitor do cliente
 * (`packages/client/src/assets/appearances.ts`), que é de onde vem o `Reader`. Arquivo ausente:
 * mapa vazio, e o monstro fica sem janela de Animate Dead (o `--check` avisa pelo diff, nunca
 * inventa um cadáver movível).
 */
export function readCorpseItemFlags(appearancesDatPath: string): Map<number, CorpseItemFlags> {
  const flags = new Map<number, CorpseItemFlags>();
  let bytes: Buffer;
  try {
    bytes = readFileSync(appearancesDatPath);
  } catch {
    return flags;
  }
  const reader = new Reader(bytes);
  while (!reader.done) {
    const { field, wire } = reader.tag();
    // `Appearances.object` (campo 1) — outfit/effect/missile têm outros números e nunca são item.
    if (field !== 1 || wire !== WIRE_LENGTH) { reader.skip(wire); continue; }
    const appearance = reader.slice();
    let id = 0;
    let corpse = false;
    let unmove = false;
    while (!appearance.done) {
      const tag = appearance.tag();
      if (tag.field === 1 && tag.wire === WIRE_VARINT) { id = appearance.varint(); continue; }
      if (tag.field === 3 && tag.wire === WIRE_LENGTH) {
        const appearanceFlags = appearance.slice();
        while (!appearanceFlags.done) {
          const flag = appearanceFlags.tag();
          if (flag.wire !== WIRE_VARINT) { appearanceFlags.skip(flag.wire); continue; }
          const value = appearanceFlags.varint() !== 0;
          if (flag.field === FLAG_CORPSE || flag.field === FLAG_PLAYER_CORPSE) corpse = corpse || value;
          if (flag.field === FLAG_UNMOVE) unmove = value;
        }
        continue;
      }
      appearance.skip(tag.wire);
    }
    if (id !== 0 && corpse) flags.set(id, { movable: !unmove });
  }
  return flags;
}

/**
 * As janelas, em ms desde a morte, em que o item de topo do cadáver É movível — o que a Animate
 * Dead do Canary exige (`animate_dead_rune.lua`: `isCorpse() and isMovable()`) (#600). Segue a MESMA
 * cadeia `duration`/`decayTo` de `corpseTtlMsFromChain`, estágio a estágio: cada estágio é um item
 * com as flags PRÓPRIAS (o recém-abatido é `unmove` e vira movível no primeiro decaimento). Estágios
 * movíveis contíguos viram UMA janela; `undefined` quando o monstro não tem cadáver resolvível ou
 * quando nenhum estágio é movível.
 */
export function corpseAnimatableWindows(
  corpseId: number | undefined,
  chains: ReadonlyMap<number, DecayStage>,
  flags: ReadonlyMap<number, CorpseItemFlags>,
): { readonly fromMs: number; readonly untilMs: number }[] | undefined {
  if (corpseId === undefined) return undefined;
  const windows: { fromMs: number; untilMs: number }[] = [];
  let current: number | undefined = corpseId;
  let elapsedSeconds = 0;
  const visited = new Set<number>();
  for (let step = 0; step < MAX_DECAY_STAGES; step += 1) {
    if (current === undefined || current === 0 || visited.has(current)) break;
    visited.add(current);
    const stage = chains.get(current);
    if (stage === undefined) break;
    const fromMs = elapsedSeconds * 1000;
    elapsedSeconds += stage.durationSeconds;
    if (flags.get(current)?.movable === true) {
      const last = windows[windows.length - 1];
      if (last !== undefined && last.untilMs === fromMs) last.untilMs = elapsedSeconds * 1000;
      else windows.push({ fromMs, untilMs: elapsedSeconds * 1000 });
    }
    current = stage.decayTo;
  }
  return windows.length === 0 ? undefined : windows;
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
  /** `CONST_ME_*` → id (`MagicEffectClasses`), só para o relatório resolver as chaves. */
  readonly effectIds: ReadonlyMap<string, number>;
  /** `CONST_ANI_*` → id (`ShootType_t`). */
  readonly missileIds: ReadonlyMap<string, number>;
  /** A cadeia de decaimento do `items.xml`, para `monster.corpse` virar `corpseTtlMs` (#585). */
  readonly corpseChains: ReadonlyMap<number, DecayStage>;
  /**
   * `nome do familiar → lookType` de `data/libs/systems/familiar.lua` (`FAMILIAR_ID`, #599). O Lua
   * do monstro deixa o `lookType` comentado — quem o define é a magia, na hora de invocar
   * (`myFamiliar:setOutfit`) —, e a tabela por vocação é a fonte dele. Ausente (fixture sem `data/`):
   * familiar sem aparência, e portanto bloqueado, como qualquer monstro sem `lookType`.
   */
  readonly familiarLooktypes?: ReadonlyMap<string, number>;
  /**
   * As flags de cadáver de `appearances.dat` (#600), para `monster.corpse` virar `corpseAnimatable`.
   * Ausente (fixture sem o `.dat`): monstro sem janela de Animate Dead.
   */
  readonly corpseFlags?: ReadonlyMap<number, CorpseItemFlags>;
}

/**
 * `nome → lookType` do `FAMILIAR_ID` do Canary (`data/libs/systems/familiar.lua`), lido como DADO: as
 * chaves da tabela são expressões (`VOCATION.BASE_ID.SORCERER`) que o avaliador de Lua literal não
 * resolve, então a leitura casa só os pares `{ id = N, name = "…" }` — números e nomes, nunca código
 * (ADR 0019 limite 1, ADR 0038 decisão 7).
 */
export function readFamiliarLooktypes(familiarLuaPath: string): Map<string, number> {
  const looktypes = new Map<string, number>();
  let text: string;
  try {
    text = readFileSync(familiarLuaPath, 'utf8');
  } catch {
    return looktypes;
  }
  for (const match of text.matchAll(/\{\s*id\s*=\s*(\d+)\s*,\s*name\s*=\s*"([^"]+)"\s*\}/g)) {
    looktypes.set(match[2] as string, Number(match[1]));
  }
  return looktypes;
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
  /** Entradas de ataque/defesa sem mapeador (M35-02) — cada uma bloqueia o monstro. */
  readonly unmappedSpells: readonly UnmappedSpell[];
  /** Entradas descartadas de propósito (só apresentação no Canary). */
  readonly droppedSpells: readonly string[];
  /** Forma do Canary aproximada por outra do Draconya (a onda sem `rows`, TODO #679). */
  readonly spellNotes: readonly string[];
  /** Chaves de apresentação usadas, com a constante de origem. */
  readonly presentation: readonly PresentationUse[];
  /** De onde saiu a faixa de cada `melee` do monstro (#684). */
  readonly meleeVia: readonly MeleePowerVia[];
  /** Os monstros que este invoca — o catálogo confere que cada um foi gerado. */
  readonly summonedIds: readonly string[];
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
  'name', 'description', 'experience', 'outfit', 'raceId', 'Bestiary', 'bosstiary', 'health', 'maxHealth',
  'race', 'speed', 'manaCost', 'changeTarget', 'strategiesTarget', 'flags', 'loot', 'attacks', 'defenses',
  'elements', 'immunities', 'summon', 'maxSummons', 'summons', 'critChance', 'corpse',
  'faction', 'enemyFactions',
]);

/** Campos que não entram NUNCA nesta issue, com o dono de cada um. */
const IGNORED_FIELD_OWNERS: Readonly<Record<string, string>> = {
  events: 'M44', voices: 'M44', light: 'M44',
  heals: '#683', reflects: '#683',
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

/** Um nome de ataque/defesa sem mapeador, e o motivo — vai para o relatório. */
export interface UnmappedSpell {
  readonly name: string;
  readonly reason: string;
}

interface SpellsResult {
  readonly abilities: Record<string, unknown>[];
  readonly defenses: Record<string, unknown>[];
  readonly unmapped: UnmappedSpell[];
  readonly dropped: string[];
  readonly notes: string[];
  readonly presentation: PresentationUse[];
  readonly meleeVia: MeleePowerVia[];
}

/**
 * `monster.attacks` e as magias de `monster.defenses` pelos mapeadores de
 * `monster-abilities.ts` (M35-02). A ordem da lista é a do Lua — ela é a ordem das rolagens.
 */
function readSpells(
  monsterId: string, attacks: readonly LuaValue[], defenses: readonly LuaValue[], deps: MonsterReaderDeps,
): SpellsResult {
  const result: SpellsResult = {
    abilities: [], defenses: [], unmapped: [], dropped: [], notes: [], presentation: [], meleeVia: [],
  };
  // Sem os enums (fixture sem `src/`), toda constante vale.
  const knownConstant = deps.effectIds.size === 0 || deps.missileIds.size === 0
    ? undefined
    : (constant: string, role: 'missile' | 'effect'): boolean => (role === 'missile' ? deps.missileIds : deps.effectIds).has(constant);
  for (const [list, entries] of [['attacks', attacks], ['defenses', defenses]] as const) {
    for (const raw of entries) {
      const mapped = mapSpell(raw, {
        monsterId, list, presentation: result.presentation, ...(knownConstant === undefined ? {} : { knownConstant }),
      });
      switch (mapped.kind) {
        case 'ability':
          result.abilities.push(mapped.ability);
          result.notes.push(...mapped.notes);
          if (mapped.meleeVia !== undefined) result.meleeVia.push(mapped.meleeVia);
          break;
        case 'defense': result.defenses.push(mapped.defense); result.notes.push(...mapped.notes); break;
        case 'dropped': result.dropped.push(mapped.reason); break;
        case 'unmapped': result.unmapped.push({ name: mapped.name, reason: mapped.reason }); break;
      }
    }
  }
  return {
    ...result,
    abilities: uniqueIds(result.abilities),
    defenses: uniqueIds(result.defenses),
  };
}

/**
 * O `melee` sozinho, sem nada além do que a ability básica do boot já sintetiza de `attack`/
 * `attackIntervalMs` — nesse caso `abilities` fica AUSENTE e o monstro vai pelo caminho legado,
 * bit a bit o de sempre (CMB-06).
 */
function isPlainMelee(abilities: readonly Record<string, unknown>[]): boolean {
  if (abilities.length !== 1) return false;
  const only = abilities[0] as Record<string, unknown>;
  return only['id'] === 'melee' && only['presentation'] === undefined && only['condition'] === undefined;
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
  /** Imunidade de CONDIÇÃO (#559, ADR 0041 decisão 2) que o schema reconhece hoje. */
  readonly conditionImmunities: string[];
  /** Imunidade de condição que o Lua declara mas o schema/sim ainda não modela (`outfit`, até o M44-03). */
  readonly unmatchedConditionImmunities: string[];
}

/**
 * O `type` do `immunities[].condition` do Canary → a chave de `monsterSchema.conditionImmunities`
 * (#559). É a tabela de `MonsterTypeFunctions::luaMonsterTypeConditionImmunities`
 * (`src/lua/functions/creatures/monster/monster_type_functions.cpp:915-968`): os nomes de ELEMENTO
 * (`fire`, `earth`, `ice`…) e `bleed` viram a imunidade à DOT que o elemento gera
 * (`Combat::DamageToConditionType`), com `poison`/`earth` e `physical`/`bleed` como sinônimos.
 * `invisible` aqui é `Monster::canSeeInvisibility` (ADR 0041 decisão 2: a imunidade À condição É o
 * que faz o monstro ENXERGAR quem a carrega, não o monstro resistir a ficar invisível). `outfit`
 * fica de fora — o schema não tem a condição até o M44-03 —, e entra em
 * `unmatchedConditionImmunities` para o relatório, nunca descartado em silêncio.
 */
const CONDITION_IMMUNITY_MAP: ReadonlyMap<string, string> = new Map<string, string>([
  ['paralyze', 'paralyze'], ['drunk', 'drunk'], ['invisible', 'invisible'], ['invisibility', 'invisible'],
  ['physical', 'bleeding'], ['bleed', 'bleeding'], ['energy', 'electrified'], ['fire', 'burning'],
  ['poison', 'poison'], ['earth', 'poison'], ['drown', 'drowning'], ['ice', 'freezing'],
  ['holy', 'dazzled'], ['death', 'cursed'],
]);

function readElements(elements: readonly LuaValue[], immunitiesRaw: readonly LuaValue[]): MitigationResult {
  const resistances: Record<string, number> = {};
  const immunities = new Set<string>();
  const clamped: string[] = [];
  const elementImmunities: string[] = [];
  const unmapped: string[] = [];
  const conditionImmunities = new Set<string>();
  const unmatchedConditionImmunities: string[] = [];
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
  // (paralyze, invisible, outfit, drunk, bleed, fire, ice) é imunidade de CONDIÇÃO (#559, ADR 0041 d.2) —
  // um monstro pode ter as DUAS entradas para o MESMO nome (ex. `poison`: dano E condição), então
  // as duas leituras seguem, sem `continue`/`else` entre si.
  for (const raw of immunitiesRaw) {
    if (!isRecord(raw)) continue;
    const type = str(raw['type']);
    if (type === undefined) continue;
    if (bool(raw['combat']) === true) {
      const damageType = type === 'poison' ? 'earth' : type;
      if (DRACONYA_DAMAGE_TYPES.has(damageType)) {
        immunities.add(damageType);
        delete resistances[damageType];
      }
    }
    if (bool(raw['condition']) === true) {
      const mapped = CONDITION_IMMUNITY_MAP.get(type);
      if (mapped !== undefined) conditionImmunities.add(mapped);
      else unmatchedConditionImmunities.push(type);
    }
  }
  return {
    resistances, immunities: [...immunities].sort(), clamped, elementImmunities, unmapped,
    conditionImmunities: [...conditionImmunities].sort(), unmatchedConditionImmunities: unmatchedConditionImmunities.sort(),
  };
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

/** O bloco `monster.bosstiary` de um boss do Canary (#629): a raridade e o `raceId` do contador. */
export interface BosstiaryDraft {
  readonly rarity: string;
  readonly raceId: number;
}

/**
 * `monster.bosstiary = { bossRaceId, bossRace }` (`register_monster_type.lua`, `bosstiary`). O
 * Canary recusa o boss SEM `bossRace` (`Attempting to register a bosstiary boss without a race`
 * — `mtype:bossRace` nunca roda, e o monstro não vira boss); sem `bossRaceId` ele registra a
 * raridade mas o `raceid` fica 0, e `IOBosstiary::addBosstiaryKill` devolve cedo com `bossId == 0`
 * — o boss nunca conta abate. Nos dois casos o que sai aqui é um bloqueio com o motivo, e nenhum
 * monstro do Canary 47dfd51 cai nele (os 249 declaram os dois campos).
 */
function readBosstiary(raw: LuaValue | undefined): BosstiaryDraft | string | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) return 'bosstiary não é uma tabela';
  // `RARITY_*` já saiu do avaliador como o texto do Draconya (`monsterConstants`).
  const rarity = str(raw['bossRace']);
  if (rarity === undefined || !(Object.values(BOSSTIARY_RARITY_CONSTANTS) as string[]).includes(rarity)) {
    return `raridade de Bosstiary desconhecida: ${rarity ?? 'nil'}`;
  }
  const raceId = num(raw['bossRaceId']);
  if (raceId === undefined || !Number.isInteger(raceId) || raceId <= 0) return 'bosstiary sem bossRaceId';
  return { rarity, raceId };
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
    unmappedSpells: [], droppedSpells: [], spellNotes: [], presentation: [], meleeVia: [], summonedIds: [],
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
  const outOfCut = OUT_OF_CUT_MONSTERS.get(id);
  if (outOfCut !== undefined) blockers.push(outOfCut);

  // Aparência: só outfit (`lookType`) do pacote 13.32. `lookTypeEx` é monstro desenhado como
  // ITEM, e a tabela de aparências do Draconya só resolve outfit para monstro.
  const outfit = isRecord(raw['outfit']) ? raw['outfit'] : {};
  const flagsForOutfit = isRecord(raw['flags']) ? raw['flags'] : {};
  // O familiar (#599) deixa o `lookType` comentado no Lua; a magia o define por vocação, e a
  // tabela `FAMILIAR_ID` é a fonte. `?? 0` no fim: sem a tabela, cai no bloqueio de sempre.
  const lookType = num(outfit['lookType'])
    ?? (bool(flagsForOutfit['familiar']) === true
      ? deps.familiarLooktypes?.get(str(raw['name']) ?? typeName)
      : undefined)
    ?? 0;
  const lookTypeEx = num(outfit['lookTypeEx']) ?? 0;
  if (lookType === 0) {
    blockers.push(lookTypeEx > 0 ? `aparência por item (lookTypeEx ${lookTypeEx}) — só outfit é resolvido` : 'sem aparência (lookType 0)');
  } else if (!inRanges(lookType, deps.outfitRanges)) {
    blockers.push(`outfit ${lookType} fora do pacote 13.32`);
  }

  const defensesRaw = raw['defenses'];
  const spells = readSpells(id, positionalOf(raw['attacks']), positionalOf(defensesRaw), deps);
  if (spells.unmapped.length > 0) {
    const reasons = [...new Set(spells.unmapped.map((spell) => `${spell.name} (${spell.reason})`))].sort();
    blockers.push(`sem mapeador: ${reasons.join(', ')}`);
  }
  const summons = mapSummons(raw['summon'], slugify);
  for (const problem of summons.problems) blockers.push(problem);
  const melee = spells.abilities.find((ability) => ability['id'] === 'melee');

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
  const bosstiary = readBosstiary(raw['bosstiary']);
  if (typeof bosstiary === 'string') blockers.push(bosstiary);

  const flags = isRecord(raw['flags']) ? raw['flags'] : {};
  const changeTarget = isRecord(raw['changeTarget']) ? raw['changeTarget'] : {};
  const strategies = isRecord(raw['strategiesTarget']) ? raw['strategiesTarget'] : {};

  const ignoredFields = Object.keys(raw)
    .filter((field) => !READ_FIELDS.has(field))
    .map((field) => `${field}${IGNORED_FIELD_OWNERS[field] === undefined ? '' : ` (${IGNORED_FIELD_OWNERS[field]})`}`)
    .sort();
  for (const key of [...loot.extraKeys].sort()) ignoredFields.push(`loot.${key}`);
  // #559: paralyze/drunk/invisible e as DOTs (bleed, fire, ice…) viram `conditionImmunities`; o
  // que o schema ainda não modela (`outfit`) entra individualmente — nunca a mensagem genérica
  // de antes, que escondia QUAL condição foi descartada.
  for (const unmatched of elements.unmatchedConditionImmunities) {
    ignoredFields.push(`immunities.condition.${unmatched} (sem imunidade de condição no schema)`);
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
    attack: (melee?.['power'] as { min: number; max: number } | undefined) ?? 0,
    armor: num(defenses['armor']) ?? 0,
    defense: num(defenses['defense']) ?? 0,
    damageType: 'physical',
    mitigation: { resistances: elements.resistances, immunities: elements.immunities },
    // #559: ausente é `[]`, o default do schema — só escreve quando o Lua de fato declara.
    ...(elements.conditionImmunities.length === 0 ? {} : { conditionImmunities: elements.conditionImmunities }),
    defenseMitigation: Math.min(Math.max(mitigationRaw, 0), 30),
    ...(num(raw['critChance']) === undefined ? {} : { critChance: num(raw['critChance']) }),
    canWalkOnFire: bool(flags['canWalkOnFire']) ?? true,
    canWalkOnPoison: bool(flags['canWalkOnPoison']) ?? true,
    canWalkOnEnergy: bool(flags['canWalkOnEnergy']) ?? true,
    attackIntervalMs: (melee?.['cadenceMs'] as number | undefined) ?? DEFAULT_ATTACK_INTERVAL_MS,
    speed: speed.speed,
    aggroRadius: CANARY_AGGRO_RADIUS,
    attackRange: 1,
    targetDistance: Math.max(1, num(flags['targetDistance']) ?? 1),
    blockable: bool(flags['isBlockable']) ?? false,
    loot: {
      // `rollModel: 'canary'` (#685): a tabela gerada rola do jeito do Canary — fator 95–105 %,
      // rolagem em cem-milésimos e quantidade da mesma rolagem (`rollCanaryLine`, `sim/loot.ts`).
      rollModel: 'canary',
      ...(loot.gold === undefined ? {} : { gold: loot.gold }),
      items: loot.items,
    },
    // As abilities declaradas (M35-02). O `melee` sozinho e simples fica AUSENTE: é exatamente a
    // básica que o boot sintetiza de `attack`/`attackIntervalMs` (CMB-06).
    ...(spells.abilities.length === 0 || isPlainMelee(spells.abilities) ? {} : { abilities: spells.abilities }),
    ...(spells.defenses.length === 0 ? {} : { defenses: spells.defenses }),
  };
  // O familiar (#599): `flags.familiar` liga o teleporte ao mestre, a XP inteira e a velocidade do
  // mestre; o `manaCost` (o do Lua, igual ao `spell:mana` da magia) fica no monstro para o boot
  // conferir que os dois batem. `summonable` NÃO sai: o Canary o declara `false` nos quatro, e é isso
  // que impede a Summon Creature de invocá-los.
  if (bool(flags['familiar']) === true) {
    entity['familiar'] = true;
    const manaCost = num(raw['manaCost']);
    if (manaCost !== undefined && manaCost > 0) entity['manaCost'] = manaCost;
  }
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
  // A facção (#619): `monster.faction` e `monster.enemyFactions`, os nomes de `MONSTER_FACTIONS`.
  // `default` (o valor de quem não declara) fica AUSENTE, e uma constante que o Canary não
  // conhece hoje (`FACTION_*` novo) é motivo para NÃO gerar — silenciar viraria um monstro que
  // ataca quem não devia.
  const faction = str(raw['faction']);
  if (faction !== undefined) {
    if (!KNOWN_FACTIONS.has(faction)) blockers.push(`facção desconhecida: ${faction}`);
    else if (faction !== 'default') entity['faction'] = faction;
  }
  const enemyFactions = [...new Set(positionalOf(raw['enemyFactions']).filter(
    (value): value is string => typeof value === 'string',
  ))];
  for (const enemy of enemyFactions) {
    if (!KNOWN_FACTIONS.has(enemy)) blockers.push(`facção inimiga desconhecida: ${enemy}`);
  }
  if (enemyFactions.length > 0) entity['enemyFactions'] = enemyFactions;
  if (melee === undefined && spells.abilities.length === 0 && spells.unmapped.length === 0) {
    entity['_open'] = 'Sem ataque no Canary: attack 0 e attackIntervalMs 2000 são o preenchimento do schema, não um número do Tibia.';
  }
  // A vida do cadáver (#585): a soma da cadeia `duration`/`decayTo` do `items.xml` a partir de
  // `monster.corpse` — ausente quando o monstro não declara `corpse`, ou quando o id não tem
  // estágio nenhum no `items.xml` (monstro fica sem cadáver, o default seguro).
  const corpseTtlMs = corpseTtlMsFromChain(num(raw['corpse']), deps.corpseChains);
  if (corpseTtlMs !== undefined) entity['corpseTtlMs'] = corpseTtlMs;
  // As janelas de Animate Dead (#600): as MESMAS etapas da cadeia acima, com a flag `movable` de
  // cada uma vinda de `appearances.dat`. Ausente é "nunca" — sem `.dat`, ou cadeia sem estágio
  // movível.
  const animatable = corpseAnimatableWindows(num(raw['corpse']), deps.corpseChains, deps.corpseFlags ?? new Map());
  if (animatable !== undefined) entity['corpseAnimatable'] = animatable;
  // A Convince Creature Rune (#600): `flags.convinceable`, e o custo dela é o `manaCost` do
  // monstro (`convince_creature.lua`) — lido para TODO monstro que o declara, `summonable` ou não.
  // `summonable` em si NÃO é importado aqui: a Summon Creature (#598) depende do teto e dos
  // efeitos de invocação que o #599 fecha, e ligá-la no catálogo real é decisão à parte.
  if (bool(flags['convinceable']) === true) entity['convinceable'] = true;
  const manaCost = num(raw['manaCost']);
  if (manaCost !== undefined && manaCost > 0) entity['manaCost'] = manaCost;
  entity['source'] = source;
  if (summons.summons !== undefined) entity['summons'] = summons.summons;
  // O boss (#629): `isBoss` do Canary é "tem bloco bosstiary", e o `boss: true` escolhe os rates de
  // boss e tira o monstro do Bestiário. Vai para `data/` como está — `bosstiary` é campo do
  // `monsterSchema`, ao contrário de `bestiary`/`outfitId`, que `promote-monsters` separa.
  if (typeof bosstiary === 'object') {
    entity['boss'] = true;
    entity['bosstiary'] = bosstiary;
  }
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
      unmappedSpells: spells.unmapped,
      droppedSpells: spells.dropped,
      spellNotes: spells.notes,
      presentation: spells.presentation,
      meleeVia: spells.meleeVia,
      summonedIds: summons.summonedIds,
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
  }
  // A invocação aponta monstro por id (`summons.entries[].monsterId`), e o boot recusa id que não
  // existe: quem invoca um monstro que não foi gerado também sai — até não sobrar nenhum (a
  // cadeia pode ter mais de um elo).
  const summonBlocked = new Map<string, string[]>();
  for (;;) {
    const ids = new Set(generated.map((monster) => monster.id));
    const orphan = generated.filter((monster) => monster.notes.summonedIds.some((summoned) => !ids.has(summoned)));
    if (orphan.length === 0) break;
    for (const monster of orphan) {
      const missing = monster.notes.summonedIds.filter((summoned) => !ids.has(summoned));
      summonBlocked.set(monster.id, missing);
      generated.splice(generated.indexOf(monster), 1);
      const name = typeof monster.entity['name'] === 'string' ? monster.entity['name'] : monster.id;
      skipped.push({ id: monster.id, name, reason: `invoca monstro não gerado: ${[...new Set(missing)].sort().join(', ')}`, source: monster.entity.source });
    }
  }
  for (const monster of generated) {
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
  notes.push(...spellNotes(converted, generated, summonBlocked, deps));

  return { slices, skipped, notes, converted };
}

/** A meta de cobertura do M35-02: fração dos monstros de caça importáveis que sai gerada. */
export const HUNT_COVERAGE_TARGET = 0.7;

/** O monstro é de CAÇA: tem ficha de Bestiário (boss e criatura de evento não têm). */
function isHunt(monster: ConvertedMonster): boolean {
  return typeof monster.entity['bestiary'] === 'object';
}

/**
 * Importável: nada o bloqueia além do mapeamento de ataque/defesa/invocação — a aparência está
 * no pacote, o loot resolve, tem vida e velocidade. É o denominador da meta do M35-02.
 */
function isImportable(monster: ConvertedMonster): boolean {
  return monster.blockers.every((blocker) => blocker.startsWith('sem mapeador:'));
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)} %`;
}

/**
 * A faixa do `melee` (#684), sobre os monstros LIDOS: quantas linhas saíram de `skill`/`attack`,
 * quantas de `minDamage`/`maxDamage`, e quem ficou com 0..0 — que é o que o Canary faz com o
 * `attack` ≤ 0 ou com um lado só da faixa, e por isso é gerado, não pulado.
 */
function meleeNote(converted: readonly ConvertedMonster[]): string {
  const vias = converted.flatMap((monster) => monster.notes.meleeVia);
  const count = (via: MeleePowerVia): number => vias.filter((entry) => entry === via).length;
  const zero = converted
    .filter((monster) => monster.notes.meleeVia.includes('none'))
    .map((monster) => `\`${monster.id}\``)
    .sort();
  return `Melee (#684, monstros lidos): ${count('skill-attack')} linha(s) por skill/attack `
    + '(`ceil(skill × attack × 0,05 + attack × 0,5)`, em `double` na ordem do Canary), '
    + `${count('min-max')} por minDamage/maxDamage, ${count('none')} com faixa 0..0 `
    + '(attack ≤ 0 ou só um lado da faixa, como no Canary): '
    + `${zero.join(', ') || 'nenhum'}.`;
}

/** As notas do M35-02: cobertura, nomes sem mapeador, descartes, aproximações e apresentação. */
function spellNotes(
  converted: readonly ConvertedMonster[], generated: readonly ConvertedMonster[],
  summonBlocked: ReadonlyMap<string, readonly string[]>, deps: MonsterReaderDeps,
): string[] {
  const notes: string[] = [];
  const generatedIds = new Set(generated.map((monster) => monster.id));
  const hunt = converted.filter(isHunt);
  const importable = hunt.filter(isImportable);
  const importableGenerated = importable.filter((monster) => generatedIds.has(monster.id));
  const ratio = importable.length === 0 ? 0 : importableGenerated.length / importable.length;
  notes.push(
    `Cobertura (M35-02): ${importableGenerated.length} de ${importable.length} monstros de caça importáveis gerados `
    + `(${percent(importableGenerated.length, importable.length)}; meta ${percent(HUNT_COVERAGE_TARGET, 1)}`
    + `${ratio >= HUNT_COVERAGE_TARGET ? ', atingida' : ', NÃO atingida'}). `
    + `Caça = tem ficha de Bestiário (${hunt.length} lidos); importável = nada o bloqueia além do mapeamento de `
    + 'ataque/defesa/invocação (aparência no pacote 13.32, loot resolvível, vida e velocidade).',
  );
  // Nome sem mapeador → monstros afetados (um monstro conta uma vez por nome).
  const byName = new Map<string, { monsters: Set<string>; reasons: Set<string> }>();
  for (const monster of converted) {
    for (const spell of monster.notes.unmappedSpells) {
      const entry = byName.get(spell.name) ?? { monsters: new Set<string>(), reasons: new Set<string>() };
      entry.monsters.add(monster.id);
      entry.reasons.add(spell.reason);
      byName.set(spell.name, entry);
    }
  }
  const rows = [...byName.entries()]
    .sort(([a, x], [b, y]) => y.monsters.size - x.monsters.size || a.localeCompare(b))
    .map(([name, entry]) => `\`${name}\` ${entry.monsters.size} (${[...entry.reasons].sort().join('; ')})`);
  notes.push(`Ataque/defesa sem mapeador — nome, monstros lidos afetados e motivo: ${rows.join(', ') || 'nenhum'}.`);
  const onlyBlocker = importable.filter((monster) => !generatedIds.has(monster.id) && !summonBlocked.has(monster.id));
  const soleNames: string[] = [];
  for (const monster of onlyBlocker) {
    soleNames.push(...new Set(monster.notes.unmappedSpells.map((spell) => spell.name)));
  }
  notes.push(
    `Entre os ${onlyBlocker.length} de caça importáveis que ficaram fora só pelo mapeamento, os nomes que os seguram: `
    + `${countBy(soleNames) || 'nenhum'}.`,
  );
  // A meta revista: quanto do que falta depende só de mecanismo que o Draconya ainda não tem
  // (a invisibilidade do #559 e o total de condição sorteado), e quanto é magia com nome próprio
  // — área e fórmula em script Lua, que um leitor de DADO não alcança.
  const mechanismOnly = onlyBlocker.filter((monster) => monster.notes.unmappedSpells.every(
    (spell) => spell.name === 'invisible' || spell.reason === RANDOM_TOTAL_REASON,
  ));
  const scripted = onlyBlocker.filter((monster) => monster.notes.unmappedSpells.some(
    (spell) => spell.reason === 'magia com nome próprio (script Lua)',
  ));
  if (ratio < HUNT_COVERAGE_TARGET) {
    notes.push(
      `Meta revista (M35-02): ${percent(importableGenerated.length, importable.length)} com os mapeadores de dado. `
      + `${mechanismOnly.length} dos que faltam dependem SÓ da invisibilidade (#559) e/ou do total de condição sorteado `
      + `(\`condition\` com min ≠ max, sem forma no schema) — com os dois, a cobertura iria a `
      + `${percent(importableGenerated.length + mechanismOnly.length, importable.length)}. ${scripted.length} usam alguma magia com `
      + 'nome próprio (script Lua em `data-otservbr-global/scripts/spells/monster/`), que precisa de um mapeador por magia. '
      + 'A meta de 70 % passa a valer depois do #559 e do total sorteado; até lá, a meta desta issue é a cobertura acima.',
    );
  }
  if (summonBlocked.size > 0) {
    notes.push(`Invocação de monstro não gerado (o monstro sai junto): ${[...summonBlocked.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, missing]) => `\`${id}\` → ${[...new Set(missing)].join(', ')}`).join('; ')}.`);
  }
  const summoners = generated.filter((monster) => monster.entity['summons'] !== undefined).map((monster) => `\`${monster.id}\``);
  notes.push(`Invocação gerada (\`summons\`): ${summoners.join(', ') || 'nenhuma'}.`);
  const dropped = generated.flatMap((monster) => monster.notes.droppedSpells);
  notes.push(`Descartado por ser só apresentação no Canary (monstros gerados): ${countBy(dropped) || 'nenhum'}.`);
  notes.push(meleeNote(converted));
  const approximated = generated.flatMap((monster) => monster.notes.spellNotes);
  notes.push(
    `Forma aproximada (monstros gerados): ${countBy(approximated) || 'nenhuma'}. `
    + `\`kind\` (#682) ${ABILITY_KIND_SUPPORTED ? 'preenchido' : 'NÃO preenchido — o schema desta base ainda não o declara; regenerar depois do #682'}; `
    + `onda em \`rows\` (#679) ${AREA_ROWS_SUPPORTED ? 'preenchida' : 'NÃO — o schema desta base não tem `rows`, e a onda de monstro sai na `wave` antiga (TODO #679)'}.`,
  );
  // Chave de apresentação → o id do Canary (`MagicEffectClasses`/`ShootType_t`): as linhas que o
  // #580 grava em `appearances.abilities`, conferidas contra o pacote lá.
  const keys = new Map<string, Set<string>>();
  for (const use of generated.flatMap((monster) => monster.notes.presentation)) {
    const id = use.role === 'missile' ? deps.missileIds.get(use.constant) : deps.effectIds.get(use.constant);
    const set = keys.get(use.key) ?? new Set<string>();
    set.add(`${use.role} ${id ?? '?'}`);
    keys.set(use.key, set);
  }
  notes.push(
    `Chaves de apresentação dos gerados (${keys.size}), com o id do Canary para \`appearances.abilities\` (#580): `
    + `${[...keys.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, ids]) => `\`${key}\` ${[...ids].sort().join('/')}`).join(', ') || 'nenhuma'}.`,
  );
  return notes;
}

/** Os dois enums de apresentação do Canary; sem o cabeçalho (fixture), mapas vazios. */
function readPresentationEnums(canaryDir: string): { effectIds: Map<string, number>; missileIds: Map<string, number> } {
  try {
    const header = readFileSync(join(canaryDir, MAGIC_EFFECT_HEADER), 'utf8');
    return { effectIds: extractEnum(header, MAGIC_EFFECT_ENUM), missileIds: extractEnum(header, SHOOT_TYPE_ENUM) };
  } catch {
    return { effectIds: new Map(), missileIds: new Map() };
  }
}

/** As entradas que o leitor busca fora do Lua, a partir do contexto e do repositório. */
export function loadReaderDeps(ctx: CatalogImportContext, repoRoot: string): MonsterReaderDeps {
  return {
    itemNames: readItemNames(join(ctx.canaryDir, CANARY_ITEMS_XML)),
    tfsSpeeds: ctx.forgottenServerCommit === '' ? new Map() : readTfsSpeeds(ctx.forgottenServerDir),
    outfitRanges: readPackOutfits(join(repoRoot, 'packages', 'content', 'data', 'packs', 'tibia-1533.json')),
    corpseChains: readCorpseDecayChains(join(ctx.canaryDir, CANARY_ITEMS_XML)),
    familiarLooktypes: readFamiliarLooktypes(join(ctx.canaryDir, CANARY_FAMILIAR_LUA)),
    corpseFlags: readCorpseItemFlags(join(ctx.canaryDir, CANARY_APPEARANCES_DAT)),
    ...readPresentationEnums(ctx.canaryDir),
  };
}

registerCatalogType({
  id: 'monsters',
  // Staging até o #580 — ver o cabeçalho deste arquivo.
  dataDir: 'packages/content/staging/monsters',
  run: (ctx) => readMonsterCatalog(ctx, loadReaderDeps(ctx, repoRootFrom(import.meta.url))),
});
