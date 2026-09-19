import { compileMitigation, skillSchema } from '@draconya/content';
import type { Combat } from '@draconya/content';
import { describe, expect, it } from 'vitest';
import { CharacterRuntime } from './character.js';
import { resolveDamage } from './combat/damage.js';
import { Rng } from './rng.js';
import { Session } from './session.js';
import type { EndReason, Ruleset } from './session.js';
import { EventPriority } from './schedule.js';

/**
 * Ruleset de teste que exercita os dois padrões que aparecem em combate de verdade:
 * regeneração periódica e ação periódica com sorteio de loot.
 *
 * Se ele produzir resultados diferentes conforme a taxa em que o hospedeiro avança a sessão, é
 * porque alguma fórmula voltou a depender do tamanho da janela — e a otimização mais valiosa
 * do projeto (ADR 0003) morreu.
 */
function testRuleset(): Ruleset {
  return {
    type: 'hunt',
    hz: (attached) => (attached ? 10 : 1),
    onEnter(session, character) {
      session.scheduleIn('regen', 500, { priority: EventPriority.Upkeep, subject: character.id });
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: character.id });
    },
    onCreatureDied: () => {},
    onEnd: () => {},
    onEvent(session, event) {
      const p = session.participants.find((c) => c.id === event.subject);
      if (p === undefined) return;

      if (event.kind === 'regen') {
        // 2 por segundo é um evento a cada 500 ms. Nunca `taxa * dtMs / 1000`.
        p.mana = Math.min(p.maxMana, p.mana + 1);
        session.scheduleIn('regen', 500, { priority: EventPriority.Upkeep, subject: p.id });
        return;
      }

      const damage = session.rng.integer(10, 20);
      session.credit(p.id, 'xpGained', damage);
      session.credit(p.id, 'kills', 1);
      if (session.rng.chance(0.1)) {
        session.credit(p.id, 'goldGained', session.rng.integer(1, 50));
      }
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: p.id });
    },
  };
}

function character(id = 'p1'): CharacterRuntime {
  return new CharacterRuntime({
    id,
    position: { x: 0, y: 0, z: 7 },
    health: 500, maxHealth: 500,
    mana: 0, maxMana: 1000,
    level: 20, xp: 0,
    goldDelta: 0, alive: true,
    cooldowns: {},
  });
}

function run(hz: number, durationMs: number, seed: string) {
  const session = new Session({
    id: 's1',
    contentVersion: 'v1',
    ruleset: testRuleset(),
    rng: Rng.fromSeed(seed),
    createdAtMs: 0,
  });
  session.enter(character());

  const stepMs = 1000 / hz;
  for (let t = stepMs; t <= durationMs; t += stepMs) session.advanceBy(stepMs);

  return {
    aggregates: { ...session.aggregates },
    mana: Math.round((session.participants[0] as CharacterRuntime).mana),
    rng: session.getRngState(),
  };
}

describe('equivalence between advance rates', () => {
  it('10 Hz and 1 Hz produce the same result', () => {
    // O TESTE QUE DEFINE O PROJETO. Se ele quebrar, alguma fórmula passou a contar ticks,
    // e a hunt desanexada deixou de valer o mesmo que a anexada (invariante 2 e 3).
    expect(run(1, 60_000, 'seed-42')).toEqual(run(10, 60_000, 'seed-42'));
  });

  it('also supports 2 Hz and 20 Hz', () => {
    expect(run(2, 60_000, 'x')).toEqual(run(20, 60_000, 'x'));
  });

  it('finishes with the same random generator state', () => {
    // Mesmo número de saques nas duas taxas — é o que mantém o loot idêntico.
    expect(run(1, 30_000, 'y').rng).toEqual(run(10, 30_000, 'y').rng);
  });

  it('different seeds diverge', () => {
    expect(run(10, 30_000, 'a')).not.toEqual(run(10, 30_000, 'b'));
  });
});

