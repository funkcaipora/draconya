import { describe, expect, it } from 'vitest';
import type { Progression, Vocation } from '@draconya/content';
import { CharacterRuntime } from './character.js';
import {
  applyDeathPenalty, grantXp, levelForXp, statsForLevel, totalXpForLevel, xpToCompleteLevel,
} from './progression.js';

const baseline: Progression = {
  id: 'baseline',
  startingHealth: 150, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
  vocationLevel: 8, startingKit: [], satchelInitialSlots: 10, containerRow: 5,
  startingSpeed: 300, speedPerLevel: 2,
  regen: { healthPerSecond: 1, manaPerSecond: 1 },
  xp: { base: 20, exponent: 2 },
  deathPenalty: { fraction: 0.6, premiumFraction: 0.54, levelFloor: 8 },
};
const knight: Vocation = {
  id: 'knight', name: 'Knight', healthPerLevel: 20, manaPerLevel: 5, capacityPerLevel: 25, spellSkill: 'magic',
  startingKit: [],
};
const sorcerer: Vocation = {
  id: 'sorcerer', name: 'Sorcerer', healthPerLevel: 5, manaPerLevel: 25, capacityPerLevel: 10, spellSkill: 'magic',
  startingKit: [],
};

describe('statsForLevel', () => {
  it('gives the starting values at level 1', () => {
    // Quem começa não "subiu" para o level 1: o primeiro level não concede incremento.
    expect(statsForLevel(1, null, baseline)).toEqual({
      maxHealth: 150, maxMana: 0, capacity: 400, speed: 300,
    });
  });

  it('uses the baseline while the character has no vocation', () => {
    // Nasce sem vocação e escolhe no level 8 (§7.4): até lá, todo mundo cresce igual.
    expect(statsForLevel(8, null, baseline)).toEqual({
      maxHealth: 150 + 7 * 5, maxMana: 7 * 5, capacity: 400 + 7 * 10, speed: 300 + 7 * 2,
    });
  });

  it('applies the vocation only above the choosing level', () => {
    // Não é retroativo: os sete primeiros levels continuam valendo a base, e escolher a
    // vocação não muda o HP que o personagem já tinha.
    const noVocation = statsForLevel(8, null, baseline);
    const atNine = statsForLevel(9, knight, baseline);
    expect(atNine.maxHealth).toBe(noVocation.maxHealth + knight.healthPerLevel);
    expect(atNine.maxMana).toBe(noVocation.maxMana + knight.manaPerLevel);
  });

  it('separates the vocations where the table says it should', () => {
    const level = 20;
    const asKnight = statsForLevel(level, knight, baseline);
    const asSorcerer = statsForLevel(level, sorcerer, baseline);
    const afterChoice = level - baseline.vocationLevel;

    expect(asKnight.maxHealth - asSorcerer.maxHealth)
      .toBe(afterChoice * (knight.healthPerLevel - sorcerer.healthPerLevel));
    expect(asSorcerer.maxMana - asKnight.maxMana)
      .toBe(afterChoice * (sorcerer.manaPerLevel - knight.manaPerLevel));
  });

  it('keeps growing on the baseline for someone past the level who never chose', () => {
    // O §7.4 permite passar do 8 sem escolher. Travar o crescimento seria punição silenciosa.
    expect(statsForLevel(12, null, baseline).maxHealth).toBe(150 + 11 * 5);
  });

  it('follows the table, not the code', () => {
    // O teste que define a issue: dobrar o número no JSON dobra o resultado, sem tocar em
    // lógica. Se algum valor estivesse embutido aqui, isto falharia.
    const generous: Progression = { ...baseline, healthPerLevel: 10 };
    expect(statsForLevel(8, null, generous).maxHealth)
      .toBe(150 + 7 * 10);
    const tanky: Vocation = { ...knight, healthPerLevel: 40 };
    expect(statsForLevel(9, tanky, baseline).maxHealth)
      .toBe(statsForLevel(8, null, baseline).maxHealth + 40);
  });

  it('refuses a level that is not a positive integer', () => {
    expect(() => statsForLevel(0, null, baseline)).toThrow(/level/);
    expect(() => statsForLevel(1.5, null, baseline)).toThrow(/level/);
  });
});

