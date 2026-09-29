// Charms (M39-02, #602): a economia do Bestiário do Canary — desbloqueio por pontos/echoes,
// atribuição a criatura e remoção. ADR 0052 decisão 1 (registro `jsonb` por sistema, última
// escrita vence, como `ammo`/`equipment` — não fusão por máximo como o Bestiário); ADR 0053
// d.3–d.4 (tiers, slots, custo de remoção).
//
// **Pontos e echoes são DERIVADOS, nunca somados à parte** — o mesmo princípio de
// `Bestiary.xpBonusPercent`: o total GANHO nunca é um contador que alguém incrementa; é sempre
// uma soma sobre o que já existe. Pontos de Charm ganhos vêm do Bestiário (`toKill` cumprido por
// monstro, como `bestiary-progress.ts` do cliente já calcula); echoes de Charm Menor vêm da
// própria progressão de tiers Major já registrada (`25·t² + 25·t + 50` por tier Major
// ATRAVESSADO, `IOBestiary::handleAction` do Canary). Só o GASTO (`pointsSpent`/`echoesSpent`)
// é estado — o mesmo desenho do `charms.pointsSpent` da Direção da issue.
//
// **`sim` não conhece opcode nem sessão.** Estas funções recebem o catálogo (`@draconya/content`,
// `Charm[]`), o Bestiário do personagem e a ficha de cada monstro (`toKill`/`charmsPoints`, de
// `content.bestiary.entries`) e devolvem um resultado tipado; quem decide se a intenção chega
// até aqui — Cidade ou hunt, invariante 9 — é o ruleset que chama.

import type { Charm } from '@draconya/content';
import type { Bestiary } from './bestiary.js';

export type CharmTier = 0 | 1 | 2 | 3;

/** O que `content.bestiary.entries[monsterId]` dá — só os dois campos que a economia usa. */
export interface CharmBestiaryEntry {
  readonly toKill: number;
  readonly charmsPoints: number;
}

export interface CharmsState {
  readonly pointsSpent: number;
  readonly echoesSpent: number;
  /** `charmId` → tier atual (0 = nunca desbloqueado). */
  readonly tiers: Readonly<Record<string, CharmTier>>;
  /** `charmId` → `monsterId` do alvo atribuído. */
  readonly assignments: Readonly<Record<string, string>>;
  readonly version: number;
}

/** Versão do registro (ADR 0052 d.1, como `botConfig.version`) — migra sem coluna nova. */
export const CHARMS_STATE_VERSION = 1;

export function emptyCharmsState(): CharmsState {
  return {
    pointsSpent: 0, echoesSpent: 0, tiers: {}, assignments: {}, version: CHARMS_STATE_VERSION,
  };
}

/** Quantos slots de atribuição o personagem tem (ADR 0053 d.4): 2 Free, 6 Premium. A Charm
 * Expansion (25, Loja/M22) fica fora do corte desta issue. */
export function charmSlotsFor(premium: boolean): number {
  return premium ? 6 : 2;
}

export type CharmUnlockRefusal =
  | 'unknown-charm'
  | 'already-max-tier'
  | 'not-enough-points'
  | 'not-enough-echoes';

export type CharmUnlockResult =
  | { readonly ok: true; readonly tier: CharmTier }
  | { readonly ok: false; readonly reason: CharmUnlockRefusal };

export type CharmAssignRefusal =
  | 'unknown-charm'
  | 'not-unlocked'
  | 'no-slots'
  | 'monster-not-complete'
  | 'category-taken';

export type CharmAssignResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CharmAssignRefusal };

export type CharmRemoveRefusal = 'unknown-charm' | 'not-assigned';

export type CharmRemoveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CharmRemoveRefusal };

export class Charms {
  #pointsSpent: number;
  #echoesSpent: number;
  readonly #tiers = new Map<string, CharmTier>();
  readonly #assignments = new Map<string, string>();

  private constructor(state: CharmsState) {
    this.#pointsSpent = state.pointsSpent;
    this.#echoesSpent = state.echoesSpent;
    for (const [charmId, tier] of Object.entries(state.tiers)) this.#tiers.set(charmId, tier);
    for (const [charmId, monsterId] of Object.entries(state.assignments)) {
      this.#assignments.set(charmId, monsterId);
    }
  }

  static fromState(state?: CharmsState): Charms {
    return new Charms(state ?? emptyCharmsState());
  }

