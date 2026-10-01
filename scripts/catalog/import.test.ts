import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readGeneratedSlice, writeGeneratedSlice, type CatalogEntity } from './generated-writer.js';
import { checkImport, runImport } from './import.js';
import { readReport } from './report.js';
import type { CatalogImportContext, CatalogType } from './registry.js';

const CTX: CatalogImportContext = {
  canaryDir: '/fake/canary', forgottenServerDir: '/fake/tfs',
  canaryCommit: 'a'.repeat(40), forgottenServerCommit: '',
};

const source = { engine: 'canary' as const, commit: CTX.canaryCommit, path: 'data/items/items.xml' };

function fakeType(id: string, entities: readonly CatalogEntity[]): CatalogType {
  return {
    id,
    dataDir: `packages/content/data/${id}`,
    run: () => ({ slices: new Map([['sample', entities]]), skipped: [] }),
  };
}

let workdir: string | undefined;

afterEach(() => {
  if (workdir !== undefined) { rmSync(workdir, { recursive: true, force: true }); workdir = undefined; }
});

describe('runImport', () => {
  it('escreve generated/<fatia>.json e o relatório versionado', () => {
    workdir = mkdtempSync(join(tmpdir(), 'catalog-import-'));
    const entities: CatalogEntity[] = [{ id: 'a', value: 1, source }];
    const type = fakeType('widgets', entities);

    const outcome = runImport(type, CTX, workdir);

    expect(outcome).toEqual({ type: 'widgets', slices: new Map([['sample', 1]]), skippedCount: 0 });
    const written = readGeneratedSlice(join(workdir, 'packages/content/data/widgets/generated/sample.json'));
    expect(written).toEqual(entities);
    const report = readReport(join(workdir, 'docs/reference/catalog/widgets-report.md'));
    expect(report).toContain('# Relatório de importação — widgets');
    expect(report).toContain('`sample.json`: 1');
  });

  it('reimportar o MESMO conjunto produz o MESMO arquivo — idempotente', () => {
    workdir = mkdtempSync(join(tmpdir(), 'catalog-import-'));
    const type = fakeType('widgets', [{ id: 'a', value: 1, source }]);
    runImport(type, CTX, workdir);
    const first = readFileSync(join(workdir, 'packages/content/data/widgets/generated/sample.json'), 'utf8');
    runImport(type, CTX, workdir);
    const second = readFileSync(join(workdir, 'packages/content/data/widgets/generated/sample.json'), 'utf8');
    expect(second).toBe(first);
  });
});

describe('checkImport', () => {
  it('"fresh" quando o commitado é EXATAMENTE o que o importador regenera', () => {
    workdir = mkdtempSync(join(tmpdir(), 'catalog-import-'));
    const type = fakeType('widgets', [{ id: 'a', value: 1, source }]);
    runImport(type, CTX, workdir);

    expect(checkImport(type, CTX, workdir)).toEqual([{ type: 'widgets', slice: 'sample', status: 'fresh' }]);
  });

  it('"stale" quando o arquivo commitado difere do que o importador regenera', () => {
    workdir = mkdtempSync(join(tmpdir(), 'catalog-import-'));
    const type = fakeType('widgets', [{ id: 'a', value: 999, source }]);
    writeGeneratedSlice(
      join(workdir, 'packages/content/data/widgets/generated/sample.json'),
      [{ id: 'a', value: 1, source }],
    );

    const [outcome] = checkImport(type, CTX, workdir);
    expect(outcome?.status).toBe('stale');
    expect(outcome?.detail).toMatch(/difere da versionada/);
  });

  it('"stale" quando generated/<fatia>.json ainda não existe', () => {
    workdir = mkdtempSync(join(tmpdir(), 'catalog-import-'));
    const type = fakeType('widgets', [{ id: 'a', value: 1, source }]);

    const [outcome] = checkImport(type, CTX, workdir);
    expect(outcome?.status).toBe('stale');
    expect(outcome?.detail).toMatch(/não existe/);
    // E, principalmente: NADA foi escrito — check nunca grava.
    expect(existsSync(join(workdir, 'packages/content/data/widgets/generated/sample.json'))).toBe(false);
  });

  it('"stale" quando uma fatia commitada não é mais produzida pelo importador (fatia órfã)', () => {
    workdir = mkdtempSync(join(tmpdir(), 'catalog-import-'));
    const type: CatalogType = {
      id: 'widgets', dataDir: 'packages/content/data/widgets',
      run: () => ({ slices: new Map(), skipped: [] }),
    };
    writeGeneratedSlice(
      join(workdir, 'packages/content/data/widgets/generated/sample.json'),
      [{ id: 'a', value: 1, source }],
    );

    const [outcome] = checkImport(type, CTX, workdir);
    expect(outcome).toEqual({
      type: 'widgets', slice: 'sample', status: 'stale',
      detail: 'generated/sample.json está commitado, mas o importador não produz mais essa fatia',
    });
  });
});
