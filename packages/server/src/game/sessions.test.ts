import { buildContent } from '@draconya/content';
import { CharacterRuntime, createHuntSession } from '@draconya/sim';
import type { Session } from '@draconya/sim';
import { describe, expect, it } from 'vitest';
import { createCitySessionFactory, createSessionRestorer } from './sessions.js';

describe('city session factory', () => {
  it('starts from progress carried by the authenticated ticket', () => {
    const session = createCitySessionFactory('v-test')('p1', { level: 17, xp: 93_000 });

    expect(session.participants[0]?.level).toBe(17);
    expect(session.participants[0]?.xp).toBe(93_000);
  });

  it('uses new-character progress for a legacy claim without initialization', () => {
    const session = createCitySessionFactory('v-test')('p1');

    expect(session.participants[0]?.level).toBe(1);
    expect(session.participants[0]?.xp).toBe(0);
  });
});

describe('session restorer', () => {
  // Conteúdo mínimo, montado à mão: o objetivo é o roteamento por tipo de sessão, não o
  // carregamento de disco — que este pacote nem pode importar aqui.
  const content = buildContent({
    monsters: [{
      id: 'rat', name: 'Rat', outfitId: 21, recommendedLevel: 1, health: 20, experience: 5,
      attack: 6, armor: 0, attackIntervalMs: 2000, stepDurationMs: 500, aggroRadius: 4,
    }],
    hunts: [{
      id: 'arena', name: 'Arena', recommendedLevel: 1, mapId: 'arena', routeId: 'arena-loop',
      difficulties: {
        beginner: {
          perSpawnPoint: 1, composition: [{ monsterId: 'rat', weight: 1 }], respawnDelayMs: 1000,
        },
      },
    }],
    vocations: [],
    progression: [{
      id: 'baseline', startingHealth: 150, startingMana: 0, startingCapacity: 400,
      healthPerLevel: 5, manaPerLevel: 5, capacityPerLevel: 10, vocationLevel: 8,
      stepDurationMs: 500,
    }],
    combat: [{
      id: 'baseline', dodgeMultiplier: 0.5, armorEffectiveness: { melee: 1, magic: 0 },
      minimumDamageFraction: 0.1,
      player: { attackPower: 25, attackIntervalMs: 2000, attackRange: 1, armor: 0, dodgeChance: 0 },
    }],
    maps: [{ id: 'arena', z: 7, grid: ['####', '#..#', '#..#', '####'] }],
    routes: [{
      id: 'arena-loop', mapId: 'arena',
      tiles: [
        { x: 1, y: 1, z: 7 }, { x: 2, y: 1, z: 7 }, { x: 2, y: 2, z: 7 }, { x: 1, y: 2, z: 7 },
      ],
      spawnPoints: [{ routeIndex: 2, radius: 1 }],
    }],
  });

  const hunt = (): Session => {
    const session = createHuntSession({
      id: 'hunt-1', content, huntId: 'arena', difficulty: 'beginner', createdAtMs: 0,
    });
    session.enter(new CharacterRuntime({
      id: 'p1', position: { x: 0, y: 0, z: 7 }, health: 500, maxHealth: 500, mana: 0, maxMana: 0,
      level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
    }));
    session.tick(2000);
    return session;
  };

  it('restores a hunt, which needs content to exist at all', () => {
    // Sem esta linha, o snapshot de uma hunt viraria `null` na retomada e a sessão seria
    // encerrada creditando — perdendo a hunt de quem estava caçando na hora do deploy.
    const original = hunt();
    const restored = createSessionRestorer(content)(original.snapshot(), 10_000);

    expect(restored?.ruleset.type).toBe('hunt');
    expect(restored?.aggregates).toEqual(original.aggregates);
    // Relógio reposicionado: o do snapshot é de outro processo (ADR 0018).
    expect(restored?.nowMs).toBe(10_000);
  });

  it('restores a city session', () => {
    const city = createCitySessionFactory(content.version)('p1');
    expect(createSessionRestorer(content)(city.snapshot(), 1)?.ruleset.type).toBe('city');
  });

  it('refuses a hunt that left the content, instead of resuming the wrong one', () => {
    const empty = buildContent({ monsters: [], hunts: [], vocations: [],
      progression: [content.progression], combat: [content.combat] });
    expect(createSessionRestorer(empty)(hunt().snapshot(), 1)).toBeNull();
  });

  it('refuses a session type this server has no ruleset for', () => {
    // Forçar um ruleset conhecido em cima produziria uma sessão que mente sobre o que é.
    const snapshot = { ...hunt().snapshot(), type: 'boss' as const };
    expect(createSessionRestorer(content)(snapshot, 1)).toBeNull();
  });
});
