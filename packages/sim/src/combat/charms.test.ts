import { describe, expect, it } from 'vitest';
import type { Charm, ConditionSpec } from '@draconya/content';
import type { AssignedCharm, AssignedCharms } from '../charms.js';
import type { ConditionState } from '../conditions.js';
import { Rng } from '../rng.js';
import type { DamageOutcome } from './damage.js';
import { rollSharedCriticalOutcome } from './modifiers.js';
import {
  ActionCritical, CHARM_PARALYZE_CONDITION, ADRENALINE_BURST_CONDITION, carnageCharmDamage,
  charmAttackBonus, charmChance, cleanseTypeOfCondition, cleanseTypeOfSpec, elementalCharmDamage,
  findAssigned, negatedOutcome, offensiveCharmEffect, overfluxCharmDamage, overpowerCharmDamage,
  rollCleanseCharm, rollDefensiveCharm, rollNormalPercentCharm, rollOffensiveCharm,
} from './charms.js';
import { normalRandomInt } from './weapon-power.js';

const charm = (over: Partial<Charm> & Pick<Charm, 'id' | 'category' | 'type' | 'chance'>): Charm => ({
  name: over.id, canaryCharmId: 0, points: [100, 150, 225], ...over,
});
const assign = (c: Charm, tier: 1 | 2 | 3 = 1): AssignedCharm => ({ charm: c, tier });

const wound = charm({
  id: 'wound', category: 'major', type: 'offensive', damageType: 'physical', percent: 5, chance: [5, 10, 11],
});
const dodge = charm({ id: 'dodge', category: 'major', type: 'defensive', chance: [5, 10, 11] });
const lowBlow = charm({ id: 'low-blow', category: 'major', type: 'passive', chance: [4, 8, 9] });
const savageBlow = charm({ id: 'savage-blow', category: 'major', type: 'passive', chance: [20, 40, 44] });
const vampiric = charm({ id: 'vampiric-embrace', category: 'minor', type: 'passive', chance: [1.6, 2.4, 3.2] });
const voidsCall = charm({ id: 'voids-call', category: 'minor', type: 'passive', chance: [0.8, 1.2, 1.6] });

/** A fração de acertos de `roll` em `n` sorteios da mesma semente. */
function frequency(seed: string, n: number, roll: (rng: Rng) => boolean): number {
  const rng = Rng.fromSeed(seed);
  let hits = 0;
  for (let i = 0; i < n; i += 1) if (roll(rng)) hits += 1;
  return hits / n;
}

describe('o índice do tier (o Canary guarda um 0 na frente do vetor de chance)', () => {
  it('o tier 1 lê o PRIMEIRO valor do Lua, o 3 o último', () => {
    expect(charmChance(assign(wound, 1))).toBe(5);
    expect(charmChance(assign(wound, 2))).toBe(10);
    expect(charmChance(assign(wound, 3))).toBe(11);
  });

  it('findAssigned acha pelo id, no major ou no minor', () => {
    const assigned: AssignedCharms = { major: assign(dodge), minor: assign(vampiric) };
    expect(findAssigned(assigned, 'dodge')?.charm).toBe(dodge);
    expect(findAssigned(assigned, 'vampiric-embrace')?.charm).toBe(vampiric);
    expect(findAssigned(assigned, 'wound')).toBeUndefined();
  });
});

