// O offline training (#631, ADR 0059 d.3-d.4): o banco cresce com o tempo de hunt/treino e a `api`
// o gasta na emissão do ticket, com as fórmulas de `offline_training.lua` do Canary — carência de
// 10 min, `min(fora, banco, teto)`, melee `s / ataque / 2`, distância `/ 4`, magic level pela mana,
// escudo `s / 4` junto. Tudo PURO: o tempo fora chega como dado, o `sim` não lê relógio.

import { buildContent, placeholderAppearances } from '@draconya/content';
import type { RawContent } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import {
  OfflineTraining, emptyOfflineTrainingState, readOfflineTrainingState, settleOfflineTraining,
} from './offline-training.js';
import type { OfflineTrainingRules, OfflineTrainingState } from './offline-training.js';
import { readItemOverlay } from './item-overlay.js';

const HOUR = 3_600_000;

const skills = [
  { id: 'sword', name: 'Sword', startingLevel: 10, curve: { base: 50, factor: 2 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'shielding', name: 'Shielding', startingLevel: 10, curve: { base: 100, factor: 1.5 }, gain: { on: 'shield-block', points: 1 }, damagePerLevel: 0 },
  { id: 'distance', name: 'Distance', startingLevel: 10, curve: { base: 30, factor: 2 }, gain: { on: 'distance-hit', points: 1 }, damagePerLevel: 0 },
  { id: 'magic', name: 'Magic', startingLevel: 0, curve: { base: 1600, factor: 4 }, gain: { on: 'spell-cast', pointsPerMana: 1 }, damagePerLevel: 0 },
];
const family = (id: string, kind: string, skillId: string, range: number) => ({
  id, name: id, kind, skillId, range, damageType: 'physical', resource: 'none',
  formula: { levelFactor: 0, spread: 0 },
});
const weaponFamilies = [
  family('fist', 'melee', 'sword', 1), family('sword', 'melee', 'sword', 1),
  family('axe', 'melee', 'sword', 1), family('club', 'melee', 'sword', 1),
  family('distance', 'distance', 'distance', 6),
  { id: 'wand', name: 'Wand', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
  { id: 'rod', name: 'Rod', kind: 'wand', skillId: 'magic', range: 3, damageType: 'arcane', resource: 'mana' },
];
const baseProgression = {
  id: 'baseline', startingHealth: 150, startingMana: 55, startingCapacity: 400,
  healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
  startingSpeed: 300, speedPerLevel: 0,
  // Sem vocação: a tabela base — `vocations.xml` id 0 (None), aqui com 1 de mana a cada 1 s.
  regen: { health: { ticksMs: 1000, amount: 1 }, mana: { ticksMs: 1000, amount: 1 } },
  xp: { kind: 'power', base: 20, exponent: 2 },
  deathPenalty: { flatFraction: 0.1, cubicFromLevel: 24, blessingReduction: 0.56, promotionReduction: 0.3 },
  skillMultipliers: {},
};
// Uma vocação com promoção: mana a cada 3 s (base) e a cada 2 s (promovida), 2 por pulso.
const sorcerer = {
  id: 'sorcerer', name: 'Sorcerer', healthPerLevel: 5, manaPerLevel: 30, capacityPerLevel: 10,
  regen: { health: { ticksMs: 12_000, amount: 1 }, mana: { ticksMs: 3_000, amount: 2 } },
  promotion: {
    name: 'Master Sorcerer', minLevel: 20, price: 20_000,
    regen: { health: { ticksMs: 12_000, amount: 1 }, mana: { ticksMs: 2_000, amount: 2 } },
  },
};
const training = {
  id: 'baseline',
  dummy: { id: 'exercise-dummy', rate: 100 },
  strike: { triesPerCharge: 7, manaSpentPerCharge: 600 },
  place: { stand: { x: 2, y: 1, z: 7 }, dummy: { x: 1, y: 1, z: 7 } },
  offline: {
    bankCapMs: 12 * HOUR, graceMs: 600_000, maxAwayMs: 21 * 24 * HOUR,
    spendCapMs: { free: 6 * HOUR, premium: 12 * HOUR }, shieldingDivisor: 4,
    skills: [
      { skillId: 'sword', kind: 'attacks', divisor: 2 },
      { skillId: 'distance', kind: 'attacks', divisor: 4 },
      { skillId: 'magic', kind: 'mana' },
    ],
  },
};
const gym = { id: 'gym', z: 7, entryPoint: { x: 2, y: 1, z: 7 }, grid: ['####', '#..#', '####'] };
const rat = {
  id: 'rat', name: 'Rat', recommendedLevel: 1, health: 20, experience: 5, attack: 0, armor: 0,
  attackIntervalMs: 2000, speed: 1, aggroRadius: 1, attackRange: 1,
  loot: { gold: { chance: 0, min: 1, max: 1 }, items: [] },
};

function rulesOf(over: { progression?: Record<string, unknown> } = {}): OfflineTrainingRules {
  const base: RawContent = {
    monsters: [rat], hunts: [{ id: 'h', name: 'H', recommendedLevel: 1, mapId: 'gym', routeId: 'gym' }],
    vocations: [sorcerer], progression: [{ ...baseProgression, ...over.progression }],
    combat: [{
      id: 'baseline', dodgeMultiplier: 0.5,
      armorEffectiveness: {
        physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0,
        manadrain: 0, arcane: 0,
      },
      minimumDamageFraction: 0.1,
      player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 0, dodgeChance: 0 },
    }],
    stamina: [{ id: 'baseline', maxMs: 43_200_000, recoveryRatio: 1 }],
    party: [{ id: 'baseline', maxMembers: 4 }], spells: [], skills, weaponFamilies, items: [],
    bot: [{
      id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
      slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 },
    }],
    maps: [gym],
    routes: [{
      id: 'gym', mapId: 'gym', tiles: [{ x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }],
      spawnPoints: [{ routeIndex: 0, radius: 1, monsterId: 'rat', respawnDelayMs: 60_000 }],
    }],
    city: { mapId: 'gym', stepDurationMs: 150 }, training: [training],
  };
  const content = buildContent({ appearances: [placeholderAppearances(base)], ...base });
  return {
    training: content.training as NonNullable<typeof content.training>,
    skills: content.skills, vocations: content.vocations, progression: content.progression,
    attackIntervalMs: content.combat.player.attackIntervalMs, shieldSkillId: 'shielding',
  };
}

