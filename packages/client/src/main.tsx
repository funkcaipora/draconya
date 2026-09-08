// Esqueleto do cliente. Ver packages/client/CLAUDE.md.
// O store de estado já existe em `src/state/` (FUN-22); o shell e o viewport Pixi ficam nas
// issues FUN-24 e FUN-23.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <main>Draconya</main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
