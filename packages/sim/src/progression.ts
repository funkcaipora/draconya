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
  /** Velocidade na escala do Tibia (FUN-119): base mais o ganho por level, sem vocação. */
  readonly speed: number;
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
    // Velocidade não tem incremento por vocação (o Tibia dá +2 por level a todo mundo): é a
    // base mais o ganho por level, contado do 1.
    speed: progression.startingSpeed + (level - 1) * progression.speedPerLevel,
  };
}

// --- curva de XP, level up e penalidade de morte (FUN-37, #521 ADR 0037) ----------------------
//
// `xp` no personagem é o total ACUMULADO — nunca "xp dentro do level". Guardar o acumulado é o
// que faz a penalidade de morte cascatear sozinha: tira-se XP do total e o level é recalculado.
// Guardar o progresso dentro do level exigiria um laço de "desce um level, devolve o resto"
// escrito à mão, que é exatamente onde o caso de cascata de dois levels passa despercebido.
//
// A curva em si (`progression.xp.kind`) é UMA de duas: `'tibia'` é a curva real do Canary/TFS
// (`Player::getExpForLevel`), fechada e O(1) — é a do conteúdo de jogo, desde a #521 ela não é
// mais uma escolha de balanceamento do Draconya (ADR 0037 revoga esse limite do ADR 0019 para
// mecânica de jogo). `'power'` é a fórmula antiga (`base * level^exponent`), somada por um laço
// — sobrevive só para o conteúdo de TESTE que quer uma curva pequena e arbitrária.

/**
 * O total acumulado do Tibia para estar no `level`: `(L³ − 6L² + 17L − 12) / 6 × 100`
 * (`Player::getExpForLevel`, Canary/TFS, verificado em `opentibiabr/canary` `main` 2026-09-24).
 *
 * SEMPRE inteiro: `L³ − L` é o produto de três inteiros consecutivos e por isso múltiplo de 6,
 * e o resto da expressão (`−6L² + 18L − 12`) já é múltiplo de 6 sozinho. `Math.round` aqui é
 * só rede de segurança contra o épsilon de ponto flutuante da exponenciação, não parte da
 * fórmula — o valor exato já sai inteiro.
 *
 * Fechada e O(1) DE PROPÓSITO (e não somada por um laço como a curva antiga): level 200+ não
 * pode custar uma soma de 200 termos toda vez que alguém pergunta "quanto falta", muito menos
 * dentro do laço do `levelForXp`, onde isso viraria O(level²).
 */
function tibiaTotalXp(level: number): number {
  if (level <= 1) return 0;
  const cubic = level * level * level - 6 * level * level + 17 * level - 12;
  return Math.round((cubic / 6) * 100);
}

/** XP acumulada necessária para ESTAR em `level`. Level 1 custa zero: é onde todo mundo nasce. */
export function totalXpForLevel(level: number, progression: Progression): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error(`level precisa ser inteiro positivo: ${level}`);
  }
  if (progression.xp.kind === 'tibia') return tibiaTotalXp(level);
  let total = 0;
  for (let l = 1; l < level; l++) {
    total += Math.round(progression.xp.base * l ** progression.xp.exponent);
  }
  return total;
}

/**
 * XP para completar `level` e chegar ao seguinte.
 *
 * Para a curva Tibia isto é a DIFERENÇA de dois totais fechados (O(1) — nunca um laço próprio
 * recontando do zero); para a curva de teste é a própria fórmula linear de sempre.
 */
