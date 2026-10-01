import { describe, expect, it } from 'vitest';
import {
  CAVERN_TINT, LIGHT_LIFT, MAX_LIGHT_LEVEL, ambientTint, blendTint, lightLevelAt,
} from './light.js';
import type { SelfLight } from './light.js';

/** A luz de um Light (raio 6, 370 s) que chegou em `receivedAtMs` com `remainingMs` por vir. */
const light = (remainingMs: number, receivedAtMs = 0, over: Partial<SelfLight> = {}): SelfLight => ({
  level: 6, color: 215, durationMs: 370_000, remainingMs, receivedAtMs, ...over,
});

describe('lightLevelAt — o decaimento do ConditionLight (#623)', () => {
  it('sem luz, 0', () => {
    expect(lightLevelAt(null, 0)).toBe(0);
  });

  it('recém-lançada, o nível inteiro; a cada 1/nível do prazo, um a menos', () => {
    // 370 000 / 6 ≈ 61 667 ms por nível: o `lightChangeInterval` do Canary.
    expect(lightLevelAt(light(370_000), 0)).toBe(6);
    expect(lightLevelAt(light(370_000), 61_000)).toBe(6);
    expect(lightLevelAt(light(370_000), 62_000)).toBe(5);
    expect(lightLevelAt(light(370_000), 370_000 - 61_000)).toBe(1);
  });

  it('apaga no fim do prazo, e nunca passa do nível da magia nem fica negativa', () => {
    expect(lightLevelAt(light(370_000), 370_000)).toBe(0);
    expect(lightLevelAt(light(370_000), 999_999)).toBe(0);
    // Uma luz que chegou com o restante MAIOR que o prazo (relógio do servidor atrasado) não passa do nível.
    expect(lightLevelAt(light(999_999), 0)).toBe(6);
  });

  it('o relógio conta a partir da CHEGADA, não de zero', () => {
    // Chegou aos 500 s do relógio local com 185 s restantes (metade): nível 3 ali, 2 depois.
    expect(lightLevelAt(light(185_000, 500_000), 500_000)).toBe(3);
    expect(lightLevelAt(light(185_000, 500_000), 500_000 + 62_000)).toBe(2);
    // Um `nowMs` ANTES da chegada (relógio que recuou) não rejuvenesce a luz.
    expect(lightLevelAt(light(185_000, 500_000), 100_000)).toBe(3);
  });
});

describe('blendTint', () => {
  it('t = 0 é a origem, t = 1 é o destino, e o meio é canal a canal', () => {
    expect(blendTint(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(blendTint(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(blendTint(0x102030, 0x304050, 0.5)).toBe(0x203040);
  });

  it('t fora de [0, 1] é preso', () => {
    expect(blendTint(0x102030, 0x304050, -3)).toBe(0x102030);
    expect(blendTint(0x102030, 0x304050, 9)).toBe(0x304050);
  });
});

describe('ambientTint — o bueiro escuro que a luz clareia (#623)', () => {
  it('na superfície não há escuridão a clarear: branco, com ou sem luz', () => {
    expect(ambientTint('surface', null, 0)).toBe(0xffffff);
    expect(ambientTint('surface', light(370_000), 0)).toBe(0xffffff);
  });

  it('no bueiro sem luz é o tom frio de sempre', () => {
    expect(ambientTint('cavern', null, 0)).toBe(CAVERN_TINT);
    expect(ambientTint('cavern', light(370_000), 999_999)).toBe(CAVERN_TINT); // já apagou
  });

  it('a luz clareia o bueiro na proporção do nível, e o decaimento escurece de volta', () => {
    const bright = ambientTint('cavern', light(695_000, 0, { level: MAX_LIGHT_LEVEL, durationMs: 695_000 }), 0);
    const dim = ambientTint('cavern', light(370_000), 0); // nível 6
    const fading = ambientTint('cavern', light(370_000), 300_000); // nível 2
    // Cada canal do tom cresce com o nível (o alvo é branco): maior nível = mais claro.
    const red = (tint: number): number => (tint >> 16) & 0xff;
    expect(red(bright)).toBeGreaterThan(red(dim));
    expect(red(dim)).toBeGreaterThan(red(fading));
    expect(red(fading)).toBeGreaterThan(red(CAVERN_TINT));
    // O nível máximo percorre `LIGHT_LIFT` do caminho até a cor da luz — o bueiro continua escuro.
    expect(bright).toBe(blendTint(CAVERN_TINT, 0xffffff, LIGHT_LIFT));
    expect(red(bright)).toBeLessThan(0xff);
  });

  it('um índice fora da paleta (preto) cai no branco: a luz nunca ESCURECE o mundo', () => {
    const broken = ambientTint('cavern', light(370_000, 0, { color: 250 }), 0);
    expect(broken).toBeGreaterThan(CAVERN_TINT);
  });
});
