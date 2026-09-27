// A prática de ataque e de escudo do `combat-v3` (#686): as quatro transições, o contador de
// sangue que esgota no 31º bloqueado e o escudo que só treina quando o golpe recebido foi
// bloqueado, com carga e escudo na mão.

import { describe, expect, it } from 'vitest';
import {
  BLOOD_HIT_RECHARGE, INITIAL_ATTACK_PRACTICE, afterAttackBlock, afterShieldBlock,
  distanceTries, isInitialAttackPractice, meleeTries,
} from './attack-practice.js';
import type { AttackPracticeState } from './attack-practice.js';

const clean = afterAttackBlock(INITIAL_ATTACK_PRACTICE, 'none');

describe('afterAttackBlock — as quatro transições', () => {
  it('golpe limpo: treina e recarrega os dois contadores', () => {
    expect(clean).toEqual({
      lastBlockType: 'none', addAttackSkill: true,
      bloodHitCount: BLOOD_HIT_RECHARGE, shieldBlockCount: BLOOD_HIT_RECHARGE,
    });
    expect(meleeTries(clean)).toBe(1);
    expect(distanceTries(clean)).toBe(2);
  });

  it('imune: não treina e não mexe nos contadores', () => {
    const state = afterAttackBlock(clean, 'immunity');
    expect(state.addAttackSkill).toBe(false);
    expect(state.bloodHitCount).toBe(BLOOD_HIT_RECHARGE);
    expect(state.shieldBlockCount).toBe(BLOOD_HIT_RECHARGE);
    expect(meleeTries(state)).toBe(0);
    expect(distanceTries(state)).toBe(0);
  });

  it.each(['defense', 'armor'] as const)('%s com sangue guardado: treina e gasta um', (type) => {
    const state = afterAttackBlock(clean, type);
    expect(state.addAttackSkill).toBe(true);
    expect(state.bloodHitCount).toBe(BLOOD_HIT_RECHARGE - 1);
    expect(state.shieldBlockCount).toBe(BLOOD_HIT_RECHARGE);
    expect(meleeTries(state)).toBe(1);
    expect(distanceTries(state)).toBe(1);
  });

  it('bloqueado sem sangue (o primeiro golpe da sessão): 0 tries', () => {
    const state = afterAttackBlock(INITIAL_ATTACK_PRACTICE, 'defense');
    expect(state.addAttackSkill).toBe(false);
    expect(state.bloodHitCount).toBe(0);
    expect(meleeTries(state)).toBe(0);
    expect(distanceTries(state)).toBe(0);
  });

  it('31 bloqueados seguidos depois de um limpo: os 30 primeiros treinam, o 31º não', () => {
    let state: AttackPracticeState = clean;
    const tries: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      state = afterAttackBlock(state, i % 2 === 0 ? 'armor' : 'defense');
      tries.push(meleeTries(state));
    }
    expect(tries.slice(0, 30).every((t) => t === 1)).toBe(true);
    expect(tries[30]).toBe(0);
    expect(state.bloodHitCount).toBe(0);
  });

  it('nada treina antes do primeiro golpe', () => {
    expect(meleeTries(INITIAL_ATTACK_PRACTICE)).toBe(0);
    expect(distanceTries(INITIAL_ATTACK_PRACTICE)).toBe(0);
    expect(isInitialAttackPractice(INITIAL_ATTACK_PRACTICE)).toBe(true);
    expect(isInitialAttackPractice(clean)).toBe(false);
  });
});

describe('afterShieldBlock', () => {
  it('bloqueado por defesa, com carga, contador e escudo: 1 try e o contador cai', () => {
    const result = afterShieldBlock(clean, { blockType: 'defense', hadBlockCharge: true }, true);
    expect(result.tries).toBe(1);
    expect(result.state.shieldBlockCount).toBe(BLOOD_HIT_RECHARGE - 1);
  });

  it('bloqueado por armadura também treina', () => {
    expect(afterShieldBlock(clean, { blockType: 'armor', hadBlockCharge: true }, true).tries).toBe(1);
  });

  it('sem carga de bloqueio: 0 e nada muda', () => {
    const result = afterShieldBlock(clean, { blockType: 'defense', hadBlockCharge: false }, true);
    expect(result.tries).toBe(0);
    expect(result.state).toBe(clean);
  });

  it('golpe limpo (`none`) ou imune: 0 — apanhar não treina escudo', () => {
    expect(afterShieldBlock(clean, { blockType: 'none', hadBlockCharge: true }, true).tries).toBe(0);
    expect(afterShieldBlock(clean, { blockType: 'immunity', hadBlockCharge: true }, true).tries)
      .toBe(0);
  });

  it('v1/v2 (sem tipo): 0', () => {
    expect(afterShieldBlock(clean, {}, true).tries).toBe(0);
  });

  it('sem escudo na mão: 0 try, mas o contador cai', () => {
    const result = afterShieldBlock(clean, { blockType: 'defense', hadBlockCharge: true }, false);
    expect(result.tries).toBe(0);
    expect(result.state.shieldBlockCount).toBe(BLOOD_HIT_RECHARGE - 1);
  });

  it('contador esgotado: 0', () => {
    const result = afterShieldBlock(
      INITIAL_ATTACK_PRACTICE, { blockType: 'defense', hadBlockCharge: true }, true,
    );
    expect(result.tries).toBe(0);
    expect(result.state).toBe(INITIAL_ATTACK_PRACTICE);
  });
});
