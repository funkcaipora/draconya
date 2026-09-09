// Testes dos dois hooks de mensagem de commit do harness: `.githooks/commit-msg` (git de
// linha de comando ou GUI) e `.claude/hooks/validate-commit.sh` (PreToolUse do Claude Code).
//
// Por que vivem em packages/tools: o vitest só coleta `packages/*/src/**/*.test.ts`
// (vitest.config.ts), e `tools` é o pacote de ferramentas de desenvolvimento e manutenção —
// os hooks não são código de jogo e não pertencem a nenhum dos outros cinco. Os scripts
// continuam onde o git e o Claude Code esperam encontrá-los; só o teste mora aqui.
//
// Cada caso roda num repositório de verdade, e não sobre um mock do git: a regra sob teste é
// "existe MERGE_HEAD", que é estado do repositório. Simular isso testaria o mock.
//
// Os repositórios saem de dois moldes montados uma vez só e copiados por caso. Montar cada
// um do zero custava meia dúzia de processos de git por teste, e o arquivo sozinho passava
// de 10s — o bastante para, rodando em paralelo com o resto da suíte, estourar o limite de
// outros arquivos de teste e produzir vermelho que não é bug de ninguém. Copiar diretório é
// barato, e o `.git/` copiado carrega o estado de merge intacto.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const GIT_HOOKS_PATH = join(ROOT, '.githooks');
const CLAUDE_HOOK = join(ROOT, '.claude', 'hooks', 'validate-commit.sh');

// Identidade e configuração vêm do ambiente, não do ~/.gitconfig de quem roda: o teste não
// pode depender de como a máquina está configurada, nem escrever nela.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Draconya Test',
  GIT_AUTHOR_EMAIL: 'test@draconya.invalid',
  GIT_COMMITTER_NAME: 'Draconya Test',
  GIT_COMMITTER_EMAIL: 'test@draconya.invalid',
  // `git merge --continue` abre o editor para confirmar a mensagem. Sem isto o teste
  // travaria esperando um editor que ninguém vai fechar — na CI, até o timeout.
  GIT_EDITOR: 'true',
};

// Teto por caso. Não é medida de desempenho: é a folga que impede um falso vermelho quando
// a suíte inteira disputa a máquina, já que aqui cada asserção custa um processo de git.
const TIMEOUT_MS = 15_000;

// Duas vidas diferentes: molde dura o arquivo inteiro, cópia dura um caso.
const templates: string[] = [];
const copies: string[] = [];

function temporaryDirectory(lifetime: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'draconya-commit-hook-'));
  lifetime.push(dir);
  return dir;
}

