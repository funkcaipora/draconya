import { buildContent } from '@draconya/content';
import { CharacterRuntime, createHuntSession, totalXpForLevel } from '@draconya/sim';
import {
  TEST_COMBAT, TEST_HUNT, TEST_PARTY, TEST_PROGRESSION, TEST_STAMINA,
  rawTestContent, testContent,
} from '../testing/content.js';
import { BOT_SET_COUNT, BOT_SLOTS_PER_SET, BOT_VOCABULARY_VERSION, BOT_VOCABULARY_VERSION_V1, botConfigV2Schema } from '@draconya/content';
import type { Progression } from '@draconya/content';
import type { HuntRuleset, Session, SessionSnapshot } from '@draconya/sim';
import { describe, expect, it } from 'vitest';
import {
  CITY_SHARD_CAPACITY, CityShard, createBotConfigValidator, createCitySessionFactory,
  createSessionBuilder, createSessionRestorer,
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

describe('party session factory (#195, ADR 0027)', () => {
  const party = {
    sessionId: 's-party', leaderId: 'p1', shareCosts: true, splitLoot: true,
    huntId: TEST_HUNT.id, difficulty: 'cautious',
    members: [
      { characterId: 'p1', accountId: 'a1', initialCharacter: { level: 10, xp: totalXpForLevel(10, TEST_PROGRESSION as Progression), gold: 30, premium: true } },
      // Um bot válido e um que o vocabulário recusa: só o válido compila.
      { characterId: 'p2', accountId: 'a2', initialCharacter: { level: 12, xp: totalXpForLevel(12, TEST_PROGRESSION as Progression), botConfig: { version: BOT_VOCABULARY_VERSION_V1, heal: [], potion: [], attack: [], rune: [], support: [] } } },
      { characterId: 'p3', accountId: 'a3', initialCharacter: { level: 1, xp: 0, botConfig: { version: 999 } } },
    ],
  };

  it('creates the HUNT with every member inside, the party options fixed, and each validated bot', () => {
    // Mutação que mata: entrar só o personagem do ticket — os outros nunca chegariam à hunt.
    const session = createCitySessionFactory(testContent())('p2', party.members[1]?.initialCharacter, party);
    expect(session.id).toBe('s-party');
    expect(session.ruleset.type).toBe('hunt');
    expect(session.participants.map((p) => [p.id, p.level, p.gold])).toEqual([['p1', 10, 30], ['p2', 12, 0], ['p3', 1, 0]]);
    const ruleset = session.ruleset as HuntRuleset;
    expect(ruleset.party).toEqual({
      leaderId: 'p1', mode: 'shared', shareCosts: true, splitLoot: true,
      collect: null, autoSell: [],
      // O Premium de cada membro entra no estado da party (ADR 0035 D3): ausente no ticket é Free.
      premiumByCharacter: { p1: true, p2: false, p3: false },
    });
    expect(Object.keys(ruleset.getState().runners ?? {}).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(ruleset.getState().runners?.['p2']?.botConfig).toBeDefined();
    expect(ruleset.getState().runners?.['p3']?.botConfig).toBeUndefined();
    expect(ruleset.getState().partyBag).toBeDefined();
  });

  it('os dois eixos vêm do ticket, e o líder Premium decide o limite de venda (#400)', () => {
    const session = createCitySessionFactory(testContent())('p2', party.members[1]?.initialCharacter, {
      ...party, shareCosts: false, splitLoot: true,
    });
    const ruleset = session.ruleset as HuntRuleset;
    expect(ruleset.party?.shareCosts).toBe(false);
    expect(ruleset.party?.splitLoot).toBe(true);
    expect(ruleset.party?.premiumByCharacter['p1']).toBe(true);
    expect(ruleset.partySummary(session)?.autoSell.limit).toBeGreaterThan(0);
  });

  it('without a party block it is the city of always', () => {
    expect(createCitySessionFactory(testContent())('p1').ruleset.type).toBe('city');
  });
});

describe('session restorer', () => {
  const content = testContent();

  const hunt = (): Session => {
    const session = createHuntSession({
      id: 'hunt-1', content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
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
      progression: [TEST_PROGRESSION], combat: [TEST_COMBAT], stamina: [TEST_STAMINA], party: [TEST_PARTY],
      // O bot é o produto (invariante 11): sem `bot/baseline.json` o conteúdo não monta.
      bot: [{ id: 'baseline', vocabularyVersion: 2, categoryCooldownMs: 1000,
        slots: { heal: 3, potion: 4, attack: 10, rune: 10, support: 10 } }] });
    expect(createSessionRestorer(empty)(hunt().snapshot())).toBeNull();
  });

  it('refuses a session type this server has no ruleset for', () => {
    // Forçar um ruleset conhecido em cima produziria uma sessão que mente sobre o que é.
    const snapshot = { ...hunt().snapshot(), type: 'boss' as const };
    expect(createSessionRestorer(content)(snapshot)).toBeNull();
  });
});

describe('retomada num nó de relógio diferente (FUN-70)', () => {
  const content = testContent();

  /**
   * Uma hunt com um respawn PENDENTE, avançada como o hospedeiro avança: pelo tempo decorrido
   * desde o último avanço DELE, nunca pelo relógio da sessão.
   */
  const huntComRespawnPendente = (): Session => {
    const session = createHuntSession({
      id: 'hunt-1', content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    });
    session.enter(new CharacterRuntime({
      id: 'p1', position: { x: 0, y: 0, z: 7 }, health: 5_000, maxHealth: 5_000, mana: 0,
      maxMana: 0, level: 1, xp: 0, vocationId: null, goldDelta: 0, alive: true, cooldowns: {},
    }));
    while (session.aggregates.kills === 0 && session.nowMs < 60_000) session.advanceBy(100);
    return session;
  };

  it('a hunt volta a respawnar depois de retomar num processo de relógio baixo', () => {
    // A MEDIÇÃO que abriu a issue, reproduzida:
    //
    //     nó A (relógio 21.600.000):  abates, respawn marcado em 21.802.500
    //     nó B (relógio 5.000):       0 abates, 0 monstros vivos — para sempre
    //
    // O `respawnAtMs` do slot era instante absoluto derivado do `performance.now()` do
    // processo, e monotônico não é comparável entre processos. A hunt retomada rodava, gastava
    // CPU, queimava stamina e não gerava um único monstro, sem erro e sem log — o pior formato
    // de falha que existe, porque o jogador só descobre no extrato horas depois.
    //
    // Com relógio lógico (FUN-68) o cenário deixa de ser expressável: o relógio do processo
    // não entra na sessão em lugar nenhum. Este teste é o que impede a classe de voltar.
    const noA = huntComRespawnPendente();
    expect(noA.aggregates.kills).toBe(1);

    // Seis horas de `performance.now()` no nó A não deixam marca nenhuma dentro da sessão: o
    // relógio dela é dela, e é isto que o snapshot carrega.
    const snapshot = JSON.parse(JSON.stringify(noA.snapshot())) as SessionSnapshot;
    expect(snapshot.logicalNowMs).toBeLessThan(60_000);

    const noB = createSessionRestorer(content)(snapshot);
    if (noB === null) throw new Error('esperava retomar a hunt');
    const ruleset = noB.ruleset as HuntRuleset;
    expect(ruleset.monsters).toHaveLength(0);

    // O nó B avança pelo INTERVALO decorrido nele, como `SessionHost.cycle` faz com
    // `lastAdvancedAtMs` — e o relógio dele começa perto de zero, que é o caso que quebrava.
    //
    // Dez vezes o `respawnDelayMs`, que é o mesmo excesso que a medição usou para concluir que
    // a hunt não voltaria nunca. As duas coisas que ela reportou em zero são medidas na JANELA
    // INTEIRA: um `monsters.length` lido no fim seria frágil por acidente, porque o herói mata
    // em um golpe e o instante final cai no prazo de respawn na maior parte das vezes.
    let noBAgoraMs = 5_000;
    let monstrosVistos = 0;
    const ateMs = 5_000 + 10 * TEST_HUNT.difficulties.cautious.respawnDelayMs;
    for (; noBAgoraMs < ateMs; noBAgoraMs += 1_000) {
      noB.advanceBy(1_000);
      monstrosVistos = Math.max(monstrosVistos, ruleset.monsters.length);
    }

    // As duas linhas que a issue reportou em zero.
    expect(monstrosVistos).toBeGreaterThan(0);
    expect(noB.aggregates.kills).toBeGreaterThan(noA.aggregates.kills);
  });

  it('o relógio do hospedeiro não entra na sessão retomada', () => {
    // A raiz, dita diretamente: o `nowMs` do processo e o `session.nowMs` são grandezas
    // diferentes, e comparar as duas é o que produzia o defeito. A sessão retomada continua no
    // instante lógico em que parou, seja qual for a hora do processo que a recebeu.
    const snapshot = huntComRespawnPendente().snapshot();
    const retomada = createSessionRestorer(content)(snapshot);
    expect(retomada?.nowMs).toBe(snapshot.logicalNowMs);
  });
});

describe('city successor (FUN-38)', () => {
  const content = testContent();

  const dyingHunt = (): { session: Session; hero: CharacterRuntime } => {
    const session = createHuntSession({
      id: 'hunt-1', content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
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

    const city = createSessionBuilder(content)({ to: 'city' }, session, 'p1');

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

    createSessionBuilder(content)({ to: 'city' }, session, 'p1');

    expect(hero.health).toBe(hero.maxHealth);
    expect(hero.alive).toBe(true);
  });

  it('vale para a saída manual também: sair da hunt é voltar para a cidade', () => {
    // Todo personagem está em EXATAMENTE uma sessão (invariante 8): "a hunt acabou" nunca
    // pode significar "ele ficou sem sessão".
    const { session } = dyingHunt();
    session.end('manual-exit');
    expect(createSessionBuilder(content)({ to: 'city' }, session, 'p1')?.ruleset.type).toBe('city');
  });

  it('a Cidade não sucede a si mesma', () => {
    // Uma sessão de Cidade que acaba é logout ou drenagem, e aí o personagem está mesmo
    // saindo do nó.
    const city = createCitySessionFactory(content)('p1');
    city.end('manual-exit');
    expect(createSessionBuilder(content)({ to: 'city' }, city, 'p1')).toBeNull();
  });
});

describe('o gold de entrada vem do TICKET, nunca do cliente (FUN-77)', () => {
  const content = testContent();

  it('o saldo persistido chega ao personagem da sessão', () => {
    // Invariante 4: nada que o cliente manda participa da criação da sessão. Um saldo vindo
    // do socket seria poção de graça, e não haveria como distinguir isso de um jogador rico.
    const session = createCitySessionFactory(content)('p1', { level: 1, xp: 0, gold: 4_200 });

    expect(session.participants[0]?.gold).toBe(4_200);
    // O que a sessão movimenta é o DELTA. O saldo de entrada é leitura.
    expect(session.participants[0]?.goldDelta).toBe(0);
  });

  it('ticket sem gold entra com zero, e zero recusa gasto', () => {
    // É o ticket emitido por um `api` antigo, durante deploy em rolagem. Degradar para zero
    // erra para o lado seguro: não gastar o que não se sabe ter.
    const session = createCitySessionFactory(content)('p1', { level: 1, xp: 0 });
    expect(session.participants[0]?.gold).toBe(0);
  });
});

describe('o Bestiário de entrada vem do TICKET, nunca do cliente (FUN-113)', () => {
  const content = testContent();

  it('os abates persistidos chegam ao personagem da sessão', () => {
    // O bônus dos marcos escala a XP DURANTE a hunt (DT-01): um personagem que entrasse em
    // `{}` perderia o marco que já cruzou. E vem do ticket pela mesma razão do gold
    // (invariante 4) — um contador vindo do socket seria marco de graça.
    const session = createCitySessionFactory(content)('p1', {
      level: 1, xp: 0, bestiary: { rat: 10_000, bat: 3 },
    });

    expect(session.participants[0]?.bestiary.killsOf('rat')).toBe(10_000);
    expect(session.participants[0]?.bestiary.getState()).toEqual({ rat: 10_000, bat: 3 });
  });

  it('ticket sem Bestiário entra com nada contado', () => {
    // É o personagem anterior à issue, ou o ticket de um `api` antigo em deploy em rolagem:
    // parte de `{}`, e o próximo extrato traz de volta o que ele matar.
    const session = createCitySessionFactory(content)('p1', { level: 1, xp: 0 });
    expect(session.participants[0]?.bestiary.getState()).toEqual({});
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
      id: 'hunt-1', content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
    });
    const hero = new CharacterRuntime({
      id: 'p1', position: { x: 0, y: 0, z: 7 }, health: 200, maxHealth: 200, mana: 0, maxMana: 0,
      level: 1, xp: 0, vocationId: null, staminaMs: 3 * HOUR, staminaUpdatedAtMs: 0,
      goldDelta: 0, alive: true, cooldowns: {},
    });
    hunt.enter(hero);
    hunt.end('manual-exit');

    createSessionBuilder(content, () => 8 * HOUR)({ to: 'city' }, hunt, 'p1');

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

    const hunt = build({ to: 'hunt', huntId: 'arena', difficulty: 'cautious' }, city, 'p1');

    expect(hunt?.ruleset.type).toBe('hunt');
    expect(hunt?.participants[0]).toBe(hero);
    // Entrou no começo da rota, não na posição que trouxe da cidade.
    expect(hero?.position).toEqual({ x: 1, y: 1, z: 7 });
  });

  it('recusa hunt inexistente em vez de construir uma que mente sobre o que é', () => {
    expect(build({ to: 'hunt', huntId: 'nowhere', difficulty: 'cautious' }, cityWith(), 'p1'))
      .toBeNull();
  });

  it('recusa dificuldade que a hunt não define', () => {
    // A dificuldade chega como string do cliente e é validada pelo CONTEÚDO, não por um enum
    // no protocolo: uma hunt define as dificuldades que fazem sentido para ela.
    expect(build({ to: 'hunt', huntId: 'arena', difficulty: 'legendary' }, cityWith(), 'p1'))
      .toBeNull();
  });

  it('recusa os destinos que ainda não têm ruleset', () => {
    // Treino, quest, boss e guild war. `null` recusa com erro claro, que é melhor que
    // construir uma sessão que mente sobre o que é.
    for (const to of ['training', 'quest', 'boss', 'guild-war'] as const) {
      expect(build({ to }, cityWith(), 'p1')).toBeNull();
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
      { to: 'hunt', huntId: 'arena', difficulty: 'cautious' }, city, 'p1',
    );

    expect(hero?.staminaMs).toBe(8 * HOUR);
    expect(hero?.staminaUpdatedAtMs).toBe(3 * HOUR);
  });
});

