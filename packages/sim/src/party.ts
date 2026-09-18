// A aritmética da party de hunt (§15, ADR 0027, #189).
//
// Quatro contas, todas em INTEIRO e sem RNG: quantas vocações únicas há entre os elegíveis, o
// pool de XP que isso rende, a cota igual de cada um, e quanto a bolsa compartilhada vale
// quando é vendida e dividida. Vivem aqui, e não no ruleset, para serem testáveis por tabela:
// resto negativo, divisão por zero elegíveis e `floor` em ponto flutuante são o tipo de erro
// que uma fixture de hunt de 3.000 linhas esconde e uma tabela de doze casos não.
//
// Quem chama é `rulesets/hunt.ts`; este arquivo não sabe o que é sessão.

import type { Item, PartyConfig } from '@draconya/content';
import type { CarriedItem } from './inventory.js';

export interface PartyMember {
  readonly id: string;
  /** `null` é "sem vocação" (level < 8) — e CONTA como uma vocação (ADR 0027 decisão 3). */
  readonly vocationId: string | null;
}

/** A bolsa do modo compartilhado. O ruleset é quem mantém `capacity` (Σ dos presentes). */
export interface PartyBagState {
  gold: number;
  readonly items: CarriedItem[];
  capacity: number;
}

export interface BagSettlement {
  /** Gold de cada presente, na ordem dada; o resto vai um a um para os primeiros. */
  readonly shares: ReadonlyMap<string, number>;
  /** O que não se vende (`value: 0`): vai para o líder, não para o gold. */
  readonly unsold: readonly CarriedItem[];
  readonly total: number;
}

export interface CostLootMode {
  readonly mode: 'split' | 'shared';
  readonly shareCosts?: boolean;
  readonly splitLoot?: boolean;
}

export function shareCostsOf(options: CostLootMode): boolean {
  return options.shareCosts ?? options.mode === 'shared';
}

export function splitLootOf(options: CostLootMode): boolean {
  return options.splitLoot ?? options.mode === 'shared';
}

/** Quantas vocações DISTINTAS há entre `members`. `null` é uma delas. */
export function uniqueVocations(members: readonly PartyMember[]): number {
  const seen = new Set<string>();
  for (const member of members) seen.add(member.vocationId ?? '');
  return seen.size;
}

/**
 * O pool de XP que um monstro rende para `eligible`: `floor(xp × tabela[únicas] / 100)`.
 *
 * Com um elegível só é `experience`, sem tabela: solo é 100 %, e a linha `"1"` da tabela vale
 * para a PARTY de vocações iguais — que rende mais que um solo no total e menos por cabeça,
 * o que é o que "repetidas não somam" significa com pool dividido (ADR 0027).
 */
export function xpPool(experience: number, eligible: readonly PartyMember[], config: PartyConfig): number {
  if (eligible.length <= 1) return experience;
  const percent = config.xpPoolPercentByUniqueVocations[String(uniqueVocations(eligible))] ?? 100;
  // Inteiro, como `Bestiary.applyXpBonus`: 7 × 1,75 em ponto flutuante não é 12,25 exato.
  return Math.floor((experience * percent) / 100);
}

/**
 * A cota IGUAL de cada elegível; o resto é descartado. Não é `splitEqually`: dar o resto a
 * alguém seria prioridade, e o §15.5 proíbe prioridade por golpe. Zero elegíveis é zero.
 */
export function xpShare(experience: number, eligible: readonly PartyMember[], config: PartyConfig): number {
  if (eligible.length === 0) return 0;
  return Math.floor(xpPool(experience, eligible, config) / eligible.length);
}

/**
 * Divide `total` em `n` cotas inteiras cuja soma É `total`: as primeiras `total mod n` levam
 * um a mais. É a divisão da BOLSA — gold descartado é valor que o ledger deveria ver e não vê.
 */
export function splitEqually(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Vende a bolsa e divide entre `presentIds`, na ordem dada (que é a ordem de entrada).
 *
 * Item com `value: 0` — ou fora do catálogo — não vira gold: vai em `unsold`, e o ruleset o
 * entrega ao líder. Vender por zero seria sumir com o item, e "não se vende" é diferente de
 * "não vale nada".
 */
export function settleBag(
  bag: PartyBagState,
  presentIds: readonly string[],
  catalog: ReadonlyMap<string, Item>,
): BagSettlement {
  let total = bag.gold;
  const unsold: CarriedItem[] = [];
  for (const item of bag.items) {
    const value = catalog.get(item.itemId)?.value ?? 0;
    if (value === 0) {
      unsold.push(item);
      continue;
    }
    total += value * item.quantity;
  }
  const shares = new Map<string, number>();
  splitEqually(total, presentIds.length).forEach((gold, index) => {
    const id = presentIds[index];
    if (id !== undefined) shares.set(id, gold);
  });
  return { shares, unsold, total };
}
