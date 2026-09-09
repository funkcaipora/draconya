import { buildContent } from '@draconya/content';
import { CharacterRuntime, createHuntSession, totalXpForLevel } from '@draconya/sim';
import {
  TEST_COMBAT, TEST_PROGRESSION, TEST_STAMINA, testContent,
} from '../testing/content.js';
import type { Progression } from '@draconya/content';
import type { Session } from '@draconya/sim';
import { describe, expect, it } from 'vitest';
import {
  createCitySessionFactory, createCitySuccessor, createSessionRestorer,
} from './sessions.js';

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
      progression: [TEST_PROGRESSION], combat: [TEST_COMBAT], stamina: [TEST_STAMINA] });
    expect(createSessionRestorer(empty)(hunt().snapshot(), 1)).toBeNull();
  });

  it('refuses a session type this server has no ruleset for', () => {
    // Forçar um ruleset conhecido em cima produziria uma sessão que mente sobre o que é.
    const snapshot = { ...hunt().snapshot(), type: 'boss' as const };
    expect(createSessionRestorer(content)(snapshot, 1)).toBeNull();
  });
});

describe('city successor (FUN-38)', () => {
  const content = testContent();

  const dyingHunt = (): { session: Session; hero: CharacterRuntime } => {
    const session = createHuntSession({
      id: 'hunt-1', content, huntId: 'arena', difficulty: 'beginner', createdAtMs: 0,
    });
    const hero = new CharacterRuntime({
      id: 'p1', position: { x: 0, y: 0, z: 7 }, health: 40, maxHealth: 200, mana: 0, maxMana: 0,
      level: 20, xp: totalXpForLevel(20, TEST_PROGRESSION as Progression), vocationId: null,
      goldDelta: 0, alive: true, cooldowns: {},
    });
    session.enter(hero);
    return { session, hero };
  };

  it('devolve o MESMO personagem, não uma cópia reconstruída', () => {
    // A penalidade de morte (FUN-37) já mexeu no level e na XP quando isto roda. Reconstruir
    // a partir de dados duráveis que ainda não foram gravados devolveria o personagem de
    // antes de morrer — a penalidade sumiria, e ninguém ligaria uma coisa à outra.
    const { session, hero } = dyingHunt();
    session.kill(hero);
    const xpDepoisDaPenalidade = hero.xp;

    const city = createCitySuccessor(content)(session, 'death');

    expect(city?.participants[0]).toBe(hero);
    expect(hero.xp).toBe(xpDepoisDaPenalidade);
    expect(hero.level).toBe(19);
  });

  it('a PZ cura, e cura DEPOIS do encerramento', () => {
    // Restaurar HP antes de encerrar gravaria no extrato uma sessão que "terminou com vida
    // cheia", o que estraga a tela de retorno e o analisador.
    const { session, hero } = dyingHunt();
    session.kill(hero);
    expect(hero.health).toBe(0);

    createCitySuccessor(content)(session, 'death');

    expect(hero.health).toBe(hero.maxHealth);
    expect(hero.alive).toBe(true);
  });

  it('vale para a saída manual também: sair da hunt é voltar para a cidade', () => {
    // Todo personagem está em EXATAMENTE uma sessão (invariante 8): "a hunt acabou" nunca
    // pode significar "ele ficou sem sessão".
    const { session } = dyingHunt();
    session.end('manual-exit');
    expect(createCitySuccessor(content)(session, 'manual-exit')?.ruleset.type).toBe('city');
  });

  it('a Cidade não sucede a si mesma', () => {
    // Uma sessão de Cidade que acaba é logout ou drenagem, e aí o personagem está mesmo
    // saindo do nó.
    const city = createCitySessionFactory(content)('p1');
    city.end('manual-exit');
    expect(createCitySuccessor(content)(city, 'manual-exit')).toBeNull();
  });
});

describe('stamina nas fronteiras da sessão (FUN-39)', () => {
  const content = testContent();
  const HOUR = 3_600_000;

  it('materializa na ENTRADA: o tempo fora de hunt é recuperação', () => {
    // Ninguém decrementou nem incrementou nada nesse meio-tempo — o valor de agora é a conta
    // feita quando alguém finalmente perguntou.
    const session = createCitySessionFactory(content, () => 10 * HOUR)('p1', {
      level: 1, xp: 0, staminaMs: 5 * HOUR, staminaUpdatedAtMs: 2 * HOUR,
    });
    const character = session.participants[0];

    expect(character?.staminaMs).toBe(13 * HOUR);
    expect(character?.staminaUpdatedAtMs).toBe(10 * HOUR);
  });

  it('respeita o teto de 24 h mesmo depois de dias parado', () => {
    const session = createCitySessionFactory(content, () => 200 * HOUR)('p1', {
      level: 1, xp: 0, staminaMs: 0, staminaUpdatedAtMs: 0,
    });
    expect(session.participants[0]?.staminaMs).toBe(24 * HOUR);
  });

  it('personagem sem stamina persistida roda sem teto, em vez de nascer zerado', () => {
    // É o personagem gravado antes de a coluna existir. Cobrar dele uma stamina que nunca
    // foi medida seria inventar uma punição.
    const session = createCitySessionFactory(content)('p1', { level: 1, xp: 0 });
    expect(session.participants[0]?.staminaMs).toBeNull();
  });

  it('materializa na SAÍDA da hunt, senão o tempo gasto viraria recuperação', () => {
    // Sem isto, `staminaUpdatedAtMs` continuaria apontando para antes da hunt, e a próxima
    // leitura devolveria como recuperação exatamente o tempo que o personagem passou
    // gastando stamina.
    const hunt = createHuntSession({
      id: 'hunt-1', content, huntId: 'arena', difficulty: 'beginner', createdAtMs: 0,
    });
    const hero = new CharacterRuntime({
      id: 'p1', position: { x: 0, y: 0, z: 7 }, health: 200, maxHealth: 200, mana: 0, maxMana: 0,
      level: 1, xp: 0, vocationId: null, staminaMs: 3 * HOUR, staminaUpdatedAtMs: 0,
      goldDelta: 0, alive: true, cooldowns: {},
    });
    hunt.enter(hero);
    hunt.end('manual-exit');

    createCitySuccessor(content, () => 8 * HOUR)(hunt, 'manual-exit');

    expect(hero.staminaUpdatedAtMs).toBe(8 * HOUR);
    expect(hero.staminaMs).toBe(3 * HOUR + 8 * HOUR);
  });
});