function discard(lifetime: string[]): void {
  for (const dir of lifetime.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function git(cwd: string, args: readonly string[]) {
  return spawnSync('git', [...args], { cwd, env: GIT_ENV, encoding: 'utf8' });
}

/** Igual a `git`, mas explode se o comando falhar — para os passos de preparo do cenário. */
function gitOrThrow(cwd: string, args: readonly string[]) {
  const result = git(cwd, args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function commit(dir: string, message: string) {
  gitOrThrow(dir, ['add', '.']);
  return git(dir, ['commit', '-m', message]);
}

/** Repositório com o hook real instalado e um commit inicial válido. */
function buildCleanRepository(): string {
  const dir = temporaryDirectory(templates);
  gitOrThrow(dir, ['init', '--initial-branch=main']);
  gitOrThrow(dir, ['config', 'core.hooksPath', GIT_HOOKS_PATH]);
  writeFileSync(join(dir, 'file.txt'), 'base\n');
  gitOrThrow(dir, ['add', '.']);
  gitOrThrow(dir, ['commit', '-m', 'chore(tools): create repository']);
  return dir;
}

/** O molde acima, mais uma branch `feature` que diverge sem conflito. */
function buildDivergedRepository(): string {
  const dir = buildCleanRepository();
  gitOrThrow(dir, ['checkout', '-b', 'feature']);
  writeFileSync(join(dir, 'feature.txt'), 'feature\n');
  gitOrThrow(dir, ['add', '.']);
  gitOrThrow(dir, ['commit', '-m', 'feat(sim): add feature file (FUN-1)']);
  gitOrThrow(dir, ['checkout', 'main']);
  writeFileSync(join(dir, 'main.txt'), 'main\n');
  gitOrThrow(dir, ['add', '.']);
  gitOrThrow(dir, ['commit', '-m', 'feat(sim): add main file (FUN-2)']);
  return dir;
}

/**
 * Repositório parado no meio de um merge com conflito por resolver — o estado em que o git
 * devolve o commit final para quem está mesclando. É aqui que MERGE_HEAD existe.
 */
function buildConflictedMergeRepository(): string {
  const dir = buildCleanRepository();
  gitOrThrow(dir, ['checkout', '-b', 'feature']);
  writeFileSync(join(dir, 'file.txt'), 'feature\n');
  gitOrThrow(dir, ['commit', '-am', 'feat(sim): change file on feature (FUN-1)']);
  gitOrThrow(dir, ['checkout', 'main']);
  writeFileSync(join(dir, 'file.txt'), 'main\n');
  gitOrThrow(dir, ['commit', '-am', 'feat(sim): change file on main (FUN-2)']);

  // O merge falha de propósito: é o caminho que exige um commit manual depois.
  expect(git(dir, ['merge', '--no-ff', 'feature']).status).not.toBe(0);
  expect(git(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status).toBe(0);
  return dir;
}

let cleanTemplate: string;
let divergedTemplate: string;
let conflictedMergeTemplate: string;

beforeAll(() => {
  cleanTemplate = buildCleanRepository();
  divergedTemplate = buildDivergedRepository();
  conflictedMergeTemplate = buildConflictedMergeRepository();
});

/** Cópia descartável de um molde. O `.git/` vem junto, estado de merge inclusive. */
function repositoryFrom(template: string): string {
  const dir = temporaryDirectory(copies);
  cpSync(template, dir, { recursive: true });
  return dir;
}

/** Deixa o conflito resolvido no diretório de trabalho, sem tocar no índice. */
function resolveConflict(dir: string): void {
  writeFileSync(join(dir, 'file.txt'), 'resolved\n');
}

// Os moldes ficam de pé para o próximo caso; só as cópias somem entre um e outro.
afterEach(() => discard(copies));
afterAll(() => discard(templates));

describe('.githooks/commit-msg', { timeout: TIMEOUT_MS }, () => {
  it('rejects a commit whose subject does not match the project format', () => {
    const dir = repositoryFrom(cleanTemplate);
    writeFileSync(join(dir, 'file.txt'), 'change\n');

    const result = commit(dir, 'arrumei umas coisas');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match');
  });

  it('rejects a work commit that is missing the issue reference', () => {
    const dir = repositoryFrom(cleanTemplate);
    writeFileSync(join(dir, 'file.txt'), 'change\n');

    const result = commit(dir, 'feat(sim): advance simulation using elapsed time');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing (FUN-nn)');
  });

  it('accepts a commit in the project format', () => {
    const dir = repositoryFrom(cleanTemplate);
    writeFileSync(join(dir, 'file.txt'), 'change\n');

    expect(commit(dir, 'feat(sim): advance simulation using elapsed time (FUN-25)').status)
      .toBe(0);
  });

  it('accepts a merge that applies cleanly', () => {
    // Este caminho já passava antes da isenção, por um motivo que não é mérito do hook: um
    // merge que resolve sozinho não chega a chamar o commit-msg. O caso fica aqui porque a
    // promessa testada é "merge passa", e ela não deve depender do caminho que o git tomou.
    const dir = repositoryFrom(divergedTemplate);

    // Assunto que o git escreve sozinho: "Merge branch 'feature'".
    expect(git(dir, ['merge', '--no-ff', 'feature']).status).toBe(0);
    expect(git(dir, ['log', '-1', '--format=%s']).stdout).toContain('Merge branch');
  });

  it('accepts `git merge --continue` after a conflict is resolved', () => {
    // Aqui o hook roda de verdade, com o assunto guardado em MERGE_MSG. É um dos dois
    // caminhos que o merge com conflito oferece, e o mais curto.
    const dir = repositoryFrom(conflictedMergeTemplate);
    resolveConflict(dir);
    gitOrThrow(dir, ['add', '.']);

    expect(git(dir, ['merge', '--continue']).status).toBe(0);
    expect(git(dir, ['log', '-1', '--format=%s']).stdout).toContain('Merge branch');
  });

  it('accepts the manual commit that closes a conflicted merge', () => {
    // O outro caminho: `git commit` com a mensagem escrita à mão. É o que foi recusado na
    // prática, e o que forçou o assunto artificial que motivou esta isenção.
    const dir = repositoryFrom(conflictedMergeTemplate);
    resolveConflict(dir);

    expect(commit(dir, "Merge branch 'feature' into main").status).toBe(0);
  });

  it('still rejects a normal commit whose subject starts with "Merge"', () => {
    // A isenção é por MERGE_HEAD, não pelo prefixo do assunto — que é texto livre e qualquer
    // commit pode ter sem ser um merge. Sem MERGE_HEAD, "Merge ..." é assunto fora do padrão.
    const dir = repositoryFrom(cleanTemplate);
    writeFileSync(join(dir, 'file.txt'), 'change\n');

    const result = commit(dir, "Merge branch 'feature' into main");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match');
  });
});

describe('.claude/hooks/validate-commit.sh', { timeout: TIMEOUT_MS }, () => {
  /** Roda o hook como o Claude Code roda: evento em JSON no stdin, cwd no repositório. */
  function runHook(dir: string, command: string) {
    return spawnSync(CLAUDE_HOOK, [], {
      cwd: dir,
      env: GIT_ENV,
      encoding: 'utf8',
      input: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        cwd: dir,
        tool_input: { command },
      }),
    });
  }

  it('blocks a commit whose subject does not match the project format', () => {
    const result = runHook(repositoryFrom(cleanTemplate), 'git commit -m "arrumei umas coisas"');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('does not match');
  });

  it('lets a commit in the project format through', () => {
    const command = 'git commit -m "feat(sim): advance simulation using elapsed time (FUN-25)"';

    expect(runHook(repositoryFrom(cleanTemplate), command).status).toBe(0);
  });

  it('lets the commit that closes a merge through', () => {
    const dir = repositoryFrom(conflictedMergeTemplate);

    expect(runHook(dir, 'git commit -m "Merge branch \'feature\' into main"').status).toBe(0);
  });

  it('still blocks a commit outside a merge whose subject starts with "Merge"', () => {
    const dir = repositoryFrom(cleanTemplate);

    expect(runHook(dir, 'git commit -m "Merge branch \'feature\' into main"').status).toBe(2);
  });
});
