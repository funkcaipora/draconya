import { compileMonster, monsterSchema } from '@draconya/content';
import type { Monster } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
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
/**
 * `health` é usado só pela estratégia ponderada (#541); `rat` não a declara, então nenhum
 * teste deste describe lê o valor — o default existe só para satisfazer `Prey`.
 */
const prey = (id: string, x: number, y: number, alive = true, health = 100): Prey =>
  ({ id, position: { x, y }, alive, health });
const open = () => false;
/**
 * `rat` não declara `targetStrategy`, então `chooseTarget` nunca consome esta semente nos
 * testes abaixo (#541) — ela só precisa existir para o tipo.
 */
const rng = Rng.fromSeed('monster-test');

describe('chooseTarget', () => {
  it('takes the closest inside the aggro radius', () => {
    const monster = monsterAt(0, 0);
    expect(chooseTarget(monster, [prey('far', 3, 0), prey('near', 1, 0)], rat, rng, 0)).toBe('near');
  });

  it('ignores anything outside the radius', () => {
    expect(chooseTarget(monsterAt(0, 0), [prey('p', 9, 0)], rat, rng, 0)).toBeNull();
  });

  it('ignores the dead', () => {
    expect(chooseTarget(monsterAt(0, 0), [prey('p', 1, 0, false)], rat, rng, 0)).toBeNull();
  });

  it('keeps its target instead of rescanning every tick', () => {
    // Numa instância com 48 monstros, procurar sempre é trabalho jogado fora dezenas de
    // vezes por segundo — e trocar de alvo porque outro jogador passou um tile mais perto
    // não é o comportamento que os jogadores esperam.
    const monster = monsterAt(0, 0, { targetId: 'first' });
    expect(chooseTarget(monster, [prey('first', 3, 0), prey('closer', 1, 0)], rat, rng, 0))
      .toBe('first');
  });

  it('drops a target that died', () => {
    const monster = monsterAt(0, 0, { targetId: 'gone' });
    expect(chooseTarget(monster, [prey('gone', 1, 0, false), prey('alive', 2, 0)], rat, rng, 0))
      .toBe('alive');
  });

  it('gives up only past the leash, and never when it is zero', () => {
    // Zero é "nunca desiste": um monstro que larga o alvo no meio de uma hunt AFK faria o
    // jogador voltar e encontrar tudo parado, sem explicação.
    const monster = monsterAt(0, 0, { targetId: 'runner' });
    expect(chooseTarget(monster, [prey('runner', 50, 0)], rat, rng, 0)).toBe('runner');

    const leashed = { ...rat, leashRadius: 5 };
    expect(chooseTarget(monster, [prey('runner', 50, 0)], leashed, rng, 0)).toBeNull();
  });

  describe('andar (#519, hunt multiandar)', () => {
    // Um monstro com `z` na posição só enxerga presa NO MESMO `z` — os três andares da
    // Darashia Dragon Lair compartilham a mesma caixa (x, y), então ignorar o andar faria um
    // Dragon Lord do meio agredir o Dragon de cima através do chão.
    const monsterAtFloor = (x: number, y: number, z: number, over: Record<string, unknown> = {}) =>
      new MonsterRuntime({
        id: 1, monsterId: 'rat', position: { x, y, z }, home: { x, y, z },
        health: 20, targetId: null, cooldowns: {}, ...over,
      });
    const preyAtFloor = (id: string, x: number, y: number, z: number, alive = true): Prey =>
      ({ id, position: { x, y, z }, alive, health: 100 });

    it('ignora presa perto por (x, y) mas em outro andar', () => {
      const monster = monsterAtFloor(0, 0, 10);
      expect(chooseTarget(monster, [preyAtFloor('below', 1, 0, 11)], rat, rng, 0)).toBeNull();
      expect(chooseTarget(monster, [preyAtFloor('below', 1, 0, 11), preyAtFloor('same', 2, 0, 10)], rat, rng, 0))
        .toBe('same');
    });

    it('larga o alvo que trocou de andar, mesmo dentro do leash', () => {
      const monster = monsterAtFloor(0, 0, 10, { targetId: 'runner' });
      const leashed = { ...rat, leashRadius: 0 };
      expect(chooseTarget(monster, [preyAtFloor('runner', 1, 0, 11)], leashed, rng, 0)).toBeNull();
    });

    it('sem `z` de nenhum dos lados continua igual a antes — compatível com snapshot anterior', () => {
      // Nem o monstro nem a presa carregam `z`: é o snapshot de uma hunt de andar único gravado
      // antes desta issue, e o comportamento não pode mudar para ela.
      const monster = monsterAt(0, 0);
      expect(chooseTarget(monster, [prey('p', 1, 0)], rat, rng, 0)).toBe('p');
    });
  });

  describe('conformidade de RNG: sem `targetStrategy` (#541)', () => {
    /**
     * Um `Rng` que estoura ao ser consultado. `chooseTarget` recebe uma instância dele em vez
     * de uma semente de verdade: se o ramo sem `targetStrategy` sortear QUALQUER coisa — hoje
     * ou numa mudança futura —, o teste falha imediatamente, em vez de só divergir de um valor
     * hardcoded frágil. É o jeito mais direto de provar "a sequência de RNG fica inalterada":
     * a sequência de um monstro sem o campo é SEMPRE vazia.
     */
    const poisoned = new Proxy({} as unknown as Rng, {
      get(_target, property) {
        throw new Error(`chooseTarget não deveria consultar o RNG (.${String(property)})`);
      },
    });

    it('a busca do mais perto não sorteia nada', () => {
      const monster = monsterAt(0, 0);
      expect(chooseTarget(monster, [prey('far', 3, 0), prey('near', 1, 0)], rat, poisoned, 0))
        .toBe('near');
    });

    it('manter o alvo atual não sorteia nada', () => {
      const monster = monsterAt(0, 0, { targetId: 'first' });
      expect(chooseTarget(monster, [prey('first', 3, 0), prey('closer', 1, 0)], rat, poisoned, 0))
        .toBe('first');
    });

    it('desistir pelo leash não sorteia nada', () => {
      const monster = monsterAt(0, 0, { targetId: 'runner' });
      const leashed = { ...rat, leashRadius: 5 };
      expect(chooseTarget(monster, [prey('runner', 50, 0)], leashed, poisoned, 0)).toBeNull();
    });

    it('sem candidato nenhum também não sorteia nada', () => {
      expect(chooseTarget(monsterAt(0, 0), [prey('p', 9, 0)], rat, poisoned, 0)).toBeNull();
    });
  });

  describe('aquisição ignora `targetStrategy` (#645, Canary `Monster::onThink_async`: sempre NEAREST fixo — `monster.cpp:1736`)', () => {
    // Sem alvo retido, o Canary real SEMPRE resolve `TARGETSEARCH_NEAREST` — os pesos de
    // `dragon.lua` nunca entram aqui, só no ramo estreito de fuga bloqueada (ver o describe
    // abaixo). Peso 100 num critério que NÃO é `nearest` é o jeito de provar isso sem
    // ambiguidade: se a aquisição ainda consultasse a estratégia, o resultado seria outro.
    const healthOnly = { ...rat, targetStrategy: { nearest: 0, health: 100, damage: 0, random: 0 } };
    const damageOnly = { ...rat, targetStrategy: { nearest: 0, health: 0, damage: 100, random: 0 } };
    const poisoned = new Proxy({} as unknown as Rng, {
      get(_target, property) {
        throw new Error(`chooseTarget não deveria consultar o RNG (.${String(property)})`);
      },
    });

    it('escolhe o mais perto mesmo com peso 100 em `health` — quem tem menos vida não fura a fila', () => {
      const monster = monsterAt(0, 0);
      const near = prey('near', 1, 0, true, 500); // mais perto, mais vida
      const far = prey('far', 3, 0, true, 1); // mais longe, menos vida — venceria por `health`
      expect(chooseTarget(monster, [near, far], healthOnly, rng, 0)).toBe('near');
    });

    it('o mesmo vale para `damage`: quem bateu mais no monstro não fura a fila na aquisição', () => {
      const monster = monsterAt(0, 0);
      monster.contribution.record('far', 40);
      const preyList = [prey('near', 1, 0), prey('far', 3, 0)];
      expect(chooseTarget(monster, preyList, damageOnly, rng, 0)).toBe('near');
    });

    it('não sorteia NADA na aquisição, mesmo com a estratégia declarada — zero consulta ao RNG', () => {
      const monster = monsterAt(0, 0);
      expect(chooseTarget(monster, [prey('far', 3, 0), prey('near', 1, 0)], healthOnly, poisoned, 0))
        .toBe('near');
    });
  });

  describe('ramo estreito equivalente a `TARGETSEARCH_DEFAULT` (#645, ADR 0037 d.6, `monster.cpp:1737-1739`)', () => {
    // O ÚNICO lugar em que `chooseTarget` consulta `targetStrategy`: um alvo JÁ retido, o
    // monstro FUGINDO (`isMonsterFleeing`), e sem conseguir atacá-lo AGORA — aqui, distância
    // maior que `monsterAttackRange` (o `rat` não declara `abilities`, então o alcance é só
    // `attackRange`, 1 por padrão). `runOnHealth` igual ao HP do `rat` (20) o faz nascer
    // fugindo, sem precisar feri-lo antes — determinístico.
    const fleeing = { ...rat, runOnHealth: 20 };
    const healthOnly = { ...fleeing, targetStrategy: { nearest: 0, health: 100, damage: 0, random: 0 } };
    const damageOnly = { ...fleeing, targetStrategy: { nearest: 0, health: 0, damage: 100, random: 0 } };
    const poisoned = new Proxy({} as unknown as Rng, {
      get(_target, property) {
        throw new Error(`chooseTarget não deveria consultar o RNG (.${String(property)})`);
      },
    });

    it('reavalia pelo peso quando foge E o alvo retido está fora do alcance de toda ability', () => {
      const monster = monsterAt(0, 0, { targetId: 'current' });
      const current = prey('current', 3, 0, true, 500); // fora do alcance (1) — bloqueado
      const wounded = prey('wounded', 3, 0, true, 5); // mesma distância, menos vida
      expect(chooseTarget(monster, [current, wounded], healthOnly, rng, 0)).toBe('wounded');
    });

    it('o critério `damage` também entra neste ramo, com o dano acumulado no monstro', () => {
      const monster = monsterAt(0, 0, { targetId: 'current' });
      monster.contribution.record('big-hitter', 40);
      const current = prey('current', 3, 0);
      const bigHitter = prey('big-hitter', 3, 0);
      expect(chooseTarget(monster, [current, bigHitter], damageOnly, rng, 0)).toBe('big-hitter');
    });

    it('pode devolver o PRÓPRIO alvo retido — reavaliar não é o mesmo que trocar', () => {
      const monster = monsterAt(0, 0, { targetId: 'current' });
      const current = prey('current', 3, 0, true, 5); // menos vida — vence o critério `health`
      const healthy = prey('healthy', 3, 0, true, 900);
      expect(chooseTarget(monster, [current, healthy], healthOnly, rng, 0)).toBe('current');
    });

    it('NÃO foge (HP acima de `runOnHealth`): mantém o alvo sem consultar a estratégia', () => {
      const notFleeing = { ...rat, targetStrategy: healthOnly.targetStrategy }; // sem `runOnHealth`
      const monster = monsterAt(0, 0, { targetId: 'current' });
      const current = prey('current', 3, 0, true, 500);
      const wounded = prey('wounded', 3, 0, true, 5);
      expect(chooseTarget(monster, [current, wounded], notFleeing, poisoned, 0)).toBe('current');
    });

    it('foge, mas o alvo retido está AO ALCANCE: mantém sem consultar a estratégia', () => {
      const monster = monsterAt(0, 0, { targetId: 'current' });
      const current = prey('current', 1, 0, true, 500); // dentro do alcance (1) — não bloqueado
      const wounded = prey('wounded', 1, 0, true, 5);
      expect(chooseTarget(monster, [current, wounded], healthOnly, poisoned, 0)).toBe('current');
    });

    it('foge e está bloqueado, mas SEM `targetStrategy`: mantém o alvo, como sempre', () => {
      // Nenhum monstro do conteúdo hoje combina `runOnHealth` sem `targetStrategy`, mas o
      // ramo estreito não pode inventar um sorteio para quem não declarou pesos.
      const monster = monsterAt(0, 0, { targetId: 'current' });
      const current = prey('current', 3, 0, true, 500);
      const wounded = prey('wounded', 3, 0, true, 5);
      expect(chooseTarget(monster, [current, wounded], fleeing, poisoned, 0)).toBe('current');
    });

    describe('gate de cadência (achado da revisão do #654): no máximo um think por 1000 ms, como `EVENT_CREATURE_THINK_INTERVAL` (`creature.hpp:47`)', () => {
      // `chooseTarget` é chamada de três eventos independentes em `hunt.ts` (passo, ataque
      // básico e cada ability declarada) — um Dragon com três abilities a `cadenceMs: 2000`
      // gera 4-5 vencimentos a cada 2 s. Sem o gate, cada um reentraria neste ramo e consumiria
      // um sorteio novo — várias vezes mais rápido que o `Monster::onThink_async` real, que só
      // roda a cada 1000 ms e nunca é chamado por `doAttacking`. `monster.cooldowns` é quem
      // impõe o "no máximo uma vez por think", exatamente como o resto do motor já usa para
      // gate de tempo lógico (invariante 9: só a sessão dona escreve nele).
      it('a primeira chamada reavalia; chamadas dentro dos MESMOS 1000 ms nem tocam o RNG', () => {
        const monster = monsterAt(0, 0, { targetId: 'current' });
        const current = prey('current', 3, 0, true, 500); // fora do alcance — bloqueado
        const wounded = prey('wounded', 3, 0, true, 5); // menos vida — venceria o critério `health`

        // nowMs = 0: o primeiro think da janela. Consome o sorteio do critério e troca.
        expect(chooseTarget(monster, [current, wounded], healthOnly, rng, 0)).toBe('wounded');

        // `monster.targetId` continua 'current' — quem escreve de volta é sempre o chamador em
        // `hunt.ts`, nunca `chooseTarget`. As chamadas abaixo simulam o passo e as abilities do
        // MESMO Dragon vencendo antes do próximo think dele: todas reavaliariam o alvo retido
        // se o gate não existisse, e a `poisoned` prova que nenhuma sequer consulta o RNG.
        for (const laterMs of [1, 100, 500, 999]) {
          expect(chooseTarget(monster, [current, wounded], healthOnly, poisoned, laterMs))
            .toBe('current');
        }
      });

      it('exatamente 1000 ms depois, o think seguinte reavalia de novo', () => {
        const monster = monsterAt(0, 0, { targetId: 'current' });
        const current = prey('current', 3, 0, true, 500);
        const wounded = prey('wounded', 3, 0, true, 5);

        expect(chooseTarget(monster, [current, wounded], healthOnly, rng, 0)).toBe('wounded');
        expect(chooseTarget(monster, [current, wounded], healthOnly, rng, 1_000)).toBe('wounded');
      });

      it('o gate é por MONSTRO — outra instância fugindo no mesmo instante reavalia à parte', () => {
        // O cooldown mora em `monster.cooldowns`, não numa variável de módulo: dois monstros
        // fugindo no mesmo tick não podem compartilhar o relógio um do outro.
        const first = monsterAt(0, 0, { id: 1, targetId: 'current' });
        const second = monsterAt(0, 0, { id: 2, targetId: 'current' });
        const current = prey('current', 3, 0, true, 500);
        const wounded = prey('wounded', 3, 0, true, 5);

        expect(chooseTarget(first, [current, wounded], healthOnly, rng, 0)).toBe('wounded');
        expect(chooseTarget(second, [current, wounded], healthOnly, rng, 1)).toBe('wounded');
      });
    });
  });

  describe('com `targetStrategy` declarado, alvo retido e sem fuga (#541, #645)', () => {
    const healthOnly = { ...rat, targetStrategy: { nearest: 0, health: 100, damage: 0, random: 0 } };

    it('mantém o alvo atual sem consultar a estratégia — não está fugindo (sem `runOnHealth`)', () => {
      const poisoned = new Proxy({} as unknown as Rng, {
        get(_target, property) {
          throw new Error(`chooseTarget não deveria consultar o RNG (.${String(property)})`);
        },
      });
      const monster = monsterAt(0, 0, { targetId: 'current' });
      const preyList = [prey('current', 3, 0), prey('nearer', 1, 0, true, 1)];
      expect(chooseTarget(monster, preyList, healthOnly, poisoned, 0)).toBe('current');
    });
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
