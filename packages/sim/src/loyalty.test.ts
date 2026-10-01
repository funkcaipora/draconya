import { describe, expect, it } from 'vitest';
import { loyaltySchema, skillSchema } from '@draconya/content';
import type { Skill } from '@draconya/content';
import { CharacterRuntime } from './character.js';
import { LoyaltyLevels, loyaltyBonusPercentOf, loyaltyPointsOf } from './loyalty.js';

// A tabela real do Canary (`data/libs/functions/player.lua:762-790`), como o conteúdo a carrega.
const loyalty = loyaltySchema.parse({
  id: 'baseline', enabled: true, pointsPerCreationDay: 1, bonusPercentageMultiplier: 1,
  tiers: [
    { minPoints: 360, percent: 5 }, { minPoints: 720, percent: 10 }, { minPoints: 1080, percent: 15 },
    { minPoints: 1440, percent: 20 }, { minPoints: 1800, percent: 25 }, { minPoints: 2160, percent: 30 },
    { minPoints: 2520, percent: 35 }, { minPoints: 2880, percent: 40 }, { minPoints: 3240, percent: 45 },
    { minPoints: 3600, percent: 50 },
  ],
});

// Espada de Knight (`skillBase[SKILL_SWORD] = 50`, multiplicador 1,1) e ML de Druid (`1600 ×
// 1,1^(ML-1)`): as duas curvas que o Canary usa, pelas duas formas de piso (10 e 0).
const sword: Skill = skillSchema.parse({
  id: 'sword', name: 'Espada', startingLevel: 10, curve: { base: 50, factor: 1.1 },
  gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.02,
});
const magic: Skill = skillSchema.parse({
  id: 'magic', name: 'Magia', startingLevel: 0, curve: { base: 1600, factor: 1.1 },
  gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0.03,
});

describe('pontos e degrau de Loyalty (a `api` calcula, o `sim` só oferece a conta pura)', () => {
  it('pontos são dias de conta × pontos por dia (loyaltyPointsPerCreationDay)', () => {
    expect(loyaltyPointsOf(loyalty, 0)).toBe(0);
    expect(loyaltyPointsOf(loyalty, 365)).toBe(365);
    expect(loyaltyPointsOf({ ...loyalty, pointsPerCreationDay: 2 }, 100)).toBe(200);
    // Relógio da conta à frente do da `api`: dias negativos valem zero, nunca pontos negativos.
    expect(loyaltyPointsOf(loyalty, -3)).toBe(0);
  });

  it('o degrau é o MAIOR cujo minPoints os pontos alcançam — e é inclusivo na borda', () => {
    expect(loyaltyBonusPercentOf(loyalty, 0)).toBe(0);
    expect(loyaltyBonusPercentOf(loyalty, 359)).toBe(0);
    expect(loyaltyBonusPercentOf(loyalty, 360)).toBe(5);
    expect(loyaltyBonusPercentOf(loyalty, 719)).toBe(5);
    expect(loyaltyBonusPercentOf(loyalty, 720)).toBe(10);
    expect(loyaltyBonusPercentOf(loyalty, 3599)).toBe(45);
    expect(loyaltyBonusPercentOf(loyalty, 3600)).toBe(50);
    // Acima do último degrau o bônus para em 50: não há degrau 11.
    expect(loyaltyBonusPercentOf(loyalty, 99_999)).toBe(50);
  });

  it('o multiplicador escala o percentual e é TRUNCADO (setLoyaltyBonus é uint16_t)', () => {
    // 5 × 1,5 = 7,5 → 7; 10 × 1,5 = 15.
    expect(loyaltyBonusPercentOf({ ...loyalty, bonusPercentageMultiplier: 1.5 }, 360)).toBe(7);
    expect(loyaltyBonusPercentOf({ ...loyalty, bonusPercentageMultiplier: 1.5 }, 720)).toBe(15);
    expect(loyaltyBonusPercentOf({ ...loyalty, bonusPercentageMultiplier: 0 }, 3600)).toBe(0);
  });

  it('sistema desligado (loyaltyEnabled = false) nunca dá bônus', () => {
    expect(loyaltyBonusPercentOf({ ...loyalty, enabled: false }, 3600)).toBe(0);
  });

  it('o schema recusa degraus fora de ordem — o laço do Canary assume ordem crescente', () => {
    const torto = loyaltySchema.safeParse({
      ...loyalty, tiers: [{ minPoints: 720, percent: 10 }, { minPoints: 360, percent: 5 }],
    });
    expect(torto.success).toBe(false);
  });
});