// As probabilidades esperadas são as do MECANISMO, não as nominais: `normal_random` centra em 0,5
// (desvio 0,25) e rejeita o que sai de [0, 1], então um charm de "5 %" sorteado por
// `chance >= normal_random(1, 10000) / 100` dispara em ~1,4 % dos golpes. Os números saem da CDF
// da normal truncada (integração numérica, fora deste arquivo) — a tolerância é ~6 desvios de
// 300 mil sorteios.
describe('as rolagens de charm são as funções do Canary, não a chance nominal', () => {
  const N = 300_000;
  const near = (actual: number, expectedPercent: number) =>
    expect(Math.abs(actual * 100 - expectedPercent)).toBeLessThan(0.25);

  it('defensivo (normal 1..10000): 5/10/11 % dos major e 6/9/12 % dos minor caem para ~1,4/3,4/3,8 e 1,7/2,9/4,3 %', () => {
    near(frequency('def-5', N, (rng) => rollDefensiveCharm(rng, 5)), 1.379);
    near(frequency('def-10', N, (rng) => rollDefensiveCharm(rng, 10)), 3.356);
    near(frequency('def-11', N, (rng) => rollDefensiveCharm(rng, 11)), 3.836);
    near(frequency('def-6', N, (rng) => rollDefensiveCharm(rng, 6)), 1.722);
    near(frequency('def-9', N, (rng) => rollDefensiveCharm(rng, 9)), 2.906);
    near(frequency('def-12', N, (rng) => rollDefensiveCharm(rng, 12)), 4.346);
  });

  it('Cleanse usa a normal em 0..10000 — quase a mesma curva, com o zero incluído', () => {
    near(frequency('cleanse-6', N, (rng) => rollCleanseCharm(rng, 6)), 1.726);
    near(frequency('cleanse-12', N, (rng) => rollCleanseCharm(rng, 12)), 4.351);
  });

  it('Void Inversion e Fatal Hold usam a normal em 0..100, estritamente abaixo da chance', () => {
    near(frequency('nrm-20', N, (rng) => rollNormalPercentCharm(rng, 20)), 9.27);
    near(frequency('nrm-30', N, (rng) => rollNormalPercentCharm(rng, 30)), 19.21);
    near(frequency('nrm-60', N, (rng) => rollNormalPercentCharm(rng, 60)), 65.508);
  });

  it('ofensivo (uniforme 1..100): é EXATAMENTE a chance nominal', () => {
    near(frequency('off-5', N, (rng) => rollOffensiveCharm(rng, 5)), 5);
    near(frequency('off-11', N, (rng) => rollOffensiveCharm(rng, 11)), 11);
    near(frequency('off-22', N, (rng) => rollOffensiveCharm(rng, 22)), 22);
    expect(frequency('off-0', 10_000, (rng) => rollOffensiveCharm(rng, 0))).toBe(0);
    expect(frequency('off-100', 10_000, (rng) => rollOffensiveCharm(rng, 100))).toBe(1);
  });

  it('cada rolagem consome UM sorteio do Rng da sessão — a sequência é a mesma para qualquer chance', () => {
    const a = Rng.fromSeed('one-draw');
    const b = Rng.fromSeed('one-draw');
    rollDefensiveCharm(a, 5);
    rollDefensiveCharm(b, 100);
    expect(a.getState()).toEqual(b.getState());
    // A normal truncada rejeita fora de [0, 1]: consome MAIS de um `next` só quando rejeita, e a
    // rejeição não depende da chance — a mesma semente rejeita igual.
    const c = Rng.fromSeed('one-draw-off');
    const d = Rng.fromSeed('one-draw-off');
    rollOffensiveCharm(c, 0);
    rollOffensiveCharm(d, 100);
    expect(c.getState()).toEqual(d.getState());
  });

  it('a rolagem é normalRandomInt(1, 10000) / 100 comparada com a chance', () => {
    const rng = Rng.fromSeed('replay');
    const mirror = Rng.fromSeed('replay');
    for (let i = 0; i < 2_000; i += 1) {
      const expected = 7 >= normalRandomInt(mirror, 1, 10_000) / 100;
      expect(rollDefensiveCharm(rng, 7)).toBe(expected);
    }
  });
});

