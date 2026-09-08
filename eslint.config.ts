// eslint.config.ts — lint de fronteiras entre pacotes (Draconya)
//
// Este arquivo implementa em código a tabela de camadas descrita em
// docs/boundaries.md e em docs/harness-plan.md §4.2: "quem pode importar
// quem" deixa de ser um combinado em prosa e vira erro de build. A tabela
// em docs/boundaries.md é normativa — mudou uma fronteira aqui, muda lá,
// e vice-versa.
//
// TypeScript, e não JavaScript, por decisão de política: código first-party do Draconya é
// TypeScript (ADR 0016). O ESLint carrega config em TypeScript via `jiti`, sem flag e sem
// wrapper — `eslint .` continua sendo o comando.
//
// Por que `no-restricted-imports` e não eslint-plugin-boundaries:
// é uma regra nativa do ESLint e não pede plugin novo. A lista de bibliotecas
// fixas (ADR 0011) é curta de propósito, e o valor dela é ser curta.
//
// Como o casamento de padrão funciona (importante para quem for mexer
// aqui): cada string em `patterns[].group` é tratada como uma regra estilo
// .gitignore (é a mesma biblioteca por baixo). Isso significa que o nome
// nu de um pacote, sem nenhum curinga, já basta para cobrir as quatro
// formas de import que importam:
//   - specifier exato:        "sim"
//   - subcaminho:              "sim/qualquer-coisa"
//   - pacote com escopo:       "@algum-escopo/sim"
//   - import relativo cru:     "../../sim/src/index"
// Isso foi verificado empiricamente (ESLint 9 e 10) antes de escrever este
// arquivo — não é suposição. A única forma de import que ESCAPA da regra é
// um caminho relativo para dentro do próprio pacote que, por coincidência,
// tenha um segmento com o nome exato de outro pacote (ex.: server/ ter um
// arquivo local `./client.ts` para "cliente HTTP de outro serviço"). Isso é
// aceito deliberadamente: o custo de um falso positivo (renomear um arquivo
// local ambíguo) é muito menor que o de um falso negativo (import proibido
// que passa batido). Também por isso as regras abaixo não tentam cobrir
// `require()` — a stack é ESM por decisão de arquitetura (docs/architecture.md).
//
// Por que os padrões abaixo são estáticos (não leem packages/ em disco):
// os seis pacotes já estão decididos (docs/technical-architecture.md §17, E0).
// Escanear o diretório para descobrir pacotes só adicionaria uma leitura de
// disco no carregamento do config sem nenhum ganho — e um `files` que não
// casa com nada não é erro em flat config, então isto não quebra hoje, com
// packages/ vazio ou inexistente, nem quando só parte dos seis pacotes já
// tiver nascido.

