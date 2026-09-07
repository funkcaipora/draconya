// eslint.config.js — lint de fronteiras entre pacotes (Draconya)
//
// Este arquivo implementa em código a tabela de camadas descrita em
// docs/fronteiras.md e em docs/plano-harness.md §4.2: "quem pode importar
// quem" deixa de ser um combinado em prosa e vira erro de build. A tabela
// em docs/fronteiras.md é normativa — mudou uma fronteira aqui, muda lá,
// e vice-versa.
//
// Por que CommonJS (`module.exports`) e não `export default`:
// hoje não existe package.json em lugar nenhum do repositório, e sem um
// campo "type" declarado o Node trata todo .js como CommonJS por padrão.
// Escrever este arquivo em ESM faria ele quebrar por SyntaxError antes de
// chegar perto de qualquer regra de lint — exatamente o tipo de explosão
// que este arquivo precisa evitar enquanto a Fase 1 não existe. Quando a
// Fase 1 criar o package.json raiz do monorepo (presumivelmente com
// "type": "module", dado que o resto da stack é TypeScript/ESM), este
// arquivo deve ser convertido para `export default` ou renomeado para
// eslint.config.cjs — ESLint aceita as duas formas.
//
// Por que `no-restricted-imports` e não eslint-plugin-boundaries:
// é uma regra nativa do ESLint, não pede dependência nova — e como ainda
// não existe package.json, não haveria nem onde declarar essa dependência.
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
// `require()` — a stack é ESM por decisão de arquitetura (docs/arquitetura.md).
//
// Formato de módulo: ESM (`export default`). Este arquivo nasceu em CommonJS porque, quando foi
// escrito, ainda não existia `package.json` na raiz e o Node trataria `.js` como CommonJS por
// padrão. Com o monorepo criado e `"type": "module"` na raiz, CommonJS passou a quebrar o
// carregamento do config — a conversão foi feita junto com o scaffold.
//
// Por que os padrões abaixo são estáticos (não leem packages/ em disco):
// os seis pacotes já estão decididos (docs/arquitetura-tecnica.md §17, E0).
// Escanear o diretório para descobrir pacotes só adicionaria uma leitura de
// disco no carregamento do config sem nenhum ganho — e um `files` que não
// casa com nada não é erro em flat config, então isto não quebra hoje, com
// packages/ vazio ou inexistente, nem quando só parte dos seis pacotes já
// tiver nascido.

'use strict';

/** Glob dos arquivos-fonte de um pacote. .ts/.tsx já cobertos para quando a
 * Fase 1 trouxer TypeScript: no modo flat config, `eslint .` amplia
 * automaticamente as extensões varridas com base nas extensões citadas em
 * `files` de qualquer bloco, então nenhum ajuste extra vai ser necessário
 * só por causa da extensão do arquivo. */
function pkg(name) {
  return `packages/${name}/**/*.{js,jsx,mjs,cjs,ts,tsx}`;
}

const VER_DOC = 'Ver docs/fronteiras.md.';

// Módulos de I/O, rede, banco e framework que sim/ nunca pode importar
// (invariante 1 do CLAUDE.md raiz / plano-harness.md §2.2: "sim/ é puro —
// sem I/O, sem framework, sem rede, sem banco, sem relógio global").
// "node:*" cobre qualquer builtin do Node já no formato prefixado (com ou
// sem subcaminho, ex.: "node:fs/promises"); a lista abaixo cobre as formas
// sem prefixo mais comuns, e os pacotes de terceiros que a arquitetura já
// nomeou (docs/arquitetura.md e docs/arquitetura-tecnica.md §2, §7). Lista
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

import tsParser from '@typescript-eslint/parser';

