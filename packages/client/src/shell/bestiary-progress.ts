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
