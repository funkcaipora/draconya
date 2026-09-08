// scripts/source-policy.ts — a política de linguagem do repositório, verificada (ADR 0016).
//
// Código first-party do Draconya é TypeScript. Sem esta checagem a regra vive só na
// documentação, e regra que vive só na documentação é seguida até o dia em que alguém tem
// pressa — um script novo entra em `.mjs` por conveniência, escapa do typecheck, e o padrão
// volta a ser dois.
//
// A varredura usa `git ls-files`, não o disco. Andar pelo filesystem obrigaria a manter uma
// lista de exclusão de node_modules/, dist/, build/ e coverage/ que fica desatualizada — e
// bastaria um `pnpm build` antes do check para `dist/` disparar falso positivo em cima de
// código gerado. "O que o Git rastreia" é exatamente a definição de "mantido pelo projeto".
//
// O custo dessa escolha: arquivo ainda não adicionado ao índice passa despercebido
// localmente. No CI isso não existe — tudo vem de um commit —, e é lá que a regra precisa
// valer, então o alcance da checagem casa com onde ela é imposta.

import { execFileSync } from 'node:child_process';

const FORBIDDEN_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];

/**
 * Exceções: só entram aqui quando uma ferramenta externa EXIGIR JavaScript — limitação real
 * e reproduzível, registrada em ADR. Conveniência não conta, e uma exceção não abre
 * precedente para a próxima. Cada entrada é um caminho exato, relativo à raiz.
 */
const ALLOWED: readonly string[] = [];

function trackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return output.split('\0').filter((path) => path !== '');
}

function main(): number {
  const offenders = trackedFiles().filter(
    (path) =>
      FORBIDDEN_EXTENSIONS.some((extension) => path.endsWith(extension))
      && !ALLOWED.includes(path),
  );

  if (offenders.length === 0) {
    console.log('source-policy: passed — no first-party JavaScript.');
    return 0;
  }

  console.error(`source-policy: ${offenders.length} first-party JavaScript file(s) found.\n`);
  for (const path of offenders) console.error(`  - ${path}`);
  // A mensagem precisa dizer o que fazer, não só o que está errado.
  console.error(
    '\nFirst-party Draconya code is TypeScript (docs/adr/0016-typescript-only-first-party-code.md).'
    + '\nRename these to .ts/.tsx, or — if an external tool genuinely requires JavaScript —'
    + '\nrecord the limitation in an ADR and list the exact path in ALLOWED in this script.',
  );
  return 1;
}

process.exitCode = main();
