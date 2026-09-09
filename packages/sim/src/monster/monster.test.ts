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
    // Dois, e não um: o cooldown começa pronto (FUN-25), então o instante zero e o instante
    // 2000 são os dois golpes que cabem na janela. A 10 Hz saem os mesmos dois.
    expect(decideMonsterAction(monster, prey('p', 1, 0), rat, 2_000, open))
      .toEqual({ kind: 'attack', targetId: 'p', times: 2 });
  });

  it('devolve TODOS os golpes que couberam, não um por chamada (FUN-67)', () => {
    // O acumulador debita as N aplicações; devolver uma faz as outras sumirem. Num tick de
    // 1 s — a taxa da hunt desanexada, que é o modo PADRÃO do jogo — um monstro de 500 ms
    // bateria metade das vezes de um anexado a 10 Hz.
    const monster = monsterAt(0, 0);
    const fast = { ...rat, attackIntervalMs: 500 };
    // Começa pronto, então 1000 ms de tick cabem: o pronto inicial mais dois intervalos.
    expect(decideMonsterAction(monster, prey('p', 1, 0), fast, 1_000, open))
      .toEqual({ kind: 'attack', targetId: 'p', times: 3 });
  });

  it('devolve TODOS os passos que couberam, um tile de cada vez (FUN-67)', () => {
    // Um por chamada faria o monstro andar mais devagar quanto mais lento o tick — e o
    // caminho é reavaliado tile a tile, senão ele atravessaria parede num salto.
    const monster = monsterAt(0, 0);
    const action = decideMonsterAction(monster, prey('p', 9, 0), rat, 1_000, open);
    expect(action).toEqual({ kind: 'step', path: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] });
  });

  it('para de andar ao encostar no alvo, em vez de passar por cima dele', () => {
    // A versão de um passo só nunca precisou disto — ela nunca dava o segundo.
    const monster = monsterAt(0, 0);
    const action = decideMonsterAction(monster, prey('p', 2, 0), rat, 10_000, open);
    expect(action).toEqual({ kind: 'step', path: [{ x: 1, y: 0 }] });
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
    //
    // Este teste JÁ EXISTIA e passava com o defeito da FUN-67 de pé, por duas razões que
    // valem mais que o teste: ele contava CHAMADAS que devolveram `attack` em vez de golpes,
    // e a fixture usava um intervalo de 2 s — mais longo que o tick lento de 1 s, então o
    // caso de duas aplicações num tick nunca acontecia. Um teste de equivalência de taxa
    // precisa de um intervalo MENOR que o tick mais lento, senão ele não mede nada.
    const attacks = (dtMs: number, ticks: number, definition = rat) => {
      const monster = monsterAt(0, 0);
      let count = 0;
      for (let i = 0; i < ticks; i++) {
        const action = decideMonsterAction(monster, prey('p', 1, 0), definition, dtMs, open);
        if (action.kind === 'attack') count += action.times;
      }
      return count;
    };
    expect(attacks(100, 600)).toBe(attacks(1_000, 60));
    const fast = { ...rat, attackIntervalMs: 500 };
    expect(attacks(100, 600, fast)).toBe(attacks(1_000, 60, fast));
    // E não é vácuo: com 500 ms de intervalo em sessenta segundos são cento e vinte golpes.
    expect(attacks(1_000, 60, fast)).toBe(121);
  });

  it('steps toward a target that is out of reach', () => {
    const monster = monsterAt(0, 0);
    expect(decideMonsterAction(monster, prey('p', 5, 0), rat, 500, open))
      .toEqual({ kind: 'step', path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] });
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