// --- FUN-37 ---------------------------------------------------------------------------------

const hero = (over: Partial<{ level: number; xp: number; vocationId: string | null }> = {}) =>
  new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: 150, maxHealth: 150, mana: 0, maxMana: 0,
    level: over.level ?? 1, xp: over.xp ?? 0, vocationId: over.vocationId ?? null,
    goldDelta: 0, alive: true, cooldowns: {},
  });

/** Personagem coerente com a curva: no level pedido, com zero de progresso dentro dele. */
const atLevel = (level: number, vocationId: string | null = null): CharacterRuntime => {
  const character = hero({ level, xp: totalXpForLevel(level, baseline), vocationId });
  const stats = statsForLevel(level, vocationId === null ? null : knight, baseline);
  character.maxHealth = stats.maxHealth;
  character.health = stats.maxHealth;
  character.maxMana = stats.maxMana;
  character.mana = stats.maxMana;
  return character;
};

describe('curva de XP', () => {
  it('é fórmula, não tabela: mudar dois números muda a curva inteira', () => {
    // Tabela de 500 linhas nunca é rebalanceada, e a curva vai ser rebalanceada muitas vezes.
    const íngreme: Progression = { ...baseline, xp: { base: 20, exponent: 3 } };
    expect(xpToCompleteLevel(3, baseline)).toBe(180);
    expect(xpToCompleteLevel(3, íngreme)).toBe(540);
  });

  it('o level 1 é de graça: é onde todo mundo nasce', () => {
    expect(totalXpForLevel(1, baseline)).toBe(0);
    expect(levelForXp(0, baseline)).toBe(1);
  });

  it('acumula, e o level acompanha a XP total', () => {
    expect(totalXpForLevel(3, baseline)).toBe(20 + 80);
    expect(levelForXp(99, baseline)).toBe(2);
    expect(levelForXp(100, baseline)).toBe(3);
  });
});

describe('level up', () => {
  it('sobe de level e aplica os stats do level novo', () => {
    const character = atLevel(1);
    expect(grantXp(character, 20, null, baseline)).toEqual({ from: 1, to: 2 });
    expect(character.level).toBe(2);
    expect(character.maxHealth).toBe(statsForLevel(2, null, baseline).maxHealth);
  });

  it('sobe mais de um level de uma vez quando a XP cabe', () => {
    // Um abate de boss no level 1 não deveria parar no level 2 e jogar o resto fora.
    const character = atLevel(1);
    expect(grantXp(character, 1000, null, baseline)?.to).toBe(levelForXp(1000, baseline));
  });

  it('dá os pontos, não cura', () => {
    // Curar no level up faria "subir de level" virar poção grátis, e um bot morando na
    // fronteira de um level nunca mais morreria.
    const character = atLevel(1);
    character.health = 10;
    grantXp(character, 20, null, baseline);
    expect(character.health).toBe(10 + baseline.healthPerLevel);
  });

  it('segue a vocação do personagem, quando ele tem uma', () => {
    const cavaleiro = atLevel(9, 'knight');
    const semVocação = atLevel(9);
    grantXp(cavaleiro, xpToCompleteLevel(9, baseline), knight, baseline);
    grantXp(semVocação, xpToCompleteLevel(9, baseline), null, baseline);
    expect(cavaleiro.maxHealth).toBe(statsForLevel(10, knight, baseline).maxHealth);
    expect(semVocação.maxHealth).toBe(statsForLevel(10, null, baseline).maxHealth);
    expect(cavaleiro.maxHealth).toBeGreaterThan(semVocação.maxHealth);
  });
});

