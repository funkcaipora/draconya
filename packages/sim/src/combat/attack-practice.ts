// De onde vem cada try de skill no `combat-v3` (#686, M32-G9): o tipo de bloqueio do golpe, o
// contador de "sangue" e o escudo que só treina quando bloqueia.
//
// Só a REGRA do Canary (ADR 0019) — `Player::onAttackedCreatureBlockHit`, `Player::onBlockHit`
// e os tries por golpe de `weapons.cpp` —, escrita do zero em TypeScript: nenhum código copiado,
// traduzido ou adaptado linha a linha. Módulo puro (invariante 1): nenhum sorteio, nenhum
// relógio; quem grava o estado de volta no personagem é o ruleset, dono da sessão (invariante 9).

import type { BlockType } from './blockhit.js';

/** O estado de prática de ataque do personagem. Nasce a cada sessão e não é persistido (DT-02). */
export interface AttackPracticeState {
  /** O tipo de bloqueio do último golpe que o personagem desferiu (`lastAttackBlockType`). */
  readonly lastBlockType: BlockType;
  /** Se o último golpe ainda rende try de arma (`addAttackSkillPoint`). */
  readonly addAttackSkill: boolean;
  /** Golpes bloqueados seguidos que ainda treinam, recarregado por todo golpe que tira sangue. */
  readonly bloodHitCount: number;
  /** Bloqueios de escudo que ainda treinam, recarregado pelo mesmo golpe que tira sangue. */
  readonly shieldBlockCount: number;
}

/** Golpes bloqueados seguidos que ainda treinam, e a recarga do escudo. */
export const BLOOD_HIT_RECHARGE = 30;

/** O estado de quem acabou de entrar: tudo zerado — o primeiro golpe bloqueado não treina. */
export const INITIAL_ATTACK_PRACTICE: AttackPracticeState = {
  lastBlockType: 'none', addAttackSkill: false, bloodHitCount: 0, shieldBlockCount: 0,
};

/** Se o estado é o inicial — é o que o snapshot omite (padrão de `blockCharge`). */
export function isInitialAttackPractice(state: AttackPracticeState): boolean {
  return state.lastBlockType === INITIAL_ATTACK_PRACTICE.lastBlockType
    && state.addAttackSkill === INITIAL_ATTACK_PRACTICE.addAttackSkill
    && state.bloodHitCount === INITIAL_ATTACK_PRACTICE.bloodHitCount
    && state.shieldBlockCount === INITIAL_ATTACK_PRACTICE.shieldBlockCount;
}

/**
 * O golpe do personagem acabou de ser resolvido pelo alvo com `blockType`. Golpe limpo treina e
 * recarrega os dois contadores; imunidade não treina e não mexe neles; defesa ou armadura
 * treinam enquanto houver sangue guardado, gastando um de cada vez.
 */
export function afterAttackBlock(state: AttackPracticeState, blockType: BlockType): AttackPracticeState {
  if (blockType === 'none') {
    return {
      lastBlockType: blockType, addAttackSkill: true,
      bloodHitCount: BLOOD_HIT_RECHARGE, shieldBlockCount: BLOOD_HIT_RECHARGE,
    };
  }
  if (blockType === 'immunity') return { ...state, lastBlockType: blockType, addAttackSkill: false };
  // Defesa ou armadura: treina enquanto houver "sangue" guardado.
  return state.bloodHitCount > 0
    ? { ...state, lastBlockType: blockType, addAttackSkill: true, bloodHitCount: state.bloodHitCount - 1 }
    : { ...state, lastBlockType: blockType, addAttackSkill: false };
}

/** Tries de corpo a corpo (e punho) por golpe: 1 se o último golpe treina e não foi imune. */
export function meleeTries(state: AttackPracticeState): number {
  return state.addAttackSkill && state.lastBlockType !== 'immunity' ? 1 : 0;
}

/**
 * Tries de distância por tiro: 2 no golpe limpo, 1 no bloqueado por defesa/armadura, 0 no
 * imune ou sem sangue. O tiro errado não passa pelo `blockHit` — vale o estado ANTERIOR.
 */
export function distanceTries(state: AttackPracticeState): number {
  if (!state.addAttackSkill) return 0;
  if (state.lastBlockType === 'none') return 2;
  return state.lastBlockType === 'immunity' ? 0 : 1;
}

/**
 * O personagem acabou de receber um golpe. O escudo só treina quando esse golpe FOI bloqueado
 * (defesa ou armadura) com carga de bloqueio disponível e ainda há bloqueios de escudo
 * guardados — apanhar, por si só, não treina nada.
 */
export function afterShieldBlock(
  state: AttackPracticeState,
  outcome: { readonly blockType?: BlockType; readonly hadBlockCharge?: boolean },
  hasShield: boolean,
): { readonly state: AttackPracticeState; readonly tries: number } {
  const blocked = outcome.blockType === 'defense' || outcome.blockType === 'armor';
  if (outcome.hadBlockCharge !== true || !blocked || state.shieldBlockCount <= 0) return { state, tries: 0 };
  // O contador cai mesmo sem escudo na mão; só o try exige o escudo.
  return {
    state: { ...state, shieldBlockCount: state.shieldBlockCount - 1 },
    tries: hasShield ? 1 : 0,
  };
}
