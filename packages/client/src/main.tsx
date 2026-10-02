// Entrada do cliente. Ver packages/client/CLAUDE.md.
//
// Estado em `src/state/` (FUN-22), mundo em `src/world/` (FUN-23), conexão em `src/net/` e a
// casca em `src/shell/` (FUN-24).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './shell/Shell.js';
import { Entry } from './shell/Entry.js';
import { WorldQueue } from './shell/WorldQueue.js';
import { WorldExplorer, worldExplorerEnabled } from './shell/WorldExplorer.js';
import { useConnection } from './shell/useConnection.js';
import { useHudSlice, useStoreSlice } from './state/useSlice.js';
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
/** `/world` é o explorador do mapa (#661): sem sessão, sem login, só o mundo. */
function isWorldExplorer(): boolean {
  return window.location.pathname.replace(/\/$/, '') === '/world' && worldExplorerEnabled();
}

function App() {
  const chosen = useStoreSlice(account, (state) => state.playing);
  const entry = useStoreSlice(account, (state) => state.entry);
  const characterId = characterFromUrl() ?? chosen;
  useConnection(characterId, entry);
  // Na fila do mundo cheio (#846, OW-23) não há sessão para desenhar: a tela é a da fila, até a sessão começar
  // (`session-state` zera `worldQueue`) ou o jogador sair dela.
  const queued = useHudSlice((state) => state.worldQueue !== null);
  if (characterId === null) return <Entry />;
  return queued ? <WorldQueue /> : <Shell />;
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    {isWorldExplorer() ? <WorldExplorer /> : <App />}
  </StrictMode>,
);
