import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import {
  CharacterRuntime, createHuntSession, statsForLevel, totalXpForLevel,
} from '@draconya/sim';
import type { HuntRuleset, Session } from '@draconya/sim';

// A zona de Hazard real (#632, M44-14): a Gnomprona Gardens do Canary, jogada com o CONTEÚDO real —
// `hazard/baseline.json`, a hunt, o mapa e a rota do OTBM, o Hulking Prehemoth do catálogo e o
// perfil `combat-v4` do `combat/baseline.json`. Os vetores de cada estágio estão em
// `packages/sim/src/rulesets/hazard.test.ts`, com conteúdo de teste; aqui prova-se que o conteúdo
// real LIGA o estágio e que o nível que o personagem escolheu é o que vale na hunt.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

const ZONE = 'gnomprona-gardens';
const LEVEL = 3000;

/**
 * Um herói que aguenta a hunt inteira (50 milhões de vida) e cujo level e XP concordam — um abate
 * re-deriva o level da XP, e um herói de level 3000 com XP zero voltaria ao level 14 no primeiro
 * (`grantXp`) e morreria no golpe seguinte. É o que a `tibia-parity-hunts.test.ts` não precisa
 * (ela só quer o primeiro abate), e esta precisa: medir a XP do abate.
 */
function hero(level: number, hazardLevel: number | null): CharacterRuntime {
  const stats = statsForLevel(LEVEL, null, real().progression);
  return new CharacterRuntime({
    id: 'hero', position: { x: 0, y: 0, z: 14 },
    health: 50_000_000, maxHealth: 50_000_000, mana: stats.maxMana, maxMana: stats.maxMana,
    level, xp: totalXpForLevel(level, real().progression), goldDelta: 0, alive: true, cooldowns: {},
    ...(hazardLevel === null ? {} : {
      hazard: {
        maxLevel: { [ZONE]: 12 }, currentLevel: { [ZONE]: hazardLevel }, version: 1,
      },
    }),
  });
}

/** Entra na hunt e anda até o PRIMEIRO abate (o Hulking Prehemoth tem 20.700 de vida). */
function firstKill(hazardLevel: number | null): { session: Session; xp: number } {
  const session = createHuntSession({
    id: 'gardens', content: real(), huntId: ZONE, difficulty: 'default', createdAtMs: 0,
  });
  session.enter(hero(LEVEL, hazardLevel));
  for (let t = 0; t < 400_000 && session.ended === null && session.aggregates.kills === 0; t += 100) {
    session.advanceBy(100);
  }
  return { session, xp: session.aggregates.xpGained };
}

describe('a zona de hazard real, Gnomprona Gardens (#632)', () => {
  it('a hunt declara a zona, e a zona é a do Canary: níveis de 1 a 12 com os quatro efeitos', () => {
    const content = real();
    expect(content.hunts.get(ZONE)?.hazardZoneId).toBe(ZONE);
    expect(content.hazard?.zones[ZONE]).toMatchObject({
      minLevel: 1, maxLevel: 12, crit: true, dodge: true, damageBoost: true, defenseBoost: true,
    });
  });

  it('o conteúdo real roda o estágio: o perfil é o combat-v4 e a sessão o fixa (invariante 7)', () => {
    expect(real().combat.compatibilityProfile).toBe('combat-v4');
    const session = createHuntSession({
      id: 'gardens', content: real(), huntId: ZONE, difficulty: 'default', createdAtMs: 0,
    });
    expect(session.contentVersion).toBe(real().version);
  });

  it('a XP do abate cresce 3,5 % por nível de hazard: o nível 12 paga 1,42× e o 1 paga 1,035×', () => {
    const level1 = firstKill(1);
    const level12 = firstKill(12);
    const without = firstKill(null);
    expect(level1.session.aggregates.kills).toBe(1);
    expect(level12.session.aggregates.kills).toBe(1);
    // Quem nunca escolheu nada luta no `minLevel` (1): o mesmo que o 1 escolhido.
    expect(without.xp).toBe(level1.xp);
    // O mesmo monstro, a mesma conta de rate: só o bônus de hazard muda (1,42 / 1,035).
    expect(level12.xp / level1.xp).toBeGreaterThan(1.42 / 1.035 - 0.002);
    expect(level12.xp / level1.xp).toBeLessThan(1.42 / 1.035 + 0.002);
    expect(level1.xp).toBeGreaterThan(0);
  });

  it('o monstro de hazard bate mais forte: o crítico e o reforço aparecem nos golpes que o herói leva', () => {
    // Nível 12: reforço de 24 % em TODO golpe, mais o crítico raro. Contra o nível 1 (2 %) a média
    // do golpe que o herói leva sobe — medida em 150 s de luta contra as feras da rota. A média é
    // POR ESPÉCIE: a rota tem mais de uma fera, de golpes de tamanhos diferentes, e a mistura que o
    // herói enfrenta nos 150 s muda com a semente (o nível muda as rolagens) — comparar a média de
    // tudo mediria a mistura, não o reforço.
    const averages = (hazardLevel: number): Map<string, { sum: number; count: number }> => {
      const session = createHuntSession({
        id: 'gardens', content: real(), huntId: ZONE, difficulty: 'default', createdAtMs: 0,
      });
      const ruleset = session.ruleset as HuntRuleset;
      session.enter(hero(LEVEL, hazardLevel));
      const bySpecies = new Map<string, { sum: number; count: number }>();
      for (let t = 0; t < 150_000 && session.ended === null; t += 100) {
        session.advanceBy(100);
        // Quem bate é um monstro VIVO neste instante (o golpe sai antes de qualquer morte do passo).
        const speciesOf = new Map(ruleset.monsters.map((monster) => [monster.subject, monster.monsterId]));
        for (const event of session.drainEvents()) {
          if (event.kind !== 'creature-hit' || event.creatureId !== 'hero' || event.amount <= 0) continue;
          const species = speciesOf.get(String(event.attackerId));
          if (species === undefined) continue;
          const entry = bySpecies.get(species) ?? { sum: 0, count: 0 };
          entry.sum += event.amount;
          entry.count += 1;
          bySpecies.set(species, entry);
        }
      }
      return bySpecies;
    };
    const level1 = averages(1);
    const level12 = averages(12);
    // A espécie que mais bateu no nível 1 e que o nível 12 também enfrentou o bastante.
    const [species] = [...level1.entries()]
      .filter(([id, entry]) => entry.count >= 4 && (level12.get(id)?.count ?? 0) >= 4)
      .sort((a, b) => b[1].count - a[1].count)[0] ?? [];
    expect(species).toBeDefined();
    const mean = (entry: { sum: number; count: number } | undefined): number =>
      entry === undefined ? 0 : entry.sum / entry.count;
    expect(mean(level12.get(species as string)) / mean(level1.get(species as string))).toBeGreaterThan(1.1);
  });

  it('é a MESMA hunt sem hazard para quem a content não marca: o nível não vaza para outra hunt', () => {
    const rat = createHuntSession({
      id: 'rats', content: real(), huntId: 'rat-cellars', difficulty: 'default', createdAtMs: 0,
    });
    const ruleset = rat.ruleset as HuntRuleset;
    expect(ruleset.huntId).toBe('rat-cellars');
    expect(real().hunts.get('rat-cellars')?.hazardZoneId).toBeUndefined();
  });
});
