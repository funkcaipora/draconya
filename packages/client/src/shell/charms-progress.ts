// A economia de Charms em números (M39-02, #602, ADR 0052/0053), fora do componente para ser
// testável — o mesmo padrão de `bestiary-progress.ts`.
//
// **Isto é apresentação, não regra.** Quem decide se um desbloqueio/atribuição/remoção é
// aceito é o servidor (`sim/charms.ts`, `game/host.ts`); o cliente não simula. O que se calcula
// aqui é "quantos pontos/echoes o jogador já ganhou" e "quanto falta para o próximo tier", a
// partir do registro CRU que o servidor manda (`charms`) e do catálogo fixado na sessão
// (`catalogue.charms`/`catalogue.bestiary`, invariante 7). Se as duas contas divergirem, a do
// servidor é a verdadeira — nada daqui volta pelo socket (invariante 4).

import type { BestiaryCharmThresholds } from './bestiary-progress.js';
import { charmPointsEarned } from './bestiary-progress.js';

export type CharmTier = 0 | 1 | 2 | 3;

export interface CharmCatalogueEntry {
  readonly id: string;
  readonly name: string;
  readonly category: 'major' | 'minor';
  readonly type: 'offensive' | 'defensive' | 'passive';
  readonly damageType?: string | undefined;
  readonly percent?: number | undefined;
  readonly chance: readonly [number, number, number];
  readonly points: readonly [number, number, number];
}

export interface CharmsRegisterView {
  readonly pointsSpent: number;
  readonly echoesSpent: number;
  readonly tiers: Readonly<Record<string, number>>;
  readonly assignments: Readonly<Record<string, string>>;
}

/** Quantos slots de atribuição o Premium dá (ADR 0053 d.4): 2 Free, 6 Premium. A Charm
 * Expansion (25, Loja/M22) ainda não existe. */
export function charmSlotsFor(premium: boolean): number {
  return premium ? 6 : 2;
}

/**
 * Pontos de Charm GANHOS até agora — a mesma conta de `charmPointsEarned` (Bestiário), só
 * reexportada com o nome do domínio para quem lê a tela de Charms não precisar saber que a
 * fórmula mora no arquivo do Bestiário.
 */
export function charmPointsAvailable(
  counts: Readonly<Record<string, number>>,
  entries: Readonly<Record<string, BestiaryCharmThresholds>>,
  pointsSpent: number,
): number {
  return charmPointsEarned(counts, entries) - pointsSpent;
}

/**
 * Echoes de Charm Menor GANHOS até agora: `Σ (25·t² + 25·t + 50)` sobre cada tier MAJOR já
 * atravessado de cada charm major (`t` = 0, 1, 2) — a mesma fórmula que `sim/charms.ts` usa
 * para decidir o desbloqueio; aqui é só para MOSTRAR o saldo antes de o jogador tentar.
 */
export function echoesEarned(
  tiers: Readonly<Record<string, number>>,
  catalogue: readonly CharmCatalogueEntry[],
): number {
  const byId = new Map(catalogue.map((charm) => [charm.id, charm]));
  let total = 0;
  for (const [charmId, tier] of Object.entries(tiers)) {
    if (byId.get(charmId)?.category !== 'major') continue;
    for (let t = 0; t < tier; t += 1) total += 25 * t * t + 25 * t + 50;
  }
  return total;
}

export function echoesAvailable(
  tiers: Readonly<Record<string, number>>,
  catalogue: readonly CharmCatalogueEntry[],
  echoesSpent: number,
): number {
  return echoesEarned(tiers, catalogue) - echoesSpent;
}

/** O custo do PRÓXIMO tier (`tier` atual → `tier + 1`), ou `null` no tier máximo (3). */
export function nextTierCost(charm: CharmCatalogueEntry, tier: CharmTier): number | null {
  if (tier >= 3) return null;
  // `tier` já é 0/1/2 aqui; o índice de tupla de 3 posições não se estreita sozinho a partir
  // disso (a mesma armadilha de `sim/charms.ts`), então a tupla vira array simples para a leitura.
  return (charm.points as readonly number[])[tier] as number;
}