describe('tries → níveis extras (Player::getLoyaltySkill / getLoyaltyMagicLevel)', () => {
  it('sem bônus, ou com o piso da skill, o nível é o base', () => {
    const levels = new LoyaltyLevels();
    expect(levels.levelOf(sword, 50, 12, 0, 1.1)).toBe(50);
    // Nível 10 sem nada gasto: não há tries acumulados para o percentual incidir.
    expect(levels.levelOf(sword, 10, 0, 50, 1.1)).toBe(10);
    // Nível 10 com 20 tries: 50 % de 20 = 10 tries a mais, longe dos 50 que o nível 11 custa.
    expect(levels.levelOf(sword, 10, 20, 50, 1.1)).toBe(10);
  });

  it('o bônus é sobre TRIES, não sobre o nível: 50 % num skill 100 vale 4 níveis, não 50', () => {
    // Tries totais até o nível 100 da espada de Knight: 2.655.971. 50 % disso são 1.327.985
    // tries gratuitos — na curva real (sair do 100 custa 265.651, e cada nível seguinte 10 % a
    // mais) isso fecha 4 níveis, e não os 50 que "50 % do nível" daria. E 10 % (265.597 tries)
    // fica 54 tries abaixo do custo de sair do 100 (265.651): nenhum nível.
    const levels = new LoyaltyLevels();
    expect(levels.levelOf(sword, 100, 0, 50, 1.1)).toBe(104);
    expect(levels.levelOf(sword, 100, 0, 10, 1.1)).toBe(100);
    expect(levels.levelOf(sword, 100, 1000, 25, 1.1)).toBe(102);
    // No nível 12 (105 tries acumulados), 50 % rende um nível a mais e nada além.
    expect(levels.levelOf(sword, 12, 10, 50, 1.1)).toBe(13);
    expect(levels.levelOf(sword, 12, 10, 10, 1.1)).toBe(12);
  });

  it('os tries do nível corrente entram no total e no primeiro nível gasto', () => {
    const levels = new LoyaltyLevels();
    // Nível 60, 7 tries, 5 %: o bônus ainda é pouco para fechar o nível 60.
    expect(levels.levelOf(sword, 60, 7, 5, 1.1)).toBe(60);
    // Os mesmos 7 tries num nível 100 com 50 %: a soma cai em 104 (ver acima), e o resto de
    // tries que já existiam no nível não se perde — `have` entra no primeiro `>=`.
    expect(levels.levelOf(sword, 100, 7, 50, 1.1)).toBeGreaterThanOrEqual(104);
  });

  it('magic level: o piso é 0 e a curva é 1600 × mult^(ML-1) — mesma conta, outro piso', () => {
    const levels = new LoyaltyLevels();
    // ML 3 com 100 de mana gasta: 5 % não fecha o ML 3; 50 % (2.698 mana de graça, 669 de
    // resto depois de fechar o nível) leva ao ML 4.
    expect(levels.levelOf(magic, 3, 100, 5, 1.1)).toBe(3);
    expect(levels.levelOf(magic, 3, 100, 50, 1.1)).toBe(4);
    expect(levels.levelOf(magic, 100, 1_000_000, 50, 1.1)).toBe(104);
    // Knight (multiplicador 3,0): o custo é tão alto que 50 % ainda não fecha o ML 15.
    expect(levels.levelOf(magic, 15, 5000, 50, 3.0)).toBe(15);
    // ML 0 sem mana gasta não tem o que multiplicar.
    expect(levels.levelOf(magic, 0, 0, 50, 4.0)).toBe(0);
  });

  it('shielding e distance, com o `skillBase` deles (100 e 30), passam pela mesma conta', () => {
    const levels = new LoyaltyLevels();
    const shielding = skillSchema.parse({
      id: 'shielding', name: 'Escudo', startingLevel: 10, curve: { base: 100, factor: 1.1 },
      gain: { on: 'shield-block', points: 1 }, damagePerLevel: 0,
    });
    const distance = skillSchema.parse({
      id: 'distance', name: 'Distância', startingLevel: 10, curve: { base: 30, factor: 1.1 },
      gain: { on: 'distance-hit', points: 1 }, damagePerLevel: 0.02,
    });
    expect(levels.levelOf(shielding, 80, 50, 50, 1.1)).toBe(84);
    expect(levels.levelOf(distance, 90, 100, 40, 1.1)).toBe(93);
  });

  it('fator 1 é "nível máximo" no Canary (custo não cresce): o bônus não passa do base', () => {
    // `currReqTries >= nextReqTries` → "player has reached max skill". Com custo constante o
    // laço nunca fecharia um nível, e o Canary devolve o nível base em vez de iterar.
    const plana = skillSchema.parse({
      id: 'plana', name: 'Plana', startingLevel: 10, curve: { base: 50, factor: 1 },
      gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0,
    });
    expect(new LoyaltyLevels().levelOf(plana, 40, 10, 50, 1)).toBe(40);
  });

  it('bate com uma transcrição independente do Canary numa grade de níveis, tries e bônus', () => {
    // A referência é escrita nas FORMAS do Canary (`base × mult^(level − 11)` para skill,
    // `1600 × mult^(ML − 1)` para ML; totais em BigInt, como o `uint128`), e não reusa
    // `pointsForLevel` — se a conta de `LoyaltyLevels` derivasse do custo errado, os dois
    // discordariam.
    const reqSkill = (level: number, base: number, mult: number): bigint =>
      level <= 10 ? 0n : BigInt(Math.floor(base * mult ** (level - 11)));
    const reqMana = (level: number, mult: number): bigint =>
      level === 0 ? 0n : BigInt(Math.floor(1600 * mult ** (level - 1)));
    const total = (req: (level: number) => bigint, from: number, to: number): bigint => {
      let sum = 0n;
      for (let i = from; i <= to; i += 1) sum += req(i);
      return sum;
    };
    const reference = (
      req: (level: number) => bigint, from: number, level: number, tries: number, bonus: number,
    ): number => {
      let current = req(level);
      let next = req(level + 1);
      if (current >= next) return level;
      let have = BigInt(tries);
      let bonusTries = ((total(req, from, level) + have) * BigInt(bonus)) / 100n;
      let result = level;
      while (have + bonusTries >= next) {
        bonusTries -= next - have;
        result += 1;
        have = 0n;
        current = next;
        next = req(result + 1);
        if (current >= next) break;
      }
      return result;
    };

    const levels = new LoyaltyLevels();
    for (const mult of [1.1, 1.4, 2, 3]) {
      const skill = { ...sword, curve: { base: 50, factor: mult } };
      const mana = { ...magic, curve: { base: 1600, factor: mult } };
      for (const level of [10, 11, 25, 60, 100, 130]) {
        for (const tries of [0, 1, 37, 900, 40_000]) {
          for (const bonus of [5, 25, 50]) {
            expect(levels.levelOf(skill, level, tries, bonus, mult), `skill ${String(mult)}/${String(level)}/${String(tries)}/${String(bonus)}`)
              .toBe(reference((l) => reqSkill(l, 50, mult), 10, level, tries, bonus));
          }
        }
      }
      for (const level of [0, 1, 5, 20, 60]) {
        for (const spent of [0, 1, 1_000, 900_000]) {
          for (const bonus of [5, 25, 50]) {
            expect(levels.levelOf(mana, level, spent, bonus, mult), `ml ${String(mult)}/${String(level)}/${String(spent)}/${String(bonus)}`)
              .toBe(reference((l) => reqMana(l, mult), 1, level, spent, bonus));
          }
        }
      }
    }
  });

  it('o cache por nível não muda a resposta: chamar de novo, e depois de subir de nível, é igual', () => {
    const levels = new LoyaltyLevels();
    const first = levels.levelOf(sword, 80, 500, 30, 1.1);
    expect(levels.levelOf(sword, 80, 500, 30, 1.1)).toBe(first);
    // Um nível abaixo reaproveita o prefixo já calculado; um nível acima o estende.
    expect(levels.levelOf(sword, 79, 500, 30, 1.1)).toBe(new LoyaltyLevels().levelOf(sword, 79, 500, 30, 1.1));
    expect(levels.levelOf(sword, 90, 500, 30, 1.1)).toBe(new LoyaltyLevels().levelOf(sword, 90, 500, 30, 1.1));
    // Outro fator (a vocação mudou) não reaproveita o prefixo do anterior.
    expect(levels.levelOf(sword, 80, 500, 30, 1.2)).toBe(new LoyaltyLevels().levelOf(sword, 80, 500, 30, 1.2));
  });
});