describe('a versão de conteúdo é fixada na sessão (FUN-55)', () => {
  const content = testContent();

  const huntSnapshot = () => {
    const session = createHuntSession({
      id: 'hunt-1', content, huntId: 'arena', difficulty: 'cautious', createdAtMs: 0,
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

describe('aceitar ou recusar a configuração do bot (FUN-81, AB-09)', () => {
  const content = testContent();
  const accept = createBotConfigValidator(content);
  const base = (over: Record<string, unknown> = {}) => ({
    version: BOT_VOCABULARY_VERSION_V1,
    heal: [], potion: [], attack: [], rune: [], support: [],
    ...over,
  });

  const emptySets = () => Array.from({ length: BOT_SET_COUNT }, () => ({
    slots: Array.from({ length: BOT_SLOTS_PER_SET }, () => null),
  }));

  it('migra a v1 para a v2, com defaults materializados (RF-12)', () => {
    // A config v1 do Postgres entra como v2: quem a converte é `migrateBotConfigV1` (AB-03),
    // chamada pelo juiz único. Sem isto, a coluna v1 nunca vira v2 e toda entrada repete a
    // migração — o portão de versão que esta task fecha.
    const decision = accept(base({
      heal: [{
        when: { kind: 'hp', op: '<=', percent: 50 },
        do: { kind: 'spell', spellId: 'heal' },
      }],
    }), 1);

    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.config.version).toBe(BOT_VOCABULARY_VERSION);
      expect(decision.config.activeSet).toBe(0);
      expect(decision.config.stance).toBe('balanced');
      expect(decision.config.automations).toEqual([]);
      // A regra da v1 virou o slot 1 do conjunto 0, com `when` em lista e `auto` ligado.
      const slot = decision.config.sets[0]?.slots[0];
      expect(slot).toMatchObject({ do: { kind: 'spell', spellId: 'heal' }, auto: true });
    }
  });

  it('deixa a v2 passar INTACTA — idempotência (RF-13)', () => {
    // Migrar duas vezes não pode apagar `sets`: o curto-circuito de `version === 2` vem antes
    // do parse v1, que descartaria o v2 em silêncio (o v1 não conhece `sets`).
    const v2 = botConfigV2Schema.parse({
      version: BOT_VOCABULARY_VERSION, activeSet: 1, sets: emptySets(), stance: 'offensive',
    });
    const decision = accept(v2, 1);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.config).toEqual(v2);
  });

  it('recusa versão desconhecida com motivo (RF-13)', () => {
    // O portão de versão. `migrateBotConfigV1` aceitaria um v1 bem formado com número errado;
    // é aqui que o servidor recusa antes de migrar.
    const decision = accept({ version: 99, heal: [], potion: [], attack: [], rune: [], support: [] }, 1);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain('99');
  });

  it('materializa os defaults dos campos novos da v2 (RF-14)', () => {
    // Config v2 parcial parseia: `activeSet`, `stance` e `automations` têm default, e um
    // cliente/nó que não os manda não é recusado.
    const parsed = botConfigV2Schema.parse({ version: BOT_VOCABULARY_VERSION, sets: emptySets() });
    expect(parsed.activeSet).toBe(0);
    expect(parsed.stance).toBe('balanced');
    expect(parsed.automations).toEqual([]);
    expect(parsed.targeting.policy).toBe('nearest');
  });

  it('recusa magia que não existe no catálogo DESTE nó', () => {
    const decision = accept(base({
      heal: [{
        when: { kind: 'hp', op: '<=', percent: 50 },
        do: { kind: 'spell', spellId: 'nao-existe' },
      }],
    }), 1);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain('nao-existe');
  });

  it('não existe mais gate de level: avançado vale desde o level 1 (AB-03, ADR 0032 d.4)', () => {
    // O §13.2 exigia level 50 para o bot avançado; o ADR 0032 d.4 revogou o gate. A asserção
    // abaixo é o que impede alguém de reintroduzi-lo por engano.
    expect(accept(base({ targeting: { policy: 'follow' } }), 1).ok).toBe(true);
    expect(accept(base({ lure: { min: 2, max: 5 } }), 1).ok).toBe(true);
    expect(accept(base(), 1).ok).toBe(true);
  });

  it('aceita `follow` e `rule.target` sem mudar de assinatura (#400, RF-06)', () => {
    // O validador não conhece a party (D10): aceita qualquer `characterId` e qualquer alvo de
    // membro. O vocabulário novo (#392) passa por ele porque ele delega inteiramente ao
    // `content` — este teste é o que impede alguém de recortar os campos aqui.
    const comAmigo = buildContent({
      ...rawTestContent(),
      spells: [
        ...(rawTestContent().spells ?? []),
        { id: 'heal-friend', name: 'Cura em Amigo', manaCost: 25, cooldownMs: 1_000, effect: { kind: 'heal', amount: 50, target: 'friend', range: 4 } },
      ],
    });
    const accept = createBotConfigValidator(comAmigo);
    const decision = accept({
      version: BOT_VOCABULARY_VERSION_V1,
      follow: { kind: 'member', characterId: 'qualquer-um' },
      heal: [{
        when: { kind: 'hp', op: '<=', percent: 50 },
        do: { kind: 'spell', spellId: 'heal-friend' },
        target: { kind: 'lowest-hp-member' },
      }],
      potion: [], attack: [], rune: [], support: [],
    }, 1);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.config.follow).toEqual({ kind: 'member', characterId: 'qualquer-um' });
  });
});

describe('a Cidade é um SHARD: uma cópia, muitos personagens (FUN-71, ADR 0023)', () => {
  const content = testContent();
  const entrar = (shard: CityShard, ...ids: readonly string[]) => {
    const factory = createCitySessionFactory(content, () => 0, shard);
    return ids.map((id) => factory(id, { level: 1, xp: 0 }));
  };

  it('dois personagens entram na MESMA sessão, e cada um enxerga o outro', () => {
    // É o critério da issue. Antes disto a praça existia N vezes, vazia em todas: dois
    // jogadores no mesmo lugar do mundo, cada um numa cópia particular dele.
    const [primeira, segunda] = entrar(new CityShard(content, () => 0), 'p1', 'p2');

    expect(segunda).toBe(primeira);
    expect(primeira?.participants.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('cada um chega num tile PRÓPRIO, e nenhum fica fora do mapa', () => {
    // Tile é exclusivo, e o ponto de entrada é um só. Um `place` seco recusaria o segundo, e
    // ele ficaria em (-1,-1) — invisível, sem andar, com o log dizendo que entrou.
    const [session] = entrar(new CityShard(content, () => 0), 'p1', 'p2', 'p3');
    const posicoes = session?.participants.map((p) => `${p.position.x},${p.position.y}`) ?? [];

    expect(posicoes).toHaveLength(3);
    expect(new Set(posicoes).size).toBe(3);
    expect(posicoes.some((tile) => tile === '-1,-1')).toBe(false);
  });

  it('sair NÃO encerra a sessão de quem ficou', () => {
    // O motivo de `Session.leave` existir. Antes, "sair" só sabia ser `end`, e um jogador
    // saindo da praça encerraria a praça.
    const [session] = entrar(new CityShard(content, () => 0), 'p1', 'p2');
    if (session === undefined) throw new Error('a praça não foi criada');

    expect(session.leave('p1')?.character.id).toBe('p1');
    expect(session.ended).toBeNull();
    expect(session.participants.map((p) => p.id)).toEqual(['p2']);
  });

  it('quem sai libera o tile, e o próximo a chegar pode usá-lo', () => {
    // Sem isto sobra um bloqueio invisível no meio da praça: ninguém consegue pisar ali,
    // ninguém está ali, e nada na tela explica.
    const shard = new CityShard(content, () => 0);
    const [session] = entrar(shard, 'p1', 'p2');
    if (session === undefined) throw new Error('a praça não foi criada');
    const vago = session.participants.find((p) => p.id === 'p1')?.position;

    session.leave('p1');
    const [depois] = entrar(shard, 'p3');

    expect(depois).toBe(session);
    expect(session.participants.find((p) => p.id === 'p3')?.position).toEqual(vago);
  });

  it('a cópia VAZIA é esquecida, e a próxima entrada cria outra', () => {
    // Reaproveitar a praça vazia parece economia e é armadilha: a versão de conteúdo é fixada
    // na criação (invariante 7), então uma praça que ninguém frequenta e atravessa três
    // deploys continuaria rodando a versão do primeiro.
    const shard = new CityShard(content, () => 0);
    const [primeira] = entrar(shard, 'p1');
    primeira?.leave('p1');
    expect(shard.population).toBe(0);

    const [outra] = entrar(shard, 'p2');
    expect(outra).not.toBe(primeira);
  });

  it('voltar de uma hunt é chegar na praça em que os outros estão', () => {
    // O caminho da morte e o do encerramento de hunt passam pelo `SessionBuilder`, não pela
    // fábrica. Uma `CityShard` diferente nos dois lados daria duas praças que nunca se veem —
    // e o defeito ficaria invisível até alguém tentar encontrar um amigo.
    const shard = new CityShard(content, () => 0);
    const [praca] = entrar(shard, 'p1', 'p2');
    if (praca === undefined) throw new Error('a praça não foi criada');
    const builder = createSessionBuilder(content, () => 0, shard);

    // p1 sai para caçar; p2 fica na praça. É a ordem real do hospedeiro: constrói o destino,
    // e só então tira quem saiu da sessão anterior.
    const hunt = builder({ to: 'hunt', huntId: 'arena', difficulty: 'cautious' }, praca, 'p1');
    if (hunt === null) throw new Error('a hunt não foi construída');
    praca.leave('p1');
    expect(praca.participants.map((p) => p.id)).toEqual(['p2']);

    expect(builder({ to: 'city' }, hunt, 'p1')).toBe(praca);
    expect(praca.participants.map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('quem volta de uma hunt com a praça VAZIA recebe uma cópia nova, não a de antes', () => {
    // Coerente com o descarte da cópia vazia: a praça que ele deixou não sobreviveu à saída
    // dele, e ressuscitá-la traria de volta a versão de conteúdo em que ela nasceu.
    const shard = new CityShard(content, () => 0);
    const [praca] = entrar(shard, 'p1');
    if (praca === undefined) throw new Error('a praça não foi criada');
    const builder = createSessionBuilder(content, () => 0, shard);

    const hunt = builder({ to: 'hunt', huntId: 'arena', difficulty: 'cautious' }, praca, 'p1');
    if (hunt === null) throw new Error('a hunt não foi construída');
    praca.leave('p1');

    const volta = builder({ to: 'city' }, hunt, 'p1');
    expect(volta).not.toBe(praca);
    expect(volta?.participants.map((p) => p.id)).toEqual(['p1']);
  });
});

describe('teto de população por cópia, e a Cidade 2 (FUN-33)', () => {
  const content = testContent();
  const entrar = (shard: CityShard, quantos: number): Session[] => {
    const factory = createCitySessionFactory(content, () => 0, shard);
    return Array.from({ length: quantos }, (_, i) => factory(`p${i}`, { level: 1, xp: 0 }));
  };

  it('enche uma cópia antes de abrir a próxima', () => {
    // Espalhar daria praças pela metade, e praça pela metade é pior que praça cheia: o valor
    // de estar na Cidade é haver gente nela.
    const shard = new CityShard(content, () => 0, { capacity: 3 });
    const sessoes = entrar(shard, 3);

    expect(new Set(sessoes).size).toBe(1);
    expect(shard.copies).toBe(1);
    expect(shard.population).toBe(3);
  });

  it('a cópia cheia abre a Cidade 2, e ninguém é recusado', () => {
    // O teto é do NÓ, não do jogo: ele diz quanto um processo aguarda hospedar junto, e a
    // resposta a "encheu" é abrir outra cópia, nunca negar a entrada.
    const shard = new CityShard(content, () => 0, { capacity: 2 });
    const sessoes = entrar(shard, 5);

    expect(shard.copies).toBe(3);
    expect(shard.population).toBe(5);
    expect(sessoes[0]).toBe(sessoes[1]);
    expect(sessoes[2]).not.toBe(sessoes[0]);
    expect(sessoes[4]).not.toBe(sessoes[2]);
  });

  it('quem sai abre vaga, e o próximo entra NA MESMA cópia', () => {
    // Sem isto, uma praça que encheu uma vez ficaria marcada como cheia para sempre, e a
    // Cidade 2 continuaria enchendo enquanto a 1 esvaziava.
    const shard = new CityShard(content, () => 0, { capacity: 2 });
    const [primeira] = entrar(shard, 2);
    if (primeira === undefined) throw new Error('a praça não foi criada');
    primeira.leave('p0');

    const [voltando] = entrar(shard, 1);
    expect(voltando).toBe(primeira);
    expect(shard.copies).toBe(1);
  });

  it('o teto padrão é o do §13, e ele é conferido na construção', () => {
    expect(CITY_SHARD_CAPACITY).toBe(200);
    expect(() => new CityShard(content, () => 0, { capacity: 0 })).toThrow(/positive integer/);
    expect(() => new CityShard(content, () => 0, { capacity: 1.5 })).toThrow(/positive integer/);
  });
});
