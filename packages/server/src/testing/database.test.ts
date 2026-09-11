import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function testFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...testFiles(path));
    else if (entry.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('test Postgres files (FUN-102)', () => {
  it('every file that opens a test database is named *.postgres.test.ts', () => {
    // É o NOME que põe o arquivo no projeto `postgres` do `vitest.config.ts`, onde os arquivos
    // de banco rodam no máximo dois por vez. Um arquivo que abre o banco sem o sufixo volta a
    // correr em paralelo com os outros quatro, contra um Postgres só — e a suíte volta a
    // reprovar doze testes sortidos por timeout, exatamente o que a lista aqui impede.
    // Este arquivo cita o helper pelo nome sem o chamar, e por isso fica de fora da varredura.
    const self = fileURLToPath(import.meta.url);
    const offenders = testFiles(PACKAGES)
      .filter((file) => file !== self && !file.endsWith('.postgres.test.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('connectTestDatabase('))
      .map((file) => file.slice(PACKAGES.length + 1));
    expect(offenders).toEqual([]);
  });

  it('and the ones that are named so DO open one — the suffix is not decoration', () => {
    // Guarda contra o teste virar vácuo: se o helper for renomeado e nada mais casar, ou se
    // alguém der o sufixo a um arquivo que não toca banco só para ele rodar devagar.
    const named = testFiles(PACKAGES).filter((file) => file.endsWith('.postgres.test.ts'));
    expect(named.length).toBeGreaterThanOrEqual(5);
    for (const file of named) {
      expect(readFileSync(file, 'utf8'), file).toContain('connectTestDatabase(');
    }
  });
});
