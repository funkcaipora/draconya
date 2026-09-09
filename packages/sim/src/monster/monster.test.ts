import type { Monster } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { MonsterRuntime, chooseTarget, decideMonsterAction, type Prey } from './monster.js';

const rat: Monster = {
  id: 'rat', name: 'Rat', outfitId: 21, recommendedLevel: 1,
  health: 20, experience: 5, attack: 6, armor: 0,
  attackIntervalMs: 2_000, stepDurationMs: 500, aggroRadius: 4,
  attackRange: 1, leashRadius: 0, loot: [],
};

const monsterAt = (x: number, y: number, over: Record<string, unknown> = {}) =>
  new MonsterRuntime({
    id: 1, monsterId: 'rat', position: { x, y }, home: { x, y },
    health: 20, targetId: null, cooldowns: {}, ...over,
  });
const prey = (id: string, x: number, y: number, alive = true): Prey =>
  ({ id, position: { x, y }, alive });
const open = () => false;

describe('chooseTarget', () => {
  it('takes the closest inside the aggro radius', () => {
    const monster = monsterAt(0, 0);
    expect(chooseTarget(monster, [prey('far', 3, 0), prey('near', 1, 0)], rat)).toBe('near');
  });

  it('ignores anything outside the radius', () => {
    expect(chooseTarget(monsterAt(0, 0), [prey('p', 9, 0)], rat)).toBeNull();
  });

  it('ignores the dead', () => {
    expect(chooseTarget(monsterAt(0, 0), [prey('p', 1, 0, false)], rat)).toBeNull();
  });

  it('keeps its target instead of rescanning every tick', () => {
    // Numa instância com 48 monstros, procurar sempre é trabalho jogado fora dezenas de
    // vezes por segundo — e trocar de alvo porque outro jogador passou um tile mais perto
    // não é o comportamento que os jogadores esperam.
    const monster = monsterAt(0, 0, { targetId: 'first' });
    expect(chooseTarget(monster, [prey('first', 3, 0), prey('closer', 1, 0)], rat))
      .toBe('first');
  });

  it('drops a target that died', () => {
    const monster = monsterAt(0, 0, { targetId: 'gone' });
    expect(chooseTarget(monster, [prey('gone', 1, 0, false), prey('alive', 2, 0)], rat))
      .toBe('alive');
  });

  it('gives up only past the leash, and never when it is zero', () => {
    // Zero é "nunca desiste": um monstro que larga o alvo no meio de uma hunt AFK faria o
    // jogador voltar e encontrar tudo parado, sem explicação.
    const monster = monsterAt(0, 0, { targetId: 'runner' });
    expect(chooseTarget(monster, [prey('runner', 50, 0)], rat)).toBe('runner');

    const leashed = { ...rat, leashRadius: 5 };
    expect(chooseTarget(monster, [prey('runner', 50, 0)], leashed)).toBeNull();
  });
});

describe('decideMonsterAction', () => {
  it('attacks when the target is inside reach', () => {
    const monster = monsterAt(0, 0);
    expect(decideMonsterAction(monster, prey('p', 1, 0), rat, 2_000, open))
      .toEqual({ kind: 'attack', targetId: 'p' });
  });

  it('holds the attack until the interval has elapsed', () => {
    const monster = monsterAt(0, 0);
    decideMonsterAction(monster, prey('p', 1, 0), rat, 2_000, open);
    expect(decideMonsterAction(monster, prey('p', 1, 0), rat, 500, open).kind).toBe('idle');
    expect(decideMonsterAction(monster, prey('p', 1, 0), rat, 1_500, open).kind).toBe('attack');
  });

  it('deals the same damage per minute at 1 Hz and at 10 Hz', () => {
    // Invariante 2. É o que permite a hunt desanexada cair para 1 Hz sem render menos — e
    // sem render mais, que seria pior ainda.
    const attacks = (dtMs: number, ticks: number) => {
      const monster = monsterAt(0, 0);
      let count = 0;
      for (let i = 0; i < ticks; i++) {
        if (decideMonsterAction(monster, prey('p', 1, 0), rat, dtMs, open).kind === 'attack') {
          count += 1;
        }
      }
      return count;
    };
    expect(attacks(100, 600)).toBe(attacks(1_000, 60));
  });

  it('steps toward a target that is out of reach', () => {
    const monster = monsterAt(0, 0);
    expect(decideMonsterAction(monster, prey('p', 5, 0), rat, 500, open))
      .toEqual({ kind: 'step', to: { x: 1, y: 0 } });
  });

  it('waits, without erroring, when it is walled in', () => {
    // Guloso empaca em concavidade. É esperado.
    const monster = monsterAt(1, 1);
    const walls = (x: number, y: number) => !(x === 1 && y === 1);
    expect(decideMonsterAction(monster, prey('p', 5, 1), rat, 500, walls).kind).toBe('idle');
  });

  it('does nothing when dead or without a target', () => {
    expect(decideMonsterAction(monsterAt(0, 0), null, rat, 1_000, open).kind).toBe('idle');
    const dead = monsterAt(0, 0, { health: 0 });
    expect(decideMonsterAction(dead, prey('p', 1, 0), rat, 1_000, open).kind).toBe('idle');
  });
});

describe('MonsterRuntime', () => {
  it('never takes more damage than the health it has left', () => {
    const monster = monsterAt(0, 0);
    expect(monster.receiveDamage(50)).toBe(20);
    expect(monster.health).toBe(0);
    expect(monster.alive).toBe(false);
  });

  it('round-trips its state', () => {
    const monster = monsterAt(2, 3, { targetId: 'p1' });
    monster.receiveDamage(5);
    const restored = new MonsterRuntime(monster.getState());
    expect(restored.getState()).toEqual(monster.getState());
  });
});