const chosen = (offlineSkill: string | null, offlineBankMs: number): OfflineTrainingState => ({
  offlineBankMs, offlineSkill, version: 1,
});
const away = (awayMs: number, over: Partial<Parameters<typeof settleOfflineTraining>[0]> = {}) => ({
  training: chosen('sword', 12 * HOUR), skills: undefined, awayMs, premium: true, vocationId: null, ...over,
});

describe('o registro do banco (ADR 0059 d.3)', () => {
  it('lê o que o banco guarda e descarta lixo em vez de trancar o login', () => {
    expect(readOfflineTrainingState({ offlineBankMs: 5_000, offlineSkill: 'sword', version: 1 }))
      .toEqual({ offlineBankMs: 5_000, offlineSkill: 'sword', version: 1 });
    expect(readOfflineTrainingState({ offlineBankMs: 5_000.9, offlineSkill: null })).toMatchObject({ offlineBankMs: 5_000, offlineSkill: null });
    for (const torto of [null, 3, 'x', [], { offlineBankMs: -1 }, { offlineBankMs: 'a' }, { offlineBankMs: 1, offlineSkill: 7 }, { offlineBankMs: Number.NaN }]) {
      expect(readOfflineTrainingState(torto)).toBeUndefined();
    }
  });

  it('cresce 1:1 com o tempo online até o teto, e não recebe tempo negativo nem quebrado', () => {
    const bank = OfflineTraining.fromState();
    bank.creditOnline(1_500.7, 12 * HOUR);
    bank.creditOnline(-5, 12 * HOUR);
    bank.creditOnline(Number.NaN, 12 * HOUR);
    expect(bank.bankMs).toBe(1_500);
    bank.creditOnline(20 * HOUR, 12 * HOUR);
    expect(bank.bankMs).toBe(12 * HOUR);
  });

  it('o livro só oferece as skills do conteúdo; `null` desmarca', () => {
    const bank = OfflineTraining.fromState();
    const { training: rules } = rulesOf();
    expect(bank.choose('sword', rules)).toEqual({ ok: true });
    expect(bank.skill).toBe('sword');
    expect(bank.choose('fist', rules)).toEqual({ ok: false, reason: 'unknown-skill' });
    expect(bank.skill).toBe('sword');
    expect(bank.choose(null, rules)).toEqual({ ok: true });
    expect(bank.getState()).toEqual(emptyOfflineTrainingState());
  });

  it('`getState` é uma cópia e o estado vazio é o de todo personagem novo', () => {
    const bank = OfflineTraining.fromState({ offlineBankMs: 7, offlineSkill: null, version: 1 });
    const copy = bank.getState();
    bank.creditOnline(10, HOUR);
    expect(copy.offlineBankMs).toBe(7);
    expect(OfflineTraining.fromState(undefined).getState()).toEqual(emptyOfflineTrainingState());
  });
});

