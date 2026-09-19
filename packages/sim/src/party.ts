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

/** Uma entrada de item da bolsa, com quem estava na party no instante do abate (§16.1). */
export interface BagEntry {
  readonly item: CarriedItem;
  /**
   * Quem estava na party quando este item caiu (§16.1). Vazio é o sinal de bolsa MIGRADA de
   * um snapshot anterior a esta task: nesse caso o settlement usa `present` como elegível —
   * a regra de hoje, preservada só para quem já estava em voo.
   */
  readonly eligible: readonly string[];
}

/** Uma entrada de gold da bolsa (o gold BASE do drop), com a mesma elegibilidade do item. */
export interface GoldEntry {
  readonly amount: number;
  readonly eligible: readonly string[];
}

/** A bolsa do modo compartilhado. O ruleset é quem mantém `capacity` (Σ dos presentes). */
export interface PartyBagState {
  gold: GoldEntry[];
  readonly items: BagEntry[];
  capacity: number;
}

export interface EntrySettlement {
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
 * O limite de TIPOS de venda automática do líder (D2/§23.1): o Premium é do PERSONAGEM líder,
 * nunca do usuário do item. A lista guarda além do limite; só os `limite` primeiros vendem.
 * O conteúdo manda os números (`party.autoSellItemTypes`); esta função só escolhe o do líder.
 */
export function autoSellLimit(
  premiumByCharacter: Readonly<Record<string, boolean>>,
  leaderId: string,
  limits: PartyConfig['autoSellItemTypes'],
): number {
  const resolved = limits ?? { free: 0, premium: 0 };
  return premiumByCharacter[leaderId] === true ? resolved.premium : resolved.free;
}

/**
 * Vende a bolsa ENTRADA por entrada e divide cada uma entre `eligible ∩ presentIds`.
 *
 * Cada item e cada gold da bolsa registram quem estava presente no drop (§16.1, D4): quem
 * entrou depois não recebe daquela entrada. `eligible` vazio é o sentinel de entrada
 * MIGRADA de um snapshot anterior a esta task (D5) — aí valem todos os presentes, a regra
 * de hoje.
 *
 * Item com `value: 0` — ou fora do catálogo — não vira gold: vai em `unsold`, e o ruleset o
 * entrega ao líder. Vender por zero seria sumir com o item, e "não se vende" é diferente de
 * "não vale nada".
 */
export function settleEntries(
  bag: PartyBagState,
  presentIds: readonly string[],
  catalog: ReadonlyMap<string, Item>,
): EntrySettlement {
  const present = new Set(presentIds);
  const shares = new Map<string, number>();
  const credit = (id: string, amount: number): void => {
    if (amount === 0) return;
    shares.set(id, (shares.get(id) ?? 0) + amount);
  };
  const payout = (amount: number, eligible: readonly string[]): void => {
    // `eligible.length === 0` é o sentinel de entrada MIGRADA (D5): todo mundo presente na
    // hora do settlement é elegível — a regra de hoje, para não confiscar bolsa em voo.
    const recipients = eligible.length === 0 ? presentIds : eligible.filter((id) => present.has(id));
    // A interseção nunca é vazia para uma entrada NOVA (a bolsa liquida a cada saída — D5);
    // pode ser vazia numa entrada migrada só se `presentIds` também for vazio, e `#settle`
    // já recusa `present.length === 0` antes de chamar esta função.
    if (recipients.length === 0) return;
    splitEqually(amount, recipients.length).forEach((share, i) => {
      const id = recipients[i];
      if (id !== undefined) credit(id, share);
    });
  };

  let total = 0;
  for (const entry of bag.gold) {
    payout(entry.amount, entry.eligible);
    total += entry.amount;
  }

  const unsold: CarriedItem[] = [];
  for (const entry of bag.items) {
    const value = catalog.get(entry.item.itemId)?.value ?? 0;
    if (value === 0) {
      unsold.push(entry.item);
      continue;
    }
    const amount = value * entry.item.quantity;
    payout(amount, entry.eligible);
    total += amount;
  }
  return { shares, unsold, total };
}
