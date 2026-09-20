import { describe, expect, it } from 'vitest';
import type { Combat, Spell, Supply } from '@draconya/content';
import { CharacterRuntime } from './character.js';
import { balanceOf, castSpell, spellCooldownKey, useSupply } from './casting.js';
import { Rng } from './rng.js';

// Esquiva zero e armadura que conta inteira: aqui o assunto é o PORTÃO — level, cooldown,
// alcance, mana e gold —, e um dano que varia por sorteio esconderia exatamente isso. Quem
// cuida da matemática do golpe é `combat/damage.test.ts`.
const combat: Combat = {
  id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 1, earth: 1, fire: 1, ice: 1, holy: 1, death: 1, arcane: 1 }, minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0, damageType: 'physical' },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
};

const heal: Spell = {
  id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000, minLevel: 1,
  effect: { kind: 'heal', amount: 60 },
};
const strike: Spell = {
  id: 'strike', name: 'Golpe', manaCost: 15, cooldownMs: 2_000, minLevel: 1,
  effect: { kind: 'damage', power: 40, range: 3, damageType: 'arcane' },
};

const potion: Supply = {
  id: 'health-potion', name: 'Poção de Vida', price: 45, group: 'potion', groupCooldownMs: 1_000, requires: {},
  effect: { kind: 'heal', amount: 80 },
};
const manaPotion: Supply = {
  id: 'mana-potion', name: 'Poção de Mana', price: 50, group: 'potion', groupCooldownMs: 1_000, requires: {},
  effect: { kind: 'mana', amount: 100 },
};

const hero = (over: Partial<{
  health: number; mana: number; level: number; gold: number; goldDelta: number;
}> = {}): CharacterRuntime => new CharacterRuntime({
  id: 'hero', position: { x: 1, y: 1, z: 7 },
  health: over.health ?? 100, maxHealth: 100,
  mana: over.mana ?? 100, maxMana: 100,
  level: over.level ?? 10, xp: 0, vocationId: null,
  staminaMs: null, staminaUpdatedAtMs: 0,
  gold: over.gold ?? 0, goldDelta: over.goldDelta ?? 0,
  alive: true, cooldowns: {},
});

/** Uma mira de alvo único, que é o caso mais comum. */
const near = (over: Partial<{ armor: number; dodgeChance: number; distance: number }> = {}) => ({
  distance: over.distance ?? 1,
  targets: [{ armor: over.armor ?? 0, dodgeChance: over.dodgeChance ?? 0 }],
});
const rng = () => Rng.fromSeed('casting');

describe('castSpell — o portão, na ordem em que ele custa a descobrir', () => {
  it('recusa abaixo do level mínimo, e não gasta mana nenhuma', () => {
    const caster = hero({ level: 1 });
    const forte: Spell = { ...heal, minLevel: 50 };

    expect(castSpell(caster, forte, null, 0, combat, rng()))
      .toEqual({ ok: false, reason: 'level-too-low', retryInMs: 0 });
    expect(caster.mana).toBe(100);
  });

  it('recusa em cooldown, e DIZ em quanto tempo vale tentar de novo', () => {
    // O prazo não é enfeite: é o que faz a categoria do bot voltar no vencimento em vez de
    // engatilhar e dormir. Um personagem parado, com a cura em cooldown e sem levar dano,
    // nunca veria o mundo mudar — e nunca curaria.
    const caster = hero({ health: 10 });

    expect(castSpell(caster, heal, null, 0, combat, rng()).ok).toBe(true);
    expect(castSpell(caster, heal, null, 400, combat, rng()))
      .toEqual({ ok: false, reason: 'on-cooldown', retryInMs: 600 });
    expect(castSpell(caster, heal, null, 1_000, combat, rng()).ok).toBe(true);
  });

  it('o cooldown é gravado no relógio LÓGICO da sessão, com a chave prefixada', () => {
    // Prefixo porque o mesmo mapa guarda cooldown de outras coisas: `heal` a seco colidiria
    // com um supply de mesmo id no dia em que alguém criasse um.
    const caster = hero();
    castSpell(caster, heal, null, 5_000, combat, rng());
    expect(caster.cooldowns.isReady(spellCooldownKey('heal'), 5_999)).toBe(false);
    expect(caster.cooldowns.isReady(spellCooldownKey('heal'), 6_000)).toBe(true);
  });

  it('magia de dano sem alvo é recusada, e fora de alcance também', () => {
    const caster = hero();
    expect(castSpell(caster, strike, null, 0, combat, rng()).ok).toBe(false);
    expect(castSpell(caster, strike, near({ distance: 4 }), 0, combat, rng()))
      .toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
    // Nenhuma das duas cobrou nada: nem mana, nem cooldown.
    expect(caster.mana).toBe(100);
    expect(caster.cooldowns.isReady(spellCooldownKey('strike'), 0)).toBe(true);
  });

  it('a MANA sai por último: alcance é conferido antes de descontar', () => {
    // Descontar antes de saber se o alvo estava ao alcance é como se perde mana sem lançar
    // nada — o defeito que o jogador nota e não consegue explicar.
    const caster = hero({ mana: 15 });
    expect(castSpell(caster, strike, near({ distance: 9 }), 0, combat, rng()).ok).toBe(false);
    expect(caster.mana).toBe(15);
  });

  it('sem mana, recusa — e "sem mana" não melhora com o tempo, então não há prazo', () => {
    const caster = hero({ mana: 5 });
    expect(castSpell(caster, heal, null, 0, combat, rng()))
      .toEqual({ ok: false, reason: 'not-enough-mana', retryInMs: 0 });
  });
});

