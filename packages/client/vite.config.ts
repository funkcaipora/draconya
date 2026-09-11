import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/**
 * Serve `/things/` em desenvolvimento, a partir de `things/` na raiz do repositório (FUN-23).
 *
 * Por que um middleware e não `publicDir`: `vite build` copia o publicDir inteiro para `dist`,
 * e o pacote de assets passa de 170 MB. E por que não `resolve.alias`: `things/` é ignorado
 * pelo Git e costuma ser um symlink para fora do repositório, e o guarda de sistema de
 * arquivos do Vite resolve o realpath e recusaria.
 *
 * Em produção quem serve é o nginx (`deploy/nginx.conf`), do mesmo caminho `/things/` — a URL
 * é a mesma nos dois, e é isso que `VITE_THINGS_URL=/things/<versão>` promete.
 */
function serveThings(): Plugin {
  const TYPES: Record<string, string> = {
    '.json': 'application/json', '.dat': 'application/octet-stream',
    '.lzma': 'application/octet-stream', '.png': 'image/png',
  };
  return {
    name: 'draconya-serve-things',
    configureServer(server) {
      const dir = join(REPO_ROOT, 'things');
      if (!existsSync(dir)) return;
      // O realpath do ALVO, e todo pedido é conferido contra ele: sem isto, `../` na URL sai
      // de `things/` e lê qualquer arquivo da máquina de quem está desenvolvendo.
      const root = realpathSync(dir);
      server.middlewares.use('/things', (request, response, next) => {
        const path = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
        const target = resolve(root, `.${path}`);
        if (!target.startsWith(root + sep) || !existsSync(target) || !statSync(target).isFile()) {
          next();
          return;
        }
        response.setHeader('Content-Type', TYPES[extname(target)] ?? 'application/octet-stream');
        // O hash está no nome do arquivo: o conteúdo de uma URL nunca muda.
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        createReadStream(target).pipe(response);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveThings()],
  // O `.env` é UM, na raiz do repositório — o mesmo que `pnpm dev` lê para o servidor. Sem
  // isto o Vite procura `packages/client/.env`, não acha, e `VITE_THINGS_URL` chega como
  // `undefined` mesmo estando definido a duas pastas de distância.
  envDir: REPO_ROOT,
  build: { target: 'es2022' },
  server: {
    // A porta vem do ambiente quando existe. Sem isso, o Vite crava a 5173 e uma segunda
    // sessão trabalhando no mesmo repositório — outra ferramenta, outro worktree — não
    // consegue subir o cliente enquanto a primeira estiver de pé.
    port: Number(process.env['PORT']) || 5173,
  },
});