describe('penalidade de morte', () => {
  it('tira 60% da XP necessária para completar o level atual', () => {
    const character = atLevel(20);
    const esperado = Math.round(0.6 * xpToCompleteLevel(20, baseline));
    expect(applyDeathPenalty(character, { premium: false }, null, baseline).xpLost)
      .toBe(esperado);
  });

  it('tira 54% com Premium', () => {
    const character = atLevel(20);
    expect(applyDeathPenalty(character, { premium: true }, null, baseline).xpLost)
      .toBe(Math.round(0.54 * xpToCompleteLevel(20, baseline)));
  });

  it('pode rebaixar o level', () => {
    const character = atLevel(20);
    expect(applyDeathPenalty(character, { premium: false }, null, baseline).levelChange)
      .toEqual({ from: 20, to: 19 });
  });

  it('desce um level e para lá, com a curva que está no conteúdo hoje', () => {
    // Vale saber, e foi medido escrevendo estes testes: com `exponent: 2`, a penalidade
    // NUNCA cascateia acima do piso. Cascatear exige `0,6 × f(L) > f(L-1)`, e para a curva
    // quadrática isso só valeria abaixo do level 6 — onde o piso do 8 já protege. O código
    // trata cascata mesmo assim, porque a curva é conteúdo e vai ser rebalanceada.
    const character = atLevel(9);
    applyDeathPenalty(character, { premium: false }, null, baseline);
    expect(character.level).toBe(8);
    // Perdeu um level, não a XP toda: parou onde a perda o deixou, acima do piso.
    expect(character.xp).toBeGreaterThan(totalXpForLevel(8, baseline));
  });

  // Curva íngreme o bastante para a cascata acontecer de verdade. Não é a do conteúdo, e é
  // esse o ponto: é o teste que vai continuar valendo quando alguém rebalancear a curva.
  const íngreme: Progression = { ...baseline, xp: { base: 20, exponent: 8 } };

  it('CASCATEIA por mais de um level quando a perda passa do level inteiro', () => {
    // O caso que passa despercebido e só aparece com um jogador reclamando.
    const character = hero({ level: 12, xp: totalXpForLevel(12, íngreme) });
    const penalidade = applyDeathPenalty(character, { premium: false }, null, íngreme);
    expect(penalidade.levelChange?.to).toBeLessThan(11);
    expect(character.level).toBe(levelForXp(character.xp, íngreme));
  });

  it('nunca desce abaixo do level 8, e para nele com a XP EXATA do 8', () => {
    // O piso é de XP, não só de level: parar no 8 com XP negativa é um estado impossível que
    // dá erro estranho três sistemas adiante.
    const character = hero({ level: 9, xp: totalXpForLevel(9, íngreme) });
    applyDeathPenalty(character, { premium: false }, null, íngreme);
    expect(character.level).toBe(8);
    expect(character.xp).toBe(totalXpForLevel(8, íngreme));
  });

  it('o piso protege, e nunca promove', () => {
    // Escrito como `max` puro, o piso levantaria a XP de quem está no level 5 — um castigo
    // que dá level. Quem já está abaixo do piso não perde nada.
    const character = atLevel(5);
    const antes = character.xp;
    const penalidade = applyDeathPenalty(character, { premium: false }, null, baseline);
    expect(character.level).toBe(5);
    expect(character.xp).toBe(antes);
    expect(penalidade.xpLost).toBe(0);
  });

  it('nunca perde item, porque não existe nada disso aqui', () => {
    // §3.8: morte no Draconya nunca é perda material, e é o que elimina a necessidade de
    // qualquer sistema de recuperação de itens. O teste é a ausência: a penalidade mexe em
    // XP, level e stats derivados, e em mais nada.
    const character = atLevel(20);
    character.goldDelta = 500;
    applyDeathPenalty(character, { premium: false }, null, baseline);
    expect(character.goldDelta).toBe(500);
  });
});
