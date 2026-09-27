// O pedido de abrir o cadáver PENDENTE (#722, ADR 0048 d.4 — ajuste do DT-01). Único módulo,
// como `net/current.ts`: só existe UM cadáver que o jogador está tentando alcançar por vez —
// clicar em outro substitui, nunca acumula.
//
// A decisão pura mora em `world/corpse-approach.ts`; este módulo é a casca com estado: guarda o
// pedido, cancela por outra ação (`cancelCorpseApproach`, chamado por `useWalkKeys` a cada passo
// de teclado e pelo próprio clique no mundo em outra criatura) e o laço (`useCorpseApproach`)
// chama `tick` para reavaliar a cada intervalo — o `world` não avisa ninguém (ADR 0007).

import { sendIntent } from '../net/current.js';
import { world } from '../state/world.js';
import { decideCorpseApproach } from '../world/corpse-approach.js';
import type { PendingCorpseOpen } from '../world/corpse-approach.js';

let pending: PendingCorpseOpen | null = null;

/**
 * O clique no cadáver (`Viewport.tsx`): manda `walk-to` na hora e guarda o pedido. Se o
 * personagem já está ao alcance, `tick` (chamado logo em seguida) manda `open-corpse` direto,
 * sem esperar o próximo ciclo do laço.
 */
export function requestCorpseApproach(
  groundItemId: number, position: PendingCorpseOpen['position'], nowMs: number,
): void {
  pending = { groundItemId, position, requestedAtMs: nowMs };
  sendIntent({ type: 'walk-to', destination: position });
  tick(nowMs);
}

/**
 * Outra ação do jogador cancela o pedido em curso: andar pelo teclado (`useWalkKeys`), clicar
 * numa criatura (`Viewport.tsx`). NUNCA vira `system-message` — não é recusa, é desistência.
 */
export function cancelCorpseApproach(): void {
  pending = null;
}

/** Só para teste: o pedido em curso, ou `null`. */
export function pendingCorpseApproach(): PendingCorpseOpen | null {
  return pending;
}

/**
 * Reavalia o pedido pendente contra o `world` AGORA. Chamado pelo laço (`useCorpseApproach`) e
 * pelo próprio `requestCorpseApproach`, para o caso "já adjacente" não esperar o próximo tick.
 */
export function tick(nowMs: number): void {
  if (pending === null) return;
  const selfId = world.selfId;
  const selfPosition = selfId === null ? null : (world.creatures.get(selfId)?.position ?? null);
  const stillThere = world.groundItems.has(pending.groundItemId);
  const decision = decideCorpseApproach(pending, selfPosition, stillThere, nowMs);
  if (decision === 'wait') return;
  const { groundItemId } = pending;
  pending = null;
  if (decision === 'send') sendIntent({ type: 'open-corpse', groundItemId });
}