  /** Uma CÓPIA — quem guarda para um snapshot não vê a ação seguinte aparecer nele. */
  getState(): CharmsState {
    return {
      pointsSpent: this.#pointsSpent,
      echoesSpent: this.#echoesSpent,
      tiers: Object.fromEntries(this.#tiers),
      assignments: Object.fromEntries(this.#assignments),
      version: CHARMS_STATE_VERSION,
    };
  }

  tierOf(charmId: string): CharmTier {
    return this.#tiers.get(charmId) ?? 0;
  }

  assignmentOf(charmId: string): string | undefined {
    return this.#assignments.get(charmId);
  }

  /** Quantos slots de atribuição já estão em uso. */
  slotsUsed(): number {
    return this.#assignments.size;
  }

  /**
   * Pontos de Charm GANHOS até agora — a soma de `charmsPoints` de todo monstro cuja ficha está
   * completa (`kills >= toKill`), pela MESMA regra de `bestiary-progress.ts` (cliente): total
   * ganho é sempre derivado do Bestiário, nunca um contador à parte.
   */
  pointsEarned(bestiary: Bestiary, entries: ReadonlyMap<string, CharmBestiaryEntry>): number {
    let total = 0;
    for (const [monsterId, entry] of entries) {
      if (bestiary.killsOf(monsterId) >= entry.toKill) total += entry.charmsPoints;
    }
    return total;
  }

  pointsAvailable(bestiary: Bestiary, entries: ReadonlyMap<string, CharmBestiaryEntry>): number {
    return this.pointsEarned(bestiary, entries) - this.#pointsSpent;
  }

  /**
   * Echoes de Charm Menor GANHOS até agora: `Σ (25·t² + 25·t + 50)` sobre cada tier MAJOR já
   * atravessado de cada charm major (`t` = 0, 1, 2 — o tier ANTES de cada desbloqueio), a
   * fórmula do `IOBestiary::handleAction` do Canary. Derivado do próprio `tiers`, nunca somado
   * à parte: um charm major no tier 2 já passou pelos tiers 0 e 1, e os dois já renderam echo.
   */
  echoesEarned(catalogue: ReadonlyMap<string, Charm>): number {
    let total = 0;
    for (const [charmId, tier] of this.#tiers) {
      const charm = catalogue.get(charmId);
      if (charm === undefined || charm.category !== 'major') continue;
      for (let t = 0; t < tier; t += 1) total += 25 * t * t + 25 * t + 50;
    }
    return total;
  }

  echoesAvailable(catalogue: ReadonlyMap<string, Charm>): number {
    return this.echoesEarned(catalogue) - this.#echoesSpent;
  }

  /**
   * Desbloqueia o PRÓXIMO tier de um charm (ADR 0053 d.3): major gasta pontos de Charm; minor
   * gasta echoes. `chance`/`points` são indexados pelo tier ATUAL (0, 1, 2) — o Canary faz
   * `charm->points[charmTier]` antes de incrementar.
   */
  unlock(charmId: string, catalogue: ReadonlyMap<string, Charm>, bestiary: Bestiary,
    entries: ReadonlyMap<string, CharmBestiaryEntry>): CharmUnlockResult {
    const charm = catalogue.get(charmId);
    if (charm === undefined) return { ok: false, reason: 'unknown-charm' };
    const tier = this.tierOf(charmId);
    if (tier >= 3) return { ok: false, reason: 'already-max-tier' };
    // `tier` já é 0/1/2 aqui (o `if` acima descarta 3); o índice de tupla de 3 posições não
    // se estreita sozinho a partir disso, então a tupla vira array simples para a leitura.
    const cost = (charm.points as readonly number[])[tier] as number;

    if (charm.category === 'major') {
      if (this.pointsAvailable(bestiary, entries) < cost) return { ok: false, reason: 'not-enough-points' };
      this.#pointsSpent += cost;
    } else {
      if (this.echoesAvailable(catalogue) < cost) return { ok: false, reason: 'not-enough-echoes' };
      this.#echoesSpent += cost;
    }
    const next = (tier + 1) as CharmTier;
    this.#tiers.set(charmId, next);
    return { ok: true, tier: next };
  }

  /**
   * Atribui um charm desbloqueado a um monstro (ADR 0053 d.4): slot livre (2 Free/6 Premium);
   * major exige a ficha completa (`kills >= toKill`, só para major — o Canary não exige isso de
   * minor); um major e um minor por criatura — nunca dois do mesmo tipo no mesmo alvo.
   * Reatribuir o MESMO charm (outro alvo) substitui, sem gastar slot a mais — é o mesmo
   * `charmId` na chave.
   */
  assign(charmId: string, monsterId: string, catalogue: ReadonlyMap<string, Charm>,
    bestiary: Bestiary, entries: ReadonlyMap<string, CharmBestiaryEntry>,
    options: { readonly premium: boolean }): CharmAssignResult {
    const charm = catalogue.get(charmId);
    if (charm === undefined) return { ok: false, reason: 'unknown-charm' };
    if (this.tierOf(charmId) < 1) return { ok: false, reason: 'not-unlocked' };

    const reassigning = this.#assignments.get(charmId) === monsterId;
    if (!reassigning && !this.#assignments.has(charmId)
      && this.slotsUsed() >= charmSlotsFor(options.premium)) {
      return { ok: false, reason: 'no-slots' };
    }

    if (charm.category === 'major') {
      const toKill = entries.get(monsterId)?.toKill;
      if (toKill === undefined || bestiary.killsOf(monsterId) < toKill) {
        return { ok: false, reason: 'monster-not-complete' };
      }
    }

    // Um major e um minor por criatura: nenhum OUTRO charm da MESMA categoria já aponta para
    // este alvo.
    for (const [otherId, otherTarget] of this.#assignments) {
      if (otherId === charmId || otherTarget !== monsterId) continue;
      const other = catalogue.get(otherId);
      if (other?.category === charm.category) return { ok: false, reason: 'category-taken' };
    }

    this.#assignments.set(charmId, monsterId);
    return { ok: true };
  }

  /** Remove a atribuição (ADR 0053 d.4) — o custo em gold é de quem chama (invariante 10). */
  remove(charmId: string): CharmRemoveResult {
    if (!this.#assignments.has(charmId)) return { ok: false, reason: 'not-assigned' };
    this.#assignments.delete(charmId);
    return { ok: true };
  }
}
