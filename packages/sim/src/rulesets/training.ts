// Ruleset do Treino — a sessão de exercise weapon (#631, M44-13; ADR 0059 d.1).
//
// O Tibia treina num boneco em zona de proteção: o jogador usa uma exercise weapon nele, e a cada
// golpe — no intervalo de ataque base da vocação — uma CARGA some e a skill da arma ganha `7 × rate`
// tries (ou `600 × rate` de mana gasta, para wand/rod). O golpe acaba quando as cargas acabam: a
// arma some (`weapon:remove(1)`) e o treino para. Uma weapon de 500 cargas são ~17 min a 2 s; a de
// 14 400, oito horas — por isso o Treino é uma SESSÃO, e não uma conta feita na hora do uso
// (ADR 0059, alternativa descartada: "resolver em fórmula fechada pularia o tempo que o Tibia faz
// o jogador esperar e mudaria os tries por hora de forma incomparável").
//
// **Orientado a evento, sem laço** (invariantes 2 e 3): cada golpe é UM evento da fila
// (`TRAIN_STRIKE`) que se reagenda em `session.nowMs + intervalo`, então o resultado é o mesmo a
// 10 Hz, a 1 Hz e desanexado — o teste de equivalência de taxas o prende. O primeiro golpe vence no
// instante da entrada (o `addEvent(…, 0, …)` do Canary), e os seguintes a cada `attackIntervalMs`.
//
// **Estado ATIVO do personagem** (invariante 8): é uma sessão hospedada como a hunt, privada, de um
// dono só; a Cidade não simula nada (ADR 0004) e por isso o treino não roda nela. Sai por
// `leave-hunt` (o jogador), ou sozinha quando a arma acaba — nos dois casos o servidor devolve o
// personagem à Cidade pela sucessão de sempre.
//
// **A stamina não anda no Treino** (ADR 0060 d.14c, emenda ao ADR 0059 d.1): o exercise training do
// Canary é online, e o Canary só regenera stamina deslogado. O Treino não a drena — só a hunt o faz
// (`#burnStamina`) —, e quem a impede de RECUPERAR é a fronteira da transição de saída, que só avança o
// marco (`holdStamina`, `game/sessions.ts`). Sem monstro, sem suprimento consumido, sem dano, sem RNG.

import type {
  Item, Progression, Skill, Tilemap, Training, Vocation,
} from '@draconya/content';
import type { Content } from '@draconya/content';
import type { CharacterRuntime } from '../character.js';
import { Rng } from '../rng.js';
import { skillRateFor } from '../rates.js';
import { skillFactorFor } from '../skills.js';
import { TileOccupancy, place } from '../movement.js';
import { Session } from '../session.js';
import type { ScheduledEvent } from '../schedule.js';
import type { EndReason, Ruleset, SessionSnapshot } from '../session.js';

/** O evento de golpe do Treino — `subject` é o `characterId`. */
export const TRAIN_STRIKE = 'train-strike';

/** A cadência de atualização do hospedeiro (só apresentação — o resultado é o dos eventos). */
const ATTACHED_HZ = 2;
const DETACHED_HZ = 1;

export class TrainingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrainingUnavailableError';
  }
}

export interface TrainingRulesetOptions {
  readonly training: Training;
  readonly items: ReadonlyMap<string, Item>;
  readonly skills: ReadonlyMap<string, Skill>;
  readonly vocations: ReadonlyMap<string, Vocation>;
  readonly progression: Progression;
  /** `combat.player.attackIntervalMs` — o `getBaseAttackSpeed()` (2000) do Canary, igual em toda vocação. */
  readonly attackIntervalMs: number;
  /** O mapa em que o boneco está — o da Cidade (`content.city`). */
  readonly map: Tilemap;
  /** A instância da exercise weapon com que este Treino começou — identidade da sessão. */
  readonly itemInstanceId: string;
}

/** O que o snapshot guarda: a IDENTIDADE da sessão. O resto (golpe agendado) mora na fila. */
export interface TrainingRulesetState {
  readonly itemInstanceId: string;
}

/** O que a apresentação lê do Treino em curso — `null` quando a arma não está mais com ele. */
export interface TrainingStatus {
  readonly itemId: string;
  readonly skillId: string;
  /** Cargas que restam (a arma some em zero). */
  readonly charges: number;
  /** O total da definição — o que a arma tinha ao sair da loja. */
  readonly totalCharges: number;
}

export class TrainingRuleset implements Ruleset {
  readonly type = 'training' as const;
  readonly mapId: string;
  readonly #options: TrainingRulesetOptions;
  readonly #world: TileOccupancy;

