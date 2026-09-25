// scripts/catalog/report.ts — `docs/reference/catalog/<tipo>-report.md` (ADR 0038 decisão 5):
// o que o corte pelo pacote de arte 13.32 DEIXOU DE FORA, versionado — nunca descartado em
// silêncio. Reimportar sempre recupera o campo que um schema ainda não carrega, porque o
// relatório é gerado do MESMO dado bruto que o `generated/`, não copiado à mão.
//
// Sem data/hora de geração de propósito: o relatório precisa ser IDÊNTICO entre duas rodadas do
// mesmo commit do Canary, a mesma idempotência que `generated-writer.ts` garante para o dado —
// um timestamp faria todo `pnpm catalog:import` sujar o diff sem nenhuma entidade ter mudado.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CatalogSource } from './generated-writer.js';

/** Uma entidade que o Canary tem, mas que o Draconya não gera — e por quê. */
export interface SkippedEntity {
  readonly id: string | number;
  readonly name: string;
  /** Ex.: "sistema posterior ao 13.32 (Weapon Proficiency)", "mecânica sem motor no sim". */
  readonly reason: string;
  readonly source: CatalogSource;
}

export interface CatalogReport {
  readonly type: string;
  readonly source: { readonly engine: CatalogSource['engine']; readonly commit: string };
  /** Fatia (nome do arquivo em `generated/`) → quantas entidades ela tem. */
  readonly slices: ReadonlyMap<string, number>;
  readonly skipped: readonly SkippedEntity[];
}

function heading(report: CatalogReport): string {
  const total = [...report.slices.values()].reduce((sum, count) => sum + count, 0);
  const lines = [
    `# Relatório de importação — ${report.type}`,
    '',
    `Fonte: \`${report.source.engine}\` em \`${report.source.commit}\`.`,
    '',
    `${total} entidade(s) geradas em ${report.slices.size} fatia(s):`,
    '',
  ];
  for (const [slice, count] of [...report.slices.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- \`${slice}.json\`: ${count}`);
  }
  return lines.join('\n');
}

function skippedSection(report: CatalogReport): string {
  if (report.skipped.length === 0) {
    return '\nNada foi deixado de fora nesta importação — todo id do corte considerado virou entidade.\n';
  }
  const lines = [
    '',
    `## Fora do corte (${report.skipped.length})`,
    '',
    'O pacote de arte 13.32 não desenha, ou o `sim` ainda não executa a mecânica (ADR 0038 decisão 5).',
    'Reimportar recupera automaticamente o que um schema futuro passar a aceitar.',
    '',
    '| id | nome | motivo | fonte |',
    '|---|---|---|---|',
  ];
  const sorted = [...report.skipped].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const item of sorted) {
    lines.push(`| ${item.id} | ${item.name} | ${item.reason} | \`${item.source.path}\` |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function formatReport(report: CatalogReport): string {
  return `${heading(report)}\n${skippedSection(report)}`;
}

export function writeReport(path: string, report: CatalogReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatReport(report));
}

export function readReport(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}
