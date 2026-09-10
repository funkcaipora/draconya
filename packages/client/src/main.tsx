// Entrada do cliente. Ver packages/client/CLAUDE.md.
//
// Estado em `src/state/` (FUN-22), mundo em `src/world/` (FUN-23), conexão em `src/net/` e a
// casca em `src/shell/` (FUN-24).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './shell/Shell.js';
import { Entry } from './shell/Entry.js';
import { useConnection } from './shell/useConnection.js';
import { useStoreSlice } from './state/useSlice.js';
import { account } from './account/store.js';
import './shell/shell.css';

/**
 * Atalho de desenvolvimento: `?character=<id>` entra direto, sem passar pela tela.
 *
 * Continua existindo de propósito. O critério de saída da F1 (`phase-one-exit.test.ts`) e o
 * cliente sintético de carga (`pnpm load`) entram sem tela nenhuma, e tirar isto obrigaria os
 * dois a simular login para testar sessão.
 */
function characterFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('character');
}

/**
 * Entrada ou jogo, e a escolha é uma só: já sabemos com quem jogar?
 *
 * O `characterId` vem da URL ou da tela de entrada (FUN-97). Antes dela, só da URL — e o
 * staging ficava no ar sem ninguém conseguir entrar.
 */
function App() {
  const chosen = useStoreSlice(account, (state) => state.playing);
  const characterId = characterFromUrl() ?? chosen;
  useConnection(characterId);
  return characterId === null ? <Entry /> : <Shell />;
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