export default [
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
              'protocol/ é a raiz da árvore de dependências: client/ e server/ (que nunca podem ' +
              'se importar) só compartilham código porque protocol/ não depende de nenhum dos ' +
              'dois. Opcodes e tipos de mensagem vivem só aqui, como fonte única das duas tabelas. ' +
              VER_DOC,
          },
        ],
      }],
    },
  },

  // content — pode importar: protocol. Não pode importar: sim, server,
  // client, tools.
  //
  // content/ descreve dados de jogo (monstros, hunts, itens, magias,
  // vocações — arquitetura-tecnica.md §8) e nunca contém arte (invariante
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
              'content/ é dado de jogo (stats, hunts, itens, magias) e só depende de protocol/ ' +
              'para tipos. sim/, server/, client/ e tools/ são consumidores desse dado — se ' +
              'content/ importasse de algum deles, o mesmo arquivo de conteúdo deixaria de poder ' +
              'ser lido por processos diferentes (jogo, cliente, ferramenta de balanceamento) sem ' +
              'arrastar o resto do monólito junto. ' + VER_DOC,
          },
        ],
      }],
    },
  },

  // sim — pode importar: protocol, content. Não pode importar: server,
  // client, tools, e nenhuma forma de I/O.
  //
  // Esta é a fronteira mais importante do projeto (plano-harness.md §4.2).
  // Duas regras distintas, tratadas em separado porque a razão de cada
  // uma é diferente: uma é sobre camadas (sim não conhece quem o hospeda),
  // a outra é sobre pureza (sim não toca em nada que não seja o próprio
  // estado e o dtMs recebido).
  {
    files: [pkg('sim')],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['server', 'client', 'tools'],
            message:
              'sim/ é o núcleo de simulação e não conhece quem o hospeda: a mesma lógica de tick, ' +
              'combate e bot precisa dar resultado idêntico rodando em teste, em carga sintética ' +
              'ou em produção, sem nenhuma pista de como o resultado chega até alguém (nem ' +
              'servidor, nem cliente, nem ferramenta). ' + VER_DOC,
          },
          {
            group: SIM_IO_PATTERNS,
            message:
              'sim/ é puro por decisão de arquitetura (docs/arquitetura.md): sem I/O, sem rede, ' +
              'sem banco, sem framework, sem relógio global — todo cálculo é função só do dtMs ' +
              'recebido e do estado já em memória. É essa pureza que permite rodar a mesma hunt a ' +
              '10 Hz anexada e a 1-2 Hz desanexada com resultado idêntico, testar combate e bot ' +
              'sem subir servidor, Postgres ou Redis, e — se o custo de CPU virar gargalo algum ' +
              'dia — reescrever o núcleo em Rust ou Go sem tocar no protocolo nem no cliente. I/O ' +
              'e framework HTTP/WebSocket vivem em server/. ' + VER_DOC,
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
  // docs/fronteiras.md para o raciocínio completo.)
  {
    files: [pkg('server')],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['client'],
            message:
              'server/ roda em Node e nunca importa client/: um processo de jogo não pode ' +
              'depender de código que pressupõe DOM, React ou o bundler do navegador. Tipos e ' +
              'regras compartilhados vêm de protocol/, content/ e sim/ — nunca do pacote que roda ' +
              'no browser de outra pessoa. ' + VER_DOC,
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
              'client/ roda no navegador de qualquer jogador. Enviar sim/ ou server/ para o ' +
              'bundle exporia e tornaria alterável no browser a lógica que decide dano, loot e ' +
              'economia — o cliente só manda intenção, o resultado é sempre calculado no servidor. ' +
              'tools/ fica de fora por ser código de operação/offline, que não deveria ser ' +
              'distribuído ao jogador. ' + VER_DOC,
          },
        ],
      }],
    },
  },

  // tools — pode importar: todos. Não pode importar: nada é restrito.
  //
  // Sem entrada aqui de propósito: tools/ é o topo da árvore (scripts de
  // operação, importadores de conteúdo, cliente sintético de carga —
  // arquitetura-tecnica.md §17, E0) e por isso tem acesso irrestrito aos
  // outros cinco pacotes. Nada deveria importar DE tools/ (é por isso que
  // ele aparece na lista de proibidos de content/, sim/ e client/), mas
  // tools/ importar de qualquer um dos outros é esperado e sadio.
];
