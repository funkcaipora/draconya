// O aviso de "não pode sair" sobre o mundo (#846, OW-23, ADR 0060 d.7): a linha de status que o Tibia mostra
// quando `canLogout` diz não — "Você não pode sair durante uma luta." ou "Você não pode sair daqui." —, no
// centro do mundo, por alguns segundos, e some sozinha.
//
// É APRESENTAÇÃO de um veredicto do servidor (invariante 4): o personagem não mudou, e o `logout-refused` só
// diz por quê. O mesmo dado vira uma linha no registro do chat (`apply.ts`), então o aviso sumir não perde a
// recusa.

import { useEffect, useState } from 'react';
import { EXIT_REFUSAL_NOTICE_MS, logoutRefusalText } from '../state/exit-refusal.js';
import { useHudSlice } from '../state/useSlice.js';

export function ExitRefusalNotice({ suppressed = false }: {
  /**
   * Outra tela já está dizendo a mesma coisa (o `HuntsModal` aberto mostra a recusa de entrar na caçada no
   * rodapé): o aviso se cala, para o jogador não ler duas frases para um veredicto só.
   */
  suppressed?: boolean;
}) {
  const refusal = useHudSlice((state) => state.exitRefusal);
  // O instante da recusa cujo aviso o tempo já dispensou. Guardar o `atMs` dispensado (e não um booleano) é o
  // que faz a recusa SEGUINTE aparecer mesmo com a anterior ainda na tela.
  const [dismissedAtMs, setDismissedAtMs] = useState<number | null>(null);

  useEffect(() => {
    if (refusal === null) return undefined;
    // `atMs` é o relógio de `applyMessage` (`performance.now()`): o que falta é o tempo do aviso menos o que já passou.
    const remainingMs = Math.max(0, EXIT_REFUSAL_NOTICE_MS - (performance.now() - refusal.atMs));
    const id = setTimeout(() => { setDismissedAtMs(refusal.atMs); }, remainingMs);
    return () => { clearTimeout(id); };
  }, [refusal]);

  if (suppressed || refusal === null || dismissedAtMs === refusal.atMs) return null;
  return (
    <div className="exit-refusal-notice" role="alert">
      {logoutRefusalText(refusal.reason)}
    </div>
  );
}
