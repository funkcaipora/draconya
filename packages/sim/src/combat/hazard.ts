// O Hazard em combate (M44-14, #632, ADR 0052 d.7): os estágios do `combat-v4` que o nível de
// perigo liga — o crítico e o reforço do monstro, a esquiva do monstro, a redução de dano, a XP e
// as rolagens extras de loot. PURO: sem sessão, sem relógio, sem escrita — quem aplica o efeito é o
// ruleset da hunt, com o `session.rng` e o relógio lógico. Só a MATEMÁTICA e a ORDEM das rolagens
// moram aqui, porque são elas o contrato do perfil (`docs/product/combat-conformance.md`).
//
// Só o mecanismo é transcrito (ADR 0019 limite 1): os números saem de `Player::
// parseAttackRecvHazardSystem`/`parseAttackDealtHazardSystem`/`addExperience`
// (`src/creatures/players/player.cpp`), de `Game::handleHazardSystemAttack`
// (`src/game/game.cpp`) e de `data/scripts/eventcallbacks/monster/ondroploot_hazard.lua` do Canary
// (`47dfd51`), e cada função cita o ponto de onde vem. Os multiplicadores (`hazard*`) são
// conteúdo — `hazard/baseline.json` —, nunca constante aqui.

import type { Hazard, HazardZone } from '@draconya/content';
import type { Rng } from '../rng.js';
import type { DamageOutcome } from './damage.js';
import { normalRandomInt } from './weapon-power.js';

/** O que o Hazard fez a um golpe de monstro num jogador. */
export interface HazardMonsterHit {
  /** O outcome a aplicar: o mesmo quando nada mudou, ou com o dano reforçado. */
  readonly outcome: DamageOutcome;
  /**
   * O golpe virou uma EXTENSÃO (`damage.extension = true`): o crítico e o reforço do Canary a
   * marcam, e é ela que faz `Game::combatChangeHealth` pular os charms defensivos
   * (`if (!damage.extension && attackerMonster && targetPlayer)`). Com o reforço de dano ligado
   * (o caso de toda zona do Canary, `damageMultiplier 200 × nível ≥ 1`) ela vale para TODO
   * golpe — os charms defensivos nunca rolam contra monstro de hazard.
   */
  readonly extension: boolean;
  /** O instante do crítico desta rolagem, ou `null` se não houve — o chamador o guarda no jogador. */
  readonly criticalAtMs: number | null;
}

/**
 * `ceil(valor × fator / 10000)`, na ordem do Canary: `std::ceil((static_cast<double>(v) × fator)
 * / 10000)` — a multiplicação em ponto flutuante ANTES da divisão, e o teto do quociente.
 */
function scaledIncrease(value: number, factor: number): number {
  return Math.ceil((value * factor) / 10_000);
}

/**
 * O Hazard num golpe de monstro de hazard que acertou o jogador — `Player::
 * parseAttackRecvHazardSystem` (`player.cpp:5513-5570`), chamado por `Game::handleHazardSystemAttack`
 * DEPOIS de `combatBlockHit` (defesa, armadura, mitigação) e ANTES dos charms defensivos e do mana
 * shield.
 *
 * `points` é o nível da party (o MENOR entre os membros, `points == 0` não faz nada), `lastCriticalAtMs`
 * o instante do último crítico DESTE jogador (`lastHazardSystemCriticalHit`; `null` é nunca).
 *
 * A ORDEM é contrato (ela decide o RNG):
 *
 *   1. UMA rolagem `normal_random(1, 10000)` por golpe elegível — consumida mesmo quando o crítico
 *      está desligado ou em espera (o Canary a sorteia antes do `if`).
 *   2. O crítico, se `zone.crit`, o intervalo passou (`lastCritical + intervalo <= agora`) e a
 *      rolagem `<= criticalChance`: soma `ceil(valor × (5000 + (nível − 1) × criticalMultiplier) /
 *      10000)` ao primário e ao secundário (o secundário zero continua zero).
 *   3. O reforço de dano, se `zone.damageBoost`, SOBRE o valor que o crítico já deixou:
 *      `ceil(valor × (nível × damageMultiplier) / 10000)` (o secundário só se não for zero).
 *
 * O golpe sem dano no primário (`value == 0`) não entra (`handleHazardSystemAttack`: `damage.
 * primary.value != 0`), e o `manadrain` tampouco — ele é `combatChangeMana` no Canary, outro ramo.
 */
export function applyHazardToMonsterHit(
  outcome: DamageOutcome, points: number, hazard: Hazard, zone: HazardZone, rng: Rng,
  nowMs: number, lastCriticalAtMs: number | null,
): HazardMonsterHit {
  if (points <= 0 || outcome.resolvedDamage === 0 || outcome.damageType === 'manadrain') {
    return { outcome, extension: false, criticalAtMs: null };
  }
  let primary = outcome.resolvedDamage;
  let secondary = outcome.secondaryOutcome?.resolvedDamage ?? 0;
  let extension = false;
  let critical = false;
  let criticalAtMs: number | null = null;

  const chance = normalRandomInt(rng, 1, 10_000);
  const criticalReady = lastCriticalAtMs === null
    || lastCriticalAtMs + hazard.criticalIntervalMs <= nowMs;
  if (zone.crit && criticalReady && chance <= hazard.criticalChance && !outcome.critical) {
    const stage = (points - 1) * hazard.criticalMultiplier;
    primary += scaledIncrease(primary, 5000 + stage);
    secondary += scaledIncrease(secondary, 5000 + stage);
    extension = true;
    critical = true;
    criticalAtMs = nowMs;
  }
  if (zone.damageBoost) {
    const stage = points * hazard.damageMultiplier;
    if (stage !== 0) {
      extension = true;
      primary += scaledIncrease(primary, stage);
      if (secondary !== 0) secondary += scaledIncrease(secondary, stage);
    }
  }
  if (!extension) return { outcome, extension: false, criticalAtMs: null };
  return {
    outcome: withDamage(outcome, primary, secondary, critical), extension, criticalAtMs,
  };
}

