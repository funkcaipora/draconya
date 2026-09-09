import { describe, expect, it } from 'vitest';
import { distance, greedyStep, isAdjacent } from './step.js';

/** Mapa de teste como grade de caracteres: `#` bloqueia. Mesmo formato do `content`. */
function grid(rows: readonly string[]) {
  return (x: number, y: number): boolean => {
    const row = rows[y];
    if (row === undefined) return true;
    return (row[x] ?? '#') === '#';
  };
}

const open = () => false;

describe('greedyStep', () => {
  it('takes the tile that closes the distance', () => {
    expect(greedyStep({ x: 0, y: 0 }, { x: 5, y: 0 }, open)).toEqual({ x: 1, y: 0 });
    expect(greedyStep({ x: 0, y: 0 }, { x: 5, y: 5 }, open)).toEqual({ x: 1, y: 1 });
  });

  it('waits when it is already there', () => {
    expect(greedyStep({ x: 3, y: 3 }, { x: 3, y: 3 }, open)).toBeNull();
  });

  it('goes around an obstacle by trying the neighbouring directions', () => {
    //  alvo em (2,1); a parede está exatamente no passo que mais aproxima.
    const blocked = grid([
      '.....',
      '.@#T.',
      '.....',
    ]);
    const step = greedyStep({ x: 1, y: 1 }, { x: 3, y: 1 }, blocked);
    // Contornou: foi na diagonal, não parou. QUAL das duas diagonais é escolha arbitrária —
    // horário primeiro —, e o valor está fixado aqui só para a escolha não mudar sem
    // alguém notar. Movimento errático é o que os jogadores percebem, não o sentido do desvio.
    expect(step).toEqual({ x: 2, y: 2 });
  });

  it('gets stuck in a concavity, and that is correct', () => {
    // Guloso EMPACA em concavidade. É o comportamento do Tibia, os jogadores reconhecem como
    // certo, e "consertar" com busca de caminho custaria o barateamento do magic wall.
    const blocked = grid([
      '#####',
      '#@#..',
      '###..',
    ]);
    expect(greedyStep({ x: 1, y: 1 }, { x: 4, y: 1 }, blocked)).toBeNull();
  });

  it('never stores a path, so a new wall costs nothing', () => {
    // O ponto do ADR 0009: pôr uma parede no caminho não invalida nada, porque não há nada
    // guardado para invalidar. O monstro só reavalia o próximo tile, como já faria.
    const from = { x: 1, y: 1 };
    const target = { x: 4, y: 1 };
    expect(greedyStep(from, target, grid(['.....', '.@...', '.....']))).toEqual({ x: 2, y: 1 });
    // Mesma chamada, mapa novo: a resposta muda na hora, sem custo de recálculo.
    expect(greedyStep(from, target, grid(['.....', '.@#..', '.....']))).toEqual({ x: 2, y: 2 });
  });

  it('is deterministic when both detours are open', () => {
    // Viés estável é preferível a um viés que depende de quantas vezes o monstro já tentou —
    // esse último produz movimento errático que ninguém consegue reproduzir.
    const blocked = grid(['.....', '.@#..', '.....']);
    const first = greedyStep({ x: 1, y: 1 }, { x: 3, y: 1 }, blocked);
    const second = greedyStep({ x: 1, y: 1 }, { x: 3, y: 1 }, blocked);
    expect(first).toEqual(second);
  });

  it('treats other creatures as walls, because the predicate does not care why', () => {
    const occupied = (x: number, y: number) => x === 2 && y === 1;
    expect(greedyStep({ x: 1, y: 1 }, { x: 3, y: 1 }, occupied)).toEqual({ x: 2, y: 2 });
  });
});

describe('distance', () => {
  it('counts a diagonal as one step', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
    expect(distance({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(4);
  });

  it('says adjacent for the eight neighbours and nothing else', () => {
    expect(isAdjacent({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
    expect(isAdjacent({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false);
    expect(isAdjacent({ x: 1, y: 1 }, { x: 3, y: 1 })).toBe(false);
  });
});
