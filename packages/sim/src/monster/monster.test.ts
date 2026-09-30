import { compileMonster, monsterSchema } from '@draconya/content';
import type { ConditionSpec, Monster } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Fields } from '../fields.js';
import type { TileFieldState } from '../fields.js';
import { Rng } from '../rng.js';
import {
  CHALLENGE_CONDITION_KEY, MonsterRuntime, RANDOM_STEP_INTERVAL_MS, canMonsterEnterField,
  chooseTarget, decideMonsterAction, decideUnengagedMove, hasActiveCondition, isInSpawnLocation,
  isInSpawnRange, isMonsterFleeing, summonFollowStep, walkBackPathStep, type Prey,
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

  it('gives up past the leash while the target is in view, and never on the leash when it is zero', () => {
    // Zero é "sem o limite EXTRA do leash": dentro da área de visão o monstro segue o alvo até
    // onde ele estiver do `home`. O leash só corta o alvo que ainda está à vista, mas longe do
    // ponto de origem.
    const monster = monsterAt(0, 0, { targetId: 'runner' });
    expect(chooseTarget(monster, [prey('runner', 3, 0)], rat, rng, 0)).toBe('runner');

    const leashed = { ...rat, leashRadius: 2 };
    expect(chooseTarget(monster, [prey('runner', 3, 0)], leashed, rng, 0)).toBeNull();
  });

  describe('a retenção acaba na área de visão (#655, Canary `Creature::onCreatureMove` → `onCreatureDisappear`)', () => {
    it('larga o alvo que saiu do `aggroRadius`, mesmo com leash zero — a lista de alvos esvazia', () => {
      // `rat.aggroRadius` é 4: o alvo retido a 5 tiles saiu do `canSee`. É o que esvazia a lista
      // de alvos do Canary e liga a volta ao spawn; sem este corte, com leash 0 o monstro
      // persegue para sempre e a volta nunca dispara.
      const monster = monsterAt(0, 0, { targetId: 'runner' });
      expect(chooseTarget(monster, [prey('runner', 4, 0)], rat, rng, 0)).toBe('runner');
      expect(chooseTarget(monster, [prey('runner', 5, 0)], rat, rng, 0)).toBeNull();
    });

    it('e escolhe outro dentro da área de visão, se houver', () => {
      const monster = monsterAt(0, 0, { targetId: 'runner' });
      expect(chooseTarget(monster, [prey('runner', 9, 0), prey('near', 2, 0)], rat, rng, 0))
        .toBe('near');
    });

    it('a distância é a do MONSTRO (não a do home): quem o arrasta para longe do spawn ainda é retido', () => {
      const monster = monsterAt(30, 0, { targetId: 'runner', home: { x: 0, y: 0 } });
      expect(chooseTarget(monster, [prey('runner', 33, 0)], rat, rng, 0)).toBe('runner');
    });
  });

  describe('invisibilidade (#559/#592, ADR 0041 d.2)', () => {
    const invisiblePrey = (id: string, x: number, y: number): Prey =>
      ({ id, position: { x, y }, alive: true, health: 100, invisible: true });

    it('não seleciona um invisível na aquisição, e escolhe o outro candidato visível', () => {
      const monster = monsterAt(0, 0);
      expect(chooseTarget(monster, [invisiblePrey('ghost', 1, 0)], rat, rng, 0)).toBeNull();
      expect(chooseTarget(monster, [invisiblePrey('ghost', 1, 0), prey('visible', 2, 0)], rat, rng, 0))
        .toBe('visible');
    });

    it('NÃO larga sozinho o alvo retido que ficou invisível — quem o larga é o think agendado pelo ruleset', () => {
      // `Creature::onThink` (Canary `creature.cpp:130-140`) só larga o alvo invisível no próximo
      // think da criatura, até 1000 ms depois: `HuntRuleset#onVisibilityThink` reproduz isso (com
      // teste em `hunt.test.ts`). `chooseTarget` roda a cada passo do monstro e, largando o alvo
      // na hora, encurtaria o atraso do Canary.
      const monster = monsterAt(0, 0, { targetId: 'hero' });
      const localRng = Rng.fromSeed('retain-invisible');
      const before = Rng.fromSeed('retain-invisible').fraction();
      expect(chooseTarget(monster, [invisiblePrey('hero', 1, 0)], rat, localRng, 0)).toBe('hero');
      expect(chooseTarget(monster, [invisiblePrey('hero', 1, 0)], rat, localRng, 10_000)).toBe('hero');
      expect(localRng.fraction()).toBe(before); // nenhum sorteio consumido
    });

    it('mas o alvo retido invisível não impede a AQUISIÇÃO de escolher só entre os visíveis (o ramo estreito de fuga)', () => {
      const fleeing = {
        ...rat, runOnHealth: 20, targetStrategy: { nearest: 0, health: 100, damage: 0, random: 0 },
      };
      const monster = monsterAt(0, 0, { targetId: 'ghost' });
      // Longe do alcance de qualquer ability e fugindo: reavalia o ranking — e o invisível sai dele.
      const chosen = chooseTarget(
        monster, [invisiblePrey('ghost', 3, 0), prey('visible', 4, 0)], fleeing, Rng.fromSeed('narrow'), 0,
      );
      expect(chosen).toBe('visible');
    });

    it('um monstro que "vê invisível" (`conditionImmunities: [\'invisible\']`) seleciona e retém igual', () => {
      const seer: Monster = { ...rat, conditionImmunities: ['invisible'] };
      expect(chooseTarget(monsterAt(0, 0), [invisiblePrey('ghost', 1, 0)], seer, rng, 0)).toBe('ghost');
      const monster = monsterAt(0, 0, { targetId: 'hero' });
      expect(chooseTarget(monster, [invisiblePrey('hero', 1, 0)], seer, rng, 0)).toBe('hero');
    });
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

  it('#589: is suspended while the "challenge" condition is active, HP below threshold and all', () => {
    const challenged = monsterAt(0, 0, {
      health: 300,
      conditions: [{ key: 'challenge', expiresAtMs: 6_000 }],
    });
    expect(isMonsterFleeing(challenged, runsAt300)).toBe(false);
    // Removing the condition (as CONDITION_EXPIRE does at expiry) restores fleeing with the
    // same HP — the condition is the only thing that changed.
    const noLongerChallenged = monsterAt(0, 0, { health: 300 });
    expect(isMonsterFleeing(noLongerChallenged, runsAt300)).toBe(true);
  });

  it('#603: is suspended while the Fatal Hold charm condition ("fatal-hold") is active', () => {
    // `Monster::isFleeing` do Canary confere `fatalHoldDuration <= 0`: o charm do jogador
    // (30 s) segura a fuga por vida baixa, e a condição é a mesma máquina do `challenge`.
    const held = monsterAt(0, 0, {
      health: 300,
      conditions: [{ key: 'fatal-hold', expiresAtMs: 30_000 }],
    });
    expect(isMonsterFleeing(held, runsAt300)).toBe(false);
    expect(isMonsterFleeing(monsterAt(0, 0, { health: 300 }), runsAt300)).toBe(true);
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

  it('#589: Challenge suspends the flee step, and it comes back once the condition drops out', () => {
    const monster = monsterAt(5, 5, {
      health: 300,
      conditions: [{ key: 'challenge', expiresAtMs: 6_000 }],
    });
    // Well inside reach, HP at the threshold: without the condition this would step AWAY
    // (the case right above). With it, the monster attacks instead — RF-03.
    expect(decideMonsterAction(monster, prey('p', 6, 5), runsAt300, open))
      .toEqual({ kind: 'attack', targetId: 'p' });

    // Same monster, condition gone (as CONDITION_EXPIRE removes it) — the same HP flees again.
    const expired = monsterAt(5, 5, { health: 300 });
    expect(decideMonsterAction(expired, prey('p', 6, 5), runsAt300, open))
      .toEqual({ kind: 'step', to: { x: 4, y: 5 } });
  });
});

describe('decideMonsterAction: manter distância (#542, targetDistance)', () => {
  // Alcance de ataque igual ao `targetDistance`: o atirador para exatamente onde prefere ficar
  // e atira de lá, em vez de colar como um corpo a corpo (attackRange 1 desligaria a checagem
  // de alcance ANTES do recuo entrar, e o teste não provaria nada sobre o campo novo).
  const shooter = { ...rat, targetDistance: 4, attackRange: 4 };

  it('does not declare targetDistance in the fixture rat — default is 1', () => {
    expect(rat.targetDistance).toBe(1);
  });

  it('retreats one tile when the target gets closer than targetDistance', () => {
    const monster = monsterAt(5, 5);
    const action = decideMonsterAction(monster, prey('p', 7, 5), shooter, open);
    expect(action).toEqual({ kind: 'retreat', to: { x: 4, y: 5 } });
  });

  it('stands and attacks exactly at targetDistance, without retreating further', () => {
    const monster = monsterAt(5, 5);
    expect(decideMonsterAction(monster, prey('p', 9, 5), shooter, open))
      .toEqual({ kind: 'attack', targetId: 'p' });
  });

  it('attacks in place instead of getting stuck when retreat is blocked (wall behind)', () => {
    const monster = monsterAt(0, 0);
    // Encurralado no canto (0,0), como no describe da fuga por vida baixa: recuar de um alvo
    // a leste (1,0) empurraria para x=-1, fora do mapa desta grade de teste.
    const corner = (x: number, y: number) => x < 0 || y < 0;
    expect(decideMonsterAction(monster, prey('p', 1, 0), shooter, corner))
      .toEqual({ kind: 'attack', targetId: 'p' });
  });

  it('never retreats across floors — the SAME distance that retreats on one floor attacks on another', () => {
    const monster = new MonsterRuntime({
      id: 1, monsterId: 'rat', position: { x: 5, y: 5, z: 7 }, home: { x: 5, y: 5, z: 7 },
      health: 20, targetId: null, cooldowns: {},
    });
    // Mesma distância (2) do teste de recuo acima — só o andar do alvo muda, de 7 para 8.
    const sameFloorTarget: Prey = { id: 'p', position: { x: 7, y: 5, z: 7 }, alive: true, health: 100 };
    const otherFloorTarget: Prey = { id: 'p', position: { x: 7, y: 5, z: 8 }, alive: true, health: 100 };
    expect(decideMonsterAction(monster, sameFloorTarget, shooter, open))
      .toEqual({ kind: 'retreat', to: { x: 4, y: 5 } });
    // Andar diferente: o portão de `sameFloor` desliga o recuo — cai para a checagem de
    // alcance de sempre, que não olha `z` (o mesmo comportamento que `distance`/`greedyStep`
    // já tinham antes desta issue, preservado de propósito).
    expect(decideMonsterAction(monster, otherFloorTarget, shooter, open))
      .toEqual({ kind: 'attack', targetId: 'p' });
  });

  it('does not retreat with the default targetDistance (1) — same behaviour as before #542', () => {
    // `distance < targetDistance` só é possível com `targetDistance` acima de 1: com o default,
    // o ramo novo nunca roda, e a sequência de decisões do rato continua idêntica.
    expect(decideMonsterAction(monsterAt(0, 0), prey('p', 1, 0), rat, open))
      .toEqual({ kind: 'attack', targetId: 'p' });
    expect(decideMonsterAction(monsterAt(0, 0), prey('p', 5, 0), rat, open))
      .toEqual({ kind: 'step', to: { x: 1, y: 0 } });
  });

  // Revisão do #649: a primeira versão desta issue só implementava a metade do recuo de
  // `Monster::getPathSearchParams` — um atirador cuja ability alcança mais longe que o
  // `targetDistance` preferido (a norma real: Necromancer `targetDistance` 4 com ability de
  // alcance 7, Monk Familiar `targetDistance` 2 com abilities de alcance 5) parava assim que
  // entrava no alcance da ability, sem nunca fechar até o stand-off documentado. Este describe
  // usa um `attackRange` (5) maior que o `targetDistance` (2) de propósito: com os dois iguais
  // (o `shooter` do describe acima), o defeito e o conserto produzem o MESMO resultado, e o
  // teste não provaria nada sobre a metade que estava faltando.
  const longRangeShooter = { ...rat, targetDistance: 2, attackRange: 5 };

  it('keeps closing past its own ability range until it reaches targetDistance', () => {
    // Alvo a 4 tiles: dentro do alcance da ability (5), mas ainda mais longe que o
    // `targetDistance` (2) preferido. Antes do #649, isto já disparava `attack` parado a 4
    // tiles — o defeito que a revisão encontrou.
    const monster = monsterAt(5, 5);
    expect(decideMonsterAction(monster, prey('p', 9, 5), longRangeShooter, open))
      .toEqual({ kind: 'step', to: { x: 6, y: 5 } });
  });

  it('stands and attacks exactly at targetDistance, even with an ability that reaches farther', () => {
    const monster = monsterAt(5, 5);
    expect(decideMonsterAction(monster, prey('p', 7, 5), longRangeShooter, open))
      .toEqual({ kind: 'attack', targetId: 'p' });
  });

  it('still stops at the largest ability range when targetDistance is the default (1) — CMB-06 unchanged', () => {
    // Sem `targetDistance` declarado (> 1), o alcance de parada da aproximação continua sendo o
    // maior alcance de ability, como sempre — a mudança do #649 só vale para quem declara
    // `targetDistance > 1`.
    const monster = monsterAt(5, 5);
    const rangedNoPreference = { ...rat, attackRange: 4 };
    expect(decideMonsterAction(monster, prey('p', 9, 5), rangedNoPreference, open))
      .toEqual({ kind: 'attack', targetId: 'p' });
  });
});

describe('decideMonsterAction: recuo exige visão livre (#553, M30-06)', () => {
  const shooter = { ...rat, targetDistance: 4, attackRange: 4 };
  const blockedSight = () => false;
  const clearSight = () => true;

  it('without the 5th argument, retreats as before (default is always clear)', () => {
    const monster = monsterAt(5, 5);
    expect(decideMonsterAction(monster, prey('p', 7, 5), shooter, open))
      .toEqual({ kind: 'retreat', to: { x: 4, y: 5 } });
  });

  it('with sight explicitly clear, retreats the same way', () => {
    const monster = monsterAt(5, 5);
    expect(decideMonsterAction(monster, prey('p', 7, 5), shooter, open, clearSight))
      .toEqual({ kind: 'retreat', to: { x: 4, y: 5 } });
  });

  it('without sight, does NOT retreat — falls through to the normal approach/attack check', () => {
    const monster = monsterAt(5, 5);
    // Alvo a 2 tiles (dentro de targetDistance=4, o gatilho do recuo) e dentro do attackRange
    // (4) também — como `distance < targetDistance` sempre implica `distance <= targetDistance`
    // (o `approachStopRange` de quem declara `targetDistance > 1`), a checagem seguinte SEMPRE
    // acha o alvo a distância de ataque quando o recuo teria disparado: sem visão, o Canary cai
    // no caminho normal — aqui, ataca parado, em vez de recuar às cegas.
    expect(decideMonsterAction(monster, prey('p', 7, 5), shooter, open, blockedSight))
      .toEqual({ kind: 'attack', targetId: 'p' });
  });
});

describe('canMonsterEnterField (M29-05)', () => {
  const withDamage = (
    id: string, tiles: readonly { x: number; y: number }[], damageType: 'fire' | 'earth' | 'energy',
  ): TileFieldState => ({
    id, expiresAtMs: 999_999,
    tiles: tiles.map((t) => ({ x: t.x, y: t.y, z: 0 })),
    condition: {
      key: 'burning', merge: 'refresh', durationMs: 999_999,
      effect: {
        kind: 'damage-over-time', form: 'rounds',
        rounds: [{ count: 1, intervalMs: 999_999, damage: 20 }], damageType,
      },
    } as ConditionSpec,
  });

  // Um campo de OUTRO efeito (aqui, uma paralisia) não tem `damageType` — só fogo/veneno/
  // energia têm o par `canWalkOn*` do Tibia, e nenhum outro efeito conta.
  const speedField: TileFieldState = {
    id: 'slow', expiresAtMs: 999_999, tiles: [{ x: 1, y: 0, z: 0 }],
    condition: {
      key: 'speed', merge: 'refresh', durationMs: 999_999,
      effect: { kind: 'speed', type: 'paralyze', delta: -300 },
    } as ConditionSpec,
  };

  it('sem campo, sempre pode', () => {
    expect(canMonsterEnterField(rat, false, null)).toBe(true);
  });

  it('campo sem tipo de dano nunca bloqueia, mesmo com os três canWalkOn* em false', () => {
    const restricted = { ...rat, canWalkOnFire: false, canWalkOnPoison: false, canWalkOnEnergy: false };
    expect(canMonsterEnterField(restricted, false, speedField)).toBe(true);
  });

  it('canWalkOnFire false bloqueia fogo; true, ou ausente (default), atravessa', () => {
    const field = withDamage('wall', [{ x: 1, y: 0 }], 'fire');
    expect(canMonsterEnterField({ ...rat, canWalkOnFire: false }, false, field)).toBe(false);
    expect(canMonsterEnterField({ ...rat, canWalkOnFire: true }, false, field)).toBe(true);
    expect(canMonsterEnterField(rat, false, field)).toBe(true);
  });

  it('veneno usa canWalkOnPoison, mas o elemento do campo é `earth` (CMB-03)', () => {
    const field = withDamage('poison', [{ x: 1, y: 0 }], 'earth');
    expect(canMonsterEnterField({ ...rat, canWalkOnPoison: false }, false, field)).toBe(false);
    expect(canMonsterEnterField({ ...rat, canWalkOnFire: false }, false, field)).toBe(true);
  });

  it('energia usa canWalkOnEnergy', () => {
    const field = withDamage('shock', [{ x: 1, y: 0 }], 'energy');
    expect(canMonsterEnterField({ ...rat, canWalkOnEnergy: false }, false, field)).toBe(false);
  });

  it('imune ao tipo do campo sempre pode, mesmo com o canWalkOn* correspondente em false', () => {
    const field = withDamage('wall', [{ x: 1, y: 0 }], 'fire');
    const immune = {
      ...rat, canWalkOnFire: false,
      mitigation: { resistances: rat.mitigation.resistances, immunities: new Set(['fire' as const]) },
    };
    expect(canMonsterEnterField(immune, false, field)).toBe(true);
  });

  it('o bypass `ignoresFieldDamage` ignora canWalkOnFire por completo (TFS/Canary `ignoreFieldDamage`)', () => {
    const field = withDamage('wall', [{ x: 1, y: 0 }], 'fire');
    expect(canMonsterEnterField({ ...rat, canWalkOnFire: false }, true, field)).toBe(true);
  });
});

describe('decideMonsterAction evita campo que não pode atravessar (M29-05)', () => {
  const fireLine = (tiles: readonly { x: number; y: number }[]): Fields => Fields.fromState([{
    id: 'wall', expiresAtMs: 999_999,
    tiles: tiles.map((t) => ({ x: t.x, y: t.y, z: 0 })),
    condition: {
      key: 'burning', merge: 'refresh', durationMs: 999_999,
      effect: {
        kind: 'damage-over-time', form: 'rounds',
        rounds: [{ count: 1, intervalMs: 999_999, damage: 20 }], damageType: 'fire',
      },
    } as ConditionSpec,
  }]);

  /** O `Blocked` que o `HuntRuleset#blockedForMonster` monta de verdade: ocupação (aqui, sempre
   * livre) MAIS o campo que o monstro não pode atravessar. */
  const blockedByField = (fields: Fields, monster: MonsterRuntime, definition: Monster) =>
    (x: number, y: number): boolean => !canMonsterEnterField(
      definition, monster.ignoresFieldDamage, fields.at({ x, y, z: 0 }),
    );

  it('contorna: um tile de fogo bem na frente, os dois vizinhos livres', () => {
    const fields = fireLine([{ x: 1, y: 0 }]);
    const avoidsFire = { ...rat, canWalkOnFire: false };
    const monster = monsterAt(0, 0);
    const action = decideMonsterAction(
      monster, prey('p', 5, 0), avoidsFire, blockedByField(fields, monster, avoidsFire),
    );
    // A ordem dos dois vizinhos é fixa (horário antes de anti-horário, ADR 0009): o de baixo
    // (1,1) sai antes do de cima (1,-1).
    expect(action).toEqual({ kind: 'step', to: { x: 1, y: 1 } });
  });

  it('com canWalkOnFire true, atravessa reto — o mesmo campo não desvia mais ninguém', () => {
    const fields = fireLine([{ x: 1, y: 0 }]);
    const monster = monsterAt(0, 0);
    const action = decideMonsterAction(
      monster, prey('p', 5, 0), rat, blockedByField(fields, monster, rat),
    );
    expect(action).toEqual({ kind: 'step', to: { x: 1, y: 0 } });
  });

  it('sem rota alternativa (fogo nos três candidatos), fica preso — sem dano, para sempre', () => {
    const fields = fireLine([{ x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    const avoidsFire = { ...rat, canWalkOnFire: false };
    const monster = monsterAt(0, 0);
    const blocked = blockedByField(fields, monster, avoidsFire);
    expect(decideMonsterAction(monster, prey('p', 5, 0), avoidsFire, blocked).kind).toBe('idle');
    // Perguntar de novo, do mesmo tile, dá a MESMA resposta — não há exploração escondida que
    // acabasse achando a volta sozinha (decideMonsterAction é pura, sem estado de tempo).
    expect(decideMonsterAction(monster, prey('p', 5, 0), avoidsFire, blocked).kind).toBe('idle');
  });

  it('com `ignoresFieldDamage` armado (concedido ao levar dano preso), atravessa a mesma parede', () => {
    const fields = fireLine([{ x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    const avoidsFire = { ...rat, canWalkOnFire: false };
    const monster = monsterAt(0, 0, { ignoresFieldDamage: true });
    const action = decideMonsterAction(
      monster, prey('p', 5, 0), avoidsFire, blockedByField(fields, monster, avoidsFire),
    );
    expect(action).toEqual({ kind: 'step', to: { x: 1, y: 0 } });
  });
});

describe('MonsterRuntime: estado da volta ao spawn e do passo aleatório (#655)', () => {
  it('nasce sem volta, sem passo aleatório e sem passo dado — e o snapshot NÃO carrega o default', () => {
    const monster = monsterAt(3, 3);
    expect(monster.walkingBack).toBe(false);
    expect(monster.randomStepping).toBe(false);
    expect(monster.lastMoveAtMs).toBeNull();
    const state = monster.getState();
    expect('walkingBack' in state).toBe(false);
    expect('randomStepping' in state).toBe(false);
    expect('lastMoveAtMs' in state).toBe(false);
  });

  it('round-trips os três campos pelo snapshot — sem eles, a hunt retomada esquece a volta', () => {
    const monster = monsterAt(3, 3);
    monster.walkingBack = true;
    monster.randomStepping = true;
    monster.lastMoveAtMs = 4_250;
    const restored = new MonsterRuntime(JSON.parse(JSON.stringify(monster.getState())) as never);
    expect(restored.walkingBack).toBe(true);
    expect(restored.randomStepping).toBe(true);
    expect(restored.lastMoveAtMs).toBe(4_250);
  });

  it('lastMoveAtMs 0 (andou no instante zero) NÃO é "nunca andou"', () => {
    const monster = monsterAt(3, 3);
    monster.lastMoveAtMs = 0;
    expect(new MonsterRuntime(monster.getState()).lastMoveAtMs).toBe(0);
  });
});

describe('noteDamageTaken (#655, Canary `Monster::drainHealth`, `monster.cpp:3450`)', () => {
  it('sem passo até o alvo (lastStepBlocked) e com dano, arma o bypass de campo', () => {
    const monster = monsterAt(0, 0);
    monster.lastStepBlocked = true;
    monster.noteDamageTaken(5);
    expect(monster.ignoresFieldDamage).toBe(true);
  });

  it('andando ao acaso (randomStepping) e com dano, arma o bypass — a metade nova da condição', () => {
    const monster = monsterAt(0, 0);
    monster.randomStepping = true;
    monster.noteDamageTaken(1);
    expect(monster.ignoresFieldDamage).toBe(true);
  });

  it('dano zero não arma, e andar livre (nenhuma das duas flags) tampouco', () => {
    const stuck = monsterAt(0, 0);
    stuck.lastStepBlocked = true;
    stuck.randomStepping = true;
    stuck.noteDamageTaken(0);
    expect(stuck.ignoresFieldDamage).toBe(false);

    const free = monsterAt(0, 0);
    free.noteDamageTaken(500);
    expect(free.ignoresFieldDamage).toBe(false);
  });
});

describe('isInSpawnLocation / isInSpawnRange (#655, Canary `monster.cpp:1562`, `3323`)', () => {
  it('está no spawn quando (x, y) e o andar coincidem com o home', () => {
    expect(isInSpawnLocation(monsterAt(3, 3))).toBe(true);
    expect(isInSpawnLocation(monsterAt(4, 3, { home: { x: 3, y: 3 } }))).toBe(false);
    expect(isInSpawnLocation(monsterAt(3, 3, { position: { x: 3, y: 3, z: 10 }, home: { x: 3, y: 3, z: 11 } })))
      .toBe(false);
  });

  it('sem `z` de um dos lados o andar não desempata — compatível com snapshot anterior', () => {
    expect(isInSpawnLocation(monsterAt(3, 3, { position: { x: 3, y: 3, z: 10 }, home: { x: 3, y: 3 } })))
      .toBe(true);
  });

  it('invocação não tem spawn: `spawnMonster.expired()` no Canary, sempre "no spawn"', () => {
    expect(isInSpawnLocation(monsterAt(9, 9, { home: { x: 0, y: 0 }, masterId: 7 }))).toBe(true);
    expect(isInSpawnRange(monsterAt(900, 900, { home: { x: 0, y: 0 }, masterId: 'hero' }), 900, 900)).toBe(true);
  });

  it('o raio de spawn é o quadrado de 50 tiles (`deSpawnRadius`) em torno do home', () => {
    const monster = monsterAt(0, 0, { home: { x: 100, y: 100 } });
    expect(isInSpawnRange(monster, 150, 150)).toBe(true);
    expect(isInSpawnRange(monster, 50, 50)).toBe(true);
    expect(isInSpawnRange(monster, 151, 100)).toBe(false);
    expect(isInSpawnRange(monster, 100, 49)).toBe(false);
  });
});

describe('decideUnengagedMove (#655, Canary `Monster::updateIdleStatus` + `getNextStep`)', () => {
  // `rat.aggroRadius` é 4: quem está a 5+ tiles NÃO está na área de visão do monstro.
  const noPrey: readonly Prey[] = [];
  const decide = (
    monster: MonsterRuntime, opts: {
      target?: Prey | null; participants?: readonly Prey[]; summons?: readonly Prey[];
      blocked?: (x: number, y: number) => boolean; nowMs?: number; rng?: { integer(min: number, max: number): number };
    } = {},
  ) => decideUnengagedMove(
    monster, rat, opts.target ?? null, opts.participants ?? noPrey, opts.summons ?? noPrey,
    opts.blocked ?? open, opts.blocked ?? open, opts.blocked ?? open, opts.nowMs ?? 0, opts.rng ?? rng,
  );
  const countingRng = new Rng({ a: 1, b: 2, c: 3, d: 4 });
  /** Estoura se sorteado — prova que o ramo não consome nada. */
  const explodingRng = { integer: (): number => { throw new Error('sorteio inesperado'); } };

  describe('ocioso (`isIdle`, `monster.cpp:1521-1560`)', () => {
    it('no spawn, sem ninguém à vista e sem condição: ocioso — não anda, não sorteia', () => {
      const monster = monsterAt(0, 0);
      const action = decideUnengagedMove(
        monster, rat, null, [prey('far', 9, 0)], noPrey, open, open, open, 5_000, explodingRng,
      );
      expect(action).toEqual({ kind: 'idle' });
      expect(monster.walkingBack).toBe(false);
      expect(monster.randomStepping).toBe(false);
    });

    it('quem morreu não conta como alguém à vista', () => {
      const action = decide(monsterAt(0, 0), { participants: [prey('dead', 1, 0, false)] });
      expect(action.kind).toBe('idle');
    });

    it('a área de visão é o `aggroRadius`: a 4 tiles ainda vê (não ocioso), a 5 já não', () => {
      // Alguém à vista SEM ser alvo (aqui `target` é null): não ocioso — e sem volta, no spawn,
      // resta o passo aleatório. É a diferença entre "lista de alvos vazia" e "sem alvo".
      const seen = decide(monsterAt(0, 0), { participants: [prey('p', 4, 0)] });
      expect(seen.kind).toBe('random-step');
      const unseen = decide(monsterAt(0, 0), { participants: [prey('p', 5, 0)] });
      expect(unseen.kind).toBe('idle');
    });

    it('as invocações de personagem também enchem a lista de alvos', () => {
      const action = decide(monsterAt(0, 0), { summons: [prey('m:9', 2, 0)] });
      expect(action.kind).toBe('random-step');
    });

    it('com QUALQUER condição do Canary ativa nunca fica ocioso — `conditions.empty()`', () => {
      const burning = monsterAt(0, 0, { conditions: [{ key: 'burning', expiresAtMs: 60_000 }] });
      const action = decide(burning);
      // No spawn e sem volta ligada: cai no passo aleatório.
      expect(action.kind).toBe('random-step');
      expect(burning.walkingBack).toBe(false);
      expect(burning.randomStepping).toBe(true);
    });

    it('com condição, fora do spawn e sem ninguém à vista, a volta NÃO liga (só `updateIdleStatus` sem condição liga)', () => {
      const burning = monsterAt(2, 0, {
        home: { x: 0, y: 0 }, conditions: [{ key: 'burning', expiresAtMs: 60_000 }],
      });
      const action = decide(burning);
      expect(action.kind).toBe('random-step');
      expect(burning.walkingBack).toBe(false);
    });
  });

  describe('volta ao spawn (`doWalkBack`, `monster.cpp:2501-2526`)', () => {
    it('sem alvo, ninguém à vista e fora do spawn: liga a volta e dá o passo rumo ao home', () => {
      const monster = monsterAt(3, 0, { home: { x: 0, y: 0 } });
      const action = decide(monster, { rng: explodingRng });
      expect(action).toEqual({ kind: 'walk-back', to: { x: 2, y: 0 } });
      expect(monster.walkingBack).toBe(true);
    });

    it('chegando ao home a volta desliga, e o vencimento seguinte deixa o monstro ocioso', () => {
      const monster = monsterAt(1, 0, { home: { x: 0, y: 0 } });
      expect(decide(monster, { rng: explodingRng })).toEqual({ kind: 'walk-back', to: { x: 0, y: 0 } });
      monster.position = { x: 0, y: 0 };
      // Já no home e sem ninguém à vista: `updateIdleStatus` o deixa ocioso ANTES de qualquer
      // `getNextStep` — a volta ligada não anda nem desliga (o Canary também nem chega lá).
      expect(decide(monster, { rng: explodingRng })).toEqual({ kind: 'idle' });
      expect(monster.walkingBack).toBe(true);
    });

    it('acordado no home com a volta ainda ligada: `distance == 0` a desliga, sem passo', () => {
      // Um alvo apareceu (lista não vazia → não ocioso), a volta seguia ligada, e o monstro
      // já está no home: `doWalkBack` desliga a flag e não anda.
      const monster = monsterAt(0, 0, { home: { x: 0, y: 0 } });
      monster.walkingBack = true;
      const action = decide(monster, { target: prey('p', 3, 0), rng: explodingRng });
      expect(action).toEqual({ kind: 'walk-back', to: null });
      expect(monster.walkingBack).toBe(false);
    });

    it('sem passo até o home (nem pela busca de caminho): desliga a volta e não anda — o seguinte religa', () => {
      const monster = monsterAt(3, 0, { home: { x: 0, y: 0 } });
      const walled = (x: number): boolean => x <= 2;
      const action = decide(monster, { blocked: walled, rng: explodingRng });
      expect(action).toEqual({ kind: 'walk-back', to: null });
      expect(monster.walkingBack).toBe(false);
      // No vencimento seguinte, o `updateIdleStatus` religa (ninguém à vista, fora do spawn).
      expect(decide(monster, { blocked: walled, rng: explodingRng })).toEqual({ kind: 'walk-back', to: null });
    });

    it('a volta SOBREVIVE a um alvo que aparece no meio dela — só `doWalkBack` a desliga', () => {
      // O quirk do Canary: `isWalkingBack` fica ligada. Um monstro que já voltava, acha um alvo,
      // perde o caminho até ele — e volta a andar rumo ao spawn em vez de andar ao acaso.
      const monster = monsterAt(3, 0, { home: { x: 0, y: 0 } });
      monster.walkingBack = true;
      const action = decide(monster, { target: prey('p', 4, 0), rng: explodingRng });
      expect(action).toEqual({ kind: 'walk-back', to: { x: 2, y: 0 } });
    });

    it('com alvo (lista de alvos NÃO vazia) e a volta desligada, NÃO liga a volta', () => {
      const monster = monsterAt(3, 0, { home: { x: 0, y: 0 } });
      const action = decide(monster, { target: prey('p', 4, 0) });
      expect(action.kind).toBe('random-step');
      expect(monster.walkingBack).toBe(false);
    });

    it('a volta não consome sorteio nenhum', () => {
      const monster = monsterAt(7, 3, { home: { x: 0, y: 0 } });
      const before = countingRng.getState();
      decide(monster, { rng: countingRng });
      expect(countingRng.getState()).toEqual(before);
    });
  });

  describe('a volta que o guloso não resolve: a busca de caminho (`doWalkBack` usa A*, #655)', () => {
    // A concavidade da Darashia Dragon Lair achada na revisão (o `(75,116)` do Dragon Lord m:31):
    // `M` é uma bolsa sem saída — oeste, noroeste e sudoeste são parede —, e `H` o home. O guloso
    // de `(11,1)` desce em diagonal até a bolsa, pisa nela e empaca; o caminho de verdade sai
    // pelo norte, dá a volta pelo tile `(8,1)` e chega ao home em 7 passos.
    //
    //   x: 0123456789012
    //   0  #############
    //   1  #...........#
    //   2  #...#...#...#
    //   3  #..H...##M###      H = home (3,3), M = a bolsa (9,3)
    //   4  #......######
    //   5  #############
    const POCKET = [
      '#############',
      '#...........#',
      '#...#...#...#',
      '#......##.###',
      '#......######',
      '#############',
    ];
    const pocketBlocked = (x: number, y: number): boolean => POCKET[y]?.[x] !== '.';
    const HOME = { x: 3, y: 3 };
    const key = (p: { x: number; y: number }): string => `${String(p.x)},${String(p.y)}`;

    /** Anda o monstro pelas decisões de volta até o ocioso; devolve o rastro de tiles pisados. */
    const walkHome = (monster: MonsterRuntime, limit = 40): string[] => {
      const trail: string[] = [];
      for (let i = 0; i < limit; i += 1) {
        const action = decide(monster, { blocked: pocketBlocked, rng: explodingRng, nowMs: i * 1_000 });
        if (action.kind === 'idle') break;
        if (action.kind !== 'walk-back' || action.to === null) throw new Error(`ramo inesperado: ${action.kind}`);
        monster.position = action.to;
        trail.push(key(action.to));
      }
      return trail;
    };

    it('o guloso pisa a bolsa e empaca; a busca a tira dali — chega ao home sem repetir tile e fica ocioso', () => {
      const monster = monsterAt(11, 1, { home: HOME });
      const trail = walkHome(monster);
      expect(monster.position).toEqual(HOME);
      // Pisou na bolsa pelo guloso (era o único jeito de o rastro passar por ela)…
      expect(trail).toContain('9,3');
      // …e nenhum tile se repete: nada de oscilar entre a boca da bolsa e o fundo dela.
      expect(new Set(trail).size).toBe(trail.length);
      // 2 passos gulosos até a bolsa + 7 do caminho de volta.
      expect(trail).toHaveLength(9);
      // Chegou: o vencimento seguinte é o ocioso, e a busca desliga junto — o flag não fica velho.
      expect(monster.walkBackByPath).toBe(false);
      expect(decide(monster, { blocked: pocketBlocked, rng: explodingRng })).toEqual({ kind: 'idle' });
    });

    it('o guloso empacar FORA do home liga `walkBackByPath`, e ele sobrevive ao snapshot', () => {
      const monster = monsterAt(9, 3, { home: HOME });
      const action = decide(monster, { blocked: pocketBlocked, rng: explodingRng });
      expect(action).toEqual({ kind: 'walk-back', to: { x: 9, y: 2 } });
      expect(monster.walkingBack).toBe(true);
      expect(monster.walkBackByPath).toBe(true);
      const resumed = new MonsterRuntime(monster.getState());
      expect(resumed.walkBackByPath).toBe(true);
      // Sem o flag, o estado não escreve o campo (o snapshot antigo continua restaurando igual).
      expect('walkBackByPath' in monsterAt(9, 3).getState()).toBe(false);
    });

    it('por isso o flag é estado: na boca da bolsa o guloso a ENTRARIA de novo, a busca não', () => {
      // De `(9,2)` o guloso (sudoeste e oeste são parede) escolhe o sul — a bolsa. Sem estado a
      // volta seria um vaivém eterno: a busca tira o monstro, o guloso o devolve.
      const greedy = monsterAt(9, 2, { home: HOME });
      greedy.walkingBack = true;
      expect(decide(greedy, { blocked: pocketBlocked, rng: explodingRng }))
        .toEqual({ kind: 'walk-back', to: { x: 9, y: 3 } });

      const pathing = monsterAt(9, 2, { home: HOME });
      pathing.walkingBack = true;
      pathing.walkBackByPath = true;
      expect(decide(pathing, { blocked: pocketBlocked, rng: explodingRng }))
        .toEqual({ kind: 'walk-back', to: { x: 8, y: 1 } });
    });

    it('sem caminho até o home (fechado por parede): desliga a volta E a busca, sem andar', () => {
      const sealedHome = (x: number, y: number): boolean => pocketBlocked(x, y) || (Math.abs(x - 3) <= 1 && Math.abs(y - 3) <= 1 && !(x === 3 && y === 3));
      const monster = monsterAt(9, 3, { home: HOME });
      const action = decide(monster, { blocked: sealedHome, rng: explodingRng });
      expect(action).toEqual({ kind: 'walk-back', to: null });
      expect(monster.walkingBack).toBe(false);
      expect(monster.walkBackByPath).toBe(false);
    });

    describe('`walkBackPathStep`', () => {
      it('devolve o primeiro tile do caminho mais curto até o home', () => {
        expect(walkBackPathStep({ x: 9, y: 3 }, HOME, pocketBlocked)).toEqual({ x: 9, y: 2 });
        expect(walkBackPathStep({ x: 5, y: 4 }, HOME, pocketBlocked)).toEqual({ x: 4, y: 4 });
      });

      it('um home ocupado por outra criatura não é alcançável (como no Canary): null, sem varrer nada', () => {
        let calls = 0;
        const occupied = (x: number, y: number): boolean => {
          calls += 1;
          return pocketBlocked(x, y) || (x === 3 && y === 3);
        };
        expect(walkBackPathStep({ x: 9, y: 3 }, HOME, occupied)).toBeNull();
        // Só perguntou pelo próprio home: a varredura do raio inteiro é a parte cara, e ela é
        // inútil quando o destino já está fechado.
        expect(calls).toBe(1);
      });

      it('o raio da busca é o do spawn (50): um desvio longo é achado, um além dele não', () => {
        // Muro em x=2 com uma única passagem em y=`gap`; monstro em (5,0), home (0,0).
        const wallWithGap = (gap: number) => (x: number, y: number): boolean => x === 2 && y !== gap;
        expect(walkBackPathStep({ x: 5, y: 0 }, { x: 0, y: 0 }, wallWithGap(12))).not.toBeNull();
        expect(walkBackPathStep({ x: 5, y: 0 }, { x: 0, y: 0 }, wallWithGap(45))).not.toBeNull();
        expect(walkBackPathStep({ x: 5, y: 0 }, { x: 0, y: 0 }, wallWithGap(60))).toBeNull();
      });

      it('é determinística: dois caminhos mais curtos empatados resolvem sempre para o mesmo', () => {
        const first = walkBackPathStep({ x: 9, y: 3 }, HOME, pocketBlocked);
        for (let i = 0; i < 5; i += 1) expect(walkBackPathStep({ x: 9, y: 3 }, HOME, pocketBlocked)).toEqual(first);
      });
    });
  });

  describe('a provocação não é condição do Canary (`challengeFocusDuration`, #589)', () => {
    const challenged = (x: number, y: number, extra: Array<{ key: string; expiresAtMs: number }> = []) =>
      monsterAt(x, y, {
        home: { x: 0, y: 0 },
        conditions: [{ key: CHALLENGE_CONDITION_KEY, expiresAtMs: 60_000 }, ...extra],
      });

    it('`hasActiveCondition` ignora a provocação e conta qualquer outra', () => {
      expect(hasActiveCondition(monsterAt(0, 0))).toBe(false);
      expect(hasActiveCondition(challenged(0, 0))).toBe(false);
      expect(hasActiveCondition(monsterAt(0, 0, { conditions: [{ key: 'burning', expiresAtMs: 60_000 }] }))).toBe(true);
      expect(hasActiveCondition(challenged(0, 0, [{ key: 'burning', expiresAtMs: 60_000 }]))).toBe(true);
    });

    it('provocado, sem ninguém à vista e fora do spawn: VOLTA ao spawn como qualquer monstro', () => {
      const monster = challenged(3, 0);
      const action = decide(monster, { rng: explodingRng });
      expect(action).toEqual({ kind: 'walk-back', to: { x: 2, y: 0 } });
      expect(monster.walkingBack).toBe(true);
    });

    it('provocado e no spawn, sem ninguém à vista: fica ocioso', () => {
      expect(decide(challenged(0, 0), { rng: explodingRng })).toEqual({ kind: 'idle' });
    });

    it('a provocação MAIS outra condição: a outra ainda impede o ocioso', () => {
      const monster = challenged(0, 0, [{ key: 'burning', expiresAtMs: 60_000 }]);
      expect(decide(monster).kind).toBe('random-step');
    });
  });

  describe('passo aleatório (`doRandomStep`, `monster.cpp:2494-2499`)', () => {
    const someone = prey('p', 5, 3);

    it('com alvo e sem passo até ele, sorteia UM passo cardinal e liga `randomStepping`', () => {
      const monster = monsterAt(3, 3);
      const action = decide(monster, { target: someone, participants: [someone] });
      expect(action.kind).toBe('random-step');
      if (action.kind !== 'random-step' || action.to === null) throw new Error('sem passo');
      expect(Math.abs(action.to.x - 3) + Math.abs(action.to.y - 3)).toBe(1);
      expect(monster.randomStepping).toBe(true);
    });

    it('nunca antes de 1000 ms desde o último passo — e nem liga a flag', () => {
      const monster = monsterAt(3, 3);
      monster.lastMoveAtMs = 10_000;
      const early = decide(monster, {
        target: someone, nowMs: 10_000 + RANDOM_STEP_INTERVAL_MS - 1, rng: explodingRng,
      });
      expect(early).toEqual({ kind: 'random-step', to: null });
      expect(monster.randomStepping).toBe(false);

      const due = decide(monster, { target: someone, nowMs: 10_000 + RANDOM_STEP_INTERVAL_MS });
      expect(due.kind).toBe('random-step');
      if (due.kind !== 'random-step') throw new Error('ramo errado');
      expect(due.to).not.toBeNull();
      expect(monster.randomStepping).toBe(true);
    });

    it('nunca andou (`lastMoveAtMs` nulo): o primeiro passo vale de imediato', () => {
      const monster = monsterAt(3, 3);
      expect(decide(monster, { target: someone, nowMs: 0 }).kind).toBe('random-step');
      expect(monster.randomStepping).toBe(true);
    });

    it('cercado: liga a flag, consome os três sorteios e não anda', () => {
      const monster = monsterAt(3, 3);
      const calls: Array<[number, number]> = [];
      const spy = { integer: (min: number, max: number): number => { calls.push([min, max]); return min; } };
      const action = decideUnengagedMove(
        monster, rat, someone, [someone], noPrey, () => true, () => true, () => true, 0, spy,
      );
      expect(action).toEqual({ kind: 'random-step', to: null });
      expect(monster.randomStepping).toBe(true);
      expect(calls).toHaveLength(3);
    });

    it('usa o predicado ESTRITO (`randomBlocked`), não o do passo guloso', () => {
      // O guloso deixa passar tile com criatura empurrável; o `canWalkTo` do Canary não.
      const monster = monsterAt(3, 3);
      const action = decideUnengagedMove(
        monster, rat, someone, [someone], noPrey, open, () => true, open, 0, rng,
      );
      expect(action).toEqual({ kind: 'random-step', to: null });
    });

    it('alguém à vista em OUTRO andar: não ocioso e anda ao acaso (Canary `canSee` com z)', () => {
      const monster = monsterAt(0, 0, { position: { x: 0, y: 0, z: 10 }, home: { x: 0, y: 0, z: 10 } });
      const otherFloor: Prey = { id: 'p', position: { x: 1, y: 0, z: 11 }, alive: true, health: 100 };
      const action = decide(monster, { participants: [otherFloor] });
      expect(action.kind).toBe('random-step');
      // Na superfície, o subsolo não é visível: ocioso.
      const surface = monsterAt(0, 0, { position: { x: 0, y: 0, z: 7 }, home: { x: 0, y: 0, z: 7 } });
      const below: Prey = { id: 'p', position: { x: 0, y: 0, z: 8 }, alive: true, health: 100 };
      expect(decide(surface, { participants: [below] }).kind).toBe('idle');
    });
  });

  describe('invocação (`isSummon`)', () => {
    it('sem alvo fica parada — seguir o mestre não é modelado, e a volta ao spawn não se aplica', () => {
      const summon = monsterAt(5, 5, { home: { x: 0, y: 0 }, masterId: 3 });
      expect(decide(summon, { rng: explodingRng })).toEqual({ kind: 'still' });
      expect(summon.walkingBack).toBe(false);
    });

    it('com alvo e sem passo até ele, anda ao acaso como qualquer monstro', () => {
      const summon = monsterAt(5, 5, { home: { x: 0, y: 0 }, masterId: 3 });
      const action = decide(summon, { target: prey('p', 7, 5) });
      expect(action.kind).toBe('random-step');
      expect(summon.walkingBack).toBe(false);
    });
  });
});

describe('`summonFollowStep` (#599, `Monster::updateSummonTarget` + `doFollowCreature`)', () => {
  const VIEW = 11;
  const summon = (x: number, y: number, z?: number) =>
    monsterAt(x, y, { masterId: 'hero', ...(z === undefined ? {} : { position: { x, y, z } }) });
  const master = (x: number, y: number, z?: number, alive = true): Prey =>
    ({ id: 'hero', position: z === undefined ? { x, y } : { x, y, z }, alive, health: 100 });

  it('a 1 ou 2 tiles do mestre, com visão livre: já está no lugar — não anda', () => {
    expect(summonFollowStep(summon(5, 5), master(6, 5), VIEW, open)).toBeNull();
    expect(summonFollowStep(summon(5, 5), master(7, 7), VIEW, open)).toBeNull();
    expect(summonFollowStep(summon(5, 5), master(5, 3), VIEW, open)).toBeNull();
  });

  it('a 3 tiles ou mais: um passo na direção do mestre, o primeiro do caminho mais curto', () => {
    // Em linha reta anda em linha reta: quatro cardeais (40) até a faixa a 2 do mestre.
    expect(summonFollowStep(summon(0, 0), master(6, 0), VIEW, open)).toEqual({ x: 1, y: 0 });
    // Diagonal: o caminho de MENOR CUSTO (cardinal 10, diagonal 35) é feito de passos cardeais —
    // o primeiro vai para leste ou para sul, nunca de viés.
    const corner = summonFollowStep(summon(0, 0), master(6, 6), VIEW, open);
    expect((corner?.x ?? 0) + (corner?.y ?? 0)).toBe(1);
  });

  it('contorna a parede que o passo guloso não contorna (A*, não guloso)', () => {
    // Uma parede vertical em x = 3 (y de 0 a 4) entre a invocação (à esquerda) e o mestre. Só o
    // buraco em y = 5 deixa passar: o guloso encostaria na parede e empacaria.
    const wall = (x: number, y: number): boolean => x === 3 && y >= 0 && y <= 4;
    let position = { x: 1, y: 2 };
    const target = master(6, 2);
    for (let i = 0; i < 20; i += 1) {
      const step = summonFollowStep(summon(position.x, position.y), target, VIEW, wall);
      if (step === null) break;
      expect(wall(step.x, step.y)).toBe(false);
      position = step;
    }
    // Parou a 1–2 tiles do mestre, do outro lado da parede.
    expect(Math.max(Math.abs(position.x - 6), Math.abs(position.y - 2))).toBeLessThanOrEqual(2);
    expect(position.x).toBeGreaterThan(3);
  });

  it('o tile bom precisa de linha de visão livre até o mestre (`clearSight`)', () => {
    // Uma parede entre (4, 5) e o mestre em (6, 5): a invocação a 2 tiles, sem visão, continua
    // andando até um tile de onde enxerga.
    const noSight = (from: { x: number; y: number }, to: { x: number; y: number }): boolean =>
      !(from.x <= 4 && to.x >= 6);
    const step = summonFollowStep(summon(4, 5), master(6, 5), VIEW, open, noSight);
    expect(step).not.toBeNull();
    // Com visão livre, o mesmo caso fica parado.
    expect(summonFollowStep(summon(4, 5), master(6, 5), VIEW, open)).toBeNull();
  });

  it('só segue quem ENXERGA: mestre além da visão, em outro andar ou morto não é seguido', () => {
    expect(summonFollowStep(summon(0, 0), master(VIEW + 1, 0), VIEW, open)).toBeNull();
    expect(summonFollowStep(summon(0, 0), master(VIEW, 0), VIEW, open)).not.toBeNull();
    expect(summonFollowStep(summon(0, 0, 7), master(5, 0, 8), VIEW, open)).toBeNull();
    expect(summonFollowStep(summon(0, 0), master(5, 0, undefined, false), VIEW, open)).toBeNull();
  });

  it('sem caminho (cercada): não anda, sem lançar', () => {
    const boxed = (x: number, y: number): boolean => !(x === 0 && y === 0);
    expect(summonFollowStep(summon(0, 0), master(8, 0), VIEW, boxed)).toBeNull();
  });
});
