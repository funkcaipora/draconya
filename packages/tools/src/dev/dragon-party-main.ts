#!/usr/bin/env node
// A borda de linha de comando da semente local da party de dragões (#526). Toda a lógica testável
// mora em `dragon-party-runner.ts`/`dragon-party-seed.ts`/`dragon-party-plan.ts`; este arquivo só
// lê argumento e ambiente, e sai com o código que o runner devolveu. Ver docs/local-dragon-party.md.
//
//   pnpm dev:dragon-party                       # cria/atualiza as quatro contas e a party
//   pnpm dev:dragon-party --start                # e também inicia a hunt
//   pnpm dev:dragon-party --hunt-id=rat-cellars --difficulty=bold   # testar sem a Dragon Lair
//   pnpm dev:dragon-party --reset                # devolve os quatro para a Cidade se travados

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDragonParty } from './dragon-party-runner.js';

// Resolvido a partir DESTE arquivo, e não do diretório de trabalho — o script roda por
// `pnpm --filter`, que executa dentro de `packages/tools` (o mesmo motivo do `content:check`).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const withValue = process.argv.find((arg) => arg.startsWith(prefix));
  return withValue?.slice(prefix.length);
}

const start = process.argv.includes('--start');
const reset = process.argv.includes('--reset');
const huntId = flag('hunt-id') ?? 'darashia-dragon-lair';
const difficulty = flag('difficulty') ?? 'bold';
const databaseUrl = flag('database-url') ?? process.env['DATABASE_URL'];
// O `.env` da raiz traz `CONTENT_DIR=./packages/content/data`, relativo à raiz do repositório —
// e o cwd AQUI é `packages/tools` (o script roda por `pnpm --filter`, como o `content:check`).
// `resolve` contra `REPO_ROOT` funciona para os dois casos: caminho relativo do `.env` E
// caminho absoluto vindo de `--content-dir=`, que `resolve` devolve intacto.
const contentDir = resolve(REPO_ROOT, flag('content-dir') ?? process.env['CONTENT_DIR'] ?? 'packages/content/data');
const apiPort = flag('api-port') ?? process.env['API_PORT'] ?? '3000';
const apiBaseUrl = flag('api-base') ?? `http://localhost:${apiPort}`;
const clientOrigin = flag('client-origin') ?? process.env['API_ORIGIN'] ?? 'http://localhost:5173';
const redisUrl = flag('redis-url') ?? process.env['REDIS_URL'];

if (databaseUrl === undefined || databaseUrl === '') {
  console.error(
    'dev:dragon-party: DATABASE_URL não definida — passe --database-url= ou rode com o .env '
      + 'carregado (veja docs/local-dragon-party.md).',
  );
  process.exit(1);
}

if (start && reset) {
  console.error('dev:dragon-party: --start e --reset são exclusivos — escolha um.');
  process.exit(1);
}

try {
  const result = await runDragonParty({
    databaseUrl, contentDir, apiBaseUrl, clientOrigin, huntId, difficulty, start, reset,
    redisUrl,
    log: (message) => console.log(message),
  });
  process.exitCode = result.exitCode;
} catch (error) {
  console.error('dev:dragon-party: falhou.', error);
  process.exitCode = 1;
}