describe('CharacterRuntime: o bônus é fixado, entra no snapshot e não toca no dado persistido', () => {
  const state = {
    id: 'hero', position: { x: 0, y: 0, z: 7 }, health: 100, maxHealth: 100, mana: 0, maxMana: 0,
    level: 50, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
    skills: { sword: { level: 100, points: 1000 } },
  };

  it('sem bônus, o nível efetivo é o base e o estado não carrega a chave', () => {
    const hero = new CharacterRuntime(state);
    expect(hero.loyaltyBonusPercent).toBe(0);
    expect(hero.loyaltyLevelOf(sword, 1.1)).toBe(100);
    expect('loyaltyBonusPercent' in hero.getState()).toBe(false);
  });

  it('com bônus, o nível efetivo sobe e o nível/tries persistidos continuam os de sempre', () => {
    const hero = new CharacterRuntime({ ...state, loyaltyBonusPercent: 25 });
    expect(hero.loyaltyLevelOf(sword, 1.1)).toBe(102);
    // O dado que o extrato e o snapshot levam NÃO sabe que o bônus existe.
    expect(hero.skills.getState()['sword']).toEqual({ level: 100, points: 1000 });
    expect(hero.skills.levelOf(sword)).toBe(100);
  });

  it('atravessa o snapshot: getState → construtor devolve o mesmo bônus', () => {
    const hero = new CharacterRuntime({ ...state, loyaltyBonusPercent: 25 });
    const restored = new CharacterRuntime(hero.getState());
    expect(restored.loyaltyBonusPercent).toBe(25);
    expect(restored.loyaltyLevelOf(sword, 1.1)).toBe(102);
  });

  it('valor torto (fracionário, negativo, NaN) vira inteiro não negativo, nunca NaN na conta', () => {
    expect(new CharacterRuntime({ ...state, loyaltyBonusPercent: 12.9 }).loyaltyBonusPercent).toBe(12);
    expect(new CharacterRuntime({ ...state, loyaltyBonusPercent: -5 }).loyaltyBonusPercent).toBe(0);
    expect(new CharacterRuntime({ ...state, loyaltyBonusPercent: Number.NaN }).loyaltyBonusPercent).toBe(0);
  });

  it('acompanha o uso: ganhar tries muda o nível efetivo, e o nível base só muda ao fechar o nível', () => {
    const hero = new CharacterRuntime({ ...state, loyaltyBonusPercent: 50 });
    const before = hero.loyaltyLevelOf(sword, 1.1);
    // Sair do 100 custa 265.651 (já há 1.000 tries): 270.000 fecham o nível base.
    hero.skills.gain(sword, 270_000, 1.1);
    expect(hero.skills.levelOf(sword)).toBe(101);
    expect(hero.loyaltyLevelOf(sword, 1.1)).toBeGreaterThanOrEqual(before);
  });
});
