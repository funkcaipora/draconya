// scripts/catalog/import.ts — `pnpm catalog:import <tipo> [--check]` (ADR 0038 decisão 4).
//
//   pnpm catalog:import items            # gera packages/content/data/items/generated/*.json
//   pnpm catalog:import --check          # regenera TODO tipo registrado em memória e compara
//   pnpm catalog:import items --check    # só o tipo "items"
//
// Sem `CANARY_DIR` nesta máquina, `--check` AVISA e PULA (exit 0) — o mesmo comportamento que
// `pnpm map:import --check` já tem para o OTBM ausente, e que o `pnpm check` do CI depende: o
// catálogo real não é gerado no CI, só conferido quando alguém tem o checkout do Canary do lado.
// Sem `--check`, ausência de fonte É erro — não tem como importar o que não existe.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readSourceCommit, resolveCanaryDir, resolveForgottenServerDir, sourceAvailable } from './env.js';
import {
  type CatalogEntity, formatGeneratedSlice, listGeneratedSlices, writeGeneratedSlice,
} from './generated-writer.js';
import { writeReport } from './report.js';
import type { CatalogImportContext, CatalogType } from './registry.js';
import { getCatalogType, listCatalogTypes } from './registry.js';

// Importar aqui (só pelo efeito colateral de `registerCatalogType`) é como um `<tipo>` novo
// entra no comando — #573 em diante acrescenta uma linha como esta. Nenhuma hoje: #572 é a
// infraestrutura, o registro fica para quem a usa.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function buildContext(canaryDir: string, forgottenServerDir: string): CatalogImportContext {
  return {
    canaryDir,
    forgottenServerDir,
    canaryCommit: readSourceCommit(canaryDir),
    forgottenServerCommit: sourceAvailable(forgottenServerDir) ? readSourceCommit(forgottenServerDir) : '',
  };
}

export interface RunOutcome {
  readonly type: string;
  readonly slices: ReadonlyMap<string, number>;
  readonly skippedCount: number;
}

/** Roda o importador de `type` e ESCREVE `generated/*.json` e o relatório. */
export function runImport(type: CatalogType, ctx: CatalogImportContext, repoRoot: string = ROOT): RunOutcome {
  const result = type.run(ctx);
  const counts = new Map<string, number>();
  for (const [slice, entities] of result.slices) {
    writeGeneratedSlice(join(repoRoot, type.dataDir, 'generated', `${slice}.json`), entities);
    counts.set(slice, entities.length);
  }
  writeReport(join(repoRoot, 'docs', 'reference', 'catalog', `${type.id}-report.md`), {
    type: type.id,
    source: { engine: 'canary', commit: ctx.canaryCommit },
    slices: counts,
    skipped: result.skipped,
  });
  return { type: type.id, slices: counts, skippedCount: result.skipped.length };
}

export interface CheckOutcome {
  readonly type: string;
  readonly slice: string;
  readonly status: 'fresh' | 'stale';
  readonly detail?: string;
}

/** Regenera `type` em memória e compara com o que está em `generated/` — nunca escreve nada. */
export function checkImport(type: CatalogType, ctx: CatalogImportContext, repoRoot: string = ROOT): CheckOutcome[] {
  const result = type.run(ctx);
  const generatedDir = join(repoRoot, type.dataDir, 'generated');
  const committed = listGeneratedSlices(generatedDir);
  const sliceNames = new Set([...result.slices.keys(), ...committed.keys()]);
  const outcomes: CheckOutcome[] = [];
  for (const slice of [...sliceNames].sort((a, b) => a.localeCompare(b))) {
    const fresh = result.slices.get(slice);
    if (fresh === undefined) {
      outcomes.push({
        type: type.id, slice, status: 'stale',
        detail: `generated/${slice}.json está commitado, mas o importador não produz mais essa fatia`,
      });
      continue;
    }
    const onDisk = committed.get(slice);
    if (onDisk === undefined) {
      outcomes.push({
        type: type.id, slice, status: 'stale',
        detail: `generated/${slice}.json não existe — rode pnpm catalog:import ${type.id}`,
      });
      continue;
    }
    const freshText = formatGeneratedSlice(fresh as readonly CatalogEntity[]);
    const committedText = formatGeneratedSlice(onDisk);
    outcomes.push(freshText === committedText
      ? { type: type.id, slice, status: 'fresh' }
      : { type: type.id, slice, status: 'stale', detail: 'a fatia regenerada difere da versionada' });
  }
  return outcomes;
}

function usage(): string {
  return 'Usage: pnpm catalog:import <tipo> | --check [<tipo>] [--canary-dir <dir>]';
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((argument, index) => index !== 0 || argument !== '--'),
    options: { check: { type: 'boolean' }, 'canary-dir': { type: 'string' } },
    allowPositionals: true,
    strict: true,
  });
  const tipo = positionals[0];
  const canaryDir = values['canary-dir'] === undefined
    ? resolveCanaryDir(ROOT)
    : resolve(ROOT, values['canary-dir']);
  const forgottenServerDir = resolveForgottenServerDir(ROOT);

  if (values.check === true) {
    if (!existsSync(canaryDir)) {
      console.log(`catalog:import --check: ${canaryDir} não está nesta máquina — pulado (ver CANARY_DIR em scripts/catalog/env.ts)`);
      process.exit(0);
    }
    let types: readonly CatalogType[];
    if (tipo === undefined) {
      types = listCatalogTypes();
    } else {
      const found = getCatalogType(tipo);
      if (found === undefined) {
        console.error(`catalog:import --check: tipo "${tipo}" não registrado`);
        process.exit(2);
      }
      types = [found];
    }
    if (types.length === 0) {
      console.log('catalog:import --check: nenhum tipo de catálogo registrado ainda — nada a conferir.');
      process.exit(0);
    }
    const ctx = buildContext(canaryDir, forgottenServerDir);
    let stale = false;
    for (const type of types) {
      for (const outcome of checkImport(type, ctx)) {
        if (outcome.status === 'fresh') {
          console.log(`${type.id}/generated/${outcome.slice}.json: confere com ${ctx.canaryCommit.slice(0, 12)}`);
        } else {
          stale = true;
          console.error(`${type.id}/generated/${outcome.slice}.json: DESATUALIZADO — ${outcome.detail ?? ''}`);
        }
      }
    }
    process.exit(stale ? 1 : 0);
  }

  if (tipo === undefined) {
    console.error(usage());
    process.exit(2);
  }
  const type = getCatalogType(tipo);
  if (type === undefined) {
    const known = listCatalogTypes().map((t) => t.id);
    console.error(`catalog:import: tipo "${tipo}" não registrado.${known.length > 0 ? ` Tipos conhecidos: ${known.join(', ')}.` : ' Nenhum tipo registrado ainda.'}`);
    process.exit(2);
  }
  if (!existsSync(canaryDir)) {
    console.error(`catalog:import: ${canaryDir} não existe — defina CANARY_DIR ou clone o Canary lá antes de importar.`);
    process.exit(1);
  }
  const ctx = buildContext(canaryDir, forgottenServerDir);
  const outcome = runImport(type, ctx);
  console.log(`importado "${outcome.type}" de ${ctx.canaryCommit.slice(0, 12)}:`);
  for (const [slice, count] of outcome.slices) console.log(`  generated/${slice}.json: ${count} entidade(s)`);
  console.log(`  fora do corte: ${outcome.skippedCount} (docs/reference/catalog/${outcome.type}-report.md)`);
}