describe('castSpell — o efeito', () => {
  it('cura devolve o quanto REPÔS, não o quanto o conteúdo prometia', () => {
    // Curar 60 em quem estava a 10 do teto é uma cura de 10. Contar 60 faria toda métrica de
    // eficiência de poção e magia mentir.
    const caster = hero({ health: 90 });
    const result = castSpell(caster, heal, null, 0, combat, rng());

    expect(result).toMatchObject({ ok: true, healed: 10, damage: 0 });
    expect(caster.health).toBe(100);
    expect(caster.mana).toBe(80);
  });

  it('dano sai RESOLVIDO e não aplicado: quem tem o alvo é quem o aplica', () => {
    // Aplicar é também atribuir (`recordDamage`) e resolver morte. Fazer isso aqui seria a
    // atribuição escrita em dois lugares, e o `AGENTS.md` deste pacote é explícito: não pague
    // duas vezes por saber quem matou.
    const caster = hero();
    const result = castSpell(caster, strike, near({ armor: 10, distance: 3 }), 0, combat, rng());

    // 40 de poder, 10 de armadura, efetividade mágica 1 neste conteúdo de teste.
    expect(result).toMatchObject({ ok: true, damage: 30, hits: [30], healed: 0 });
    expect(caster.mana).toBe(85);
  });
});

describe('useSupply — gold, e o saldo que nunca fica negativo', () => {
  it('debita o preço do delta da sessão e diz quanto gastou', () => {
    const user = hero({ health: 50, gold: 100 });
    const result = useSupply(user, potion);

    expect(result).toMatchObject({ ok: true, healed: 50, goldSpent: 45 });
    expect(user.goldDelta).toBe(-45);
    expect(balanceOf(user)).toBe(55);
  });

  it('poção de mana repõe MANA, e não vida', () => {
    const user = hero({ health: 50, mana: 10, gold: 100 });
    expect(useSupply(user, manaPotion)).toMatchObject({ ok: true, manaRestored: 90, healed: 0 });
    expect(user.health).toBe(50);
    expect(user.mana).toBe(100);
  });

  it('o saldo é o de ENTRADA mais o delta: loot desta sessão já dá para gastar', () => {
    // Gold ganho na hunt é gastável na hunt. Exigir que ele passasse pelo banco antes seria
    // o oposto do idle-first: a poção só chegaria depois de encerrar a sessão.
    const user = hero({ gold: 0, goldDelta: 60 });
    expect(useSupply(user, potion).ok).toBe(true);
    expect(balanceOf(user)).toBe(15);
  });

  it('recusa quando falta gold, e NADA é debitado', () => {
    // O saldo nunca fica negativo, e a garantia é a ordem: recusar antes, não corrigir depois.
    const user = hero({ health: 10, gold: 44 });
    expect(useSupply(user, potion))
      .toEqual({ ok: false, reason: 'not-enough-gold', retryInMs: 0 });
    expect(user.goldDelta).toBe(0);
    expect(user.health).toBe(10);
  });

  it('o preço exato PASSA — a recusa é por falta, não por chegar no limite', () => {
    const user = hero({ gold: 45 });
    expect(useSupply(user, potion).ok).toBe(true);
    expect(balanceOf(user)).toBe(0);
  });
});

