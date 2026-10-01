// O Hazard em combate (M44-14, #632): os números do `player.cpp`/`game.cpp`/`ondroploot_hazard.lua`
// do Canary (`47dfd51`) por nível, e a ORDEM das rolagens. Os sorteios são CONTROLADOS — a normal
// truncada de `normal_random` é produzida a partir de duas frações escolhidas à mão —, porque o que
// este arquivo prende é a fórmula e a posição de cada rolagem, não a probabilidade (essa é a soma
// das duas coisas e sai da estatística medida no fim).

import type { Hazard, HazardZone } from '@draconya/content';
import { describe, expect, it, vi } from 'vitest';
import { Rng } from '../rng.js';
import type { DamageOutcome } from './damage.js';
import {
  applyHazardToMonsterHit, applyHazardToPlayerHit, hazardExperience, hazardLootRolls,
} from './hazard.js';
import { normalRandomInt } from './weapon-power.js';

/** Os multiplicadores do `config.lua.dist` do Canary — o mesmo de `hazard/baseline.json`. */
const HAZARD: Hazard = {
  id: 'baseline', criticalIntervalMs: 2000, criticalChance: 750, criticalMultiplier: 25,
  damageMultiplier: 200, defenseMultiplier: 0, dodgeMultiplier: 85, expBonusMultiplier: 2,
  lootBonusMultiplier: 2, podDropMultiplier: 87, plunderSpawnMultiplier: 25,
  zones: {},
};
const ZONE: HazardZone = {
  name: 'Gnomprona Gardens', minLevel: 1, maxLevel: 12,
  crit: true, dodge: true, damageBoost: true, defenseBoost: true,
};

function outcomeOf(
  primary: number, secondary?: number, over: Partial<DamageOutcome> = {},
): DamageOutcome {
  const base = {
    profile: 'combat-v4',
    intent: { rawDamage: primary, source: 'monster-attack', damageType: 'physical' },
    damageType: 'physical', afterDefense: primary, afterArmor: primary, armorReduction: 0,
    minimumDamage: 0, afterResistance: primary, immune: false, dodged: false, critical: false,
    resolvedDamage: primary,
    ...(secondary === undefined ? {} : {
      secondaryOutcome: {
        profile: 'combat-v4',
        intent: { rawDamage: secondary, source: 'monster-attack', damageType: 'fire' },
        damageType: 'fire', afterDefense: secondary, afterArmor: secondary, armorReduction: 0,
        minimumDamage: 0, afterResistance: secondary, immune: false, dodged: false, critical: false,
        resolvedDamage: secondary,
      },
    }),
    ...over,
  };
  return base as unknown as DamageOutcome;
}

/**
 * Faz o PRÓXIMO `normalRandomInt(rng, min, max)` devolver exatamente `target`: escolhe a normal
 * truncada `v = (target − min) / (max − min)` e as duas frações de Box-Muller que a produzem
 * (`z = (v − 0,5) / 0,25`; `z < 0` pede `cos = −1`, `z ≥ 0` pede `cos = +1`).
 */
function rollNext(rng: Rng, min: number, max: number, target: number): void {
  const v = (target - min) / (max - min);
  const z = (v - 0.5) / 0.25;
  const u1 = Math.exp(-(z * z) / 2);
  const u2 = z < 0 ? 0.5 : 0;
  vi.spyOn(rng, 'fraction').mockReturnValueOnce(u1).mockReturnValueOnce(u2);
}

describe('rollNext: o auxiliar controla a rolagem de verdade', () => {
  it.each([1, 85, 86, 750, 751, 5000, 10_000])('normal_random(1, 10000) devolve %i', (target) => {
    const rng = Rng.fromSeed('helper');
    rollNext(rng, 1, 10_000, target);
    expect(normalRandomInt(rng, 1, 10_000)).toBe(target);
  });
});

