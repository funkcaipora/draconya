// scripts/catalog/spell-prices.ts — o leitor de preço de magia dos NPCs do Canary (M44-06, #624;
// ADR 0037/0038/0058).
//
//   pnpm catalog:spell-prices          # regrava learnPrice em data/spells/*.json
//   pnpm catalog:spell-prices --check  # regenera em memória e compara, não escreve nada
//
// Lê `data-otservbr-global/npc/*.lua` como DADO (`luaparse` só analisa a sintaxe; nada é
// executado — ADR 0019 limite 1, ADR 0038 decisão 7) e coleta toda chamada
// `StdModule.learnSpell` — o "aprender magia por gold" do Tibia: `spellName`, `vocation` (ids
// numéricos do Canary, 1–10), `price` e `premium`. Uma magia é vendida por vários NPCs (um por
// cidade), e o preço que o Draconya adota é o MENOR entre os que a ensinam à vocação dela — a
// mesma regra de `npc-prices.ts` para o preço de suprimento (ADR 0038 decisão 6, ADR 0058 d.3).
//
// **Ligação magia ↔ Canary é o NOME.** `Player::hasLearnedInstantSpell` compara o nome sem
// diferenciar caixa (`strcasecmp`), e é o que este leitor faz: `spell.name` do Draconya contra
// `spellName` do NPC, em minúsculas. O id do arquivo autoral (`haste-druid`) NÃO é o nome: uma
// magia de duas vocações tem dois arquivos e o mesmo nome (`Haste`), e é a vocação que separa.
//
// **A vocação do NPC vira a vocação BASE.** `vocation = { 1, 5 }` é Sorcerer e Master Sorcerer;
// o Draconya modela a promoção como estado, não como outra vocação (ADR 0042), então 5–8 caem em
// 1–4 (`baseid` de `data/XML/vocations.xml`). 9–10 (Monk) ficam de fora: o jogo não modela a
// vocação (ADR 0051).
//
// **`premium` NÃO entra.** O `premium = true` do NPC só troca a mensagem de recusa para conta
// gratuita; o Draconya não tem conta gratuita para magia (o plano de conta é decidido em outro
// lugar), então o preço vale igual.
//
// **Só literal.** Um `price`/`spellName`/`vocation` que não seja literal (identificador, chamada)
// NÃO vira zero em silêncio: a entrada vai para `unresolved` no relatório, e o script termina
// com código de erro em `--check` se sobrar alguma que afete uma magia real.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as luaparse from 'luaparse';
import type { CallExpression, Chunk } from 'luaparse';
import {
  evaluateExpression, LuaEvalError, type ConstantResolver, type LuaValue,
} from './lua-table.js';
import { CANARY_NPC_DIR } from './npc-prices.js';
import type { CatalogImportContext } from './registry.js';

export type BaseVocation = 'sorcerer' | 'druid' | 'paladin' | 'knight';

/**
 * Id de vocação do Canary (`data/XML/vocations.xml`) → vocação base do Draconya. `9`/`10` (Monk,
 * Exalted Monk) ficam de fora de propósito: o jogo não modela a vocação (ADR 0051).
 */
export const CANARY_VOCATION_BASE: Readonly<Record<number, BaseVocation>> = {
  1: 'sorcerer', 5: 'sorcerer',
  2: 'druid', 6: 'druid',
  3: 'paladin', 7: 'paladin',
  4: 'knight', 8: 'knight',
};

/** Uma chamada `StdModule.learnSpell` de um NPC — o que ele ensina, a quem, e por quanto. */
export interface SpellTeaching {
  /** O nome como o NPC escreve (`"apprentice's strike"`). */
  readonly spellName: string;
  /** As vocações BASE a quem se ensina; vazio é "só Monk" (fora do corte). */
  readonly vocations: readonly BaseVocation[];
  readonly price: number;
  readonly premium: boolean;
  readonly npcFile: string;
}

