#!/usr/bin/env node
// scripts/docs-check.mjs — valida a documentação do harness (harness-plan.md §4.4).
//
// Quatro checagens que derrubam o script, todas sobre a documentação estrutural do
// repositório, nunca sobre o conteúdo em prosa:
//
//   1. Todo diretório em packages/* tem um CLAUDE.md.
//   2. Todo arquivo docs/adr/NNNN-*.md está listado em docs/adr/README.md.
//   3. A numeração dos ADRs não tem buraco nem duplicata.
//   4. Todo link relativo em arquivos .md dentro de docs/ e no CLAUDE.md raiz resolve para
//      um arquivo (ou pasta) existente.
//
// Mais um inventário informativo, que NÃO derruba o script:
//
//   5. As pendências [ABERTO] em docs/product/*.md, com arquivo e linha.
//
// Regra geral do script inteiro: diretório que ainda não existe (packages/, docs/adr/,
// docs/product/) não é erro — é o estado normal de um projeto que ainda não chegou na Fase
// 1. Erro é sempre um arquivo ou link que já existe e está errado, nunca a ausência de algo
// que só vai nascer depois. Isso é o que permite este script rodar limpo hoje, com o
// repositório como está, sem se tornar um script que "sempre falha até a Fase 1 acabar" —
// o que ninguém rodaria.
//
// A checagem 5 já foi uma regra que derrubava o script: exigia responsável indicado em cada
// [ABERTO]. Foi rebaixada a inventário porque a regra não pagava o próprio custo — num projeto
// onde o dono de toda decisão de produto é a mesma pessoa, o campo era sempre o mesmo nome, e
// atribuição de dono e prazo já vive no Linear. Duplicar isso em markdown é a burocracia que o
// plano do harness (§7) diz explicitamente para não criar. O que sobrou é o que tem valor:
// visibilidade de quantas decisões seguem abertas, e onde.
//
// Nem toda ocorrência do texto "[ABERTO]" é um item pendente. Na prática (e pela própria
// skill /product, Passo 3 e Passo 4) uma pendência real sempre vive numa linha de TABELA
// ("Parâmetros de balanceamento") ou num ITEM DE LISTA ("Itens [ABERTO] resolvidos") — nunca
// em parágrafo corrido. Prosa corrida com "[ABERTO]" no meio está falando SOBRE o conceito,
// não registrando uma pendência nova: "Nenhum `[ABERTO]` do PRD atinge este sistema." ou "o
// PRD vem com `[ABERTO]` espalhado por toda parte" são descrição, não item. Por isso só uma
// linha estruturada (tabela ou lista) é candidata; dentro dela, ainda ficam de fora:
//   - resolvida e riscada: "- ~~[ABERTO] texto original~~ → **Resolvido:** valor, em caminho"
//   - negada explicitamente na própria linha estruturada (defesa extra, redundante hoje)
// Só sobra o marcador cru (`[ABERTO]` ou `[ABERTO — valor provisório: X]`) dentro de tabela ou
// lista, que é exatamente o que a skill instrui a escrever para uma pendência de verdade.
//
// Nenhuma dependência externa: só stdlib do Node (fs, path, url).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Problemas agrupados por tipo, na ordem em que aparecem no relatório final. Cada item é
// { path, line, message } — `line` fica null quando o problema não é de uma linha específica
// (ex.: "pacote sem CLAUDE.md" é do diretório inteiro, não de uma linha).
const problems = {
  missingClaudeMd: [],
  unindexedAdr: [],
  adrNumbering: [],
  brokenLink: [],
};

// Avisos: aparecem no relatório, mas NÃO derrubam o docs-check. Ver comentário no topo.
const warnings = {
  openDecisions: [],
};

function record(list, filePath, lineText, messageText) {
  list.push({ path: filePath, line: lineText, message: messageText });
}

function displayPath(absolutePath) {
  return relative(ROOT, absolutePath) || '.';
}