describe('o golpe de monstro de hazard no jogador (parseAttackRecvHazardSystem)', () => {
  const hit = (
    outcome: DamageOutcome, points: number, roll: number, over: {
      zone?: HazardZone; hazard?: Hazard; nowMs?: number; lastCriticalAtMs?: number | null;
    } = {},
  ) => {
    const rng = Rng.fromSeed('recv');
    rollNext(rng, 1, 10_000, roll);
    return applyHazardToMonsterHit(
      outcome, points, over.hazard ?? HAZARD, over.zone ?? ZONE, rng, over.nowMs ?? 10_000,
      over.lastCriticalAtMs ?? null,
    );
  };

  it('o crítico soma 50 % mais 0,25 % por nível acima do primeiro, e o reforço vem SOBRE o crítico', () => {
    // Nível 1: +ceil(100 × 5000/10000) = 50 → 150; reforço 200 → +ceil(150 × 200/10000) = 3 → 153.
    const one = hit(outcomeOf(100), 1, 750);
    expect(one.outcome.resolvedDamage).toBe(153);
    expect(one.outcome.critical).toBe(true);
    expect(one.extension).toBe(true);
    expect(one.criticalAtMs).toBe(10_000);
    // Nível 12: crítico +ceil(100 × 5275/10000) = 53 → 153; reforço 2400 → +ceil(153 × 0,24) = 37 → 190.
    expect(hit(outcomeOf(100), 12, 750).outcome.resolvedDamage).toBe(190);
    // Nível 5: crítico (5000 + 4 × 25 = 5100) → 51 → 151; reforço 1000 → ceil(15,1) = 16 → 167.
    expect(hit(outcomeOf(100), 5, 1).outcome.resolvedDamage).toBe(167);
  });

  it('sem crítico, só o reforço de dano: nível × 200 em 10000, arredondado PARA CIMA', () => {
    const plain = hit(outcomeOf(100), 1, 751);
    expect(plain.outcome.resolvedDamage).toBe(102);
    expect(plain.outcome.critical).toBe(false);
    expect(plain.extension).toBe(true);
    expect(plain.criticalAtMs).toBeNull();
    expect(hit(outcomeOf(100), 12, 751).outcome.resolvedDamage).toBe(124);
    // 7 de dano no nível 1: ceil(7 × 200/10000) = ceil(0,14) = 1 — o "para cima" nunca deixa zero.
    expect(hit(outcomeOf(7), 1, 751).outcome.resolvedDamage).toBe(8);
  });

  it('leva o dano de ANTES do reforço, que é o teto da mana shield (`healthChange` do Canary, #632)', () => {
    const boosted = hit(outcomeOf(100), 12, 751);
    expect(boosted.outcome.resolvedDamage).toBe(124);
    expect(boosted.outcome.preHazardDamage).toBe(100);
    // Com crítico o de antes continua sendo o valor ANTES de tudo (o crítico também é do Hazard).
    expect(hit(outcomeOf(100), 12, 750).outcome.preHazardDamage).toBe(100);
    // Sem o estágio ter mexido no golpe, o outcome sai o MESMO objeto e sem o campo.
    const untouched = hit(outcomeOf(100), 12, 751, { zone: { ...ZONE, crit: false, damageBoost: false } });
    expect(untouched.outcome).not.toHaveProperty('preHazardDamage');
  });

  it('o componente secundário também cresce, e o secundário zero continua zero', () => {
    const both = hit(outcomeOf(100, 40), 1, 751);
    expect(both.outcome.resolvedDamage).toBe(102);
    expect(both.outcome.secondaryOutcome?.resolvedDamage).toBe(41);
    const crit = hit(outcomeOf(100, 40), 1, 1);
    // Crítico: 40 + ceil(40 × 0,5) = 60; reforço: 60 + ceil(60 × 0,02) = 62.
    expect(crit.outcome.secondaryOutcome?.resolvedDamage).toBe(62);
    const none = hit(outcomeOf(100, 0), 1, 1);
    expect(none.outcome.secondaryOutcome?.resolvedDamage).toBe(0);
  });

  it('o crítico respeita o intervalo: só depois de hazardCriticalInterval desde o último', () => {
    const at = (nowMs: number) => hit(outcomeOf(100), 1, 1, { nowMs, lastCriticalAtMs: 1000 });
    expect(at(2999).outcome.critical).toBe(false);
    expect(at(2999).criticalAtMs).toBeNull();
    // `lastCritical + intervalo <= agora`: o instante exato conta.
    expect(at(3000).outcome.critical).toBe(true);
    expect(at(3000).criticalAtMs).toBe(3000);
    // Nunca criticou (`null`): pronto desde o instante zero, que não é "há 2 s".
    expect(hit(outcomeOf(100), 1, 1, { nowMs: 0, lastCriticalAtMs: null }).outcome.critical).toBe(true);
  });

  it('a rolagem é SEMPRE consumida, e o crítico sorteia um número na faixa de 1 a 10000', () => {
    const rng = Rng.fromSeed('draws');
    const spy = vi.spyOn(rng, 'fraction');
    const monster = (zone: HazardZone) => applyHazardToMonsterHit(
      outcomeOf(100), 1, HAZARD, zone, rng, 10_000, null,
    );
    monster({ ...ZONE, crit: false });
    // Duas frações por tentativa da normal truncada (Box-Muller): uma rolagem.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const before = spy.mock.calls.length;
    monster({ ...ZONE, crit: false, damageBoost: false });
    expect(spy.mock.calls.length).toBeGreaterThan(before);
  });

  it('o crítico desligado na zona ou a rolagem acima da chance não critica', () => {
    const noCrit = hit(outcomeOf(100), 1, 1, { zone: { ...ZONE, crit: false } });
    expect(noCrit.outcome.critical).toBe(false);
    expect(noCrit.outcome.resolvedDamage).toBe(102);
    expect(hit(outcomeOf(100), 1, 751).outcome.critical).toBe(false);
  });

  it('zona sem crítico nem reforço não muda o golpe e não é extensão', () => {
    const zone = { ...ZONE, crit: false, damageBoost: false };
    const plain = hit(outcomeOf(100), 4, 1, { zone });
    expect(plain.outcome.resolvedDamage).toBe(100);
    expect(plain.extension).toBe(false);
  });

  it('nível zero, dano zero e dreno de mana não são tocados (e não gastam sorteio)', () => {
    for (const outcome of [outcomeOf(100), outcomeOf(0), outcomeOf(100, undefined, { damageType: 'manadrain' })]) {
      const rng = Rng.fromSeed('untouched');
      const spy = vi.spyOn(rng, 'fraction');
      const points = outcome.resolvedDamage === 100 && outcome.damageType !== 'manadrain' ? 0 : 3;
      const result = applyHazardToMonsterHit(outcome, points, HAZARD, ZONE, rng, 10_000, null);
      expect(result.outcome).toBe(outcome);
      expect(result.extension).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('o valor do Canary é configurável: o multiplicador do reforço zerado some com a extensão', () => {
    const hazard = { ...HAZARD, damageMultiplier: 0 };
    const result = hit(outcomeOf(100), 3, 751, { hazard });
    expect(result.outcome.resolvedDamage).toBe(100);
    expect(result.extension).toBe(false);
  });
});

describe('o golpe do jogador no monstro de hazard (parseAttackDealtHazardSystem)', () => {
  const swing = (
    outcome: DamageOutcome, points: number, roll: number, over: { zone?: HazardZone; hazard?: Hazard } = {},
  ) => {
    const rng = Rng.fromSeed('dealt');
    rollNext(rng, 1, 10_000, roll);
    return applyHazardToPlayerHit(outcome, points, over.hazard ?? HAZARD, over.zone ?? ZONE, rng);
  };

  it('esquiva quando a rolagem <= nível × 85 — o golpe inteiro some', () => {
    const dodged = swing(outcomeOf(100, 40), 1, 85);
    expect(dodged.dodged).toBe(true);
    expect(dodged.outcome.resolvedDamage).toBe(0);
    expect(dodged.outcome.secondaryOutcome?.resolvedDamage).toBe(0);
    expect(swing(outcomeOf(100), 1, 86).dodged).toBe(false);
    expect(swing(outcomeOf(100), 12, 1020).dodged).toBe(true);
    expect(swing(outcomeOf(100), 12, 1021).dodged).toBe(false);
  });

  it('o golpe esquivado guarda o que o blockHit decidiu (reflexo, cura): só o dano vai a zero', () => {
    const reflected = { amount: 5 } as unknown as DamageOutcome['reflected'];
    const dodged = swing(outcomeOf(100, undefined, { reflected, elementHealing: 7 } as Partial<DamageOutcome>), 1, 1);
    expect(dodged.outcome.reflected).toBe(reflected);
    expect(dodged.outcome.elementHealing).toBe(7);
  });

  it('a defesa da zona é zero no Canary (defenseMultiplier 0): o golpe que não esquivou passa igual', () => {
    const passed = swing(outcomeOf(100, 40), 12, 10_000);
    expect(passed.dodged).toBe(false);
    expect(passed.outcome.resolvedDamage).toBe(100);
    expect(passed.outcome.secondaryOutcome?.resolvedDamage).toBe(40);
  });

  it('com defenseMultiplier configurado o dano cai nível × isto em 10000, arredondado para cima', () => {
    const hazard = { ...HAZARD, defenseMultiplier: 100 };
    // Nível 3: estágio 300 → −ceil(100 × 0,03) = −3; secundário 40 → −ceil(1,2) = −2.
    const reduced = swing(outcomeOf(100, 40), 3, 10_000, { hazard });
    expect(reduced.outcome.resolvedDamage).toBe(97);
    expect(reduced.outcome.secondaryOutcome?.resolvedDamage).toBe(38);
    // A esquiva vem ANTES da defesa e encerra.
    expect(swing(outcomeOf(100), 3, 1, { hazard }).dodged).toBe(true);
  });

  it('a esquiva desligada na zona não rola nem esquiva; nível zero e dano zero não entram', () => {
    const rng = Rng.fromSeed('no-dodge');
    const spy = vi.spyOn(rng, 'fraction');
    const zone = { ...ZONE, dodge: false };
    expect(applyHazardToPlayerHit(outcomeOf(100), 12, HAZARD, zone, rng).dodged).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(applyHazardToPlayerHit(outcomeOf(100), 0, HAZARD, ZONE, rng).dodged).toBe(false);
    expect(applyHazardToPlayerHit(outcomeOf(0), 5, HAZARD, ZONE, rng).dodged).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('a XP com o bônus de hazard (Player::addExperience)', () => {
  it('soma 1,75 × nível × 2 por cento e TRUNCA (o exp do Canary é uint64)', () => {
    expect(hazardExperience(100, 1, HAZARD)).toBe(103);
    expect(hazardExperience(100, 12, HAZARD)).toBe(142);
    // 10 + 10 × 10,5 / 100 = 11,05 → 11.
    expect(hazardExperience(10, 3, HAZARD)).toBe(11);
    // 12 690 × 3,5 % = 444,15 → 13 134,15 → 13 134.
    expect(hazardExperience(12_690, 1, HAZARD)).toBe(13_134);
    expect(hazardExperience(5, 1, HAZARD)).toBe(5);
  });

  it('nível zero não muda nada, e o multiplicador é configurável', () => {
    expect(hazardExperience(100, 0, HAZARD)).toBe(100);
    expect(hazardExperience(100, 1, { ...HAZARD, expBonusMultiplier: 4 })).toBe(107);
  });
});

describe('as rolagens extras de loot (ondroploot_hazard.lua)', () => {
  /** Faz `rng.integer(0, 100)` devolver `roll`: a fração que cai no balde certo. */
  function rollInteger(rng: Rng, roll: number): void {
    vi.spyOn(rng, 'fraction').mockReturnValueOnce((roll + 0.5) / 101);
  }

  it('rolls = 2 × nível × 2 / 100, e a parte fracionária decide o arredondamento por UMA rolagem', () => {
    const at = (points: number, roll: number) => {
      const rng = Rng.fromSeed('loot');
      rollInteger(rng, roll);
      return hazardLootRolls(rng, points, HAZARD);
    };
    // Nível 12: rolls 0,48 → teto quando a rolagem (0..100) < 48.
    expect(at(12, 47)).toBe(1);
    expect(at(12, 48)).toBe(0);
    // Nível 1: rolls 0,04 → teto só com 0..3.
    expect(at(1, 3)).toBe(1);
    expect(at(1, 4)).toBe(0);
  });

  it('sempre consome UMA rolagem (mesmo sem parte fracionária), e nível zero não consome', () => {
    const rng = Rng.fromSeed('draw-count');
    const spy = vi.spyOn(rng, 'fraction');
    hazardLootRolls(rng, 12, HAZARD);
    expect(spy).toHaveBeenCalledTimes(1);
    // 25 níveis = rolls 1,0: sem fração, o `rng` ainda é gasto e o resultado é o inteiro.
    expect(hazardLootRolls(rng, 25, HAZARD)).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(hazardLootRolls(rng, 0, HAZARD)).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('o multiplicador configurável muda quantas (lootBonusMultiplier 50: um nível = uma rolagem)', () => {
    const rng = Rng.fromSeed('config');
    expect(hazardLootRolls(rng, 3, { ...HAZARD, lootBonusMultiplier: 50 })).toBe(3);
  });

  it('a média das rolagens extras é rolls (0,48 no nível 12), medida em 100 mil sorteios', () => {
    const rng = Rng.fromSeed('mean');
    let total = 0;
    const draws = 100_000;
    for (let i = 0; i < draws; i += 1) total += hazardLootRolls(rng, 12, HAZARD);
    // O Canary sorteia `math.random(0, 100)` (101 valores) contra 48: a chance real é 48/101.
    expect(total / draws).toBeGreaterThan(48 / 101 - 0.01);
    expect(total / draws).toBeLessThan(48 / 101 + 0.01);
  });
});

describe('as probabilidades reais NÃO são as nominais (normal_random é truncada em [0, 1])', () => {
  const measure = (threshold: number, draws = 200_000): number => {
    const rng = Rng.fromSeed('probability');
    let hits = 0;
    for (let i = 0; i < draws; i += 1) if (normalRandomInt(rng, 1, 10_000) <= threshold) hits += 1;
    return hits / draws;
  };

  it('o crítico de 750/10000 acontece em ~2,3 % das rolagens, não em 7,5 %', () => {
    const probability = measure(HAZARD.criticalChance);
    expect(probability).toBeGreaterThan(0.02);
    expect(probability).toBeLessThan(0.0255);
  });

  it('a esquiva do nível 1 (85/10000) acontece em ~0,2 %, e a do nível 12 (1020) em ~3,4 %', () => {
    const one = measure(85);
    expect(one).toBeGreaterThan(0.0014);
    expect(one).toBeLessThan(0.0026);
    const twelve = measure(1020);
    expect(twelve).toBeGreaterThan(0.031);
    expect(twelve).toBeLessThan(0.038);
  });
});
