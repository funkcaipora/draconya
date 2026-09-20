import { describe, expect, it } from 'vitest';
import {
  ELEMENT_COLORS, FALLBACK_EFFECT_PHASES, FLOATING_TEXT_LIFETIME_MS, MISSILE_MIN_MS,
  MISSILE_MS_PER_TILE, effectPhaseAt, elementColor, floatingTextColor, floatingTextOffset,
  mergeFloatingText, missileDuration, missileProgress,
} from './effects.js';
import type { FloatingText } from '../state/world.js';

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

describe('missileDuration (#479)', () => {
  it('é 150 ms por tile de distância EUCLIDIANA — a fórmula do OTClient v8', () => {
    expect(missileDuration(at(0, 0), at(0, 0))).toBe(MISSILE_MIN_MS);
    expect(missileDuration(at(0, 0), at(1, 0))).toBe(150);
    expect(missileDuration(at(0, 0), at(4, 0))).toBe(600);
    // 3-4-5: a hipotenusa manda, não o maior eixo. Mutação que mata: Chebyshev (450).
    expect(missileDuration(at(0, 0), at(3, 4))).toBe(750);
  });

  it('a diagonal custa a hipotenusa, não o eixo maior', () => {
    // Por Chebyshev (o maior eixo), (2, 2) custaria 300; a fórmula do OTClient dá
    // `round(150 * sqrt(8)) = 424`. Mutação que mata: `Math.max(|dx|, |dy|)`.
    expect(missileDuration(at(0, 0), at(2, 2))).toBe(424);
    // `round(150 * sqrt(13)) = 541`.
    expect(missileDuration(at(0, 0), at(3, -2))).toBe(541);
  });

  it('os números de referência: 150 ms por tile, piso de 50 ms', () => {
    expect(MISSILE_MS_PER_TILE).toBe(150);
    expect(MISSILE_MIN_MS).toBe(50);
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

describe('floatingTextOffset (#479)', () => {
  it('sobe 48 px ao longo da vida, INTEIRO', () => {
    // Mutação que mata: tirar o `Math.round` — 45 ms daria 2,16 px, e o texto borra.
    expect(floatingTextOffset(0)?.dy).toBe(0);
    expect(floatingTextOffset(500)?.dy).toBe(24);
    expect(floatingTextOffset(45)?.dy).toBe(2);
    // Aos 999 ms (o último instante antes de acabar) já chegou aos 48 px.
    expect(floatingTextOffset(999)?.dy).toBe(48);
  });

  it('o alfa fica cheio por cinco sextos e cai no último sexto', () => {
    // Sumir de repente parece o número ter sido apagado; desvanecer desde o início deixa o dano
    // ilegível antes de o jogador ler. Mutação que mata: começar a cair em zero, ou em 2/3.
    expect(floatingTextOffset(0)?.alpha).toBe(1);
    expect(floatingTextOffset(600)?.alpha).toBe(1);
    expect(floatingTextOffset(833)?.alpha).toBe(1);
    expect(floatingTextOffset(916)?.alpha).toBeCloseTo(0.5, 1);
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

describe('floatingTextColor (#479)', () => {
  it('sem elemento, cai nas cores do Tibia: vermelho físico, roxo de magia, verde de cura', () => {
    // Mutação que mata: trocar duas cores entre si — o jogador leria cura como dano.
    expect(floatingTextColor('melee')).toBe(0xff0000);
    expect(floatingTextColor('spell')).toBe(0xcc33ff);
    expect(floatingTextColor('heal')).toBe(0x00ff00);
  });

  it('com elemento, a cor é a do ELEMENTO e vence o kind', () => {
    // Dano de gelo aparece em azul claro, não no roxo da magia. Mutação que mata: ignorar o
    // `damageType` e devolver sempre a cor do `kind`.
    expect(floatingTextColor('spell', 'ice')).toBe(0x66ccff);
    expect(floatingTextColor('spell', 'fire')).toBe(0xff6600);
    expect(floatingTextColor('melee', 'energy')).toBe(0xcc33ff);
    expect(floatingTextColor('melee', 'earth')).toBe(0x00cc00);
    expect(floatingTextColor('spell', 'holy')).toBe(0xffff00);
    expect(floatingTextColor('spell', 'death')).toBe(0xcccccc);
    expect(floatingTextColor('spell', 'physical')).toBe(0xff0000);
  });

  it('são os oito elementos, e `arcane` é o roxo da magia', () => {
    expect(Object.keys(ELEMENT_COLORS)).toHaveLength(9); // oito elementos + heal
    expect(elementColor('arcane')).toBe(0xcc33ff);
    // Tipo desconhecido nunca vira preto — some no fundo.
    expect(elementColor('poison')).toBe(0xcc33ff);
  });
});

describe('mergeFloatingText (#479)', () => {
  it('soma os valores no MESMO texto, em vez de criar outro', () => {
    const text: FloatingText = {
      id: 1, creatureId: 1, amount: 30, kind: 'melee', startedAtMs: 0, position: at(0, 0),
    };
    mergeFloatingText(text, 12);
    mergeFloatingText(text, 5);
    expect(text.amount).toBe(47);
  });
});
