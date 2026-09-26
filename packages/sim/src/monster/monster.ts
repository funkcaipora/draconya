// A entidade monstro (FUN-40, §17.1).
//
// Comportamento simples e previsível, inspirado no Tibia. IA sofisticada para mob comum NÃO é
// objetivo do MVP — e não é economia de esforço: previsível é o que deixa o jogador planejar,
// e é o que faz uma hunt AFK render sem supervisão.

import type { Monster } from '@draconya/content';
import { monsterAttackRange } from '@draconya/content';
import { Cooldowns } from '../cooldown.js';
import { Conditions } from '../conditions.js';
import type { ConditionState } from '../conditions.js';
import { FULL_BLOCK_CHARGE, isFullBlockCharge } from '../combat/block-charge.js';
import type { BlockChargeState } from '../combat/block-charge.js';
import { Contribution } from '../death.js';
import type { ContributionState } from '../death.js';
import type { CooldownState } from '../cooldown.js';
import type { Rng } from '../rng.js';
import { rankTarget, type TargetRankCandidate } from './target-strategy.js';
import { distance, fleeStep, greedyStep, sameFloor, type Blocked, type FloorPoint, type GridPoint } from './step.js';

export interface MonsterState {
  readonly id: number;
  readonly monsterId: string;
  /**
   * O `z` é opcional (#519, hunt multiandar): ausente é o andar padrão do mapa — snapshot
   * anterior a esta issue, ou hunt de andar único, onde nenhum monstro precisou dizer em que
   * andar nasceu porque só havia um. O spawner passou a preenchê-lo com o andar do PONTO de
   * spawn, não do mapa — é o que faz um Dragon Lord nascer em z11 e não em z10.
   */
  readonly position: FloorPoint;
  readonly health: number;
  /** De onde ele saiu. É para onde volta quando desiste do alvo. */
  readonly home: FloorPoint;
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
  /**
   * As DEFESAS declaradas com evento pendente na fila (#518) — mesma invariante e mesma razão
   * de `scheduledAbilities`, agora para `monster.defenses`. Ausente é nenhuma agendada.
   */
  readonly scheduledDefenses?: readonly string[];
  /**
   * O monstro que o invocou (#546, TFS `Creature::master`/`setMaster`). Ausente é nascido do
   * Spawner — o comportamento de sempre. Presente, é o id de OUTRO monstro desta instância: a
   * invocação não ocupa slot do Spawner, não paga XP nem loot, não conta no Bestiário
   * (`Player::onKilledMonster`, `hasBeenSummoned()`), e some quando o mestre morre ou é
   * removido (TFS `Game::removeCreature`). Campo NOVO e aditivo: ausente é sempre "não é
   * invocação", sem bump de formato.
   */
  readonly masterId?: number;
  /**
   * As entradas de invocação DECLARADAS com evento pendente na fila (#546) — mesma invariante e
   * mesmo desenho de `scheduledDefenses`, agora para `monster.summons.entries`. Ausente é
   * nenhuma agendada — o caso de sempre, e o único caso para quem tem `masterId` (uma invocação
   * nunca arma a própria lista de invocação).
   */
  readonly scheduledSummons?: readonly string[];
  /**
   * As condições ativas (CMB-07): DOT de magia, lentidão, o que a condição fizer. Mesmo estado
   * do personagem, e mesma regra de snapshot: ausente é nenhuma, sem bump de formato.
   */
  readonly conditions?: readonly ConditionState[];
  readonly cooldowns: Partial<CooldownState>;
  /**
   * As cargas de bloqueio do `combat-v3` (#548, ADR 0040): `block-charge.ts`. Ausente é
   * `FULL_BLOCK_CHARGE` — o monstro que nunca bloqueou ainda, ou snapshot anterior a esta
   * issue. Sem bump de `SNAPSHOT_FORMAT_VERSION`, como `conditions`.
   */
  readonly blockCharge?: BlockChargeState;
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
  readonly position: FloorPoint;
  readonly alive: boolean;
  /**
   * A vida atual (#541): só a estratégia ponderada de alvo lê isto — o critério `health` de
   * `rankTarget`. `CharacterRuntime` já tem `health` público; nenhum chamador precisa montar
   * nada à parte.
   */
  readonly health: number;
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
  /**
   * O tile a pisar para AUMENTAR a distância do alvo (#542, manter distância). Distinto de
   * `step` para quem consome a ação poder ver, sem recalcular nada, que o monstro recuou em vez
   * de aproximar — o mesmo motivo pelo qual a fuga por vida baixa é sempre `step` de qualquer
   * forma hoje: aqui vale a pena nomear porque `retreat` e `step` nascem de ramos diferentes de
   * `decideMonsterAction` e um teste ou uma telemetria futura não deveriam reconstruir a
   * distinção comparando posições.
   */
  | { readonly kind: 'retreat'; readonly to: GridPoint }
  | { readonly kind: 'attack'; readonly targetId: string };

export class MonsterRuntime {
  readonly id: number;
  readonly monsterId: string;
  readonly home: FloorPoint;
  position: FloorPoint;
  health: number;
  targetId: string | null;
  /** Ver `MonsterState.attackReady`. */
  attackReady: boolean;
  speed: number;
  /**
   * Nunca usa escada (#519, hunt multiandar) — `movement.ts` lê isto para não deixar o
   * `z` que a posição agora carrega virar permissão de trocar de andar sozinho. Ver o
   * comentário de `Movable.crossesFloors`.
   */
  readonly crossesFloors = false;
  /** Mutada no lugar a cada golpe — ver `recordDamage`. */
  readonly contribution: Contribution;
  readonly cooldowns: Cooldowns;
  /**
   * As abilities declaradas que têm evento pendente (CMB-06). Ver `MonsterState.scheduledAbilities`.
   * A básica não entra aqui: ela usa `attackReady`, como sempre.
   */
  readonly scheduledAbilities: Set<string>;
  /** Ver `MonsterState.scheduledDefenses` (#518). */
  readonly scheduledDefenses: Set<string>;
  /** Ver `MonsterState.masterId` (#546). `null` é "não é invocação" — o de sempre. */
  readonly masterId: number | null;
  /** Ver `MonsterState.scheduledSummons` (#546). */
  readonly scheduledSummons: Set<string>;
  /** Mutadas pelo ruleset ao lançar e ao vencer — ver `Conditions` (CMB-07). */
  readonly conditions: Conditions;
  /**
   * As cargas de bloqueio do `combat-v3` (#548). Só `applyDamageOutcome` escreve (CMB-08,
   * invariante 9) — ver `MonsterState.blockCharge`.
   */
  blockCharge: BlockChargeState;

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
    this.scheduledDefenses = new Set(state.scheduledDefenses ?? []);
    this.masterId = state.masterId ?? null;
    this.scheduledSummons = new Set(state.scheduledSummons ?? []);
    this.conditions = Conditions.fromState(state.conditions);
    this.blockCharge = state.blockCharge ?? FULL_BLOCK_CHARGE;
  }

