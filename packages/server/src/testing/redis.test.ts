import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MINIMUM_MS } from './deadlines.js';

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

describe('prazos de Redis em fixture (FUN-95)', () => {
  it('nunca deixa uma fixture com prazo curto demais para sobreviver à suíte', () => {
    // Nenhum teste deste pacote espera prazo vencer: a FUN-62 trocou espera real por asserção,
    // e a expiração é provada apagando a chave na mão. O número gravado, então, só precisa
    // **sobreviver ao próprio teste** — e é aí que a FUN-62 deixou uma armadilha, porque
    // remover a espera não removeu os prazos de 50 e 120 ms que existiam por causa dela.
    //
    // O sintoma é o pior tipo: a suíte inteira sob carga reprova dois a quatro testes
    // DIFERENTES a cada execução, e cada um deles passa sozinho. Medido com dez processos
    // ocupando a CPU: `directory.test.ts` reprovava numa execução de cada duas, com
    // `expected null not to be null`, porque o lease de 120 ms vencia entre gravar e afirmar.
    //
    // Este teste é a mesma ideia do de colisão de banco, acima: comentário não impede
    // regressão, teste impede.
    const short: string[] = [];
    for (const file of testFiles(SRC)) {
      const relative = file.slice(SRC.length + 1);
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        // Só formas em MILISSEGUNDOS, e sem ambiguidade: `EX` é em segundos, e `60` ali é
        // um minuto — flagrá-lo seria ruído que treina a ignorar o teste.
        for (const match of line.matchAll(
          /(?:(?:leaseMs|ttlMs|graceMs)\s*[:=]\s*|pexpire\([^,]+,\s*)(\d[\d_]*)\b/g,
        )) {
          const raw = match[1];
          if (raw === undefined) continue;
          if (Number(raw.replaceAll('_', '')) >= MINIMUM_MS) continue;
          short.push(`${relative}:${index + 1} — ${match[0].trim()}`);
        }
      });
    }

    // Quem precisar mesmo de um prazo curto: ele é LÓGICO, e prazo lógico não vai para o
    // Redis — passa pelo relógio injetado, que o teste controla.
    expect(short).toEqual([]);
    // Guarda contra o teste virar vácuo se ninguém mais escrever `ttlMs` em fixture nenhuma.
    const written = testFiles(SRC)
      .filter((file) => /(?:leaseMs|ttlMs|graceMs)\s*[:=]|pexpire\(/.test(readFileSync(file, 'utf8')));
    expect(written.length).toBeGreaterThanOrEqual(4);
  });
});
