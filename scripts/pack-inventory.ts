// O inventário de ids de um pacote de assets, para `content/` conferir a tabela de aparências
// (FUN-21).
//
//   pnpm assets:inventory              # escreve packages/content/data/packs/tibia-<versão>.json
//   pnpm assets:inventory --check      # confere cada inventário versionado com o pacote local
//
// O pacote mora em `things/<versão>/`, fora do Git (ADR 0008), e o servidor nem o carrega. O
// que `content/` versiona é a SOMBRA dele: quais ids existem em cada registro, como faixas
// inclusivas. `buildContent` cruza a tabela de aparências com essa sombra e recusa o id que não
// está em faixa nenhuma — no boot, no `pnpm content:check` e no `load.test.ts`, que roda no CI
// sem pacote nenhum. É isso que faz o quadrado invisível deixar de ser possível sem alguém ter
// ignorado um erro.
//
// A sombra pode envelhecer: o pacote sobe de versão e o inventário fica para trás. `--check`
// existe para isso, e faz parte do `pnpm check`: com o pacote na máquina, regenera o inventário
// em memória e compara com o arquivo; sem o pacote — o CI, uma máquina nova — avisa e pula, e o
// que segura é o teste de conteúdo contra o arquivo versionado. E a sombra é de UM pacote: o
// `game` recusa subir se `THINGS_VERSION` não é a versão dela (`server/src/served-pack.ts`).

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { packSchema } from '../packages/content/src/schemas.js';
import type { Pack } from '../packages/content/src/schemas.js';
import { readAppearances } from '../packages/client/src/assets/appearances.js';
import type { AppearanceCatalogue } from '../packages/client/src/assets/appearances.js';
import { readCatalog } from '../packages/client/src/assets/catalog.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS_DIR = join(ROOT, 'packages', 'content', 'data', 'packs');
const KINDS = ['object', 'outfit', 'effect', 'missile'] as const;

export type IdRange = readonly [first: number, last: number];

/** Ids em faixas inclusivas, em ordem crescente. `[1,2,3,7]` vira `[[1,3],[7,7]]`. */
export function rangesOf(ids: Iterable<number>): IdRange[] {
  const sorted = [...new Set(ids)].sort((left, right) => left - right);
  const ranges: [number, number][] = [];
  for (const id of sorted) {
    const last = ranges.at(-1);
    if (last !== undefined && last[1] === id - 1) last[1] = id;
    else ranges.push([id, id]);
  }
  return ranges;
}

/** O inventário de um catálogo já decodificado. `version` é a pasta em `things/`. */
export function inventoryOf(
  catalogue: AppearanceCatalogue,
  version: string,
  appearancesSha256: string,
): Pack {
  return packSchema.parse({
    id: `tibia-${version}`,
    version,
    appearancesSha256,
    object: rangesOf(catalogue.object.keys()),
    outfit: rangesOf(catalogue.outfit.keys()),
    effect: rangesOf(catalogue.effect.keys()),
    missile: rangesOf(catalogue.missile.keys()),
  });
}

/**
 * Lê o pacote em `things/<versão>/` e devolve o inventário, ou `null` se ele não está na
 * máquina. Catálogo presente e `.dat` ausente é ERRO, não ausência: é um pacote pela metade.
 */
export function readPackInventory(thingsDir: string, version: string): Pack | null {
  const packDir = join(thingsDir, version);
  const catalogPath = join(packDir, 'catalog-content.json');
  if (!existsSync(catalogPath)) return null;
  const catalog = readCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown);
  const appearancesPath = join(packDir, catalog.appearancesFile);
  if (!existsSync(appearancesPath)) {
    throw new Error(`${catalogPath} aponta ${catalog.appearancesFile}, que não existe`);
  }
  const bytes = readFileSync(appearancesPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return inventoryOf(readAppearances(bytes), version, sha256);
}

/**
 * O JSON do inventário, com as faixas de cada registro em linhas de até 100 colunas.
 *
 * `JSON.stringify(pack, null, 2)` poria cada NÚMERO numa linha — 760 faixas de objeto virariam
 * três mil linhas, e o diff de uma troca de pacote deixaria de ser legível, que é a única
 * razão de o inventário ser faixa e não lista.
 */
