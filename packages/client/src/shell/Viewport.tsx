import { useEffect, useRef } from 'react';
import appearances from '@draconya/content/data/appearances/baseline.json';
import mapData from '@draconya/content/data/maps/rat-cellars.json';
import { loadBrowserPack } from '../assets/browser.js';
import { TextureBook } from '../world/textures.js';
import { mountViewport, tilemapFrom } from '../world/viewport.js';
import type { MapTiles } from '../world/viewport.js';

/**
 * O canvas. Este componente monta e desmonta o Pixi e nada mais — o mundo NÃO passa por
 * prop nem por estado do React (ADR 0007). O laço de quadro lê `world` direto.
 *
 * O pacote de arte é montado ANTES do viewport e entregue a ele pronto. Se o pacote falhar —
 * `VITE_THINGS_URL` ausente, índice fora do ar — o viewport sobe do mesmo jeito, desenhando
 * retângulos: arte que não carrega não pode ser a razão de o jogo não abrir.
 */
export function Viewport() {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = holder.current;
    if (parent === null) return;
    let handle: Awaited<ReturnType<typeof mountViewport>> | null = null;
    let closePack: (() => void) | null = null;
    let cancelled = false;

    const book = new TextureBook();
    // A tabela vem do JSON direto, como o mapa: é o mesmo caminho e a mesma versão.
    const tiles: MapTiles | null = appearances.maps[mapData.id as keyof typeof appearances.maps] ?? null;

    void (async () => {
      let pack = null;
      try {
        const loaded = await loadBrowserPack(
          import.meta.env.VITE_THINGS_URL,
          (_id, bitmap) => { book.forget(bitmap); },
        );
        pack = loaded.pack;
        closePack = loaded.close;
      } catch (error) {
        // Sem arte, com aviso: o console é onde quem desenvolve vai procurar quando a tela
        // estiver cinza. Silenciar deixaria "por que não tem sprite" sem resposta.
        console.warn('[draconya] pacote de arte indisponível; desenhando sem sprites', error);
      }
      if (cancelled) { closePack?.(); return; }

      const mounted = await mountViewport(parent, { pack, book });
      // Desmontado antes de o Pixi terminar de subir — o StrictMode faz isso em
      // desenvolvimento. Destruir na hora, senão sobra um canvas órfão desenhando.
      if (cancelled) {
        mounted.destroy();
        closePack?.();
        return;
      }
      handle = mounted;
      // O mapa vem empacotado por enquanto: o `instance-enter` manda o ID, não o conteúdo.
      handle.setMap(tilemapFrom(mapData), tiles);
    })();

    return () => {
      cancelled = true;
      handle?.destroy();
      closePack?.();
    };
  }, []);

  return <div className="viewport" ref={holder} />;
}
