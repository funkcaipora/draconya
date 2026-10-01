import { describe, expect, it } from 'vitest';
import { maxMeleeDamage, meleePower } from './monster-melee.js';

// Fixtures sintéticas: só os números das linhas que o Canary usa, nunca o Lua copiado (ADR 0019).

describe('maxMeleeDamage', () => {
  it('é o ceil(skill × attack × 0,05 + attack × 0,5) do Canary', () => {
    expect(maxMeleeDamage(10, 10)).toBe(10);
    expect(maxMeleeDamage(78, 50)).toBe(220);
  });

  it('segue o `double` na ordem do Canary, não o racional exato (os 4 pares reais em que diferem)', () => {
    // A aritmética inteira `ceil(attack × (skill + 10) / 20)` daria 246, 451, 90, 56 — um a menos.
    expect(maxMeleeDamage(50, 82)).toBe(247);
    expect(maxMeleeDamage(100, 82)).toBe(452);
    expect(maxMeleeDamage(65, 24)).toBe(91);
    expect(maxMeleeDamage(30, 28)).toBe(57);
  });
});

describe('meleePower', () => {
  it('skill/attack > 0 vencem uma faixa declarada na mesma linha', () => {
    expect(meleePower({ skill: 10, attack: 10, minDamage: -5, maxDamage: -50 }))
      .toEqual({ kind: 'range', power: { min: 0, max: 10 }, via: 'skill-attack' });
  });

  it('attack negativo desliga a fórmula e, sem faixa, dá 0..0', () => {
    expect(meleePower({ skill: 210, attack: -560 }))
      .toEqual({ kind: 'range', power: { min: 0, max: 0 }, via: 'none' });
  });

  it('skill 0 também desliga a fórmula e cai na faixa declarada', () => {
    expect(meleePower({ skill: 0, attack: 40, minDamage: 0, maxDamage: -30 }))
      .toEqual({ kind: 'range', power: { min: 0, max: 30 }, via: 'min-max' });
  });

  it('um lado só da faixa é 0..0 (o Canary só lê a faixa com os dois lados)', () => {
    expect(meleePower({ maxDamage: -300 })).toEqual({ kind: 'range', power: { min: 0, max: 0 }, via: 'none' });
    expect(meleePower({ minDamage: -300 })).toEqual({ kind: 'range', power: { min: 0, max: 0 }, via: 'none' });
    expect(meleePower({})).toEqual({ kind: 'range', power: { min: 0, max: 0 }, via: 'none' });
  });

  it('a faixa negativa do Canary vira magnitude positiva', () => {
    expect(meleePower({ minDamage: 0, maxDamage: -120 }))
      .toEqual({ kind: 'range', power: { min: 0, max: 120 }, via: 'min-max' });
    expect(meleePower({ minDamage: -120, maxDamage: -20 }))
      .toEqual({ kind: 'range', power: { min: 20, max: 120 }, via: 'min-max' });
  });

  it('a parte positiva da faixa (cura no Canary) não vira dano', () => {
    expect(meleePower({ minDamage: 60, maxDamage: -105 }))
      .toEqual({ kind: 'range', power: { min: 0, max: 105 }, via: 'min-max' });
    expect(meleePower({ minDamage: 15, maxDamage: 80 }))
      .toEqual({ kind: 'range', power: { min: 0, max: 0 }, via: 'min-max' });
  });

  it('valor não numérico conta como ausente', () => {
    expect(meleePower({ skill: 'x', attack: 20, minDamage: 0, maxDamage: -8 }))
      .toEqual({ kind: 'range', power: { min: 0, max: 8 }, via: 'min-max' });
  });
});
