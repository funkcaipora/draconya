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

/** A bolsa do modo compartilhado. O ruleset é quem mantém `capacity` (Σ das disponíveis). */
export interface PartyBagState {
  gold: GoldEntry[];
  readonly items: BagEntry[];
  /** Σ da capacidade DISPONÍVEL dos presentes (não a total) — #396. */
  capacity: number;
  /** `peso > Σ disponível` (§14). Persistido para a transição não disparar falso no resume. */
  overweight: boolean;
}

/** A capacidade disponível de um membro para a reserva proporcional (§12). */
export interface MemberCapacity {
  readonly id: string;
  readonly available: number;
}

/**
 * A reserva proporcional de cada membro (§12): `R_i = W × B_i / ΣB`, em ponto flutuante (peso é
 * float no conteúdo). `B_i` é a capacidade DISPONÍVEL (`capacity − inventory.weight`), nunca a
 * total — bolsa e mochila contam a mesma capacidade duas vezes sem isto (D4).
 *
 * Σ reservas = `min(weight, ΣB)`: em OVERWEIGHT cada membro reserva TODA a disponível que tem, e
 * o excedente da bolsa fica sem reserva de ninguém (§14: quem chama decide não coletar, não
 * "sobrar" para alguém). Disponível `0` ou negativa não gera reserva negativa nem `NaN`.
 *
 * Pura: sem RNG, sem I/O, sem relógio — como o resto de `party.ts`.
 */
export function reserveProportionally(
  weight: number,
  members: readonly MemberCapacity[],
): Map<string, number> {
  const totalAvailable = members.reduce((sum, m) => sum + Math.max(0, m.available), 0);
  const reserved = new Map<string, number>();
  if (weight <= 0 || totalAvailable <= 0) {
    for (const m of members) reserved.set(m.id, 0);
    return reserved;
  }
  const capped = Math.min(weight, totalAvailable);
  for (const m of members) {
    const available = Math.max(0, m.available);
    reserved.set(m.id, (capped * available) / totalAvailable);
  }
  return reserved;
}

