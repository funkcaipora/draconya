// A decisão de usar um tile sozinho quando o personagem chega perto (#729, ADR 0050 d.7). PURA:
// sem React, sem timer, sem `net/`.
//
// O clique num tile fora de alcance (`canUse`: mesmo andar, adjacente) recusaria `out-of-range`
// na hora, e o `use-on-map` nunca sairia — o fluxo principal do pedido (clicar de longe) ficaria
// quebrado. Esta função é a decisão que o CLIENTE toma sozinho, olhando o `world` (ADR 0007:
// ninguém avisa, quem quer saber olha): esperar o personagem chegar, mandar o `use-on-map` quando
// chegar, ou desistir. Continua só intenção (invariante 4) — quem decide se o `use-on-map` vale é
// sempre o servidor; isto só decide QUANDO mandá-lo. Mesmo desenho de `corpse-approach.ts` (#722/
// #749), sem o `groundItemId`: aqui o alvo é uma POSIÇÃO, não um item que pode sumir do chão.

export interface PendingTileUse {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly requestedAtMs: number;
}

export type TileApproachDecision = 'send' | 'wait' | 'cancel';

/**
 * Prazo antes de desistir (10 s) — a mesma folga de `corpse-approach.ts`. Não é recusa do
 * servidor: é o cliente desistindo de um pedido que não se resolveu — tile longe demais, rota
 * bloqueada, ou o jogador só clicou e foi embora. Silencioso, como cancelar por outra ação.
 */
export const TILE_APPROACH_TIMEOUT_MS = 10_000;

/**
 * `selfPosition` é a posição CONFIRMADA (o destino do último `creature-move`, não a
 * interpolação do passo em curso) — a mesma leitura de `Creature.position`.
 */
export function decideTileApproach(
  pending: PendingTileUse,
  selfPosition: { readonly x: number; readonly y: number; readonly z: number } | null,
  nowMs: number,
): TileApproachDecision {
  if (nowMs - pending.requestedAtMs > TILE_APPROACH_TIMEOUT_MS) return 'cancel';
  if (selfPosition === null) return 'wait';
  if (selfPosition.z !== pending.position.z) return 'wait';
  const distance = Math.max(
    Math.abs(selfPosition.x - pending.position.x),
    Math.abs(selfPosition.y - pending.position.y),
  );
  return distance <= 1 ? 'send' : 'wait';
}
