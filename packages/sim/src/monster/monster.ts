// A entidade monstro (FUN-40, §17.1).
//
// Comportamento simples e previsível, inspirado no Tibia. IA sofisticada para mob comum NÃO é
// objetivo do MVP — e não é economia de esforço: previsível é o que deixa o jogador planejar,
// e é o que faz uma hunt AFK render sem supervisão.

import type { Monster } from '@draconya/content';
import { Cooldowns } from '../cooldown.js';
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
  readonly cooldowns: Partial<CooldownState>;
}

/** O que o monstro consegue enxergar de um alvo. Estreito para não arrastar o mundo junto. */
export interface Prey {
  readonly id: string;
  readonly position: GridPoint;
  readonly alive: boolean;
}

/**
 * O que o monstro faz no tempo decorrido — com a QUANTIDADE junto, sempre.
 *
 * O cooldown periódico devolve quantas aplicações couberam em `dtMs` e debita todas do
 * acumulador; conceder uma só faz as outras sumirem. Num tick de 1 s, um monstro que ataca a
 * cada 500 ms bate METADE das vezes — e 1 Hz é exatamente a taxa da hunt desanexada, que é o
 * modo padrão do jogo (FUN-67). O tipo carrega a quantidade para não haver como esquecer.
 */
export type MonsterAction =
  | { readonly kind: 'idle' }
  /** Os tiles na ordem em que devem ser pisados. Mais de um quando o tick foi longo. */
  | { readonly kind: 'step'; readonly path: readonly GridPoint[] }
  /** Quantos golpes couberam. Aplicar TODOS. */
  | { readonly kind: 'attack'; readonly targetId: string; readonly times: number };

export class MonsterRuntime {
  readonly id: number;
  readonly monsterId: string;
  readonly home: GridPoint;
  position: GridPoint;
  health: number;
  targetId: string | null;
  readonly cooldowns: Cooldowns;

  constructor(state: MonsterState) {
    this.id = state.id;
    this.monsterId = state.monsterId;
    this.position = state.position;
    this.home = state.home;
    this.health = state.health;
    this.targetId = state.targetId;
    this.cooldowns = Cooldowns.fromState(state.cooldowns);
  }

  get alive(): boolean {
    return this.health > 0;
  }

  getState(): MonsterState {
    return {
      id: this.id,
      monsterId: this.monsterId,
      position: this.position,
      health: this.health,
      home: this.home,
      targetId: this.targetId,
      cooldowns: this.cooldowns.getState(),
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
 * Tudo por tempo decorrido, nunca por contagem de tick (invariante 2) — é o que permite a
 * hunt desanexada rodar a 1 Hz com o mesmo resultado.
 */
export function decideMonsterAction(
  monster: MonsterRuntime,
  target: Prey | null,
  definition: Monster,
  dtMs: number,
  blocked: Blocked,
): MonsterAction {
  if (!monster.alive || target === null || !target.alive) return { kind: 'idle' };

  if (distance(monster.position, target.position) <= definition.attackRange) {
    // Ataque é ação periódica: o acumulador recupera o atraso de um tick lento em vez de
    // perdê-lo, que é o que mantém o dano por minuto igual a 1 Hz e a 10 Hz.
    const times = monster.cooldowns.timesThatFit('attack', dtMs, definition.attackIntervalMs);
    return times > 0 ? { kind: 'attack', targetId: target.id, times } : { kind: 'idle' };
  }

  const steps = monster.cooldowns.timesThatFit('step', dtMs, definition.stepDurationMs);
  if (steps === 0) return { kind: 'idle' };

  // UM PASSO DE CADA VEZ, reavaliado da posição nova. Pular `steps` tiles de uma vez
  // atravessaria parede e monstro: o guloso decide olhando a vizinhança, e a vizinhança
  // muda a cada tile. `blocked` já exclui este monstro, e nenhum outro anda enquanto isto
  // roda, então a sequência aqui é a mesma que `steps` chamadas separadas dariam.
  const path: GridPoint[] = [];
  let at = monster.position;
  for (let i = 0; i < steps; i++) {
    const to = greedyStep(at, target.position, blocked);
    // Empacou numa concavidade: o guloso não contorna, e é assim mesmo (ADR 0009). Os
    // passos restantes não viram dívida — parado é parado.
    if (to === null) break;
    path.push(to);
    at = to;
    // Chegou ao alcance: PARA. Sem isto o monstro andaria por cima do alvo, que é o que a
    // versão de um passo só evitava por acidente — ela nunca dava o segundo.
    if (distance(at, target.position) <= definition.attackRange) break;
  }
  return path.length === 0 ? { kind: 'idle' } : { kind: 'step', path };
}