describe('changing tick rate during a session', () => {
  it('detaching does not lose or gain time', () => {
    // Trocar de taxa não move nada de lugar: os eventos vencem nos mesmos instantes lógicos,
    // e o tamanho da janela só decide quantos deles são despachados de uma vez.
    const continuous = run(10, 60_000, 'z');

    const session = new Session({
      id: 's1', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('z'), createdAtMs: 0,
    });
    session.enter(character());
    session.attach('v');
    for (let t = 100; t <= 30_000; t += 100) session.advanceBy(100);
    session.detach('v');
    for (let t = 31_000; t <= 60_000; t += 1000) session.advanceBy(1000);

    expect({ ...session.aggregates }).toEqual(continuous.aggregates);
  });

  it('adapts the rate to viewer presence', () => {
    const session = new Session({
      id: 's1', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('w'), createdAtMs: 0,
    });
    expect(session.attached).toBe(false);
    expect(session.currentHz()).toBe(1);
    session.attach('v1');
    session.attach('v2');
    expect(session.currentHz()).toBe(10);
    session.detach('v1');
    expect(session.currentHz()).toBe(10); // ainda há um olhando
    session.detach('v2');
    expect(session.currentHz()).toBe(1);
  });
});

describe('lifecycle', () => {
  it('runs without viewers', () => {
    // O modo padrão do jogo. Se algum caminho presumir que existe um, quebra na primeira AFK.
    const r = run(1, 10_000, 'afk');
    expect(r.aggregates.kills).toBeGreaterThan(0);
  });

  it('does not advance for a zero interval, and refuses a negative one', () => {
    const session = new Session({
      id: 's', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('t'), createdAtMs: 0,
    });
    session.enter(character());
    session.advanceBy(1000);
    const after = { ...session.aggregates };
    session.advanceBy(0);
    expect({ ...session.aggregates }).toEqual(after);
    // Intervalo negativo é bug de quem chama, não estado a tolerar em silêncio: o relógio
    // lógico só anda para a frente, e uma sessão que andasse para trás repetiria eventos.
    expect(() => session.advanceBy(-1)).toThrow();
  });

  it('ends idempotently and preserves the reason', () => {
    const session = new Session({
      id: 's', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('e'), createdAtMs: 0,
    });
    session.enter(character());
    const first = session.end('death');
    const second = session.end('drain' as EndReason);
    expect(first[0]?.reason).toBe('death');
    expect(second[0]?.reason).toBe('death');
    expect(second).toBe(first);
    expect(session.ended).toBe('death');
  });

  it('does not advance an ended session', () => {
    const session = new Session({
      id: 's', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('f'), createdAtMs: 0,
    });
    session.enter(character());
    session.advanceBy(1000);
    session.end('manual-exit');
    const frozen = { ...session.aggregates };
    session.advanceBy(60_000);
    expect({ ...session.aggregates }).toEqual(frozen);
  });

  it('pins the content version on creation', () => {
    const session = new Session({
      id: 's', contentVersion: 'content-v7', ruleset: testRuleset(),
      rng: Rng.fromSeed('g'), createdAtMs: 0,
    });
    expect(session.contentVersion).toBe('content-v7');
  });
});

