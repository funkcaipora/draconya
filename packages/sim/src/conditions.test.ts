import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import type { CharacterState } from './character.js';
import { applyDamageOutcome } from './combat/outcome.js';
import type { DamageOutcome } from './combat/damage.js';
import { Conditions, conditionFromSpec, resolveSpeedPercent, tickOf } from './conditions.js';
import type { ConditionState } from './conditions.js';
import { MonsterRuntime } from './monster/monster.js';
import { Rng } from './rng.js';

// As condições (#155): estado com prazo, sem tempo dentro — quem vence é a fila. O que se
// prende aqui é a política (uma por chave, relançar substitui), as leituras e a serialização.

const haste = (over: Partial<ConditionState> = {}): ConditionState => ({
  key: 'haste', spellId: 'haste', expiresAtMs: 30_000, speedPercent: 30, ...over,
});

describe('Conditions', () => {
  it('holds one per kind: applying again replaces and returns the previous one', () => {
    const conditions = new Conditions();
    expect(conditions.apply(haste())).toBeNull();
    expect(conditions.apply(haste({ spellId: 'charge', speedPercent: 90, expiresAtMs: 5_000 })))
      .toEqual(haste());
    expect(conditions.size).toBe(1);
    expect(conditions.get('haste')?.speedPercent).toBe(90);
    expect(conditions.remove('haste')?.spellId).toBe('charge');
    expect(conditions.remove('haste')).toBeNull();
  });

  it('reads speed, damage dealt by source, damage taken and the shield — and 1 without anything', () => {
    const conditions = new Conditions();
    expect(conditions.speedScale()).toBe(1);
    expect(conditions.damageDealtScale('melee')).toBe(1);
    expect(conditions.damageTakenScale()).toBe(1);
    expect(conditions.hasManaShield()).toBe(false);

    conditions.apply(haste());
    expect(conditions.speedScale()).toBeCloseTo(1.3);
    // Swift Foot: haste que baixa o dano; Blood Rage: postura que sobe o corpo a corpo e o dano
    // tomado. As duas SOMAM por fonte.
    conditions.apply(haste({ damageDealtPercent: { melee: -30, distance: -30, spell: -30 } }));
    conditions.apply({
      key: 'buff', spellId: 'blood-rage', expiresAtMs: 10_000,
      damageDealtPercent: { melee: 25 }, damageTakenPercent: 15,
    });
    expect(conditions.damageDealtScale('melee')).toBeCloseTo(0.95);
    expect(conditions.damageDealtScale('distance')).toBeCloseTo(0.7);
    expect(conditions.damageDealtScale('spell')).toBeCloseTo(0.7);
    expect(conditions.damageTakenScale()).toBeCloseTo(1.15);
    conditions.apply({ key: 'mana-shield', spellId: 'magic-shield', expiresAtMs: 180_000 });
    expect(conditions.hasManaShield()).toBe(true);
  });

  it('serializes and comes back the same', () => {
    const conditions = new Conditions();
    conditions.apply(haste());
    conditions.apply({ key: 'heal-over-time', spellId: 'recovery', expiresAtMs: 60_000, tick: { amount: 20, intervalMs: 3_000 } });
    const restored = Conditions.fromState(JSON.parse(JSON.stringify(conditions.getState())) as ConditionState[]);
    expect(restored.getState()).toEqual(conditions.getState());
    expect(Conditions.fromState(undefined).size).toBe(0);
  });

  it('a política `strongest` mantém o mais forte e NÃO reagenda o mais fraco', () => {
    // Mutação que mata: trocar por `refresh` no `apply` — o veneno fraco rebaixaria o forte.
    const conditions = new Conditions();
    const strong: ConditionState = {
      key: 'poison', targetId: 'm:1', expiresAtMs: 10_000, merge: 'strongest',
      tick: { kind: 'damage', amount: 30, intervalMs: 1_000, damageType: 'earth', source: 'spell' },
    };
    const weak: ConditionState = {
      ...strong, expiresAtMs: 20_000,
      tick: { kind: 'damage', amount: 5, intervalMs: 1_000, damageType: 'earth', source: 'spell' },
    };
    expect(conditions.apply(strong)).toBeNull();
    expect(conditions.apply(weak)).toBe(strong);
    // O objeto guardado continua sendo o forte — é o que o ruleset compara para não reagendar.
    expect(conditions.get('poison')).toBe(strong);
    // `replace`/`refresh` substituem: o novo vence mesmo sendo mais fraco.
    expect(conditions.apply({ ...weak, merge: 'refresh' })).toBe(strong);
    expect(conditions.get('poison')?.tick?.amount).toBe(5);
  });

  it('`strongest` compara a MAGNITUDE do speedPercent, não o valor com sinal (#641)', () => {
    // Um paralyze severo (-80) precisa vencer um haste fraco (+5) na comparação `strongest` —
    // `speedPercent` tem sinal desde o CMB-11 (#556), e `strengthOf` compararia -80 > 5 como
    // falso se lesse o valor cru, mantendo o haste trivial e descartando o paralyze severo.
    const conditions = new Conditions();
    const weakHaste: ConditionState = {
      key: 'speed', targetId: 'm:1', expiresAtMs: 10_000, merge: 'strongest', speedPercent: 5,
    };
    const severeParalyze: ConditionState = {
      key: 'speed', targetId: 'm:1', expiresAtMs: 5_000, merge: 'strongest', speedPercent: -80,
    };
    expect(conditions.apply(weakHaste)).toBeNull();
    // Retorna o ANTERIOR (weakHaste) — a substituição aconteceu, é a leitura pós-apply abaixo
    // que prova que o forte venceu, não o valor de retorno (que é sempre o estado anterior).
    expect(conditions.apply(severeParalyze)).toBe(weakHaste);
    expect(conditions.get('speed')).toBe(severeParalyze);
    expect(conditions.get('speed')?.speedPercent).toBe(-80);

    // E o caminho inverso: um paralyze severo já ativo não é derrubado por um haste fraco.
    const conditions2 = new Conditions();
    expect(conditions2.apply(severeParalyze)).toBeNull();
    expect(conditions2.apply(weakHaste)).toBe(severeParalyze);
    expect(conditions2.get('speed')?.speedPercent).toBe(-80);
  });

  it('o tique de dano (DOT) viaja no estado e um snapshot antigo sem `kind` lê como cura', () => {
    const conditions = new Conditions();
    conditions.apply({
      key: 'fire', targetId: 'm:1', expiresAtMs: 5_000,
      tick: { kind: 'damage', amount: 12, intervalMs: 1_000, damageType: 'fire', source: 'spell' },
    });
    expect(tickOf(conditions.get('fire') as ConditionState)?.kind).toBe('damage');
    // Formato do #155: sem `kind`. Ausente é cura, e o snapshot continua legível sem bump.
    expect(tickOf({ key: 'heal-over-time', expiresAtMs: 1, tick: { amount: 3, intervalMs: 1 } })?.kind)
      .toBe('heal');
    expect(tickOf({ key: 'haste', expiresAtMs: 1 })).toBeNull();
  });

  it('compila um `ConditionSpec` do conteúdo para o alvo, com prazo lógico absoluto', () => {
    const condition = conditionFromSpec(
      {
        key: 'poison', merge: 'strongest', durationMs: 4_000,
        effect: { kind: 'damage-over-time', amount: 7, intervalMs: 2_000, damageType: 'earth' },
      },
      'm:9', 'hero', 1_000, 'spell',
    );
    expect(condition.targetId).toBe('m:9');
    expect(condition.sourceId).toBe('hero');
    expect(condition.expiresAtMs).toBe(5_000);
    expect(condition.tick).toEqual({ kind: 'damage', amount: 7, intervalMs: 2_000, damageType: 'earth', source: 'spell' });
  });
});

