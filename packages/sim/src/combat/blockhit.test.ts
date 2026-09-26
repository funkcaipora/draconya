// O estágio de recebimento do `combat-v3` (#548) — `Creature::blockHit` do Canary.
//
// O que este arquivo prende: os vetores à mão do #548 (defesa 30 → [15,30]; armadura 25 →
// [12,23]; armadura 3 → −1; armadura 0 → identidade), a ordem (imunidade primeiro, armadura
// PULADA quando a defesa já zerou), as flags de bloqueio por origem e a mitigação percentual
// aplicando mesmo sem defesa/armadura.

import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { FULL_BLOCK_CHARGE } from './block-charge.js';
import type { BlockChargeState } from './block-charge.js';
import {
  DISTANCE_BLOCK_FLAGS, MAGIC_BLOCK_FLAGS, MELEE_BLOCK_FLAGS, resolveBlockHit,
} from './blockhit.js';
import type { BlockHitInput } from './blockhit.js';

/** Um `Rng` de mentira que devolve `values` em sequência por `rng.integer(...)`. */
function scriptedInteger(...values: number[]): Rng {
  let index = 0;
  return { integer: () => values[index++] ?? 0 } as unknown as Rng;
}

const baseInput = (over: Partial<BlockHitInput>): BlockHitInput => ({
  rawDamage: 1_000,
  damageType: 'physical',
  immune: false,
  blockable: MELEE_BLOCK_FLAGS,
  defense: 0,
  armor: 0,
  defenseMitigationPercent: 0,
  mitigationExempt: false,
  blockCharge: FULL_BLOCK_CHARGE,
  nowMs: 0,
  ...over,
});

describe('resolveBlockHit — vetores à mão do #548', () => {
  it('defesa 30: o sorteio cai sempre em [15, 30]', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 300; i += 1) {
      const rng = Rng.fromSeed(`defense-${i}`);
      const outcome = resolveBlockHit(baseInput({ defense: 30 }), rng);
      expect(outcome.defenseBlocked).toBeGreaterThanOrEqual(15);
      expect(outcome.defenseBlocked).toBeLessThanOrEqual(30);
      seen.add(outcome.defenseBlocked);
    }
    // Os dois extremos aparecem numa amostra desse tamanho — não é uma faixa mais estreita.
    expect(seen.has(15)).toBe(true);
    expect(seen.has(30)).toBe(true);
  });

  it('armadura 25 (> 3): o sorteio cai sempre em [12, 23]', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 300; i += 1) {
      const rng = Rng.fromSeed(`armor-${i}`);
      const outcome = resolveBlockHit(baseInput({ armor: 25 }), rng);
      expect(outcome.armorReduction).toBeGreaterThanOrEqual(12);
      expect(outcome.armorReduction).toBeLessThanOrEqual(23);
      seen.add(outcome.armorReduction);
    }
    expect(seen.has(12)).toBe(true);
    expect(seen.has(23)).toBe(true);
  });

  it('armadura 3 (1..3): sempre −1, sem sorteio nenhum para o estágio', () => {
    // A defesa (0) ainda gasta UM `integer` (o `uniform_random(0,0)` do Canary, que também
    // sorteia); o `scriptedInteger` devolve 0 para ele e nada mais é consultado pela armadura.
    const rng = scriptedInteger(0);
    const outcome = resolveBlockHit(baseInput({ defense: 0, armor: 3 }), rng);
    expect(outcome.armorReduction).toBe(1);
    expect(outcome.afterArmor).toBe(outcome.afterDefense - 1);
  });

  it('armadura 0: identidade, sem redução nenhuma', () => {
    const rng = scriptedInteger(0);
    const outcome = resolveBlockHit(baseInput({ defense: 0, armor: 0 }), rng);
    expect(outcome.armorReduction).toBe(0);
    expect(outcome.afterArmor).toBe(outcome.afterDefense);
  });
});

