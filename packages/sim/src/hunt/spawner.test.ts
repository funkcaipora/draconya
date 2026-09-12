import type { HuntDifficulty, Point } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { Spawner, pickByWeight } from './spawner.js';

const cautious: HuntDifficulty = {
  monsterCount: 4,
  composition: [{ monsterId: 'rat', weight: 1 }],
  respawnDelayMs: 30_000,
};
const points: Point[] = [{ x: 5, y: 5, z: 7 }, { x: 15, y: 5, z: 7 }];
const positionOf = (i: number) => ({ at: points[i] as Point, radius: 3 });
const open = () => false;

describe('pickByWeight', () => {
  it('respects the weights', () => {
    const composition = [
      { monsterId: 'rat', weight: 9 },
      { monsterId: 'cave-rat', weight: 1 },
    ];
    const rng = Rng.fromSeed('spawn');
    const draws = Array.from({ length: 2_000 }, () => pickByWeight(composition, rng));
    const rats = draws.filter((d) => d === 'rat').length;
    // Nove para um, com folga generosa: o teste checa o peso, não a qualidade do gerador.
    expect(rats).toBeGreaterThan(1_600);
    expect(rats).toBeLessThan(1_960);
  });

  it('treats zero weight as switched off, without deleting the line', () => {
    // Peso zero é como se desliga uma variante sem apagar a linha — e apagar linha é como se
    // perde o histórico de balanceamento.
    const composition = [
      { monsterId: 'rat', weight: 1 },
      { monsterId: 'boss', weight: 0 },
    ];
    const rng = Rng.fromSeed('x');
    const draws = Array.from({ length: 200 }, () => pickByWeight(composition, rng));
    expect(draws.every((d) => d === 'rat')).toBe(true);
  });

  it('gives nothing when every weight is zero', () => {
    expect(pickByWeight([{ monsterId: 'rat', weight: 0 }], Rng.fromSeed('x'))).toBeNull();
  });
});

/**
 * Preenche todos os lugares vagos, como o ruleset faz quando cada evento de spawn vence.
 *
 * A ocupação do tile fica com quem chama desde a FUN-68 — o spawner deixou de carregar um
 * conjunto de tiles já tomados, porque o `#occupied` do ruleset já é essa informação, e duas
 * cópias dela divergiriam.
 */
function fillAll(
  spawner: Spawner,
  difficulty: HuntDifficulty,
  blocked: (x: number, y: number) => boolean = open,
  seed = 'a',
) {
  const rng = Rng.fromSeed(seed);
  const taken = new Set<string>();
  const withTaken = (x: number, y: number) => blocked(x, y) || taken.has(`${x},${y}`);
  const filled = [];
  for (let slot = 0; slot < spawner.slots.length; slot++) {
    const request = spawner.fill(slot, difficulty, positionOf, withTaken, rng);
    if (request === null) continue;
    taken.add(`${request.position.x},${request.position.y}`);
    filled.push(request);
  }
  return filled;
}

