import { describe, expect, it } from 'vitest';
import { bossesKilled, bossesOf, bossLevelOf, bossProgressOf, killsOfBoss } from './bosstiary-progress.js';
import type { BosstiaryConfig, MonsterListing } from '../state/hud.js';

const config: BosstiaryConfig = {
  levels: {
    bane: [{ kills: 25, points: 5 }, { kills: 100, points: 15 }, { kills: 300, points: 30 }],
    archfoe: [{ kills: 5, points: 10 }, { kills: 20, points: 30 }, { kills: 60, points: 60 }],
    nemesis: [{ kills: 1, points: 10 }, { kills: 3, points: 30 }, { kills: 5, points: 60 }],
  },
};

const monster = (id: string, bosstiary?: MonsterListing['bosstiary']): MonsterListing => (
  bosstiary === undefined ? { id, name: id } : { id, name: id, bosstiary }
);

describe('bossesOf', () => {
  it('lista só quem é boss, um por raceId, ficando o primeiro do catálogo', () => {
    // As cinco formas de Urmahlullu compartilham o raceId 1811: uma linha só, com o contador único.
    const listed = bossesOf([
      monster('rat'),
      monster('urmahlullu-the-immaculate', { rarity: 'archfoe', raceId: 1811 }),
      monster('urmahlullu-the-tamed', { rarity: 'archfoe', raceId: 1811 }),
      monster('dreadmaw', { rarity: 'nemesis', raceId: 639 }),
    ]);
    expect(listed).toEqual([
      { id: 'urmahlullu-the-immaculate', name: 'urmahlullu-the-immaculate', rarity: 'archfoe', raceId: 1811 },
      { id: 'dreadmaw', name: 'dreadmaw', rarity: 'nemesis', raceId: 639 },
    ]);
  });

  it('catálogo sem boss dá lista vazia', () => {
    expect(bossesOf([monster('rat'), monster('bat')])).toEqual([]);
  });
});

describe('bossLevelOf', () => {
  it('conta os degraus atingidos por >=, como o getBossCurrentLevel do Canary', () => {
    expect(bossLevelOf(0, 'nemesis', config)).toBe(0);
    expect(bossLevelOf(1, 'nemesis', config)).toBe(1);
    expect(bossLevelOf(2, 'nemesis', config)).toBe(1);
    expect(bossLevelOf(3, 'nemesis', config)).toBe(2);
    expect(bossLevelOf(5, 'nemesis', config)).toBe(3);
    expect(bossLevelOf(500, 'nemesis', config)).toBe(3);
    expect(bossLevelOf(24, 'bane', config)).toBe(0);
    expect(bossLevelOf(25, 'bane', config)).toBe(1);
  });

  it('sem tabela no catálogo o nível é 0, nunca um palpite', () => {
    expect(bossLevelOf(1_000, 'nemesis', null)).toBe(0);
  });
});

describe('bossProgressOf', () => {
  it('diz o próximo degrau e a fração até ele; no último nível a barra fecha', () => {
    expect(bossProgressOf(0, 'archfoe', config)).toEqual({ kills: 0, level: 0, nextKills: 5, percent: 0 });
    expect(bossProgressOf(4, 'archfoe', config)).toMatchObject({ level: 0, nextKills: 5, percent: 80 });
    expect(bossProgressOf(5, 'archfoe', config)).toMatchObject({ level: 1, nextKills: 20, percent: 25 });
    expect(bossProgressOf(60, 'archfoe', config)).toEqual({ kills: 60, level: 3, nextKills: null, percent: 100 });
  });

  it('sem tabela mostra os abates reais e nenhuma meta inventada', () => {
    expect(bossProgressOf(7, 'bane', null)).toEqual({ kills: 7, level: 0, nextKills: null, percent: 0 });
  });
});

describe('killsOfBoss / bossesKilled', () => {
  const dreadmaw = { id: 'dreadmaw', name: 'Dreadmaw', rarity: 'nemesis' as const, raceId: 639 };
  const ghazbaran = { id: 'ghazbaran', name: 'Ghazbaran', rarity: 'archfoe' as const, raceId: 100 };

  it('lê o contador pela chave do raceId em texto; boss nunca abatido é zero', () => {
    expect(killsOfBoss({ '639': 4 }, dreadmaw)).toBe(4);
    expect(killsOfBoss({ '639': 4 }, ghazbaran)).toBe(0);
  });

  it('conta os bosses com ao menos um abate', () => {
    const bosses = [dreadmaw, ghazbaran];
    expect(bossesKilled(bosses, {})).toBe(0);
    expect(bossesKilled(bosses, { '639': 1 })).toBe(1);
    expect(bossesKilled(bosses, { '639': 1, '100': 3, '999': 8 })).toBe(2);
  });
});
