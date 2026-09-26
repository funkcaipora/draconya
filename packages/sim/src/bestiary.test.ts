import { describe, expect, it } from 'vitest';
import { Bestiary } from './bestiary.js';
import type { BestiaryConfig } from './bestiary.js';

// Marcos curtos de propósito: com 3 e 5 dá para contar os abates na mão e dizer, olhando, em
// que abate o marco fecha. Os 10 000 do conteúdo real são o mesmo mecanismo com número maior.
const config: BestiaryConfig = { milestones: [3, 5], xpBonusPercentPerMilestone: 1 };

describe('contar abates', () => {
  it('monstro nunca abatido vale zero, e não ocupa lugar no snapshot', () => {
    const bestiary = new Bestiary();
    expect(bestiary.killsOf('rat')).toBe(0);
    // Gravar zero para todo monstro do conteúdo em todo personagem é encher o snapshot com o
    // valor padrão.
    expect(bestiary.getState()).toEqual({});
  });

  it('cada abate soma um, por monstro', () => {
    const bestiary = new Bestiary();
    expect(bestiary.record('rat').kills).toBe(1);
    expect(bestiary.record('rat').kills).toBe(2);
    expect(bestiary.record('bat').kills).toBe(1);
    expect(bestiary.getState()).toEqual({ rat: 2, bat: 1 });
  });

  it('o marco é alcançado pelo abate que IGUALA o limiar, e por nenhum outro', () => {
    // Igualdade exata, e basta: o contador sobe de um em um, então cada limiar é cruzado por
    // exatamente um abate. Com `>=`, todo abate depois do marco pareceria o marco de novo, e o
    // extrato ganharia uma linha por rato.
    const bestiary = new Bestiary();
    expect(bestiary.record('rat', config).milestoneReached).toBeNull();
    expect(bestiary.record('rat', config).milestoneReached).toBeNull();
    expect(bestiary.record('rat', config)).toEqual({ kills: 3, milestoneReached: 1 });
    expect(bestiary.record('rat', config).milestoneReached).toBeNull();
    expect(bestiary.record('rat', config)).toEqual({ kills: 5, milestoneReached: 2 });
    expect(bestiary.record('rat', config).milestoneReached).toBeNull();
  });

  it('sem config o abate conta, mas não há marco a alcançar', () => {
    // A config é quem define marco, não quem autoriza contar: o conteúdo de teste sem
    // `bestiary/` continua contando, e o número está lá quando a config aparecer.
    const bestiary = new Bestiary();
    for (let i = 0; i < 5; i += 1) expect(bestiary.record('rat').milestoneReached).toBeNull();
    expect(bestiary.killsOf('rat')).toBe(5);
    expect(bestiary.milestonesReached()).toBe(0);
  });
});

describe('os marcos são GLOBAIS (DT-01)', () => {
  it('soma os marcos de todos os monstros', () => {
    // O PRD diz "XP PvE permanente", não "XP daquele monstro": um marco no rato vale para a XP
    // do morcego.
    const bestiary = Bestiary.fromState({ rat: 5, bat: 3, wolf: 2 });
    expect(bestiary.milestonesReached(config)).toBe(3);
  });

  it('um monstro abaixo do primeiro marco não contribui', () => {
    expect(Bestiary.fromState({ rat: 2 }).milestonesReached(config)).toBe(0);
  });

  it('acima do último marco conta todos, e só eles', () => {
    expect(Bestiary.fromState({ rat: 1_000 }).milestonesReached(config)).toBe(2);
  });
});

describe('o bônus de XP (percentual)', () => {
  it('cada marco acrescenta o que o conteúdo diz, somado sobre os monstros (DT-01)', () => {
    // Mutação que mata: contar os marcos do primeiro monstro só.
    expect(Bestiary.fromState({ rat: 5, bat: 3 }).xpBonusPercent(config)).toBe(3);
    const generous = { ...config, xpBonusPercentPerMilestone: 20 };
    expect(Bestiary.fromState({ rat: 3 }).xpBonusPercent(generous)).toBe(20);
  });

  it('sem config, e sem marco, não há bônus a somar', () => {
    expect(Bestiary.fromState({ rat: 1_000 }).xpBonusPercent()).toBe(0);
    expect(Bestiary.fromState({ rat: 2 }).xpBonusPercent(config)).toBe(0);
  });

  it('acima do último marco soma todos os marcos, e só eles', () => {
    const thirteen: BestiaryConfig = {
      milestones: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], xpBonusPercentPerMilestone: 1,
    };
    expect(Bestiary.fromState({ rat: 13 }).xpBonusPercent(thirteen)).toBe(13);
  });
});

describe('fundir extratos: abate nunca desce (DT-02)', () => {
  it('fica com o maior de cada monstro, e junta os que só um lado tem', () => {
    // Um extrato antigo, processado fora de ordem, não pode rebaixar um contador que já
    // subiu. É `Skills.merge` para uma grandeza mais simples.
    const old = { rat: 40, bat: 10 };
    const recent = { rat: 55, wolf: 3 };
    expect(Bestiary.merge(old, recent)).toEqual({ rat: 55, bat: 10, wolf: 3 });
    // E na ordem trocada o resultado é o MESMO — é isso que torna a fusão segura.
    expect(Bestiary.merge(recent, old)).toEqual({ rat: 55, bat: 10, wolf: 3 });
  });

  it('sem estado anterior, o que chega vale', () => {
    expect(Bestiary.merge(undefined, { rat: 7 })).toEqual({ rat: 7 });
  });

  it('não muda o que recebeu', () => {
    const current = { rat: 1 };
    Bestiary.merge(current, { rat: 9 });
    expect(current).toEqual({ rat: 1 });
  });
});

describe('estado', () => {
  it('atravessa ida e volta sem perder nada', () => {
    const bestiary = new Bestiary();
    bestiary.record('rat');
    bestiary.record('rat');
    bestiary.record('bat');
    const back = Bestiary.fromState(JSON.parse(JSON.stringify(bestiary.getState())));
    expect(back.getState()).toEqual(bestiary.getState());
    expect(back.killsOf('rat')).toBe(2);
  });

  it('ausente é vazio', () => {
    // O personagem e o snapshot anteriores à FUN-113 não têm a chave (DT-06).
    expect(Bestiary.fromState().getState()).toEqual({});
    expect(Bestiary.fromState(undefined).killsOf('rat')).toBe(0);
  });

  it('`getState` é uma CÓPIA: o abate seguinte não aparece no que já foi guardado', () => {
    const bestiary = Bestiary.fromState({ rat: 1 });
    const before = bestiary.getState();
    bestiary.record('rat');
    expect(before).toEqual({ rat: 1 });
    expect(bestiary.getState()).toEqual({ rat: 2 });
  });

  it('e `fromState` não fica preso ao objeto que recebeu', () => {
    const state: Record<string, number> = { rat: 1 };
    const bestiary = Bestiary.fromState(state);
    state['rat'] = 99;
    expect(bestiary.killsOf('rat')).toBe(1);
  });
});