export interface UnresolvedTeaching {
  readonly file: string;
  readonly reason: string;
}

export interface SpellTeachingAggregate {
  readonly teachings: readonly SpellTeaching[];
  readonly npcFilesRead: number;
  readonly npcFilesTeaching: number;
  readonly unresolved: readonly UnresolvedTeaching[];
}

/**
 * Só `npcHandler = npcHandler` é identificador nas chamadas reais, e seu valor nunca é lido —
 * resolve para `0` só para a tabela inteira avaliar. QUALQUER outro identificador é
 * desconhecido e derruba a entrada (`LuaEvalError`), nunca vira `0`.
 */
const HANDLER_ONLY: ConstantResolver = {
  resolve: (name) => (name === 'npcHandler' ? 0 : undefined),
};

/** Percorre a AST inteira (a chamada mora tanto no topo quanto dentro de bloco). */
function visit(node: unknown, onCall: (call: CallExpression) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) visit(child, onCall);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const record = node as { readonly type?: string } & Record<string, unknown>;
  if (record.type === 'CallExpression') onCall(node as CallExpression);
  for (const [key, value] of Object.entries(record)) {
    if (key === 'loc' || key === 'range') continue;
    visit(value, onCall);
  }
}

function isLearnSpellMember(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  const member = node as { type?: string; base?: { type?: string; name?: string }; identifier?: { name?: string } };
  return member.type === 'MemberExpression'
    && member.base?.type === 'Identifier' && member.base.name === 'StdModule'
    && member.identifier?.name === 'learnSpell';
}

function baseVocationsOf(value: LuaValue | undefined): readonly BaseVocation[] | null {
  if (!Array.isArray(value)) return null;
  const bases = new Set<BaseVocation>();
  for (const id of value) {
    if (typeof id !== 'number') return null;
    const base = CANARY_VOCATION_BASE[id];
    if (base !== undefined) bases.add(base);
  }
  return [...bases];
}

/** As chamadas `StdModule.learnSpell` de UM arquivo de NPC, ou o motivo de não ter lido alguma. */
export function readTeachingsFromSource(
  source: string, npcFile: string,
): { readonly teachings: SpellTeaching[]; readonly unresolved: UnresolvedTeaching[] } {
  const teachings: SpellTeaching[] = [];
  const unresolved: UnresolvedTeaching[] = [];
  let chunk: Chunk;
  try {
    chunk = luaparse.parse(source, { luaVersion: 'LuaJIT', locations: true, encodingMode: 'pseudo-latin1' });
  } catch (error) {
    return { teachings, unresolved: [{ file: npcFile, reason: `erro de sintaxe Lua: ${(error as Error).message}` }] };
  }
  visit(chunk, (call) => {
    // `node:addChildKeyword({ "yes" }, StdModule.learnSpell, { ... })`: a tabela é o argumento
    // logo depois do `StdModule.learnSpell`, sem depender da posição fixa dele.
    const index = call.arguments.findIndex((argument) => isLearnSpellMember(argument));
    if (index === -1) return;
    const table = call.arguments[index + 1];
    if (table === undefined || table.type !== 'TableConstructorExpression') {
      unresolved.push({ file: npcFile, reason: 'StdModule.learnSpell sem tabela literal de parâmetros' });
      return;
    }
    let parameters: LuaValue;
    try {
      parameters = evaluateExpression(table, HANDLER_ONLY);
    } catch (error) {
      const reason = error instanceof LuaEvalError ? error.message : (error as Error).message;
      unresolved.push({ file: npcFile, reason });
      return;
    }
    if (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters)) {
      unresolved.push({ file: npcFile, reason: 'parâmetros de StdModule.learnSpell não são uma tabela nomeada' });
      return;
    }
    const record = parameters as Record<string, LuaValue>;
    const spellName = record['spellName'];
    const price = record['price'];
    const vocations = baseVocationsOf(record['vocation']);
    if (typeof spellName !== 'string' || typeof price !== 'number' || vocations === null) {
      unresolved.push({
        file: npcFile, reason: 'spellName/price/vocation não literais em StdModule.learnSpell',
      });
      return;
    }
    teachings.push({
      spellName, vocations, price, premium: record['premium'] === true, npcFile,
    });
  });
  return { teachings, unresolved };
}

