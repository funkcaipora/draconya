// O pedido de usar um tile PENDENTE (#729, ADR 0050 d.7). Único módulo, como
// `net/current.ts` e o `corpse-approach.ts` que o inspira (#722/#749): só existe UM tile que o
// jogador está tentando alcançar por vez — clicar em outro substitui, nunca acumula.
//
// A decisão pura mora em `world/tile-approach.ts`; este módulo é a casca com estado: guarda o
// pedido, cancela por outra ação (`cancelTileApproach`, chamado por `useWalkKeys` a cada passo de
// teclado e pelo próprio clique no mundo em outra criatura) e o laço (`useTileApproach`) chama
// `tick` para reavaliar a cada intervalo — o `world` não avisa ninguém (ADR 0007).

import { sendIntent } from '../net/current.js';
import { world } from '../state/world.js';
import { decideTileApproach, tileApproachDeadline } from '../world/tile-approach.js';
import type { PendingTileUse } from '../world/tile-approach.js';

let pending: PendingTileUse | null = null;

/**
 * O duplo-clique num tile (`Viewport.tsx`): manda `walk-to` na hora e guarda o pedido. Se o
 * personagem já está ao alcance, `tick` (chamado logo em seguida) manda `use-on-map` direto,
 * sem esperar o próximo ciclo do laço. O prazo (#763) já sai PROPORCIONAL à distância conhecida
 * agora — ver `corpse-approach.ts`, mesmo mecanismo.
 */
export function requestTileUse(position: PendingTileUse['position'], nowMs: number): void {
  const selfId = world.selfId;
  const selfPosition = selfId === null ? null : (world.creatures.get(selfId)?.position ?? null);
  pending = { position, deadlineMs: tileApproachDeadline(selfPosition, position, nowMs) };
  sendIntent({ type: 'walk-to', destination: position });
  tick(nowMs);
}

/**
 * Outra ação do jogador cancela o pedido em curso: andar pelo teclado (`useWalkKeys`), clicar
 * numa criatura (`Viewport.tsx`). NUNCA vira `system-message` — não é recusa, é desistência.
 */
export function cancelTileApproach(): void {
  pending = null;
}

/** Só para teste: o pedido em curso, ou `null`. */
export function pendingTileApproach(): PendingTileUse | null {
  return pending;
}

/**
 * Reavalia o pedido pendente contra o `world` AGORA. Chamado pelo laço (`useTileApproach`) e
 * pelo próprio `requestTileUse`, para o caso "já adjacente" não esperar o próximo tick.
 */
export function tick(nowMs: number): void {
  if (pending === null) return;
  const selfId = world.selfId;
  const selfPosition = selfId === null ? null : (world.creatures.get(selfId)?.position ?? null);
  const decision = decideTileApproach(pending, selfPosition, nowMs);
  if (decision === 'wait') return;
  const { position } = pending;
  pending = null;
  if (decision === 'send') sendIntent({ type: 'use-on-map', position });
}
