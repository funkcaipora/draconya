import { describe, expect, it } from 'vitest';
import {
  PUSH_DIRECTIONS, canSeePoint, danceStep, distance, fleeStep, greedyStep, isAdjacent, randomStep,
  shuffledCardinals, walkBackStep,
} from './step.js';
import { Rng } from '../rng.js';

/** Um `Rng` falso que devolve sempre o mesmo índice — só o suficiente para `danceStep`. */
function fixedPick(index: number) {
  return { integer: (_min: number, _max: number) => index };
}

/** Estoura se `integer` for chamado — prova que a lista vazia não consome sorteio. */
const explodingRng = {
  integer(): number {
    throw new Error('rng.integer não deveria ser chamado sem candidata');
  },
};

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

describe('fleeStep (FUN-85)', () => {
  const open = () => false;

  it('anda na direção OPOSTA à ameaça, incluindo diagonal', () => {
    // Espelhar a ameaça é o algoritmo inteiro: o guloso então mira o lado de lá e o resultado
    // é a direção contrária. Um segundo algoritmo de fuga seria a mesma regra em dois lugares.
    expect(fleeStep({ x: 5, y: 5 }, { x: 4, y: 5 }, open)).toEqual({ x: 6, y: 5 });
    expect(fleeStep({ x: 5, y: 5 }, { x: 5, y: 4 }, open)).toEqual({ x: 5, y: 6 });
    expect(fleeStep({ x: 5, y: 5 }, { x: 4, y: 4 }, open)).toEqual({ x: 6, y: 6 });
  });

  it('desvia pelos vizinhos quando a saída direta está bloqueada', () => {
    //     0 1 2 3 4
    //   0 . . . . .
    //   1 . a . # .
    //   2 . . . . .
    // A ameaça está em (1,1) e o personagem em (2,1): fugir seria para (3,1), que é parede.
    // O primeiro vizinho no sentido horário resolve, e é a mesma ordem fixa do guloso.
    const blocked = grid(['.....', '.a.#.', '.....']);
    expect(fleeStep({ x: 2, y: 1 }, { x: 1, y: 1 }, blocked)).toEqual({ x: 3, y: 2 });
  });

  it('encurralado devolve null, e ficar parado é o comportamento certo', () => {
    // Recuar até a parede e ficar lá não é um caso a consertar: é o que um personagem
    // acuado faz. `null` é o mesmo "espera" que o guloso já devolve ao empacar.
    const canto = grid(['###', '#a#', '###']);
    expect(fleeStep({ x: 1, y: 1 }, { x: 1, y: 0 }, canto)).toBeNull();
  });

  it('em cima da ameaça devolve null: não há direção oposta a lugar nenhum', () => {
    expect(fleeStep({ x: 2, y: 2 }, { x: 2, y: 2 }, open)).toBeNull();
  });
});

describe('danceStep', () => {
  it('só considera candidatas que preservam a MESMA distância Chebyshev ao alvo', () => {
    // Monstro colado (distância 1) diretamente ao SUL do alvo — as duas laterais (leste/oeste)
    // preservam a distância 1; norte cairia em cima do alvo (distância 0) e sul se afastaria
    // para distância 2, então as duas são descartadas pelo filtro de distância.
    const candidates = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const step = danceStep({ x: 5, y: 5 }, { x: 5, y: 4 }, open, fixedPick(i % 2));
      if (step !== null) candidates.add(`${step.x},${step.y}`);
      expect(distance(step ?? { x: 5, y: 5 }, { x: 5, y: 4 })).toBe(1);
    }
    expect(candidates).toEqual(new Set(['6,5', '4,5']));
  });

  it('nunca escolhe uma direção bloqueada', () => {
    const wallToTheEast = (x: number, y: number) => x === 6 && y === 5;
    const step = danceStep({ x: 5, y: 5 }, { x: 5, y: 4 }, wallToTheEast, fixedPick(0));
    expect(step).toEqual({ x: 4, y: 5 });
  });

  it('sorteia uniformemente entre as candidatas — mesmo índice, mesma escolha', () => {
    expect(danceStep({ x: 5, y: 5 }, { x: 5, y: 4 }, open, fixedPick(0))).toEqual({ x: 6, y: 5 });
    expect(danceStep({ x: 5, y: 5 }, { x: 5, y: 4 }, open, fixedPick(1))).toEqual({ x: 4, y: 5 });
  });

  it('mantém a distância de quem atira à distância (kiting) — só desliza no eixo livre', () => {
    // Monstro a 2 tiles do alvo, alinhado na mesma linha (targetDistance mantido por conteúdo).
    // As duas candidatas verticais preservam a distância 2 (o eixo x, mais distante, domina o
    // Chebyshev); o leste aproximaria para 1 e é descartado pelo filtro de distância.
    const step = danceStep({ x: 1, y: 1 }, { x: 3, y: 1 }, open, fixedPick(0));
    expect(step).toEqual({ x: 1, y: 0 });
    expect(distance(step ?? { x: 0, y: 0 }, { x: 3, y: 1 })).toBe(2);
  });

  it('sem candidata livre, devolve null sem consumir o sorteio', () => {
    const allBlocked = () => true;
    expect(danceStep({ x: 5, y: 5 }, { x: 5, y: 4 }, allBlocked, explodingRng)).toBeNull();
  });
});

