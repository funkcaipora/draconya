// A entidade monstro (FUN-40, §17.1).
//
// Comportamento simples e previsível, inspirado no Tibia. IA sofisticada para mob comum NÃO é
// objetivo do MVP — e não é economia de esforço: previsível é o que deixa o jogador planejar,
// e é o que faz uma hunt AFK render sem supervisão.

import type { Monster } from '@draconya/content';
import { monsterAttackRange } from '@draconya/content';
import { Cooldowns } from '../cooldown.js';
import { Contribution } from '../death.js';
import type { ContributionState } from '../death.js';
import type { CooldownState } from '../cooldown.js';
import { distance, greedyStep, type Blocked, type GridPoint } from './step.js';

export interface MonsterState {
  readonly id: number;
  readonly monsterId: string;
  readonly position: GridPoint;
  readonly health: number;
  /** De onde ele saiu. É para onde volta quando desiste do alvo. */
  readonly home: GridPoint;
  readonly targetId: string | null;
  /**
   * O golpe está ENGATILHADO, esperando alguém entrar no alcance?
   *
   * Um cooldown de ataque não corre no vazio: quem passou o intervalo inteiro sem alvo bate no
   * instante em que um aparece, e não no próximo múltiplo de um relógio. Antes da FUN-68 isso
   * saía de graça, porque o acumulador só era consultado quando havia alvo — e ele congelava
   * sozinho no resto do tempo. Com a fila, o estado precisa ser dito em voz alta.
   *
   * Ausente é `true`: uma criatura que acabou de nascer bate assim que encosta.
   */
  readonly attackReady?: boolean;
  /** Velocidade na escala do Tibia, copiada da definição (FUN-119). Ausente: quem restaura repõe. */
  readonly speed?: number;
  /** Quem bateu nele e quanto (FUN-63). Ausente é snapshot anterior: atribuição vazia. */
  readonly contribution?: ContributionState;
  /**
   * As abilities DECLARADAS com evento pendente na fila (CMB-06). A básica usa `attackReady`;
   * estas vivem aqui para a invariante "engatilhada OU agendada" valer por ability.
   *
   * Ausente é nenhuma agendada — snapshot anterior a esta issue, que não tinha ability nenhuma
   * para agendar.
   */
  readonly scheduledAbilities?: readonly string[];
  readonly cooldowns: Partial<CooldownState>;
}

/**
 * O `subject` dos eventos de um monstro na fila da sessão: é por ele que um monstro morto leva
 * os próprios eventos junto. A convenção mora aqui, e não em quem agenda, para o pipeline de
 * morte cancelar sem conhecer a hunt.
 */
export const monsterSubject = (id: number): string => `m:${id}`;

/** O que o monstro consegue enxergar de um alvo. Estreito para não arrastar o mundo junto. */
export interface Prey {
  readonly id: string;
  readonly position: GridPoint;
  readonly alive: boolean;
}

/**
 * O que o monstro faz NESTE instante — uma ação, nunca uma quantidade.
 *
 * A FUN-67 foi um defeito de quantidade: o acumulador concedia N aplicações e dois dos quatro
 * chamadores aplicavam uma só, jogando o resto fora. A hunt desanexada sofria metade do dano
 * que devia. Desde a FUN-68 quem decide a hora é o evento, cada vencimento vale exatamente uma
 * ação, e a quantidade sai do tipo — o defeito deixa de ser possível de escrever.
 */
export type MonsterAction =
  | { readonly kind: 'idle' }
  /** O tile a pisar. Um por vencimento. */
  | { readonly kind: 'step'; readonly to: GridPoint }
  | { readonly kind: 'attack'; readonly targetId: string };

export class MonsterRuntime {
  readonly id: number;
  readonly monsterId: string;
  readonly home: GridPoint;
  position: GridPoint;
  health: number;
  targetId: string | null;
  /** Ver `MonsterState.attackReady`. */
  attackReady: boolean;
  speed: number;
  /** Mutada no lugar a cada golpe — ver `recordDamage`. */
  readonly contribution: Contribution;
  readonly cooldowns: Cooldowns;
  /**
   * As abilities declaradas que têm evento pendente (CMB-06). Ver `MonsterState.scheduledAbilities`.
   * A básica não entra aqui: ela usa `attackReady`, como sempre.
   */
  readonly scheduledAbilities: Set<string>;

