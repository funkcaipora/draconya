// A ponte para o React, e a única que existe (FUN-22).

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { hud, subscribeSlice, type HudState, type SliceOptions } from './hud.js';

/**
 * Assina uma fatia do HUD.
 *
 * `useSyncExternalStore` é a API que o React oferece para estado que vive fora dele — usá-la
 * evita o rasgo (metade da tela com o valor velho) que uma assinatura escrita à mão sofre em
 * renderização concorrente.
 *
 * Não existe hook equivalente para o mundo. Se um componente de HUD precisar da posição de uma
 * criatura, a resposta é que ele não precisa: isso é canvas.
 */
export function useHudSlice<S>(select: (state: HudState) => S, options: SliceOptions = {}): S {
  const selectRef = useRef(select);
  selectRef.current = select;

  const throttleMs = options.throttleMs ?? 0;

  // `getSnapshot` é chamado a cada render E a cada checagem do React. Devolver valor novo toda
  // vez faz o React entrar em laço infinito, então o resultado é memoizado por estado: mesmo
  // objeto de estado, mesma referência de volta.
  const cache = useRef<{ state: HudState; value: S } | null>(null);
  const getSnapshot = useCallback((): S => {
    const state = hud.get();
    const cached = cache.current;
    if (cached !== null && cached.state === state) return cached.value;

    const value = selectRef.current(state);
    // Estado novo com valor selecionado igual mantém a referência anterior — é o que impede
    // um seletor que devolve objeto de re-renderizar a cada mudança irrelevante.
    if (cached !== null && Object.is(cached.value, value)) {
      cache.current = { state, value: cached.value };
      return cached.value;
    }
    cache.current = { state, value };
    return value;
  }, []);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeSlice(hud, (state) => selectRef.current(state), onStoreChange, { throttleMs }),
    [throttleMs],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
