import { describe, expect, it } from 'vitest';
import { creatureTile, pickCreature } from './pick.js';
import type { Creature } from '../state/world.js';

// A escolha da criatura sob o cursor (AB-13, #428). PURO: a regra é testável sem Pixi e sem
// DOM, que é o motivo de ela não morar no laço de quadro.

function creature(id: number, over: Partial<Creature> = {}): Creature {
  return {
    id,
    appearanceId: 100,
    name: `criatura-${String(id)}`,
    health: 10,
    maxHealth: 10,
    position: { x: 0, y: 0, z: 7 },
    step: null,
    ...over,
  };
}

const tile = (x: number, y: number, z = 7) => ({ x, y, z });

describe('creatureTile', () => {
  it('parada devolve a posição arredondada', () => {
    const rat = creature(1, { position: { x: 5.4, y: 6.6, z: 7 } });
    expect(creatureTile(rat, 0)).toEqual(tile(5, 7));
  });

  it('no meio de um passo devolve a posição INTERPOLADA, não a de origem', () => {
    const rat = creature(1, {
      position: { x: 1, y: 1, z: 7 },
      step: {
        from: { x: 1, y: 1, z: 7 }, to: { x: 3, y: 1, z: 7 },
        startedAtMs: 0, durationMs: 1000, pushed: false,
      },
    });
    // Metade do passo: x=2 — o tile por onde ela está passando agora.
    expect(creatureTile(rat, 500)).toEqual(tile(2, 1));
    expect(creatureTile(rat, 0)).toEqual(tile(1, 1));
    expect(creatureTile(rat, 1000)).toEqual(tile(3, 1));
  });
});

describe('pickCreature', () => {
  it('tile sem criatura devolve null', () => {
    const rat = creature(1, { position: { x: 1, y: 1, z: 7 } });
    expect(pickCreature([rat], tile(9, 9), 0)).toBeNull();
  });

  it('criatura no tile devolve o id dela', () => {
    const rat = creature(7, { position: { x: 2, y: 3, z: 7 } });
    expect(pickCreature([rat], tile(2, 3), 0)).toBe(7);
  });

  it('não acerta criatura de outro andar', () => {
    const rat = creature(1, { position: { x: 2, y: 3, z: 7 } });
    expect(pickCreature([rat], tile(2, 3, 6), 0)).toBeNull();
  });

  it('duas criaturas no mesmo tile: vence a mais ao sul, a que cobre no canvas', () => {
    const north = creature(1, { position: { x: 5, y: 5.2, z: 7 } });
    const south = creature(2, { position: { x: 5, y: 5.4, z: 7 } });
    // As duas arredondam para (5,5); o desempate é pela posição fracionária.
    expect(pickCreature([north, south], tile(5, 5), 0)).toBe(2);
    expect(pickCreature([south, north], tile(5, 5), 0)).toBe(2);
  });

  it('acerta a criatura que ESTÁ no tile durante o passo, não a que saiu', () => {
    const moving = creature(1, {
      position: { x: 1, y: 1, z: 7 },
      step: {
        from: { x: 1, y: 1, z: 7 }, to: { x: 3, y: 1, z: 7 },
        startedAtMs: 0, durationMs: 1000, pushed: false,
      },
    });
    expect(pickCreature([moving], tile(1, 1), 0)).toBe(1);
    expect(pickCreature([moving], tile(2, 1), 500)).toBe(1);
    expect(pickCreature([moving], tile(2, 1), 0)).toBeNull();
  });
});
