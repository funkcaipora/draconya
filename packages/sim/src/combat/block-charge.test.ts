// Testes do modelo de cargas de bloqueio do `combat-v3` (#548) — ver o comentário de
// `block-charge.ts` sobre a equivalência com o `blockCount` por tick do Canary, e sobre por que a
// versão anterior (duas vagas independentes) não era essa equivalência (achado da revisão do PR
// #642).

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

  it('uma carga só credita no PRÓPRIO instante em que o período de 1000 ms termina', () => {
    const state: BlockChargeState = { charges: 1, anchorMs: 0 };
    expect(availableBlockCharges(state, 999)).toBe(1);
    expect(availableBlockCharges(state, 1_000)).toBe(2);
  });
});

describe('consumeBlockCharge', () => {
  it('#548: o segundo bloqueio no mesmo segundo gasta o banco, e o terceiro não defende', () => {
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

  it('o relógio é COMPARTILHADO: duas cargas gastas em instantes diferentes voltam JUNTAS', () => {
    // A propriedade central do Canary que a versão de "duas vagas independentes" não tinha: o
    // relógio não sabe QUANDO cada carga foi gasta, só quantos períodos de 1000 ms passaram desde
    // que o banco começou a contar. Gastar em 100 e depois em 200 não empurra o crédito para
    // 1100/1200 — as duas voltam junto no mesmo período, 1000.
    let state: BlockChargeState = FULL_BLOCK_CHARGE;
    state = consumeBlockCharge(state, 100).state;
    state = consumeBlockCharge(state, 200).state;
    expect(availableBlockCharges(state, 999)).toBe(0);
    expect(availableBlockCharges(state, 1_000)).toBe(1);
    // A SEGUNDA carga só volta no período SEGUINTE (2000), não em 1100 nem em 1200 — o relógio
    // credita no máximo uma carga por período de 1000 ms, exatamente como o Canary.
    expect(availableBlockCharges(state, 1_999)).toBe(1);
    expect(availableBlockCharges(state, 2_000)).toBe(2);
  });

  it('consumir NÃO reinicia a fase do relógio — o próximo crédito continua no limite original', () => {
    // A diferença central com o modelo anterior (duas vagas independentes, cada uma reagendando
    // o PRÓPRIO relógio a partir do PRÓPRIO consumo): aqui consumir em 100 não empurra o próximo
    // crédito para 100 + 1000 = 1100. O relógio é do BANCO, não da carga, e continua contando a
    // partir do `anchorMs` original (0) — o crédito ainda cai em 1000, como se nada tivesse sido
    // consumido no meio do caminho.
    let state: BlockChargeState = FULL_BLOCK_CHARGE;
    state = consumeBlockCharge(state, 100).state; // banco: 1, anchorMs continua 0
    expect(availableBlockCharges(state, 999)).toBe(1);
    expect(availableBlockCharges(state, 1_000)).toBe(2);
  });

  it('o teto nunca passa de MAX_BLOCK_CHARGES mesmo com muito tempo decorrido', () => {
    let state: BlockChargeState = FULL_BLOCK_CHARGE;
    state = consumeBlockCharge(state, 100).state;
    expect(availableBlockCharges(state, 1_000_000)).toBe(MAX_BLOCK_CHARGES);
  });
});
