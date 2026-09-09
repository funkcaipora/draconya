// Morte como pipeline (FUN-63) — §30 do documento de referência OpenTibia.
//
//   HP <= 0 → congela a criatura → resolve quem matou → CONSEQUÊNCIA do ruleset
//          → recompensa → despawn / respawn / transição
//
// A ordem é o que se copia da referência. O que NÃO se copia é o cadáver: aqui a morte vira
// crédito, não container (§26). E a consequência é do RULESET, nunca da criatura — a hunt
// encerra em PZ, a guild war respawna, o boss varia por dificuldade. Antes disto a morte do
// monstro e a do personagem eram dois caminhos separados dentro do `HuntRuleset`; boss e
// guild war precisariam de um terceiro e de um quarto, e é assim que isso apodrece.
//
// A atribuição existe mesmo sem cadáver: `damageByActor` e `lastHitBy` são o que XP de party,
// elegibilidade de boss, bestiário e PvP vão ler depois. Guardar agora custa um mapa com no
// máximo quatro chaves por criatura viva; guardar depois custa uma migração de snapshot.

import type { CharacterRuntime } from './character.js';
import type { MonsterRuntime } from './monster/monster.js';
import type { Session } from './session.js';

/**
 * Quem bateu em quem, e quanto. Serializado com a criatura: uma sessão retomada não pode
 * perder a atribuição, senão o abate credita a quem estava por perto na hora errada.
 */
export interface ContributionState {
  readonly damageByActor: Readonly<Record<string, number>>;
  readonly lastHitBy?: string;
}

export interface KillCredit {
  /** Quem desferiu o último golpe. É a quem a hunt credita hoje (DT-03). */
  readonly lastHitBy: string | null;
  /** Quem causou mais dano. Pode diferir do último golpe, e é o que party vai usar. */
  readonly mostDamageBy: string | null;
  readonly damageByActor: Readonly<Record<string, number>>;
}

/** Quem morreu. O ruleset decide o que isso significa; o pipeline só sabe que aconteceu. */
export type Victim =
  | { readonly kind: 'character'; readonly character: CharacterRuntime }
  | { readonly kind: 'monster'; readonly monster: MonsterRuntime };

/**
 * A atribuição em memória. `Map`, e não o `Record` do snapshot: isto é escrito a cada golpe de
 * cada monstro, e o objeto de chaves dinâmicas com `delete` cai em modo dicionário — medido no
 * `pnpm bench:hunts`, ~2 µs por tick por instância só nisso. O `Record` é a forma serializada,
 * produzida em `getState` e lida em `fromState`, uma vez por snapshot.
 */
export class Contribution {
  readonly #damage = new Map<string, number>();
  #lastHitBy: string | null = null;

  /** Cópia própria: mutar o objeto que o Redis devolveu seria mutar o snapshot. */
  static fromState(state: ContributionState | undefined): Contribution {
    const contribution = new Contribution();
    if (state === undefined) return contribution;
    for (const [actorId, amount] of Object.entries(state.damageByActor)) {
      contribution.#damage.set(actorId, amount);
    }
    contribution.#lastHitBy = state.lastHitBy ?? null;
    return contribution;
  }

  get lastHitBy(): string | null {
    return this.#lastHitBy;
  }

  damageBy(actorId: string): number {
    return this.#damage.get(actorId) ?? 0;
  }

  get actorCount(): number {
    return this.#damage.size;
  }

  /**
   * Registra um golpe. MUTA no lugar: isto roda a cada golpe de cada criatura de cada
   * instância, e qualquer objeto novo aqui é o coletor rodando o tempo todo com 5.000
   * instâncias. Golpe sem dano (esquiva, absorção total) não conta: ninguém "matou" com zero.
   */
  record(actorId: string, amount: number): void {
    if (amount <= 0) return;
    this.#damage.set(actorId, (this.#damage.get(actorId) ?? 0) + amount);
    this.#lastHitBy = actorId;
  }

  /**
   * Esquece um ator que deixou de existir. Chamado quando um monstro morre, para cada
   * personagem em que ele bateu: sem isto, o mapa do personagem ganha uma chave por monstro
   * que já o atingiu — e como cada respawn tem id novo, numa hunt de oito horas são milhares
   * de chaves, serializadas a cada snapshot. Com a poda, o mapa fica do tamanho do que vive.
   */
  forget(actorId: string): void {
    if (!this.#damage.delete(actorId)) return;
    if (this.#lastHitBy === actorId) this.#lastHitBy = null;
  }

  /** Resolve o crédito. Empate em dano vai para quem bateu primeiro. */
  credit(): KillCredit {
    let mostDamageBy: string | null = null;
    let most = 0;
    const damageByActor: Record<string, number> = {};
    for (const [actorId, damage] of this.#damage) {
      damageByActor[actorId] = damage;
      if (damage <= most) continue;
      most = damage;
      mostDamageBy = actorId;
    }
    return { lastHitBy: this.#lastHitBy, mostDamageBy, damageByActor };
  }

  getState(): ContributionState {
    const damageByActor: Record<string, number> = {};
    for (const [actorId, damage] of this.#damage) damageByActor[actorId] = damage;
    return this.#lastHitBy === null
      ? { damageByActor }
      : { damageByActor, lastHitBy: this.#lastHitBy };
  }
}

export function emptyContribution(): Contribution {
  return new Contribution();
}

export function recordDamage(contribution: Contribution, actorId: string, amount: number): void {
  contribution.record(actorId, amount);
}

export function forgetActor(contribution: Contribution, actorId: string): void {
  contribution.forget(actorId);
}

export function creditFor(contribution: Contribution): KillCredit {
  return contribution.credit();
}

/**
 * O pipeline. Congela a criatura, resolve o crédito e entrega a CONSEQUÊNCIA ao ruleset.
 *
 * Congelar vem primeiro e é do pipeline, não do ruleset: morto não anda, não bate e não
 * regenera, e os eventos dele saem da fila em vez de vencerem para descobrir isso. Deixar cada
 * ruleset lembrar de cancelar é como um monstro morto continua acordando uma vez por cadência,
 * para sempre.
 */
export function resolveDeath(session: Session, victim: Victim): KillCredit {
  const subject = victim.kind === 'character' ? victim.character.id : victim.monster.subject;
  session.cancelEvents(subject);
  const credit = (
    victim.kind === 'character' ? victim.character.contribution : victim.monster.contribution
  ).credit();
  session.ruleset.onCreatureDied(session, victim, credit);
  return credit;
}