describe('relógio lógico (FUN-68)', () => {
  const sessionFor = (seed: string): Session => {
    const session = new Session({
      id: 's1', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed(seed), createdAtMs: 1_700_000_000_000,
    });
    session.enter(character());
    return session;
  };

  it('começa em zero, e não no relógio de quem a criou', () => {
    // O `createdAtMs` é do hospedeiro e serve para quem lê log. A simulação nasce em zero, e é
    // isso que faz o snapshot ser comparável entre processos.
    expect(sessionFor('clock').nowMs).toBe(0);
  });

  it('anda exatamente o intervalo pedido', () => {
    const session = sessionFor('clock');
    session.advanceBy(100);
    session.advanceBy(250);
    expect(session.nowMs).toBe(350);
  });

  it('durante o evento, o agora é o instante do vencimento', () => {
    // É o que dispensa acumulador: quem reagenda faz `nowMs + intervalo` e não herda erro.
    const seen: number[] = [];
    const session = new Session({
      id: 's', contentVersion: 'v1', rng: Rng.fromSeed('t'), createdAtMs: 0,
      ruleset: {
        type: 'hunt',
        hz: () => 1,
        onEnter: (s) => { s.scheduleIn('tick', 350); },
        onCreatureDied: () => {},
        onEnd: () => {},
        onEvent: (s) => { seen.push(s.nowMs); s.scheduleIn('tick', 350); },
      },
    });
    session.enter(character());
    session.advanceBy(1000);
    expect(seen).toEqual([350, 700]);
    // E o relógio termina no alvo, não no último evento.
    expect(session.nowMs).toBe(1000);
  });

  it('um snapshot restaurado num processo de relógio completamente outro não muda nada', () => {
    // O critério da FUN-68, e o que aposentou o `rebaseClock`. Antes, `lastTickMs` era o
    // monotônico do processo que morreu: restaurado noutro, ou a sessão nunca mais avançava
    // (dtMs negativo para sempre) ou o primeiro tick resolvia horas de combate de uma vez.
    const straight = sessionFor('gap');
    for (let i = 0; i < 60; i++) straight.advanceBy(1000);

    const interrupted = sessionFor('gap');
    for (let i = 0; i < 30; i++) interrupted.advanceBy(1000);
    const snap = JSON.parse(JSON.stringify(interrupted.snapshot())) as ReturnType<Session['snapshot']>;

    // O processo novo não compartilha origem de relógio nenhuma com o antigo.
    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));
    expect(resumed.nowMs).toBe(30_000);
    for (let i = 0; i < 30; i++) resumed.advanceBy(1000);

    expect(resumed.nowMs).toBe(straight.nowMs);
    expect({ ...resumed.aggregates }).toEqual({ ...straight.aggregates });
    expect(resumed.getRngState()).toEqual(straight.getRngState());
  });

  it('o intervalo pulado é descartado, não devido', () => {
    // ADR 0018 sem operação especial: o hospedeiro guarda o relógio de processo, então uma
    // sessão retomada é avançada a partir de agora. O buraco nunca chega a ser oferecido.
    const session = sessionFor('discard');
    for (let i = 0; i < 10; i++) session.advanceBy(1000);
    const snap = session.snapshot();

    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));
    const before = { ...resumed.aggregates };
    // Seis horas depois, no relógio do mundo — e nada aconteceu, porque nada foi avançado.
    expect({ ...resumed.aggregates }).toEqual(before);
    expect(resumed.nowMs).toBe(10_000);
  });

  it('uma engasgada longa vira UMA recuperação, e não horas de combate de uma vez', () => {
    // O sucessor do teto de catch-up dos cooldowns. Um `advanceBy` gigante — GC longo,
    // depurador, máquina suspensa — não pode resolver o backlog inteiro.
    const truncated = sessionFor('stall');
    truncated.advanceBy(8 * 60 * 60_000);

    // Bateu no teto e registrou por quê, em vez de rodar milhões de eventos em silêncio.
    expect(truncated.notableEvents.some((e) => e.type === 'advance-truncated')).toBe(true);
    // O relógio chega ao alvo do mesmo jeito: o tempo passou, o combate é que não aconteceu.
    expect(truncated.nowMs).toBe(8 * 60 * 60_000);

    // E o que sobrou na fila vence no alvo, uma vez — não uma vez por intervalo pulado.
    const before = truncated.aggregates.kills;
    truncated.advanceBy(1);
    expect(truncated.aggregates.kills - before).toBeLessThan(10);
  });

  it('nenhum tempo de processo entra no snapshot dos temporizadores', () => {
    // Um número de relógio de processo num timer de gameplay é uma bomba-relógio: hoje é
    // inofensivo porque ninguém usa o mecanismo absoluto, e poção e magia são exatamente o
    // que vai buscá-lo.
    const session = sessionFor('purity');
    session.advanceBy(5000);
    const snap = session.snapshot();
    // Tudo o que a fila guarda é relativo ao zero da sessão, então nada pode passar do
    // relógio lógico dela.
    for (const event of snap.schedule.events) {
      expect(event.dueAtMs).toBeLessThanOrEqual(snap.logicalNowMs + 60_000);
      expect(event.dueAtMs).toBeGreaterThanOrEqual(0);
    }
    expect(snap.logicalNowMs).toBe(5000);
  });
});