export function formatInventory(pack: Pack): string {
  const lines = [
    '{',
    `  "id": ${JSON.stringify(pack.id)},`,
    `  "version": ${JSON.stringify(pack.version)},`,
    `  "appearancesSha256": ${JSON.stringify(pack.appearancesSha256)},`,
  ];
  KINDS.forEach((kind, index) => {
    const comma = index === KINDS.length - 1 ? '' : ',';
    const ranges = pack[kind].map(([first, last]) => `[${first},${last}]`);
    if (ranges.length === 0) {
      lines.push(`  "${kind}": []${comma}`);
      return;
    }
    lines.push(`  "${kind}": [`);
    let line = '   ';
    ranges.forEach((range, position) => {
      const piece = ` ${range}${position === ranges.length - 1 ? '' : ','}`;
      if (line.length + piece.length > 100) {
        lines.push(line);
        line = '   ';
      }
      line += piece;
    });
    lines.push(line, `  ]${comma}`);
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** O que `--check` encontrou, um inventário por linha. */
export interface CheckOutcome {
  readonly file: string;
  readonly status: 'fresh' | 'stale' | 'absent';
  readonly detail?: string;
}

/**
 * Confere cada `packs/*.json` com o pacote correspondente em `things/`. `stale` diz em qual
 * registro o arquivo e o pacote divergem, para quem for ler saber se foi o pacote que subiu de
 * versão ou alguém que editou o inventário à mão.
 */
export function checkInventories(packsDir: string, thingsDir: string): CheckOutcome[] {
  const files = existsSync(packsDir)
    ? readdirSync(packsDir).filter((name) => name.endsWith('.json')).sort()
    : [];
  return files.map((file) => {
    const committed = packSchema.parse(JSON.parse(readFileSync(join(packsDir, file), 'utf8')));
    const actual = readPackInventory(thingsDir, committed.version);
    if (actual === null) return { file, status: 'absent' };
    const detail = differenceBetween(committed, actual);
    return detail === null ? { file, status: 'fresh' } : { file, status: 'stale', detail };
  });
}

/** A primeira diferença entre dois inventários, em palavras, ou `null` se são iguais. */
export function differenceBetween(committed: Pack, actual: Pack): string | null {
  if (committed.id !== actual.id) return `id: "${committed.id}" no arquivo, "${actual.id}" no pacote`;
  if (committed.appearancesSha256 !== actual.appearancesSha256) {
    return `o .dat mudou: sha256 ${committed.appearancesSha256.slice(0, 12)}… no arquivo, `
      + `${actual.appearancesSha256.slice(0, 12)}… no pacote`;
  }
  for (const kind of KINDS) {
    const before = committed[kind];
    const after = actual[kind];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const mine = before[index];
      const theirs = after[index];
      if (mine !== undefined && theirs !== undefined && mine[0] === theirs[0] && mine[1] === theirs[1]) {
        continue;
      }
      // A PRIMEIRA faixa que difere, e não só a contagem: `[1,80]` contra `[1,81]` são uma
      // faixa de cada lado, e "1 faixa no arquivo, 1 no pacote" diria que nada mudou.
      return `${kind}, faixa ${index}: ${mine === undefined ? 'nada' : `[${mine}]`} no arquivo, `
        + `${theirs === undefined ? 'nada' : `[${theirs}]`} no pacote`;
    }
  }
  return null;
}

function usage(): string {
  return 'Usage: pnpm assets:inventory [--things <dir>] [--version <name>] | --check';
}

if (import.meta.main) {
  const { values } = parseArgs({
    // pnpm 10 preserva o separador `--` em `process.argv`; para o parser do Node ele seria um
    // positional vazio e faria exatamente o comando documentado falhar.
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: {
      things: { type: 'string' },
      version: { type: 'string' },
      check: { type: 'boolean' },
    },
    strict: true,
  });
  // Os mesmos nomes do `.env.example`; o `.env` não é lido aqui, e `things/1332` é o padrão
  // documentado nele.
  const thingsDir = resolve(ROOT, values.things ?? process.env.THINGS_DIR ?? 'things');
  if (values.check) {
    const outcomes = checkInventories(PACKS_DIR, thingsDir);
    if (outcomes.length === 0) {
      console.error(`nenhum inventário em ${PACKS_DIR} — a tabela de aparências não está sendo `
        + 'conferida contra pacote nenhum; rode pnpm assets:inventory');
      process.exit(1);
    }
    let stale = false;
    for (const outcome of outcomes) {
      if (outcome.status === 'fresh') console.log(`packs/${outcome.file}: confere com o pacote`);
      else if (outcome.status === 'absent') {
        console.log(`packs/${outcome.file}: pacote não está em ${thingsDir} — não conferido`);
      } else {
        stale = true;
        console.error(`packs/${outcome.file}: DESATUALIZADO — ${outcome.detail}; `
          + 'rode pnpm assets:inventory');
      }
    }
    process.exit(stale ? 1 : 0);
  }
  const version = values.version ?? process.env.THINGS_VERSION ?? '1332';
  const pack = readPackInventory(thingsDir, version);
  if (pack === null) {
    console.error(`pacote ${version} não encontrado em ${thingsDir}\n${usage()}`);
    process.exit(1);
  }
  const target = join(PACKS_DIR, `${pack.id}.json`);
  writeFileSync(target, formatInventory(pack));
  console.log(`${target}: ${KINDS.map((kind) => `${kind} ${pack[kind].length} faixas`).join(', ')}`);
}
