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

const near = { armor: 0, dodgeChance: 0, distance: 1 };
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
    expect(castSpell(caster, strike, { ...near, distance: 4 }, 0, combat, rng()))
      .toEqual({ ok: false, reason: 'out-of-range', retryInMs: 0 });
    // Nenhuma das duas cobrou nada: nem mana, nem cooldown.
    expect(caster.mana).toBe(100);
    expect(caster.cooldowns.isReady(spellCooldownKey('strike'), 0)).toBe(true);
  });

  it('a MANA sai por último: alcance é conferido antes de descontar', () => {
    // Descontar antes de saber se o alvo estava ao alcance é como se perde mana sem lançar
    // nada — o defeito que o jogador nota e não consegue explicar.
    const caster = hero({ mana: 15 });
    expect(castSpell(caster, strike, { ...near, distance: 9 }, 0, combat, rng()).ok).toBe(false);
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
    const result = castSpell(caster, strike, { armor: 10, dodgeChance: 0, distance: 3 }, 0, combat, rng());

    // 40 de poder, 10 de armadura, efetividade mágica 1 neste conteúdo de teste.
    expect(result).toMatchObject({ ok: true, damage: 30, healed: 0 });
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