describe('magia em ÁREA (FUN-92)', () => {
  const blast = {
    id: 'blast', name: 'Explosão', manaCost: 60, cooldownMs: 4_000, minLevel: 1,
    effect: { kind: 'damage' as const, power: 30, range: 4, damageType: 'fire' as const, area: { shape: 'circle' as const, radius: 1, centered: 'target' as const } },
  };
  const aim = (targets: readonly { armor: number; dodgeChance: number }[], distance = 2) =>
    ({ distance, targets });

  it('resolve uma rolagem POR ALVO, e devolve o dano de cada um em ordem', () => {
    const caster = hero();
    const result = castSpell(
      caster, blast, aim([{ armor: 0, dodgeChance: 0 }, { armor: 10, dodgeChance: 0 }]),
      0, combat, rng(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Armaduras diferentes, danos diferentes — e na mesma ordem em que os alvos entraram.
    expect(result.hits).toEqual([30, 20]);
    expect(result.damage).toBe(50);
  });

  it('a ordem dos alvos é CONTRATO: ela decide qual sorteio cai em quem', () => {
    // Cada alvo consome uma rolagem do RNG da sessão. Trocar a ordem troca o resultado, e é
    // por isso que quem colhe os alvos tem de fazê-lo sempre na mesma ordem.
    const esquiva = [{ armor: 0, dodgeChance: 0.5 }, { armor: 0, dodgeChance: 0 }];
    const direto = castSpell(hero(), blast, aim(esquiva), 0, combat, rng());
    const trocado = castSpell(hero(), blast, aim([...esquiva].reverse()), 0, combat, rng());

    if (!direto.ok || !trocado.ok) throw new Error('esperava dois lançamentos');
    expect(direto.hits).not.toEqual([...trocado.hits].reverse());
  });

  it('a mesma mira, com a mesma semente, dá o MESMO resultado', () => {
    const alvos = [
      { armor: 0, dodgeChance: 0.5 }, { armor: 2, dodgeChance: 0.5 },
      { armor: 4, dodgeChance: 0.5 },
    ];
    const uma = castSpell(hero(), blast, aim(alvos), 0, combat, rng());
    const outra = castSpell(hero(), blast, aim(alvos), 0, combat, rng());
    if (!uma.ok || !outra.ok) throw new Error('esperava dois lançamentos');
    expect(uma.hits).toEqual(outra.hits);
  });

  it('custa a mesma mana batendo em um ou em cinco', () => {
    // O custo é da MAGIA, não do número de alvos. Cobrar por alvo faria o jogador pagar mais
    // por lançar no lugar certo, que é o inverso do que uma magia de área quer ensinar.
    const um = hero();
    const cinco = hero();
    castSpell(um, blast, aim([{ armor: 0, dodgeChance: 0 }]), 0, combat, rng());
    castSpell(
      cinco, blast,
      aim(Array.from({ length: 5 }, () => ({ armor: 0, dodgeChance: 0 }))),
      0, combat, rng(),
    );
    expect(um.mana).toBe(cinco.mana);
  });

  it('mira vazia é recusada como "sem alvo"', () => {
    expect(castSpell(hero(), blast, aim([]), 0, combat, rng()))
      .toEqual({ ok: false, reason: 'no-target', retryInMs: 0 });
  });

  it('só o alvo PRINCIPAL é conferido contra o alcance', () => {
    // Quem foi pego pela área está lá porque cai dentro do raio, não porque o lançador o
    // alcança. Conferir cada um contra o alcance faria a área encolher para o alcance.
    const dentro = castSpell(
      hero(), blast, aim([{ armor: 0, dodgeChance: 0 }], 4), 0, combat, rng(),
    );
    expect(dentro.ok).toBe(true);
    expect(castSpell(hero(), blast, aim([{ armor: 0, dodgeChance: 0 }], 5), 0, combat, rng()))
      .toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
  });
});

describe('requisito de VOCAÇÃO (FUN-92)', () => {
  const druidica = { ...heal, id: 'nature-heal', vocationId: 'druid' };

  it('recusa quem não tem a vocação, e nada é cobrado', () => {
    const cavaleiro = hero({ level: 20 });
    cavaleiro.vocationId = 'knight';
    expect(castSpell(cavaleiro, druidica, null, 0, combat, rng()))
      .toEqual({ ok: false, reason: 'wrong-vocation', retryInMs: 0 });
    expect(cavaleiro.mana).toBe(100);
  });

  it('quem TEM a vocação lança normalmente', () => {
    const druida = hero({ level: 20, health: 50 });
    druida.vocationId = 'druid';
    expect(castSpell(druida, druidica, null, 0, combat, rng()).ok).toBe(true);
  });

  it('personagem SEM vocação não lança magia de vocação — e é por construção', () => {
    // O personagem nasce sem vocação e escolhe no level 8 (§7.4). Uma magia com requisito é
    // inacessível até lá sem nenhuma regra escrita em outro lugar.
    const novato = hero({ level: 1 });
    expect(novato.vocationId).toBeNull();
    expect(castSpell(novato, druidica, null, 0, combat, rng()).ok).toBe(false);
  });

  it('magia SEM requisito continua valendo para todo mundo', () => {
    const novato = hero({ health: 50 });
    expect(castSpell(novato, heal, null, 0, combat, rng()).ok).toBe(true);
  });

  it('a recusa por vocação NÃO tem prazo — esperar não faz ninguém virar druida', () => {
    const cavaleiro = hero();
    cavaleiro.vocationId = 'knight';
    const recusa = castSpell(cavaleiro, druidica, null, 0, combat, rng());
    expect(recusa.ok).toBe(false);
    if (!recusa.ok) expect(recusa.retryInMs).toBe(0);
  });
});

describe('o catálogo do Tibia (#155, ADR 0026 decisão 5)', () => {
  // A conversão do Base Power (`spellPowerRange`) migrou para `@draconya/content` (#436, ADR
  // 0033) — o cliente precisa dela para a prévia sem importar `sim`. O teste da fórmula em si
  // mora em `packages/content/src/spell-power.test.ts`; aqui fica só a integração com `castSpell`.
  it('a basePower spell rolls in the range and does NOT stack the per-use skill multiplier (DT-03)', () => {
    const bp: Spell = { ...heal, id: 'light-healing', effect: { kind: 'heal', basePower: 40 } };
    const caster = hero({ level: 8, health: 1 });
    const result = castSpell(caster, bp, null, 0, combat, rng(), { skillLevel: 0, powerScale: 10 });
    expect(result.ok && result.healed).toBeGreaterThanOrEqual(50);
    expect(result.ok && result.healed).toBeLessThanOrEqual(69);
    // O fixo continua escalando pelas skills por uso.
    const fixed = castSpell(hero({ level: 8, health: 1 }), heal, null, 0, combat, rng(), { skillLevel: 0, powerScale: 1.5 });
    expect(fixed.ok && fixed.healed).toBe(90);
  });

  it('the group locks every spell of the group, the secondary only its own, and no mana leaves on refusal', () => {
    const flame: Spell = {
      ...strike, id: 'flame-strike', group: 'attack', groupCooldownMs: 2_000, cooldownMs: 2_000,
      effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'fire' },
    };
    const beam: Spell = {
      ...flame, id: 'great-energy-beam', groupCooldownMs: 2_000, cooldownMs: 6_000,
      secondaryGroup: { name: 'great-beams', cooldownMs: 6_000 },
      effect: { kind: 'damage', basePower: 155, area: { shape: 'beam', length: 8 }, damageType: 'energy' },
    };
    const deathBeam: Spell = { ...beam, id: 'great-death-beam' };
    const stance: Spell = {
      ...heal, id: 'blood-rage', manaCost: 20, group: 'support', groupCooldownMs: 2_000,
      secondaryGroup: { name: 'stance', cooldownMs: 2_000 },
      effect: { kind: 'buff', durationMs: 10_000, damageDealtPercent: { melee: 25 }, damageTakenPercent: 15 },
    };
    const caster = hero({ level: 80, mana: 1_000 });

    expect(castSpell(caster, beam, near(), 0, combat, rng()).ok).toBe(true);
    // O grupo `attack` trancou por 2 s: a outra magia do grupo espera, com o prazo.
    expect(castSpell(caster, flame, near(), 500, combat, rng()))
      .toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 1_500 });
    // O secundário `great-beams` tranca por 6 s — e só as que o têm.
    expect(castSpell(caster, deathBeam, near(), 2_000, combat, rng()))
      .toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 4_000 });
    expect(castSpell(caster, flame, near(), 2_000, combat, rng()).ok).toBe(true);
    // A postura é de outro grupo: passa, e devolve a condição SEM aplicar nada.
    const manaBefore = caster.mana;
    const buffed = castSpell(caster, stance, null, 2_000, combat, rng());
    expect(buffed.ok && buffed.condition).toEqual({
      key: 'buff', spellId: 'blood-rage', expiresAtMs: 12_000,
      damageDealtPercent: { melee: 25 }, damageTakenPercent: 15,
    });
    expect(caster.mana).toBe(manaBefore - 20);
    expect(caster.conditions.size).toBe(0);
    // Recusa por grupo não gasta mana.
    const before = caster.mana;
    expect(castSpell(caster, deathBeam, near(), 3_000, combat, rng()).ok).toBe(false);
    expect(caster.mana).toBe(before);
  });

  it('haste, mana shield and heal-over-time come back as conditions with the logical deadline', () => {
    const caster = hero({ level: 50, mana: 1_000 });
    const haste: Spell = { ...heal, id: 'haste', effect: { kind: 'haste', speedPercent: 30, durationMs: 30_000 } };
    const shield: Spell = { ...heal, id: 'magic-shield', effect: { kind: 'mana-shield', durationMs: 180_000 } };
    const recovery: Spell = { ...heal, id: 'recovery', effect: { kind: 'heal-over-time', amount: 20, intervalMs: 3_000, durationMs: 60_000 } };
    const at = (spell: Spell, now: number) => castSpell(caster, spell, null, now, combat, rng());
    expect(at(haste, 1_000)).toMatchObject({ ok: true, condition: { key: 'haste', expiresAtMs: 31_000, speedPercent: 30 } });
    expect(at(shield, 1_000)).toMatchObject({ ok: true, condition: { key: 'mana-shield', expiresAtMs: 181_000 } });
    expect(at(recovery, 1_000)).toMatchObject({
      ok: true, condition: { key: 'heal-over-time', expiresAtMs: 61_000, tick: { amount: 20, intervalMs: 3_000 } },
    });
  });

  it('a self-origin shape needs no range and no primary distance; the posture scales the spell hit', () => {
    const wave: Spell = {
      ...strike, id: 'fire-wave', effect: { kind: 'damage', power: 40, area: { shape: 'wave', length: 3 }, damageType: 'fire' },
    };
    const caster = hero({ level: 20 });
    // A mira vem com `distance: 0` e os alvos colhidos pela forma; o alcance não é conferido.
    const aim = { distance: 0, targets: [{ armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 }] };
    const plain = castSpell(caster, wave, aim, 0, combat, rng());
    expect(plain.ok && plain.hits).toHaveLength(2);
    caster.conditions.apply({ key: 'buff', spellId: 'x', expiresAtMs: 9_999, damageDealtPercent: { spell: -50 } });
    const halved = castSpell(caster, wave, aim, 5_000, combat, rng());
    if (!halved.ok || !plain.ok) throw new Error('lançamento recusado');
    expect(halved.damage).toBeLessThan(plain.damage);
  });
});

