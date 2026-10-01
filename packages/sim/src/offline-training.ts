// O offline training do Tibia (#631, M44-13; ADR 0059 d.3-d.4): um BANCO de tempo que cresce
// enquanto o personagem está numa hunt ou num treino, e que a `api` GASTA na emissão do ticket,
// convertendo o tempo fora em tries de skill com as fórmulas de `offline_training.lua` do Canary.
//
// **`sim` não lê relógio.** Nada aqui sabe que horas são: o banco só cresce por `durationMs` de
// sessão (um número que o `sim` já conta, evento na fila — nunca por tick, invariante 2), e o gasto
// recebe o tempo fora JÁ CALCULADO (`awayMs`) por quem sabe a hora — a `api`, com o personagem em
// repouso (ADR 0052 d.5), o mesmo momento e a mesma razão da recuperação de stamina. A função de
// gasto é PURA: mesma entrada, mesma saída, sem sorteio.
//
// **Registro `jsonb` por sistema** (ADR 0052 d.1): `{ offlineBankMs, offlineSkill, version }` (mais o
// carimbo `exerciseExhaustedUntilMs` do cooldown entre dois Treinos, opcional), lido
// inteiro no ticket, mutado só pela sessão dona (`CharacterRuntime.training`) e escrito inteiro
// pela transação do ledger — última escrita vence, como `charms`/`ammo`. `offlineSkill` é a
// escolha do livro (`set-offline-training-skill`, um serviço de Cidade); a `api` a consome e a
// zera, como o Canary faz no login (`setOfflineTrainingSkill(SKILL_NONE)`).

import type { Content, Progression, Skill, Training, Vocation } from '@draconya/content';
import { skillRateFor } from './rates.js';
import { Skills, pointsForLevel, skillFactorFor } from './skills.js';
import type { SkillsState } from './skills.js';

/** Versão do registro (ADR 0052 d.1, como `botConfig.version`) — migra sem coluna nova. */
export const OFFLINE_TRAINING_STATE_VERSION = 1;

export interface OfflineTrainingState {
  /** O tempo de treino disponível, em ms — do 0 ao teto do banco (`training.offline.bankCapMs`). */
  readonly offlineBankMs: number;
  /** A skill escolhida no livro, ou `null` (nenhuma). Consumida na próxima emissão de ticket. */
  readonly offlineSkill: string | null;
  readonly version: number;
  /**
   * O `training-exhaustion` do Canary (`exercise_training_weapons.lua`): o instante de RELÓGIO (epoch,
   * ms) até o qual um novo Treino é recusado — o carimbo de parede do ADR 0052 d.6, gravado quando um
   * Treino começa. Ausente é "livre" (personagem anterior a esta chave, ou que nunca treinou); campo
   * ADITIVO do registro, então não há migração (ADR 0014): a leitura o descarta se vier torto.
   */
  readonly exerciseExhaustedUntilMs?: number;
}

export function emptyOfflineTrainingState(): OfflineTrainingState {
  return { offlineBankMs: 0, offlineSkill: null, version: OFFLINE_TRAINING_STATE_VERSION };
}

/**
 * Lê um registro GRAVADO (a coluna `jsonb`, um ticket, um snapshot) — ou `undefined` quando ele não
 * é um registro. A coluna não tem CHECK, então a leitura é defensiva, na régua do Bestiário: campo
 * torto vira "ausente" em vez de trancar o login (ADR 0014 — nunca descartar dado às cegas, mas
 * nunca deixar lixo virar `NaN` dentro do motor).
 */
