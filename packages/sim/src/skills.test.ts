import { describe, expect, it } from 'vitest';
import { skillSchema } from '@draconya/content';
import { Skills, pointsForLevel, powerMultiplier } from './skills.js';

const melee = skillSchema.parse({
  id: 'melee', name: 'Corpo a Corpo', startingLevel: 10,
  curve: { base: 50, factor: 1.1 },
  gain: { on: 'melee-hit', points: 1 },
  damagePerLevel: 0.02,
});

const magic = skillSchema.parse({
  id: 'magic', name: 'Magia', startingLevel: 0,
  curve: { base: 100, factor: 1 },
  gain: { on: 'spell-cast', pointsPerMana: 1 },
});

describe('a curva vem do CONTEÚDO, e é fórmula', () => {
  it('o custo do primeiro nível é a base, e cresce pelo fator', () => {
    // Fórmula e não tabela pela mesma razão que a curva de XP é fórmula: tabela precisa ter
    // fim, e o fim vira o teto acidental que ninguém decidiu.
    expect(pointsForLevel(melee, 10)).toBe(50);
    expect(pointsForLevel(melee, 11)).toBe(55);
    // `50 * 1.1^2` é exatamente 60,5 — TRUNCADO para 60, não arredondado para 61 (ver o teste
    // de truncação logo abaixo).
    expect(pointsForLevel(melee, 12)).toBe(60);
  });

  it('o custo é INTEIRO, e por isso o resto não acumula lixo', () => {
    // `50 * 1.1` é `55.000000000000007` em ponto flutuante. Sem inteirar, o resto que sobra
    // ao fechar um nível carrega esse lixo para o próximo, e numa hunt de oito horas são
    // milhares de níveis de resíduo somado — a armadilha que o `AGENTS.md` deste pacote
    // registra sobre acumular `0,1` dez vezes.
    for (let level = 10; level < 60; level += 1) {
      expect(Number.isInteger(pointsForLevel(melee, level))).toBe(true);
    }
    const skills = new Skills();
    // Cem níveis de uso, um ponto por vez: com custo fracionário, os pontos guardados sairiam
    // de zero e o nível chegaria diferente.
    let gasto = 0;
    for (let level = 10; level < 40; level += 1) gasto += pointsForLevel(melee, level);
    for (let i = 0; i < gasto; i += 1) skills.gain(melee, 1);
    expect(skills.getState()['melee']).toEqual({ level: 40, points: 0 });
  });

  it('TRUNCA, não arredonda — como o Canary (revisão da #521)', () => {
    // `Vocation::getReqSkillTries` faz `static_cast<uint64_t>(base * pow(mult, steps))`, e
    // `Vocation::getReqMana` faz `std::floor<uint64_t>(1600 * pow(mult, ml - 1))` — as duas
    // TRUNCAM, nunca arredondam para cima. Um Knight (multiplicador de melee 1,1) subindo do
    // level 15 para o 16 precisa de `floor(50 × 1,1⁵) = floor(80,5255…) = 80` tries no Canary;
    // `Math.round` pedia 81 — um a mais, em toda vocação cujo fator não cai numa potência
    // inteira exata (o caso comum: só coincidências como fator 2,0 escapavam).
    expect(pointsForLevel(melee, 15, 1.1)).toBe(80);
    // A mesma conta pela função de fator explícito (a forma que `skillFactorFor` alimenta):
    // nunca arredonda para cima do valor exato truncado.
    expect(Math.floor(50 * 1.1 ** 5)).toBe(80);
    expect(pointsForLevel(melee, 15, 1.1)).not.toBe(Math.round(50 * 1.1 ** 5));
  });

  it('o expoente conta a partir do nível INICIAL, não do zero', () => {
    // Sem isso, uma skill que começa em 10 cobraria pelo décimo nível já no primeiro uso — e
    // "corpo a corpo começa em 10" viraria "corpo a corpo é impossível de subir".
    expect(pointsForLevel(melee, 10)).toBe(melee.curve.base);
    expect(pointsForLevel(magic, 0)).toBe(magic.curve.base);
  });

  it('abaixo do inicial não cobra menos que o primeiro nível', () => {
    // Estado corrompido, não caminho normal. O que importa é não devolver custo ridículo que
    // faria a skill disparar vinte níveis num golpe.
    expect(pointsForLevel(melee, 3)).toBe(melee.curve.base);
  });
});

