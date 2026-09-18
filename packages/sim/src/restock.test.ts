import { describe, expect, it } from 'vitest';
import { planRestock } from './restock.js';
import type { RestockInput } from './restock.js';

/**
 * A tabela de casos da reposição (#419). É o ponto em que a ordem dos `min` custa caro —
 * comprar acima da capacidade, deixar o saldo negativo ou dar lote grátis —, e por isso ela é
 * testada sem sessão nenhuma: `planRestock` é aritmética pura.
 */
const base: RestockInput = {
  current: 5,
  min: 10,
  batch: 50,
  price: 45,
  weight: 2.7,
  freeCapacity: 1_000,
  freeStack: 95,
  balance: 10_000,
};

const plan = (over: Partial<RestockInput> = {}) => planRestock('health-potion', { ...base, ...over });

describe('planRestock (#419)', () => {
  it('compra o lote inteiro quando tudo cabe', () => {
    expect(plan()).toEqual({ itemId: 'health-potion', quantity: 50, unitPrice: 45, total: 2_250 });
  });

  it('limita pela CAPACIDADE livre — floor(room / weight)', () => {
    // 100 de capacidade livre a 2,7 por unidade cabem 37.
    expect(plan({ freeCapacity: 100 })?.quantity).toBe(37);
  });

  it('limita pelo TETO da pilha', () => {
    expect(plan({ freeStack: 3 })?.quantity).toBe(3);
  });

  it('limita pelo SALDO e nunca deixa o saldo negativo', () => {
    // 90 de saldo a 45 o lote cheio não paga; o que paga é 2 unidades.
    expect(plan({ balance: 90 })?.quantity).toBe(2);
    expect(plan({ balance: 90 })?.total).toBe(90);
    // 44 não paga nem uma unidade: nenhuma compra.
    expect(plan({ balance: 44 })).toBeNull();
  });

  it('saldo zero não compra', () => {
    expect(plan({ balance: 0 })).toBeNull();
  });

  it('price 0 não compra — lote grátis acidental não existe', () => {
    expect(plan({ price: 0 })).toBeNull();
  });

  it('pilha em ou acima do min não compra', () => {
    expect(plan({ current: 10 })).toBeNull();
    expect(plan({ current: 11 })).toBeNull();
  });

  it('peso zero não divide por zero: o teto vira o lote', () => {
    expect(plan({ weight: 0, freeCapacity: 0 })?.quantity).toBe(50);
  });

  it('nunca devolve quantidade negativa', () => {
    expect(plan({ freeStack: 0 })).toBeNull();
    expect(plan({ freeCapacity: 0 })).toBeNull();
  });
});
