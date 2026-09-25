import { compileMonster, monsterSchema } from '@draconya/content';
import type { Monster } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import {
  MonsterRuntime, chooseTarget, decideMonsterAction, isMonsterFleeing, type Prey,
} from './monster.js';

const rat: Monster = {
  ...compileMonster(monsterSchema.parse({
    id: 'rat', name: 'Rat', recommendedLevel: 1,
    health: 20, experience: 5, attack: 6, armor: 0,
    attackIntervalMs: 2_000, speed: 300, aggroRadius: 4,
  })),
  outfitId: 21,
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
    // Uma ação, sem quantidade: quem sabe quantas vezes o ataque vence numa janela é a fila
    // de eventos (FUN-68). Aqui a pergunta é só "deste tile, o que dá para fazer".
    expect(decideMonsterAction(monsterAt(0, 0), prey('p', 1, 0), rat, open))
      .toEqual({ kind: 'attack', targetId: 'p' });
  });

  it('steps ONE tile toward a target that is out of reach', () => {
    // Um tile por decisão. A versão anterior devolvia o caminho inteiro que coubesse no tick,
    // e era de lá que vinha a divergência de dano entre 1 Hz e 10 Hz: o monstro atravessava
    // vários tiles de uma vez e a adjacência era conferida uma vez só, no fim (FUN-68).
    expect(decideMonsterAction(monsterAt(0, 0), prey('p', 5, 0), rat, open))
      .toEqual({ kind: 'step', to: { x: 1, y: 0 } });
  });

  it('prefers to strike over stepping when it is already in reach', () => {
    // A decisão é uma só, e é ela que os dois eventos — passo e ataque — consultam. Dois
    // lugares decidindo alcance divergiriam na terceira mudança.
    expect(decideMonsterAction(monsterAt(0, 0), prey('p', 1, 0), rat, open).kind).toBe('attack');
    expect(decideMonsterAction(monsterAt(0, 0), prey('p', 2, 0), rat, open).kind).toBe('step');
  });

  it('carries no quantity, so the FUN-67 defect cannot be written', () => {
    // A FUN-67 foi um defeito de quantidade: o acumulador concedia N aplicações e o chamador
    // aplicava uma, jogando o resto fora — a hunt desanexada sofria metade do dano devido.
    // Sem `times` e sem `path` no tipo, não há resto para esquecer.
    const attack = decideMonsterAction(monsterAt(0, 0), prey('p', 1, 0), rat, open);
    const step = decideMonsterAction(monsterAt(0, 0), prey('p', 5, 0), rat, open);
    expect(Object.keys(attack).sort()).toEqual(['kind', 'targetId']);
    expect(Object.keys(step).sort()).toEqual(['kind', 'to']);
  });

  it('decides the same thing however often it is asked', () => {
    // Sem acumulador, a decisão passou a ser pura: não há estado de tempo dentro dela, então
    // perguntar dez vezes do mesmo tile dá dez vezes a mesma resposta. É o que permite os
    // eventos de passo e de ataque consultarem a mesma função sem um consumir o outro.
    const monster = monsterAt(0, 0);
    const answers = Array.from({ length: 10 }, () =>
      decideMonsterAction(monster, prey('p', 1, 0), rat, open));
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it('waits, without erroring, when it is walled in', () => {
    // Guloso empaca em concavidade. É esperado.
    const monster = monsterAt(1, 1);
    const walls = (x: number, y: number) => !(x === 1 && y === 1);
    expect(decideMonsterAction(monster, prey('p', 5, 1), rat, walls).kind).toBe('idle');
  });

  it('does nothing when dead or without a target', () => {
    expect(decideMonsterAction(monsterAt(0, 0), null, rat, open).kind).toBe('idle');
    const dead = monsterAt(0, 0, { health: 0 });
    expect(decideMonsterAction(dead, prey('p', 1, 0), rat, open).kind).toBe('idle');
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

  it('round-trips scheduledDefenses (#518), like scheduledAbilities', () => {
    const monster = monsterAt(0, 0);
    monster.scheduledDefenses.add('self-heal');
    const restored = new MonsterRuntime(monster.getState());
    expect(restored.scheduledDefenses.has('self-heal')).toBe(true);
  });

  it('heals up to the max, never past it (#518)', () => {
    const monster = monsterAt(0, 0);
    monster.receiveDamage(15);
    expect(monster.health).toBe(5);
    expect(monster.heal(20, 100)).toBe(15);
    expect(monster.health).toBe(20);
  });

  it('reports zero healed at full health, so callers can skip the event', () => {
    const monster = monsterAt(0, 0);
    expect(monster.heal(20, 10)).toBe(0);
    expect(monster.health).toBe(20);
  });
});

describe('isMonsterFleeing (#518)', () => {
  const runsAt300 = { ...rat, runOnHealth: 300 };

  it('is false without `runOnHealth` declared, however low the HP', () => {
    const monster = monsterAt(0, 0, { health: 1 });
    expect(isMonsterFleeing(monster, rat)).toBe(false);
  });

  it('is true at or below the threshold, false above it', () => {
    expect(isMonsterFleeing(monsterAt(0, 0, { health: 300 }), runsAt300)).toBe(true);
    expect(isMonsterFleeing(monsterAt(0, 0, { health: 299 }), runsAt300)).toBe(true);
    expect(isMonsterFleeing(monsterAt(0, 0, { health: 301 }), runsAt300)).toBe(false);
  });

  it('is false for the dead — a corpse does not flee', () => {
    expect(isMonsterFleeing(monsterAt(0, 0, { health: 0 }), runsAt300)).toBe(false);
  });
});

describe('decideMonsterAction fleeing (#518)', () => {
  const runsAt300 = { ...rat, runOnHealth: 300 };

  it('steps AWAY from the target instead of attacking, even well inside reach', () => {
    const monster = monsterAt(5, 5, { health: 300 });
    const action = decideMonsterAction(monster, prey('p', 6, 5), runsAt300, open);
    expect(action).toEqual({ kind: 'step', to: { x: 4, y: 5 } });
  });

  it('steps away instead of approaching when the target is far', () => {
    const monster = monsterAt(5, 5, { health: 300 });
    const action = decideMonsterAction(monster, prey('p', 9, 5), runsAt300, open);
    expect(action).toEqual({ kind: 'step', to: { x: 4, y: 5 } });
  });

  it('stands its ground when cornered — a wall to consult, not a bug', () => {
    const monster = monsterAt(0, 0, { health: 300 });
    // Encurralado no canto (0,0): fugir de um alvo a leste (1,0) empurraria para x=-1, fora
    // do mapa nesta grade de teste.
    const corner = (x: number, y: number) => x < 0 || y < 0;
    expect(decideMonsterAction(monster, prey('p', 1, 0), runsAt300, corner).kind).toBe('idle');
  });

  it('does not flee above the threshold — attacks as usual', () => {
    const monster = monsterAt(0, 0, { health: 301 });
    expect(decideMonsterAction(monster, prey('p', 1, 0), runsAt300, open))
      .toEqual({ kind: 'attack', targetId: 'p' });
  });
});