/** Lê TODO `data-otservbr-global/npc/*.lua` e coleta cada `StdModule.learnSpell`. */
export function readSpellTeachings(ctx: CatalogImportContext): SpellTeachingAggregate {
  const dir = join(ctx.canaryDir, CANARY_NPC_DIR);
  const files = readdirSync(dir).filter((file) => file.endsWith('.lua')).sort();
  const teachings: SpellTeaching[] = [];
  const unresolved: UnresolvedTeaching[] = [];
  let filesTeaching = 0;
  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf8');
    // Filtro barato antes do parse: 51 dos ~1000 arquivos ensinam magia.
    if (!source.includes('StdModule.learnSpell')) continue;
    const read = readTeachingsFromSource(source, file);
    if (read.teachings.length > 0) filesTeaching += 1;
    teachings.push(...read.teachings);
    unresolved.push(...read.unresolved);
  }
  return { teachings, npcFilesRead: files.length, npcFilesTeaching: filesTeaching, unresolved };
}

/** O menor preço entre os NPCs que ensinam ESTA magia a ESTA vocação, e quem o cobra. */
export interface LearnPriceObservation {
  readonly price: number;
  readonly npcFile: string;
  /** Quantos NPCs ensinam a magia à vocação (o relatório mostra quando o preço varia). */
  readonly teachers: number;
  /** Os preços distintos vistos, do menor ao maior — mais de um é divergência entre NPCs. */
  readonly prices: readonly number[];
}

/**
 * O preço de aprender `spellName` para `vocationId` (ausente: qualquer vocação de qualquer NPC,
 * como `cure poison`, que o `vocationId` do Draconya não restringe).
 */
export function learnPriceOf(
  teachings: readonly SpellTeaching[], spellName: string, vocationId: string | undefined,
): LearnPriceObservation | null {
  const key = spellName.toLowerCase();
  const matching = teachings.filter((teaching) =>
    teaching.spellName.toLowerCase() === key
    && (vocationId === undefined || (teaching.vocations as readonly string[]).includes(vocationId)));
  if (matching.length === 0) return null;
  const lowest = matching.reduce((best, teaching) => (teaching.price < best.price ? teaching : best));
  const prices = [...new Set(matching.map((teaching) => teaching.price))].sort((a, b) => a - b);
  return { price: lowest.price, npcFile: lowest.npcFile, teachers: matching.length, prices };
}

// -------------------------------------------------------------------------------------------
// Aplicação nos arquivos autorais de magia (`packages/content/data/spells/*.json`).

export interface LearnPriceChange {
  readonly path: string;
  readonly slug: string;
  readonly oldPrice: number | null;
  readonly newPrice: number;
  readonly source: LearnPriceObservation;
}

export interface SpellPriceResolution {
  readonly slug: string;
  readonly name: string;
  readonly vocationId: string | undefined;
  readonly observation: LearnPriceObservation | null;
  /** O preço que o arquivo já traz (autoral com fonte externa, ou o já importado). */
  readonly currentPrice: number | null;
}

const LEARN_PRICE_FIELD = /^ {2}"learnPrice":\s*-?\d+(\.\d+)?,\r?\n/m;
const MANA_COST_FIELD = /^ {2}"manaCost":/m;

/**
 * Grava `learnPrice` no TEXTO bruto do arquivo, preservando a formatação autoral (mesma razão de
 * `replacePriceField` em `npc-prices.ts`): troca a linha existente, ou insere uma nova logo
 * antes de `"manaCost"` — campo obrigatório de toda magia, presente em todo arquivo.
 */