  constructor(state: MonsterState) {
    this.id = state.id;
    this.monsterId = state.monsterId;
    this.position = state.position;
    this.home = state.home;
    this.health = state.health;
    this.targetId = state.targetId;
    this.attackReady = state.attackReady ?? true;
    this.speed = state.speed ?? 0;
    this.contribution = Contribution.fromState(state.contribution);
    this.cooldowns = Cooldowns.fromState(state.cooldowns);
    this.scheduledAbilities = new Set(state.scheduledAbilities ?? []);
  }

  get alive(): boolean {
    return this.health > 0;
  }

  get subject(): string {
    return monsterSubject(this.id);
  }

  getState(): MonsterState {
    return {
      id: this.id,
      monsterId: this.monsterId,
      position: this.position,
      health: this.health,
      home: this.home,
      targetId: this.targetId,
      attackReady: this.attackReady,
      speed: this.speed,
      contribution: this.contribution.getState(),
      cooldowns: this.cooldowns.getState(),
      ...(this.scheduledAbilities.size === 0
        ? {}
        : { scheduledAbilities: [...this.scheduledAbilities] }),
    };
  }

  receiveDamage(amount: number): number {
    const applied = Math.min(amount, this.health);
    this.health = Math.max(0, this.health - applied);
    return applied;
  }
}

/**
 * Escolhe alvo, e só quando precisa.
 *
 * Manter o alvo até ele morrer ou sair do raio de desistência é o que impede a varredura de
 * acontecer a cada tick: numa instância com 48 monstros, procurar sempre é trabalho jogado
 * fora dezenas de vezes por segundo. É também o comportamento do Tibia — o monstro não troca
 * de alvo porque outro jogador passou um tile mais perto.
 */
export function chooseTarget(
  monster: MonsterRuntime,
  prey: readonly Prey[],
  definition: Monster,
): string | null {
  const current = monster.targetId === null
    ? undefined
    : prey.find((p) => p.id === monster.targetId);

  if (current !== undefined && current.alive) {
    const leash = definition.leashRadius;
    // Zero significa "nunca desiste": um monstro que larga o alvo no meio de uma hunt AFK
    // faria o jogador voltar e encontrar tudo parado sem explicação.
    if (leash === 0 || distance(monster.home, current.position) <= leash) return current.id;
  }

  let closest: Prey | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of prey) {
    if (!candidate.alive) continue;
    const d = distance(monster.position, candidate.position);
    if (d > definition.aggroRadius || d >= closestDistance) continue;
    closest = candidate;
    closestDistance = d;
  }
  return closest?.id ?? null;
}

/**
 * O que o monstro faz neste instante. Decide, não aplica: quem move e quem tira vida é a
 * sessão, que é a dona do estado (invariante 9).
 *
 * Não recebe `dtMs` e não consulta cooldown nenhum: QUANDO agir é a fila de eventos que sabe
 * (FUN-68). Aqui só se responde "o que, agora" — e é o que torna a função pura de tempo,
 * testável com um instante e nada mais.
 */
export function decideMonsterAction(
  monster: MonsterRuntime,
  target: Prey | null,
  definition: Monster,
  blocked: Blocked,
): MonsterAction {
  if (!monster.alive || target === null || !target.alive) return { kind: 'idle' };

  // O alcance de parada é o MAIOR entre as abilities (CMB-06): um monstro de ability à
  // distância 4 para a 4 tiles e atira, em vez de colar no alvo como um corpo a corpo.
  if (distance(monster.position, target.position) <= monsterAttackRange(definition)) {
    return { kind: 'attack', targetId: target.id };
  }

  const to = greedyStep(monster.position, target.position, blocked);
  // Empacou numa concavidade: o guloso não contorna, e é assim mesmo (ADR 0009). O passo
  // perdido não vira dívida — parado é parado, e o próximo vencimento tenta de novo.
  return to === null ? { kind: 'idle' } : { kind: 'step', to };
}
