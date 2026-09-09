import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function testFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...testFiles(path));
    else if (entry.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('test Redis databases', () => {
  it('never gives two test files the same database', () => {
    // O Vitest roda arquivos EM PARALELO e `flushdb` é global: dois arquivos no mesmo banco
    // apagam o estado um do outro no meio do teste, e o resultado é intermitente e dependente
    // da ordem — cada um passa sozinho e falha junto com o outro.
    //
    // Já aconteceu duas vezes neste repositório. Da primeira, a solução foi um banco por
    // arquivo; da segunda, dois arquivos escolheram o MESMO número, porque a lista que os
    // coordenava era um comentário. Este teste é a lista virando verificação.
    const claims = new Map<number, string[]>();
    for (const file of testFiles(SRC)) {
      const match = /connectTestRedis\((\d+)\)/.exec(readFileSync(file, 'utf8'));
      if (match?.[1] === undefined) continue;
      const db = Number(match[1]);
      claims.set(db, [...(claims.get(db) ?? []), file.slice(SRC.length + 1)]);
    }

    const shared = [...claims.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([db, files]) => `db ${db}: ${files.join(', ')}`);

    expect(shared).toEqual([]);
    // Guarda contra o teste virar vácuo se o helper for renomeado e nada mais casar.
    expect(claims.size).toBeGreaterThanOrEqual(4);
  });
});
