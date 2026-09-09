// Estado quente do personagem. A sessão dona é o único objeto que escreve aqui
// (invariante 9) — é também o que dispensa lock sobre o gold.

import { Cooldowns } from './cooldown.js';
import type { CooldownState } from './cooldown.js';

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CharacterState {
  readonly id: string;
  readonly position: Point;
  readonly health: number;
  readonly maxHealth: number;
  readonly mana: number;
  readonly maxMana: number;
  readonly level: number;
  /** XP ACUMULADA, não o progresso dentro do level. Ver `progression.ts` (FUN-37). */
  readonly xp: number;
  /**
   * A vocação escolhida, ou ausente enquanto não há uma — o personagem nasce sem e escolhe no
   * level 8 (§7.4).
   *
   * Opcional, e não `string | null` obrigatório, porque snapshot gravado antes da FUN-37 não
   * tem a chave. Ausente e `null` querem dizer a mesma coisa aqui — "sem vocação" —, então o
   * formato antigo continua legível e o `SNAPSHOT_FORMAT_VERSION` não precisou subir.
   */
  readonly vocationId?: string | null;
  /** Variação de gold desta sessão. Vira linha de ledger ao encerrar (invariante 10). */
  readonly goldDelta: number;
  readonly alive: boolean;
  readonly cooldowns: Partial<CooldownState>;
}

export class CharacterRuntime {
  readonly id: string;
  position: Point;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  level: number;
  xp: number;
  vocationId: string | null;
  goldDelta: number;
  alive: boolean;
  readonly cooldowns: Cooldowns;

  constructor(state: CharacterState) {
    this.id = state.id;
    this.position = state.position;
    this.health = state.health;
    this.maxHealth = state.maxHealth;
    this.mana = state.mana;
    this.maxMana = state.maxMana;
    this.level = state.level;
    this.xp = state.xp;
    this.vocationId = state.vocationId ?? null;
    this.goldDelta = state.goldDelta;
    this.alive = state.alive;
    this.cooldowns = Cooldowns.fromState(state.cooldowns);
  }

  getState(): CharacterState {
    return {
      id: this.id,
      position: this.position,
      health: this.health,
      maxHealth: this.maxHealth,
      mana: this.mana,
      maxMana: this.maxMana,
      level: this.level,
      xp: this.xp,
      vocationId: this.vocationId,
      goldDelta: this.goldDelta,
      alive: this.alive,
      cooldowns: this.cooldowns.getState(),
    };
  }

  /** Aplica dano e devolve quanto foi de fato aplicado. Morrer é decisão do ruleset. */
  receiveDamage(amount: number): number {
    const applied = Math.min(amount, this.health);
    this.health -= applied;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    return applied;
  }

  heal(amount: number): number {
    const applied = Math.min(amount, this.maxHealth - this.health);
    this.health += applied;
    return applied;
  }
}
