import { describe, expect, it } from 'vitest';
import {
  FALLBACK_EFFECT_PHASES, FLOATING_TEXT_LIFETIME_MS, MISSILE_BASE_MS, MISSILE_PER_TILE_MS,
  effectPhaseAt, floatingTextColor, floatingTextOffset, missileDuration, missileProgress,
} from './effects.js';

const at = (x: number, y: number, z = 7) => ({ x, y, z });

describe('effectPhaseAt (FUN-106)', () => {
  // Três fases de duração DIFERENTE: com fases iguais, "dividir o tempo pelo número de fases"
  // daria a mesma resposta que somar as durações, e a mutação passaria.
  const phases = [100, 150, 250];

  it('percorre as fases pela SOMA das durações, não pela divisão do tempo', () => {
    // Mutação que mata: `Math.floor(elapsedMs / phases[0])` no lugar do acumulador.
    expect(effectPhaseAt(phases, 0)).toBe(0);
    expect(effectPhaseAt(phases, 99)).toBe(0);
    expect(effectPhaseAt(phases, 100)).toBe(1);
    expect(effectPhaseAt(phases, 249)).toBe(1);
    expect(effectPhaseAt(phases, 250)).toBe(2);
    expect(effectPhaseAt(phases, 499)).toBe(2);
  });

  it('acabou é `null`, e a borda é o fim exato da última fase', () => {
    // Um `<=` no lugar de `<` faria o efeito tocar um quadro a mais no fim — e no começo, o
    // instante 100 ainda cairia na fase 0. Mutação que mata: `elapsedMs <= end`.
    expect(effectPhaseAt(phases, 500)).toBeNull();
    expect(effectPhaseAt(phases, 9_000)).toBeNull();
  });

  it('sem fases é `null` já em zero: não há o que desenhar', () => {
    // Mutação que mata: `if (phases.length === 0) return 0` antes do laço.
    expect(effectPhaseAt([], 0)).toBeNull();
  });

  it('tempo negativo é a fase 0, não um erro', () => {
    // Coberto pela mesma mutação do acumulador: a divisão de `-50` cai fora de toda fase.
    expect(effectPhaseAt(phases, -50)).toBe(0);
  });

  it('a linha do tempo de reserva tem UMA fase, e toca', () => {
    // É o que o viewport usa sem pacote: um efeito que não toca nada é indistinguível de um
    // que não chegou.
    expect(FALLBACK_EFFECT_PHASES).toHaveLength(1);
    expect(effectPhaseAt(FALLBACK_EFFECT_PHASES, 0)).toBe(0);
  });
});

describe('missileDuration (FUN-106)', () => {
  it('é base mais um tanto por tile', () => {
    expect(missileDuration(at(0, 0), at(0, 0))).toBe(MISSILE_BASE_MS);
    expect(missileDuration(at(0, 0), at(1, 0))).toBe(MISSILE_BASE_MS + MISSILE_PER_TILE_MS);
    expect(missileDuration(at(5, 5), at(2, 5))).toBe(MISSILE_BASE_MS + 3 * MISSILE_PER_TILE_MS);
  });

  it('a distância é a de CHEBYSHEV: a diagonal é um passo, não dois', () => {
    // Por Manhattan, (2, 2) seriam quatro tiles e o projétil em diagonal voaria mais devagar
    // que o em linha reta para um alvo à mesma distância. Mutação que mata: somar os eixos.
    expect(missileDuration(at(0, 0), at(2, 2))).toBe(MISSILE_BASE_MS + 2 * MISSILE_PER_TILE_MS);
    expect(missileDuration(at(0, 0), at(3, -2))).toBe(MISSILE_BASE_MS + 3 * MISSILE_PER_TILE_MS);
  });

  it('os números de referência: 100 ms para sair, 60 ms por tile', () => {
    expect(MISSILE_BASE_MS).toBe(100);
    expect(MISSILE_PER_TILE_MS).toBe(60);
  });
});

describe('missileProgress (FUN-106)', () => {
  it('vai de 0 a 1 pelo tempo, e chegou é `null`', () => {
    expect(missileProgress(1_000, 400, 1_000)).toBe(0);
    expect(missileProgress(1_000, 400, 1_200)).toBe(0.5);
    expect(missileProgress(1_000, 400, 1_399)).toBeCloseTo(0.9975);
    // Mutação que mata: `elapsed > durationMs` — no instante exato do fim ainda desenharia.
    expect(missileProgress(1_000, 400, 1_400)).toBeNull();
    expect(missileProgress(1_000, 400, 9_000)).toBeNull();
  });

  it('antes de começar é 0, não negativo', () => {
    expect(missileProgress(1_000, 400, 900)).toBe(0);
  });

  it('duração zero é "chegou", não NaN — mesmo antes de começar', () => {
    // Dividir por zero posicionaria o sprite em lugar nenhum. E a guarda vem ANTES da presa em
    // zero: um projétil sem duração carimbado no futuro é "chegou", não "saindo".
    // Mutação que mata: `durationMs < 0` na guarda (o caso 900 devolveria 0).
    expect(missileProgress(1_000, 0, 1_000)).toBeNull();
    expect(missileProgress(1_000, 0, 900)).toBeNull();
  });
});

describe('floatingTextOffset (FUN-106)', () => {
  it('sobe um pixel a cada 30 ms, INTEIRO', () => {
    // Mutação que mata: tirar o `Math.floor` — 45 ms daria 1,5 px, e o texto borra.
    expect(floatingTextOffset(0)?.dy).toBe(0);
    expect(floatingTextOffset(29)?.dy).toBe(0);
    expect(floatingTextOffset(30)?.dy).toBe(1);
    expect(floatingTextOffset(45)?.dy).toBe(1);
    expect(floatingTextOffset(300)?.dy).toBe(10);
    expect(floatingTextOffset(999)?.dy).toBe(33);
  });

  it('o alfa fica cheio por dois terços e cai linear no último', () => {
    // Sumir de repente parece o número ter sido apagado; desvanecer desde o início deixa o dano
    // ilegível antes de o jogador ler. Mutação que mata: começar a cair em zero.
    expect(floatingTextOffset(0)?.alpha).toBe(1);
    expect(floatingTextOffset(600)?.alpha).toBe(1);
    expect(floatingTextOffset(666)?.alpha).toBe(1);
    expect(floatingTextOffset(833)?.alpha).toBeCloseTo(0.5, 1);
    const last = floatingTextOffset(999)?.alpha ?? -1;
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(0.01);
  });

  it('acabou é `null`, e a vida é de um segundo', () => {
    expect(FLOATING_TEXT_LIFETIME_MS).toBe(1000);
    expect(floatingTextOffset(1000)).toBeNull();
    expect(floatingTextOffset(5_000)).toBeNull();
  });

  it('tempo negativo é o começo, não uma descida', () => {
    // Mutação que mata: tirar o `Math.max(0, …)` — `dy` sairia -4.
    expect(floatingTextOffset(-100)).toEqual({ dy: 0, alpha: 1 });
  });
});

describe('floatingTextColor (FUN-106)', () => {
  it('são as cores do Tibia: vermelho físico, roxo de energia, verde de cura', () => {
    // Mutação que mata: trocar duas cores entre si — o jogador leria cura como dano.
    expect(floatingTextColor('melee')).toBe(0xff0000);
    expect(floatingTextColor('spell')).toBe(0xcc33ff);
    expect(floatingTextColor('heal')).toBe(0x00ff00);
  });
});
