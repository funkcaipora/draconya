import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import type { Content } from '@draconya/content';
import {
  COMBAT_CHARM_IDS, CharacterRuntime, createHuntSession, statsForLevel,
} from '@draconya/sim';
import type { CharmsState, DomainEvent, HuntRuleset, Session } from '@draconya/sim';

// Os Charms em combate (#603) contra o conteúdo REAL: o `sim` fala de fixtures — e não lê disco —,
// então é aqui, no servidor que carrega o catálogo de verdade, que se prende (a) que o perfil e o
// crítico base do baseline são os do estágio, (b) que cada charm que o motor despacha por id existe
// no catálogo importado do Canary com o tipo e a categoria que o motor espera, e (c) que uma hunt
// real com charm atribuído roda o estágio de ponta a ponta.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

describe('o baseline real declara o estágio de Charms do combat-v4 (#603)', () => {
  it('o perfil é o combat-v4, `breaking`, sem a exceção do Dodge do PRD', () => {
    const { combat } = real();
    expect(combat.compatibilityProfile).toBe('combat-v4');
    // O Dodge do PRD saiu: o número é zero e o resolver nem o sorteia neste perfil.
    expect(combat.player.dodgeChance).toBe(0);
  });

  it('o crítico BASE do jogador é o do Canary: 5 % de chance, +10 % de dano (config.lua.dist)', () => {
    expect(real().combat.modifiers?.critical).toEqual({ chance: 0.05, multiplier: 1.1 });
  });
});

describe('cada charm que o motor despacha por id existe no catálogo real, com o tipo esperado', () => {
  // Categoria e tipo que `combat/charms.ts` e o ruleset assumem para cada id.
  const EXPECTED: Readonly<Record<string, readonly ['major' | 'minor', 'offensive' | 'defensive' | 'passive']>> = {
    wound: ['major', 'offensive'], enflame: ['major', 'offensive'], poison: ['major', 'offensive'],
    freeze: ['major', 'offensive'], zap: ['major', 'offensive'], curse: ['major', 'offensive'],
    'divine-wrath': ['major', 'offensive'], carnage: ['major', 'offensive'],
    overpower: ['major', 'offensive'], overflux: ['major', 'offensive'], cripple: ['minor', 'offensive'],
    parry: ['major', 'defensive'], dodge: ['major', 'defensive'],
    'adrenaline-burst': ['minor', 'defensive'], numb: ['minor', 'defensive'],
    cleanse: ['minor', 'defensive'],
    bless: ['minor', 'passive'], gut: ['minor', 'passive'], 'low-blow': ['major', 'passive'],
    'savage-blow': ['major', 'passive'], 'vampiric-embrace': ['minor', 'passive'],
    'voids-call': ['minor', 'passive'], 'fatal-hold': ['minor', 'passive'],
    'void-inversion': ['minor', 'passive'],
  };

  it('os 24 ids do motor batem, um a um, com o catálogo importado', () => {
    const { charms } = real();
    expect([...COMBAT_CHARM_IDS].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const id of COMBAT_CHARM_IDS) {
      const charm = charms.get(id);
      expect(charm, id).toBeDefined();
      expect([charm?.category, charm?.type], id).toEqual(EXPECTED[id]);
    }
    // O 25º é o Scavenge (#626), que este motor NÃO trata em combate.
    expect(charms.size).toBe(COMBAT_CHARM_IDS.length + 1);
    expect(charms.get('scavenge')?.type).toBe('passive');
  });

  it('os sete elementais e os três neutros carregam o tipo e o percentual do Lua', () => {
    const { charms } = real();
    const elementals: readonly [string, string][] = [
      ['wound', 'physical'], ['enflame', 'fire'], ['poison', 'earth'], ['freeze', 'ice'],
      ['zap', 'energy'], ['curse', 'death'], ['divine-wrath', 'holy'],
    ];
    for (const [id, type] of elementals) {
      expect([charms.get(id)?.damageType, charms.get(id)?.percent], id).toEqual([type, 5]);
    }
    expect([charms.get('carnage')?.damageType, charms.get('carnage')?.percent]).toEqual(['neutral', 15]);
    expect([charms.get('overpower')?.damageType, charms.get('overpower')?.percent]).toEqual(['neutral', 5]);
    expect([charms.get('overflux')?.damageType, charms.get('overflux')?.percent]).toEqual(['neutral', 2.5]);
  });

  it('as chances por tier são as do Canary (uma amostra por família de rolagem)', () => {
    const { charms } = real();
    expect(charms.get('wound')?.chance).toEqual([5, 10, 11]);
    expect(charms.get('dodge')?.chance).toEqual([5, 10, 11]);
    expect(charms.get('numb')?.chance).toEqual([6, 9, 12]);
    expect(charms.get('bless')?.chance).toEqual([6, 9, 12]);
    expect(charms.get('vampiric-embrace')?.chance).toEqual([1.6, 2.4, 3.2]);
    expect(charms.get('fatal-hold')?.chance).toEqual([30, 45, 60]);
    expect(charms.get('void-inversion')?.chance).toEqual([20, 30, 40]);
  });
});

