// Stats por level e por vocação (FUN-34).
//
// A regra inteira vive em `content/`; aqui só se aplica. Mudar quanto um Cavaleiro ganha de
// HP por level tem que ser editar um JSON e reiniciar — **nunca** alterar este arquivo. Se
// algum número aparecer aqui, a tabela deixou de ser a fonte da verdade e o balanceamento
// virou tarefa de quem mexe em código.

import type { Progression, Vocation } from '@draconya/content';
import type { CharacterRuntime } from './character.js';

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

// --- curva de XP, level up e penalidade de morte (FUN-37) ------------------------------------
//
// A curva é FÓRMULA, não tabela (ver `progressionSchema.xp`), e `xp` no personagem é o total
// ACUMULADO — nunca "xp dentro do level". Guardar o acumulado é o que faz a penalidade de
// morte cascatear sozinha: tira-se XP do total e o level é recalculado. Guardar o progresso
// dentro do level exigiria um laço de "desce um level, devolve o resto" escrito à mão, que é
// exatamente onde o caso de cascata de dois levels passa despercebido.

/** XP para completar `level` e chegar ao seguinte. */
export function xpToCompleteLevel(level: number, progression: Progression): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error(`level precisa ser inteiro positivo: ${level}`);
  }
  return Math.round(progression.xp.base * level ** progression.xp.exponent);
}

/** XP acumulada necessária para ESTAR em `level`. Level 1 custa zero: é onde todo mundo nasce. */
export function totalXpForLevel(level: number, progression: Progression): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error(`level precisa ser inteiro positivo: ${level}`);
  }
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToCompleteLevel(l, progression);
  return total;
}

/**
 * O level correspondente a uma XP acumulada.
 *
 * Laço, e não fórmula inversa fechada, de propósito: o expoente é conteúdo e pode ser
 * fracionário, então a inversa mudaria junto com ele. O laço custa uma multiplicação por
 * level e só roda quando a XP muda.
 */
export function levelForXp(xp: number, progression: Progression): number {
  let level = 1;
  let remaining = Math.max(0, xp);
  for (;;) {
    const needed = xpToCompleteLevel(level, progression);
    if (remaining < needed) return level;
    remaining -= needed;
    level++;
  }
}

export interface LevelChange {
  readonly from: number;
  readonly to: number;
}

/**
 * Credita XP e sobe de level se couber. Devolve a mudança, ou `null` se o level não mudou.
 *
 * Subir de level aumenta o máximo E o atual na mesma quantidade — o personagem ganha os
 * pontos, não é curado. Curar no level up faria "subir de level" virar poção grátis, e um bot
 * bem configurado morando na fronteira de um level nunca mais morreria.
 */
export function grantXp(
  character: CharacterRuntime,
  amount: number,
  vocation: Vocation | null,
  progression: Progression,
): LevelChange | null {
  if (amount === 0) return null;
  character.xp = Math.max(0, character.xp + amount);
  return retarget(character, vocation, progression);
}

export interface DeathPenalty {
  readonly xpLost: number;
  readonly levelChange: LevelChange | null;
}

/**
 * A penalidade de morte (§26.2): 60% da XP necessária para completar o level atual, 54% com
 * Premium. Pode rebaixar o level, e pode cascatear por mais de um.
 *
 * **O piso do level 8 protege, nunca promove.** Um personagem que já está abaixo dele não
 * perde nada; um acima dele nunca desce além. Escrito como `max` puro, o piso levantaria a XP
 * de quem está no level 5 — um "castigo" que dá level, que é o tipo de bug que só aparece
 * quando alguém reclama de ter subido ao morrer.
 *
 * O piso é de XP, não só de level: parar no level 8 com XP negativa é um estado impossível que
 * dá erro estranho três sistemas adiante.
 */
export function applyDeathPenalty(
  character: CharacterRuntime,
  options: { readonly premium: boolean },
  vocation: Vocation | null,
  progression: Progression,
): DeathPenalty {
  const fraction = options.premium
    ? progression.deathPenalty.premiumFraction
    : progression.deathPenalty.fraction;
  const loss = Math.round(fraction * xpToCompleteLevel(character.level, progression));

  const floorXp = totalXpForLevel(progression.deathPenalty.levelFloor, progression);
  const lowest = Math.min(character.xp, floorXp);
  const before = character.xp;
  character.xp = Math.max(lowest, character.xp - loss);

  return { xpLost: before - character.xp, levelChange: retarget(character, vocation, progression) };
}

/** Recalcula level e stats a partir da XP. O `health`/`mana` acompanha a variação do máximo. */
function retarget(
  character: CharacterRuntime,
  vocation: Vocation | null,
  progression: Progression,
): LevelChange | null {
  const to = levelForXp(character.xp, progression);
  const from = character.level;
  if (to === from) return null;

  const before = statsForLevel(from, vocation, progression);
  const after = statsForLevel(to, vocation, progression);
  character.level = to;
  character.maxHealth = after.maxHealth;
  character.maxMana = after.maxMana;
  character.health = clamp(character.health + (after.maxHealth - before.maxHealth), 0, after.maxHealth);
  character.mana = clamp(character.mana + (after.maxMana - before.maxMana), 0, after.maxMana);
  return { from, to };
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));