export function readOfflineTrainingState(stored: unknown): OfflineTrainingState | undefined {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return undefined;
  const value = stored as Record<string, unknown>;
  const bank = value['offlineBankMs'];
  if (typeof bank !== 'number' || !Number.isFinite(bank) || bank < 0) return undefined;
  const skill = value['offlineSkill'];
  if (skill !== null && skill !== undefined && (typeof skill !== 'string' || skill.length === 0)) return undefined;
  // O carimbo do cooldown é um campo à parte: torto vira "livre", sem derrubar o banco que está certo.
  const exhaustedUntil = value['exerciseExhaustedUntilMs'];
  const stamp = typeof exhaustedUntil === 'number' && Number.isFinite(exhaustedUntil) && exhaustedUntil > 0
    ? { exerciseExhaustedUntilMs: Math.floor(exhaustedUntil) } : {};
  return {
    offlineBankMs: Math.floor(bank),
    offlineSkill: typeof skill === 'string' ? skill : null,
    version: OFFLINE_TRAINING_STATE_VERSION,
    ...stamp,
  };
}

export type ChooseOfflineSkillRefusal = 'unknown-skill';

export type ChooseOfflineSkillResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ChooseOfflineSkillRefusal };

export class OfflineTraining {
  #bankMs: number;
  #skill: string | null;
  /** O fim do `training-exhaustion`, em epoch ms; `0` é livre. Ver `OfflineTrainingState`. */
  #exhaustedUntilMs: number;

  private constructor(state: OfflineTrainingState) {
    this.#bankMs = state.offlineBankMs;
    this.#skill = state.offlineSkill;
    this.#exhaustedUntilMs = state.exerciseExhaustedUntilMs ?? 0;
  }

  static fromState(state?: OfflineTrainingState): OfflineTraining {
    return new OfflineTraining(readOfflineTrainingState(state) ?? emptyOfflineTrainingState());
  }

