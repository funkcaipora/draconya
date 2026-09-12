import { buildTilemap } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from '../character.js';
import { Rng } from '../rng.js';
import { Session } from '../session.js';
import { createCityRuleset } from './city.js';

// O templo: duas salas separadas por uma parede, ligadas por um corredor que dá a volta por
// baixo. A entrada E é na sala da esquerda; a da direita está a dois tiles em linha reta — e a
// doze a pé. É o mapa de `placeReachable` em `movement.test.ts`, visto pela Cidade.
//
//     0 1 2 3 4 5 6
//   0 # # # # # # #
//   1 # . . # . . #
//   2 # . E # . . #
//   3 # . . # . . #
//   4 # . # # # . #
//   5 # . . . . . #
//   6 # # # # # # #
const temple = buildTilemap({
  id: 'templo', z: 7, entryPoint: { x: 2, y: 2, z: 7 },
  grid: ['#######', '#..#..#', '#..#..#', '#..#..#', '#.###.#', '#.....#', '#######'],
});

const citizen = (id: string): CharacterRuntime => new CharacterRuntime({
  id, position: { x: -1, y: -1, z: 0 },
  health: 150, maxHealth: 150, mana: 0, maxMana: 0,
  level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
});

describe('chegar na Cidade (FUN-120)', () => {
  const arrive = (count: number) => {
    const session = new Session({
      id: 'thais', contentVersion: 'v1', ruleset: createCityRuleset({ map: temple, stepDurationMs: 150 }),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    const people: CharacterRuntime[] = [];
    for (let i = 0; i < count; i++) {
      const person = citizen(`p${i}`);
      session.enter(person);
      people.push(person);
    }
    return { session, people };
  };

  it('o primeiro entra no ponto de entrada', () => {
    const { people } = arrive(1);
    expect(people[0]?.position).toEqual({ x: 2, y: 2, z: 7 });
  });

  it('com o templo lotado, o próximo fica no primeiro tile livre A PÉ — dentro do prédio, nunca do outro lado da parede', () => {
    // Seis tiles na sala da esquerda, seis pessoas: o sétimo não cabe nela. O anel geométrico
    // de antes o poria em (4,1), na sala da direita, atravessando a parede; a pé, o primeiro
    // livre é a boca do corredor.
    const { people } = arrive(7);
    const inLeftRoom = (p: CharacterRuntime) => p.position.x <= 2 && p.position.y <= 3;
    expect(people.slice(0, 6).every(inLeftRoom)).toBe(true);
    expect(people[6]?.position).toEqual({ x: 1, y: 4, z: 7 });
  });

  it('a posição que o personagem traz de outro mapa não ocupa tile nenhum da Cidade', () => {
    // O `Session.enter` já o pôs em `participants` quando o `onEnter` roda, com a posição da
    // sessão anterior. Contá-la na ocupação marcava um tile da praça por ninguém — e quando
    // ela caía no ponto de entrada, o primeiro a chegar numa praça VAZIA era desviado.
    const session = new Session({
      id: 'thais', contentVersion: 'v1', ruleset: createCityRuleset({ map: temple, stepDurationMs: 150 }),
      rng: Rng.fromSeed('c'), createdAtMs: 0,
    });
    const person = citizen('p0');
    person.position = { x: 2, y: 2, z: 7 };
    session.enter(person);
    expect(person.position).toEqual({ x: 2, y: 2, z: 7 });
  });

  it('a Cidade diz qual mapa desenhar', () => {
    expect(createCityRuleset({ map: temple }).mapId).toBe('templo');
    expect(createCityRuleset().mapId).toBeUndefined();
  });
});
