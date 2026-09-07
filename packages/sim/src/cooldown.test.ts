import { describe, expect, it } from 'vitest';
import { Cooldowns, RECUPERACAO_MAXIMA } from './cooldown.js';

describe('ação disparada por evento', () => {
  it('fica indisponível pela duração e volta depois', () => {
    const cd = new Cooldowns();
    expect(cd.pronto('cura', 0)).toBe(true);
    cd.iniciar('cura', 0, 1000);
    expect(cd.pronto('cura', 999)).toBe(false);
    expect(cd.restanteMs('cura', 400)).toBe(600);
    expect(cd.pronto('cura', 1000)).toBe(true);
  });

  it('usa timestamp absoluto, para sobreviver a snapshot e retomada tardia', () => {
    const cd = new Cooldowns();
    cd.iniciar('cura', 5000, 1000);
    const retomado = Cooldowns.deEstado(cd.estado());
    expect(retomado.pronto('cura', 5500)).toBe(false);
    expect(retomado.pronto('cura', 60_000)).toBe(true);
  });
});

describe('ação periódica', () => {
  const contar = (passoMs: number, totalMs: number, intervaloMs: number): number => {
    const cd = new Cooldowns();
    let total = 0;
    for (let t = 0; t < totalMs; t += passoMs) total += cd.vezesQueCoube('atacar', passoMs, intervaloMs);
    return total;
  };

  it('o total não depende do tamanho do passo — é o invariante 2 em miniatura', () => {
    // Sem isto, a hunt desanexada renderia menos que a anexada, e o resultado passaria a
    // depender de haver alguém olhando (invariante 3).
    const esperado = contar(100, 60_000, 350);
    expect(contar(1000, 60_000, 350)).toBe(esperado);
    expect(contar(500, 60_000, 350)).toBe(esperado);
    expect(contar(50, 60_000, 350)).toBe(esperado);
  });

  it('vale para intervalo que não divide o passo', () => {
    const esperado = contar(100, 30_000, 333);
    expect(contar(1000, 30_000, 333)).toBe(esperado);
  });

  it('taxa efetiva bate com a esperada', () => {
    // 60 s com intervalo de 350 ms: ~171 aplicações, mais a primeira que já vem pronta.
    expect(contar(100, 60_000, 350)).toBe(Math.floor(60_000 / 350) + 1);
  });

  it('começa pronta', () => {
    expect(new Cooldowns().vezesQueCoube('atacar', 0, 1000)).toBe(1);
  });

  it('intervalo longo é limitado pelo teto, sem acumular dívida', () => {
    // Retomada depois de horas (FUN-28) não pode virar rajada.
    const cd = new Cooldowns();
    cd.vezesQueCoube('atacar', 0, 1000);
    expect(cd.vezesQueCoube('atacar', 3_600_000, 1000)).toBe(RECUPERACAO_MAXIMA);
    expect(cd.vezesQueCoube('atacar', 1000, 1000)).toBe(1);
  });

  it('o acumulado sobrevive ao snapshot', () => {
    const cd = new Cooldowns();
    cd.vezesQueCoube('atacar', 900, 350);
    const retomado = Cooldowns.deEstado(cd.estado());
    expect(retomado.vezesQueCoube('atacar', 100, 350)).toBe(cd.vezesQueCoube('atacar', 100, 350));
  });

  it('argumento inválido é erro, não silêncio', () => {
    expect(() => new Cooldowns().vezesQueCoube('x', 100, 0)).toThrow();
    expect(() => new Cooldowns().vezesQueCoube('x', -1, 100)).toThrow();
  });
});
