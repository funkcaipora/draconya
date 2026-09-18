// A tela do "bot avançado" que edita ringSwap (FUN-87, M15 SV-17). Puro, sem `bot/store.ts` —
// o mesmo motivo de `exit-rules.ts` ser separado do painel: texto e derivação se testam sem
// loja nenhuma.

import type { BotConfig } from '@draconya/content';
import type { ItemDefinition } from '../state/hud.js';

/** Os anéis de verdade: só o que este servidor tem no slot "dedo" (SV-16 os cria). */
export function fingerRings(items: readonly ItemDefinition[]): readonly ItemDefinition[] {
  return items.filter((item) => item.slot === 'finger');
}

/**
 * Um `ringSwap` de partida, com os limiares do kit renderizado (50/60/10, restaura o anterior):
 * o primeiro anel do catálogo. `null` quando este servidor não tem nenhum — é o sinal para
 * `BotPanel` não oferecer a linha (D8: sem dado real, sem tela).
 */
export function defaultRingSwap(items: readonly ItemDefinition[]): BotConfig['ringSwap'] | null {
  const first = fingerRings(items)[0];
  if (first === undefined) return null;
  return { itemId: first.id, equipBelow: 50, removeAbove: 60, manaFloor: 10, restorePrevious: true };
}

/** "‹nome do anel› · HP < X % → ≥ Y %" (Hud.jsx:125), ou o texto neutro sem configuração. */
export function ringSwapSummary(
  ring: BotConfig['ringSwap'] | undefined,
  items: readonly ItemDefinition[],
): string {
  if (ring === undefined) return 'Nenhum anel configurado';
  const item = items.find((candidate) => candidate.id === ring.itemId);
  const name = item?.name ?? ring.itemId;
  return `${name} · HP < ${String(ring.equipBelow)} % → ≥ ${String(ring.removeAbove)} %`;
}
