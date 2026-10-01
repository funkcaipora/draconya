// A busca de caminho de menor custo (#599): cardinal 10, diagonal 35 — o A* do Canary
// (`AStarNodes::getMapWalkCost`: `MAP_NORMALWALKCOST` 10, `MAP_DIAGONALWALKCOST` 25). `boundedPath` (BFS) tem os testes de
// quem o usa (`walker.test.ts`, `monster.test.ts`).

import { describe, expect, it } from 'vitest';
import { cheapestPath } from './pathfind.js';

const open = (): boolean => false;
const at = (x: number, y: number) => (p: { x: number; y: number }): boolean => p.x === x && p.y === y;

describe('cheapestPath', () => {
  it('já no objetivo: caminho vazio', () => {
    expect(cheapestPath({ x: 2, y: 2 }, at(2, 2), open, 5)).toEqual([]);
  });

  it('em linha reta anda em linha reta, sem viés na diagonal (o BFS de custo igual andaria de viés)', () => {
    const path = cheapestPath({ x: 0, y: 0 }, at(4, 0), open, 8);
    expect(path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }]);
  });

  it('a diagonal custa 35 e dois cardeais custam 20: prefere os cardeais, mesmo sendo mais passos', () => {
    // (0,0) → (1,1): uma diagonal (35) ou dois cardeais (20). O de menor custo vence.
    expect(cheapestPath({ x: 0, y: 0 }, at(1, 1), open, 4)).toHaveLength(2);
    // (0,0) → (3,3): três diagonais custam 105 e seis cardeais custam 60 — os cardeais.
    expect(cheapestPath({ x: 0, y: 0 }, at(3, 3), open, 6)).toHaveLength(6);
  });

  it('contorna a parede e devolve o caminho inteiro sem o ponto de partida', () => {
    const wall = (x: number, y: number): boolean => x === 2 && y >= -1 && y <= 1;
    const path = cheapestPath({ x: 0, y: 0 }, at(4, 0), wall, 8);
    expect(path).not.toBeNull();
    expect(path?.[path.length - 1]).toEqual({ x: 4, y: 0 });
    for (const step of path ?? []) expect(wall(step.x, step.y)).toBe(false);
  });

  it('sem caminho dentro do raio: null', () => {
    const wall = (x: number): boolean => x === 2;
    expect(cheapestPath({ x: 0, y: 0 }, at(4, 0), wall, 8)).toBeNull();
    // Com caminho, mas além do raio: também null.
    expect(cheapestPath({ x: 0, y: 0 }, at(9, 0), open, 8)).toBeNull();
  });

  describe('com `fallback` (o "melhor até agora" de `FrozenPathingConditionCall`)', () => {
    // O objetivo é x = 4; o fallback é x = 1. Sem ele a busca ignora os tiles intermediários.
    it('o objetivo alcançável vence o fallback, mesmo achando o fallback antes', () => {
      const path = cheapestPath({ x: 0, y: 0 }, at(4, 0), open, 8, at(1, 0));
      expect(path?.[path.length - 1]).toEqual({ x: 4, y: 0 });
    });

    it('sem objetivo alcançável, devolve o caminho até o PRIMEIRO fallback encontrado', () => {
      const wall = (x: number): boolean => x === 3;
      expect(cheapestPath({ x: 0, y: 0 }, at(4, 0), wall, 8, at(1, 0))).toEqual([{ x: 1, y: 0 }]);
    });

    it('o ponto de partida que satisfaz o fallback é o resultado: caminho vazio', () => {
      const wall = (x: number): boolean => x === 3;
      expect(cheapestPath({ x: 1, y: 0 }, at(4, 0), wall, 8, at(1, 0))).toEqual([]);
    });

    it('nem objetivo nem fallback alcançáveis: null', () => {
      const wall = (x: number): boolean => x === 1;
      expect(cheapestPath({ x: 0, y: 0 }, at(4, 0), wall, 8, at(2, 0))).toBeNull();
    });
  });

  it('é determinístico: o mesmo problema devolve o mesmo caminho', () => {
    const goal = (p: { x: number; y: number }): boolean =>
      Math.max(Math.abs(p.x - 6), Math.abs(p.y)) <= 2 && p.x < 6;
    const first = cheapestPath({ x: 0, y: 0 }, goal, open, 12);
    expect(cheapestPath({ x: 0, y: 0 }, goal, open, 12)).toEqual(first);
    expect(first?.[0]).toEqual({ x: 1, y: 0 });
  });
});