describe('o dano dos charms ofensivos (iobestiary.cpp: parseOffensiveCharmCombat)', () => {
  it('elemental: min(2× o level, 5 % da vida MÁXIMA do alvo) — o teto de level não está no Lua', () => {
    // Monstro de 5.000: 5 % são 250, mas o level 100 corta em 200.
    expect(elementalCharmDamage(100, 5_000, 5)).toBe(200);
    // Monstro de 1.000: 5 % são 50, abaixo do teto de 200.
    expect(elementalCharmDamage(100, 1_000, 5)).toBe(50);
    // ceil, não floor: 5 % de 101 são 5,05.
    expect(elementalCharmDamage(100, 101, 5)).toBe(6);
  });

  it('Overpower: min(8 % da vida do alvo, 5 % da vida MÁXIMA do jogador)', () => {
    // alvo 1.000 → teto 80; jogador 1.000 → 50.
    expect(overpowerCharmDamage(1_000, 1_000, 5)).toBe(50);
    // jogador 5.000 → 250, cortado no teto 80 do alvo.
    expect(overpowerCharmDamage(1_000, 5_000, 5)).toBe(80);
  });

  it('Overflux: o mesmo, pela MANA máxima e 2,5 %', () => {
    expect(overfluxCharmDamage(1_000, 2_000, 2.5)).toBe(50);
    expect(overfluxCharmDamage(1_000, 5_000, 2.5)).toBe(80);
  });

  it('Carnage: min(15 % da vida do morto, 6× o level)', () => {
    expect(carnageCharmDamage(1_000, 10, 15)).toBe(60);
    expect(carnageCharmDamage(1_000, 100, 15)).toBe(150);
  });

  const wielder = { level: 10, maxHealth: 1_000, maxMana: 2_000 };
  const elemental = (id: string, damageType: string): Charm => charm({
    id, category: 'major', type: 'offensive', damageType, percent: 5, chance: [5, 10, 11],
  });

  it('cada um dos sete elementais causa dano do PRÓPRIO tipo', () => {
    const types: readonly [string, string][] = [
      ['wound', 'physical'], ['enflame', 'fire'], ['poison', 'earth'], ['freeze', 'ice'],
      ['zap', 'energy'], ['curse', 'death'], ['divine-wrath', 'holy'],
    ];
    for (const [id, type] of types) {
      expect(offensiveCharmEffect(elemental(id, type), wielder, 1_000), id)
        .toEqual({ kind: 'damage', damageType: type, neutral: false, amount: 20 });
    }
  });

  it('Overpower e Overflux são NEUTROS; Cripple paraliza; Carnage não age no golpe', () => {
    const neutral = (id: string, percent: number) => charm({
      id, category: 'major', type: 'offensive', damageType: 'neutral', percent, chance: [5, 10, 11],
    });
    expect(offensiveCharmEffect(neutral('overpower', 5), wielder, 1_000))
      .toEqual({ kind: 'damage', damageType: 'physical', neutral: true, amount: 50 });
    expect(offensiveCharmEffect(neutral('overflux', 2.5), wielder, 1_000))
      .toEqual({ kind: 'damage', damageType: 'physical', neutral: true, amount: 50 });
    expect(offensiveCharmEffect(
      charm({ id: 'cripple', category: 'minor', type: 'offensive', chance: [6, 9, 12] }), wielder, 1_000,
    )).toEqual({ kind: 'paralyze' });
    expect(offensiveCharmEffect(neutral('carnage', 15), wielder, 1_000)).toEqual({ kind: 'none' });
    expect(offensiveCharmEffect(elemental('mystery', 'fire'), wielder, 1_000)).toEqual({ kind: 'none' });
  });
});

describe('as condições dos charms (setFormulaVars do Canary)', () => {
  it('Adrenaline Burst é haste de 10 s (2,5 × (base − 40) + 40); Numb/Cripple, paralisia de 10 s (−1, 0)', () => {
    expect(ADRENALINE_BURST_CONDITION.durationMs).toBe(10_000);
    expect(ADRENALINE_BURST_CONDITION.effect).toEqual({
      kind: 'speed', type: 'haste', formula: { mina: 2.5, minb: 40, maxa: 2.5, maxb: 40 },
    });
    expect(CHARM_PARALYZE_CONDITION.durationMs).toBe(10_000);
    expect(CHARM_PARALYZE_CONDITION.effect).toEqual({
      kind: 'speed', type: 'paralyze', formula: { mina: -1, minb: 0, maxa: -1, maxb: 0 },
    });
    // As duas usam a chave RESERVADA da velocidade: haste e paralisia se substituem.
    expect(ADRENALINE_BURST_CONDITION.key).toBe('speed');
    expect(CHARM_PARALYZE_CONDITION.key).toBe('speed');
  });
});

describe('o que os charms passivos somam ao golpe dado (Low Blow, Savage Blow, Vampiric, Void)', () => {
  it('chance × 100 pontos-base vira fração: chance / 100', () => {
    const bonus = charmAttackBonus({
      major: assign(lowBlow, 3), minor: assign(vampiric, 3),
    }, 'rat');
    expect(bonus).toEqual({ monsterId: 'rat', lowBlow: 0.09, lifeLeech: 0.032 });
    expect(charmAttackBonus({ major: assign(savageBlow, 2), minor: assign(voidsCall, 1) }, 'rat'))
      .toEqual({ monsterId: 'rat', savageBlow: 0.4, manaLeech: 0.008 });
  });

  it('sem nenhum dos quatro, é undefined — o intent segue o de sempre', () => {
    expect(charmAttackBonus({ major: assign(wound), minor: assign(dodge) }, 'rat')).toBeUndefined();
    expect(charmAttackBonus({}, 'rat')).toBeUndefined();
  });
});

