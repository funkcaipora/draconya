// scripts/catalog/env.ts — onde o Canary mora nesta máquina, e de que commit.
//
// `CANARY_DIR` é a mesma classe de variável que `THINGS_DIR`: um caminho que só existe em
// máquina de desenvolvimento, gitignorado, e cuja ausência é AVISO — nunca erro — no
// `pnpm check` (ADR 0038 decisão 1 e decisão 4). Sem ela, `pnpm catalog:import <tipo>` (que
// escreve conteúdo) não tem como funcionar e lança; `--check` avisa e pula, como
// `map:import --check` já faz para o OTBM ausente.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `things/sources/canary`, relativo à raiz do repositório — o padrão da decisão 1. */
export const DEFAULT_CANARY_DIR = 'things/sources/canary';

/** `things/sources/forgottenserver` — citado pelo TFS quando uma correção pede as duas fontes. */
export const DEFAULT_FORGOTTENSERVER_DIR = 'things/sources/forgottenserver';

/**
 * Resolve o diretório do Canary: `CANARY_DIR` do ambiente, senão o padrão relativo à raiz do
 * repositório. Não confere existência — quem chama decide se ausência é erro ou aviso.
 */
export function resolveCanaryDir(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['CANARY_DIR'];
  return configured === undefined || configured === '' ? resolve(repoRoot, DEFAULT_CANARY_DIR) : resolve(repoRoot, configured);
}

export function resolveForgottenServerDir(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['FORGOTTENSERVER_DIR'];
  return configured === undefined || configured === '' ? resolve(repoRoot, DEFAULT_FORGOTTENSERVER_DIR) : resolve(repoRoot, configured);
}

/**
 * O commit do checkout em `dir`, lido do próprio `.git` — nunca via `git rev-parse`. Um
 * agente isolado em worktree não pode apontar o comando `git` para outro checkout (a proteção
 * do harness recusa `--git-dir`/`cd`), e ler `HEAD` a mão também não depende do binário `git`
 * estar disponível no PATH de quem roda o importador.
 *
 * Resolve `ref: refs/heads/<nome>` contra o arquivo solto e, se ele não existir (repositório
 * empacotado), contra `packed-refs`. HEAD destacado (um sha de 40 hex direto no arquivo) volta
 * como está.
 */
export function readSourceCommit(dir: string): string {
  const headPath = join(dir, '.git', 'HEAD');
  if (!existsSync(headPath)) {
    throw new Error(`${dir} não é um checkout git — HEAD ausente em ${headPath}`);
  }
  const head = readFileSync(headPath, 'utf8').trim();
  const refMatch = /^ref:\s*(\S+)$/.exec(head);
  if (refMatch === null) {
    if (/^[0-9a-f]{40}$/i.test(head)) return head;
    throw new Error(`${headPath} não é nem uma ref nem um sha: "${head}"`);
  }
  const ref = refMatch[1] as string;
  const loose = join(dir, '.git', ref);
  if (existsSync(loose)) {
    const sha = readFileSync(loose, 'utf8').trim();
    if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error(`${loose} não contém um sha válido: "${sha}"`);
    return sha;
  }
  const packedPath = join(dir, '.git', 'packed-refs');
  if (existsSync(packedPath)) {
    const packed = readFileSync(packedPath, 'utf8');
    for (const line of packed.split('\n')) {
      if (line.startsWith('#')) continue;
      const [sha, name] = line.trim().split(/\s+/);
      if (name === ref && sha !== undefined) return sha;
    }
  }
  throw new Error(`${ref} não encontrada em ${dir}/.git (nem solta, nem em packed-refs)`);
}

/** `things/sources/canary` (ou o que `CANARY_DIR` apontar) existe nesta máquina. */
export function sourceAvailable(dir: string): boolean {
  return existsSync(dir);
}

/** A raiz do repositório, a partir de um `import.meta.url` de um arquivo dentro de `scripts/catalog/`. */
export function repoRootFrom(fileUrl: string): string {
  return resolve(dirname(fileURLToPath(fileUrl)), '..', '..');
}