  /** Uma CÓPIA — quem guarda para um snapshot não vê a ação seguinte aparecer nele. */
  getState(): OfflineTrainingState {
    return {
      offlineBankMs: this.#bankMs, offlineSkill: this.#skill, version: OFFLINE_TRAINING_STATE_VERSION,
      // Só quando há carimbo: o estado de quem nunca treinou continua o `emptyOfflineTrainingState()`.
      ...(this.#exhaustedUntilMs > 0 ? { exerciseExhaustedUntilMs: this.#exhaustedUntilMs } : {}),
    };
  }

  get bankMs(): number {
    return this.#bankMs;
  }

  get skill(): string | null {
    return this.#skill;
  }

  /**
   * O banco cresce 1:1 com o tempo de sessão de hunt ou de treino (ADR 0059 d.3, o "online" do ADR
   * 0052 d.6), até o teto — `Player::addOfflineTrainingTime` do Canary. Quem chama é o ruleset,
   * uma vez por participante, no fim da participação dele (`onEnd`/`onLeave`): o tempo é contado
   * do agregado que a sessão já mantém, não por um relógio à parte.
   */
  creditOnline(onlineMs: number, capMs: number): void {
    if (!(onlineMs > 0)) return;
    this.#bankMs = Math.min(capMs, this.#bankMs + Math.floor(onlineMs));
  }

  /**
   * Quanto falta, em ms, para um novo Treino poder começar — o `hasExhaustion("training-exhaustion")`
   * do Canary, comparado com o relógio de parede que o SERVIDOR passa (`nowMs`: o `sim` não lê
   * relógio, invariante 1; ADR 0052 d.6). `0` é livre. Limitado por `cooldownMs`: o carimbo é gravado
   * como `agora + cooldownMs`, então nada legítimo passa disso, e um relógio que andou para trás (ou
   * um registro adulterado) não trancaria o Treino por mais que a própria espera.
   */
  exerciseCooldownLeftMs(nowMs: number, cooldownMs: number): number {
    return Math.min(cooldownMs, Math.max(0, this.#exhaustedUntilMs - nowMs));
  }

  /**
   * Um Treino começou em `nowMs`: carimba o fim da espera (`player:setExhaustion("training-exhaustion",
   * 10)`). Quem chama já conferiu `exerciseCooldownLeftMs` — o Canary só chega aqui depois de
   * `hasExhaustion` ser falso.
   */
  beginExerciseCooldown(nowMs: number, cooldownMs: number): void {
    this.#exhaustedUntilMs = cooldownMs > 0 ? Math.floor(nowMs) + cooldownMs : 0;
  }

  /**
   * O livro do offline training (`skill_trainer.lua`): a skill que a `api` vai treinar quando o
   * personagem voltar. `null` desmarca. Só as skills que o conteúdo oferece — o resto é recusa
   * (o cliente manda INTENÇÃO, invariante 4).
   */
  choose(skillId: string | null, rules: Training): ChooseOfflineSkillResult {
    if (skillId !== null && !rules.offline.skills.some((entry) => entry.skillId === skillId)) {
      return { ok: false, reason: 'unknown-skill' };
    }
    this.#skill = skillId;
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------------------------
// O gasto do banco — a fórmula de `offline_training.lua`, na emissão do ticket.

/** O que o gasto precisa de CONTEÚDO — o `sim` não conhece o `Content` inteiro. */
export interface OfflineTrainingRules {
  readonly training: Training;
  readonly skills: ReadonlyMap<string, Skill>;
  readonly vocations: ReadonlyMap<string, Vocation>;
  readonly progression: Progression;
  /** `combat.player.attackIntervalMs` — o `Vocation::getBaseAttackSpeed()` (2000) do Canary. */
  readonly attackIntervalMs: number;
  /** `combat.defense.skillId` — a skill do escudo, que treina junto (`SKILL_SHIELD`). */
  readonly shieldSkillId: string;
}

/** A skill do escudo, que o offline training de melee/distância treina junto (`SKILL_SHIELD`). */
export const SHIELDING_SKILL_ID = 'shielding';

/**
 * As regras do gasto, montadas do conteúdo fixado (invariante 7) — ou `null` quando o conteúdo não
 * tem o Treino (o conteúdo de teste sem `training/`): não há o que gastar, e quem chama trata como
 * "nenhum banco é gasto", nunca como erro. É o que a `api` recebe no boot; o `sim` não conhece o
 * `Content` inteiro por dentro de `settleOfflineTraining`, só isto.
 */
export function offlineTrainingRulesOf(content: Content): OfflineTrainingRules | null {
  if (content.training === undefined) return null;
  return {
    training: content.training,
    skills: content.skills,
    vocations: content.vocations,
    progression: content.progression,
    attackIntervalMs: content.combat.player.attackIntervalMs,
    shieldSkillId: SHIELDING_SKILL_ID,
  };
}

export interface OfflineTrainingInput {
  /** O registro do personagem; ausente é `emptyOfflineTrainingState()`. */
  readonly training: OfflineTrainingState | undefined;
  /** As skills do personagem, como estão na linha. */
  readonly skills: SkillsState | undefined;
  /**
   * Quanto tempo o personagem esteve FORA, em ms: `agora − fim da última sessão` (ADR 0059 d.3;
   * a Cidade conta como fora). Calculado por quem sabe a hora; negativo (relógio para trás) vale 0.
   */
  readonly awayMs: number;
  /** Premium decide o teto de gasto por conta (ADR 0059 d.4). */
  readonly premium: boolean;
  readonly vocationId: string | null;
}

export interface OfflineTrainingSettlement {
  /** O tempo efetivamente treinado (ms), já truncado em segundos inteiros. */
  readonly trainedMs: number;
  /** A skill principal e os tries que ela recebeu. */
  readonly skillId: string;
  readonly tries: number;
  /** Os tries que o escudo recebeu junto (0 quando o principal não avançou). */
  readonly shieldingTries: number;
}

export interface OfflineTrainingResult {
  readonly training: OfflineTrainingState;
  readonly skills: SkillsState;
  /** `null` quando nada foi treinado (sem skill escolhida, carência, banco vazio, < 60 s). */
  readonly settlement: OfflineTrainingSettlement | null;
}

/** Menos que isto o Canary devolve sem treinar (`if trainingTime < 60 then return true`). */
const MIN_TRAINED_SECONDS = 60;

/**
 * O `Player::getPercentLevel` do Canary: `round(count × 100 / next × 100) / 100` — o percentual com
 * DUAS casas decimais, e 0 se passar de 100. É assim que o login o carrega (`skills[i].percent`,
 * `iologindata_load_player.cpp`), e `Skill.percent` é um `double`.
 */
function percentWithDecimals(points: number, needed: number): number {
  if (needed <= 0) return 0;
  const result = Math.round(((points * 100) / needed) * 100) / 100;
  return result > 100 ? 0 : result;
}

/**
 * Os pontos que custa sair de `level`, e o que custava chegar nele — o `nextReqTries` e o
 * `currReqTries` de `addOfflineTrainingTries`. Abaixo do nível inicial (e nele) o Canary devolve 0
 * (`level <= minSkillLevel`).
 */
function requirementsAt(definition: Skill, level: number, factor: number): { curr: number; next: number } {
  return {
    curr: level <= definition.startingLevel ? 0 : pointsForLevel(definition, level - 1, factor),
    next: pointsForLevel(definition, level, factor),
  };
}

/**
 * Gasta o banco, na ordem exata de `offline_training.lua` (o login do Canary):
 *
 *  1. sem skill escolhida, nada acontece;
 *  2. a escolha é CONSUMIDA (`setOfflineTrainingSkill(SKILL_NONE)`) — qualquer que seja o desfecho;
 *  3. "fora" menos que a carência (600 s) não treina, e não gasta o banco;
 *  4. `treino = min(fora, banco, teto)` — o teto é o da CONTA (ADR 0059 d.4: Free 6 h, Premium 12 h,
 *     a forma do PRD; no Canary é só o teto do banco, 12 h) —, em segundos inteiros;
 *  5. o banco desce o que foi treinado, MESMO que seja pouco demais para render (o Canary tira
 *     antes de conferir os 60 s);
 *  6. menos que 60 s não rende nada;
 *  7. tries: melee `(s / ataqueBase) / 2`, distância `/ 4`, magic level `s × manaGain / manaTicks`
 *     (o `manaGain` da vocação do personagem, os ticks da vocação PROMOVIDA — `topVocation` do Lua,
 *     que é sempre a forma promovida), truncados como o `uint64_t` do Canary;
 *  8. o escudo treina junto (`s / 4`) — só se a skill principal avançou de nível OU mudou de
 *     percentual (o `return sendUpdate` de `addOfflineTrainingTries`).
 *
 * Cada crédito passa pelo rate de skill do conteúdo (`skillRateFor`, o `onGainSkillTries` do
 * Canary), exatamente como o golpe da hunt. O que o Draconya NÃO copia do login do Canary é a
 * volta do tempo "não treinado" ao banco (o `remainder`) e o reabastecimento enquanto se está
 * deslogado sem skill escolhida: o ADR 0059 d.3 faz o banco crescer só por tempo de hunt/treino.
 */
export function settleOfflineTraining(
  input: OfflineTrainingInput, rules: OfflineTrainingRules,
): OfflineTrainingResult {
  const current = input.training ?? emptyOfflineTrainingState();
  const unchanged: OfflineTrainingResult = {
    training: current, skills: input.skills ?? {}, settlement: null,
  };
  if (current.offlineSkill === null) return unchanged;

  const consumed: OfflineTrainingState = { ...current, offlineSkill: null };
  const offline = rules.training.offline;
  const away = Math.min(Math.max(0, input.awayMs), offline.maxAwayMs);
  if (away < offline.graceMs) return { training: consumed, skills: unchanged.skills, settlement: null };

  const entry = offline.skills.find((candidate) => candidate.skillId === current.offlineSkill);
  const definition = rules.skills.get(current.offlineSkill);
  // A skill que o livro oferecia saiu do conteúdo: a escolha é consumida e nada rende — o banco fica.
  if (entry === undefined || definition === undefined) {
    return { training: consumed, skills: unchanged.skills, settlement: null };
  }

  const capMs = input.premium ? offline.spendCapMs.premium : offline.spendCapMs.free;
  const seconds = Math.floor(Math.max(0, Math.min(away, current.offlineBankMs, capMs)) / 1000);
  const training: OfflineTrainingState = {
    ...consumed, offlineBankMs: Math.max(0, current.offlineBankMs - seconds * 1000),
  };
  if (seconds < MIN_TRAINED_SECONDS) return { training, skills: unchanged.skills, settlement: null };

  const vocation = input.vocationId === null ? null : rules.vocations.get(input.vocationId) ?? null;
  let exactTries: number;
  if (entry.kind === 'attacks') {
    exactTries = (seconds / (rules.attackIntervalMs / 1000)) / entry.divisor;
  } else {
    const regen = (vocation?.regen ?? rules.progression.regen).mana;
    // `topVocation` do Lua: a forma promovida da vocação, ou ela mesma quando não há promoção.
    const ticksMs = (vocation?.promotion?.regen ?? vocation?.regen ?? rules.progression.regen).mana.ticksMs;
    const gainTicks = ticksMs / 1000 === 0 ? 1 : ticksMs / 1000;
    exactTries = seconds * (regen.amount / gainTicks);
  }

  const skills = Skills.fromState(input.skills);
  const credited = creditTries(skills, definition, exactTries, vocation, rules);
  let shieldingTries = 0;
  if (credited.changed) {
    const shield = rules.skills.get(rules.shieldSkillId);
    if (shield !== undefined) {
      shieldingTries = creditTries(
        skills, shield, seconds / offline.shieldingDivisor, vocation, rules,
      ).tries;
    }
  }
  return {
    training,
    skills: skills.getState(),
    settlement: { trainedMs: seconds * 1000, skillId: definition.id, tries: credited.tries, shieldingTries },
  };
}

/**
 * Credita tries a UMA skill: trunca (o `uint64_t` do Canary), aplica o rate de skill do conteúdo e
 * devolve o que o `return sendUpdate` de `Player::addOfflineTrainingTries` devolveria, que o Lua
 * (`offline_training.lua`) lê para treinar o escudo junto.
 *
 * **O `sendUpdate` do Canary NÃO é "o percentual inteiro mudou".** `Skill.percent` é um `double`
 * (2 casas decimais, carregado pelo login), e o percentual NOVO é truncado para `uint8_t`
 * (`newPercent`); a comparação `percent != newPercent` é double contra inteiro. Só é falsa quando o
 * percentual guardado JÁ era um inteiro exato (0 de um nível recém-aberto, por exemplo) igual ao
 * novo — um personagem com 45,67% e 45,96% depois compara 45,67 contra 45 e treina o escudo. O
 * `floor` dos dois lados, que esta função fazia antes, não bate com o Canary nem com o TFS (que
 * compara pontos-base de percentual).
 *
 * Skill sem teto de crescimento (`currReq >= nextReq`) devolve falso sem treinar, como o Canary.
 */
function creditTries(
  skills: Skills, definition: Skill, exactTries: number, vocation: Vocation | null,
  rules: OfflineTrainingRules,
): { readonly tries: number; readonly changed: boolean } {
  const truncated = Math.floor(exactTries);
  if (truncated <= 0) return { tries: 0, changed: false };
  const factor = skillFactorFor(definition, vocation, rules.progression);
  const levelBefore = skills.levelOf(definition);
  const before = requirementsAt(definition, levelBefore, factor);
  if (before.curr >= before.next) return { tries: 0, changed: false };
  const rate = skillRateFor(rules.progression.rates, definition.id, levelBefore);
  const tries = rate === 1 ? truncated : Math.floor(truncated * rate);
  if (tries <= 0) return { tries: 0, changed: false };
  const percentBefore = percentWithDecimals(skills.pointsOf(definition), before.next);
  skills.gain(definition, tries, factor);
  const levelAfter = skills.levelOf(definition);
  const after = requirementsAt(definition, levelAfter, factor);
  // `newPercent` do Canary: `uint8_t`, então a parte inteira; 0 quando a skill parou de crescer.
  const percentAfter = after.next > after.curr
    ? Math.trunc(percentWithDecimals(skills.pointsOf(definition), after.next)) : 0;
  return { tries, changed: levelAfter !== levelBefore || percentBefore !== percentAfter };
}
