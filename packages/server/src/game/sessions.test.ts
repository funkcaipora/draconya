import { buildContent } from '@draconya/content';
import { CharacterRuntime, createHuntSession, totalXpForLevel } from '@draconya/sim';
import {
  TEST_ADVANCED_POLICY, TEST_COMBAT, TEST_HUNT, TEST_PROGRESSION, TEST_STAMINA, testContent,
} from '../testing/content.js';
import { BOT_VOCABULARY_VERSION } from '@draconya/content';
import type { Progression } from '@draconya/content';
import type { HuntRuleset, Session, SessionSnapshot } from '@draconya/sim';
import { describe, expect, it } from 'vitest';
import {
  CityShard, createBotConfigValidator, createCitySessionFactory, createSessionBuilder,
  createSessionRestorer,
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
      progression: [TEST_PROGRESSION], combat: [TEST_COMBAT], stamina: [TEST_STAMINA],
      // O bot é o produto (invariante 11): sem `bot/baseline.json` o conteúdo não monta.
      bot: [{ id: 'baseline', vocabularyVersion: 1, categoryCooldownMs: 1000,
        advancedFromLevel: 50,
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
      id: 'hunt-1', content, huntId: 'arena', difficulty: 'beginner', createdAtMs: 0,
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
    const ateMs = 5_000 + 10 * TEST_HUNT.difficulties.beginner.respawnDelayMs;
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

    const hunt = build({ to: 'hunt', huntId: 'arena', difficulty: 'beginner' }, city, 'p1');

    expect(hunt?.ruleset.type).toBe('hunt');
    expect(hunt?.participants[0]).toBe(hero);
    // Entrou no começo da rota, não na posição que trouxe da cidade.
    expect(hero?.position).toEqual({ x: 1, y: 1, z: 7 });
  });

  it('recusa hunt inexistente em vez de construir uma que mente sobre o que é', () => {
    expect(build({ to: 'hunt', huntId: 'nowhere', difficulty: 'beginner' }, cityWith(), 'p1'))
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
      { to: 'hunt', huntId: 'arena', difficulty: 'beginner' }, city, 'p1',
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

describe('aceitar ou recusar a configuração do bot (FUN-81)', () => {
  const content = testContent();
  const accept = createBotConfigValidator(content);
  const base = (over: Record<string, unknown> = {}) => ({
    version: BOT_VOCABULARY_VERSION,
    heal: [], potion: [], attack: [], rune: [], support: [],
    ...over,
  });

  it('aceita uma configuração válida e devolve a versão PARSEADA, com defaults', () => {
    // Devolver o parseado, e não o cru, é o que garante que quem compila recebe `targeting` e
    // `exit` preenchidos — o cliente não precisa mandar campo que ele não usa.
    const decision = accept(base(), 1);
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.config.targeting.policy).toBe('nearest');
      expect(decision.config.exit).toEqual([]);
    }
  });

  it('recusa forma fora do vocabulário, dizendo ONDE', () => {
    // "Sua configuração é inválida" sem dizer onde é o que faz alguém desistir de configurar
    // o bot. O caminho do campo vai no texto porque ele vai direto para o jogador.
    const decision = accept(base({
      heal: [{ when: { kind: 'gold', op: '<', amount: 100 }, do: { kind: 'spell', spellId: 'heal' } }],
    }), 1);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain('heal');
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

  it('recusa mais regras que slots', () => {
    const regra = {
      when: { kind: 'hp', op: '<=', percent: 50 }, do: { kind: 'spell', spellId: 'heal' },
    };
    const decision = accept(base({ heal: [regra, regra, regra, regra] }), 1);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain('heal');
  });

  it('o GATE de level: recurso avançado abaixo do 50 é recusado, dizendo qual', () => {
    // §13.2. "Seu bot exige level 50" sem dizer o quê deixa o jogador procurando qual das
    // trinta regras dele é a culpada.
    const avancada = base({ targeting: { policy: TEST_ADVANCED_POLICY } });
    const recusado = accept(avancada, 49);
    expect(recusado.ok).toBe(false);
    if (!recusado.ok) {
      expect(recusado.reason).toContain('50');
      expect(recusado.reason).toContain(TEST_ADVANCED_POLICY);
    }

    expect(accept(avancada, 50).ok).toBe(true);
  });

  it('o gate não atrapalha quem não usa nada avançado', () => {
    expect(accept(base({ targeting: { policy: 'nearest' } }), 1).ok).toBe(true);
  });

  it('o lure é avançado por NOME, e o gate o recusa abaixo do 50 (FUN-87)', () => {
    // Diferente da política de alvo acima: `lure` não está em `advancedOnly` nenhum. O §13.2
    // cita lure e ring swap como o que o bot avançado tem, então o gate os conhece por nome —
    // e este teste é o que impede alguém de "simplificar" isso para dentro da lista de
    // conteúdo, onde o recorte ainda é [ABERTO].
    const recusado = accept(base({ lure: { min: 2, max: 5 } }), 49);
    expect(recusado.ok).toBe(false);
    if (!recusado.ok) {
      expect(recusado.reason).toContain('50');
      expect(recusado.reason).toContain('lure');
    }

    expect(accept(base({ lure: { min: 2, max: 5 } }), 50).ok).toBe(true);
  });

  it('o conteúdo REAL não gateia nada — o recorte do §13.2 ainda é [ABERTO]', () => {
    // Este teste é o comentário virando obrigação. No dia em que alguém preencher
    // `advancedOnly` em `bot/baseline.json`, ele falha — e a mudança tem de ser deliberada,
    // com o PRD tendo decidido, em vez de um palpite que trava o recurso para todo mundo
    // abaixo do level 50.
    expect(content.bot.advancedOnly.conditions).toEqual([]);
    expect(content.bot.advancedOnly.postures).toEqual([]);
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

    expect(session.leave('p1')?.id).toBe('p1');
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
    const hunt = builder({ to: 'hunt', huntId: 'arena', difficulty: 'beginner' }, praca, 'p1');
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

    const hunt = builder({ to: 'hunt', huntId: 'arena', difficulty: 'beginner' }, praca, 'p1');
    if (hunt === null) throw new Error('a hunt não foi construída');
    praca.leave('p1');

    const volta = builder({ to: 'city' }, hunt, 'p1');
    expect(volta).not.toBe(praca);
    expect(volta?.participants.map((p) => p.id)).toEqual(['p1']);
  });
});
