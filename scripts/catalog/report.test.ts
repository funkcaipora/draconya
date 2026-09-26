import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CatalogReport, formatReport, readReport, writeReport } from './report.js';

const SOURCE = { engine: 'canary' as const, commit: 'a'.repeat(40), path: 'data/items/items.xml' };

describe('formatReport', () => {
  it('lista as fatias com contagem, e nenhuma seção de fora-do-corte quando nada foi pulado', () => {
    const report: CatalogReport = {
      type: 'items',
      source: { engine: 'canary', commit: 'a'.repeat(40) },
      slices: new Map([['weapons', 2], ['armor', 1]]),
      skipped: [],
    };
    const text = formatReport(report);
    expect(text).toContain('# Relatório de importação — items');
    expect(text).toContain('3 entidade(s) geradas em 2 fatia(s)');
    expect(text).toContain('`armor.json`: 1');
    expect(text).toContain('`weapons.json`: 2');
    expect(text).toContain('Nada foi deixado de fora');
  });

  it('lista o que ficou fora do corte, com motivo e fonte', () => {
    const report: CatalogReport = {
      type: 'items',
      source: { engine: 'canary', commit: 'a'.repeat(40) },
      slices: new Map([['weapons', 1]]),
      skipped: [
        { id: 30_000, name: 'proficiency token', reason: 'sistema posterior ao 13.32', source: SOURCE },
      ],
    };
    const text = formatReport(report);
    expect(text).toContain('## Fora do corte (1)');
    expect(text).toContain('30000');
    expect(text).toContain('proficiency token');
    expect(text).toContain('sistema posterior ao 13.32');
    expect(text).toContain('items.xml');
  });

  it('ordena id NUMÉRICO por valor, não por texto (100 antes de 5000 antes de 30000)', () => {
    // `String(30000).localeCompare(String(5000))` ordena como TEXTO — "100, 30000, 5000" — e
    // erra a ordem que um relatório versionado precisa manter estável e legível.
    const report: CatalogReport = {
      type: 'items',
      source: { engine: 'canary', commit: 'a'.repeat(40) },
      slices: new Map([['weapons', 3]]),
      skipped: [
        { id: 30_000, name: 'c', reason: 'r', source: SOURCE },
        { id: 100, name: 'a', reason: 'r', source: SOURCE },
        { id: 5_000, name: 'b', reason: 'r', source: SOURCE },
      ],
    };
    const text = formatReport(report);
    const positions = [100, 5_000, 30_000].map((id) => text.indexOf(`| ${id} |`));
    expect(positions[0]).toBeGreaterThan(-1);
    expect(positions[0]).toBeLessThan(positions[1] as number);
    expect(positions[1]).toBeLessThan(positions[2] as number);
  });

  it('é determinístico: duas chamadas com o mesmo relatório produzem o MESMO texto', () => {
    // Sem data de geração de propósito — reimportar o mesmo commit não pode sujar o diff.
    const report: CatalogReport = {
      type: 'items', source: { engine: 'canary', commit: 'x'.repeat(40) },
      slices: new Map([['weapons', 1]]), skipped: [],
    };
    expect(formatReport(report)).toBe(formatReport(report));
  });
});

describe('writeReport / readReport', () => {
  it('escreve e lê de volta o mesmo texto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-report-'));
    try {
      const path = join(dir, 'items-report.md');
      const report: CatalogReport = {
        type: 'items', source: { engine: 'canary', commit: 'a'.repeat(40) },
        slices: new Map(), skipped: [],
      };
      writeReport(path, report);
      expect(readFileSync(path, 'utf8')).toBe(formatReport(report));
      expect(readReport(path)).toBe(formatReport(report));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readReport devolve null quando o arquivo não existe — ainda não foi gerado', () => {
    expect(readReport('/nao/existe/relatorio.md')).toBeNull();
  });
});
