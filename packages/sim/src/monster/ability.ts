// A resolução de alvo e forma de uma ability de monstro (CMB-06). PURO: entra geometria e a
// lista de presas, sai a lista de alvos — na ordem ESTÁVEL da lista recebida.
//
// A geometria NÃO é reimplementada aqui: `area.ts` já consolidou forma → tiles para a magia, e
// a ability usa o mesmo caminho. Copiar a matriz do TFS/Canary seria violar o ADR 0019; e uma
// segunda geometria divergiria da primeira na terceira mudança.
//
// A ORDEM DOS ALVOS É CONTRATO, como a semente e a ordem do loot: cada alvo consome uma rolagem
// do RNG da sessão, e trocar a ordem troca qual sorteio cai em quem.

import type { MonsterAbility } from '@draconya/content';
import { areaTiles, facingDirection, tileKey } from '../area.js';
import type { WorldPoint } from '../movement.js';
import type { GridPoint } from './step.js';

/**
 * A ability é corpo a corpo? Alcance 1 e sem área — é o que decide se o impacto é "melee"
 * (sangue do golpe) ou "spell" (o impacto próprio da ability) na apresentação.
 *
 * A básica legada do rato cai aqui, e é o que preserva o `creature-hit` com `source: 'melee'`.
 */
export function isMeleeAbility(ability: MonsterAbility): boolean {
  return ability.target.range <= 1 && ability.target.area === undefined;
}

/**
 * Os tiles da forma, a partir do lançador e do alvo principal. Vazio em alvo único.
 *
 * `circle` ignora a direção — o parâmetro existe para o contrato de `areaTiles`. `wave`/`beam`
 * (#518) saem na direção do lançador PARA o alvo, recalculada aqui a cada golpe pelo mesmo
 * cálculo do TFS `updateLookDirection` (`facingDirection`, `area.ts`): o monstro não guarda
 * direção entre golpes, então "virar para o alvo" é ler as duas posições, não um campo de
 * estado. `cross`/`cleave` continuam fora — o boot recusa (`content.ts`).
 */
export function abilityTiles(
  ability: MonsterAbility, caster: WorldPoint, target: WorldPoint,
): WorldPoint[] {
  const area = ability.target.area;
  if (area === undefined) return [];
  // `'monster'` (#523): o raio de uma ability usa a tabela de anéis do Canary, não as
  // `AREA_CIRCLEnXn` nomeadas que a magia do jogador usa — ver o comentário no topo de `area.ts`.
  return areaTiles(area, caster, facingDirection(caster, target), target, 'monster');
}

/**
 * Quem a ability atinge, colhido ANTES de qualquer dano e na ordem de `prey` (a ordem de
 * ENTRADA dos participantes, documentada e estável).
 *
 * Morto é pulado: um alvo que caiu não leva um segundo golpe, e a ordem dos que sobram não
 * muda. Sem área é o alvo principal — um caso do mesmo caminho, não um ramo à parte.
 */
export function abilityTargets<T extends { readonly position: GridPoint; readonly alive: boolean }>(
  ability: MonsterAbility,
  caster: WorldPoint,
  primary: T,
  prey: readonly T[],
): T[] {
  const area = ability.target.area;
  if (area === undefined) return [primary];

  const tiles = abilityTiles(ability, caster, { ...primary.position, z: caster.z });
  const keys = new Set(tiles.map(tileKey));
  const targets: T[] = [];
  for (const candidate of prey) {
    if (!candidate.alive) continue;
    if (!keys.has(tileKey({ ...candidate.position, z: caster.z }))) continue;
    targets.push(candidate);
  }
  return targets;
}
