// Seleção PONDERADA de alvo (#541, Canary `Monster::searchTargetImmediate`,
// `src/creatures/monsters/monster.cpp:906-931`, e `MonsterTargetRanker::rank`,
// `src/creatures/monsters/monster_targeting.cpp:17-83`, conferidos em 2026-09-25).
//
// O Canary sorteia o CRITÉRIO com `uniform_random(1, 100)` contra os quatro pesos do monstro
// (`monsters.hpp:127-130`) e resolve cada critério com uma REDUÇÃO determinística: mais perto
// (Chebyshev), menos vida, mais dano causado no monstro — nos três, empate fica com quem
// apareceu primeiro na lista (`<`/`>` ESTRITOS no `.cpp`), nunca sorteado de novo. Só o critério
// `random` consome um SEGUNDO sorteio, para escolher entre os candidatos. É essa a ordem fixa
// que `rankTarget` reproduz: um sorteio para o critério, sempre; um segundo só quando o
// critério cai em `random`.
//
// O Canary trata `strategiesTargetRandom` como "o que sobra até 100" — o campo existe no schema
// dele (`monsters.hpp`) mas nunca entra na soma que o `.cpp` faz. O schema do Draconya
// (`monsterTargetStrategySchema`, `@draconya/content`) exige o peso EXPLÍCITO: a soma não
// precisa ser 100, e o sorteio aqui é proporcional à soma real dos quatro pesos.

import type { MonsterTargetStrategy } from '@draconya/content';
import type { Rng } from '../rng.js';

/**
 * O que `rankTarget` precisa saber de cada candidato — métricas já resolvidas pelo chamador
 * (`chooseTarget`/`#onMonsterTargetChange`), para a função ficar pura de posição e de
 * `MonsterRuntime`.
 */
export interface TargetRankCandidate {
  readonly id: string;
  /** Distância Chebyshev até o candidato — a mesma métrica de `distance` (`step.ts`). */
  readonly distance: number;
  readonly health: number;
  /**
   * Dano acumulado por este candidato NO MONSTRO (`Contribution.damageBy`, `death.ts`). Zero e
   * "nunca bateu" são indistinguíveis DE PROPÓSITO: `Contribution.record` nunca guarda golpe de
   * dano zero, então zero já significa "sem contribuição" — o mesmo efeito do `hasDamage` do
   * Canary, sem precisar de um booleano à parte.
   */
  readonly damage: number;
}

/**
 * Reduz `candidates` ao id do que tem o valor mais EXTREMO de `metric`, com o mesmo desempate
 * do `monster_targeting.cpp`: a comparação é ESTRITA (`keepNew`), então o primeiro candidato com
 * o valor vencedor fica — não é sorteado, é a ORDEM de `candidates` que decide.
 */
function pickExtreme(
  candidates: readonly TargetRankCandidate[],
  metric: (candidate: TargetRankCandidate) => number,
  keepNew: (best: number, value: number) => boolean,
): string {
  const first = candidates[0] as TargetRankCandidate;
  let selectedId = first.id;
  let best = metric(first);
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i] as TargetRankCandidate;
    const value = metric(candidate);
    if (keepNew(best, value)) {
      best = value;
      selectedId = candidate.id;
    }
  }
  return selectedId;
}

/**
 * Escolhe UM alvo pela estratégia ponderada (#541). `candidates` não pode ser vazio — quem
 * chama já filtrou por vivo, mesmo andar e raio de agressão, como `chooseTarget` e o
 * vencimento de `MONSTER_TARGET_CHANGE` sempre fizeram.
 *
 * Ordem FIXA de consumo do `rng`: um sorteio para o CRITÉRIO — sempre, mesmo com um peso só
 * declarado, para a sequência não depender de quantos pesos são zero —, e um segundo sorteio
 * SÓ quando o critério sorteado é `random`.
 */
export function rankTarget(
  strategy: MonsterTargetStrategy,
  candidates: readonly TargetRankCandidate[],
  rng: Rng,
): string {
  if (candidates.length === 0) throw new Error('rankTarget: candidates vazio');

  const total = strategy.nearest + strategy.health + strategy.damage + strategy.random;
  const roll = rng.integer(1, total);

  let threshold = strategy.nearest;
  if (roll <= threshold) {
    return pickExtreme(candidates, (c) => c.distance, (best, value) => value < best);
  }

  threshold += strategy.health;
  if (roll <= threshold) {
    return pickExtreme(candidates, (c) => c.health, (best, value) => value < best);
  }

  threshold += strategy.damage;
  if (roll <= threshold) {
    return pickExtreme(candidates, (c) => c.damage, (best, value) => value > best);
  }

  // `random` (TFS `TARGETSEARCH_RANDOM`): o segundo sorteio, só neste ramo.
  const chosen = candidates[rng.integer(0, candidates.length - 1)] as TargetRankCandidate;
  return chosen.id;
}