describe('agregados e extrato por participante (#187, ADR 0027)', () => {
  const sessionWith = (...ids: string[]): Session => {
    const session = new Session({
      id: 's-party', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('party'), createdAtMs: 0,
    });
    for (const id of ids) session.enter(character(id));
    return session;
  };

  it('credit escreve no participante E na soma; best*Hit é máximo, não soma', () => {
    // Mutação que mata: `own[key] += delta` para bestBasicHit — a soma passaria de 30 a 50.
    const session = sessionWith('a', 'b');
    session.credit('a', 'xpGained', 5);
    session.credit('b', 'xpGained', 7);
    session.credit('a', 'bestBasicHit', 30);
    session.credit('b', 'bestBasicHit', 20);
    session.credit('a', 'bestBasicHit', 10);
    expect(session.aggregatesOf('a').xpGained).toBe(5);
    expect(session.aggregatesOf('b').xpGained).toBe(7);
    expect(session.aggregates.xpGained).toBe(12);
    expect(session.aggregatesOf('a').bestBasicHit).toBe(30);
    expect(session.aggregatesOf('b').bestBasicHit).toBe(20);
    expect(session.aggregates.bestBasicHit).toBe(30);
  });

  it('durationMs é tempo de SESSÃO: igual em todo presente, e a soma não é N × dt', () => {
    const session = sessionWith('a', 'b');
    session.advanceBy(1_000);
    expect(session.aggregatesOf('a').durationMs).toBe(1_000);
    expect(session.aggregatesOf('b').durationMs).toBe(1_000);
    expect(session.aggregates.durationMs).toBe(1_000);
  });

  it('leave devolve o extrato de quem saiu com seq próprio, e end devolve só os que ficaram', () => {
    // Mutação que mata: `seq` fixo por sessão — os dois extratos colidiriam no ledger.
    const session = sessionWith('a', 'b');
    session.credit('a', 'xpGained', 5);
    session.credit('b', 'xpGained', 7);
    const departure = session.leave('a', 'manual-exit');
    expect(departure?.receipt).toMatchObject({
      sessionId: 's-party', characterId: 'a', reason: 'manual-exit', seq: 1,
    });
    expect(departure?.receipt.aggregates.xpGained).toBe(5);
    expect(session.ended).toBeNull();
    expect(session.participants.map((p) => p.id)).toEqual(['b']);

    const receipts = session.end('death');
    expect(receipts.map((r) => [r.characterId, r.seq, r.aggregates.xpGained])).toEqual([['b', 2, 7]]);
    // Duas vezes: os mesmos, sem seq novo.
    expect(session.end('drain')).toBe(receipts);
    expect(session.ledgerSeq).toBe(2);
    expect(session.leave('zz')).toBeNull();
  });

  it('o snapshot preserva os agregados por participante, e um snapshot antigo restaura o solo', () => {
    const session = sessionWith('a', 'b');
    session.credit('a', 'kills', 3);
    session.credit('b', 'kills', 4);
    const restored = Session.fromSnapshot(session.snapshot(), testRuleset(), Rng.fromSeed('x'));
    expect(restored.aggregatesOf('a').kills).toBe(3);
    expect(restored.aggregatesOf('b').kills).toBe(4);
    expect(restored.aggregates.kills).toBe(7);

    // Anterior ao #187: sem `aggregatesByCharacter`, um dono — a soma é dele.
    const solo = sessionWith('a');
    solo.credit('a', 'kills', 9);
    const { aggregatesByCharacter: _dropped, ...legacy } = solo.snapshot();
    const fromLegacy = Session.fromSnapshot(legacy, testRuleset(), Rng.fromSeed('x'));
    expect(fromLegacy.aggregatesOf('a').kills).toBe(9);
    expect(fromLegacy.aggregates.kills).toBe(9);
  });

  it('o snapshot preserva o ledgerSeq sem reemitir seq (#419)', () => {
    const session = sessionWith('a');
    // Consome um `seq` emitindo um extrato de participante que sai.
    session.leave('a', 'manual-exit');

    const snap = session.snapshot();
    const restored = Session.fromSnapshot(snap, testRuleset(), Rng.fromSeed('x'));
    // O contador volta junto: a próxima emissão pega o seq 2, e nunca reusa o 1.
    expect(restored.ledgerSeq).toBe(1);
  });
});