describe('ActionCritical — o crítico de uma AÇÃO com os charms por cima (Combat::applyExtensions)', () => {
  const base = { critical: { chance: 0.05, multiplier: 1.1 }, lifeLeech: 0.1 };

  it('sem charm no alvo, é EXATAMENTE rollSharedCriticalOutcome: mesmo objeto, mesmo sorteio', () => {
    const a = Rng.fromSeed('shared');
    const b = Rng.fromSeed('shared');
    const action = new ActionCritical(base, a);
    const expected = rollSharedCriticalOutcome(base, b);
    expect(action.modifiers).toEqual(expected);
    expect(action.forTarget(undefined, a)).toBe(action.modifiers);
    expect(a.getState()).toEqual(b.getState());
  });

  it('ausente o crítico base, nenhum sorteio e o modificador segue undefined', () => {
    const rng = Rng.fromSeed('none');
    const before = rng.getState();
    const action = new ActionCritical(undefined, rng);
    expect(action.modifiers).toBeUndefined();
    expect(action.forTarget(undefined, rng)).toBeUndefined();
    expect(rng.getState()).toEqual(before);
  });

  // Uma semente cujo primeiro sorteio de crítico base FALHA (0,05 de chance), para o Low Blow
  // ter o que consertar.
  const failing = (): string => {
    for (let i = 0; i < 1_000; i += 1) {
      const rng = Rng.fromSeed(`s${i}`);
      if (!rng.chance(0.05)) return `s${i}`;
    }
    throw new Error('nenhuma semente falha o crítico base');
  };

  it('Low Blow: o crítico base falhou → SEGUNDO sorteio com chance base + charm (a base entra de novo)', () => {
    const seed = failing();
    const rng = Rng.fromSeed(seed);
    const mirror = Rng.fromSeed(seed);
    const action = new ActionCritical(base, rng);
    expect(action.modifiers?.critical?.chance).toBe(0);
    mirror.chance(0.05); // o sorteio base
    const expectedLowBlow = mirror.chance(Math.min(1, 0.05 + 0.09));
    const forTarget = action.forTarget({ monsterId: 'rat', lowBlow: 0.09 }, rng);
    expect(forTarget?.critical).toEqual({ chance: expectedLowBlow ? 1 : 0, multiplier: 1.1 });
    expect(rng.getState()).toEqual(mirror.getState());
  });

  it('Low Blow: dois alvos do MESMO monstro dividem UM sorteio; outro monstro rola o seu', () => {
    const seed = failing();
    const rng = Rng.fromSeed(seed);
    const action = new ActionCritical(base, rng);
    const first = action.forTarget({ monsterId: 'rat', lowBlow: 0.5 }, rng);
    const afterFirst = rng.getState();
    const second = action.forTarget({ monsterId: 'rat', lowBlow: 0.5 }, rng);
    expect(rng.getState()).toEqual(afterFirst); // não consumiu de novo
    expect(second?.critical).toEqual(first?.critical);
    action.forTarget({ monsterId: 'bat', lowBlow: 0.5 }, rng);
    expect(rng.getState()).not.toEqual(afterFirst); // outro monstro: outro sorteio
  });

  it('Low Blow não rola quando o crítico base JÁ ativou (canApplyCritical)', () => {
    let seed = '';
    for (let i = 0; i < 10_000 && seed === ''; i += 1) {
      if (Rng.fromSeed(`c${i}`).chance(0.05)) seed = `c${i}`;
    }
    const rng = Rng.fromSeed(seed);
    const action = new ActionCritical(base, rng);
    expect(action.modifiers?.critical?.chance).toBe(1);
    const afterBase = rng.getState();
    const target = action.forTarget({ monsterId: 'rat', lowBlow: 0.09 }, rng);
    expect(target?.critical?.chance).toBe(1);
    expect(rng.getState()).toEqual(afterBase);
  });

  it('Low Blow sem nenhum crítico de equipamento nem base: o charm sozinho abre a chance', () => {
    const rng = Rng.fromSeed('alone');
    const mirror = Rng.fromSeed('alone');
    const action = new ActionCritical(undefined, rng);
    const target = action.forTarget({ monsterId: 'rat', lowBlow: 0.09 }, rng);
    const rolled = mirror.chance(0.09);
    expect(target?.critical).toEqual({ chance: rolled ? 1 : 0, multiplier: 1 });
  });

  it('Savage Blow soma ao MULTIPLICADOR do crítico do alvo do charm, e só dele', () => {
    const rng = Rng.fromSeed('savage');
    const action = new ActionCritical(base, rng);
    const savage = action.forTarget({ monsterId: 'rat', savageBlow: 0.44 }, rng);
    expect(savage?.critical?.multiplier).toBeCloseTo(1.54, 10);
    expect(action.forTarget(undefined, rng)?.critical?.multiplier).toBe(1.1);
    // O crítico SEM fonte nenhuma não é inventado pelo Savage Blow.
    const bare = new ActionCritical(undefined, Rng.fromSeed('bare'));
    expect(bare.forTarget({ monsterId: 'rat', savageBlow: 0.44 }, Rng.fromSeed('bare'))).toBeUndefined();
  });

  it('Vampiric Embrace e Void\'s Call SOMAM ao leech do equipamento', () => {
    const rng = Rng.fromSeed('leech');
    const action = new ActionCritical({ lifeLeech: 0.1, manaLeech: 0.02 }, rng);
    const target = action.forTarget({ monsterId: 'rat', lifeLeech: 0.032, manaLeech: 0.016 }, rng);
    expect(target?.lifeLeech).toBeCloseTo(0.132, 10);
    expect(target?.manaLeech).toBeCloseTo(0.036, 10);
    // E abrem o leech de quem não tinha nenhum.
    const bare = new ActionCritical(undefined, rng);
    expect(bare.forTarget({ monsterId: 'rat', lifeLeech: 0.032 }, rng)).toEqual({ lifeLeech: 0.032 });
  });
});