import type { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';

/**
 * Glob dos arquivos-fonte de um pacote.
 *
 * As extensões de JavaScript continuam listadas mesmo com a política do ADR 0016: se um
 * `.js` first-party reaparecer, ele precisa cair nas regras de fronteira e não passar
 * despercebido enquanto o `source-policy` não roda.
 */
function pkg(name: string): string {
  return `packages/${name}/**/*.{js,jsx,mjs,cjs,ts,tsx}`;
}

const SEE_DOC = 'See docs/boundaries.md.';

// Módulos de I/O, rede, banco e framework que sim/ nunca pode importar
// (invariante 1 do CLAUDE.md raiz / harness-plan.md §2.2: "sim/ é puro —
// sem I/O, sem framework, sem rede, sem banco, sem relógio global").
// "node:*" cobre qualquer builtin do Node já no formato prefixado (com ou
// sem subcaminho, ex.: "node:fs/promises"); a lista abaixo cobre as formas
// sem prefixo mais comuns, e os pacotes de terceiros que a arquitetura já
// nomeou (docs/architecture.md e docs/technical-architecture.md §2, §7). Lista
// não exaustiva — some aqui qualquer novo cliente de banco, fila ou
// framework HTTP que sim/ tentar importar no futuro.
const SIM_IO_PATTERNS = [
  'node:*',
  'fs',
  'net',
  'http',
  'https',
  'tls',
  'dns',
  'dgram',
  'child_process',
  'pg',
  'postgres',
  'redis',
  'ioredis',
  'uWebSockets.js',
  'ws',
  'express',
  'fastify',
];

const config: Linter.Config[] = [
  // Parser de TypeScript. O parser padrão do ESLint (espree) não entende sintaxe de tipos nem
  // JSX; sem este bloco, todo arquivo .ts falha com "Parsing error" antes de qualquer regra de
  // fronteira rodar. Só o parser — nenhuma regra do typescript-eslint —, porque o propósito
  // deste config é impor as fronteiras de import, não estilo.
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
    ],
  },

  // protocol — pode importar: nada interno. Não pode importar: nenhum
  // outro pacote do monorepo.
  //
  // protocol/ é a raiz da árvore de dependências: é o único pacote que
  // client/ e server/ (que nunca podem se importar) compartilham. Os
  // opcodes vivem só aqui, num arquivo, como fonte única das duas tabelas
  // (invariante 5). Se protocol/ importasse de outro pacote, essa
  // neutralidade desapareceria — client/server passariam a compartilhar,
  // por tabela, também a lógica desse outro pacote.
  {
    files: [pkg('protocol')],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['content', 'sim', 'server', 'client', 'tools'],
            message:
              "protocol/ defines shared opcodes and messages and cannot depend on another workspace package. " + SEE_DOC,
          },
        ],
      }],
    },
  },

  // content — pode importar: protocol. Não pode importar: sim, server,
  // client, tools.
  //
  // content/ descreve dados de jogo (monstros, hunts, itens, magias,
  // vocações — technical-architecture.md §8) e nunca contém arte (invariante
  // 6). É lido por processos bem diferentes: o servidor de jogo, o
  // cliente, e futuras ferramentas de balanceamento. Se dependesse de
  // quem o consome, deixaria de poder ser lido por qualquer um deles
  // isoladamente.
  {
    files: [pkg('content')],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['sim', 'server', 'client', 'tools'],
            message:
              "content/ defines game data and may only import protocol/ for shared types. " + SEE_DOC,
          },
        ],
      }],
    },
  },

  // sim — pode importar: protocol, content. Não pode importar: server,
  // client, tools, e nenhuma forma de I/O.
  //
  // Esta é a fronteira mais importante do projeto (harness-plan.md §4.2).
  // Duas regras distintas, tratadas em separado porque a razão de cada
  // uma é diferente: uma é sobre camadas (sim não conhece quem o hospeda),
  // a outra é sobre pureza (sim não toca em nada que não seja o próprio
  // estado e o dtMs recebido).
  {
    files: [pkg('sim')],
    rules: {
      'no-restricted-globals': ['error', {
        globals: [
          {
            name: 'Date',
            message: "sim/ receives time as a parameter. The real clock belongs in server/. " + SEE_DOC,
          },
          {
            name: 'performance',
            message: "sim/ receives time as a parameter. The real clock belongs in server/. " + SEE_DOC,
          },
        ],
        checkGlobalObject: true,
      }],
      'no-restricted-imports': ['error', {
        patterns: [
          {
            // content/ has two entry points: "." is pure (schemas and types) and "/load"
            // reads disk with node:fs. Importing the loader here would drag I/O into sim/
            // transitively — without a single node:* import appearing in this package,
            // which is what makes the violation hard to spot in review.
            group: ['@draconya/content/load', '**/content/src/load*'],
            message:
              "sim/ is pure: import only the '@draconya/content' entry point. Disk reads " +
              "belong to server/ and tools/. " + SEE_DOC,
          },
          {
            group: ['server', 'client', 'tools'],
            message:
              "sim/ cannot import its hosts: server/, client/ or tools/. " + SEE_DOC,
          },
          {
            group: SIM_IO_PATTERNS,
            message:
              "sim/ must remain pure: no I/O, network, database, framework or global clock. Pass elapsed time explicitly. " + SEE_DOC,
          },
        ],
      }],
    },
  },

  // server — pode importar: protocol, content, sim. Não pode importar:
  // client.
  //
  // server/ roda em Node; client/ roda no navegador. Não há ambiguidade
  // aqui — a única fronteira dura é essa. (tools/ fica de fora da lista de
  // proibidos de propósito: server/ pode usar utilitário operacional de
  // tools/ quando fizer sentido, por exemplo no processo `jobs`; ver
  // docs/boundaries.md para o raciocínio completo.)
  {
    files: [pkg('server')],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['client'],
            message:
              "server/ runs on Node and cannot depend on browser client code. " + SEE_DOC,
          },
        ],
      }],
    },
  },

  // client — pode importar: protocol, content. Não pode importar: sim,
  // server, tools.
  //
  // O cliente só manda intenção — nunca dano, posição resolvida, loot, XP
  // ou resultado de transação (invariante 4). Mandar sim/ ou server/ para
  // o bundle do navegador exporia e tornaria alterável no cliente
  // exatamente a lógica que decide esse resultado.
  {
    files: [pkg('client')],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['sim', 'server', 'tools'],
            message:
              "client/ only sends intentions and cannot import authoritative simulation, server or operational tools. " + SEE_DOC,
          },
        ],
      }],
    },
  },

  // tools — pode importar: todos. Não pode importar: nada é restrito.
  //
  // Sem entrada aqui de propósito: tools/ é o topo da árvore (scripts de
  // operação, importadores de conteúdo, cliente sintético de carga —
  // technical-architecture.md §17, E0) e por isso tem acesso irrestrito aos
  // outros cinco pacotes. Nada deveria importar DE tools/ (é por isso que
  // ele aparece na lista de proibidos de content/, sim/ e client/), mas
  // tools/ importar de qualquer um dos outros é esperado e sadio.
];

export default config;