describe('gastar o banco — as fórmulas de offline_training.lua', () => {
  const rules = rulesOf();

  it('sem skill escolhida nada acontece, e o banco NÃO é tocado', () => {
    const result = settleOfflineTraining(away(5 * HOUR, { training: chosen(null, 3 * HOUR) }), rules);
    expect(result.training).toEqual(chosen(null, 3 * HOUR));
    expect(result.settlement).toBeNull();
  });

  it('a carência de 10 min: menos que isso a escolha é consumida e o banco fica', () => {
    const result = settleOfflineTraining(away(599_999), rules);
    expect(result.training).toEqual(chosen(null, 12 * HOUR));
    expect(result.settlement).toBeNull();
    expect(result.skills).toEqual({});
  });

  it('exatamente 10 min já treina — o Canary testa `offlineTime < 600`', () => {
    const result = settleOfflineTraining(away(600_000), rules);
    // 600 s, ataque de 2 s, divisor 2: 150 tries.
    expect(result.settlement).toMatchObject({ trainedMs: 600_000, skillId: 'sword', tries: 150 });
  });

  it('melee: tries = (segundos / ataque base) / 2 — duas horas são 1 800; o escudo sobe s / 4 junto', () => {
    const result = settleOfflineTraining(away(2 * HOUR, { training: chosen('sword', 3 * HOUR) }), rules);
    expect(result.settlement).toEqual({ trainedMs: 2 * HOUR, skillId: 'sword', tries: 1_800, shieldingTries: 1_800 });
    // O banco desce o que foi treinado.
    expect(result.training).toEqual(chosen(null, HOUR));
    // 1 800 tries a partir do level 10: custos 50, 100, 200, 400, 800 → 1 550 pagam cinco níveis,
    // sobram 250 no level 15 (cujo custo é 1 600).
    expect(result.skills['sword']).toEqual({ level: 15, points: 250 });
    // O escudo: 1 800 a partir do level 10 (100, 150, 225, 337, 506) → 1 318 pagam cinco níveis.
    expect(result.skills['shielding']).toEqual({ level: 15, points: 482 });
  });

  it('distância treina à metade do ritmo do melee (divisor 4)', () => {
    const result = settleOfflineTraining(away(2 * HOUR, { training: chosen('distance', 3 * HOUR) }), rules);
    expect(result.settlement).toMatchObject({ skillId: 'distance', tries: 900, shieldingTries: 1_800 });
  });

  it('magic level: segundos × manaGain / manaTicks — com os TICKS da forma PROMOVIDA (`topVocation`)', () => {
    // Sorcerer: 2 de mana por pulso; o Lua lê os ticks da vocação PROMOVIDA (2 s), mesmo com o
    // personagem ainda na forma base (3 s): 7 200 s × 2 / 2 = 7 200 de mana gasta.
    const result = settleOfflineTraining(away(2 * HOUR, {
      training: chosen('magic', 3 * HOUR), vocationId: 'sorcerer',
    }), rules);
    expect(result.settlement).toMatchObject({ skillId: 'magic', tries: 7_200, shieldingTries: 1_800 });
    // Sair do ML 0 custa 1 600; o ML 1 → 2 custaria 6 400 (fator 4): sobram 5 600 no ML 1.
    expect(result.skills['magic']).toEqual({ level: 1, points: 5_600 });
  });

  it('sem vocação, a mana vem da tabela base da progressão', () => {
    const result = settleOfflineTraining(away(HOUR, { training: chosen('magic', 3 * HOUR) }), rules);
    // 3 600 s × 1 / 1 s.
    expect(result.settlement).toMatchObject({ tries: 3_600 });
  });

  it('o teto por CONTA: Free gasta no máximo 6 h, Premium 12 h (ADR 0059 d.4)', () => {
    const free = settleOfflineTraining(away(20 * HOUR, { premium: false }), rules);
    expect(free.settlement?.trainedMs).toBe(6 * HOUR);
    expect(free.training.offlineBankMs).toBe(6 * HOUR);
    const premium = settleOfflineTraining(away(20 * HOUR, { premium: true }), rules);
    expect(premium.settlement?.trainedMs).toBe(12 * HOUR);
    expect(premium.training.offlineBankMs).toBe(0);
  });

  it('gasta min(fora, banco, teto): o banco menor que o tempo fora limita', () => {
    const result = settleOfflineTraining(away(10 * HOUR, { training: chosen('sword', 90 * 60_000) }), rules);
    expect(result.settlement?.trainedMs).toBe(90 * 60_000);
    expect(result.training.offlineBankMs).toBe(0);
  });

  it('o "fora" nunca conta mais que 21 dias, e relógio para trás vale zero', () => {
    const forever = settleOfflineTraining(away(90 * 24 * HOUR, { training: chosen('sword', 50 * HOUR) }), rules);
    // 21 dias passam de qualquer teto: o banco (que aqui está inflado) e a conta (12 h) mandam.
    expect(forever.settlement?.trainedMs).toBe(12 * HOUR);
    const backwards = settleOfflineTraining(away(-5 * HOUR), rules);
    expect(backwards.settlement).toBeNull();
    expect(backwards.training).toEqual(chosen(null, 12 * HOUR));
  });

  it('menos de 60 s de treino: o banco desce (o Canary tira antes de conferir) e nada rende', () => {
    const result = settleOfflineTraining(away(5 * HOUR, { training: chosen('sword', 30_000) }), rules);
    expect(result.settlement).toBeNull();
    expect(result.training).toEqual(chosen(null, 0));
    expect(result.skills).toEqual({});
  });

  it('só treina segundos INTEIROS, e o resto do banco não some', () => {
    const result = settleOfflineTraining(away(HOUR, { training: chosen('sword', HOUR + 1_999) }), rules);
    expect(result.settlement?.trainedMs).toBe(HOUR);
    expect(result.training.offlineBankMs).toBe(1_999);
  });

  it('o escudo só treina junto se a skill principal avançou de nível OU de percentual', () => {
    // Level 40 custa 50 × 2^30 tries: 150 tries não movem o percentual, então o escudo fica.
    const parado = settleOfflineTraining(away(600_000, {
      skills: { sword: { level: 40, points: 0 } },
    }), rules);
    expect(parado.settlement).toMatchObject({ tries: 150, shieldingTries: 0 });
    expect(parado.skills['shielding']).toBeUndefined();
    expect(parado.skills['sword']).toEqual({ level: 40, points: 150 });
  });

  it('parte do que a skill JÁ tinha, e não muta a entrada', () => {
    const before = { sword: { level: 12, points: 10 } };
    const snapshot = JSON.stringify(before);
    const result = settleOfflineTraining(away(600_000, { skills: before }), rules);
    expect(JSON.stringify(before)).toBe(snapshot);
    // Level 12 custa 200: 10 + 150 = 160 < 200, sem subir.
    expect(result.skills['sword']).toEqual({ level: 12, points: 160 });
  });

  it('o multiplicador de skill da vocação vale (o fator do `<skill multiplier>`)', () => {
    const custom = rulesOf();
    const withVocationFactor: OfflineTrainingRules = {
      ...custom,
      vocations: new Map([['sorcerer', { ...(custom.vocations.get('sorcerer') as never), skillMultipliers: { sword: 1 } }]]),
    };
    // Fator 1: cada nível custa 50 — 150 tries são 3 níveis exatos.
    const result = settleOfflineTraining(away(600_000, { vocationId: 'sorcerer' }), withVocationFactor);
    expect(result.skills['sword']).toEqual({ level: 13, points: 0 });
  });

  it('o rate de skill do conteúdo (`onGainSkillTries`) também vale no offline', () => {
    const boosted = rulesOf({ progression: { rates: { skill: 2 } } });
    const result = settleOfflineTraining(away(600_000), boosted);
    expect(result.settlement).toMatchObject({ tries: 300 });
  });

  it('a skill que o livro oferecia e saiu do conteúdo: a escolha é consumida, nada rende, o banco fica', () => {
    const result = settleOfflineTraining(away(5 * HOUR, { training: chosen('axe', 3 * HOUR) }), rules);
    expect(result.settlement).toBeNull();
    expect(result.training).toEqual(chosen(null, 3 * HOUR));
  });

  it('é determinística: a mesma entrada dá a mesma saída', () => {
    const input = away(3 * HOUR + 12_345);
    expect(settleOfflineTraining(input, rules)).toEqual(settleOfflineTraining(input, rules));
  });
});

describe('as cargas da exercise weapon no overlay (#631)', () => {
  it('só um inteiro positivo é uma carga guardada — zero é a arma destruída', () => {
    expect(readItemOverlay({ charges: 499 })).toEqual({ charges: 499 });
    for (const torto of [0, -3, 1.5, '12', null, Number.NaN]) {
      expect(readItemOverlay({ charges: torto })).toBeUndefined();
    }
  });

  it('convive com os outros campos do overlay sem os apagar', () => {
    expect(readItemOverlay({ charges: 10, durationRemainingMs: 5_000 }))
      .toEqual({ charges: 10, durationRemainingMs: 5_000 });
  });
});
