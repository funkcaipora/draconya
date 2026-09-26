// O estágio de defesa do perfil `combat-v1` (CMB-04, emenda do ADR 0031).
//
// O que este arquivo prende: a fórmula é do Draconya (nenhuma engine externa é aproximada), o
// bloqueio entra ANTES da armadura e o piso continua sendo do PODER BRUTO; e a posição do RNG
// é contrato — o Dodge rola primeiro, o bloqueio só rola com fonte elegível e tipo aprovado.

import { compileMitigation } from '@draconya/content';
import type { Combat, DamageType } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { Rng } from '../rng.js';
import { resolveDamage } from './damage.js';
import type { DamageIntent, Defender } from './damage.js';
import { NO_DEFENSE, resolveDefense } from './defense.js';
import type { DefenseSource } from './defense.js';

const combat: Combat = {
  id: 'baseline',
  compatibilityProfile: 'combat-v1',
  dodgeMultiplier: 0.5,
  armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, drown: 0, lifedrain: 0, manadrain: 0, arcane: 0 },
  minimumDamageFraction: 0.1,
  player: {
    attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 4, dodgeChance: 0.05,
    damageType: 'physical',
  },
  spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
  // Sempre bloqueia, e só físico: os testes de RNG usam um gerador de mentira.
  defense: { skillId: 'shielding', blockChance: 1, blockTypes: ['physical'] },
};

/** Gerador de mentira: separa "bloqueou" de "não bloqueou" sem depender de semente. */
const rigged = (blocks: boolean): Rng => ({ chance: () => blocks } as unknown as Rng);

/** Sorteios na ORDEM do golpe: Dodge primeiro, bloqueio depois. */
const rolls = (...values: boolean[]): Rng => {
  let index = 0;
  return { chance: () => values[index++] ?? false } as unknown as Rng;
};

const hit = (rawDamage: number, damageType: DamageType = 'physical'): DamageIntent =>
  ({ rawDamage, source: 'basic-attack', damageType });

const swing = hit(100);
const shield = (defense: number): DefenseSource => ({ kind: 'shield', defense });

describe('resolveDefense', () => {
  it('sem fonte é identidade e NÃO consome sorteio nenhum', () => {
    // É o que preserva o v1 bit a bit: o conteúdo que não declara defesa consome exatamente os
    // mesmos sorteios de antes.
    const rng = Rng.fromSeed('x');
    const before = rng.getState();
    expect(resolveDefense(swing, undefined, combat, rng))
      .toEqual({ source: 'none', blocked: 0, afterDefense: 100 });
    expect(rng.getState()).toEqual(before);
  });

  it('fonte "none" também é identidade', () => {
    const rng = Rng.fromSeed('x');
    const before = rng.getState();
    expect(resolveDefense(swing, NO_DEFENSE, combat, rng))
      .toEqual({ source: 'none', blocked: 0, afterDefense: 100 });
    expect(rng.getState()).toEqual(before);
  });

  it('o escudo bloqueia até o valor da peça', () => {
    expect(resolveDefense(swing, shield(30), combat, rigged(true)))
      .toEqual({ source: 'shield', blocked: 30, afterDefense: 70 });
  });

  it('a rolagem decide: sem bloqueio, o poder passa intacto', () => {
    expect(resolveDefense(swing, shield(30), combat, rigged(false)))
      .toEqual({ source: 'shield', blocked: 0, afterDefense: 100 });
  });

  it('defesa ACIMA do poder é limitada ao poder — sem dano negativo', () => {
    expect(resolveDefense(swing, shield(500), combat, rigged(true)))
      .toEqual({ source: 'shield', blocked: 100, afterDefense: 0 });
  });

  it('defesa 0 ainda é fonte e ainda consome a rolagem', () => {
    // A sequência não pode depender do VALOR da peça: uma fonte elegível rola do mesmo jeito.
    const zero = Rng.fromSeed('x');
    const trinta = Rng.fromSeed('x');
    resolveDefense(swing, shield(0), combat, zero);
    resolveDefense(swing, shield(30), combat, trinta);
    expect(zero.getState()).toEqual(trinta.getState());
  });

  it('tipo fora de blockTypes passa intacto e NÃO consome sorteio', () => {
    // É o que impede um ataque elemental de treinar shielding por acidente.
    const rng = Rng.fromSeed('x');
    const before = rng.getState();
    expect(resolveDefense(hit(100, 'fire'), shield(30), combat, rng))
      .toEqual({ source: 'shield', blocked: 0, afterDefense: 100 });
    expect(rng.getState()).toEqual(before);
  });

  it('sem configuração de defesa no perfil, o estágio é identidade', () => {
    const semDefesa: Combat = { ...combat, defense: undefined };
    const rng = Rng.fromSeed('x');
    const before = rng.getState();
    expect(resolveDefense(swing, shield(30), semDefesa, rng))
      .toEqual({ source: 'none', blocked: 0, afterDefense: 100 });
    expect(rng.getState()).toEqual(before);
  });
});