describe('condição de velocidade com sinal — speed (CMB-11, #556)', () => {
  // O ataque do mutated_rat (`data-otservbr-global/monster/mammals/mutated_rat.lua`):
  // `{ name = "speed", speedChange = -600, duration = 30000, target = true }`.
  const paralyzeAttack = {
    kind: 'speed' as const, type: 'paralyze' as const, delta: -600,
  };
  // A defesa do Doom Deer (`.../mammals/doom_deer.lua`): `speedChange = 400`, self-haste.
  const hasteDefense = { kind: 'speed' as const, type: 'haste' as const, delta: 400 };
  // A runa de paralyze (`data/scripts/runes/paralyze_rune.lua`): `setFormula(-1, 0, -1, 0)` —
  // fora do escopo desta issue como CONTEÚDO (M37-05), mas o MECANISMO da fórmula é o mesmo, e
  // é o caso que prende o piso com clareza (a fórmula dá sempre o mesmo `min === max`).
  const paralyzeRuneFormula = {
    kind: 'speed' as const, type: 'paralyze' as const,
    formula: { mina: -1, minb: 0, maxa: -1, maxb: 0 },
  };

  it('o delta do ataque de monstro vira a MESMA fórmula aleatória que o Canary deriva de speedChange', () => {
    // `Monsters::deserializeSpell`: multiplier = 1 + (-600)/1000 = 0.4; mina = 0.2, maxa = 0.4,
    // minb = maxb = 40. Com baseSpeed 220 (`difference` 180): min = trunc(0.2×180+40) = 76,
    // max = trunc(0.4×180+40) = 112 — o alvo sempre fica mais lento (o intervalo inteiro é
    // negativo em relação a 220), mas sem tocar o piso (nenhum ponto do intervalo é < 40-220).
    const percent = resolveSpeedPercent(paralyzeAttack, 220, Rng.fromSeed('cond-speed-1'));
    expect(percent).toBeCloseTo(-49.545454545, 6);
    expect(percent).toBeGreaterThan((76 - 220) / 220 * 100 - 1e-9); // dentro do intervalo…
    expect(percent).toBeLessThan((112 - 220) / 220 * 100 + 1e-9);
  });

  it('a defesa self-haste do Doom Deer (speedChange positivo) acelera', () => {
    const percent = resolveSpeedPercent(hasteDefense, 91, Rng.fromSeed('cond-speed-2'));
    expect(percent).toBeCloseTo(7.692307692, 6);
  });

  it('a fórmula da runa/magia é usada como está, e o piso é speed 40 (a mesma escala do TFS)', () => {
    // mina = maxa = -1: min === max sempre, e vale para QUALQUER baseSpeed — é o que faz a
    // runa de paralyze levar qualquer alvo a exatamente 40 de velocidade, nunca menos.
    const at220 = resolveSpeedPercent(paralyzeRuneFormula, 220, Rng.fromSeed('rune-a'));
    const at300 = resolveSpeedPercent(paralyzeRuneFormula, 300, Rng.fromSeed('rune-b'));
    expect(at220).toBeCloseTo(-81.818181818, 6); // (40 − 220) / 220 × 100
    expect(at300).toBeCloseTo(-86.666666666, 6); // (40 − 300) / 300 × 100
    // As duas convergem no MESMO piso absoluto: 1 + percent/100 é a fração de baseSpeed que
    // sobra, e essa fração × baseSpeed é sempre 40.
    expect((1 + at220 / 100) * 220).toBeCloseTo(40, 9);
    expect((1 + at300 / 100) * 300).toBeCloseTo(40, 9);
  });

  it('o piso vale MESMO com type errado (#641) — content mal rotulado não gera speedScale negativo', () => {
    // O schema já recusa este par (`type` contradiz o sinal da fórmula), mas
    // `resolveSpeedPercent` continua seguro por conta própria: com a runa de paralyze real
    // rotulada por engano como `haste`, o piso ainda prende o resultado em exatamente speed 40
    // — nunca um `speedDelta` correndo solto até um `speedScale` negativo (que congelaria o
    // personagem via `Math.max(1, …)` de `movement.ts` em vez de só acelerar errado).
    const mislabeled = { ...paralyzeRuneFormula, type: 'haste' as const };
    const percent = resolveSpeedPercent(mislabeled, 220, Rng.fromSeed('mislabeled-a'));
    expect(percent).toBeCloseTo(-81.818181818, 6); // idêntico ao paralyze corretamente rotulado
    expect((1 + percent / 100) * 220).toBeCloseTo(40, 9);
    expect(1 + percent / 100).toBeGreaterThan(0); // speedScale nunca fica negativo
  });

  it('speedChange nunca passa de -1000 ("Cant be slower than 100%") — abaixo disso o resultado empata', () => {
    const extremo = { ...paralyzeAttack, delta: -5000 };
    const noPiso = { ...paralyzeAttack, delta: -1000 };
    // A MESMA semente para os dois: se o clamp valer, as duas rolagens são idênticas — e como
    // o multiplicador vira 0 dos dois lados, min === max e nem consomem sorteio (abaixo).
    expect(resolveSpeedPercent(extremo, 220, Rng.fromSeed('clamp')))
      .toBe(resolveSpeedPercent(noPiso, 220, Rng.fromSeed('clamp')));
  });

  it('min === max não consome sorteio, como `uniform_random` do Canary quando os limites coincidem', () => {
    const rng = Rng.fromSeed('no-draw');
    const before = rng.getState();
    // delta -1000: multiplier 0, mina = maxa = 0 → min = max = 40 sempre, para qualquer speed.
    resolveSpeedPercent({ ...paralyzeAttack, delta: -1000 }, 220, rng);
    expect(rng.getState()).toEqual(before);
  });

  it('`conditionFromSpec` recusa compilar speed sem o contexto de velocidade', () => {
    expect(() => conditionFromSpec(
      { key: 'speed', merge: 'refresh', durationMs: 30_000, effect: paralyzeAttack },
      'hero', 'm:1', 0, 'monster-attack',
    )).toThrow(/velocidade/);
  });

  it('haste substitui paralyze, e paralyze substitui haste — mesma chave, sempre uma condição só', () => {
    // As duas nascem da MESMA chave reservada ("speed", exigida pelo schema) — é isso que faz
    // `Conditions.apply` (que sempre substitui) reproduzir o `Creature::onAddCondition` do
    // Canary/TFS sem precisar de lógica de exclusão mútua à parte.
    const conditions = new Conditions();
    const slow = conditionFromSpec(
      { key: 'speed', merge: 'refresh', durationMs: 30_000, effect: paralyzeAttack },
      'hero', 'm:1', 0, 'monster-attack', { baseSpeed: 220, rng: Rng.fromSeed('mutual-a') },
    );
    conditions.apply(slow);
    expect(conditions.size).toBe(1);
    expect(conditions.get('speed')?.speedPercent).toBeLessThan(0);

    const fast = conditionFromSpec(
      { key: 'speed', merge: 'refresh', durationMs: 8_000, effect: hasteDefense },
      'hero', 'm:2', 1_000, 'monster-attack', { baseSpeed: 220, rng: Rng.fromSeed('mutual-b') },
    );
    conditions.apply(fast);
    expect(conditions.size).toBe(1); // continua UMA condição — a paralyze não sobrevive ao lado.
    expect(conditions.get('speed')?.speedPercent).toBeGreaterThan(0);
    expect(conditions.get('speed')?.sourceId).toBe('m:2');

    // E o caminho inverso: paralyze reaplicada por cima da haste também substitui inteira.
    conditions.apply(slow);
    expect(conditions.size).toBe(1);
    expect(conditions.get('speed')?.speedPercent).toBeLessThan(0);
  });

  it('o monstro também expõe `speedScale` — o self-haste e o slow de outro monstro valem para ele', () => {
    const monster = new MonsterRuntime({
      id: 1, monsterId: 'rat', position: { x: 0, y: 0 }, home: { x: 0, y: 0 },
      health: 100, targetId: null, cooldowns: {},
    });
    expect(monster.speedScale).toBe(1);
    const buff = conditionFromSpec(
      { key: 'speed', merge: 'refresh', durationMs: 8_000, effect: hasteDefense },
      monster.subject, monster.subject, 0, 'monster-attack',
      { baseSpeed: 91, rng: Rng.fromSeed('monster-haste-2') },
    );
    monster.conditions.apply(buff);
    expect(monster.speedScale).toBeGreaterThan(1);
  });
});

