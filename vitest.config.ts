import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Os pacotes do workspace resolvem para `src`, não para `dist`, durante os testes.
// Sem isso, `pnpm test` passaria a exigir `pnpm build` antes — ordem que sempre é esquecida.
const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const alias = {
  // Mais específico ANTES do geral: aliases de string casam por PREFIXO (`@rollup/plugin-
  // alias`), e `@draconya/content` sozinho casaria `@draconya/content/load` primeiro e
  // devolveria `.../content/src/index.ts/load` — um caminho que não existe.
  '@draconya/content/load': fileURLToPath(new URL('./packages/content/src/load.ts', import.meta.url)),
  '@draconya/protocol': pkg('protocol'),
  '@draconya/content': pkg('content'),
  '@draconya/sim': pkg('sim'),
  '@draconya/server': pkg('server'),
  '@draconya/tools': pkg('tools'),
};

/**
 * Os arquivos que tocam Postgres se chamam `*.postgres.test.ts`, e é o NOME que os põe no
 * projeto certo (FUN-102): cada um cria um schema e roda as migrações, e cinco deles
 * migrando e consultando ao mesmo tempo, contra um Postgres só — de UMA CPU, na máquina de
 * desenvolvimento —, era o que reprovava doze testes sortidos por timeout com um jogo aberto
 * ao lado. Aqui eles rodam no máximo DOIS por vez, sem serializar o resto da suíte, que
 * continua em paralelo no outro projeto. Dois, e não um: um de cada vez custava 14 s contra
 * 6,5 s da suíte inteira, porque os dois critérios de saída (FUN-30, FUN-91) levam quatro e
 * cinco segundos cada e ficavam em fila; a dois eles se sobrepõem e a suíte fica em ~8 s.
 * `testing/database.test.ts` reprova o arquivo que usa o banco sem o sufixo.
 */
const POSTGRES = 'packages/*/src/**/*.postgres.test.ts';

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'postgres',
          include: [POSTGRES],
          environment: 'node',
          maxWorkers: 2,
          // Projetos com `maxWorkers` diferentes precisam de grupos distintos (é regra do
          // Vitest 5); o grupo 0 roda antes do 1.
          sequence: { groupOrder: 0 },
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['**/node_modules/**', POSTGRES],
          environment: 'node',
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
