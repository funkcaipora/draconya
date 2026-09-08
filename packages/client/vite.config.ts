import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
  server: {
    // A porta vem do ambiente quando existe. Sem isso, o Vite crava a 5173 e uma segunda
    // sessão trabalhando no mesmo repositório — outra ferramenta, outro worktree — não
    // consegue subir o cliente enquanto a primeira estiver de pé.
    port: Number(process.env['PORT']) || 5173,
  },
});