describe('condições no monstro (CMB-07)', () => {
  const monster = (): MonsterRuntime => new MonsterRuntime({
    id: 7, monsterId: 'rat', position: { x: 2, y: 2 }, home: { x: 2, y: 2 },
    health: 100, targetId: null, cooldowns: {},
  });

  it('o monstro carrega condição, serializa e restaura', () => {
    const runtime = monster();
    runtime.conditions.apply({
      key: 'poison', targetId: 'm:7', expiresAtMs: 5_000,
      tick: { kind: 'damage', amount: 9, intervalMs: 1_000, damageType: 'earth', source: 'spell' },
    });
    const restored = new MonsterRuntime(JSON.parse(JSON.stringify(runtime.getState())) as never);
    expect(restored.conditions.get('poison')?.tick?.amount).toBe(9);
    // Sem condição a chave é omitida: um snapshot anterior a esta issue continua lido.
    expect(monster().getState()).not.toHaveProperty('conditions');
  });
});

describe('the mana shield on the character', () => {
  const state = (shielded = true): CharacterState => ({
    id: 'hero', position: { x: 0, y: 0, z: 7 },
    health: 100, maxHealth: 100, mana: 30, maxMana: 100,
    level: 14, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
    ...(shielded ? { conditions: [{ key: 'mana-shield' as const, spellId: 'magic-shield', expiresAtMs: 180_000 }] } : {}),
  });

  // O CMB-08 tirou o escudo de `receiveDamage`: ele agora é um estágio de `applyDamageOutcome`,
  // e é lá que o teste mede o que absorveu.
  const damage = (resolvedDamage: number): DamageOutcome => ({
    profile: 'combat-v1',
    intent: { rawDamage: resolvedDamage, source: 'monster-attack', damageType: 'physical' },
    damageType: 'physical',
    afterDefense: resolvedDamage, afterArmor: resolvedDamage, armorReduction: 0,
    minimumDamage: 0, afterResistance: resolvedDamage, immune: false, dodged: false,
    critical: false, resolvedDamage,
  });

  it('takes the damage from mana first, and reports what left the health', () => {
    // Mutação que mata: descontar da vida antes da mana, ou informar o total.
    const hero = new CharacterRuntime(state());
    const first = applyDamageOutcome(hero, damage(50), null);
    expect(first.healthDamage).toBe(20);
    expect(first.absorbedByMana).toBe(30);
    expect(hero.mana).toBe(0);
    expect(hero.health).toBe(80);
    // Mana zerada: o escudo continua "ativo", e tudo vai na vida — como no Tibia.
    const second = applyDamageOutcome(hero, damage(10), null);
    expect(second.healthDamage).toBe(10);
    expect(second.absorbedByMana).toBe(0);
    expect(hero.health).toBe(70);
  });

  it('is not there without the condition, and the character serializes direction and conditions', () => {
    const plain = new CharacterRuntime(state(false));
    const hit = applyDamageOutcome(plain, damage(50), null);
    expect(hit.healthDamage).toBe(50);
    expect(hit.absorbedByMana).toBe(0);
    expect(plain.mana).toBe(30);
    expect(plain.direction).toBe('south');
    expect(plain.getState()).not.toHaveProperty('conditions');

    const shielded = new CharacterRuntime(state());
    shielded.direction = 'east';
    const restored = new CharacterRuntime(JSON.parse(JSON.stringify(shielded.getState())) as CharacterState);
    expect(restored.direction).toBe('east');
    expect(restored.conditions.hasManaShield()).toBe(true);
    expect(restored.speedScale).toBe(1);
  });

  it('absorbs from mana via extraManaShield without mana-shield condition, and does not double-absorb when both are active', () => {
    // extraManaShield = true (e.g. Energy Ring) sem a condição mana-shield: o estágio é o de
    // `applyDamageOutcome` (CMB-08), o mesmo da condição.
    const hero = new CharacterRuntime(state(false));
    const ring = applyDamageOutcome(hero, damage(50), null, 1, true);
    expect(ring.healthDamage).toBe(20);
    expect(ring.absorbedByMana).toBe(30);
    expect(hero.mana).toBe(0);
    expect(hero.health).toBe(80);

    // Condição mana-shield E extraManaShield ao mesmo tempo: absorve uma vez só, não debita duas vezes
    const both = new CharacterRuntime(state(true));
    const twice = applyDamageOutcome(both, damage(20), null, 1, true);
    expect(twice.healthDamage).toBe(0);
    expect(twice.absorbedByMana).toBe(20);
    expect(both.mana).toBe(10);
    expect(both.health).toBe(100);
  });
});
