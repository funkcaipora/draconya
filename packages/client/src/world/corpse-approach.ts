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
  /**
   * O instante LÓGICO até quando esperar (#763) — já resolvido no pedido (`corpseApproachDeadline`),
   * não recalculado a cada `tick`. Substitui o antigo `requestedAtMs` + prazo FIXO: um cadáver a
   * onze tiles com dragões no caminho (QA ao vivo na Darashia Dragon Lair) expirava os dez
   * segundos do prazo fixo antes do `walk-to` distante (#763) sequer terminar de andar até lá.
   */
  readonly deadlineMs: number;
}

export type CorpseApproachDecision = 'send' | 'wait' | 'cancel';

/**
 * Base do prazo antes de desistir (10 s) — o de sempre, para quem já está perto. Não é recusa
 * do servidor: é o cliente desistindo de um pedido que não se resolveu — rota bloqueada, ou o
 * jogador só clicou e foi embora. Silencioso, como cancelar por outra ação: não é
 * `system-message`, porque nada foi de fato recusado.
 */
export const CORPSE_APPROACH_BASE_TIMEOUT_MS = 10_000;

/**
 * Quanto o prazo cresce por tile de distância NO INSTANTE DO PEDIDO (#763): um segundo por
 * tile é folgado mesmo para o passo mais lento do jogo (chão pesado, sem haste) — o ponto não é
 * cronometrar o passo exato, é parar de expirar cliques legítimos para cadáveres distantes.
 */
export const CORPSE_APPROACH_PER_TILE_MS = 1_000;

/**
 * O prazo (#763) para um pedido feito agora, a partir da distância JÁ CONHECIDA no instante do
 * clique — `null` (sem posição própria ainda, a janela rara entre conectar e o primeiro
 * `session-state`) é a base sem bônus, nunca um prazo maior que o necessário por adivinhação.
 * Chamada UMA vez, por `requestCorpseApproach`; o prazo resultante não muda depois, mesmo que o
 * personagem seja desviado (empurrado, follow) e a distância real mude no meio do caminho.
 */
export function corpseApproachDeadline(
  selfPosition: { readonly x: number; readonly y: number; readonly z: number } | null,
  target: { readonly x: number; readonly y: number; readonly z: number },
  nowMs: number,
): number {
  const distance = selfPosition === null || selfPosition.z !== target.z
    ? 0
    : Math.max(Math.abs(selfPosition.x - target.x), Math.abs(selfPosition.y - target.y));
  return nowMs + CORPSE_APPROACH_BASE_TIMEOUT_MS + CORPSE_APPROACH_PER_TILE_MS * distance;
}

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
  if (nowMs > pending.deadlineMs) return 'cancel';
  if (selfPosition === null) return 'wait';
  if (selfPosition.z !== pending.position.z) return 'wait';
  const distance = Math.max(
    Math.abs(selfPosition.x - pending.position.x),
    Math.abs(selfPosition.y - pending.position.y),
  );
  return distance <= 1 ? 'send' : 'wait';
}
