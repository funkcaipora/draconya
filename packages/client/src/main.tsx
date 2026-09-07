// Esqueleto do cliente. Ver packages/client/CLAUDE.md.
// O shell, o viewport Pixi e o store ficam nas issues FUN-22, FUN-23 e FUN-24.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <main>Draconya</main>;
}

const raiz = document.getElementById('root');
if (!raiz) throw new Error('elemento #root ausente em index.html');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