  get alive(): boolean {
    return this.health > 0;
  }

  get subject(): string {
    return monsterSubject(this.id);
  }

  /**
   * Velocidade com sinal (CMB-11, #556): o self-haste de defesa e o slow que uma ability de
   * OUTRO monstro aplicasse nele passam por aqui, o mesmo `speedScale` que `CharacterRuntime`
   * já tinha. `speed` continua sendo a base da tabela — `movement.ts` multiplica os dois.
   */
  get speedScale(): number {
    return this.conditions.speedScale();
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
      ...(this.scheduledDefenses.size === 0
        ? {}
        : { scheduledDefenses: [...this.scheduledDefenses] }),
      ...(this.masterId === null ? {} : { masterId: this.masterId }),
      ...(this.scheduledSummons.size === 0
        ? {}
        : { scheduledSummons: [...this.scheduledSummons] }),
      ...(this.conditions.size === 0 ? {} : { conditions: this.conditions.getState() }),
      ...(isFullBlockCharge(this.blockCharge) ? {} : { blockCharge: this.blockCharge }),
    };
  }

  receiveDamage(amount: number): number {
    const applied = Math.min(amount, this.health);
    this.health = Math.max(0, this.health - applied);
    return applied;
  }

  /**
   * Cura o próprio monstro (#518, a defesa): repõe até `max`, nunca passa. Devolve o que REPÔS
   * de fato — de vida cheia, zero —, o mesmo contrato de `CharacterRuntime.heal`.
   */
  heal(max: number, amount: number): number {
    const before = this.health;
    this.health = Math.min(max, this.health + amount);
    return this.health - before;
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
  rng: Rng,
): string | null {
  const current = monster.targetId === null
    ? undefined
    : prey.find((p) => p.id === monster.targetId);

  if (current !== undefined && current.alive && sameFloor(monster.position.z, current.position.z)) {
    const leash = definition.leashRadius;
    // Zero significa "nunca desiste": um monstro que larga o alvo no meio de uma hunt AFK
    // faria o jogador voltar e encontrar tudo parado sem explicação.
    if (leash === 0 || distance(monster.home, current.position) <= leash) return current.id;
  }

  const strategy = definition.targetStrategy;
  if (strategy === undefined) {
    // Sem estratégia (#541): só o mais perto, no MESMO passo único de sempre — zero sorteio,
    // zero alocação nova. É o que preserva a sequência de RNG do rato e do rotworm bit a bit;
    // a estratégia ponderada só entra quando o CONTEÚDO a declara.
    let closest: Prey | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of prey) {
      if (!candidate.alive) continue;
      // Andar diferente é tela diferente (#519): o monstro de z10 não persegue quem está em
      // z11, mesmo que o (x, y) coincida — os três andares da Darashia Dragon Lair
      // compartilham a mesma caixa. Sem isto o Dragon Lord do meio agrediria o Dragon de cima
      // através do chão.
      if (!sameFloor(monster.position.z, candidate.position.z)) continue;
      const d = distance(monster.position, candidate.position);
      if (d > definition.aggroRadius || d >= closestDistance) continue;
      closest = candidate;
      closestDistance = d;
    }
    return closest?.id ?? null;
  }

  // Estratégia ponderada (#541): monta os candidatos válidos (vivo, mesmo andar, dentro do
  // raio de agressão) e deixa `rankTarget` sortear o critério — mais perto, menos vida, mais
  // dano causado nele, ou aleatório.
  const candidates: TargetRankCandidate[] = [];
  for (const candidate of prey) {
    if (!candidate.alive) continue;
    if (!sameFloor(monster.position.z, candidate.position.z)) continue;
    const d = distance(monster.position, candidate.position);
    if (d > definition.aggroRadius) continue;
    candidates.push({
      id: candidate.id, distance: d, health: candidate.health,
      damage: monster.contribution.damageBy(candidate.id),
    });
  }
  return candidates.length === 0 ? null : rankTarget(strategy, candidates, rng);
}

