// As condições temporárias do personagem (#155, ADR 0026 decisão 5; referência §20).
//
// Haste, postura, magic shield e cura ao longo do tempo são a MESMA coisa para o motor: um
// estado com prazo, que muda uma leitura (velocidade, dano causado, dano tomado, dano→mana) ou
// dispara um tique. A referência manda criar isto ANTES de haver muitas magias, e é o que faz
// veneno e paralisia, quando existirem, serem mais uma chave aqui e não mais um campo no
// snapshot.
//
// **Nada de tempo aqui.** `expiresAtMs` é um instante LÓGICO da sessão; quem faz a condição
// vencer é a fila de eventos do ruleset (`CONDITION_EXPIRE`, invariante 2). Este módulo só
// guarda e responde. Política de stacking: uma por `key`, e relançar SUBSTITUI (`refresh`) —
// é o que o Tibia faz com haste e postura, e evita dois hastes somando.

export type ConditionKind = 'haste' | 'buff' | 'mana-shield' | 'heal-over-time';

/**
 * A FAMÍLIA de golpe que a condição escala (`damageDealtPercent`). É vocabulário de skill, não
 * de resolução: `distance` cobre bow e munição, `spell` cobre magia, runa e wand. Não confundir
 * com o `DamageSource` canônico do resolver (CMB-02), que diz de ONDE o dano veio.
 */
export type DamageScaleSource = 'melee' | 'distance' | 'spell';

export interface DamagePercentBySource {
  readonly melee?: number | undefined;
  readonly distance?: number | undefined;
  readonly spell?: number | undefined;
}

export interface ConditionState {
  /** Uma por tipo: relançar reinicia (refresh). */
  readonly key: ConditionKind;
  readonly spellId: string;
  /** Instante LÓGICO da sessão em que vence. Nunca relógio de processo. */
  readonly expiresAtMs: number;
  readonly speedPercent?: number;
  readonly damageDealtPercent?: DamagePercentBySource;
  readonly damageTakenPercent?: number;
  /** Cura periódica: `amount` a cada `intervalMs`, até `expiresAtMs`. */
  readonly tick?: { readonly amount: number; readonly intervalMs: number };
}

export class Conditions {
  readonly #active = new Map<ConditionKind, ConditionState>();

  static fromState(state: readonly ConditionState[] | undefined): Conditions {
    const conditions = new Conditions();
    if (state === undefined) return conditions;
    for (const condition of state) conditions.#active.set(condition.key, condition);
    return conditions;
  }

  getState(): readonly ConditionState[] {
    return [...this.#active.values()];
  }

  /** Substitui a de mesma chave e devolve a anterior — para quem chama cancelar o evento dela. */
  apply(condition: ConditionState): ConditionState | null {
    const previous = this.#active.get(condition.key) ?? null;
    this.#active.set(condition.key, condition);
    return previous;
  }

  remove(key: ConditionKind): ConditionState | null {
    const previous = this.#active.get(key) ?? null;
    this.#active.delete(key);
    return previous;
  }

  get(key: ConditionKind): ConditionState | null {
    return this.#active.get(key) ?? null;
  }

  get size(): number {
    return this.#active.size;
  }

  /** `1 + speedPercent/100` do haste, ou 1. */
  speedScale(): number {
    const haste = this.#active.get('haste');
    return haste?.speedPercent === undefined ? 1 : 1 + haste.speedPercent / 100;
  }

  /** O multiplicador de dano CAUSADO por fonte: haste (Swift Foot) e postura somam. */
  damageDealtScale(source: DamageScaleSource): number {
    let percent = 0;
    for (const condition of this.#active.values()) {
      percent += condition.damageDealtPercent?.[source] ?? 0;
    }
    return 1 + percent / 100;
  }

  /** O multiplicador de dano TOMADO. */
  damageTakenScale(): number {
    let percent = 0;
    for (const condition of this.#active.values()) percent += condition.damageTakenPercent ?? 0;
    return 1 + percent / 100;
  }

  hasManaShield(): boolean {
    return this.#active.has('mana-shield');
  }
}
