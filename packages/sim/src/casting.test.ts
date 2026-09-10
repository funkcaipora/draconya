import { describe, expect, it } from 'vitest';
import type { Combat, Spell, Supply } from '@draconya/content';
import { CharacterRuntime } from './character.js';
import { balanceOf, castSpell, spellCooldownKey, useSupply } from './casting.js';
import { Rng } from './rng.js';

// Esquiva zero e armadura que conta inteira: aqui o assunto é o PORTÃO — level, cooldown,
// alcance, mana e gold —, e um dano que varia por sorteio esconderia exatamente isso. Quem
// cuida da matemática do golpe é `combat/damage.test.ts`.
const combat: Combat = {
  id: 'baseline', dodgeMultiplier: 0.5,
  armorEffectiveness: { melee: 1, magic: 1 }, minimumDamageFraction: 0.1,
  player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0 },
};

const heal: Spell = {
  id: 'heal', name: 'Cura', manaCost: 20, cooldownMs: 1_000, minLevel: 1,
  effect: { kind: 'heal', amount: 60 },
};
const strike: Spell = {
  id: 'strike', name: 'Golpe', manaCost: 15, cooldownMs: 2_000, minLevel: 1,
  effect: { kind: 'damage', power: 40, range: 3 },
};

const potion: Supply = {
  id: 'health-potion', name: 'Poção de Vida', price: 45,
  effect: { kind: 'heal', amount: 80 },
};
const manaPotion: Supply = {
  id: 'mana-potion', name: 'Poção de Mana', price: 50,
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
    effect: { kind: 'damage' as const, power: 30, range: 4, area: { radius: 1 } },
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
