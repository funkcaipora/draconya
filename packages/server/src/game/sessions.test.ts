import { buildContent } from '@draconya/content';
import { CharacterRuntime, createHuntSession, totalXpForLevel } from '@draconya/sim';
import {
  TEST_COMBAT, TEST_PROGRESSION, TEST_STAMINA, testContent,
} from '../testing/content.js';
import type { Progression } from '@draconya/content';
import type { Session } from '@draconya/sim';
import { describe, expect, it } from 'vitest';
import {
  createCitySessionFactory, createSessionBuilder, createSessionRestorer,
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
    session.advanceBy(2000);
    return session;
  };

  it('restores a hunt, which needs content to exist at all', () => {
    // Sem esta linha, o snapshot de uma hunt viraria `null` na retomada e a sessão seria
    // encerrada creditando — perdendo a hunt de quem estava caçando na hora do deploy.
    const original = hunt();
    const restored = createSessionRestorer(content)(original.snapshot());

    expect(restored?.ruleset.type).toBe('hunt');
    expect(restored?.aggregates).toEqual(original.aggregates);
    // O relógio LÓGICO continua de onde parou — não há o que rebasear desde a FUN-68, porque
    // ele nunca foi o monotônico de processo nenhum. Quem guarda relógio de processo é o
    // hospedeiro, e é ele que faz o intervalo pulado nunca chegar aqui (ADR 0018).
    expect(restored?.nowMs).toBe(original.nowMs);
  });

  it('restores a city session', () => {
    const city = createCitySessionFactory(content)('p1');
    expect(createSessionRestorer(content)(city.snapshot())?.ruleset.type).toBe('city');
  });

  it('refuses a hunt that left the content, instead of resuming the wrong one', () => {
    const empty = buildContent({ monsters: [], hunts: [], vocations: [],
      progression: [TEST_PROGRESSION], combat: [TEST_COMBAT], stamina: [TEST_STAMINA] });
    expect(createSessionRestorer(empty)(hunt().snapshot())).toBeNull();
  });

  it('refuses a session type this server has no ruleset for', () => {
    // Forçar um ruleset conhecido em cima produziria uma sessão que mente sobre o que é.
    const snapshot = { ...hunt().snapshot(), type: 'boss' as const };
    expect(createSessionRestorer(content)(snapshot)).toBeNull();
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

    const city = createSessionBuilder(content)({ to: 'city' }, session);

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

    createSessionBuilder(content)({ to: 'city' }, session);

    expect(hero.health).toBe(hero.maxHealth);
    expect(hero.alive).toBe(true);
  });

  it('vale para a saída manual também: sair da hunt é voltar para a cidade', () => {
    // Todo personagem está em EXATAMENTE uma sessão (invariante 8): "a hunt acabou" nunca
    // pode significar "ele ficou sem sessão".
    const { session } = dyingHunt();
    session.end('manual-exit');
    expect(createSessionBuilder(content)({ to: 'city' }, session)?.ruleset.type).toBe('city');
  });

  it('a Cidade não sucede a si mesma', () => {
    // Uma sessão de Cidade que acaba é logout ou drenagem, e aí o personagem está mesmo
    // saindo do nó.
    const city = createCitySessionFactory(content)('p1');
    city.end('manual-exit');
    expect(createSessionBuilder(content)({ to: 'city' }, city)).toBeNull();
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

    createSessionBuilder(content, () => 8 * HOUR)({ to: 'city' }, hunt);

    expect(hero.staminaUpdatedAtMs).toBe(8 * HOUR);
    expect(hero.staminaMs).toBe(3 * HOUR + 8 * HOUR);
  });
});

