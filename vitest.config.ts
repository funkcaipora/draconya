import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Os pacotes do workspace resolvem para `src`, não para `dist`, durante os testes.
// Sem isso, `pnpm test` passaria a exigir `pnpm build` antes — ordem que sempre é esquecida.
const pkg = (nome: string) =>
  fileURLToPath(new URL(`./packages/${nome}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@draconya/protocol': pkg('protocol'),
      '@draconya/content': pkg('content'),
      '@draconya/sim': pkg('sim'),
      '@draconya/server': pkg('server'),
      '@draconya/tools': pkg('tools'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
