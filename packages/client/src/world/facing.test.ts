import { describe, expect, it } from 'vitest';
import { DEFAULT_FACING, facingOf, walkFrame } from './facing.js';

const at = (x: number, y: number) => ({ x, y, z: 7 });
const step = (from: [number, number], to: [number, number], over: Partial<{
  startedAtMs: number; durationMs: number; pushed: boolean;
}> = {}) => ({
  from: at(...from), to: at(...to),
  startedAtMs: over.startedAtMs ?? 0, durationMs: over.durationMs ?? 400, pushed: over.pushed ?? false,
});

describe('facingOf (FUN-23)', () => {
  it('lê a direção do passo, nos quatro eixos', () => {
    expect(facingOf({ step: step([1, 1], [1, 0]) })).toBe('north');
    expect(facingOf({ step: step([1, 1], [1, 2]) })).toBe('south');
    expect(facingOf({ step: step([1, 1], [2, 1]) })).toBe('east');
    expect(facingOf({ step: step([1, 1], [0, 1]) })).toBe('west');
  });

  it('diagonal mostra o LADO, como no Tibia', () => {
    // Andando em diagonal a criatura mostra o perfil, não as costas — escolher o eixo
    // vertical faria todo monstro em diagonal parecer que anda de costas.
    expect(facingOf({ step: step([1, 1], [2, 2]) })).toBe('east');
    expect(facingOf({ step: step([1, 1], [0, 0]) })).toBe('west');
  });

  it('sem passo, olha para o sul', () => {
    expect(facingOf({ step: null })).toBe(DEFAULT_FACING);
    expect(DEFAULT_FACING).toBe('south');
  });

  it('empurrão NÃO vira a criatura', () => {
    // Ser empurrado não é andar. Virar aqui faria um personagem parado girar quando um
    // monstro o desloca — que parece bug e é.
    expect(facingOf({ step: step([1, 1], [1, 0], { pushed: true }) })).toBe(DEFAULT_FACING);
  });

  it('o passo VENCIDO continua dando o facing', () => {
    // `apply.ts` nunca devolve `step` a null: é o que faz quem andou para o norte continuar
    // olhando para o norte depois de parar.
    expect(facingOf({ step: step([1, 1], [1, 0], { startedAtMs: 0, durationMs: 400 }) }))
      .toBe('north');
  });
});

describe('walkFrame (FUN-23)', () => {
  it('parada sem passo', () => {
    expect(walkFrame({ step: null }, 1_000, 8)).toEqual({ moving: false, phase: 0 });
  });

  it('a fase avança com o PROGRESSO do passo, não com o relógio', () => {
    // Oito fases num passo de 400 ms: a 200 ms está na quarta. Por relógio de parede — com
    // fases de 300 ms — estaria ainda na primeira, e as patas não se mexeriam.
    const s = { step: step([0, 0], [1, 0], { startedAtMs: 1_000, durationMs: 400 }) };
    expect(walkFrame(s, 1_000, 8)).toEqual({ moving: true, phase: 0 });
    expect(walkFrame(s, 1_200, 8)).toEqual({ moving: true, phase: 4 });
    expect(walkFrame(s, 1_399, 8)).toEqual({ moving: true, phase: 7 });
  });

  it('o passo vencido é PARADO, mesmo com `step` ainda no objeto', () => {
    // `step !== null` não significa andando: o objeto fica lá depois do fim. A checagem tem
    // que ser temporal, senão a criatura anima parada para sempre.
    const s = { step: step([0, 0], [1, 0], { startedAtMs: 1_000, durationMs: 400 }) };
    expect(walkFrame(s, 1_400, 8)).toEqual({ moving: false, phase: 0 });
    expect(walkFrame(s, 5_000, 8)).toEqual({ moving: false, phase: 0 });
  });

  it('nunca devolve fase fora do vetor', () => {
    // No instante exato do fim, `floor(1 × 8)` daria 8 — e o vetor vai de 0 a 7.
    const s = { step: step([0, 0], [1, 0], { startedAtMs: 0, durationMs: 400 }) };
    for (let t = 0; t < 400; t += 7) {
      const { phase } = walkFrame(s, t, 8);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(8);
    }
  });

  it('um quadro só é sempre a fase 0, andando ou não', () => {
    const s = { step: step([0, 0], [1, 0], { startedAtMs: 0, durationMs: 400 }) };
    expect(walkFrame(s, 200, 1)).toEqual({ moving: true, phase: 0 });
  });

  it('passo no futuro — relógio do servidor à frente — é parado, não negativo', () => {
    const s = { step: step([0, 0], [1, 0], { startedAtMs: 2_000, durationMs: 400 }) };
    expect(walkFrame(s, 1_000, 8)).toEqual({ moving: false, phase: 0 });
  });
});