export function writeLearnPriceField(source: string, price: number): string {
  if (LEARN_PRICE_FIELD.test(source)) return source.replace(LEARN_PRICE_FIELD, `  "learnPrice": ${price},\n`);
  if (!MANA_COST_FIELD.test(source)) throw new Error('campo "manaCost" não encontrado no arquivo — formato inesperado');
  return source.replace(MANA_COST_FIELD, `  "learnPrice": ${price},\n  "manaCost":`);
}

export function currentLearnPriceOf(data: Record<string, unknown>): number | null {
  const price = data['learnPrice'];
  return typeof price === 'number' ? price : null;
}

/**
 * Resolve o preço de cada magia autoral e, fora do `--check`, regrava o arquivo cujo valor
 * diverge do menor preço dos NPCs. Uma magia SEM nenhum NPC que a ensine (`observation: null`)
 * nunca é tocada nem zerada: o preço dela é curado à mão (o fallback do ADR 0058 d.3, com
 * citação em `_open`) e aparece no relatório como "sem NPC".
 */
export function applyLearnPrices(
  repoRoot: string, aggregate: SpellTeachingAggregate, options: { readonly check: boolean },
): { readonly changes: readonly LearnPriceChange[]; readonly resolutions: readonly SpellPriceResolution[] } {
  const dir = join(repoRoot, 'packages/content/data/spells');
  const changes: LearnPriceChange[] = [];
  const resolutions: SpellPriceResolution[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    const path = join(dir, file);
    const source = readFileSync(path, 'utf8');
    const data = JSON.parse(source) as Record<string, unknown>;
    const slug = file.replace(/\.json$/, '');
    const name = data['name'];
    const vocationId = typeof data['vocationId'] === 'string' ? data['vocationId'] : undefined;
    if (typeof name !== 'string') throw new Error(`${path}: sem "name" — formato inesperado`);
    const observation = learnPriceOf(aggregate.teachings, name, vocationId);
    const currentPrice = currentLearnPriceOf(data);
    resolutions.push({ slug, name, vocationId, observation, currentPrice });
    if (observation === null || observation.price === currentPrice) continue;
    changes.push({ path, slug, oldPrice: currentPrice, newPrice: observation.price, source: observation });
    if (!options.check) writeFileSync(path, writeLearnPriceField(source, observation.price));
  }
  return { changes, resolutions };
}

/**
 * `docs/reference/catalog/spell-prices-report.md` — o mesmo espírito de `npc-prices.ts` (ADR
 * 0038 decisão 5): o que a leitura viu, o que ela não resolveu e o que mudou. Sem data/hora:
 * reimportar o MESMO commit do Canary produz o MESMO relatório (idempotência).
 */