describe('resolver canônico: seed, snapshot e retomada (CMB-02)', () => {
  const combat: Combat = {
    id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
    armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 }, minimumDamageFraction: 0.1,
    player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0, damageType: 'physical' },
    spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
  };

  /**
   * Um ruleset que resolve dano DE VERDADE pelo ponto canônico. É o que prende que a ORDEM do
   * RNG — a faixa do ataque e a rolagem de Dodge — sobrevive ao snapshot: dois processos com a
   * mesma semente e o mesmo ponto de retomada consomem os mesmos sorteios. Se a resolução
   * omitisse um estado (ou mudasse a ordem), os números divergiriam.
   */
  const damageRuleset = (): Ruleset => ({
    type: 'hunt',
    hz: () => 1,
    onEnter(session, character) {
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: character.id });
    },
    onCreatureDied: () => {},
    onEnd: () => {},
    onEvent(session, event) {
      const p = session.participants.find((c) => c.id === event.subject);
      if (p === undefined) return;
      const outcome = resolveDamage(
        { rawDamage: session.rng.integer(10, 20), source: 'basic-attack', damageType: 'physical' },
        { armor: 5, dodgeChance: 0.5 }, 'pve', combat, session.rng,
      );
      session.credit(p.id, 'xpGained', outcome.resolvedDamage);
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: p.id });
    },
  });

  const damageSession = (seed: string): Session => {
    const session = new Session({
      id: 'damage', contentVersion: 'v1', ruleset: damageRuleset(),
      rng: Rng.fromSeed(seed), createdAtMs: 0,
    });
    session.enter(character());
    return session;
  };

  it('a mesma semente rende o mesmo dano antes e depois do snapshot', () => {
    const straight = damageSession('damage-seed');
    for (let i = 0; i < 60; i++) straight.advanceBy(1000);

    const interrupted = damageSession('damage-seed');
    for (let i = 0; i < 30; i++) interrupted.advanceBy(1000);
    const snap = JSON.parse(JSON.stringify(interrupted.snapshot())) as ReturnType<Session['snapshot']>;

    const resumed = Session.fromSnapshot(snap, damageRuleset(), new Rng(snap.rng));
    for (let i = 0; i < 30; i++) resumed.advanceBy(1000);

    expect(resumed.aggregates.xpGained).toBe(straight.aggregates.xpGained);
    expect(resumed.getRngState()).toEqual(straight.getRngState());
  });

  it('cada ataque consome DOIS sorteios: a faixa e o Dodge, na mesma ordem', () => {
    // A ordem é contrato (DT-03 do ADR 0031). Sem o estado do gerador no snapshot, o primeiro
    // golpe retomado repetiria o sorteio anterior — o dano divergiria com a MESMA semente.
    const straight = damageSession('dodge-seed');
    for (let i = 0; i < 10; i++) straight.advanceBy(1000);

    const interrupted = damageSession('dodge-seed');
    for (let i = 0; i < 5; i++) interrupted.advanceBy(1000);
    const snap = interrupted.snapshot();
    const resumed = Session.fromSnapshot(snap, damageRuleset(), new Rng(snap.rng));
    for (let i = 0; i < 5; i++) resumed.advanceBy(1000);

    expect(resumed.aggregates.xpGained).toBe(straight.aggregates.xpGained);
  });
});

