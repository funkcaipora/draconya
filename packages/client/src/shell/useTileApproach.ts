// A casca do pedido de usar um tile sozinho (#729, ADR 0050 d.7) — o mesmo desenho de
// `useCorpseApproach` (#722/#749). A decisão é de `tile-approach.ts`/`world/tile-approach.ts`;
// isto só monta o LAÇO — um `setInterval`, porque não há evento nenhum a que amarrar "o
// personagem chegou perto": o `world` não avisa ninguém (ADR 0007), então alguém precisa olhar
// de tempos em tempos.
//
// O intervalo (150 ms) é o mesmo passo mínimo de uma hunt a 10 Hz — reavaliar mais rápido que
// isso não adianta, porque a posição confirmada não muda mais rápido que um passo.

import { useEffect } from 'react';
import { tick } from './tile-approach.js';

const TILE_APPROACH_POLL_MS = 150;

export function useTileApproach(): void {
  useEffect(() => {
    const timer = setInterval(() => { tick(performance.now()); }, TILE_APPROACH_POLL_MS);
    return () => { clearInterval(timer); };
  }, []);
}