/**
 * O resultado do Hazard num golpe do jogador contra um monstro de hazard: a esquiva (o golpe
 * some) ou o dano reduzido pela defesa da zona — `Player::parseAttackDealtHazardSystem`
 * (`player.cpp:5572-5625`), DEPOIS de `combatBlockHit` e ANTES de o dano sair da vida do monstro.
 */
export interface HazardPlayerHit {
  readonly outcome: DamageOutcome;
  /** O monstro esquivou (`damage.hazardDodge`): o golpe inteiro é negado. */
  readonly dodged: boolean;
}

/**
 * A ordem (contrato): (1) a esquiva, se `zone.dodge` — UMA rolagem `normal_random(1, 10000)`,
 * esquiva quando `<= nível × dodgeMultiplier`; (2) a defesa, se `zone.defenseBoost` e `nível ×
 * defenseMultiplier != 0`, tira `ceil(valor × estágio / 10000)` do primário e, se não for zero,
 * do secundário (o `defenseMultiplier` do Canary é zero: o mecanismo está aqui, inerte, como lá).
 */
export function applyHazardToPlayerHit(
  outcome: DamageOutcome, points: number, hazard: Hazard, zone: HazardZone, rng: Rng,
): HazardPlayerHit {
  if (points <= 0 || outcome.resolvedDamage === 0 || outcome.damageType === 'manadrain') {
    return { outcome, dodged: false };
  }
  if (zone.dodge) {
    const chance = normalRandomInt(rng, 1, 10_000);
    if (chance <= points * hazard.dodgeMultiplier) {
      return { outcome: negateDamage(outcome), dodged: true };
    }
  }
  if (zone.defenseBoost) {
    const stage = points * hazard.defenseMultiplier;
    if (stage !== 0) {
      const primary = outcome.resolvedDamage - scaledIncrease(outcome.resolvedDamage, stage);
      const secondaryBefore = outcome.secondaryOutcome?.resolvedDamage ?? 0;
      const secondary = secondaryBefore === 0
        ? 0 : secondaryBefore - scaledIncrease(secondaryBefore, stage);
      return { outcome: withDamage(outcome, primary, secondary, outcome.critical), dodged: false };
    }
  }
  return { outcome, dodged: false };
}

/** O outcome com o primário e o secundário trocados — o resto (bloqueio, reflexo, cura) intacto. */
function withDamage(
  outcome: DamageOutcome, primary: number, secondary: number, critical: boolean,
): DamageOutcome {
  return {
    ...outcome,
    resolvedDamage: primary,
    critical,
    ...(outcome.secondaryOutcome === undefined
      ? {} : { secondaryOutcome: { ...outcome.secondaryOutcome, resolvedDamage: secondary } }),
  };
}

function negateDamage(outcome: DamageOutcome): DamageOutcome {
  return withDamage(outcome, 0, 0, false);
}

/**
 * A XP com o bônus de Hazard — `Player::addExperience` (`player.cpp:3641-3646`): `exp += (exp ×
 * (1,75 × nível × hazardExpBonusMultiplier)) / 100`, em ponto flutuante e TRUNCADO ao inteiro
 * (`exp` é `uint64_t`, e `+=` com um `double` converte o resultado de volta). Aplicado DEPOIS do
 * bônus de level/Bestiário/rate (o `onGainExperience` do Lua) e ANTES do Animus Mastery, que está
 * fora do corte de versão.
 */
export function hazardExperience(experience: number, points: number, hazard: Hazard): number {
  if (points <= 0) return experience;
  return Math.floor(experience + (experience * (1.75 * points * hazard.expBonusMultiplier)) / 100);
}

/**
 * Quantas rolagens EXTRAS de loot o Hazard dá — `ondroploot_hazard.lua`: `chance = 2 × nível ×
 * hazardLootBonusMultiplier`, `rolls = chance / 100`, e a parte fracionária decide o arredondamento
 * por UMA rolagem `math.random(0, 100) < (rolls % 1) × 100` (teto se passa, piso se não). Com o
 * teto de 12 níveis do Canary `rolls` fica em `[0,04; 0,48]`: zero ou uma rolagem extra.
 *
 * A rolagem de arredondamento é SEMPRE consumida (o `if` do Lua a avalia mesmo sem fração).
 */
export function hazardLootRolls(rng: Rng, points: number, hazard: Hazard): number {
  if (points <= 0) return 0;
  const rolls = (2 * points * hazard.lootBonusMultiplier) / 100;
  const roll = rng.integer(0, 100);
  return roll < (rolls % 1) * 100 ? Math.ceil(rolls) : Math.floor(rolls);
}