describe('construtor de sessão de destino (FUN-30)', () => {
  const content = testContent();
  const build = createSessionBuilder(content);

  const cityWith = (): Session => createCitySessionFactory(content)('p1', { level: 1, xp: 0 });

  it('constrói a hunt pedida, com o personagem que já existia', () => {
    const city = cityWith();
    const hero = city.participants[0];

    const hunt = build({ to: 'hunt', huntId: 'arena', difficulty: 'beginner' }, city);

    expect(hunt?.ruleset.type).toBe('hunt');
    expect(hunt?.participants[0]).toBe(hero);
    // Entrou no começo da rota, não na posição que trouxe da cidade.
    expect(hero?.position).toEqual({ x: 1, y: 1, z: 7 });
  });

  it('recusa hunt inexistente em vez de construir uma que mente sobre o que é', () => {
    expect(build({ to: 'hunt', huntId: 'nowhere', difficulty: 'beginner' }, cityWith()))
      .toBeNull();
  });

  it('recusa dificuldade que a hunt não define', () => {
    // A dificuldade chega como string do cliente e é validada pelo CONTEÚDO, não por um enum
    // no protocolo: uma hunt define as dificuldades que fazem sentido para ela.
    expect(build({ to: 'hunt', huntId: 'arena', difficulty: 'legendary' }, cityWith()))
      .toBeNull();
  });

  it('recusa os destinos que ainda não têm ruleset', () => {
    // Treino, quest, boss e guild war. `null` recusa com erro claro, que é melhor que
    // construir uma sessão que mente sobre o que é.
    for (const to of ['training', 'quest', 'boss', 'guild-war'] as const) {
      expect(build({ to }, cityWith())).toBeNull();
    }
  });

  it('materializa a stamina em TODA transição, não só na volta da hunt', () => {
    // Materializar é da fronteira, e toda transição é uma (§10). Fazer no construtor, e não
    // dentro de cada destino, é o que garante que nenhum caminho novo esqueça.
    const HOUR = 3_600_000;
    const city = createCitySessionFactory(content, () => 0)('p1', {
      level: 1, xp: 0, staminaMs: 5 * HOUR, staminaUpdatedAtMs: 0,
    });
    const hero = city.participants[0];

    createSessionBuilder(content, () => 3 * HOUR)(
      { to: 'hunt', huntId: 'arena', difficulty: 'beginner' }, city,
    );

    expect(hero?.staminaMs).toBe(8 * HOUR);
    expect(hero?.staminaUpdatedAtMs).toBe(3 * HOUR);
  });
});

describe('a versão de conteúdo é fixada na sessão (FUN-55)', () => {
  const content = testContent();

  const huntSnapshot = () => {
    const session = createHuntSession({
      id: 'hunt-1', content, huntId: 'arena', difficulty: 'beginner', createdAtMs: 0,
    });
    session.enter(new CharacterRuntime({
      id: 'p1', position: { x: 0, y: 0, z: 7 }, health: 500, maxHealth: 500, mana: 0,
      maxMana: 0, level: 1, xp: 0, vocationId: null, goldDelta: 0, alive: true, cooldowns: {},
    }));
    session.advanceBy(1000);
    return session.snapshot();
  };

  it('recusa retomar um snapshot de OUTRA versão de conteúdo', () => {
    // O ruleset seria montado com o conteúdo deste processo, e a sessão continuaria se
    // declarando na versão antiga — simulando com stats, curva de XP e coeficientes novos
    // sob um rótulo velho. É o que o invariante 7 existe para impedir.
    const snapshot = { ...huntSnapshot(), contentVersion: 'de-outro-deploy' };
    expect(createSessionRestorer(content)(snapshot)).toBeNull();
  });

  it('retoma normalmente quando a versão bate', () => {
    expect(createSessionRestorer(content)(huntSnapshot())?.ruleset.type).toBe('hunt');
  });

  it('vale para a Cidade também, não só para a hunt', () => {
    const city = createCitySessionFactory(content)('p1');
    const snapshot = { ...city.snapshot(), contentVersion: 'de-outro-deploy' };
    expect(createSessionRestorer(content)(snapshot)).toBeNull();
  });
});