export function xpToCompleteLevel(level: number, progression: Progression): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error(`level precisa ser inteiro positivo: ${level}`);
  }
  if (progression.xp.kind === 'tibia') return tibiaTotalXp(level + 1) - tibiaTotalXp(level);
  return Math.round(progression.xp.base * level ** progression.xp.exponent);
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
 * A penalidade de morte do Tibia (#521, ADR 0037 — `Player::getLostPercent` e `Player::death`
 * do Canary/TFS, verificados em `opentibiabr/canary` `main` 2026-09-24; a ausência de piso
 * confirmada na TibiaPlan, "Tibia Death Penalty", 2026-09-24).
 *
 * Abaixo de `cubicFromLevel` (Tibia: 24) a perda é uma fração FIXA da XP acumulada
 * (`flatFraction`, 10%). A partir dali é a fórmula cúbica clássica —
 * `((L+50) / 100) × 50 × (L² − 5L + 8)` —, com `L` incluindo a fração de progresso DENTRO do
 * level corrente (a mesma conta do `levelPercent` do Canary): sem isso a perda saltaria toda
 * vez que o level vira, em vez de crescer suave como no jogo real. As duas contam sobre a XP
 * ACUMULADA, não mais sobre `xpToCompleteLevel` — o modelo antigo (uma fração de UM level)
 * media perda errado porque não é assim que o Tibia mede.
 *
 * `options.premium` continua o nome do parâmetro (não é renomeado para não recascatear pelos
 * chamadores existentes), mas o que ele representa agora é "está abençoado" — mapeia o conceito
 * de bênção do Tibia (`blessedReduction`, sete bênçãos × 8% = 56%) no binário que o repo já
 * tinha. Cobrança/promoção/PvP e o gradiente por NÚMERO de bênçãos ficam fora — fora do escopo
 * da #521, e o repo nunca teve blessing de verdade para gradiente nenhum.
 *
 * **Abaixo de `cubicFromLevel` a redução do abençoado é TETADA em 50%, não os 56% crus**
 * (correção de revisão — `Player::getLostPercent` do Canary, ramo `else` do `if (level >= 24)`:
 * `percentReduction = (percentReduction >= 0.40 ? 0.50 : percentReduction)`). Sete bênçãos dão
 * 56%, que é ≥ 40%, e o Tibia arredonda isso para exatamente 50% NESSE ramo — não é o valor
 * bruto. O teto só existe no ramo da fração fixa; a fórmula cúbica (level ≥ 24) usa a redução
 * crua, sem teto.
 *
 * **O piso do level 8 protege, nunca promove.** Um personagem que já está abaixo dele não
 * perde nada; um acima dele nunca desce além. **Não tem equivalente no Tibia** — lá não existe
 * piso —, e é decisão de PRODUTO do Draconya (documentada em `docs/product/progression.md`) para
 * não punir quem acabou de escolher vocação. Escrito como `max` puro, o piso levantaria a XP de
 * quem está no level 5 — um "castigo" que dá level, que é o tipo de bug que só aparece quando
 * alguém reclama de ter subido ao morrer.
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
  const { flatFraction, cubicFromLevel, blessedReduction, levelFloor } = progression.deathPenalty;
  const level = character.level;
  const belowCubic = level < cubicFromLevel;
  // O teto de 50% é só do ramo `level < cubicFromLevel` (ver o comentário da função).
  const reduction = options.premium
    ? (belowCubic && blessedReduction >= 0.40 ? 0.50 : blessedReduction)
    : 0;

  const raw = belowCubic
    ? flatFraction * character.xp
    : cubicLoss(level + fractionIntoLevel(character, progression));
  const loss = Math.round(raw * (1 - reduction));

  const floorXp = totalXpForLevel(levelFloor, progression);
  const lowest = Math.min(character.xp, floorXp);
  const before = character.xp;
  character.xp = Math.max(lowest, character.xp - loss);

  return { xpLost: before - character.xp, levelChange: retarget(character, vocation, progression) };
}

/**
 * A fórmula cúbica clássica do Tibia — perda em XP ABSOLUTA, função só do level (efetivo, com
 * fração), não da XP acumulada: o `experience` que aparece no `getLostPercent` do Canary se
 * cancela algebricamente contra o mesmo `experience` usado para chegar em `effectiveLevel`.
 */
function cubicLoss(effectiveLevel: number): number {
  return ((effectiveLevel + 50) / 100) * 50 * (effectiveLevel * effectiveLevel - 5 * effectiveLevel + 8);
}

/** Quanto do level ATUAL já foi andado, de 0 (acabou de subir) a quase 1 (na fronteira do próximo). */
function fractionIntoLevel(character: CharacterRuntime, progression: Progression): number {
  const toNext = xpToCompleteLevel(character.level, progression);
  if (toNext <= 0) return 0;
  const into = character.xp - totalXpForLevel(character.level, progression);
  return Math.min(1, Math.max(0, into / toNext));
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
  // Capacidade acompanha o level pela mesma tabela (FUN-82). Sem isto, subir de level daria
  // mais vida e mais mana e deixaria a mochila do mesmo tamanho — e o jogador descobriria pelo
  // item que não coube, sem nada ligando uma coisa à outra.
  character.capacity = after.capacity;
  character.speed = after.speed;
  character.health = clamp(character.health + (after.maxHealth - before.maxHealth), 0, after.maxHealth);
  character.mana = clamp(character.mana + (after.maxMana - before.maxMana), 0, after.maxMana);
  return { from, to };
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));
