// Monta o pacote de arte UMA vez, com a casca, e o entrega ao contexto (FUN-108).
//
// Era o `Viewport` quem fazia isto; o que mudou de lugar é só quem chama `loadBrowserPack` e
// quando fecha. A regra continua a mesma: o pacote falhando — `VITE_THINGS_URL` ausente,
// índice fora do ar — NÃO é erro de tela. Sobe-se sem arte, com aviso no console.

import { useEffect, useState } from 'react';
import { loadBrowserPack } from '../assets/browser.js';
import type { AssetPackState, EvictionListener } from './AssetPackContext.js';

/**
 * Redistribui o `onEvict` do pacote para quem se inscreveu. O pacote pede UMA função na
 * montagem; os livros de textura nascem e morrem depois, com cada montagem do viewport.
 */
export interface EvictionHub {
  readonly subscribe: (listener: EvictionListener) => () => void;
  readonly notify: EvictionListener;
}

export function createEvictionHub(): EvictionHub {
  const listeners = new Set<EvictionListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    notify(bitmap) {
      for (const listener of listeners) listener(bitmap);
    },
  };
}

/**
 * O pacote de arte do navegador, ou `null` enquanto carrega.
 *
 * O `close` vai junto com o desmonte: fecha os dois orçamentos de bitmap e o worker de LZMA.
 * O StrictMode monta duas vezes em desenvolvimento, e a primeira carga — que ainda está em
 * voo quando o desmonte chega — é fechada assim que resolve, em vez de virar um worker órfão
 * decodificando para ninguém.
 */
export function useBrowserPack(): AssetPackState | null {
  const [state, setState] = useState<AssetPackState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let closePack: (() => void) | null = null;
    const hub = createEvictionHub();

    void (async () => {
      let pack = null;
      try {
        const loaded = await loadBrowserPack(
          import.meta.env.VITE_THINGS_URL,
          (_id, bitmap) => { hub.notify(bitmap); },
        );
        pack = loaded.pack;
        closePack = loaded.close;
      } catch (error) {
        // Sem arte, com aviso: o console é onde quem desenvolve vai procurar quando a tela
        // estiver cinza. Silenciar deixaria "por que não tem sprite" sem resposta.
        console.warn('[draconya] pacote de arte indisponível; desenhando sem sprites', error);
      }
      if (cancelled) { closePack?.(); return; }
      setState({ pack, subscribeEvictions: hub.subscribe });
    })();

    return () => {
      cancelled = true;
      closePack?.();
      setState(null);
    };
  }, []);

  return state;
}
