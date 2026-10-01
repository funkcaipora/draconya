import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSourceCommit, resolveCanaryDir, resolveForgottenServerDir, sourceAvailable } from './env.js';

describe('resolveCanaryDir', () => {
  it('usa o padrão things/sources/canary quando CANARY_DIR não está no ambiente', () => {
    expect(resolveCanaryDir('/repo', {})).toBe('/repo/things/sources/canary');
  });

  it('usa CANARY_DIR quando presente, relativo à raiz', () => {
    expect(resolveCanaryDir('/repo', { CANARY_DIR: 'outro/lugar' })).toBe('/repo/outro/lugar');
  });

  it('aceita CANARY_DIR absoluto', () => {
    expect(resolveCanaryDir('/repo', { CANARY_DIR: '/fora/do/repo' })).toBe('/fora/do/repo');
  });

  it('resolveForgottenServerDir segue a mesma regra para FORGOTTENSERVER_DIR', () => {
    expect(resolveForgottenServerDir('/repo', {})).toBe('/repo/things/sources/forgottenserver');
    expect(resolveForgottenServerDir('/repo', { FORGOTTENSERVER_DIR: 'x' })).toBe('/repo/x');
  });
});

describe('sourceAvailable', () => {
  it('falso para diretório que não existe', () => {
    expect(sourceAvailable('/nao/existe/de/verdade')).toBe(false);
  });
});

describe('readSourceCommit', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'catalog-env-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolve HEAD solto (ref: refs/heads/<nome>)', () => {
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(dir, '.git', 'refs', 'heads', 'main'), `${'a'.repeat(40)}\n`);
    expect(readSourceCommit(dir)).toBe('a'.repeat(40));
  });

  it('resolve HEAD via packed-refs quando a ref solta não existe', () => {
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(
      join(dir, '.git', 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${'b'.repeat(40)} refs/heads/main\n`,
    );
    expect(readSourceCommit(dir)).toBe('b'.repeat(40));
  });

  it('HEAD destacado (sha cru) volta como está', () => {
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), `${'c'.repeat(40)}\n`);
    expect(readSourceCommit(dir)).toBe('c'.repeat(40));
  });

  it('lança quando .git/HEAD não existe', () => {
    expect(() => readSourceCommit(dir)).toThrow(/HEAD ausente/);
  });

  it('lança quando a ref não resolve em lugar nenhum', () => {
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/nao-existe\n');
    expect(() => readSourceCommit(dir)).toThrow(/não encontrada/);
  });
});