  constructor(options: TrainingRulesetOptions) {
    if (options.attackIntervalMs <= 0) throw new Error('attackIntervalMs must be positive');
    this.#options = options;
    this.mapId = options.map.id;
    this.#world = new TileOccupancy(options.map);
  }

  /** Orientado a evento: o `hz` é só a frequência com que o hospedeiro AVANÇA a fila. */
  hz(attached: boolean): number {
    return attached ? ATTACHED_HZ : DETACHED_HZ;
  }

  get itemInstanceId(): string {
    return this.#options.itemInstanceId;
  }

  onEnter(session: Session, character: CharacterRuntime): void {
    // Sessão de um dono só: o boneco é dele, e o teto de sessões do nó (ADR 0001) não comporta
    // treino em grupo.
    if (session.participants.length > 1) {
      throw new TrainingUnavailableError('a sessão de Treino é de um personagem só');
    }
    const weapon = this.#weaponOf(character);
    if (weapon === null) {
      throw new TrainingUnavailableError('o personagem não tem a exercise weapon desta sessão');
    }
    const { stand } = this.#options.training.place;
    // A colocação passa pela MESMA legalidade que um passo (FUN-69): o tile do conteúdo foi
    // conferido no boot (`buildContent`), então uma recusa aqui é bug de conteúdo, e falhar alto
    // é melhor que treinar fora do mapa.
    const rejection = place(this.#world, character, { ...stand });
    if (rejection !== null) {
      throw new TrainingUnavailableError(`não há onde treinar em (${stand.x},${stand.y},${stand.z}): ${rejection}`);
    }
    session.record('training-started', `${weapon.itemId}/${weapon.charges}`);
    // O primeiro golpe vence AGORA (o `addEvent(exerciseTrainingEvent, 0, …)` do Canary); os
    // seguintes a cada intervalo base. Um evento por participante, `subject` = personagem.
    session.scheduleIn(TRAIN_STRIKE, 0, { subject: character.id });
  }

  onEvent(session: Session, event: ScheduledEvent): void {
    if (event.kind !== TRAIN_STRIKE || event.subject === undefined) return;
    this.#onStrike(session, event.subject);
  }

  onCreatureDied(): void {
    // Não há monstro nem dano no Treino (PZ, ADR 0059 d.1). Chegar aqui é bug de outro sistema.
    throw new Error('nothing dies in a training session');
  }

  onEnd(session: Session, _reason: EndReason): void {
    // O banco de offline training cresce 1:1 com o tempo de sessão de hunt OU de treino (ADR 0059
    // d.3): o `durationMs` que a sessão já conta, sem relógio à parte. Uma vez por participante,
    // aqui — `end()` é idempotente, então o crédito não dobra.
    for (const character of session.participants) {
      character.training.creditOnline(
        session.aggregatesOf(character.id).durationMs, this.#options.training.offline.bankCapMs,
      );
    }
  }

  onLeave(session: Session, character: CharacterRuntime): void {
    character.training.creditOnline(
      session.aggregatesOf(character.id).durationMs, this.#options.training.offline.bankCapMs,
    );
  }

  getState(): TrainingRulesetState {
    return { itemInstanceId: this.#options.itemInstanceId };
  }

  /** Depois de `restore`, com os participantes já reconstruídos: remonta a ocupação do tile. */
  onResume(session: Session): void {
    this.#world.reset(session.participants);
  }

  /** A leitura da apresentação: qual arma, qual skill, quantas cargas. `null` sem a arma. */
  statusOf(character: CharacterRuntime): TrainingStatus | null {
    return this.#weaponOf(character);
  }

  #weaponOf(character: CharacterRuntime): TrainingStatus | null {
    const carried = character.inventory.carried(this.#options.itemInstanceId);
    if (carried === null) return null;
    const definition = this.#options.items.get(carried.itemId);
    if (definition?.exercise === undefined || definition.charges === undefined) return null;
    return {
      itemId: carried.itemId,
      skillId: definition.exercise.skillId,
      charges: carried.overlay?.charges ?? definition.charges,
      totalCharges: definition.charges,
    };
  }

  /**
   * UM golpe: credita a skill, gasta a carga e reagenda. Na ordem do Canary
   * (`exerciseTrainingEvent`): o crédito vem ANTES do desconto, então a última carga também rende;
   * zerou, a arma some e o treino acaba.
   */
  #onStrike(session: Session, characterId: string): void {
    const character = session.participants.find((participant) => participant.id === characterId);
    if (character === undefined) return;
    const weapon = this.#weaponOf(character);
    if (weapon === null || weapon.charges <= 0) {
      // A arma saiu do inventário (vendida, descartada, arrastada) ou já estava esgotada: o Canary
      // diz "You need the training weapon in the backpack, the training has stopped".
      if (weapon !== null) this.#destroyWeapon(character);
      session.record('training-weapon-lost', this.#options.itemInstanceId);
      session.end('completed');
      return;
    }

    this.#train(session, character, weapon.skillId);

    const left = weapon.charges - 1;
    if (left <= 0) {
      this.#destroyWeapon(character);
      session.record('training-weapon-exhausted', weapon.itemId);
      session.end('completed');
      return;
    }
    const carried = character.inventory.carried(this.#options.itemInstanceId);
    if (carried !== null) {
      character.inventory.setOverlay(this.#options.itemInstanceId, { ...carried.overlay, charges: left });
    }
    session.scheduleIn(TRAIN_STRIKE, this.#options.attackIntervalMs, { subject: characterId });
  }

  /**
   * O que o golpe rende: `7 × rate` tries (`600 × rate` de mana gasta para a skill que sobe por
   * mana), truncado como o `uint64_t` do Canary, e pelo rate de skill do conteúdo — o
   * `onGainSkillTries` que TODO ganho de skill atravessa, hunt ou treino.
   */
  #train(session: Session, character: CharacterRuntime, skillId: string): void {
    const definition = this.#options.skills.get(skillId);
    if (definition === undefined) return;
    const { strike, dummy } = this.#options.training;
    const perCharge = definition.gain.on === 'spell-cast' ? strike.manaSpentPerCharge : strike.triesPerCharge;
    const points = Math.floor((perCharge * dummy.rate) / 100);
    if (points <= 0) return;
    const vocation = character.vocationId === null
      ? null : this.#options.vocations.get(character.vocationId) ?? null;
    const factor = skillFactorFor(definition, vocation, this.#options.progression);
    const rate = skillRateFor(this.#options.progression.rates, definition.id, character.skills.levelOf(definition));
    const tries = rate === 1 ? points : Math.floor(points * rate);
    if (character.skills.gain(definition, tries, factor) > 0) {
      session.record('skill-up', `${definition.id}/${character.skills.levelOf(definition)}`);
    }
  }

  /** A exercise weapon esgotada é destruída (`weapon:remove(1)`); o extrato leva o id ao ledger. */
  #destroyWeapon(character: CharacterRuntime): void {
    const removed = character.inventory.remove(this.#options.itemInstanceId);
    if (removed !== null) character.removedInstances.push(removed.instanceId);
  }
}

/**
 * Monta o ruleset de Treino do conteúdo. Lança `TrainingUnavailableError` quando o conteúdo não
 * tem o Treino ou o mapa da Cidade — recusar é a resposta certa, e o servidor a traduz em
 * "não existe uma sessão de Treino aqui" em vez de construir uma que mente sobre o que é.
 */
export function createTrainingRuleset(content: Content, itemInstanceId: string): TrainingRuleset {
  if (content.training === undefined) throw new TrainingUnavailableError('o conteúdo não tem o Treino');
  if (content.city === undefined) throw new TrainingUnavailableError('o conteúdo não tem o mapa da Cidade');
  return new TrainingRuleset({
    training: content.training,
    items: content.items,
    skills: content.skills,
    vocations: content.vocations,
    progression: content.progression,
    attackIntervalMs: content.combat.player.attackIntervalMs,
    map: content.city,
    itemInstanceId,
  });
}

export interface TrainingSessionOptions {
  readonly id: string;
  readonly content: Content;
  readonly itemInstanceId: string;
  readonly createdAtMs: number;
}

/**
 * Cria a sessão de Treino. O personagem entra depois, com `session.enter` — quem o constrói é o
 * servidor, dono do estado durável. A versão de conteúdo é congelada (invariante 7) e a semente
 * vem do id, como na hunt — embora o Treino não sorteie nada.
 */
export function createTrainingSession(options: TrainingSessionOptions): Session {
  return new Session({
    id: options.id,
    contentVersion: options.content.version,
    ruleset: createTrainingRuleset(options.content, options.itemInstanceId),
    rng: Rng.fromSeed(options.id),
    createdAtMs: options.createdAtMs,
  });
}

/**
 * Reconstrói o ruleset de um snapshot de Treino (FUN-28). A arma é IDENTIDADE da sessão, como a
 * hunt e a dificuldade são da instância de hunt. `null` quando o conteúdo perdeu o Treino — e
 * `null` é a resposta certa: quem chama credita o extrato em vez de retomar errado.
 */
export function trainingRulesetFromSnapshot(
  snapshot: SessionSnapshot, content: Content,
): TrainingRuleset | null {
  const state = snapshot.ruleset as Partial<TrainingRulesetState> | undefined;
  if (typeof state?.itemInstanceId !== 'string') return null;
  try {
    return createTrainingRuleset(content, state.itemInstanceId);
  } catch {
    return null;
  }
}
