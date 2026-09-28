// scripts/catalog/spells.ts — o leitor de magias e runas do Canary (M37-08, #595; ADR 0037/0038).
//
//   pnpm catalog:import spells          # escreve packages/content/staging/spells/generated/*.json
//   pnpm catalog:import runes           # escreve packages/content/staging/runes/generated/*.json
//   pnpm catalog:import spells --check  # regenera em memória e compara
//
// Lê `data/scripts/spells/**/*.lua` e `data/scripts/runes/**/*.lua` como DADO — `spell-calls.ts`
// para a chamada de método (`spell:campo(args)`), `spell-formula.ts` para o reconhecedor
// estrutural de `onGetFormulaValues`, nunca executando Lua (ADR 0019 limite 1, ADR 0038 decisão
// 7). O que sai é metadado (nome, vocação, level, mana, cooldown, alcance) e, quando reconhecida,
// a fórmula canônica (`SpellFormula`) — nunca área, tipo de dano, apresentação, descrição ou
// `basePower`, que ficam para #596/#597 (ver o `docs/reference/catalog/spells-report.md` gerado).
//
// **Por que `staging/` e não `data/spells/generated/`.** As 82 magias e 20 supplies do #523 já
// existem como arquivo AUTORAL direto em `data/spells/*.json`/`data/supplies/*.json`, com os
// MESMOS ids que este leitor produziria — gerar direto em `data/spells/generated/` duplicaria o
// id e derrubaria o boot (`packages/content/CLAUDE.md`: "Id repetido entre autoral e gerado é
// erro no boot"). `monsters.ts`/`items.ts` resolveram o mesmo problema com `staging/` mais um
// `pnpm catalog:promote-*` que decide caso a caso; aqui a decisão fica para quando #596/#597
// migrarem o catálogo manual para `overrides/` + `generated/`.
//
// **O que fica de fora, e aparece no relatório** (`docs/reference/catalog/spells-report.md`):
// toda magia com `onGetFormulaValues` cuja assinatura ou corpo fogem das duas formas reconhecidas
// (RF-05) — Mass Healing (`CALLBACK_PARAM_TARGETCREATURE`) é o caso citado na issue. Magia sem
// fórmula nenhuma (utilitária, invocação, buff) não aparece — não é "fora do corte", é fora do
// que este leitor tenta extrair (ver `docs/reference/catalog/spells-report.md`, seção Notas).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import type { LuaValue } from './lua-table.js';
import { collectMethodCalls, parseSpellSource, spellReceiver } from './spell-calls.js';
import { recognizeFormula, toSpellFormula } from './spell-formula.js';
import type { CatalogEntity, CatalogSource } from './generated-writer.js';
import { registerCatalogType, type CatalogImportContext, type CatalogImportResult } from './registry.js';
import type { SkippedEntity } from './report.js';
import { slugify } from './monsters.js';

export const CANARY_SPELLS_ROOT = 'data/scripts/spells';
export const CANARY_RUNES_ROOT = 'data/scripts/runes';

/** Pastas que não são magia/runa de caça: utilitário de casa, sem mecânica de combate. */
const SKIPPED_SPELL_FOLDERS: ReadonlySet<string> = new Set(['house']);

/** `practise_*` — a variante de treino da mesma magia, sem custo nem cooldown reais. */
function isPractiseFile(fileName: string): boolean {
  return fileName.startsWith('practise_');
}

export type NormalizedVocation = 'knight' | 'paladin' | 'sorcerer' | 'druid';

const VOCATION_ALIASES: Readonly<Record<string, NormalizedVocation>> = {
  knight: 'knight', 'elite knight': 'knight',
  paladin: 'paladin', 'royal paladin': 'paladin',
  sorcerer: 'sorcerer', 'master sorcerer': 'sorcerer',
  druid: 'druid', 'elder druid': 'druid',
};

/**
 * `"knight;true"` → `"knight"`. `null` para Monk/Exalted Monk (o Draconya não modela a vocação) e
 * para qualquer nome desconhecido — o chamador decide o que fazer com `null` (nunca lançado, é
 * dado esperado: toda lista de vocação real tem pelo menos um nome que este mapa conhece, exceto
 * quando a magia é só de Monk).
 */