describe('a fórmula canônica do Canary (#474)', () => {
  // Ice Strike (`exori frigo`): min = level/5 + ML×1.403 + 8, max = level/5 + ML×2.203 + 13.
  // O `basePower` 45 continua no arquivo como número de exibição (ADR 0033); a fórmula vence.
  const canaryIceStrike: Spell = {
    ...strike, id: 'ice-strike', manaCost: 12, cooldownMs: 2_000,
    group: 'attack', groupCooldownMs: 2_000, minLevel: 8, vocationId: 'sorcerer',
    effect: {
      kind: 'damage', basePower: 45, range: 3, damageType: 'ice',
      formula: { levelFactor: 0.2, skillMin: 1.403, skillMax: 2.203, baseMin: 8, baseMax: 13 },
    },
  };
  const mage = (): CharacterRuntime => {
    const caster = hero({ level: 50, mana: 100 });
    caster.vocationId = 'sorcerer';
    return caster;
  };
  const scaling = { skillLevel: 40, powerScale: 1 };

  it('level 50 e ML 40 rendem a faixa Canary 74~111, não a do basePower', () => {
    const result = castSpell(mage(), canaryIceStrike, near({ distance: 3 }), 0, combat, rng(), scaling);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // min = 10 + 40×1.403 + 8 = 74; max = 10 + 40×2.203 + 13 = 111. Sem armadura o golpe é o
    // poder sorteado. Mutação que mata: cair no `basePower` (45) daria uma faixa de 382~518.
    expect(result.hits[0]).toBeGreaterThanOrEqual(74);
    expect(result.hits[0]).toBeLessThanOrEqual(111);
  });

  it('a fórmula VENCE o basePower, e a mana e o cooldown saem normalmente', () => {
    const caster = mage();
    const comFormula = castSpell(caster, canaryIceStrike, near({ distance: 3 }), 0, combat, rng(), scaling);
    const soBasePower = castSpell(
      mage(), { ...canaryIceStrike, effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'ice' } },
      near({ distance: 3 }), 0, combat, rng(), scaling,
    );
    expect(comFormula.ok && comFormula.hits[0]).toBeLessThanOrEqual(111);
    expect(soBasePower.ok && soBasePower.hits[0]).toBeGreaterThan(111);
    expect(caster.mana).toBe(88);
    expect(caster.cooldowns.isReady(spellCooldownKey('ice-strike'), 1_999)).toBe(false);
    expect(caster.cooldowns.isReady(spellCooldownKey('ice-strike'), 2_000)).toBe(true);
  });

  it('a fórmula consome exatamente os MESMOS sorteios que o basePower (ordem de RNG intacta)', () => {
    // Trocar a fórmula muda o NÚMERO do dano, nunca a posição/quantidade de sorteio: os dois
    // caminhos fazem UM `rng.integer` pelo poder, e o resolver canônico faz o resto. Se a
    // fórmula introduzisse um sorteio a mais, o estado do RNG divergiria aqui — e toda hunt
    // retomada da mesma semente passaria a render outra coisa (ADR 0031, DT-03).
    const formulaRng = rng();
    const baseRng = rng();
    castSpell(mage(), canaryIceStrike, near({ distance: 3 }), 0, combat, formulaRng, scaling);
    castSpell(
      mage(),
      { ...canaryIceStrike, effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'ice' } },
      near({ distance: 3 }), 0, combat, baseRng, scaling,
    );
    expect(formulaRng.getState()).toEqual(baseRng.getState());
  });

  it('sem mana a magia é recusada, a mana fica intacta e o cooldown NÃO é consumido (RF-04)', () => {
    const caster = hero({ level: 50, mana: 11 });
    caster.vocationId = 'sorcerer';
    expect(castSpell(caster, canaryIceStrike, near({ distance: 3 }), 0, combat, rng(), scaling))
      .toEqual({ ok: false, reason: 'not-enough-mana', retryInMs: 0 });
    expect(caster.mana).toBe(11);
    expect(caster.cooldowns.isReady(spellCooldownKey('ice-strike'), 0)).toBe(true);
    expect(caster.cooldowns.isReady('group:attack', 0)).toBe(true);
  });

  it('o grupo `attack` tranca as outras magias do grupo por 2000ms (RF-05)', () => {
    const caster = mage();
    expect(castSpell(caster, canaryIceStrike, near({ distance: 3 }), 0, combat, rng(), scaling).ok).toBe(true);
    const flame: Spell = { ...canaryIceStrike, id: 'flame-strike', effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'fire' } };
    expect(castSpell(caster, flame, near({ distance: 3 }), 500, combat, rng(), scaling))
      .toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 1_500 });
    // No vencimento do grupo, outra magia do grupo passa — o cooldown é do GRUPO, não da magia.
    expect(castSpell(caster, flame, near({ distance: 3 }), 2_000, combat, rng(), scaling).ok).toBe(true);
  });
});