describe('canSeePoint (#655, Canary `Creature::canSee`, `creature.cpp:68-87`)', () => {
  it('no MESMO andar é a distância de Chebyshev até o raio — 11 é o quadrado do Canary', () => {
    const from = { x: 50, y: 50, z: 7 };
    expect(canSeePoint(from, { x: 61, y: 39, z: 7 }, 11)).toBe(true);
    expect(canSeePoint(from, { x: 62, y: 50, z: 7 }, 11)).toBe(false);
    expect(canSeePoint(from, { x: 50, y: 61, z: 7 }, 11)).toBe(true);
    expect(canSeePoint(from, { x: 50, y: 38, z: 7 }, 11)).toBe(false);
  });

  it('sem `z` de um dos lados é só a distância — snapshot anterior ao #519 e hunt de andar único', () => {
    expect(canSeePoint({ x: 0, y: 0 }, { x: 11, y: 11, z: 7 }, 11)).toBe(true);
    expect(canSeePoint({ x: 0, y: 0, z: 7 }, { x: 12, y: 0 }, 11)).toBe(false);
    expect(canSeePoint({ x: 0, y: 0 }, { x: 3, y: 3 }, 11)).toBe(true);
  });

  it('de superfície (z <= 7) não se enxerga o subsolo, e do subsolo só até dois andares', () => {
    // Superfície olhando para baixo: recusa, mesmo colado em (x, y).
    expect(canSeePoint({ x: 10, y: 10, z: 7 }, { x: 10, y: 10, z: 8 }, 11)).toBe(false);
    // Subsolo (z >= 8): até dois andares de diferença.
    expect(canSeePoint({ x: 10, y: 10, z: 10 }, { x: 10, y: 10, z: 12 }, 11)).toBe(true);
    expect(canSeePoint({ x: 10, y: 10, z: 10 }, { x: 10, y: 10, z: 13 }, 11)).toBe(false);
    expect(canSeePoint({ x: 10, y: 10, z: 12 }, { x: 10, y: 10, z: 10 }, 11)).toBe(true);
  });

  it('a caixa se desloca em (from.z - to.z) tiles por andar — a perspectiva do cliente', () => {
    // Um andar ABAIXO (to.z = from.z + 1): offsetZ = -1, então o quadrado desliza 1 tile para
    // oeste/norte. O canto leste de mesma distância que era visível no andar de cima cai fora.
    const from = { x: 50, y: 50, z: 10 };
    expect(canSeePoint(from, { x: 60, y: 50, z: 11 }, 11)).toBe(true);
    expect(canSeePoint(from, { x: 61, y: 50, z: 11 }, 11)).toBe(false);
    expect(canSeePoint(from, { x: 38, y: 50, z: 11 }, 11)).toBe(true);
    expect(canSeePoint(from, { x: 37, y: 50, z: 11 }, 11)).toBe(false);
    expect(canSeePoint(from, { x: 38, y: 38, z: 11 }, 11)).toBe(true);
    expect(canSeePoint(from, { x: 38, y: 37, z: 11 }, 11)).toBe(false);
    // Um andar ACIMA (offsetZ = +1): desliza para leste/sul.
    expect(canSeePoint(from, { x: 62, y: 50, z: 9 }, 11)).toBe(true);
    expect(canSeePoint(from, { x: 63, y: 50, z: 9 }, 11)).toBe(false);
    expect(canSeePoint(from, { x: 39, y: 50, z: 9 }, 11)).toBe(false);
  });
});

