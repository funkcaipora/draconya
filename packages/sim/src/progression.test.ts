import { describe, expect, it } from 'vitest';
import type { Progression, Vocation } from '@draconya/content';
import { statsForLevel } from './progression.js';

const baseline: Progression = {
  id: 'baseline',
  startingHealth: 150, startingMana: 0, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10,
  vocationLevel: 8,
  stepDurationMs: 500,
};
const knight: Vocation = {
  id: 'knight', name: 'Knight', healthPerLevel: 20, manaPerLevel: 5, capacityPerLevel: 25,
};
const sorcerer: Vocation = {
  id: 'sorcerer', name: 'Sorcerer', healthPerLevel: 5, manaPerLevel: 25, capacityPerLevel: 10,
};

describe('statsForLevel', () => {
  it('gives the starting values at level 1', () => {
    // Quem começa não "subiu" para o level 1: o primeiro level não concede incremento.
    expect(statsForLevel(1, null, baseline)).toEqual({
      maxHealth: 150, maxMana: 0, capacity: 400,
    });
  });

  it('uses the baseline while the character has no vocation', () => {
    // Nasce sem vocação e escolhe no level 8 (§7.4): até lá, todo mundo cresce igual.
    expect(statsForLevel(8, null, baseline)).toEqual({
      maxHealth: 150 + 7 * 5, maxMana: 7 * 5, capacity: 400 + 7 * 10,
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
