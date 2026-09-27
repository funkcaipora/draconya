import { describe, expect, it } from 'vitest';
import { hasItemOverlay, normalizeItemOverlay, readItemOverlay } from './item-overlay.js';

describe('overlay por instância (#604, ADR 0046)', () => {
  const imbuement = { slot: 0, typeId: 'vampirism-basic', remainingMs: 72_000_000 };

  it('overlay vazio não existe: normaliza para ausente, e ausente não bloqueia pilha', () => {
    expect(normalizeItemOverlay(undefined)).toBeUndefined();
    expect(normalizeItemOverlay({})).toBeUndefined();
    expect(normalizeItemOverlay({ imbuements: [] })).toBeUndefined();
    expect(hasItemOverlay({ overlay: { imbuements: [] } })).toBe(false);
    expect(hasItemOverlay({})).toBe(false);
    expect(hasItemOverlay({ overlay: { imbuements: [imbuement] } })).toBe(true);
  });

  it('lê o gravado: imbuements válidos, em ordem de slot', () => {
    const second = { slot: 1, typeId: 'strike-basic', remainingMs: 10 };
    expect(readItemOverlay({ imbuements: [second, imbuement] }))
      .toEqual({ imbuements: [imbuement, second] });
  });

  it('gravado torto vira ausente em vez de trancar o login', () => {
    expect(readItemOverlay(null)).toBeUndefined();
    expect(readItemOverlay('x')).toBeUndefined();
    expect(readItemOverlay([imbuement])).toBeUndefined();
    expect(readItemOverlay({ imbuements: 'x' })).toBeUndefined();
    expect(readItemOverlay({ imbuements: [{ ...imbuement, remainingMs: -1 }] })).toBeUndefined();
    expect(readItemOverlay({ imbuements: [{ ...imbuement, slot: 0.5 }] })).toBeUndefined();
    expect(readItemOverlay({ imbuements: [{ ...imbuement, typeId: '' }] })).toBeUndefined();
    // Dois imbuements no mesmo slot é estado impossível.
    expect(readItemOverlay({ imbuements: [imbuement, imbuement] })).toBeUndefined();
  });

  it('lê o prazo restante do anel (#689); torto, zero ou negativo vira "cheio"', () => {
    expect(readItemOverlay({ durationRemainingMs: 400_000 })).toEqual({ durationRemainingMs: 400_000 });
    expect(hasItemOverlay({ overlay: { durationRemainingMs: 1 } })).toBe(true);
    expect(readItemOverlay({ durationRemainingMs: 0 })).toBeUndefined();
    expect(readItemOverlay({ durationRemainingMs: -5 })).toBeUndefined();
    expect(readItemOverlay({ durationRemainingMs: '400000' })).toBeUndefined();
    expect(readItemOverlay({ imbuements: [imbuement], durationRemainingMs: Number.NaN }))
      .toEqual({ imbuements: [imbuement] });
  });

  it('preserva o campo de uma mecânica que um nó mais novo já grava (#617)', () => {
    // Mutação que mata: descartar chave desconhecida na leitura — o extrato seguinte a
    // apagaria do banco (ADR 0014).
    expect(readItemOverlay({ imbuements: [imbuement], durationRemainingMs: 5000 }))
      .toEqual({ imbuements: [imbuement], durationRemainingMs: 5000 });
    expect(readItemOverlay({ imbuements: 'torto', tier: 3 })).toEqual({ tier: 3 });
  });
});
