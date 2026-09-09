import { buildContent } from '@draconya/content';
import { CharacterRuntime, createHuntSession } from '@draconya/sim';
import { TEST_COMBAT, TEST_PROGRESSION, testContent } from '../testing/content.js';
import type { Session } from '@draconya/sim';
import { describe, expect, it } from 'vitest';
import { createCitySessionFactory, createSessionRestorer } from './sessions.js';

describe('city session factory', () => {
  it('starts from progress carried by the authenticated ticket', () => {
    const session = createCitySessionFactory(testContent())('p1', { level: 17, xp: 93_000 });

    expect(session.participants[0]?.level).toBe(17);
    expect(session.participants[0]?.xp).toBe(93_000);
  });

  it('uses new-character progress for a legacy claim without initialization', () => {
    const session = createCitySessionFactory(testContent())('p1');

    expect(session.participants[0]?.level).toBe(1);
    expect(session.participants[0]?.xp).toBe(0);
  });
});

describe('session restorer', () => {
  const content = testContent();

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
    const city = createCitySessionFactory(content)('p1');
    expect(createSessionRestorer(content)(city.snapshot(), 1)?.ruleset.type).toBe('city');
  });

  it('refuses a hunt that left the content, instead of resuming the wrong one', () => {
    const empty = buildContent({ monsters: [], hunts: [], vocations: [],
      progression: [TEST_PROGRESSION], combat: [TEST_COMBAT] });
    expect(createSessionRestorer(empty)(hunt().snapshot(), 1)).toBeNull();
  });

  it('refuses a session type this server has no ruleset for', () => {
    // Forçar um ruleset conhecido em cima produziria uma sessão que mente sobre o que é.
    const snapshot = { ...hunt().snapshot(), type: 'boss' as const };
    expect(createSessionRestorer(content)(snapshot, 1)).toBeNull();
  });
});