// ---------------------------------------------------------------------------------------
// 1. packages/*/CLAUDE.md
// ---------------------------------------------------------------------------------------
function checkPackageClaudeFiles() {
  const packagesDir = join(ROOT, 'packages');
  if (!existsSync(packagesDir)) return; // Fase 1 ainda não criou o monorepo — nada a checar.

  const entries = readdirSync(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const claudeMd = join(packagesDir, entry.name, 'CLAUDE.md');
    if (!existsSync(claudeMd)) {
      record(
        problems.missingClaudeMd,
        `packages/${entry.name}`,
        null,
        `missing packages/${entry.name}/CLAUDE.md — every package requires its purpose, ` +
          `boundaries and local invariants to be documented (docs/harness-plan.md §2.3).`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------
// 2 e 3. ADRs — indexação em docs/adr/README.md e numeração sem buraco/duplicata
// ---------------------------------------------------------------------------------------
const ADR_PATTERN = /^(\d{4})-.+\.md$/;

function checkAdrs() {
  const adrDir = join(ROOT, 'docs', 'adr');
  if (!existsSync(adrDir)) return; // Nenhum ADR ainda — nada a checar.

  const readmePath = join(adrDir, 'README.md');
  // Se o índice não existe, nenhum ADR está de fato indexado — cada um vira um problema
  // próprio abaixo, em vez de um erro genérico só sobre o índice faltando.
  const readmeContent = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';

  const files = readdirSync(adrDir, { withFileTypes: true }).filter(
    (e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md',
  );

  const numberedFiles = []; // { numero, arquivo }
  for (const file of files) {
    const m = file.name.match(ADR_PATTERN);
    if (!m) {
      record(
        problems.adrNumbering,
        `docs/adr/${file.name}`,
        null,
        `filename does not match NNNN-kebab-title.md — cannot check numbering or ` +
          `indexing for this file.`,
      );
      continue;
    }
    numberedFiles.push({ number: parseInt(m[1], 10), file: file.name });
  }

  // Indexação: cada ADR precisa ter o próprio nome de arquivo citado no índice. Checagem por
  // substring, não por parser de Markdown — robusta a `(0001-foo.md)` com ou sem `./` na
  // frente, e ao texto do link não ser exatamente o número.
  for (const { file } of numberedFiles) {
    if (!readmeContent.includes(file)) {
      record(
        problems.unindexedAdr,
        `docs/adr/${file}`,
        null,
        `ADR exists but is not listed in docs/adr/README.md — the index must reflect ` +
          `all recorded decisions.`,
      );
    }
  }

  // Numeração — duplicata: dois arquivos com o mesmo NNNN.
  const byNumber = new Map();
  for (const { number, file } of numberedFiles) {
    if (!byNumber.has(number)) byNumber.set(number, []);
    byNumber.get(number).push(file);
  }
  for (const [number, filesForNumber] of byNumber) {
    if (filesForNumber.length > 1) {
      record(
        problems.adrNumbering,
        'docs/adr/',
        null,
        `number ${String(number).padStart(4, '0')} duplicated across: ` +
          `${filesForNumber.join(', ')}.`,
      );
    }
  }

  // Numeração — buraco: a sequência deve ser contígua a partir de 0001 até o maior número
  // encontrado. ADR numerado a partir de 1 é a convenção já em uso (harness-plan.md §3.1
  // e o backfill de 0001-0010).
  if (byNumber.size > 0) {
    const highestNumber = Math.max(...byNumber.keys());
    for (let n = 1; n <= highestNumber; n++) {
      if (!byNumber.has(n)) {
        record(
          problems.adrNumbering,
          'docs/adr/',
          null,
          `number ${String(n).padStart(4, '0')} missing from the sequence (highest ADR is ` +
            `${String(highestNumber).padStart(4, '0')}, but this number is absent).`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------------------
// 4. Links relativos em docs/**/*.md e no CLAUDE.md raiz
// ---------------------------------------------------------------------------------------

// Só links inline `[texto](alvo)` são checados — é a única forma usada hoje em todo o
// repositório (confirmado por inspeção antes de escrever este script). Links de referência
// (`[texto][ref]` + `[ref]: alvo`) não são resolvidos; se passarem a ser usados, este script
// precisa crescer junto.
const LINK_PATTERN = /\[([^\]]*)\]\(([^)]+)\)/g;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

function listMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const filePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listMarkdownFiles(filePath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      result.push(filePath);
    }
  }
  return result;
}

function resolveLinkTarget(rawTarget, sourceFile) {
  // Título opcional estilo `(alvo "título")`: fica só a primeira palavra.
  const withoutTitle = rawTarget.trim().split(/\s+/)[0] ?? '';
  // Âncora dentro do arquivo (`#secao`) não é validada, só removida antes de checar o alvo.
  const withoutAnchor = withoutTitle.split('#')[0];
  if (withoutAnchor === '') return null; // Link que é só uma âncora na própria página.

  if (withoutAnchor.startsWith('/')) {
    // Estilo GitHub, relativo à raiz do repositório.
    return join(ROOT, withoutAnchor);
  }
  return resolve(dirname(sourceFile), withoutAnchor);
}

function checkLinks() {
  const files = listMarkdownFiles(join(ROOT, 'docs'));
  const rootClaudeMd = join(ROOT, 'CLAUDE.md');
  if (existsSync(rootClaudeMd)) files.push(rootClaudeMd);

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((lineText, offset) => {
      LINK_PATTERN.lastIndex = 0;
      let m;
      while ((m = LINK_PATTERN.exec(lineText)) !== null) {
        const rawTarget = m[2].trim();
        if (rawTarget === '' || rawTarget.startsWith('#') || rawTarget.startsWith('//')) {
          continue; // âncora na própria página ou link protocol-relative — fora do escopo.
        }
        if (URL_SCHEME_PATTERN.test(rawTarget)) continue; // http:, mailto:, etc. — não é link relativo.

        const resolved = resolveLinkTarget(rawTarget, file);
        if (resolved === null) continue;

        if (!existsSync(resolved)) {
          record(
            problems.brokenLink,
            displayPath(file),
            offset + 1,
            `link to '${rawTarget}' does not resolve to an existing file or directory.`,
          );
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------------------
// 5. [ABERTO] em docs/product/*.md — inventário informativo
// ---------------------------------------------------------------------------------------
const OPEN_DECISION_PATTERN = /\[ABERTO\b/;
const NEGATION_PATTERN = /\bnenhum[a]?\b/i;
const STRUCTURED_LINE_PATTERN = /^\s*(\||[-*+]\s|\d+[.)]\s)/;
const TABLE_LINE_PATTERN = /^\s*\|/;

// Decide se a ocorrência de "[ABERTO" na linha é uma pendência de verdade, não uma menção em
// prosa corrida (ver comentário no topo do arquivo). Precisa estar numa linha estruturada
// (tabela ou item de lista) e não estar riscada nem negada.
function isOpenDecision(lineText) {
  const offset = lineText.search(OPEN_DECISION_PATTERN);
  if (offset === -1) return false;
  if (!STRUCTURED_LINE_PATTERN.test(lineText)) return false; // prosa falando sobre o conceito.
  const before = lineText.slice(0, offset);
  if (/~~\s*$/.test(before)) return false; // "...~~[ABERTO...]~~" — já resolvido e riscado.
  if (NEGATION_PATTERN.test(before)) return false; // "Nenhum ... [ABERTO...]" — resumo, não pendência.
  return true;
}

function listOpenDecisions() {
  const productDir = join(ROOT, 'docs', 'product');
  if (!existsSync(productDir)) return; // docs/product/ ainda não existe — nada a listar.

  const files = readdirSync(productDir, { withFileTypes: true }).filter(
    (e) => e.isFile() && e.name.endsWith('.md'),
  );

  for (const file of files) {
    const filePath = join(productDir, file.name);
    const lines = readFileSync(filePath, 'utf8').split('\n');
    lines.forEach((lineText, offset) => {
      if (!isOpenDecision(lineText)) return;
      record(
        warnings.openDecisions,
        `docs/product/${file.name}`,
        offset + 1,
        lineText.trim().replace(/\s+/g, ' ').slice(0, 120),
      );
    });
  }
}

// ---------------------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------------------
function report() {
  const sections = [
    ['Missing package CLAUDE.md', problems.missingClaudeMd],
    ['ADR missing from docs/adr/README.md', problems.unindexedAdr],
    ['ADR numbering (gap or duplicate)', problems.adrNumbering],
    ['Broken relative link', problems.brokenLink],
  ];

  const total = sections.reduce((sum, [, list]) => sum + list.length, 0);

  if (total === 0) {
    console.log('docs-check: passed — no problems found.');
  } else {
    console.log(`docs-check: ${total} problem(s) found.\n`);
    for (const [title, list] of sections) {
      if (list.length === 0) continue;
      console.log(`## ${title} (${list.length})`);
      for (const problem of list) {
        const local = problem.line != null ? `${problem.path}:${problem.line}` : problem.path;
        console.log(`  - ${local} — ${problem.message}`);
      }
      console.log('');
    }
  }

  // Inventário informativo. Não derruba o check: a atribuição de dono e prazo de uma pendência
  // de produto vive no Linear, não em markdown — duplicar isso aqui seria burocracia que apodrece.
  // O valor deste bloco é visibilidade: quantas decisões seguem abertas, e onde.
  const decisions = warnings.openDecisions;
  if (decisions.length > 0) {
    console.log(`## Open decisions [ABERTO] in docs/product (${decisions.length}) — informational`);
    for (const warning of decisions) {
      console.log(`  - ${warning.path}:${warning.line} — ${warning.message}`);
    }
    console.log('');
  }

  return total === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------------------
// Execução — nunca deve escapar como exceção não tratada; qualquer falha inesperada vira
// saída explicada com código 1, igual a um problema de documentação encontrado.
// ---------------------------------------------------------------------------------------
try {
  checkPackageClaudeFiles();
  checkAdrs();
  checkLinks();
  listOpenDecisions();
  process.exitCode = report();
} catch (error) {
  console.error('docs-check: unexpected failure while running checks (this is a bug in the script).');
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
