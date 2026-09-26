// O estágio de recebimento do `combat-v3` (#548, M30-01; ADR 0040): a ORDEM e a MATEMÁTICA do
// `Creature::blockHit` do Canary (`src/creatures/creature.cpp:944-1001`) — imunidade explícita,
// defesa/escudo com `blockCount`, armadura em FAIXA aleatória e mitigação percentual. Substitui
// o bloqueio binário do CMB-04 (`combat/defense.ts`, que continua intocado e serve `combat-v1`/
// `combat-v2`).
//
// Fórmula ORIGINAL em TypeScript a partir do MECANISMO descrito pelo Canary — nunca código
// copiado, traduzido ou adaptado linha a linha (ADR 0019). Só o `blockCount` (`block-charge.ts`)
// já é uma reescrita original do relógio-por-tick do Canary, pela mesma razão.
//
// Absorção/aumento por tipo (`applyAbsorbDamageModifications`, o PRIMEIRO estágio do Canary)
// fica de fora — é o M30-05 (ADR 0040). A resistência/vulnerabilidade por tipo (`mitigation.
// resistances`, CMB-03) continua um estágio À PARTE em `damage.ts`, depois deste — ela já existia
// antes do #548 e não é tocada aqui.

import type { DamageType } from '@draconya/content';
import type { Rng } from '../rng.js';
import { consumeBlockCharge } from './block-charge.js';
import type { BlockChargeState } from './block-charge.js';

/**
 * Se um golpe pode ser bloqueado por defesa (escudo) e por armadura (`checkDefense`/
 * `checkArmor` do Canary) — depende da ORIGEM do dano, não do tipo: corpo a corpo bloqueia os
 * dois, distância só armadura, magia e wand nenhum dos dois (o default de `CombatParams` sem
 * `BLOCKARMOR`/`BLOCKSHIELD` declarado — `combat/damage.ts` deriva isto por chamador).
 */
export interface BlockFlags {
  readonly armor: boolean;
  readonly shield: boolean;
}

/** O físico corpo a corpo: bloqueia os dois. É o produtor mais comum, e o default de `damage.ts`. */
export const MELEE_BLOCK_FLAGS: BlockFlags = { armor: true, shield: true };
/** Distância (bow/crossbow): só armadura — `WeaponDistance` não seta `blockedByShield`. */
export const DISTANCE_BLOCK_FLAGS: BlockFlags = { armor: true, shield: false };
/** Magia, runa e wand/rod: nenhum dos dois — o default de `CombatParams` sem params declarados. */
export const MAGIC_BLOCK_FLAGS: BlockFlags = { armor: false, shield: false };

export interface BlockHitInput {
  readonly rawDamage: number;
  readonly damageType: DamageType;
  /** Imunidade EXPLÍCITA ao tipo (`mitigation.immunities`, CMB-03) — checada ANTES de tudo. */
  readonly immune: boolean;
  readonly blockable: BlockFlags;
  /** A defesa da peça/inata, já escalada por quem monta o `Defender` (0 é "sem defesa"). */
  readonly defense: number;
  readonly armor: number;
  /**
   * `defenseMitigation` do monstro (em [0,30], teto do schema de `Monster`) ou 0 para o monstro
   * que não declara. Desde o #549 (M30-02) o JOGADOR não usa mais o "ou 0": ele chega aqui com
   * o percentual REAL de `playerMitigation` (`hunt.ts#playerMitigationV3`), sem o teto de 30 —
   * a fórmula do jogador não tem esse limite.
   */
  readonly defenseMitigationPercent: number;
  /**
   * A exceção do `mitigateDamage` do Canary: lifedrain/manadrain/agony NÃO passam pela
   * mitigação percentual. Sempre `false` hoje — `@draconya/content` ainda não declara esses
   * tipos (M29-07); o parâmetro existe para não reabrir este arquivo quando eles chegarem.
   */
  readonly mitigationExempt: boolean;
  readonly blockCharge: BlockChargeState;
  readonly nowMs: number;
}

