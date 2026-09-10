import { describe, expect, it } from 'vitest';
import { botTargetingSchema } from '@draconya/content';
import { DEFAULT_TARGETING, compileTargeting, countTargets, selectTarget } from './targeting.js';
import type { TargetLike } from './targeting.js';

const at = (monsterId: string, x: number, health = 100): TargetLike =>
  ({ monsterId, health, alive: true, position: { x, y: 0 } });

const HERE = { x: 0, y: 0 };

/** A política como ela chega da configuração do jogador: pelo schema, com os defaults dele. */
const targeting = (over: Record<string, unknown> = {}) =>
  compileTargeting(botTargetingSchema.parse(over));

describe('a política padrão é a de sempre', () => {
  it('nearest + stand, sem preferência nenhuma', () => {
    // Uma configuração salva antes desta issue não tem `targeting`, e precisa continuar se
    // comportando exatamente como a hunt se comportava. É o que dispensou subir a versão de
    // vocabulário — e é o que este teste protege.
    expect(compileTargeting(undefined)).toBe(DEFAULT_TARGETING);
    expect(targeting()).toEqual(DEFAULT_TARGETING);
  });

  it('escolhe o mais próximo dentro do raio, e ignora o que está fora', () => {
    const rato = at('rat', 2);
    const lobo = at('wolf', 1);
    expect(selectTarget(targeting(), [rato, lobo], HERE, 3)).toBe(lobo);
    // Raio 1: o rato a dois tiles some da conta, e sobra o lobo.
    expect(selectTarget(targeting(), [rato, lobo], HERE, 1)).toBe(lobo);
    // Raio zero: ninguém.
    expect(selectTarget(targeting(), [rato, lobo], HERE, 0)).toBeNull();
  });

  it('morto não é alvo', () => {
    const morto = { ...at('rat', 1), alive: false };
    expect(selectTarget(targeting(), [morto, at('wolf', 3)], HERE, 5)?.monsterId).toBe('wolf');
  });
});

describe('as três políticas do §13.6', () => {
  // Vidas e distâncias cruzadas de propósito: o mais próximo NÃO é o mais fraco nem o mais
  // forte, então cada política escolhe um monstro diferente e o teste distingue as três.
  const campo = [at('rat', 1, 90), at('wolf', 2, 30), at('bear', 3, 200)];

  it('nearest pega o mais perto', () => {
    expect(selectTarget(targeting({ policy: 'nearest' }), campo, HERE, 9)?.monsterId).toBe('rat');
  });

  it('lowest-hp termina quem está quase morto', () => {
    expect(selectTarget(targeting({ policy: 'lowest-hp' }), campo, HERE, 9)?.monsterId)
      .toBe('wolf');
  });

  it('highest-hp bate no mais gordo primeiro', () => {
    expect(selectTarget(targeting({ policy: 'highest-hp' }), campo, HERE, 9)?.monsterId)
      .toBe('bear');
  });

  it('a política respeita o raio: fora dele, nem entra na disputa', () => {
    // O `bear` é o de mais vida e está a três tiles. Com raio 2 ele não conta, e `highest-hp`
    // fica com o segundo. Confundir "melhor pela política" com "melhor dentro do alcance" é o
    // defeito que separou `#attackTarget` de `#approachTarget`.
    expect(selectTarget(targeting({ policy: 'highest-hp' }), campo, HERE, 2)?.monsterId)
      .toBe('rat');
  });
});

describe('desempate ESTÁVEL — é o que faz a mesma semente dar a mesma hunt', () => {
  it('vidas iguais ficam com quem nasceu antes', () => {
    // A ordem da lista é a de nascimento. Sem `<` estrito, o último varrido ganharia, e duas
    // execuções da mesma semente divergiriam assim que dois monstros empatassem — que é o
    // caso comum, não o raro: monstro recém-nascido tem sempre a vida cheia.
    const primeiro = at('rat', 4, 50);
    const segundo = at('rat', 4, 50);
    expect(selectTarget(targeting({ policy: 'lowest-hp' }), [primeiro, segundo], HERE, 9))
      .toBe(primeiro);
    expect(selectTarget(targeting({ policy: 'highest-hp' }), [primeiro, segundo], HERE, 9))
      .toBe(primeiro);
    expect(selectTarget(targeting(), [primeiro, segundo], HERE, 9)).toBe(primeiro);
  });
});

describe('priorizar e ignorar', () => {
  it('priorizado ganha ANTES da política, mesmo estando mais longe', () => {
    // É o ponto todo de priorizar: "mate o mago primeiro" precisa valer justamente quando o
    // mago está atrás, senão a regra só dispara quando já não fazia diferença.
    const rato = at('rat', 1, 10);
    const mago = at('mage', 7, 400);
    const t = targeting({ policy: 'lowest-hp', prioritize: ['mage'] });
    expect(selectTarget(t, [rato, mago], HERE, 9)).toBe(mago);
  });

  it('entre dois priorizados, a política volta a valer', () => {
    const magoForte = at('mage', 5, 400);
    const magoFraco = at('mage-apprentice', 6, 40);
    const t = targeting({ policy: 'lowest-hp', prioritize: ['mage', 'mage-apprentice'] });
    expect(selectTarget(t, [magoForte, magoFraco], HERE, 9)).toBe(magoFraco);
  });

  it('priorizado FORA do raio não ganha nada — ele nem é candidato', () => {
    const rato = at('rat', 1);
    const mago = at('mage', 7);
    const t = targeting({ prioritize: ['mage'] });
    expect(selectTarget(t, [rato, mago], HERE, 3)).toBe(rato);
  });

  it('ignorado nunca é escolhido, mesmo sendo o único', () => {
    const t = targeting({ ignore: ['rat'] });
    expect(selectTarget(t, [at('rat', 1)], HERE, 9)).toBeNull();
  });

  it('ignorar vence priorizar quando o id está nas duas listas', () => {
    // Configuração contraditória do jogador. Não lançar é a regra do vocabulário inteiro; a
    // pergunta é qual das duas ganha, e "não ataque" é a mais conservadora — a outra ordem
    // faria o bot atacar exatamente quem foi mandado deixar em paz.
    const t = targeting({ prioritize: ['rat'], ignore: ['rat'] });
    expect(selectTarget(t, [at('rat', 1), at('wolf', 3)], HERE, 9)?.monsterId).toBe('wolf');
  });
});

describe('contagem de alvos', () => {
  it('conta os vivos no raio e desconta os ignorados', () => {
    // "3 ou mais alvos → onda" contando monstros que o bot foi mandado ignorar dispararia a
    // regra por causa de quem ela não vai atingir.
    const campo = [at('rat', 1), at('rat', 2), at('wolf', 2), { ...at('rat', 1), alive: false }];
    expect(countTargets(targeting(), campo, HERE, 3)).toBe(3);
    expect(countTargets(targeting({ ignore: ['rat'] }), campo, HERE, 3)).toBe(1);
  });

  it('o raio é inclusivo na borda', () => {
    expect(countTargets(targeting(), [at('rat', 3)], HERE, 3)).toBe(1);
    expect(countTargets(targeting(), [at('rat', 4)], HERE, 3)).toBe(0);
  });
});
