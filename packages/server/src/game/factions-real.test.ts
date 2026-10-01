import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../../../content/src/load.js';
import { buildRoute, buildTilemap } from '@draconya/content';
import type { Content, Hunt } from '@draconya/content';
import { CharacterRuntime, createHuntSession, statsForLevel } from '@draconya/sim';
import type { DomainEvent, HuntRuleset, Session } from '@draconya/sim';

// As facções de monstro (#619) contra o catálogo REAL do Canary: o `sim` fala de fixtures, e é aqui,
// onde o conteúdo importado de verdade carrega, que se prende que o Deepling e o Deathling que a
// issue cita — com as abilities, a troca de alvo, a estratégia ponderada e a fuga por vida baixa
// que o Lua declara — brigam sem ninguém por perto, e que a briga vale igual a qualquer taxa.
const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'data');
let cached: Content | null = null;
const real = (): Content => {
  cached ??= loadContent(DATA);
  return cached;
};

// Um corredor largo com uma rota de dois tiles: o herói fica numa ponta, longe da vista de 11
// tiles dos monstros, e o que os mantém acordados é o outro lado da briga.
const wall = '#'.repeat(30);
const row = `#${'.'.repeat(28)}#`;

/**
 * O conteúdo real com UMA hunt de corredor por cima — o mesmo catálogo, a mesma versão de regras.
 * Os monstros nascem nos tiles `xs` (o padrão são os dois da briga Deepling × Deathling).
 */
function corridorContent(monsterIds: readonly string[], xs: readonly number[] = [16, 21]): Content {
  const content = real();
  const tilemap = buildTilemap({ id: 'corridor', z: 7, grid: [wall, row, row, row, wall] });
  const route = buildRoute({
    id: 'corridor', mapId: 'corridor',
    tiles: [{ x: 1, y: 2, z: 7 }, { x: 2, y: 2, z: 7 }],
    spawnPoints: monsterIds.map((monsterId, index) => ({
      routeIndex: 0, radius: 1, at: { x: xs[index] ?? 16, y: 2, z: 7 }, monsterId, respawnDelayMs: 600_000,
    })),
  }, tilemap);
  const hunt = {
    id: 'corridor', name: 'Corridor', recommendedLevel: 1, mapId: 'corridor', routeId: 'corridor',
  } as unknown as Hunt;
  return {
    ...content,
    maps: new Map([...content.maps, ['corridor', tilemap]]),
    routes: new Map([...content.routes, ['corridor', route]]),
    hunts: new Map([...content.hunts, ['corridor', hunt]]),
  };
}

function skirmish(content: Content, stepMs: number, durationMs: number, id = 'factions-real') {
  const session = createHuntSession({
    id, content, huntId: 'corridor', difficulty: 'default', createdAtMs: 0,
  });
  const stats = statsForLevel(1, null, content.progression);
  const hero = new CharacterRuntime({
    id: 'hero', position: { x: 1, y: 2, z: 7 }, health: stats.maxHealth, maxHealth: stats.maxHealth,
    mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
  });
  session.enter(hero);
  hero.position = { x: 1, y: 2, z: 7 };
  session.cancelEvents(hero.id);
  const events: DomainEvent[] = [];
  const ruleset = session.ruleset as HuntRuleset;
  // Quem é quem, anotado assim que os dois nascem: numa luta de verdade um deles pode morrer antes
  // do fim, e o `subject` some junto com a criatura.
  const subjects = new Map<string, string>();
  for (let t = 0; t < durationMs && session.ended === null; t += stepMs) {
    session.advanceBy(stepMs);
    for (const monster of ruleset.monsters) {
      if (!subjects.has(monster.monsterId)) subjects.set(monster.monsterId, monster.subject);
    }
    events.push(...session.drainEvents());
  }
  return { session, hero, events, ruleset, subjects };
}

const hitsBetween = (events: readonly DomainEvent[], attacker: string, victim: string) => events.filter(
  (e) => e.kind === 'creature-hit' && e.attackerId === attacker && e.creatureId === victim,
);