/** O resultado auditável do estágio — o irmão de `DefenseOutcome` (CMB-04) para o `combat-v3`. */
export interface BlockHitOutcome {
  readonly immune: boolean;
  /** Quanto a defesa tirou — `uniform_random(defense/2, defense)`, só com carga disponível. */
  readonly defenseBlocked: number;
  readonly afterDefense: number;
  /** Quanto a armadura tirou — faixa (armor > 3) ou −1 (1–3), 0 sem armadura. */
  readonly armorReduction: number;
  readonly afterArmor: number;
  /** Quanto a mitigação percentual tirou, sobre o pós-armadura. */
  readonly mitigationRemoved: number;
  /** O que sobrou depois dos três estágios — SEM piso nem resistência, que ficam em `damage.ts`. */
  readonly damage: number;
  /** As cargas de bloqueio DEPOIS deste golpe — quem chama grava de volta (invariante 9). */
  readonly blockCharge: BlockChargeState;
}

/**
 * O estágio de recebimento do `combat-v3`, na ordem exata do `Creature::blockHit`:
 *
 *   1. imunidade explícita — zera e para tudo (nem defesa, nem armadura, nem mitigação);
 *   2. defesa: só com `checkDefense` (origem) E carga de `blockCount` disponível — a carga é
 *      consumida sempre que `checkDefense || checkArmor`, MESMO sem defesa gastar nada; zerou o
 *      dano, a armadura é PULADA;
 *   3. armadura: só com `checkArmor` (origem) e o dano ainda positivo — INDEPENDENTE da carga de
 *      bloqueio, sempre que a origem permite;
 *   4. mitigação percentual: sobre o que sobrou, exceto quando `mitigationExempt`.
 *
 * Função PURA a menos do RNG (o da sessão, como todo estágio deste pacote). Devolve o estado de
 * `blockCharge` NOVO; a escrita de volta no personagem/monstro é de quem aplica o outcome
 * (`applyDamageOutcome`, CMB-08) — este estágio só calcula.
 */
export function resolveBlockHit(input: BlockHitInput, rng: Rng): BlockHitOutcome {
  if (input.immune) {
    return {
      immune: true, defenseBlocked: 0, afterDefense: input.rawDamage,
      armorReduction: 0, afterArmor: input.rawDamage, mitigationRemoved: 0,
      damage: 0, blockCharge: input.blockCharge,
    };
  }

  let damage = input.rawDamage;
  let defenseBlocked = 0;
  let armorApplies = input.blockable.armor;
  let blockCharge = input.blockCharge;

  if (input.blockable.shield || input.blockable.armor) {
    // A carga é consumida sempre que UM dos dois vale — mesmo sem defesa gastar nada, e mesmo
    // quando só a armadura (que não depende de carga nenhuma) está em jogo. É o `Creature::
    // blockHit` do Canary: `if (checkDefense || checkArmor) { if (blockCount > 0) {
    // --blockCount; hasDefense = true; } ... }`.
    const consumption = consumeBlockCharge(blockCharge, input.nowMs);
    blockCharge = consumption.state;
    if (input.blockable.shield && consumption.hadCharge) {
      // A rolagem acontece SEMPRE que há carga, mesmo com `defense` 0 — a sequência não pode
      // depender do VALOR da peça (a mesma regra do bloqueio binário do CMB-04).
      const lo = Math.floor(input.defense / 2);
      defenseBlocked = rng.integer(lo, input.defense);
      damage -= defenseBlocked;
      if (damage <= 0) {
        damage = 0;
        armorApplies = false; // o Canary pula a armadura quando a defesa já zerou o golpe.
      }
    }
  }

  const afterDefense = damage;
  let armorReduction = 0;
  if (armorApplies) {
    if (input.armor > 3) {
      const lo = Math.floor(input.armor / 2);
      const hi = input.armor - (input.armor % 2 + 1);
      armorReduction = rng.integer(lo, hi);
      damage -= armorReduction;
    } else if (input.armor > 0) {
      armorReduction = 1;
      damage -= 1;
    }
    if (damage <= 0) damage = 0;
  }

  const afterArmor = damage;
  let mitigationRemoved = 0;
  if (damage !== 0 && !input.mitigationExempt && input.defenseMitigationPercent > 0) {
    mitigationRemoved = damage * (input.defenseMitigationPercent / 100);
    damage -= mitigationRemoved;
  }

  return {
    immune: false, defenseBlocked, afterDefense, armorReduction, afterArmor,
    mitigationRemoved, damage, blockCharge,
  };
}
