import { describe, expect, it } from 'vitest';
import { monsterSchema } from '@draconya/content';
import type { Monster } from '@draconya/content';
import { CreatureVoices, MonsterRace } from '@draconya/protocol';
import { hitEffectOf, isPhysicalHit, monsterLookOf, monsterOutfitOf, monsterPresentationOf } from './monster-look.js';

/** Um monstro na forma que o catálogo entrega: `outfitId` resolvido, o resto do schema. */
function monsterWith(patch: Record<string, unknown>): Monster {
  const parsed = monsterSchema.parse({
    id: 'dragon', name: 'Dragon', health: 1000, experience: 700, attack: 50, armor: 25,
    attackIntervalMs: 2000, speed: 172, aggroRadius: 11, ...patch,
  });
  return { ...parsed, outfitId: 34, mitigation: {}, abilities: [], defenses: [] } as unknown as Monster;
}

describe('monsterOutfitOf e monsterPresentationOf (#620, #621)', () => {
  const dragon = monsterWith({
    race: 'venom', light: { level: 4, color: 208 },
    outfit: { head: 113, body: 120, legs: 95, feet: 115, addons: 3 },
  });

  it('o outfit é só cores e addons; a apresentação é só raça, luz e falas — e juntos dão o `monsterLookOf`', () => {
    // Mutação que mata: deixar `race`/`light` no outfit — o monstro ilusionado levaria a luz e a
    // raça do outfit que veste, ou o `session-state` repetiria as cores do dono sobre as do emprestado.
    expect(monsterOutfitOf(dragon)).toEqual({ colors: { head: 113, body: 120, legs: 95, feet: 115 }, addons: 3 });
    expect(monsterPresentationOf(dragon)).toEqual({ race: 'venom', light: { level: 4, color: 208 } });
    expect(monsterLookOf(dragon)).toEqual({ ...monsterOutfitOf(dragon), ...monsterPresentationOf(dragon) });
  });

  it('sem definição não dizem nada, e o monstro comum só traz as cores neutras', () => {
    expect(monsterOutfitOf(undefined)).toEqual({});
    expect(monsterPresentationOf(undefined)).toEqual({});
    expect(monsterOutfitOf(monsterWith({}))).toEqual({ colors: { head: 0, body: 0, legs: 0, feet: 0 } });
    expect(monsterPresentationOf(monsterWith({}))).toEqual({});
  });
});

describe('monsterLookOf (#620)', () => {
  it('sem definição no catálogo, o monstro continua sem apresentação nenhuma', () => {
    // O host de teste sem catálogo: o monstro aparece sem nome e sem outfit, e sem cores também.
    expect(monsterLookOf(undefined)).toEqual({});
  });

  it('o monstro comum manda só as cores neutras: sem addon, `blood`, sem luz e mudo', () => {
    // As cores saem SEMPRE — o neutro do Canary é o branco da paleta, e o cliente sem elas pintaria
    // o monstro com as de personagem novo. O resto sai só quando difere do default.
    // Mutação que mata: só mandar `colors` quando alguma cor é diferente de 0.
    expect(monsterLookOf(monsterWith({}))).toEqual({ colors: { head: 0, body: 0, legs: 0, feet: 0 } });
  });

  it('cores e addons do Canary chegam como declarados', () => {
    const look = monsterLookOf(monsterWith({ outfit: { head: 113, body: 120, legs: 95, feet: 115, addons: 3 } }));
    expect(look.colors).toEqual({ head: 113, body: 120, legs: 95, feet: 115 });
    expect(look.addons).toBe(3);
  });

  it('a raça `blood` é a ausência; qualquer outra vai', () => {
    expect(monsterLookOf(monsterWith({ race: 'blood' })).race).toBeUndefined();
    expect('race' in monsterLookOf(monsterWith({ race: 'blood' }))).toBe(false);
    expect(monsterLookOf(monsterWith({ race: 'venom' })).race).toBe('venom');
    expect(monsterLookOf(monsterWith({ race: 'candy' })).race).toBe('candy');
  });

  it('luz e falas chegam, com `yell` só nas linhas que são grito', () => {
    const look = monsterLookOf(monsterWith({
      light: { level: 4, color: 208 },
      voices: { intervalMs: 5000, chance: 10, lines: [{ text: 'FCHHHHH', yell: true }, { text: 'Fchu?' }] },
    }));
    expect(look.light).toEqual({ level: 4, color: 208 });
    expect(look.voices).toEqual({
      intervalMs: 5000, chance: 10, lines: [{ text: 'FCHHHHH', yell: true }, { text: 'Fchu?' }],
    });
  });

  it('o que sai é o que o protocolo aceita — inclusive o ÚLTIMO índice da paleta e a raça mais rara', () => {
    // Uma apresentação que o `decodeS2C` recusasse derrubaria a mensagem inteira em silêncio.
    const look = monsterLookOf(monsterWith({
      outfit: { head: 132, body: 132, legs: 132, feet: 132, addons: 3 },
      voices: { intervalMs: 1, chance: 100, lines: [{ text: 'a' }] },
      light: { level: 255, color: 215 },
      race: 'chocolate',
    }));
    expect(CreatureVoices.safeParse(look.voices).success).toBe(true);
    expect(MonsterRace.safeParse(look.race).success).toBe(true);
  });
});

describe('hitEffectOf (#620)', () => {
  const hits = { melee: 1, byRace: { venom: 17, undead: 10 } } as const;

  it('a raça com linha usa a dela; a sem linha cai no sangue de sempre', () => {
    expect(hitEffectOf(hits, 'venom')).toBe(17);
    expect(hitEffectOf(hits, 'undead')).toBe(10);
    // `fire` não tem linha nesta tabela: cai no `melee`, e não some.
    expect(hitEffectOf(hits, 'fire')).toBe(1);
  });

  it('sem raça (o jogador, o monstro que o catálogo não conhece) o efeito é o de `blood`', () => {
    expect(hitEffectOf({ melee: 1, byRace: { blood: 99 } }, undefined)).toBe(99);
    expect(hitEffectOf(hits, undefined)).toBe(1);
  });

  it('a tabela de antes desta issue (só `melee`) continua valendo para toda raça', () => {
    expect(hitEffectOf({ melee: 1 }, 'venom')).toBe(1);
    expect(hitEffectOf({ melee: 1 }, undefined)).toBe(1);
  });

  it('sem linha nenhuma o golpe não tem efeito — o CONST_ME_NONE do Canary', () => {
    expect(hitEffectOf({}, 'venom')).toBeUndefined();
    expect(hitEffectOf({ byRace: { venom: 17 } }, 'undead')).toBeUndefined();
  });
});

describe('isPhysicalHit (#620)', () => {
  it('o elemento decide: `physical` é físico seja a origem corpo a corpo ou magia', () => {
    expect(isPhysicalHit('melee', 'physical')).toBe(true);
    expect(isPhysicalHit('spell', 'physical')).toBe(true);
  });

  it('outro elemento NÃO é físico, nem no corpo a corpo: o efeito de raça é só do `COMBAT_PHYSICALDAMAGE`', () => {
    expect(isPhysicalHit('melee', 'fire')).toBe(false);
    expect(isPhysicalHit('spell', 'earth')).toBe(false);
    expect(isPhysicalHit('spell', 'arcane')).toBe(false);
  });

  it('sem o elemento (emissor anterior à #479) vale a origem: corpo a corpo é físico, magia não', () => {
    expect(isPhysicalHit('melee', undefined)).toBe(true);
    expect(isPhysicalHit('spell', undefined)).toBe(false);
  });
});