describe('resolveBlockHit — ordem e casos de borda', () => {
  it('imunidade zera tudo e não sorteia nada', () => {
    const rng = { integer: () => { throw new Error('não deveria sortear'); } } as unknown as Rng;
    const outcome = resolveBlockHit(baseInput({ immune: true, defense: 30, armor: 25 }), rng);
    expect(outcome).toMatchObject({
      immune: true, defenseBlocked: 0, armorReduction: 0, mitigationRemoved: 0, damage: 0,
    });
    expect(outcome.blockCharge).toBe(FULL_BLOCK_CHARGE);
  });

  it('a armadura é PULADA quando a defesa já zerou o golpe', () => {
    // defesa 100 num golpe de 10: o bloqueio nunca é menor que 50 (uniform_random(50,100)),
    // sempre maior que o rawDamage — o golpe zera antes da armadura.
    const rng = scriptedInteger(70 /* defesa */, 999 /* armadura, nunca deveria ser lida */);
    const outcome = resolveBlockHit(baseInput({ rawDamage: 10, defense: 100, armor: 25 }), rng);
    expect(outcome.afterDefense).toBe(0);
    expect(outcome.armorReduction).toBe(0);
    expect(outcome.afterArmor).toBe(0);
    expect(outcome.damage).toBe(0);
  });

  it('mitigação percentual aplica sobre o pós-armadura', () => {
    const rng = scriptedInteger(0 /* defesa */, 12 /* armadura */);
    const outcome = resolveBlockHit(
      baseInput({ rawDamage: 1_000, defense: 0, armor: 25, defenseMitigationPercent: 10 }), rng,
    );
    // afterArmor = 1000 - 12 = 988; mitigação 10% = 98.8
    expect(outcome.afterArmor).toBe(988);
    expect(outcome.mitigationRemoved).toBeCloseTo(98.8, 5);
    expect(outcome.damage).toBeCloseTo(988 - 98.8, 5);
  });

  it('a exceção de lifedrain/manadrain (mitigationExempt) pula a mitigação percentual', () => {
    const rng = scriptedInteger(0, 0);
    const outcome = resolveBlockHit(
      baseInput({ armor: 0, defenseMitigationPercent: 10, mitigationExempt: true }), rng,
    );
    expect(outcome.mitigationRemoved).toBe(0);
    expect(outcome.damage).toBe(outcome.afterArmor);
  });

  it('sem `blockable.shield` nem `blockable.armor`, nenhuma carga é gasta (magia/wand)', () => {
    const rng = { integer: () => { throw new Error('não deveria sortear'); } } as unknown as Rng;
    const before: BlockChargeState = FULL_BLOCK_CHARGE;
    const outcome = resolveBlockHit(
      baseInput({ blockable: MAGIC_BLOCK_FLAGS, defense: 30, armor: 25 }), rng,
    );
    expect(outcome.defenseBlocked).toBe(0);
    expect(outcome.armorReduction).toBe(0);
    expect(outcome.blockCharge).toBe(before);
  });

  it('distância bloqueia só armadura, nunca defesa/escudo', () => {
    const rng = scriptedInteger(12);
    const outcome = resolveBlockHit(
      baseInput({ blockable: DISTANCE_BLOCK_FLAGS, defense: 30, armor: 25 }), rng,
    );
    expect(outcome.defenseBlocked).toBe(0);
    expect(outcome.armorReduction).toBe(12);
  });

  it('#548: sem carga de bloqueio, a defesa não reduz nada — a armadura continua valendo', () => {
    // O banco no zero, com o relógio ancorado no MESMO instante do golpe: nenhum período de
    // 1000 ms terminou ainda, então `availableBlockCharges` continua em zero.
    const exhausted: BlockChargeState = { charges: 0, anchorMs: 500 };
    const rng = scriptedInteger(15 /* só a armadura deveria consumir */);
    const outcome = resolveBlockHit(
      baseInput({ defense: 30, armor: 25, blockCharge: exhausted, nowMs: 500 }), rng,
    );
    expect(outcome.defenseBlocked).toBe(0);
    expect(outcome.armorReduction).toBe(15);
    // O estado de carga não mudou — não havia carga para consumir.
    expect(outcome.blockCharge).toEqual(exhausted);
  });
});
