// O progresso no Bestiário em números (§18, FUN-113), fora do componente para ser testável.
//
// **Isto é apresentação, não regra.** Quem conta abate, fecha marco e paga o bônus é o `sim`
// (`sim/bestiary.ts`), e o cliente não simula: o que se calcula aqui é "que marco vem depois"
// e "quanto o cabeçalho mostra", a partir dos contadores que o servidor mandou e dos marcos
// que o catálogo fixou. Se as duas contas divergirem, a do servidor é a verdadeira — e é por
// isso que nada daqui volta pelo socket (invariante 4).

export interface BestiaryProgress {
  /** Quantos marcos este contador já alcançou — `kills >= marco`, nos marcos crescentes. */
  readonly reached: number;
  /** O próximo marco a alcançar, ou `null` depois do último: não há "próximo" para mostrar. */
  readonly next: number | null;
}

/**
 * Onde um contador está entre os marcos.
 *
 * Alcançar é `>=`, e é o oposto do `sim`, de propósito: lá `record` pergunta "ESTE abate
 * fechou um marco?", e a igualdade exata é o que evita uma linha por rato no extrato; aqui a
 * pergunta é "quantos já fechou?", e o abate 10 001 continua tendo fechado o primeiro. Os
 * marcos vêm crescentes do conteúdo (o schema garante), então o primeiro que o contador não
 * alcança é o próximo — e encerra a contagem.
 */
export function progressOf(kills: number, milestones: readonly number[]): BestiaryProgress {
  let reached = 0;
  for (const milestone of milestones) {
    if (kills < milestone) return { reached, next: milestone };
    reached += 1;
  }
  return { reached, next: null };
}

/**
 * O bônus de XP PvE em pontos percentuais: marcos alcançados em TODOS os monstros, somados,
 * vezes o que cada marco vale (DT-01 — o bônus é global, não daquele monstro).
 *
 * Soma sobre os CONTADORES, e não sobre os monstros do catálogo: é o que o `sim` faz
 * (`Bestiary.milestonesReached`), e um monstro que saiu do conteúdo continua valendo os marcos
 * que rendeu. Mostrar menos que o servidor paga seria um número que nenhum extrato explica.
 */
export function bonusPercent(
  counts: Readonly<Record<string, number>>,
  milestones: readonly number[],
  percentPerMilestone: number,
): number {
  let reached = 0;
  for (const kills of Object.values(counts)) reached += progressOf(kills, milestones).reached;
  return reached * percentPerMilestone;
}

// O Bestiário do Canary (#601, ADR 0053 d.1): estágios por monstro e pontos de Charm, os DOIS
// derivados aqui — apresentação, como o resto deste arquivo — do contador de abates e da ficha
// que `catalogue.monsters[].bestiary` carrega. Coexiste com os marcos de XP acima (`progressOf`/
// `bonusPercent`): os limiares são de ordens diferentes (o Dragon completa a ficha em 1 000
// abates; o primeiro marco de XP são 10 000) e não disparam no mesmo abate — a linha de XP fica
// como exceção de produto registrada (ADR 0053 d.2), não como o mesmo mecanismo.

/** 0 sem ficha desbloqueada, 1/2 primeiro/segundo desbloqueio, 3 ficha completa. */
export type BestiaryStage = 0 | 1 | 2 | 3;

/** Os três limiares que o estágio precisa — o mesmo formato de `BestiaryEntry` (`content`). */
export interface BestiaryStageThresholds {
  readonly firstUnlock: number;
  readonly secondUnlock: number;
  readonly toKill: number;
}

/**
 * O estágio de UM monstro, pelos limiares do Canary (`IOBestiary::addBestiaryKill`,
 * `getBestiaryStageTwo`/`getBestiaryFinished`, referência §15-19): cada limiar é alcançado por
 * `>=`, como os marcos de XP acima — "quantos já desbloqueou", não "este abate desbloqueou".
 */
export function bestiaryStageOf(kills: number, thresholds: BestiaryStageThresholds): BestiaryStage {
  if (kills >= thresholds.toKill) return 3;
  if (kills >= thresholds.secondUnlock) return 2;
  if (kills >= thresholds.firstUnlock) return 1;
  return 0;
}

/** O que `bestiaryStageOf` precisa MAIS os pontos que a ficha completa rende. */
export interface BestiaryCharmThresholds extends BestiaryStageThresholds {
  readonly charmsPoints: number;
}

/**
 * Os pontos de Charm ganhos, somados sobre todo monstro cuja ficha está COMPLETA
 * (`kills >= toKill`) — ADR 0053 d.1: "o que se persiste é só o gasto"; o total ganho é sempre
 * derivado daqui, nunca de uma coluna à parte.
 *
 * Soma sobre os monstros do CATÁLOGO (ao contrário de `bonusPercent`, que soma sobre os
 * contadores): sem a ficha (`toKill`/`charmsPoints`) não há como saber se um monstro fora do
 * catálogo completou algo, e é essa ficha, não o contador sozinho, que diz quanto ela vale.
 */
export function charmPointsEarned(
  counts: Readonly<Record<string, number>>,
  entries: Readonly<Record<string, BestiaryCharmThresholds>>,
): number {
  let total = 0;
  for (const [monsterId, thresholds] of Object.entries(entries)) {
    if ((counts[monsterId] ?? 0) >= thresholds.toKill) total += thresholds.charmsPoints;
  }
  return total;
}
