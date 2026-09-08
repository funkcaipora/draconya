// Entrada do cliente. Ver packages/client/CLAUDE.md.
//
// Estado em `src/state/` (FUN-22), mundo em `src/world/` (FUN-23), conexão em `src/net/` e a
// casca em `src/shell/` (FUN-24).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './shell/Shell.js';
import { useConnection } from './shell/useConnection.js';
import './shell/shell.css';

/**
 * De onde vem o personagem: por enquanto, da query string.
 *
 * A tela de seleção é HTTP puro (`GET /api/characters`, FUN-11) e é trabalho da F2. Deixar
 * como parâmetro mantém o ciclo de conexão testável ponta a ponta sem inventar uma tela que
 * vai ser jogada fora.
 */
function characterFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('character');
}

function App() {
  useConnection(characterFromUrl());
  return <Shell />;
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