describe('mitigação e conteúdo congelado (CMB-03)', () => {
  const combat: Combat = {
    id: 'baseline', compatibilityProfile: 'combat-v1', dodgeMultiplier: 0.5,
    armorEffectiveness: { physical: 1, energy: 0, earth: 0, fire: 0, ice: 0, holy: 0, death: 0, arcane: 0 },
    minimumDamageFraction: 0.1,
    player: { attackPower: 25, attackIntervalMs: 2_000, attackRange: 1, armor: 0, dodgeChance: 0, damageType: 'physical' },
    spellPower: { levelFactor: 0.06, skillFactor: 0.15, spread: 0.15 },
  };

  /**
   * Resolve um golpe de FOGO contra um defensor com a resistência dada. O defensor é montado a
   * partir do CONTEÚDO — a resistência é o que distingue duas versões de conteúdo.
   */
  const resistanceRuleset = (resistance: number): Ruleset => ({
    type: 'hunt',
    hz: () => 1,
    onEnter(session, character) {
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: character.id });
    },
    onCreatureDied: () => {},
    onEnd: () => {},
    onEvent(session, event) {
      const p = session.participants.find((c) => c.id === event.subject);
      if (p === undefined) return;
      const outcome = resolveDamage(
        { rawDamage: session.rng.integer(10, 20), source: 'basic-attack', damageType: 'fire' },
        {
          armor: 0, dodgeChance: 0.5,
          mitigation: compileMitigation({ resistances: { fire: resistance }, immunities: [] }),
        },
        'pve', combat, session.rng,
      );
      session.credit(p.id, 'xpGained', outcome.resolvedDamage);
      session.scheduleIn('attack', 350, { priority: EventPriority.Attack, subject: p.id });
    },
  });

  const mitigationSession = (seed: string, resistance: number): Session => {
    const session = new Session({
      id: 'mitigation', contentVersion: 'v1', ruleset: resistanceRuleset(resistance),
      rng: Rng.fromSeed(seed), createdAtMs: 0,
    });
    session.enter(character());
    return session;
  };

  it('a mitigação do conteúdo entra no resultado e sobrevive ao snapshot com a mesma semente', () => {
    const straight = mitigationSession('mit-seed', 0.5);
    for (let i = 0; i < 60; i++) straight.advanceBy(1000);

    const interrupted = mitigationSession('mit-seed', 0.5);
    for (let i = 0; i < 30; i++) interrupted.advanceBy(1000);
    const snap = JSON.parse(JSON.stringify(interrupted.snapshot())) as ReturnType<Session['snapshot']>;

    const resumed = Session.fromSnapshot(snap, resistanceRuleset(0.5), new Rng(snap.rng));
    for (let i = 0; i < 30; i++) resumed.advanceBy(1000);

    expect(resumed.aggregates.xpGained).toBe(straight.aggregates.xpGained);
    expect(resumed.getRngState()).toEqual(straight.getRngState());
  });

  it('trocar a resistência do conteúdo MUDA o resultado — o conteúdo é a identidade', () => {
    // Um deploy que mudasse a mitigação no meio da hunt produziria um resultado que ninguém
    // simulou (invariante 7). Aqui a prova é que a mesma semente com resistência diferente
    // rende diferente.
    const resistant = mitigationSession('mit-seed', 0.5);
    const vulnerable = mitigationSession('mit-seed', -0.5);
    for (let i = 0; i < 20; i++) {
      resistant.advanceBy(1000);
      vulnerable.advanceBy(1000);
    }
    expect(vulnerable.aggregates.xpGained).toBeGreaterThan(resistant.aggregates.xpGained);
  });
});

describe('skill é estado de personagem e sobrevive ao snapshot (CMB-05, #333)', () => {
  const melee = skillSchema.parse({
    id: 'melee', name: 'Melee', startingLevel: 10,
    curve: { base: 2, factor: 1 }, gain: { on: 'melee-hit', points: 1 }, damagePerLevel: 0.5,
  });

  it('o nível ganho durante a sessão volta no restore, e o resultado segue idêntico', () => {
    const session = new Session({
      id: 'skills', contentVersion: 'v1', ruleset: testRuleset(),
      rng: Rng.fromSeed('skills'), createdAtMs: 0,
    });
    const hero = character();
    session.enter(hero);
    for (let i = 0; i < 5; i++) session.advanceBy(1000);
    // Uso é evento: dois golpes praticados fecham um nível (curva base 2, um ponto por golpe).
    hero.skills.gain(melee, 2);
    const levelBefore = hero.skills.levelOf(melee);
    expect(levelBefore).toBeGreaterThan(10);

    const snap = JSON.parse(JSON.stringify(session.snapshot())) as ReturnType<Session['snapshot']>;
    const resumed = Session.fromSnapshot(snap, testRuleset(), new Rng(snap.rng));
    const restored = resumed.participants[0] as CharacterRuntime;
    // O nível e os pontos voltam, sem bump de formato: `skills` é opcional no estado.
    expect(restored.skills.getState()).toEqual(hero.skills.getState());
    expect(restored.skills.levelOf(melee)).toBe(levelBefore);

    // E o resultado segue a mesma sequência: mesma semente, mesmos agregados e mesma skill.
    for (let i = 0; i < 5; i++) {
      session.advanceBy(1000);
      resumed.advanceBy(1000);
    }
    expect(resumed.aggregates.xpGained).toBe(session.aggregates.xpGained);
    expect(resumed.getRngState()).toEqual(session.getRngState());
    expect(restored.skills.getState()).toEqual(hero.skills.getState());
  });
});