describe('Deepling e Deathling do catálogo REAL se atacam (#619)', () => {
  const content = (): Content => corridorContent(['deepling-brawler', 'deathling-scout']);

  it('o Canary os declara inimigos um do outro, e os dois listam o jogador', () => {
    const { monsters } = real();
    expect(monsters.get('deepling-brawler')?.faction).toBe('deepling');
    expect(monsters.get('deepling-brawler')?.enemyFactions).toEqual(['player', 'deathling']);
    expect(monsters.get('deathling-scout')?.faction).toBe('deathling');
    expect(monsters.get('deathling-scout')?.enemyFactions).toEqual(['player', 'deepling']);
  });

  it('sem ninguém por perto: cada um fere o outro com as abilities reais, e o herói não paga nem recebe nada', () => {
    const { hero, events, subjects, session } = skirmish(content(), 100, 30_000);
    const first = subjects.get('deepling-brawler') ?? '';
    const second = subjects.get('deathling-scout') ?? '';
    expect(first).not.toBe('');
    expect(second).not.toBe('');
    expect(hitsBetween(events, first, second).length).toBeGreaterThan(0);
    expect(hitsBetween(events, second, first).length).toBeGreaterThan(0);
    // Nenhum golpe no herói, nenhuma XP, nenhum abate no analisador: morte só de monstro.
    expect(events.some((e) => e.kind === 'creature-hit' && e.creatureId === hero.id)).toBe(false);
    expect(hero.xp).toBe(0);
    expect(session.aggregates.kills).toBe(0);
    expect(session.aggregates.xpGained).toBe(0);
  });

  it('1 Hz == 20 Hz com as abilities, a troca de alvo e a fuga reais: o snapshot inteiro coincide', () => {
    const at = (stepMs: number) => {
      const { session, ruleset } = skirmish(content(), stepMs, 40_000);
      return {
        snapshot: JSON.stringify(session.snapshot()),
        monsters: ruleset.monsters.map((m) => m.getState()),
      };
    };
    const oneHz = at(1_000);
    const twentyHz = at(50);
    expect(oneHz.monsters).toEqual(twentyHz.monsters);
    expect(oneHz.snapshot).toBe(twentyHz.snapshot);
  });
});

describe('o Lion × Usurper do catálogo REAL: a Lion ignora o jogador que o Canary não lista', () => {
  it('a Lion Knight lista só `lion-usurpers`', () => {
    const { monsters } = real();
    expect(monsters.get('lion-knight')?.enemyFactions).toEqual(['lion-usurpers']);
    expect(monsters.get('usurper-archer')?.enemyFactions).toEqual(['player', 'lion']);
  });

  it('o herói colado numa Lion Knight não é ferido nem visto como alvo', () => {
    const content = corridorContent(['lion-knight', 'lion-knight']);
    const session = createHuntSession({
      id: 'lion-real', content, huntId: 'corridor', difficulty: 'default', createdAtMs: 0,
    });
    const stats = statsForLevel(1, null, content.progression);
    const hero = new CharacterRuntime({
      id: 'hero', position: { x: 16, y: 2, z: 7 }, health: stats.maxHealth, maxHealth: stats.maxHealth,
      mana: 0, maxMana: stats.maxMana, level: 1, xp: 0, goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);
    hero.position = { x: 17, y: 2, z: 7 };
    session.cancelEvents(hero.id);
    const ruleset = session.ruleset as HuntRuleset;
    const events: DomainEvent[] = [];
    for (let t = 0; t < 15_000; t += 100) {
      (session as Session).advanceBy(100);
      events.push(...session.drainEvents());
    }
    expect(ruleset.monsters.length).toBeGreaterThan(0);
    expect(ruleset.monsters.every((m) => m.targetId === null || m.targetId !== hero.id)).toBe(true);
    expect(events.some((e) => e.kind === 'creature-hit' && e.creatureId === hero.id)).toBe(false);
  });
});

describe('uma onda de área do catálogo REAL que pega o mestre e a invocação dele (#619)', () => {
  // O Black Sphinx Acolyte (fafnar) invoca o Skeleton Elite Warrior e o Ogre Sage (anuma) invoca o Young
  // Goanna; as duas facções se caçam e as abilities de ÁREA (earthburst, deathball) pegam o mestre
  // inimigo junto da invocação. Sem o guarda no laço de alvos, a morte do mestre removia a invocação
  // dos índices, e a mesma onda ainda a golpeava (`creature-hit` para um id que o cliente já viu
  // sumir) e a matava de novo, creditando um abate que ninguém presente causou. O herói fica longe
  // da vista, congelado: tudo no extrato abaixo é briga de monstro.
  const layouts: readonly (readonly [string, string])[] = [
    ['ogre-sage', 'black-sphinx-acolyte'],
    ['black-sphinx-acolyte', 'ogre-sage'],
  ];

  for (const [first, second] of layouts) {
    it(`${first} × ${second} por cinco minutos: nenhum golpe fantasma, nenhuma morte repetida, nenhum abate`, () => {
      const { events, session } = skirmish(corridorContent([first, second], [16, 20]), 100, 300_000, 'seed-1');
      const vanished = new Set<string>();
      const hitAfterVanish: string[] = [];
      const vanishedTwice: string[] = [];
      for (const event of events) {
        if (event.kind === 'creature-vanished') {
          const id = String(event.creatureId);
          if (vanished.has(id)) vanishedTwice.push(id);
          vanished.add(id);
        } else if (event.kind === 'creature-hit' && vanished.has(String(event.creatureId))) {
          hitAfterVanish.push(String(event.creatureId));
        }
      }
      expect(hitAfterVanish).toEqual([]);
      expect(vanishedTwice).toEqual([]);
      expect(session.aggregates.kills).toBe(0);
      expect(session.aggregates.xpGained).toBe(0);
    }, 60_000);
  }
});
