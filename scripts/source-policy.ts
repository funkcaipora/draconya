// scripts/source-policy.ts — as políticas de código do repositório, verificadas.
//
// Duas, e a segunda vive aqui pelo mesmo motivo da primeira: regra que só existe na
// documentação é seguida até o dia em que alguém tem pressa.
//
//   1. código first-party é TypeScript (ADR 0016)
//   2. nada em `sim/` conta ticks (FUN-36, invariante 2)
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
import { readFileSync } from 'node:fs';

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

/**
 * Nomes que descrevem um CONTADOR DE TICKS, que é a forma proibida pelo invariante 2.
 *
 * Nomes, e não uma tentativa de detectar a operação: procurar `--` ou `-= 1` daria falso
 * positivo em todo laço do motor, e um check que grita sem motivo é um check que as pessoas
 * aprendem a ignorar. Quem escreve `remainingTicks` está declarando a intenção no nome, e é
 * exatamente essa intenção que a FUN-36 proíbe: cooldown guarda TEMPO, nunca contagem de
 * tick, senão rodar a 1 Hz muda o resultado.
 */
const TICK_COUNTER_NAMES = /\b(?:ticksLeft|ticksRemaining|remainingTicks|tickCount(?:er|down)|ticksUntil|cooldownTicks|durationTicks)\b/;

function tickCounters(paths: readonly string[]): string[] {
  const found: string[] = [];
  for (const path of paths) {
    if (!path.startsWith('packages/sim/src/') || !path.endsWith('.ts')) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) => {
      // A própria lista de nomes proibidos casa com o padrão. Sem esta saída, o check
      // reprovaria o arquivo que o define — que foi exatamente o que aconteceu duas vezes
      // com checagens parecidas neste repositório.
      if (line.includes('TICK_COUNTER_NAMES')) return;
      if (TICK_COUNTER_NAMES.test(line)) found.push(`${path}:${index + 1}`);
    });
  }
  return found;
}

function main(): number {
  const tracked = trackedFiles();
  const counters = tickCounters(tracked);
  if (counters.length > 0) {
    console.error(`source-policy: ${counters.length} tick counter(s) found in packages/sim.\n`);
    for (const where of counters) console.error(`  - ${where}`);
    console.error(
      '\nNothing in sim/ is written "per tick" (invariant 2): every calculation takes dtMs,'
      + '\nand a cooldown stores a time, never a decremented count. A count makes the same'
      + '\nsession render differently at 1 Hz and at 10 Hz. See packages/sim/AGENTS.md.',
    );
    return 1;
  }

  const offenders = tracked.filter(
    (path) =>
      FORBIDDEN_EXTENSIONS.some((extension) => path.endsWith(extension))
      && !ALLOWED.includes(path),
  );

  if (offenders.length === 0) {
    console.log('source-policy: passed — no first-party JavaScript, no tick counters in sim.');
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