describe('Cleanse enxerga as condições negativas do Canary', () => {
  const dot = (damageType: string, amount = 5): ConditionState => ({
    key: `dot-${damageType}`, expiresAtMs: 10_000,
    tick: { kind: 'damage', amount, intervalMs: 1_000, damageType: damageType as never, source: 'monster-attack' },
  });

  it('cada tipo de dano ao longo do tempo vira a condição do Canary', () => {
    const table: readonly [string, string][] = [
      ['earth', 'poison'], ['fire', 'fire'], ['energy', 'energy'], ['physical', 'bleeding'],
      ['ice', 'freezing'], ['holy', 'dazzled'], ['death', 'cursed'],
    ];
    for (const [damageType, type] of table) {
      expect(cleanseTypeOfCondition(dot(damageType)), damageType).toBe(type);
    }
    // Afogamento não é limpável, e um DOT cuja fila já esgotou (amount zero) não conta.
    expect(cleanseTypeOfCondition(dot('drown'))).toBeNull();
    expect(cleanseTypeOfCondition(dot('earth', 0))).toBeNull();
  });

  it('paralisia (speedPercent negativo) é limpável; haste e cura ao longo do tempo, não', () => {
    expect(cleanseTypeOfCondition({ key: 'speed', expiresAtMs: 1, speedPercent: -80 })).toBe('paralyze');
    expect(cleanseTypeOfCondition({ key: 'speed', expiresAtMs: 1, speedPercent: 50 })).toBeNull();
    expect(cleanseTypeOfCondition({
      key: 'hot', expiresAtMs: 1, tick: { kind: 'heal', amount: 5, intervalMs: 1_000 },
    })).toBeNull();
    expect(cleanseTypeOfCondition({ key: 'buff', expiresAtMs: 1 })).toBeNull();
  });

  it('a condição AINDA NÃO aplicada da ability tem o mesmo tipo (para a imunidade)', () => {
    const poison: ConditionSpec = {
      key: 'poison', merge: 'refresh', durationMs: 5_000,
      effect: {
        kind: 'damage-over-time', form: 'generated', totalDamage: 20, intervalMs: 1_000, damageType: 'earth',
      },
    };
    expect(cleanseTypeOfSpec(poison)).toBe('poison');
    expect(cleanseTypeOfSpec(CHARM_PARALYZE_CONDITION)).toBe('paralyze');
    expect(cleanseTypeOfSpec(ADRENALINE_BURST_CONDITION)).toBeNull();
  });
});

describe('o Dodge do charm nega o golpe inteiro', () => {
  it('negatedOutcome zera o dano resolvido (primário e secundário) e mantém o resto', () => {
    const outcome = {
      profile: 'combat-v4', intent: { rawDamage: 10, source: 'monster-attack', damageType: 'physical' },
      damageType: 'physical', afterDefense: 10, afterArmor: 10, armorReduction: 0, minimumDamage: 1,
      afterResistance: 10, immune: false, dodged: false, critical: false, resolvedDamage: 10,
      secondaryOutcome: {
        profile: 'combat-v4', intent: { rawDamage: 5, source: 'monster-attack', damageType: 'fire' },
        damageType: 'fire', afterDefense: 5, afterArmor: 5, armorReduction: 0, minimumDamage: 1,
        afterResistance: 5, immune: false, dodged: false, critical: false, resolvedDamage: 5,
      },
      blockCharge: { banked: 1, clockStartMs: 0 },
    } as unknown as DamageOutcome;
    const negated = negatedOutcome(outcome);
    expect(negated.resolvedDamage).toBe(0);
    expect(negated.secondaryOutcome?.resolvedDamage).toBe(0);
    expect(negated.blockCharge).toEqual(outcome.blockCharge);
    expect(outcome.resolvedDamage).toBe(10); // o original não muda
  });
});
