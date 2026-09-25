// Testes do modelo de cargas de bloqueio do `combat-v3` (#548) — ver o comentário de
// `block-charge.ts` sobre a equivalência com o `blockCount` por tick do Canary.

import { describe, expect, it } from 'vitest';
import {
  availableBlockCharges, consumeBlockCharge, FULL_BLOCK_CHARGE, MAX_BLOCK_CHARGES,
} from './block-charge.js';
import type { BlockChargeState } from './block-charge.js';

describe('availableBlockCharges', () => {
  it('começa com as duas cargas disponíveis (FULL_BLOCK_CHARGE)', () => {
    expect(availableBlockCharges(FULL_BLOCK_CHARGE, 0)).toBe(MAX_BLOCK_CHARGES);
    expect(availableBlockCharges(FULL_BLOCK_CHARGE, 500)).toBe(MAX_BLOCK_CHARGES);
  });

  it('uma vaga gasta não conta até o próprio instante de prontidão', () => {
    const state: BlockChargeState = [1_000, 0];
    expect(availableBlockCharges(state, 999)).toBe(1);
    expect(availableBlockCharges(state, 1_000)).toBe(2);
  });
});

describe('consumeBlockCharge', () => {
  it('#548: o segundo bloqueio no mesmo segundo gasta o blockCount, e o terceiro não defende', () => {
    let state: BlockChargeState = FULL_BLOCK_CHARGE;

    const first = consumeBlockCharge(state, 100);
    expect(first.hadCharge).toBe(true);
    state = first.state;
    expect(availableBlockCharges(state, 100)).toBe(1);

    const second = consumeBlockCharge(state, 200);
    expect(second.hadCharge).toBe(true);
    state = second.state;
    expect(availableBlockCharges(state, 200)).toBe(0);

    const third = consumeBlockCharge(state, 300);
    expect(third.hadCharge).toBe(false);
    // Sem carga, o estado devolvido é o MESMO — nada a escrever.
    expect(third.state).toBe(state);
  });

  it('cada vaga recarrega 1000 ms depois do PRÓPRIO consumo', () => {
    let state: BlockChargeState = FULL_BLOCK_CHARGE;
    state = consumeBlockCharge(state, 100).state;
    state = consumeBlockCharge(state, 200).state;
    expect(availableBlockCharges(state, 1_099)).toBe(0);
    // A vaga consumida em 100 volta pronta em 1100 (100 + 1000).
    expect(availableBlockCharges(state, 1_100)).toBe(1);
    // A vaga consumida em 200 volta pronta em 1200.
    expect(availableBlockCharges(state, 1_200)).toBe(2);
  });

  it('o teto nunca passa de MAX_BLOCK_CHARGES mesmo com muito tempo decorrido', () => {
    let state: BlockChargeState = FULL_BLOCK_CHARGE;
    state = consumeBlockCharge(state, 100).state;
    expect(availableBlockCharges(state, 1_000_000)).toBe(MAX_BLOCK_CHARGES);
  });
});
