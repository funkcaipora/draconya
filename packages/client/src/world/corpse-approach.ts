// A decisão de abrir o cadáver sozinho quando o personagem chega perto (#722, ADR 0048 d.4 —
// ajuste pós-revisão do DT-01). PURA: sem React, sem timer, sem `net/`.
//
// O corte original mandava `walk-to` e `open-corpse` juntos no clique: clicar num cadáver a mais
// de 1 tile recusava `too-far-away` na hora, e a janela nunca abria — o fluxo principal do
// pedido (clicar de longe) ficava quebrado. Esta função é a decisão que o CLIENTE toma sozinho,
// olhando o `world` (ADR 0007: ninguém avisa, quem quer saber olha): esperar o personagem
// chegar, mandar o `open-corpse` quando chegar, ou desistir. Continua só intenção (invariante
// 4) — quem decide se o `open-corpse` vale é sempre o servidor; isto só decide QUANDO mandá-lo.

export interface PendingCorpseOpen {
  readonly groundItemId: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly requestedAtMs: number;
}

export type CorpseApproachDecision = 'send' | 'wait' | 'cancel';

/**
 * Prazo antes de desistir (10 s). Não é recusa do servidor — é o cliente desistindo de um
 * pedido que não se resolveu: cadáver longe demais para o personagem alcançar num tempo
 * razoável, rota bloqueada, ou o jogador só clicou e foi embora. Silencioso, como cancelar por
 * outra ação: não é `system-message`, porque nada foi de fato recusado.
 */
export const CORPSE_APPROACH_TIMEOUT_MS = 10_000;

/**
 * `selfPosition` é a posição CONFIRMADA (o destino do último `creature-move`, não a
 * interpolação do passo em curso) — a mesma leitura de `Creature.position`. `corpseStillThere`
 * vem de `world.groundItems.has(id)`. Nenhum dos dois é lido aqui: a função só decide.
 */
export function decideCorpseApproach(
  pending: PendingCorpseOpen,
  selfPosition: { readonly x: number; readonly y: number; readonly z: number } | null,
  corpseStillThere: boolean,
  nowMs: number,
): CorpseApproachDecision {
  if (!corpseStillThere) return 'cancel';
  if (nowMs - pending.requestedAtMs > CORPSE_APPROACH_TIMEOUT_MS) return 'cancel';
  if (selfPosition === null) return 'wait';
  if (selfPosition.z !== pending.position.z) return 'wait';
  const distance = Math.max(
    Math.abs(selfPosition.x - pending.position.x),
    Math.abs(selfPosition.y - pending.position.y),
  );
  return distance <= 1 ? 'send' : 'wait';
}
