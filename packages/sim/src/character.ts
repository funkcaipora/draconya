// Estado quente do personagem. A sessão dona é o único objeto que escreve aqui
// (invariante 9) — é também o que dispensa lock sobre o gold.

import { Cooldowns } from './cooldown.js';
import type { CooldownState } from './cooldown.js';
import { Contribution } from './death.js';
import type { ContributionState } from './death.js';
import { Skills } from './skills.js';
import type { SkillsState } from './skills.js';

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
  /**
   * Stamina que sobrava em `staminaUpdatedAtMs`, em milissegundos (§10). NÃO é decrementada
   * por ninguém fora da hunt: o valor de agora é calculado na leitura (ver `stamina.ts`).
   *
   * `null` — e ausente — significa "sem stamina rastreada", que é o que uma sessão gravada
   * antes da FUN-39 é. Ela roda sem teto até acabar, o que é preferível a inventar um valor
   * e cobrar de alguém uma stamina que nunca foi medida.
   */
  readonly staminaMs?: number | null;
  /** Instante de RELÓGIO (epoch) em que `staminaMs` valia. Não é o relógio da simulação. */
  readonly staminaUpdatedAtMs?: number;
  /**
   * Milissegundos por tile ao andar (FUN-69). Vem de `progression.stepDurationMs`, copiado
   * para cá como `maxHealth` é: o sistema de movimento pergunta à criatura, e a criatura não
   * conhece o conteúdo. Opcional porque snapshot gravado antes da FUN-69 não tem a chave;
   * quem restaura repõe a partir do conteúdo.
   */
  readonly stepDurationMs?: number;
  /**
   * Gold que o personagem TINHA ao entrar na sessão (FUN-77). Vem do ticket, nunca do cliente
   * (invariante 4), e não é escrito aqui: o que a sessão movimenta é `goldDelta`.
   *
   * Existe porque gastar exige saber o saldo, e o saldo é `gold + goldDelta`. Sem ele, uma
   * poção de 45 seria comprada por quem tem 10 e o delta ficaria negativo — o ledger
   * corrigiria depois, com o jogador já tendo bebido.
   *
   * Opcional: snapshot gravado antes desta issue não tem a chave, e ausente vira zero. A
   * degradação erra para o lado seguro — quem retoma uma sessão antiga não consegue gastar,
   * em vez de gastar o que não tem.
   */
  readonly gold?: number;
  /** Variação de gold desta sessão. Vira linha de ledger ao encerrar (invariante 10). */
  readonly goldDelta: number;
  readonly alive: boolean;
  /**
   * Skills que sobem por uso (§9.4, FUN-75). Ausente é snapshot ou personagem anterior a
   * elas — e aí toda skill vale o nível inicial do conteúdo, que é onde um personagem novo
   * começa. Opcional, então o `SNAPSHOT_FORMAT_VERSION` não precisou subir.
   */
  readonly skills?: SkillsState;
  /** Quem bateu nele e quanto (FUN-63). Ausente é snapshot anterior: atribuição vazia. */
  readonly contribution?: ContributionState;
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
  staminaMs: number | null;
  staminaUpdatedAtMs: number;
  /** Saldo de entrada. Ver `CharacterState.gold` — a sessão lê, nunca escreve. */
  readonly gold: number;
  goldDelta: number;
  alive: boolean;
  stepDurationMs: number;
  /** Mutadas no lugar a cada uso — ver `Skills.gain`. */
  readonly skills: Skills;
  /** Mutada no lugar a cada golpe — ver `recordDamage`. */
  readonly contribution: Contribution;
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
    this.staminaMs = state.staminaMs ?? null;
    this.staminaUpdatedAtMs = state.staminaUpdatedAtMs ?? 0;
    this.gold = state.gold ?? 0;
    this.goldDelta = state.goldDelta;
    this.alive = state.alive;
    // Zero é "não sabe ainda": quem tem o conteúdo (o ruleset, ao entrar) repõe. Um passo com
    // duração zero nunca chega ao fio — o protocolo exige duração positiva.
    this.stepDurationMs = state.stepDurationMs ?? 0;
    this.skills = Skills.fromState(state.skills);
    this.contribution = Contribution.fromState(state.contribution);
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
      staminaMs: this.staminaMs,
      staminaUpdatedAtMs: this.staminaUpdatedAtMs,
      stepDurationMs: this.stepDurationMs,
      gold: this.gold,
      goldDelta: this.goldDelta,
      alive: this.alive,
      skills: this.skills.getState(),
      contribution: this.contribution.getState(),
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
