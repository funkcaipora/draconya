// Esqueleto do cliente. Ver packages/client/CLAUDE.md.
//
// O estado vive em `src/state/` (FUN-22) e o mundo é desenhado em `src/world/` (FUN-23). O
// shell — conexão, HUD, chat — é a FUN-24; o que existe aqui é o mínimo para o mundo aparecer.
import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import mapData from '@draconya/content/data/maps/rat-cellars.json';
import { applyMessage } from './state/apply.js';
import { useHudSlice } from './state/useSlice.js';
import { mountViewport, tilemapFrom } from './world/viewport.js';

function World() {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = holder.current;
    if (parent === null) return;
    let handle: Awaited<ReturnType<typeof mountViewport>> | null = null;
    let cancelled = false;

    void mountViewport(parent).then((mounted) => {
      // Desmontado antes do Pixi terminar de subir (o StrictMode faz isso em
      // desenvolvimento): destruir na hora, senão sobra um canvas órfão desenhando.
      if (cancelled) {
        mounted.destroy();
        return;
      }
      handle = mounted;
      // O mapa vem empacotado por enquanto. O servidor manda `instance-enter` com o ID do
      // mapa, não o mapa: quando a FUN-32 definir de onde o conteúdo do mapa chega, esta
      // linha vira a resposta daquela mensagem.
      handle.setMap(tilemapFrom(mapData));
      applyMessage({ type: 'instance-enter', instanceId: 'local', map: mapData.id }, 0);
    });

    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, []);

  return <div ref={holder} />;
}

function Hud() {
  // Fatia estreita, e o mundo NUNCA passa por aqui — este componente não sabe onde nenhuma
  // criatura está, e é assim que 40 criaturas andando custam zero render (FUN-22).
  const health = useHudSlice((state) => state.health);
  const maxHealth = useHudSlice((state) => state.maxHealth);
  return <p>HP {health}/{maxHealth}</p>;
}

function App() {
  return (
    <main>
      <World />
      <Hud />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
