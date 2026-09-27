// A casca do pedido de abrir o cadáver sozinho (#722, ADR 0048 d.4 — ajuste do DT-01). A decisão
// é de `corpse-approach.ts`/`world/corpse-approach.ts`; isto só monta o LAÇO — um `setInterval`,
// como o `tick` de `useWalkKeys`, porque não há evento nenhum a que amarrar "o personagem chegou
// perto": o `world` não avisa ninguém (ADR 0007), então alguém precisa olhar de tempos em tempos.
//
// O intervalo (150 ms) é o mesmo passo mínimo de uma hunt a 10 Hz — reavaliar mais rápido que
// isso não adianta, porque a posição confirmada não muda mais rápido que um passo.

import { useEffect } from 'react';
import { tick } from './corpse-approach.js';

const CORPSE_APPROACH_POLL_MS = 150;

export function useCorpseApproach(): void {
  useEffect(() => {
    const timer = setInterval(() => { tick(performance.now()); }, CORPSE_APPROACH_POLL_MS);
    return () => { clearInterval(timer); };
  }, []);
}
