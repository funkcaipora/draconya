import { describe, expect, it } from 'vitest';
import {
  HEALTH_BAR_HEIGHT, HEALTH_BAR_WIDTH, HEALTH_FILL_HEIGHT, HEALTH_FILL_WIDTH,
  healthColor, healthPercent, healthWidth,
} from './health.js';

describe('healthColor (FUN-23)', () => {
  it('segue a tabela dos clientes Open Tibia, faixa a faixa', () => {
    expect(healthColor(100)).toBe(0x00bc00);
    expect(healthColor(93)).toBe(0x00bc00);
    expect(healthColor(61)).toBe(0x50a150);
    expect(healthColor(31)).toBe(0xa1a100);
    expect(healthColor(9)).toBe(0xbf0a0a);
    expect(healthColor(4)).toBe(0x910f0f);
    expect(healthColor(1)).toBe(0x850c0c);
  });

  it('a borda é `>`: exatamente 92 já é a SEGUNDA faixa', () => {
    // É assim no cliente. Um `>=` aqui faria a barra ficar verde-claro um golpe a mais.
    expect(healthColor(92)).toBe(0x50a150);
    expect(healthColor(60)).toBe(0xa1a100);
    expect(healthColor(30)).toBe(0xbf0a0a);
    expect(healthColor(8)).toBe(0x910f0f);
    expect(healthColor(3)).toBe(0x850c0c);
  });

  it('zero é a última faixa', () => {
    expect(healthColor(0)).toBe(0x850c0c);
  });
});

describe('healthPercent (FUN-23)', () => {
  it('é a proporção em 0..100', () => {
    expect(healthPercent(50, 200)).toBe(25);
    expect(healthPercent(200, 200)).toBe(100);
  });

  it('maxHealth zero é 0, não NaN', () => {
    expect(healthPercent(10, 0)).toBe(0);
  });

  it('vida acima do máximo é 100, não mais', () => {
    expect(healthPercent(300, 200)).toBe(100);
  });

  it('vida negativa é 0, não uma porcentagem negativa', () => {
    // O contrato é "de 0 a 100"; `-5` passaria pela tabela de cores por acaso (cai na
    // última faixa) e ninguém veria. Mutação que mata: tirar o `health <= 0` da guarda.
    expect(healthPercent(-5, 100)).toBe(0);
  });
});

describe('healthWidth (FUN-23)', () => {
  it('cheia ocupa a largura inteira; vazia, nada', () => {
    expect(healthWidth(100, 100, 25)).toBe(25);
    expect(healthWidth(0, 100, 25)).toBe(0);
  });

  it('é proporcional', () => {
    expect(healthWidth(50, 100, 25)).toBe(13);
    expect(healthWidth(10, 100, 25)).toBe(3);
  });

  it('maxHealth zero NÃO divide por zero', () => {
    expect(healthWidth(10, 0, 25)).toBe(0);
    expect(Number.isNaN(healthWidth(10, 0, 25))).toBe(false);
  });

  it('vida acima do máximo NÃO passa da largura cheia', () => {
    expect(healthWidth(150, 100, 25)).toBe(25);
  });

  it('um de vida em mil ainda é UM pixel, não barra vazia', () => {
    // Barra vazia diz "morta", e 1 de vida não é morta.
    expect(healthWidth(1, 1000, 25)).toBe(1);
  });

  it('vida negativa é vazia', () => {
    expect(healthWidth(-5, 100, 25)).toBe(0);
  });
});

describe('as medidas da barra (FUN-23)', () => {
  it('27×4 com contorno de 1 px em volta de 25×2', () => {
    expect(HEALTH_BAR_WIDTH).toBe(27);
    expect(HEALTH_BAR_HEIGHT).toBe(4);
    expect(HEALTH_FILL_WIDTH).toBe(25);
    expect(HEALTH_FILL_HEIGHT).toBe(2);
  });
});