describe('shuffledCardinals / randomStep (#655, Canary `Monster::getRandomStep`)', () => {
  it('é uma permutação das quatro direções cardinais — nunca diagonal, nunca repetida', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const order = shuffledCardinals(Rng.fromSeed(seed));
      expect(order).toHaveLength(4);
      expect(new Set(order.map((d) => `${d.x},${d.y}`)))
        .toEqual(new Set(PUSH_DIRECTIONS.map((d) => `${d.x},${d.y}`)));
      expect(order.every((d) => Math.abs(d.x) + Math.abs(d.y) === 1)).toBe(true);
    }
  });

  it('consome SEMPRE três sorteios — o Fisher-Yates completo, com tile livre ou não', () => {
    const calls: Array<[number, number]> = [];
    const spy = { integer: (min: number, max: number) => { calls.push([min, max]); return min; } };
    shuffledCardinals(spy);
    expect(calls).toEqual([[0, 3], [0, 2], [0, 1]]);

    calls.length = 0;
    expect(randomStep({ x: 5, y: 5 }, () => true, spy)).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it('a primeira direção LIVRE da ordem embaralhada — uniforme entre as livres', () => {
    // Só o leste e o sul estão livres: o passo é sempre um dos dois, e com sementes suficientes
    // os dois aparecem (não é sempre o mesmo por acidente de implementação).
    const blockedExceptEastAndSouth = (x: number, y: number) => !((x === 6 && y === 5) || (x === 5 && y === 6));
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const step = randomStep({ x: 5, y: 5 }, blockedExceptEastAndSouth, Rng.fromSeed(`s${String(i)}`));
      expect(step).not.toBeNull();
      seen.add(`${String(step?.x)},${String(step?.y)}`);
    }
    expect(seen).toEqual(new Set(['6,5', '5,6']));
  });

  it('cercado, devolve null — o monstro fica onde está', () => {
    expect(randomStep({ x: 5, y: 5 }, () => true, Rng.fromSeed('x'))).toBeNull();
  });

  it('é reproduzível: a mesma semente dá o mesmo passo', () => {
    expect(randomStep({ x: 5, y: 5 }, open, Rng.fromSeed('same')))
      .toEqual(randomStep({ x: 5, y: 5 }, open, Rng.fromSeed('same')));
  });

  it('nunca escolhe um tile bloqueado', () => {
    for (let i = 0; i < 40; i++) {
      const step = randomStep({ x: 5, y: 5 }, (x, y) => x === 5 && y === 4, Rng.fromSeed(`b${String(i)}`));
      expect(step).not.toEqual({ x: 5, y: 4 });
    }
  });
});

describe('walkBackStep (#655, Canary `Monster::doWalkBack`)', () => {
  it('anda pelo passo guloso rumo ao home', () => {
    expect(walkBackStep({ x: 0, y: 0 }, { x: 5, y: 0 }, open)).toEqual({ x: 1, y: 0 });
    expect(walkBackStep({ x: 0, y: 0 }, { x: 5, y: 5 }, open)).toEqual({ x: 1, y: 1 });
  });

  it('no home devolve null — chegou', () => {
    expect(walkBackStep({ x: 3, y: 3 }, { x: 3, y: 3 }, open)).toBeNull();
  });

  it('a um tile do home só pisa NELE, e não rodeia: home ocupado é esperar ao lado', () => {
    // O guloso puro tentaria os dois vizinhos da direção, que a um tile de distância não
    // aproximam — só rodeiam. Um home ocupado por outro monstro faria quem volta girar em volta
    // dele para sempre; o Canary nem chega a andar (não há caminho até o tile exato).
    const homeOccupied = (x: number, y: number) => x === 4 && y === 3;
    expect(walkBackStep({ x: 3, y: 3 }, { x: 4, y: 3 }, homeOccupied)).toBeNull();
    expect(walkBackStep({ x: 3, y: 3 }, { x: 4, y: 3 }, open)).toEqual({ x: 4, y: 3 });
    // Na diagonal também: o passo diagonal para o home vale.
    expect(walkBackStep({ x: 3, y: 2 }, { x: 4, y: 3 }, open)).toEqual({ x: 4, y: 3 });
  });

  it('contorna um obstáculo longe do home, como o guloso', () => {
    const wall = (x: number, y: number) => x === 1 && y === 0;
    expect(walkBackStep({ x: 0, y: 0 }, { x: 5, y: 0 }, wall)).toEqual({ x: 1, y: 1 });
  });
});