/** Quanto a bolsa vende hoje (PRD §10) — leitura pura do que já existe, sem consumir sorteio. */
export function bagValue(bag: PartyBagState, catalog: ReadonlyMap<string, Item>): number {
  let total = bag.gold.reduce((sum, entry) => sum + entry.amount, 0);
  for (const entry of bag.items) {
    total += (catalog.get(entry.item.itemId)?.value ?? 0) * entry.item.quantity;
  }
  return total;
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

/**
 * Quantas vocações REAIS e DISTINTAS há entre `members`. `null` (sem vocação, level < 8) NÃO
 * conta (ADR 0027 emenda 2026-09-24, #525) — o TFS exclui `VOCATION_NONE` de `vocationsIds` em
 * `Party:onShareExperience` (`data/events/scripts/party.lua`), e é essa a regra que "vocação
 * real" no título da #525 pede. Antes deste fix "nenhuma" contava como uma vocação a mais; a
 * tabela `xpPoolPercentByUniqueVocations` foi corrigida junto, em `party/baseline.json`.
 */
export function uniqueVocations(members: readonly PartyMember[]): number {
  const seen = new Set<string>();
  for (const member of members) {
    if (member.vocationId !== null) seen.add(member.vocationId);
  }
  return seen.size;
}

/**
 * O percentual da tabela para `únicas` vocações reais entre `members`: `0` (ninguém com vocação
 * real, só "nenhuma") lê a MESMA linha `"1"` que uma única vocação real — o TFS trata `size <= 1`
 * como o mesmo caso (`Party:onShareExperience`). Exportada porque `partySummary` (hunt.ts) exibe
 * este percentual sem passar por `xpPool`/`xpShare`.
 */
export function xpPoolPercent(members: readonly PartyMember[], config: PartyConfig): number {
  return config.xpPoolPercentByUniqueVocations[String(Math.max(1, uniqueVocations(members)))] ?? 100;
}

/**
 * O pool de XP que um monstro rende para `eligible`: `floor(xp × tabela[únicas reais] / 100)`.
 *
 * Com um elegível só é `experience`, sem tabela: solo é 100 %, e a linha `"1"` da tabela vale
 * para a PARTY de vocações iguais (ou só "nenhuma") — que rende mais que um solo no total e
 * menos por cabeça, o que é o que "repetidas não somam" significa com pool dividido (ADR 0027).
 *
 * Não é o que `xpShare` usa por dentro (ver lá): esta função fica como a leitura "quanto o pool
 * vale, arredondado para baixo", útil por si — o resto do jogo continua descartando resto.
 */
export function xpPool(experience: number, eligible: readonly PartyMember[], config: PartyConfig): number {
  if (eligible.length <= 1) return experience;
  // Inteiro, como `Bestiary.applyXpBonus`: 7 × 1,75 em ponto flutuante não é 12,25 exato.
  return Math.floor((experience * xpPoolPercent(eligible, config)) / 100);
}

/**
 * A cota de cada elegível, ARREDONDADA PARA CIMA — ao contrário do resto deste arquivo (loot,
 * gold), que descarta o resto (ADR 0027 decisão original, §15.5: sem prioridade por golpe).
 *
 * O TFS (`Party:onShareExperience`) e o Canary (`onShareExperience`) fazem
 * `ceil(xp × multiplicador / (membros + 1))` — as duas engines ARREDONDAM PARA CIMA a cota
 * final. A fidelidade do ADR 0037 pede a REGRA observada, não o hábito local: um monstro de
 * 5 XP numa party de 4 únicas rende 3 por cabeça (`ceil(10/4)`), não 2 (`floor(10/4)`) — a soma
 * das cotas pode passar o pool por até `n − 1`, e é assim nas duas engines de origem.
 *
 * Não chama `xpPool`: dividir o pool já FLOORADO perderia a fração que o `ceil` de uma conta só
 * preserva (`ceil(a/b)` ≠ `ceil(floor(a)/b)` em geral). Zero elegíveis é zero.
 */
export function xpShare(experience: number, eligible: readonly PartyMember[], config: PartyConfig): number {
  if (eligible.length === 0) return 0;
  if (eligible.length === 1) return experience;
  const percent = xpPoolPercent(eligible, config);
  return Math.ceil((experience * percent) / (100 * eligible.length));
}

/** Um elegível, com o que a elegibilidade de XP compartilhada do TFS/Canary precisa ler. */
export interface SharedExperienceMember {
  readonly id: string;
  readonly level: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /**
   * Instante do último ataque ou cura deste membro, no relógio LÓGICO da sessão. `null` é
   * "nunca agiu" (ou nunca desde que entrou) — o equivalente a não ter entrada no `ticksMap` do
   * TFS/Canary, que também é tratado como INATIVO (`SHAREDEXP_MEMBERINACTIVE`).
   */
  readonly lastActionAtMs: number | null;
}

/** Os parâmetros de `Party::canUseSharedExperience`. Ver `PartyConfig.sharedExperience`. */
export interface SharedExperienceRules {
  readonly rangeTiles: number;
  readonly floors: number;
  readonly levelRangeDivisor: number;
  readonly activityWindowMs: number;
}

/** O default do TFS/Canary (30 tiles, 1 andar, 2/3 do level, 2 min) — ver o schema em `content`. */
export const DEFAULT_SHARED_EXPERIENCE_RULES: SharedExperienceRules = {
  rangeTiles: 30, floors: 1, levelRangeDivisor: 1.5, activityWindowMs: 120_000,
};

/**
 * A XP compartilhada do TFS/Canary é TUDO OU NADA (`Party::getSharedExperienceStatus`): com 0 ou
 * 1 elegível não há o que compartilhar (`xpShare` já devolve a XP inteira sem ler a tabela), e
 * com 2+ a regra vale se, e só se, TODO elegível atende ao mesmo tempo:
 *
 * - **nível**: `level ≥ ceil(maiorLevel / levelRangeDivisor)` — `maiorLevel` é o MAIOR entre
 *   TODOS os participantes da sessão (`highestLevel`, não só os elegíveis desta chamada): um
 *   membro exausto ainda é da party e ainda define a régua, mesmo sem receber cota nenhuma.
 * - **alcance**: dentro de `rangeTiles` em x/y e `floors` em z do LÍDER — nunca entre membros
 *   entre si (`leader->getPosition()` nas duas engines). Com hunt multiandar (#519), `z` vem da
 *   posição de cada um; hunt de andar único tem `z` igual para todos e o teste sempre passa.
 * - **atividade**: bateu ou curou dentro de `activityWindowMs` (`lastActionAtMs`).
 *
 * Falhar QUALQUER uma delas desliga a divisão igual para o abate inteiro — não só para quem
 * falhou —, e quem chama cai para `xpByDamage` (§525, ADR 0027 emenda 2026-09-24).
 *
 * Pura: sem RNG, sem relógio (recebe `nowMs`), sem I/O — como o resto deste arquivo.
 */
export function canShareExperience(
  eligible: readonly SharedExperienceMember[],
  highestLevel: number,
  leaderPosition: SharedExperienceMember['position'],
  nowMs: number,
  rules: SharedExperienceRules,
): boolean {
  if (eligible.length <= 1) return true;
  const minLevel = Math.ceil(highestLevel / rules.levelRangeDivisor);
  return eligible.every((member) => {
    if (member.level < minLevel) return false;
    if (Math.abs(member.position.x - leaderPosition.x) > rules.rangeTiles) return false;
    if (Math.abs(member.position.y - leaderPosition.y) > rules.rangeTiles) return false;
    if (Math.abs(member.position.z - leaderPosition.z) > rules.floors) return false;
    if (member.lastActionAtMs === null) return false;
    return nowMs - member.lastActionAtMs <= rules.activityWindowMs;
  });
}

/**
 * A XP sem compartilhamento — Tibia sem party, ou com a compartilhada desligada pela regra
 * acima: cada elegível recebe pelo DANO que causou neste abate, `floor(dano / total × xp)`,
 * igual ao `Creature::getGainedExperience` do TFS/Canary (`floor(damageRatio × lostExperience)`).
 * Quem não bateu (dano ausente ou zero) recebe zero — a party não "cobre" quem ficou parado.
 *
 * `total` é a soma de TODO `damageByActor` (§525): dano de quem não está mais elegível (morreu,
 * saiu) ainda reduz a fatia dos outros, como nas engines de origem — o `damageMap` delas não é
 * filtrado por quem ainda pode receber XP.
 */
export function xpByDamage(
  experience: number,
  eligible: readonly PartyMember[],
  damageByActor: Readonly<Record<string, number>>,
): ReadonlyMap<string, number> {
  const shares = new Map<string, number>();
  const total = Object.values(damageByActor).reduce((sum, damage) => sum + damage, 0);
  if (total <= 0) return shares;
  for (const member of eligible) {
    const damage = damageByActor[member.id] ?? 0;
    if (damage <= 0) continue;
    shares.set(member.id, Math.floor((damage / total) * experience));
  }
  return shares;
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