describe('o blocking na ordem do perfil (CMB-04)', () => {
  const plate: Defender = { armor: 20, dodgeChance: 0, defense: shield(30) };

  it('a defesa entra ANTES da armadura: é o que a armadura encontra', () => {
    const result = resolveDamage(swing, plate, 'pve', combat, rolls(false, true));
    expect(result.afterDefense).toBe(70);
    expect(result.afterArmor).toBe(50);
  });

  it('o piso é do PODER BRUTO: o bloqueio nunca zera o golpe', () => {
    // 100 → defesa 500 → 0; o piso de 10 % do poder bruto devolve 10. Se o piso fosse do
    // pós-defesa, o resultado seria 0 — o overblock que o perfil proíbe.
    const tank: Defender = { armor: 0, dodgeChance: 0, defense: shield(500) };
    expect(resolveDamage(swing, tank, 'pve', combat, rolls(false, true)).resolvedDamage).toBe(10);
  });

  it('o piso entra ANTES da resistência, como o contrato manda', () => {
    const tank: Defender = {
      armor: 0, dodgeChance: 0, defense: shield(500),
      mitigation: compileMitigation({ resistances: { physical: 0.5 }, immunities: [] }),
    };
    // 100 → defesa 500 → 0 → piso 10 → resistência 0,5 → 5.
    expect(resolveDamage(swing, tank, 'pve', combat, rolls(false, true)).resolvedDamage).toBe(5);
  });

  it('sem fonte o resultado é BIT A BIT o v1, e a sequência de sorteios também', () => {
    const comNone = Rng.fromSeed('seed');
    const semCampo = Rng.fromSeed('seed');
    const a = resolveDamage(
      swing, { armor: 20, dodgeChance: 0.5, defense: NO_DEFENSE }, 'pve', combat, comNone,
    );
    const b = resolveDamage(swing, { armor: 20, dodgeChance: 0.5 }, 'pve', combat, semCampo);
    expect(a).toEqual(b);
    expect(comNone.getState()).toEqual(semCampo.getState());
  });

  it('com fonte, o bloqueio é o SEGUNDO sorteio — o Dodge continua o primeiro', () => {
    // Um golpe sem defesa consome 1 sorteio (Dodge); com defesa consome 2 (Dodge, bloqueio).
    const semDefesa = Rng.fromSeed('seed');
    const comDefesa = Rng.fromSeed('seed');
    resolveDamage(swing, { armor: 0, dodgeChance: 0.5 }, 'pve', combat, semDefesa);
    resolveDamage(swing, { armor: 0, dodgeChance: 0.5, defense: shield(30) }, 'pve', combat, comDefesa);

    const um = Rng.fromSeed('seed');
    um.chance(0);
    expect(semDefesa.getState()).toEqual(um.getState());
    const dois = Rng.fromSeed('seed');
    dois.chance(0);
    dois.chance(0);
    expect(comDefesa.getState()).toEqual(dois.getState());
  });

  it('a esquiva corta o dano DEPOIS do bloqueio e do piso', () => {
    // 100 → defesa 30 → 70 → armadura 0 → piso 10 → dodge ×0,5 → 35.
    const dodged = resolveDamage(
      swing, { armor: 0, dodgeChance: 0, defense: shield(30) }, 'pve', combat, rolls(true, true),
    );
    expect(dodged.resolvedDamage).toBe(35);
    expect(dodged.dodged).toBe(true);
  });
});