describe('a runa Avalanche — supply de ataque em área (#165, ADR 0026 decisão 8)', () => {
  const rune: Supply = {
    id: 'avalanche-rune', name: 'Avalanche Rune', price: 14, group: 'attack', groupCooldownMs: 2_000,
    requires: { level: 30, magicLevel: 4 },
    effect: { kind: 'damage', basePower: 45, range: 4, damageType: 'ice', area: { shape: 'circle', radius: 3, centered: 'target' } },
  };
  const three = { distance: 2, targets: [{ armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 }, { armor: 0, dodgeChance: 0 }] };
  const scaling = (skillLevel: number) => ({ skillLevel, powerScale: 1 });

  it('hits every target in the aim with one roll each, and charges the gold ONCE', () => {
    const caster = hero({ level: 30, gold: 100 });
    const result = useSupply(caster, rune, three, combat, rng(), scaling(4));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits).toHaveLength(3);
    expect(result.hits.every((hit) => hit > 0)).toBe(true);
    expect(result.goldSpent).toBe(14);
    expect(caster.goldDelta).toBe(-14);
    // A mesma semente dá o mesmo dano.
    const again = useSupply(hero({ level: 30, gold: 100 }), rune, three, combat, rng(), scaling(4));
    expect(again.ok && again.hits).toEqual(result.hits);
  });

  it('refuses by level, magic level, target, range and gold — and NEVER charges on a refusal', () => {
    // Mutação que mata: subir o débito para antes da mira (runa em ninguém custaria).
    const at = (level: number, gold: number, skill: number, aim: typeof three | null) => {
      const caster = hero({ level, gold });
      const result = useSupply(caster, rune, aim, combat, rng(), scaling(skill));
      return { result, gold: caster.goldDelta };
    };
    expect(at(29, 100, 4, three)).toEqual({ result: { ok: false, reason: 'level-too-low', retryInMs: 0 }, gold: 0 });
    expect(at(30, 100, 3, three)).toEqual({ result: { ok: false, reason: 'magic-level-too-low', retryInMs: 0 }, gold: 0 });
    expect(at(30, 100, 4, null)).toEqual({ result: { ok: false, reason: 'no-target', retryInMs: 0 }, gold: 0 });
    expect(at(30, 100, 4, { ...three, distance: 5 })).toEqual({ result: { ok: false, reason: 'out-of-range', retryInMs: 0 }, gold: 0 });
    expect(at(30, 10, 4, three)).toEqual({ result: { ok: false, reason: 'not-enough-gold', retryInMs: 0 }, gold: 0 });
  });

  it('without combat context the rune does not exist — never damage without an rng', () => {
    // Sem `scaling` o magic level é zero e recusa antes; sem `combat`/`rng` com scaling, cai
    // em `not-in-catalog` — e em nenhum dos dois o gold sai.
    const caster = hero({ level: 30, gold: 100 });
    expect(useSupply(caster, rune, three)).toEqual({ ok: false, reason: 'magic-level-too-low', retryInMs: 0 });
    expect(useSupply(caster, rune, three, undefined, undefined, scaling(4))).toEqual({ ok: false, reason: 'not-in-catalog', retryInMs: 0 });
    expect(caster.goldDelta).toBe(0);
    // A poção continua no caminho de sempre, sem contexto nenhum.
    expect(useSupply(hero({ health: 10, gold: 100 }), potion).ok).toBe(true);
  });
});