describe('subir pelo USO', () => {
  it('skill nunca usada vale o nível inicial, e não ocupa lugar no snapshot', () => {
    const skills = new Skills();
    expect(skills.levelOf(melee)).toBe(10);
    // Gravar o nível inicial de toda skill em todo personagem é encher o snapshot com o
    // valor padrão.
    expect(skills.getState()).toEqual({});
  });

  it('acumula pontos e sobe quando eles fecham o nível', () => {
    const skills = new Skills();
    expect(skills.gain(melee, 49)).toBe(0);
    expect(skills.levelOf(melee)).toBe(10);

    expect(skills.gain(melee, 1)).toBe(1);
    expect(skills.levelOf(melee)).toBe(11);
    // O que sobrou não some: zerar o resto a cada nível faria a skill subir mais devagar do
    // que a curva diz, e ninguém ligaria uma coisa à outra.
    expect(skills.getState()['melee']?.points).toBe(0);

    expect(skills.gain(melee, 60)).toBe(1);
    expect(skills.getState()['melee']).toEqual({ level: 12, points: 5 });
    expect(Number.isInteger(skills.getState()['melee']?.points)).toBe(true);
  });

  it('um monte de pontos de uma vez sobe VÁRIOS níveis', () => {
    // Não é o caso normal — um golpe não sobe dois níveis —, é o extrato antigo sendo
    // aplicado. O laço existe porque a curva é exponencial e não tem forma fechada barata.
    const skills = new Skills();
    expect(skills.gain(magic, 350)).toBe(3);
    expect(skills.levelOf(magic)).toBe(3);
    expect(skills.getState()['magic']?.points).toBe(50);
  });

  it('ganho zero ou negativo não mexe em nada', () => {
    const skills = new Skills();
    expect(skills.gain(melee, 0)).toBe(0);
    expect(skills.gain(melee, -10)).toBe(0);
    expect(skills.getState()).toEqual({});
  });

  it('o estado atravessa ida e volta sem perder nada', () => {
    const skills = new Skills();
    skills.gain(melee, 120);
    const voltou = Skills.fromState(JSON.parse(JSON.stringify(skills.getState())));
    expect(voltou.getState()).toEqual(skills.getState());
  });
});

describe('fundir extratos: skill nunca desce', () => {
  it('fica com o maior nível de cada skill', () => {
    // Um extrato antigo, processado fora de ordem, não pode rebaixar o que já subiu. É a
    // preocupação da guarda de instante da stamina, resolvida sem instante nenhum porque a
    // grandeza é monotônica.
    const antigo = { melee: { level: 11, points: 40 }, magic: { level: 2, points: 0 } };
    const novo = { melee: { level: 13, points: 5 } };

    expect(Skills.merge(antigo, novo)).toEqual({
      melee: { level: 13, points: 5 },
      magic: { level: 2, points: 0 },
    });
    // E na ordem trocada o resultado é o MESMO — é isso que torna a fusão segura.
    expect(Skills.merge(novo, antigo)).toEqual({
      melee: { level: 13, points: 5 },
      magic: { level: 2, points: 0 },
    });
  });

  it('empatado no nível, mais pontos ganha', () => {
    expect(Skills.merge({ melee: { level: 11, points: 10 } }, { melee: { level: 11, points: 30 } }))
      .toEqual({ melee: { level: 11, points: 30 } });
  });

  it('sem estado anterior, o que chega vale', () => {
    expect(Skills.merge(undefined, { melee: { level: 11, points: 0 } }))
      .toEqual({ melee: { level: 11, points: 0 } });
  });
});

describe('a contribuição no dano', () => {
  it('no nível inicial a skill não muda nada', () => {
    expect(powerMultiplier(melee, 10)).toBe(1);
  });

  it('cada nível acima do inicial acrescenta o que o conteúdo diz', () => {
    expect(powerMultiplier(melee, 15)).toBeCloseTo(1.1);
    // `damagePerLevel` zero é skill que não bate — a de magia deste teste, por exemplo.
    expect(powerMultiplier(magic, 30)).toBe(1);
  });
});

describe('o progresso até o próximo nível (progressOf, #340, SV-04)', () => {
  it('skill nunca usada devolve nível inicial e percentual zero', () => {
    const skills = new Skills();
    expect(skills.progressOf(melee)).toEqual({ level: 10, percentToNext: 0 });
    expect(skills.progressOf(magic)).toEqual({ level: 0, percentToNext: 0 });
  });

  it('skill parcialmente usada calcula o percentual inteiro (ex.: 50/100 -> 50%)', () => {
    const skills = new Skills();
    skills.gain(magic, 50); // magic level 0 precisa de 100 pontos
    expect(skills.progressOf(magic)).toEqual({ level: 0, percentToNext: 50 });
  });

  it('arredonda para baixo via piso (ex.: 99.6% -> 99%)', () => {
    const precisionSkill = skillSchema.parse({
      id: 'precision', name: 'Precisão', startingLevel: 1,
      curve: { base: 1000, factor: 1 },
      gain: { on: 'melee-hit', points: 1 },
    });
    const skills = new Skills();
    skills.gain(precisionSkill, 996); // 996 / 1000 = 99.6% -> floor 99
    expect(skills.progressOf(precisionSkill)).toEqual({ level: 1, percentToNext: 99 });
  });

  it('limita em no máximo 99% enquanto o nível não fecha', () => {
    const skills = new Skills();
    skills.gain(melee, 49); // melee nível 10 precisa de 50 pontos -> 49/50 = 98%
    expect(skills.progressOf(melee)).toEqual({ level: 10, percentToNext: 98 });

    const highCostSkill = skillSchema.parse({
      id: 'high-cost', name: 'Custo Alto', startingLevel: 1,
      curve: { base: 1000, factor: 1 },
      gain: { on: 'melee-hit', points: 1 },
    });
    const highCostSkills = new Skills();
    highCostSkills.gain(highCostSkill, 999);
    expect(highCostSkills.progressOf(highCostSkill)).toEqual({ level: 1, percentToNext: 99 });

    // Cap em 99 se pontos >= needed
    const directState = Skills.fromState({
      melee: { level: 10, points: 50 },
    });
    expect(directState.progressOf(melee)).toEqual({ level: 10, percentToNext: 99 });
  });
});