/**
 * O monstro está fugindo (#518, TFS `Monster::isFleeing`, referência §15-19): HP no ou abaixo
 * de `runOnHealth`. Ausente o campo, nunca foge — o comportamento de sempre.
 *
 * Pura e recalculada a cada decisão — não é estado guardado, como o `attackReady` é: fugir é
 * uma FUNÇÃO do HP atual, e o HP já é o estado. Guardar um segundo booleano derivado dele
 * divergiria na primeira cura que não passasse por aqui.
 */
export function isMonsterFleeing(monster: MonsterRuntime, definition: Monster): boolean {
  return definition.runOnHealth !== undefined
    && monster.alive
    && monster.health <= definition.runOnHealth;
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

  // Fugindo (#518): o movimento é SEMPRE afastar, nunca aproximar — mesmo com o alvo já fora
  // do alcance de ability nenhuma. O corpo a corpo é recusado à parte, em `#armMonsterAbilities`
  // e nos vencimentos de ataque; as abilities à distância continuam armando normalmente, porque
  // passo e ataque são decisões independentes (a mesma separação do TFS entre movimento e
  // `doAttacking`).
  if (isMonsterFleeing(monster, definition)) {
    const away = fleeStep(monster.position, target.position, blocked);
    // Encurralado: fica — recuar até a parede e parar lá é o comportamento certo (ADR 0009),
    // não um caso a consertar.
    return away === null ? { kind: 'idle' } : { kind: 'step', to: away };
  }

  // Manter distância (#542, TFS/Canary `Monster::getDistanceStep`): um atirador com
  // `targetDistance > 1` recua um passo quando o alvo entra mais perto do que isso —
  // independente da fuga por vida baixa acima, que já tratou o caso "sempre foge". Precisa do
  // MESMO andar: um alvo em outro piso nunca é "perto demais". Sem passo livre (parede atrás),
  // cai para a checagem de alcance abaixo — ataca parado em vez de ficar preso tentando um
  // recuo impossível. O Canary só entra neste ramo com linha de visão livre
  // (`isSightClear`); o sim ainda não modela isso (M30-06) — pendência registrada em
  // `docs/product/combat.md`.
  if (
    definition.targetDistance > 1
    && sameFloor(monster.position.z, target.position.z)
    && distance(monster.position, target.position) < definition.targetDistance
  ) {
    const away = fleeStep(monster.position, target.position, blocked);
    if (away !== null) return { kind: 'retreat', to: away };
  }

  // O alcance de parada é o MAIOR entre as abilities (CMB-06) — EXCETO quando o monstro declara
  // `targetDistance > 1` (#542, revisão do #649): aí a APROXIMAÇÃO também para em
  // `targetDistance`, e não no maior alcance de ability. É a outra metade de
  // `Monster::getPathSearchParams` (`monster.cpp:3830`, `fpp.maxTargetDist = targetDistance`) —
  // o recuo acima já cobria a metade "chegou perto demais", mas a aproximação continuava usando
  // `monsterAttackRange` sozinha, então um atirador cuja ability alcança mais longe que o
  // stand-off preferido (a norma no bestiário real: Necromancer `targetDistance` 4 com
  // abilities de alcance 1/1/7; Priestess `targetDistance` 4 com abilities de alcance 7) parava
  // e atirava assim que entrava no alcance da ability, sem nunca fechar até o `targetDistance`
  // documentado. Sem `targetDistance` declarado (> 1), o alcance de parada continua sendo o
  // maior alcance de ability, como sempre — um monstro de ability à distância 4 para a 4 tiles
  // e atira, em vez de colar no alvo como um corpo a corpo.
  const approachStopRange = definition.targetDistance > 1
    ? definition.targetDistance
    : monsterAttackRange(definition);
  if (distance(monster.position, target.position) <= approachStopRange) {
    return { kind: 'attack', targetId: target.id };
  }

  const to = greedyStep(monster.position, target.position, blocked);
  // Empacou numa concavidade: o guloso não contorna, e é assim mesmo (ADR 0009). O passo
  // perdido não vira dívida — parado é parado, e o próximo vencimento tenta de novo.
  return to === null ? { kind: 'idle' } : { kind: 'step', to };
}