export function formatSpellPricesReport(
  aggregate: SpellTeachingAggregate,
  changes: readonly LearnPriceChange[],
  resolutions: readonly SpellPriceResolution[],
  canaryCommit: string,
): string {
  const lines: string[] = [
    '# Relatório de importação — preço de magia por NPC (M44-06/#624)',
    '',
    `Fonte: \`canary\` em \`${canaryCommit}\`.`,
    '',
    `${aggregate.npcFilesRead} arquivo(s) de NPC lidos, ${aggregate.npcFilesTeaching} ensinam magia, `
    + `${aggregate.teachings.length} chamada(s) \`StdModule.learnSpell\` coletadas, `
    + `${aggregate.unresolved.length} não resolvida(s).`,
    '',
    'O preço de `learnPrice` é o MENOR entre os NPCs que ensinam a magia à vocação dela (ADR 0038 '
    + 'decisão 6, ADR 0058 d.3); a ligação é o nome da magia sem diferenciar caixa, e a vocação do NPC '
    + 'vira a vocação base (Master Sorcerer → Sorcerer). `premium` não entra.',
  ];
  if (aggregate.unresolved.length > 0) {
    lines.push('', '## Chamadas fora do corte', '', '| arquivo | motivo |', '|---|---|');
    for (const entry of [...aggregate.unresolved].sort((a, b) => a.file.localeCompare(b.file))) {
      lines.push(`| \`${entry.file}\` | ${entry.reason} |`);
    }
  }
  lines.push('', '## Magias', '', '| magia | vocação | learnPrice | fonte | NPCs | preços vistos |', '|---|---|---|---|---|---|');
  for (const resolution of resolutions) {
    const { observation } = resolution;
    lines.push(
      `| \`${resolution.slug}\` | ${resolution.vocationId ?? '—'} | `
      + `${observation?.price ?? resolution.currentPrice ?? '—'} | `
      + `${observation === null ? 'sem NPC' : `\`${observation.npcFile}\``} | ${observation?.teachers ?? 0} | `
      + `${observation === null ? '—' : observation.prices.join(', ')} |`,
    );
  }
  const withoutTeacher = resolutions.filter((resolution) => resolution.observation === null);
  lines.push('', '## Sem NPC que ensine', '');
  if (withoutTeacher.length === 0) {
    lines.push('Todas as magias têm ao menos um NPC do Canary que as ensina.');
  } else {
    lines.push(
      'Nenhum NPC importado ensina estas magias (no Canary elas vêm de outro caminho — quest, Wheel of '
      + 'Destiny, conta premium). O `learnPrice` é curado à mão, com a fonte no `_open` do próprio arquivo '
      + '(fallback do ADR 0058 d.3).',
      '',
      '| magia | vocação | learnPrice atual |',
      '|---|---|---|',
    );
    for (const resolution of withoutTeacher) {
      lines.push(`| \`${resolution.slug}\` | ${resolution.vocationId ?? '—'} | ${resolution.currentPrice ?? 'AUSENTE'} |`);
    }
  }
  if (changes.length === 0) {
    lines.push('', '## Mudanças nesta importação', '', 'Nenhuma — o dado commitado já confere com o Canary.');
  }
  lines.push('');
  return lines.join('\n');
}

// -------------------------------------------------------------------------------------------
// CLI — `pnpm catalog:spell-prices [--check]`.

if (import.meta.main) {
  const { existsSync, mkdirSync } = await import('node:fs');
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
    const message = `catalog:spell-prices: ${canaryDir} não está nesta máquina (CANARY_DIR em scripts/catalog/env.ts)`;
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
    forgottenServerCommit: sourceAvailable(resolveForgottenServerDir(ROOT))
      ? readSourceCommit(resolveForgottenServerDir(ROOT)) : '',
  };
  const aggregate = readSpellTeachings(ctx);
  const { changes, resolutions } = applyLearnPrices(ROOT, aggregate, { check });
  const reportPath = join(ROOT, 'docs', 'reference', 'catalog', 'spell-prices-report.md');
  const report = formatSpellPricesReport(aggregate, changes, resolutions, ctx.canaryCommit);
  const committedReport = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : null;
  const reportStale = committedReport !== report;
  if (!check) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, report);
  }

  console.log(
    `spell-prices: ${aggregate.npcFilesRead} arquivo(s) de NPC, ${aggregate.npcFilesTeaching} ensinam magia, `
    + `${aggregate.teachings.length} ensino(s), ${aggregate.unresolved.length} fora do corte.`,
  );
  for (const change of changes) {
    const verb = check ? 'DESATUALIZADO' : 'atualizado';
    console.log(`  ${change.slug}: learnPrice ${change.oldPrice ?? 'ausente'} → ${change.newPrice} (${verb}, fonte: ${change.source.npcFile})`);
  }
  const missing = resolutions.filter((resolution) => resolution.currentPrice === null && resolution.observation === null);
  for (const resolution of missing) console.log(`  sem preço: ${resolution.slug} (nenhum NPC a ensina)`);
  if (check && reportStale) console.error(`  ${reportPath}: DESATUALIZADO`);

  process.exit(check && (changes.length > 0 || reportStale) ? 1 : 0);
}
