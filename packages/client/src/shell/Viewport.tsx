import { useEffect, useRef } from 'react';
import mapData from '@draconya/content/data/maps/rat-cellars.json';
import { mountViewport, tilemapFrom } from '../world/viewport.js';

/**
 * O canvas. Este componente monta e desmonta o Pixi e nada mais — o mundo NÃO passa por
 * prop nem por estado do React (ADR 0007). O laço de quadro lê `world` direto.
 */
export function Viewport() {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = holder.current;
    if (parent === null) return;
    let handle: Awaited<ReturnType<typeof mountViewport>> | null = null;
    let cancelled = false;

    void mountViewport(parent).then((mounted) => {
      // Desmontado antes de o Pixi terminar de subir — o StrictMode faz isso em
      // desenvolvimento. Destruir na hora, senão sobra um canvas órfão desenhando.
      if (cancelled) {
        mounted.destroy();
        return;
      }
      handle = mounted;
      // O mapa vem empacotado por enquanto: o `instance-enter` manda o ID, não o conteúdo.
      handle.setMap(tilemapFrom(mapData));
    });

    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, []);

  return <div className="viewport" ref={holder} />;
}
