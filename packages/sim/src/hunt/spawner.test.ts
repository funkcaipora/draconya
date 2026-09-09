import type { HuntDifficulty, Point } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { Spawner, pickByWeight, tilesAround } from './spawner.js';

const beginner: HuntDifficulty = {
  perSpawnPoint: 2,
  composition: [{ monsterId: 'rat', weight: 1 }],
  respawnDelayMs: 30_000,
};
const points: Point[] = [{ x: 5, y: 5, z: 7 }, { x: 15, y: 5, z: 7 }];
const positionOf = (i: number) => points[i] as Point;
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

describe('Spawner', () => {
  it('creates exactly the density the difficulty says, never a random one', () => {
    // §14.5: sem variação aleatória de densidade no MVP. Densidade é DADO.
    const spawner = new Spawner(points.length, beginner);
    const requests = spawner.due(0, beginner, positionOf, open, Rng.fromSeed('a'));
    expect(requests).toHaveLength(points.length * beginner.perSpawnPoint);
  });

  it('puts the same monster in the same tile every time', () => {
    // Uma hunt cujo spawn "anda" a cada respawn é uma hunt que o jogador não consegue
    // planejar — e planejar é o que o §17.1 vende ao tornar o monstro previsível.
    const first = new Spawner(points.length, beginner)
      .due(0, beginner, positionOf, open, Rng.fromSeed('a'))
      .map((r) => r.position);
    const second = new Spawner(points.length, beginner)
      .due(0, beginner, positionOf, open, Rng.fromSeed('b'))
      .map((r) => r.position);
    // Semente diferente, mesmas posições: a posição não sorteia.
    expect(second).toEqual(first);
  });

  it('never stacks two monsters on the same tile', () => {
    const spawner = new Spawner(points.length, { ...beginner, perSpawnPoint: 5 });
    const requests = spawner.due(0, { ...beginner, perSpawnPoint: 5 }, positionOf, open,
      Rng.fromSeed('a'));
    const tiles = requests.map((r) => `${r.position.x},${r.position.y}`);
    expect(new Set(tiles).size).toBe(tiles.length);
  });

  it('waits the configured delay before respawning', () => {
    // Instantâneo faria a rota deixar de importar — o personagem mataria tudo parado num
    // ponto só. Longo demais faz ele dar voltas em mapa vazio.
    const spawner = new Spawner(1, beginner);
    const [first] = spawner.due(0, beginner, positionOf, open, Rng.fromSeed('a'));
    if (first === undefined) throw new Error('esperava um pedido de spawn');
    spawner.occupy(first.slot, 101);

    spawner.release(101, 1_000, beginner);
    expect(spawner.due(1_000, beginner, positionOf, open, Rng.fromSeed('a'))).toHaveLength(1);

    const spawner2 = new Spawner(1, beginner);
    const [only] = spawner2.due(0, beginner, positionOf, open, Rng.fromSeed('a'));
    if (only === undefined) throw new Error('esperava um pedido de spawn');
    spawner2.occupy(only.slot, 202);
    spawner2.occupy(spawner2.slots.findIndex((s) => s.occupantId === null), 203);
    spawner2.release(202, 1_000, beginner);
    // Ainda no prazo: não volta.
    expect(spawner2.due(1_000 + 29_000, beginner, positionOf, open, Rng.fromSeed('a')))
      .toHaveLength(0);
    // Prazo cumprido: volta.
    expect(spawner2.due(1_000 + 30_000, beginner, positionOf, open, Rng.fromSeed('a')))
      .toHaveLength(1);
  });

  it('changing the difficulty changes density and composition, with no code touched', () => {
    // O teste que define a issue: as outras três dificuldades são DADOS. Se exigissem
    // código, o formato estaria errado.
    const legendary: HuntDifficulty = {
      perSpawnPoint: 12,
      composition: [{ monsterId: 'cave-rat', weight: 1 }],
      respawnDelayMs: 10_000,
    };
    const requests = new Spawner(points.length, legendary)
      .due(0, legendary, positionOf, open, Rng.fromSeed('a'));
    expect(requests).toHaveLength(points.length * 12);
    expect(requests.every((r) => r.monsterId === 'cave-rat')).toBe(true);
  });

  it('skips a blocked spot instead of spawning inside a wall', () => {
    const walls = (x: number) => x < 10;
    const spawner = new Spawner(points.length, beginner);
    const requests = spawner.due(0, beginner, positionOf, walls, Rng.fromSeed('a'));
    // Só o segundo ponto tem espaço.
    expect(requests.every((r) => r.position.x >= 10)).toBe(true);
    expect(requests).toHaveLength(beginner.perSpawnPoint);
  });

  it('round-trips its state, so a resumed session keeps its respawn timers', () => {
    const spawner = new Spawner(1, beginner);
    // Ocupa TODOS os lugares: um lugar nunca preenchido também está "vencido", e deixá-lo
    // vazio esconderia o que este teste quer ver, que é o prazo de respawn.
    for (const [i, request] of spawner
      .due(0, beginner, positionOf, open, Rng.fromSeed('a')).entries()) {
      spawner.occupy(request.slot, 7 + i);
    }
    spawner.release(7, 5_000, beginner);

    const restored = new Spawner(1, beginner, spawner.getState());
    expect(restored.getState()).toEqual(spawner.getState());
    expect(restored.due(5_000, beginner, positionOf, open, Rng.fromSeed('a'))).toHaveLength(0);
    // E o prazo continua valendo depois da retomada.
    expect(restored.due(35_000, beginner, positionOf, open, Rng.fromSeed('a')))
      .toHaveLength(1);
  });
});

describe('tilesAround', () => {
  it('walks outward from the centre, in a fixed order', () => {
    // Ordem fixa é o que torna a posição reproduzível: sem isso, dois servidores com o mesmo
    // snapshot desenhariam mapas diferentes.
    const tiles = [...tilesAround({ x: 0, y: 0, z: 7 }, 1)];
    expect(tiles[0]).toEqual({ x: 0, y: 0, z: 7 });
    expect(tiles).toHaveLength(9);
    expect([...tilesAround({ x: 0, y: 0, z: 7 }, 1)]).toEqual(tiles);
  });
});