describe('quem paga o supply é a Purse (#192, ADR 0027)', () => {
  it('a refusing purse debits nothing and heals nothing; a paying one is charged after the checks', () => {
    // Mutação que mata: debitar ou curar antes de `canAfford` — a poção sairia sem pagar.
    const potion = { id: 'health-potion', name: 'Poção', price: 45, group: 'potion' as const, groupCooldownMs: 1_000, requires: {}, effect: { kind: 'heal' as const, amount: 80 } };
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 7 }, health: 10, maxHealth: 500, mana: 0, maxMana: 0,
      level: 1, xp: 0, gold: 1_000, goldDelta: 0, alive: true, cooldowns: {},
    });
    const paid: number[] = [];
    const refusing = { canAfford: () => false, pay: (cost: number) => { paid.push(cost); } };
    expect(useSupply(hero, potion, null, undefined, undefined, undefined, refusing)).toMatchObject({ ok: false, reason: 'not-enough-gold' });
    expect(hero.health).toBe(10);
    expect(hero.goldDelta).toBe(0);
    expect(paid).toEqual([]);

    const paying = { canAfford: () => true, pay: (cost: number) => { paid.push(cost); } };
    expect(useSupply(hero, potion, null, undefined, undefined, undefined, paying)).toMatchObject({ ok: true, healed: 80, goldSpent: 45 });
    expect(paid).toEqual([45]);
    // A bolsa de UM é o de sempre: saldo dele, débito nele.
    expect(useSupply(hero, potion)).toMatchObject({ ok: true, goldSpent: 45 });
    expect(hero.goldDelta).toBe(-45);
  });
});

