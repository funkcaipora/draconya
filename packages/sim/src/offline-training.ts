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
// **Registro `jsonb` por sistema** (ADR 0052 d.1): `{ offlineBankMs, offlineSkill, version }`, lido
// inteiro no ticket, mutado só pela sessão dona (`CharacterRuntime.training`) e escrito inteiro
// pela transação do ledger — última escrita vence, como `charms`/`ammo`. `offlineSkill` é a
// escolha do livro (`set-offline-training-skill`, um serviço de Cidade); a `api` a consome e a
// zera, como o Canary faz no login (`setOfflineTrainingSkill(SKILL_NONE)`).

import type { Progression, Skill, Training, Vocation } from '@draconya/content';
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
  return {
    offlineBankMs: Math.floor(bank),
    offlineSkill: typeof skill === 'string' ? skill : null,
    version: OFFLINE_TRAINING_STATE_VERSION,
  };
}

export type ChooseOfflineSkillRefusal = 'unknown-skill';

export type ChooseOfflineSkillResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ChooseOfflineSkillRefusal };

export class OfflineTraining {
  #bankMs: number;
  #skill: string | null;

  private constructor(state: OfflineTrainingState) {
    this.#bankMs = state.offlineBankMs;
    this.#skill = state.offlineSkill;
  }

  static fromState(state?: OfflineTrainingState): OfflineTraining {
    return new OfflineTraining(readOfflineTrainingState(state) ?? emptyOfflineTrainingState());
  }

  /** Uma CÓPIA — quem guarda para um snapshot não vê a ação seguinte aparecer nele. */
  getState(): OfflineTrainingState {
    return {
      offlineBankMs: this.#bankMs, offlineSkill: this.#skill, version: OFFLINE_TRAINING_STATE_VERSION,
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

/** O percentual inteiro rumo ao próximo nível — o `getPercentLevel` do Canary, sem o teto de HUD. */
function percentOf(skills: Skills, definition: Skill, factor: number): number {
  const needed = pointsForLevel(definition, skills.levelOf(definition), factor);
  return needed > 0 ? Math.floor((skills.pointsOf(definition) * 100) / needed) : 0;
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
 * devolve se a skill avançou de nível ou de percentual (o `sendUpdate` que o Lua lê).
 */
function creditTries(
  skills: Skills, definition: Skill, exactTries: number, vocation: Vocation | null,
  rules: OfflineTrainingRules,
): { readonly tries: number; readonly changed: boolean } {
  const truncated = Math.floor(exactTries);
  if (truncated <= 0) return { tries: 0, changed: false };
  const factor = skillFactorFor(definition, vocation, rules.progression);
  const rate = skillRateFor(rules.progression.rates, definition.id, skills.levelOf(definition));
  const tries = rate === 1 ? truncated : Math.floor(truncated * rate);
  if (tries <= 0) return { tries: 0, changed: false };
  const levelBefore = skills.levelOf(definition);
  const percentBefore = percentOf(skills, definition, factor);
  skills.gain(definition, tries, factor);
  const changed = skills.levelOf(definition) !== levelBefore || percentOf(skills, definition, factor) !== percentBefore;
  return { tries, changed };
}
