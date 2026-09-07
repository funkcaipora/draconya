#!/usr/bin/env node
// scripts/docs-check.mjs — valida a documentação do harness (plano-harness.md §4.4).
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
//   5. As pendências [ABERTO] em docs/produto/*.md, com arquivo e linha.
//
// Regra geral do script inteiro: diretório que ainda não existe (packages/, docs/adr/,
// docs/produto/) não é erro — é o estado normal de um projeto que ainda não chegou na Fase
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
// skill /produto, Passo 3 e Passo 4) uma pendência real sempre vive numa linha de TABELA
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
const problemas = {
  claudeMdAusente: [],
  adrNaoIndexado: [],
  adrNumeracao: [],
  linkQuebrado: [],
};

// Avisos: aparecem no relatório, mas NÃO derrubam o docs-check. Ver comentário no topo.
const avisos = {
  pendenciasAbertas: [],
};

function registrar(lista, caminho, linha, mensagem) {
  lista.push({ path: caminho, line: linha, message: mensagem });
}

function paraExibicao(caminhoAbsoluto) {
  return relative(ROOT, caminhoAbsoluto) || '.';
}

// ---------------------------------------------------------------------------------------
// 1. packages/*/CLAUDE.md
// ---------------------------------------------------------------------------------------
function checarClaudeMdDosPacotes() {
  const packagesDir = join(ROOT, 'packages');
  if (!existsSync(packagesDir)) return; // Fase 1 ainda não criou o monorepo — nada a checar.

  const entradas = readdirSync(packagesDir, { withFileTypes: true });
  for (const entrada of entradas) {
    if (!entrada.isDirectory()) continue;
    const claudeMd = join(packagesDir, entrada.name, 'CLAUDE.md');
    if (!existsSync(claudeMd)) {
      registrar(
        problemas.claudeMdAusente,
        `packages/${entrada.name}`,
        null,
        `falta packages/${entrada.name}/CLAUDE.md — todo pacote precisa de propósito, ` +
          `fronteiras e invariantes locais documentados (docs/plano-harness.md §2.3).`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------
// 2 e 3. ADRs — indexação em docs/adr/README.md e numeração sem buraco/duplicata
// ---------------------------------------------------------------------------------------
const PADRAO_ADR = /^(\d{4})-.+\.md$/;

function checarAdrs() {
  const adrDir = join(ROOT, 'docs', 'adr');
  if (!existsSync(adrDir)) return; // Nenhum ADR ainda — nada a checar.

  const readmePath = join(adrDir, 'README.md');
  // Se o índice não existe, nenhum ADR está de fato indexado — cada um vira um problema
  // próprio abaixo, em vez de um erro genérico só sobre o índice faltando.
  const readmeConteudo = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';

  const arquivos = readdirSync(adrDir, { withFileTypes: true }).filter(
    (e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'README.md',
  );

  const numerados = []; // { numero, arquivo }
  for (const arquivo of arquivos) {
    const m = arquivo.name.match(PADRAO_ADR);
    if (!m) {
      registrar(
        problemas.adrNumeracao,
        `docs/adr/${arquivo.name}`,
        null,
        `nome fora do padrão NNNN-titulo-em-kebab.md — não dá para checar numeração nem ` +
          `indexação para este arquivo.`,
      );
      continue;
    }
    numerados.push({ numero: parseInt(m[1], 10), arquivo: arquivo.name });
  }

  // Indexação: cada ADR precisa ter o próprio nome de arquivo citado no índice. Checagem por
  // substring, não por parser de Markdown — robusta a `(0001-foo.md)` com ou sem `./` na
  // frente, e ao texto do link não ser exatamente o número.
  for (const { arquivo } of numerados) {
    if (!readmeConteudo.includes(arquivo)) {
      registrar(
        problemas.adrNaoIndexado,
        `docs/adr/${arquivo}`,
        null,
        `ADR existe mas não está citado em docs/adr/README.md — o índice ficaria mentindo ` +
          `sobre quantas decisões existem.`,
      );
    }
  }

  // Numeração — duplicata: dois arquivos com o mesmo NNNN.
  const porNumero = new Map();
  for (const { numero, arquivo } of numerados) {
    if (!porNumero.has(numero)) porNumero.set(numero, []);
    porNumero.get(numero).push(arquivo);
  }
  for (const [numero, arquivosDoNumero] of porNumero) {
    if (arquivosDoNumero.length > 1) {
      registrar(
        problemas.adrNumeracao,
        'docs/adr/',
        null,
        `número ${String(numero).padStart(4, '0')} duplicado entre: ` +
          `${arquivosDoNumero.join(', ')}.`,
      );
    }
  }

  // Numeração — buraco: a sequência deve ser contígua a partir de 0001 até o maior número
  // encontrado. ADR numerado a partir de 1 é a convenção já em uso (plano-harness.md §3.1
  // e o backfill de 0001-0010).
  if (porNumero.size > 0) {
    const maiorNumero = Math.max(...porNumero.keys());
    for (let n = 1; n <= maiorNumero; n++) {
      if (!porNumero.has(n)) {
        registrar(
          problemas.adrNumeracao,
          'docs/adr/',
          null,
          `número ${String(n).padStart(4, '0')} ausente na sequência (existe ADR até ` +
            `${String(maiorNumero).padStart(4, '0')}, mas este número não aparece).`,
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
const PADRAO_LINK = /\[([^\]]*)\]\(([^)]+)\)/g;
const PADRAO_ESQUEMA_URL = /^[a-z][a-z0-9+.-]*:/i;

function listarArquivosMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const resultado = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...listarArquivosMarkdown(caminho));
    } else if (entrada.isFile() && entrada.name.endsWith('.md')) {
      resultado.push(caminho);
    }
  }
  return resultado;
}

function resolverAlvoDoLink(alvoBruto, arquivoOrigem) {
  // Título opcional estilo `(alvo "título")`: fica só a primeira palavra.
  const semTitulo = alvoBruto.trim().split(/\s+/)[0] ?? '';
  // Âncora dentro do arquivo (`#secao`) não é validada, só removida antes de checar o alvo.
  const semAncora = semTitulo.split('#')[0];
  if (semAncora === '') return null; // Link que é só uma âncora na própria página.

  if (semAncora.startsWith('/')) {
    // Estilo GitHub, relativo à raiz do repositório.
    return join(ROOT, semAncora);
  }
  return resolve(dirname(arquivoOrigem), semAncora);
}

function checarLinks() {
  const arquivos = listarArquivosMarkdown(join(ROOT, 'docs'));
  const claudeMdRaiz = join(ROOT, 'CLAUDE.md');
  if (existsSync(claudeMdRaiz)) arquivos.push(claudeMdRaiz);

  for (const arquivo of arquivos) {
    const linhas = readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((linha, indice) => {
      PADRAO_LINK.lastIndex = 0;
      let m;
      while ((m = PADRAO_LINK.exec(linha)) !== null) {
        const alvoBruto = m[2].trim();
        if (alvoBruto === '' || alvoBruto.startsWith('#') || alvoBruto.startsWith('//')) {
          continue; // âncora na própria página ou link protocol-relative — fora do escopo.
        }
        if (PADRAO_ESQUEMA_URL.test(alvoBruto)) continue; // http:, mailto:, etc. — não é link relativo.

        const resolvido = resolverAlvoDoLink(alvoBruto, arquivo);
        if (resolvido === null) continue;

        if (!existsSync(resolvido)) {
          registrar(
            problemas.linkQuebrado,
            paraExibicao(arquivo),
            indice + 1,
            `link para '${alvoBruto}' não resolve para nenhum arquivo ou pasta existente.`,
          );
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------------------
// 5. [ABERTO] em docs/produto/*.md — inventário informativo
// ---------------------------------------------------------------------------------------
const PADRAO_ABERTO = /\[ABERTO\b/;
const PADRAO_NEGACAO = /\bnenhum[a]?\b/i;
const PADRAO_LINHA_ESTRUTURADA = /^\s*(\||[-*+]\s|\d+[.)]\s)/;
const PADRAO_LINHA_DE_TABELA = /^\s*\|/;

// Decide se a ocorrência de "[ABERTO" na linha é uma pendência de verdade, não uma menção em
// prosa corrida (ver comentário no topo do arquivo). Precisa estar numa linha estruturada
// (tabela ou item de lista) e não estar riscada nem negada.
function ehAbertoPendente(linha) {
  const indice = linha.search(PADRAO_ABERTO);
  if (indice === -1) return false;
  if (!PADRAO_LINHA_ESTRUTURADA.test(linha)) return false; // prosa falando sobre o conceito.
  const antes = linha.slice(0, indice);
  if (/~~\s*$/.test(antes)) return false; // "...~~[ABERTO...]~~" — já resolvido e riscado.
  if (PADRAO_NEGACAO.test(antes)) return false; // "Nenhum ... [ABERTO...]" — resumo, não pendência.
  return true;
}

function listarPendenciasAbertas() {
  const produtoDir = join(ROOT, 'docs', 'produto');
  if (!existsSync(produtoDir)) return; // docs/produto/ ainda não existe — nada a listar.

  const arquivos = readdirSync(produtoDir, { withFileTypes: true }).filter(
    (e) => e.isFile() && e.name.endsWith('.md'),
  );

  for (const arquivo of arquivos) {
    const caminho = join(produtoDir, arquivo.name);
    const linhas = readFileSync(caminho, 'utf8').split('\n');
    linhas.forEach((linha, indice) => {
      if (!ehAbertoPendente(linha)) return;
      registrar(
        avisos.pendenciasAbertas,
        `docs/produto/${arquivo.name}`,
        indice + 1,
        linha.trim().replace(/\s+/g, ' ').slice(0, 120),
      );
    });
  }
}

// ---------------------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------------------
function relatar() {
  const secoes = [
    ['CLAUDE.md ausente em pacote', problemas.claudeMdAusente],
    ['ADR não indexado em docs/adr/README.md', problemas.adrNaoIndexado],
    ['Numeração de ADR (buraco ou duplicata)', problemas.adrNumeracao],
    ['Link relativo quebrado', problemas.linkQuebrado],
  ];

  const total = secoes.reduce((soma, [, lista]) => soma + lista.length, 0);

  if (total === 0) {
    console.log('docs-check: tudo certo — nenhum problema encontrado.');
  } else {
    console.log(`docs-check: ${total} problema(s) encontrado(s).\n`);
    for (const [titulo, lista] of secoes) {
      if (lista.length === 0) continue;
      console.log(`## ${titulo} (${lista.length})`);
      for (const problema of lista) {
        const local = problema.line != null ? `${problema.path}:${problema.line}` : problema.path;
        console.log(`  - ${local} — ${problema.message}`);
      }
      console.log('');
    }
  }

  // Inventário informativo. Não derruba o check: a atribuição de dono e prazo de uma pendência
  // de produto vive no Linear, não em markdown — duplicar isso aqui seria burocracia que apodrece.
  // O valor deste bloco é visibilidade: quantas decisões seguem abertas, e onde.
  const pendencias = avisos.pendenciasAbertas;
  if (pendencias.length > 0) {
    console.log(`## Pendências [ABERTO] em docs/produto (${pendencias.length}) — informativo`);
    for (const aviso of pendencias) {
      console.log(`  - ${aviso.path}:${aviso.line} — ${aviso.message}`);
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
  checarClaudeMdDosPacotes();
  checarAdrs();
  checarLinks();
  listarPendenciasAbertas();
  process.exitCode = relatar();
} catch (erro) {
  console.error('docs-check: falha inesperada ao rodar as checagens (isto é um bug no próprio script).');
  console.error(erro instanceof Error ? erro.stack : String(erro));
  process.exitCode = 1;
}