describe('a fórmula canônica de cura e as runas UH/IH (#475)', () => {
  // Light Healing (`exura`): min = level/5 + ML×1.4 + 8, max = level/5 + ML×2.0 + 11.
  const canaryLightHealing: Spell = {
    ...heal, id: 'light-healing', manaCost: 20, cooldownMs: 1_000,
    group: 'healing', groupCooldownMs: 1_000, minLevel: 8,
    effect: {
      kind: 'heal', basePower: 40,
      formula: { levelFactor: 0.2, skillMin: 1.4, skillMax: 2.0, baseMin: 8, baseMax: 11 },
    },
  };
  // Intense Healing (`exura gran`): outra magia do MESMO grupo, para o cooldown de grupo.
  const canaryIntenseHealing: Spell = {
    ...canaryLightHealing, id: 'intense-healing',
    effect: {
      kind: 'heal', basePower: 120,
      formula: { levelFactor: 0.2, skillMin: 2.4, skillMax: 3.0, baseMin: 20, baseMax: 30 },
    },
  };
  const canaryFlame: Spell = {
    ...strike, id: 'flame-strike', group: 'attack', groupCooldownMs: 2_000, cooldownMs: 2_000,
    effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'fire' },
  };
  // Outra magia do MESMO grupo `attack`: com ids distintos, o cooldown individual não mascara
  // o de grupo — é ele que o teste da independência precisa enxergar.
  const canaryIce: Spell = {
    ...canaryFlame, id: 'ice-strike', effect: { kind: 'damage', basePower: 45, range: 3, damageType: 'ice' },
  };
  const uhRune: Supply = {
    id: 'ultimate-healing-rune', name: 'Ultimate Healing Rune', price: 35,
    group: 'healing', groupCooldownMs: 1_000,
    requires: { level: 24, magicLevel: 4 },
    effect: {
      kind: 'heal', range: 4,
      formula: { levelFactor: 0.2, skillMin: 5.7, skillMax: 10.3, baseMin: 36, baseMax: 65 },
    },
  };
  const ihRune: Supply = {
    ...uhRune, id: 'intense-healing-rune', price: 20, requires: { level: 8, magicLevel: 1 },
    effect: {
      kind: 'heal', range: 4,
      formula: { levelFactor: 0.2, skillMin: 2.4, skillMax: 3.0, baseMin: 20, baseMax: 30 },
    },
  };
  // A cura escala pelo MAGIC LEVEL, não pela skill de magia da vocação.
  const magic = { skillLevel: 0, powerScale: 1, magicLevel: 40 };
  /** Teto alto para a cura não ser clampada: o assunto aqui é a FAIXA, não o overheal. */
  const mage = (health: number, mana = 1_000): CharacterRuntime => {
    const caster = hero({ level: 50, health, mana });
    caster.maxHealth = 5_000;
    return caster;
  };

  it('level 50 e ML 40 rendem a faixa Canary 74~101, não a do basePower', () => {
    const result = castSpell(mage(1), canaryLightHealing, null, 0, combat, rng(), magic);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // min = 10 + 40×1.4 + 8 = 74; max = 10 + 40×2.0 + 11 = 101. Mutação que mata: cair no
    // `basePower` 40 daria 340~460.
    expect(result.healed).toBeGreaterThanOrEqual(74);
    expect(result.healed).toBeLessThanOrEqual(101);
  });

  it('a fórmula VENCE o basePower — os dois caminhos consomem os MESMOS sorteios', () => {
    const formulaRng = rng();
    const baseRng = rng();
    const withFormula = castSpell(mage(1), canaryLightHealing, null, 0, combat, formulaRng, magic);
    const onlyBase = castSpell(
      mage(1),
      { ...canaryLightHealing, effect: { kind: 'heal', basePower: 40 } },
      null, 0, combat, baseRng, magic,
    );
    expect(withFormula.ok && withFormula.healed).toBeLessThanOrEqual(101);
    expect(onlyBase.ok && onlyBase.healed).toBeGreaterThan(101);
    // A ordem de RNG não muda: a fórmula troca o NÚMERO, nunca a quantidade de sorteios.
    expect(formulaRng.getState()).toEqual(baseRng.getState());
  });

  it('a cura é limitada ao HP máximo e devolve o que REPÔS, não o que prometia (RF-04)', () => {
    const caster = hero({ level: 50, health: 95 });
    const result = castSpell(caster, canaryLightHealing, null, 0, combat, rng(), magic);
    expect(result).toMatchObject({ ok: true, healed: 5 });
    expect(caster.health).toBe(100);
  });

  it('o grupo `healing` (1000ms) é INDEPENDENTE do grupo `attack` (2000ms) (RF-03)', () => {
    // Cura primeiro: o ataque não espera o livro da cura.
    const caster = hero({ level: 50, mana: 1_000, health: 1 });
    expect(castSpell(caster, canaryLightHealing, null, 0, combat, rng(), magic).ok).toBe(true);
    expect(castSpell(caster, canaryFlame, near(), 500, combat, rng()).ok).toBe(true);
    // A segunda CURA (outra magia do grupo) espera os 1000ms do livro `healing`.
    expect(castSpell(caster, canaryIntenseHealing, null, 500, combat, rng(), magic))
      .toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 500 });
    expect(castSpell(caster, canaryIntenseHealing, null, 1_000, combat, rng(), magic).ok).toBe(true);

    // Ataque primeiro: a cura não espera o livro do ataque (que tranca 2000ms).
    const outro = hero({ level: 50, mana: 1_000, health: 1 });
    expect(castSpell(outro, canaryFlame, near(), 0, combat, rng()).ok).toBe(true);
    expect(castSpell(outro, canaryLightHealing, null, 500, combat, rng(), magic).ok).toBe(true);
    expect(castSpell(outro, canaryIce, near(), 1_000, combat, rng()))
      .toEqual({ ok: false, reason: 'group-cooldown', retryInMs: 1_000 });
  });

  it('a UH rune escala pelo magic level, debita o gold e tranca o grupo `healing` (RF-02)', () => {
    const user = hero({ level: 50, health: 100, gold: 100 });
    user.maxHealth = 5_000;
    const result = useSupply(user, uhRune, null, combat, rng(), magic, undefined, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // min = 10 + 40×5.7 + 36 = 274; max = 10 + 40×10.3 + 65 = 487.
    expect(result.healed).toBeGreaterThanOrEqual(274);
    expect(result.healed).toBeLessThanOrEqual(487);
    expect(result.goldSpent).toBe(35);
    expect(user.goldDelta).toBe(-35);
    expect(user.cooldowns.isReady('group:healing', 999)).toBe(false);
    expect(user.cooldowns.isReady('group:healing', 1_000)).toBe(true);
  });

  it('a IH rune recusa por magic level e não cura sem contexto — sem cobrar gold', () => {
    // Abaixo do ML exigido: recusa antes do gold.
    const fraco = hero({ level: 50, gold: 100 });
    expect(useSupply(fraco, ihRune, null, combat, rng(), { skillLevel: 0, powerScale: 1, magicLevel: 0 }))
      .toEqual({ ok: false, reason: 'magic-level-too-low', retryInMs: 0 });
    expect(fraco.goldDelta).toBe(0);
    // Sem combate/rng a runa escalada não existe — e o gold NÃO sai.
    const semContexto = hero({ level: 50, gold: 100 });
    expect(useSupply(semContexto, ihRune, null, undefined, undefined, magic))
      .toEqual({ ok: false, reason: 'not-in-catalog', retryInMs: 0 });
    expect(semContexto.goldDelta).toBe(0);
  });
});