describe('o item creature product leva o flag que o Gut lê (#603)', () => {
  it('as peles de monstro são `creatureProduct`; espada e joia não', () => {
    const { items } = real();
    expect(items.get('acorn')?.creatureProduct).toBe(true);
    expect(items.get('sword')?.creatureProduct).toBeUndefined();
  });
});

describe('uma hunt REAL com charm atribuído roda o estágio de ponta a ponta', () => {
  function farm(assignments: Readonly<Record<string, string>>): { events: DomainEvent[]; session: Session } {
    const content = real();
    const session = createHuntSession({
      id: 'charm-cellars', content, huntId: 'rat-cellars', difficulty: 'default', createdAtMs: 0,
    });
    const stats = statsForLevel(8, null, content.progression);
    const charms: CharmsState = {
      pointsSpent: 0, echoesSpent: 0, version: 1,
      tiers: Object.fromEntries(Object.keys(assignments).map((id) => [id, 3])) as CharmsState['tiers'],
      assignments,
    };
    session.enter(new CharacterRuntime({
      id: 'hero', position: { x: 0, y: 0, z: 8 },
      health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
      level: 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {}, charms,
    }));
    const events: DomainEvent[] = [];
    for (let t = 0; t < 300_000 && session.ended === null; t += 100) {
      session.advanceBy(100);
      events.push(...session.drainEvents());
    }
    return { events, session };
  }

  it('Wound (11 % no tier 3) bate nos ratos; o hit do charm é `spell` e do tipo físico', () => {
    const { events, session } = farm({ wound: 'rat' });
    const swings = events.filter((e) => e.kind === 'creature-hit' && e.attackerId === 'hero'
      && e.source === 'melee');
    const charmHits = events.filter((e) => e.kind === 'creature-hit' && e.attackerId === 'hero'
      && e.source === 'spell');
    expect(session.aggregates.kills).toBeGreaterThan(20);
    expect(swings.length).toBeGreaterThan(20);
    // 11 % dos golpes que tiram vida: em centenas deles, sempre há charm — e a proporção é a
    // nominal (uniforme 1..100), não a da normal truncada dos defensivos.
    expect(charmHits.length).toBeGreaterThan(swings.length * 0.03);
    expect(charmHits.length).toBeLessThan(swings.length * 0.25);
    for (const hit of charmHits) {
      if (hit.kind !== 'creature-hit') continue;
      expect(hit.damageType).toBe('physical');
    }
  });

  it('sem charm atribuído a rato nenhum, nada dispara', () => {
    const { events } = farm({ wound: 'dragon' });
    expect(events.filter((e) => e.kind === 'creature-hit' && e.attackerId === 'hero'
      && e.source === 'spell')).toHaveLength(0);
  });

  it('a Rat Cellars real rende o mesmo em 1 Hz e 10 Hz com charms rolando', () => {
    const at = (stepMs: number): string => {
      const content = real();
      const session = createHuntSession({
        id: 'charm-hz', content, huntId: 'rat-cellars', difficulty: 'default', createdAtMs: 0,
      });
      const stats = statsForLevel(8, null, content.progression);
      session.enter(new CharacterRuntime({
        id: 'hero', position: { x: 0, y: 0, z: 8 },
        health: stats.maxHealth, maxHealth: stats.maxHealth, mana: stats.maxMana, maxMana: stats.maxMana,
        level: 8, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
        charms: {
          pointsSpent: 0, echoesSpent: 0, version: 1, tiers: { wound: 3, dodge: 3, cripple: 3 },
          assignments: { wound: 'rat', dodge: 'rat', cripple: 'rat' },
        },
      }));
      for (let t = 0; t < 120_000 && session.ended === null; t += stepMs) session.advanceBy(stepMs);
      const hero = session.participants[0] as CharacterRuntime;
      return JSON.stringify([
        session.aggregates.kills, hero.health, hero.xp, session.snapshot().rng,
        (session.ruleset as HuntRuleset).monsters.length,
      ]);
    };
    expect(at(1_000)).toBe(at(100));
  });
});