export function normalizeVocation(rawArg: string): NormalizedVocation | null {
  const name = (rawArg.split(';')[0] ?? '').trim().toLowerCase();
  return VOCATION_ALIASES[name] ?? null;
}

/** `"none"` — sem `;`, o Canary usa para "qualquer vocação lança" (`spell:vocation("none")`). */
function isNoRestriction(rawArgs: readonly string[]): boolean {
  return rawArgs.length === 1 && rawArgs[0]?.trim().toLowerCase() === 'none';
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

interface SpellFile {
  /** Caminho ABSOLUTO no checkout do Canary. */
  readonly absolutePath: string;
  /** Relativo ao checkout — o que vira `CatalogSource.path`. */
  readonly relativePath: string;
}

/** Os `.lua` de `spellsRoot`/`runesRoot`, sem `house/`, sem `practise_*`. */
export function listSpellFiles(canaryDir: string, root: string): SpellFile[] {
  const absoluteRoot = join(canaryDir, root);
  let paths: string[];
  try {
    paths = walk(absoluteRoot, '.lua');
  } catch {
    return [];
  }
  return paths
    .map((absolutePath) => ({ absolutePath, relativePath: relative(canaryDir, absolutePath).split(sep).join('/') }))
    .filter(({ relativePath }) => {
      const withinRoot = relativePath.slice(root.length + 1);
      const folder = withinRoot.split('/')[0] ?? '';
      if (SKIPPED_SPELL_FOLDERS.has(folder)) return false;
      return !isPractiseFile(basename(relativePath));
    });
}

/** As chamadas que este leitor entende — o resto (`isPremium`, `castSound`, …) fica fora do escopo. */
interface SpellMeta {
  readonly name?: string;
  readonly group?: string;
  readonly rawVocations: string[];
  readonly minLevel?: number;
  readonly manaCost?: number;
  readonly cooldownMs?: number;
  readonly groupCooldownMs?: number;
  readonly range?: number;
  readonly magicLevel?: number;
}

/**
 * Este leitor só consome argumento STRING/NÚMERO/BOOLEANO (nome, palavra, vocação, level, mana,
 * cooldown, alcance, `needTarget`, `magicLevel`, `charges`) — nunca uma constante como
 * `SOUND_EFFECT_TYPE_*`/`CONST_ME_*` (apresentação, fora do escopo desta task, seção 12 da spec).
 * Resolver toda constante desconhecida para o PRÓPRIO NOME (em vez de lançar, como
 * `lua-table.ts` faz para monstro) evita que um argumento de apresentação que este leitor
 * descarta derrube a leitura do arquivo inteiro.
 */
const CONSTANTS = { resolve: (name: string) => name };

function str(value: LuaValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: LuaValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function readMeta(calls: readonly { readonly method: string; readonly args: readonly LuaValue[] }[]): SpellMeta {
  let name: string | undefined;
  let group: string | undefined;
  const rawVocations: string[] = [];
  let minLevel: number | undefined;
  let manaCost: number | undefined;
  let cooldownMs: number | undefined;
  let groupCooldownMs: number | undefined;
  let range: number | undefined;
  let magicLevel: number | undefined;
  for (const call of calls) {
    switch (call.method) {
      case 'name': name = str(call.args[0]) ?? name; break;
      case 'group': group = str(call.args[0]) ?? group; break;
      case 'vocation': rawVocations.push(...call.args.map((a) => str(a)).filter((a): a is string => a !== undefined)); break;
      case 'level': minLevel = num(call.args[0]) ?? minLevel; break;
      case 'mana': manaCost = num(call.args[0]) ?? manaCost; break;
      case 'cooldown': cooldownMs = num(call.args[0]) ?? cooldownMs; break;
      case 'groupCooldown': groupCooldownMs = num(call.args[0]) ?? groupCooldownMs; break;
      case 'range': range = num(call.args[0]) ?? range; break;
      case 'magicLevel': magicLevel = num(call.args[0]) ?? magicLevel; break;
      default: break;
    }
  }
  return {
    rawVocations,
    ...(name === undefined ? {} : { name }),
    ...(group === undefined ? {} : { group }),
    ...(minLevel === undefined ? {} : { minLevel }),
    ...(manaCost === undefined ? {} : { manaCost }),
    ...(cooldownMs === undefined ? {} : { cooldownMs }),
    ...(groupCooldownMs === undefined ? {} : { groupCooldownMs }),
    ...(range === undefined ? {} : { range }),
    ...(magicLevel === undefined ? {} : { magicLevel }),
  };
}

/** As vocações NORMALIZADAS e sem repetição — `[]` é "qualquer vocação" (sem restrição/`none`). */
function normalizedVocations(rawVocations: readonly string[]): NormalizedVocation[] {
  if (rawVocations.length === 0 || isNoRestriction(rawVocations)) return [];
  const set = new Set<NormalizedVocation>();
  for (const raw of rawVocations) {
    const vocation = normalizeVocation(raw);
    if (vocation !== null) set.add(vocation);
  }
  return [...set];
}

interface SpellEntry {
  readonly file: SpellFile;
  readonly kind: 'instant' | 'rune';
  readonly meta: SpellMeta;
  /** `null`: sem fórmula (fora do que este leitor extrai) — nunca uma string aqui: motivo de
   * fórmula não reconhecida já virou `SkippedEntity` em `readAll` e não chega a `entries`. */
  readonly formula: Record<string, unknown> | null;
  readonly vocations: readonly NormalizedVocation[];
}

/** Lê e reconhece TODOS os arquivos dos dois roots — spells e runes juntos, uma passada só. */
function readAll(ctx: CatalogImportContext): { entries: SpellEntry[]; skipped: SkippedEntity[] } {
  const entries: SpellEntry[] = [];
  const skipped: SkippedEntity[] = [];
  const files = [
    ...listSpellFiles(ctx.canaryDir, CANARY_SPELLS_ROOT),
    ...listSpellFiles(ctx.canaryDir, CANARY_RUNES_ROOT),
  ];
  for (const file of files) {
    const source = readFileSync(file.absolutePath, 'utf8');
    let chunk;
    try {
      chunk = parseSpellSource(source);
    } catch (error) {
      skipped.push({
        id: file.relativePath, name: file.relativePath, reason: `erro de sintaxe Lua: ${(error as Error).message}`,
        source: fileSource(ctx, file.relativePath),
      });
      continue;
    }
    const receiver = spellReceiver(chunk);
    if (receiver === null) continue; // sem Spell(...) reconhecível — fora do escopo deste leitor, sem entrada no relatório
    const kind = receiver.kind === 'rune' ? 'rune' : 'instant';
    const calls = collectMethodCalls(chunk, receiver.receiver, CONSTANTS);
    const meta = readMeta(calls);
    const vocations = normalizedVocations(meta.rawVocations);
    if (meta.rawVocations.length > 0 && vocations.length === 0 && !isNoRestriction(meta.rawVocations)) {
      continue; // só Monk (ou vocação desconhecida) — fora de escopo do jogo, não fora do corte
    }
    const recognized = recognizeFormula(chunk);
    let formula: Record<string, unknown> | null | string;
    if (recognized === null || typeof recognized === 'string') {
      formula = recognized;
    } else {
      try {
        formula = toSpellFormula(recognized);
      } catch (error) {
        formula = (error as Error).message;
      }
    }
    if (typeof formula === 'string') {
      skipped.push({
        id: meta.name ?? file.relativePath, name: meta.name ?? file.relativePath, reason: formula,
        source: fileSource(ctx, file.relativePath),
      });
      continue;
    }
    entries.push({ file, kind, meta, formula, vocations });
  }
  return { entries, skipped };
}

function fileSource(ctx: CatalogImportContext, path: string): CatalogSource {
  return { engine: 'canary', commit: ctx.canaryCommit, path };
}

/** `'heal'` para o grupo `healing`; `'damage'` para todo o resto (attack/support com fórmula). */
function effectKind(meta: SpellMeta): 'heal' | 'damage' {
  return meta.group === 'healing' ? 'heal' : 'damage';
}

/**
 * Magia (`spellSchema`): exige `manaCost`/`cooldownMs`, como o schema. Runa (`supplySchema`): não
 * tem `manaCost` (o custo é `price`, gold — não extraível daqui, ADR 0032 d.7) nem `minLevel`
 * (é `requires.level`/`requires.magicLevel`); o extrator devolve o que TEM — id, nome, fórmula,
 * `magicLevel` — e o resto (`price`, `requires`) fica para a montagem manual (fora do escopo,
 * seção 12 da spec).
 */
function buildEntity(
  entry: SpellEntry, vocation: NormalizedVocation | undefined, id: string, ctx: CatalogImportContext,
): CatalogEntity | null {
  const { meta, formula } = entry;
  if (formula === null) return null;
  if (meta.name === undefined) return null;
  const kind = effectKind(meta);
  const source = fileSource(ctx, entry.file.relativePath);
  if (entry.kind === 'rune') {
    // A runa escala SEMPRE pelo magic level (`supplySchema`, comentário de `damage`/`heal`) —
    // `scaling: 'magic'` é redundante aqui (só distingue magia de vocação `melee`/`distance`, que
    // runa não tem), e as 8 runas do #523 com fórmula reconhecida o omitem. Descartar o campo
    // deixa a saída bit a bit igual à transcrição manual.
    const { scaling: _scaling, ...runeFormula } = formula;
    const effect: Record<string, unknown> = { kind, formula: runeFormula };
    if (meta.range !== undefined) effect['range'] = meta.range;
    return {
      id, name: meta.name,
      ...(meta.magicLevel === undefined ? {} : { magicLevel: meta.magicLevel }),
      ...(vocation === undefined ? {} : { vocationId: vocation }),
      ...(meta.group === undefined ? {} : { group: meta.group }),
      ...(meta.groupCooldownMs === undefined ? {} : { groupCooldownMs: meta.groupCooldownMs }),
      effect, source,
    };
  }
  if (meta.manaCost === undefined || meta.cooldownMs === undefined) return null;
  const effect: Record<string, unknown> = { kind, formula };
  if (meta.range !== undefined) effect['range'] = meta.range;
  return {
    id, name: meta.name, manaCost: meta.manaCost, cooldownMs: meta.cooldownMs,
    ...(meta.minLevel === undefined ? {} : { minLevel: meta.minLevel }),
    ...(vocation === undefined ? {} : { vocationId: vocation }),
    ...(meta.group === undefined ? {} : { group: meta.group }),
    ...(meta.groupCooldownMs === undefined ? {} : { groupCooldownMs: meta.groupCooldownMs }),
    effect, source,
  };
}

/** Uma entidade por VOCAÇÃO quando há mais de uma (o mesmo arquivo do Canary vale para várias —
 * `vocationId` é campo singular no schema, `flame-strike-sorcerer`/`flame-strike-druid`); id sem
 * sufixo quando há só uma, ou nenhuma (magia sem restrição). */
function expand(entry: SpellEntry, ctx: CatalogImportContext): Map<string, CatalogEntity[]> {
  const slices = new Map<string, CatalogEntity[]>();
  const base = entry.meta.name === undefined ? undefined : slugify(entry.meta.name);
  if (base === undefined) return slices;
  const targets = entry.vocations.length === 0 ? [undefined] : entry.vocations;
  for (const vocation of targets) {
    const id = entry.vocations.length > 1 && vocation !== undefined ? `${base}-${vocation}` : base;
    const entity = buildEntity(entry, vocation, id, ctx);
    if (entity === null) continue;
    const slice = vocation ?? 'general';
    slices.set(slice, [...(slices.get(slice) ?? []), entity]);
  }
  return slices;
}

function runFor(kind: 'instant' | 'rune'): (ctx: CatalogImportContext) => CatalogImportResult {
  return (ctx) => {
    const { entries, skipped } = readAll(ctx);
    const slices = new Map<string, CatalogEntity[]>();
    for (const entry of entries) {
      if (entry.kind !== kind) continue;
      for (const [slice, entities] of expand(entry, ctx)) {
        slices.set(slice, [...(slices.get(slice) ?? []), ...entities]);
      }
    }
    // `skipped` é reportado uma vez só, no tipo "spells" — repeti-lo em "runes" duplicaria a
    // mesma linha nos dois relatórios, já que `readAll` lê os dois roots juntos.
    return { slices, skipped: kind === 'instant' ? skipped : [] };
  };
}

registerCatalogType({ id: 'spells', dataDir: 'packages/content/staging/spells', run: runFor('instant') });
registerCatalogType({ id: 'runes', dataDir: 'packages/content/staging/runes', run: runFor('rune') });