describe('Spawner', () => {
  it('creates exactly the density the difficulty says, never a random one', () => {
    // §14.5: sem variação aleatória de densidade no MVP. Densidade é DADO.
    const spawner = new Spawner(points.length, cautious);
    expect(spawner.slots).toHaveLength(cautious.monsterCount);
    expect(fillAll(spawner, cautious)).toHaveLength(cautious.monsterCount);
  });

  it('spreads the total over the whole loop, evenly, and never piles it on the first points (FUN-123)', () => {
    // Com 3 monstros em 14 pontos, o rodízio `i % pontos` deixava 11 pontos sem nada e os três
    // amontoados no começo do laço; espalhados, cobrem o laço inteiro em intervalos iguais.
    const three = { ...cautious, monsterCount: 3 };
    expect(new Spawner(14, three).slots.map((s) => s.pointIndex)).toEqual([0, 4, 9]);
    const eight = { ...cautious, monsterCount: 8 };
    expect(new Spawner(14, eight).slots.map((s) => s.pointIndex)).toEqual([0, 1, 3, 5, 7, 8, 10, 12]);
    // Mais monstros que pontos: a mesma quantidade em cada um.
    expect(new Spawner(2, { ...cautious, monsterCount: 6 }).slots.map((s) => s.pointIndex)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(new Spawner(0, cautious).slots).toEqual([]);
  });

  it('searches a free tile up to the radius of the POINT, not a constant (FUN-123)', () => {
    // A rota autora o raio; um raio 0 é "neste tile ou nada".
    const tight = (i: number) => ({ at: points[i] as Point, radius: 0 });
    const spawner = new Spawner(points.length, cautious);
    const onCenter = spawner.fill(0, cautious, tight, open, Rng.fromSeed('a'));
    expect(onCenter?.position).toEqual(points[0]);
    const centerTaken = (x: number, y: number) => x === 5 && y === 5;
    expect(spawner.fill(0, cautious, tight, centerTaken, Rng.fromSeed('a'))).toBeNull();
  });

  it('puts the same monster in the same tile every time', () => {
    // Uma hunt cujo spawn "anda" a cada respawn é uma hunt que o jogador não consegue
    // planejar — e planejar é o que o §17.1 vende ao tornar o monstro previsível.
    const first = fillAll(new Spawner(points.length, cautious), cautious, open, 'a')
      .map((r) => r.position);
    const second = fillAll(new Spawner(points.length, cautious), cautious, open, 'b')
      .map((r) => r.position);
    // Semente diferente, mesmas posições: a posição não sorteia.
    expect(second).toEqual(first);
  });

  it('never stacks two monsters on the same tile', () => {
    const dense = { ...cautious, monsterCount: 10 };
    const tiles = fillAll(new Spawner(points.length, dense), dense)
      .map((r) => `${r.position.x},${r.position.y}`);
    expect(tiles.length).toBeGreaterThan(0);
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it('gives nothing for a slot that is already occupied', () => {
    // O lugar volta a render monstro quando `release` o devolve, e não antes. Quem marca a
    // hora do respawn é o evento agendado por quem chamou `release` (FUN-68).
    const spawner = new Spawner(1, cautious);
    const [first] = fillAll(spawner, cautious);
    if (first === undefined) throw new Error('esperava um pedido de spawn');
    spawner.occupy(first.slot, 101);

    expect(spawner.fill(first.slot, cautious, positionOf, open, Rng.fromSeed('a'))).toBeNull();
    expect(spawner.release(101)).toBe(first.slot);
    expect(spawner.fill(first.slot, cautious, positionOf, open, Rng.fromSeed('a'))).not.toBeNull();
  });

  it('carries no clock of its own', () => {
    // O `respawnAtMs` saiu do estado na FUN-68. Guardar o instante aqui e na fila de eventos
    // seria duas verdades sobre a mesma coisa, e a errada só apareceria numa retomada.
    const spawner = new Spawner(1, cautious);
    for (const slot of spawner.slots) {
      expect(Object.keys(slot).sort()).toEqual(['occupantId', 'pointIndex']);
    }
  });

  it('release tells which slot came back, and nothing for an unknown occupant', () => {
    const spawner = new Spawner(1, cautious);
    const [first] = fillAll(spawner, cautious);
    if (first === undefined) throw new Error('esperava um pedido de spawn');
    spawner.occupy(first.slot, 55);
    expect(spawner.release(999)).toBeNull();
    expect(spawner.release(55)).toBe(first.slot);
  });

  it('changing the difficulty changes density and composition, with no code touched', () => {
    // O teste que define a issue: as outras três dificuldades são DADOS. Se exigissem
    // código, o formato estaria errado.
    const legendary: HuntDifficulty = {
      monsterCount: 24,
      composition: [{ monsterId: 'cave-rat', weight: 1 }],
      respawnDelayMs: 10_000,
    };
    const requests = fillAll(new Spawner(points.length, legendary), legendary);
    expect(requests).toHaveLength(24);
    expect(requests.every((r) => r.monsterId === 'cave-rat')).toBe(true);
  });

  it('skips a blocked spot instead of spawning inside a wall', () => {
    const walls = (x: number) => x < 10;
    const requests = fillAll(new Spawner(points.length, cautious), cautious, walls);
    // Só o segundo ponto tem espaço — e o rodízio pôs metade dos lugares nele.
    expect(requests.every((r) => r.position.x >= 10)).toBe(true);
    expect(requests).toHaveLength(cautious.monsterCount / points.length);
  });

  it('round-trips its state, so a resumed session keeps who is alive where', () => {
    const spawner = new Spawner(1, cautious);
    for (const [i, request] of fillAll(spawner, cautious).entries()) {
      spawner.occupy(request.slot, 7 + i);
    }
    spawner.release(7);

    const restored = new Spawner(1, cautious, spawner.getState());
    expect(restored.getState()).toEqual(spawner.getState());
    // O lugar devolvido continua vago do outro lado da retomada, e os ocupados continuam
    // ocupados: é o que impede a sessão retomada de duplicar os monstros que já existem.
    expect(restored.slots.filter((s) => s.occupantId === null)).toHaveLength(1);
  });
});
