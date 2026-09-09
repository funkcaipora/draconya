// Stats por level e por vocação (FUN-34).
//
// A regra inteira vive em `content/`; aqui só se aplica. Mudar quanto um Cavaleiro ganha de
// HP por level tem que ser editar um JSON e reiniciar — **nunca** alterar este arquivo. Se
// algum número aparecer aqui, a tabela deixou de ser a fonte da verdade e o balanceamento
// virou tarefa de quem mexe em código.

import type { Progression, Vocation } from '@draconya/content';

export interface Stats {
  readonly maxHealth: number;
  readonly maxMana: number;
  readonly capacity: number;
}

/**
 * Stats de um personagem num level, com ou sem vocação.
 *
 * O personagem nasce SEM vocação e a escolhe no level 8 (§7.4). Então os incrementos até lá
 * saem da tabela base, e só os levels ACIMA dela seguem a vocação.
 *
 * A vocação **não é retroativa**, e isso é decisão desta implementação, não do PRD: recalcular
 * os sete primeiros levels ao escolher a vocação mudaria o HP do personagem de uma vez, na
 * tela, sem nada explicando. O PRD (§9.3) só define o incremento por vocação e é silencioso
 * sobre isto — ver `docs/product/progression.md`.
 */
export function statsForLevel(
  level: number,
  vocation: Vocation | null,
  progression: Progression,
): Stats {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error(`level precisa ser inteiro positivo: ${level}`);
  }

  // Quantos levels foram ganhos antes da vocação, e quantos depois. O level 1 é o inicial e
  // não concede incremento nenhum — quem começa não "subiu" para o 1.
  const beforeVocation = Math.min(level, progression.vocationLevel) - 1;
  const afterVocation = Math.max(0, level - progression.vocationLevel);
  // Sem vocação escolhida, os levels acima do limiar continuam na tabela base: é o caso de
  // quem passou do 8 sem escolher, que o §7.4 permite acontecer.
  const perLevel = vocation ?? progression;

  return {
    maxHealth: progression.startingHealth
      + beforeVocation * progression.healthPerLevel
      + afterVocation * perLevel.healthPerLevel,
    maxMana: progression.startingMana
      + beforeVocation * progression.manaPerLevel
      + afterVocation * perLevel.manaPerLevel,
    capacity: progression.startingCapacity
      + beforeVocation * progression.capacityPerLevel
      + afterVocation * perLevel.capacityPerLevel,
  };
}
